// @tests: sdd-co-tag-detector, code-clone-detector, release-script-sddreport-skip-if-only-count-line-changed, sdd-detector-5-idea-merge-semantic-similarity

import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isSelected,
  mergeTestsTag,
  parseSeedArgs,
  planSeed,
  renderSeedResult,
  seedTestTags,
} from '../seed-test-tags.js';
import type { SeedPlan } from '../seed-test-tags.js';
import { computeMissingCoTags } from '../../garden/graph-fd-lookup.js';
import type { GraphifyGraph } from '../../garden/graph-fd-lookup.js';
import { detectMissingCoTags } from '../../garden/sdd-report.js';
import type { FeatureRecord } from '../../core/fd-load.js';

describe(mergeTestsTag, () => {
  it('appends the missing slugs after the ones already on the line', () => {
    expect(mergeTestsTag('// @tests: zeta\n\nimport x;\n', ['alpha', 'beta'])).toBe(
      '// @tests: zeta, alpha, beta\n\nimport x;\n',
    );
  });

  it('returns a file with no // @tests: line unchanged', () => {
    const src = "// @fd: foo\n\nimport { it } from 'vitest';\n";
    expect(mergeTestsTag(src, ['alpha'])).toBe(src);
  });

  it('changes nothing outside the tag line, CRLF line breaks included', () => {
    const src = '#!/usr/bin/env node\r\n// @tests: a\r\nconst x = 1;\r\n// @tests: later\r\n';
    expect(mergeTestsTag(src, ['b'])).toBe(
      '#!/usr/bin/env node\r\n// @tests: a, b\r\nconst x = 1;\r\n// @tests: later\r\n',
    );
  });

  it('drops empty entries while rewriting the line', () => {
    expect(mergeTestsTag('// @tests: a,, b,\n', ['c'])).toBe('// @tests: a, b, c\n');
  });

  it('is a no-op when every slug is already declared', () => {
    const src = '// @tests: a, b\n';
    expect(mergeTestsTag(src, ['b'])).toBe(src);
  });
});

describe(isSelected, () => {
  it('selects the path itself and everything under it', () => {
    expect(isSelected('src/design', ['src/design'])).toBe(true);
    expect(isSelected('src/design/__tests__/a.test.ts', ['src/design'])).toBe(true);
  });

  it('does not select a sibling that only shares the prefix', () => {
    expect(isSelected('src/design-extra/b.test.ts', ['src/design'])).toBe(false);
  });

  it('selects everything with no filter or with the repository root', () => {
    expect(isSelected('src/x.test.ts', [])).toBe(true);
    expect(isSelected('src/x.test.ts', [''])).toBe(true);
  });
});

describe(parseSeedArgs, () => {
  const cwd = '/repo';

  it('normalizes and dedupes --path values to repo-relative form', () => {
    expect(
      parseSeedArgs(['--path', './src/design/', '--path', '/repo/src/design', '--apply'], cwd),
    ).toEqual({ ok: true, apply: true, paths: ['src/design'] });
  });

  it('defaults to a dry run over every test', () => {
    expect(parseSeedArgs([], cwd)).toEqual({ ok: true, apply: false, paths: [] });
  });

  it.each([
    ['a path outside the repository', ['--path', '../elsewhere'], /outside the repository/],
    ['the parent directory itself', ['--path', '..'], /outside the repository/],
    ['an unknown flag', ['--force'], /--force/],
    ['a --path with no value', ['--path'], /--path/],
  ])('rejects %s', (_label, argv, message) => {
    const parsed = parseSeedArgs(argv, cwd);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(message);
  });
});

describe(planSeed, () => {
  const inputs = [
    { content: '// @tests: own\n', path: 'src/a/one.test.ts' },
    { content: "import { it } from 'vitest';\n", path: 'src/a/untagged.test.ts' },
    { content: '// @tests: own\n', path: 'src/b/two.test.ts' },
  ];
  const missing = [
    { missing: ['extra'], path: 'src/a/one.test.ts' },
    { missing: ['extra'], path: 'src/a/untagged.test.ts' },
    { missing: ['extra'], path: 'src/b/two.test.ts' },
    { missing: ['extra'], path: 'src/gone.test.ts' },
  ];

  it('edits the selected tagged tests and lists the untagged ones', () => {
    expect(planSeed(missing, inputs, ['src/a'])).toEqual({
      edits: [{ content: '// @tests: own, extra\n', path: 'src/a/one.test.ts', slugs: ['extra'] }],
      untagged: ['src/a/untagged.test.ts'],
    });
  });

  it('skips a test the graph names but the walk did not find', () => {
    expect(planSeed(missing, inputs, []).edits.map((e) => e.path)).toEqual([
      'src/a/one.test.ts',
      'src/b/two.test.ts',
    ]);
  });
});

function feature(slug: string, code: string[]): FeatureRecord {
  return {
    frontmatter: {
      area: 'tooling',
      category: 'Tooling',
      deps: [],
      links: { code, docs: [], tests: [] },
      name: slug,
      'noldor-tier': 'specs-only',
      packages: ['tooling'],
      phase: 'in-progress',
    },
    slug,
  };
}

/** `src/a.test.ts` imports two owned files; `tests/e2e/flow.test.ts` imports one. */
const PARITY_GRAPH: GraphifyGraph = {
  links: [
    { relation: 'imports_from', source: 'unit', target: 'x' },
    { relation: 'imports_from', source: 'unit', target: 'y' },
    { relation: 'imports_from', source: 'e2e', target: 'x' },
  ],
  nodes: [
    { id: 'unit', source_file: 'src/a.test.ts', source_location: 'L1' },
    { id: 'e2e', source_file: 'tests/e2e/flow.test.ts', source_location: 'L1' },
    { id: 'x', source_file: 'src/x.ts', source_location: 'L1' },
    { id: 'y', source_file: 'src/y.ts', source_location: 'L1' },
  ],
};

describe('detector and seeder parity', () => {
  it('name the same tests and slugs, under a non-default e2ePrefix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-parity-'));
    try {
      const graphPath = join(dir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify(PARITY_GRAPH));
      const features = [feature('zeta', ['src/x.ts']), feature('alpha', ['src/y.ts'])];
      const inputs = [
        { content: '// @tests: own\n', path: 'src/a.test.ts' },
        { content: '// @tests: own\n', path: 'tests/e2e/flow.test.ts' },
      ];

      const reported = detectMissingCoTags(features, inputs, graphPath, [], 'tests/e2e/').map(
        (gap) => ({ path: gap.itemId, slugs: gap.message.split('add: ')[1]!.split(', ') }),
      );
      const seeded = planSeed(
        computeMissingCoTags(features, inputs, PARITY_GRAPH, 'tests/e2e/'),
        inputs,
        [],
      ).edits.map(({ path, slugs }) => ({ path, slugs }));

      expect(reported).toEqual([{ path: 'src/a.test.ts', slugs: ['alpha', 'zeta'] }]);
      expect(seeded).toEqual(reported);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

const CONSUMER = {
  appPathPrefix: '',
  boundaries: [],
  deprecatedPackages: [],
  e2ePrefix: 'e2e/',
  lockstepPackages: ['package.json'],
  name: 'acme',
  packagePrefix: '',
  repoUrl: 'https://github.com/x/y',
  samplesPath: '',
  scanPaths: ['src'],
};

function fdMarkdown(name: string, code: string): string {
  return [
    '---',
    `name: ${name}`,
    'phase: in-progress',
    'area: tooling',
    'category: Tooling',
    'packages:',
    '  - tooling',
    'deps: []',
    'links:',
    '  code:',
    `    - ${code}`,
    '  docs: []',
    '  tests: []',
    'noldor-tier: specs-only',
    '---',
    '',
    '## Summary',
    '',
    'Fixture.',
    '',
  ].join('\n');
}

/**
 * A consumer repo scanning `src/`: `alpha` owns `src/alpha.ts` and `beta` owns
 * `src/beta.ts`. `src/one/one.test.ts` and `src/two/two.test.ts` import both
 * and declare only `alpha`; the graph is older than now but newer than every
 * file, so the first `--apply` is what stales it.
 */
function seedRepo(): { dir: string; regen(): void; [Symbol.dispose](): void } {
  const dir = mkdtempSync(join(tmpdir(), 'seed-test-tags-'));
  const past = new Date(Date.now() - 120_000);
  const write = (rel: string, text: string): void => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    utimesSync(full, past, past);
  };
  write('.noldor/config.json', JSON.stringify({ consumer: CONSUMER }));
  write('docs/features/alpha.md', fdMarkdown('Alpha', 'src/alpha.ts'));
  write('docs/features/beta.md', fdMarkdown('Beta', 'src/beta.ts'));
  write('src/alpha.ts', 'export const a = 1;\n');
  write('src/beta.ts', 'export const b = 2;\n');
  write('src/one/one.test.ts', '// @tests: alpha\n\nimport "../alpha";\n');
  write('src/two/two.test.ts', '// @tests: alpha\n\nimport "../beta";\n');
  const graph: GraphifyGraph = {
    links: ['one', 'two'].flatMap((t) => [
      { relation: 'imports_from', source: t, target: 'alpha' },
      { relation: 'imports_from', source: t, target: 'beta' },
    ]),
    nodes: [
      { id: 'one', source_file: 'src/one/one.test.ts', source_location: 'L1' },
      { id: 'two', source_file: 'src/two/two.test.ts', source_location: 'L1' },
      { id: 'alpha', source_file: 'src/alpha.ts', source_location: 'L1' },
      { id: 'beta', source_file: 'src/beta.ts', source_location: 'L1' },
    ],
  };
  write('graphify-out/graph.json', JSON.stringify(graph));
  const graphTime = new Date(Date.now() - 60_000);
  utimesSync(join(dir, 'graphify-out/graph.json'), graphTime, graphTime);
  const previous = process.cwd();
  process.chdir(dir);
  return {
    dir,
    regen: () => {
      const later = new Date(Date.now() + 60_000);
      utimesSync(join(dir, 'graphify-out/graph.json'), later, later);
    },
    [Symbol.dispose]: () => {
      process.chdir(previous);
      rmSync(dir, { force: true, recursive: true });
    },
  };
}

function read(dir: string, rel: string): string {
  return readFileSync(join(dir, rel), 'utf8');
}

describe(seedTestTags, () => {
  it('writes nothing on a dry run and reports what it would add', async () => {
    using repo = seedRepo();
    const result = await seedTestTags({ apply: false, paths: [] });
    expect(result.kind).toBe('seeded');
    if (result.kind === 'seeded') {
      expect(result.plan.edits.map(({ path, slugs }) => ({ path, slugs }))).toEqual([
        { path: 'src/one/one.test.ts', slugs: ['beta'] },
        { path: 'src/two/two.test.ts', slugs: ['beta'] },
      ]);
      expect(result.written).toEqual([]);
    }
    expect(read(repo.dir, 'src/one/one.test.ts')).toBe('// @tests: alpha\n\nimport "../alpha";\n');
  });

  it('writes only the files --path selects', async () => {
    using repo = seedRepo();
    const result = await seedTestTags({ apply: true, paths: ['src/one'] });
    expect(result.kind === 'seeded' && result.written).toEqual(['src/one/one.test.ts']);
    expect(read(repo.dir, 'src/one/one.test.ts')).toBe(
      '// @tests: alpha, beta\n\nimport "../alpha";\n',
    );
    expect(read(repo.dir, 'src/two/two.test.ts')).toBe('// @tests: alpha\n\nimport "../beta";\n');
  });

  it('refuses the next batch as stale after its own --apply, writing nothing', async () => {
    using repo = seedRepo();
    await seedTestTags({ apply: true, paths: ['src/one'] });
    expect(await seedTestTags({ apply: true, paths: ['src/two'] })).toEqual({
      kind: 'graph-unusable',
      stale: true,
    });
    expect(read(repo.dir, 'src/two/two.test.ts')).toBe('// @tests: alpha\n\nimport "../beta";\n');
  });

  it('writes nothing on a second run after a regen', async () => {
    using repo = seedRepo();
    await seedTestTags({ apply: true, paths: [] });
    repo.regen();
    const again = await seedTestTags({ apply: true, paths: [] });
    expect(again.kind === 'seeded' && again.written).toEqual([]);
    expect(renderSeedResult(again, true).code).toBe(0);
  });

  it('refuses when the graph does not exist', async () => {
    using repo = seedRepo();
    rmSync(join(repo.dir, 'graphify-out'), { force: true, recursive: true });
    expect(await seedTestTags({ apply: true, paths: [] })).toEqual({
      kind: 'graph-unusable',
      stale: false,
    });
  });

  it('names every --path that selects no test file', async () => {
    using _repo = seedRepo();
    expect(await seedTestTags({ apply: true, paths: ['src/one', 'src/typo'] })).toEqual({
      kind: 'no-match',
      paths: ['src/typo'],
    });
  });
});

describe(renderSeedResult, () => {
  const plan: SeedPlan = {
    edits: [{ content: '', path: 'src/a.test.ts', slugs: ['beta'] }],
    untagged: [],
  };

  it('names the regen step when the graph is stale', () => {
    const out = renderSeedResult({ kind: 'graph-unusable', stale: true }, true);
    expect(out.code).toBe(1);
    expect(out.stderr).toMatch(/pnpm noldor graphify build/);
    expect(out.stderr).not.toMatch(/regenerate between batches/);
  });

  it('names the generate step when the graph is missing', () => {
    const out = renderSeedResult({ kind: 'graph-unusable', stale: false }, false);
    expect(out.code).toBe(1);
    expect(out.stderr).toMatch(/does not exist — generate it with pnpm noldor graphify build/);
  });

  it('exits 2 naming a --path that selects nothing', () => {
    const out = renderSeedResult({ kind: 'no-match', paths: ['src/typo'] }, false);
    expect(out.code).toBe(2);
    expect(out.stderr).toMatch(/no test file under --path src\/typo/);
  });

  it('lists each edit and points a dry run at --apply', () => {
    const out = renderSeedResult({ kind: 'seeded', plan, written: [] }, false);
    expect(out.code).toBe(0);
    expect(out.stdout).toBe(
      'src/a.test.ts  + beta\nseed-test-tags: dry run — re-run with --apply to write 1 file(s)\n',
    );
  });

  it('exits 1 with the count written before a failed write', () => {
    const out = renderSeedResult(
      { failure: { message: 'EACCES', path: 'src/a.test.ts' }, kind: 'seeded', plan, written: [] },
      true,
    );
    expect(out.code).toBe(1);
    expect(out.stderr).toMatch(/wrote 0 of 1 file\(s\), then failed on src\/a\.test\.ts: EACCES/);
  });
});
