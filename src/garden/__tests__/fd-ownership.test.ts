// @tests: fast-track-changes-can-obsolete-an-unattached-fd, sdd-co-tag-detector

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadFdOwnership, ownersOf, usageWritten } from '../graph-fd-lookup.js';

interface FdSeed {
  phase?: 'done' | 'in-progress';
  code: string[];
  usage?: string | null;
}

function fdFile({ phase = 'done', code, usage = 'Run `noldor thing`.' }: FdSeed): string {
  const codeLines = code.map((p) => `    - ${p}`).join('\n');
  return [
    '---',
    'area: tooling',
    'category: Tooling',
    'links:',
    code.length > 0 ? `  code:\n${codeLines}` : '  code: []',
    '  tests: []',
    'name: Seeded',
    'packages:',
    '  - scripts',
    `phase: ${phase}`,
    'noldor-tier: specs-only',
    '---',
    '',
    '## Summary',
    '',
    'Seeded FD.',
    '',
    ...(usage === null ? [] : ['## Usage', '', usage, '']),
    '## PRs',
    '',
  ].join('\n');
}

function featuresDir(fds: Record<string, FdSeed | string>): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'fd-ownership-')), 'docs', 'features');
  mkdirSync(dir, { recursive: true });
  for (const [slug, seed] of Object.entries(fds)) {
    writeFileSync(join(dir, `${slug}.md`), typeof seed === 'string' ? seed : fdFile(seed));
  }
  return dir;
}

describe('ownersOf', () => {
  it('maps each path to the FDs owning it, directly or through an ancestor directory', async () => {
    const ownership = await loadFdOwnership(
      featuresDir({
        alpha: { code: ['src/a.ts'] },
        beta: { code: ['src/lib'] },
        gamma: { code: ['src/unrelated.ts'] },
      }),
    );
    const owners = ownersOf(['src/a.ts', 'src/lib/deep/b.ts', 'README.md'], ownership);
    expect(owners.map((o) => [o.slug, o.files])).toEqual([
      ['alpha', ['src/a.ts']],
      ['beta', ['src/lib/deep/b.ts']],
    ]);
  });

  it('puts the FD owning the most of the paths first', async () => {
    const ownership = await loadFdOwnership(
      featuresDir({
        hub: { code: ['src/cli/manifest.ts'] },
        home: { code: ['src/cli/manifest.ts', 'src/feature/x.ts', 'src/feature/y.ts'] },
      }),
    );
    const owners = ownersOf(
      ['src/cli/manifest.ts', 'src/feature/x.ts', 'src/feature/y.ts'],
      ownership,
    );
    expect(owners.map((o) => o.slug)).toEqual(['home', 'hub']);
    expect(owners[0]?.files).toEqual([
      'src/cli/manifest.ts',
      'src/feature/x.ts',
      'src/feature/y.ts',
    ]);
  });

  it('returns no owners for paths no FD owns', async () => {
    const ownership = await loadFdOwnership(featuresDir({ alpha: { code: ['src/a.ts'] } }));
    expect(ownersOf(['src/b.ts'], ownership)).toEqual([]);
  });
});

describe('loadFdOwnership standing', () => {
  it('makes a done FD with a written Usage a candidate and skips the rest with a reason', async () => {
    const ownership = await loadFdOwnership(
      featuresDir({
        written: { code: ['src/a.ts'] },
        building: { code: ['src/a.ts'], phase: 'in-progress' },
        stub: {
          code: ['src/a.ts'],
          usage: '<!-- TODO: UI steps, keyboard shortcut, agent API call. -->',
        },
        absent: { code: ['src/a.ts'], usage: null },
      }),
    );
    const bySlug = Object.fromEntries(
      ownersOf(['src/a.ts'], ownership).map((o) => [o.slug, [o.phase, o.skip]]),
    );
    expect(bySlug).toEqual({
      written: ['done', null],
      building: ['in-progress', 'not-done'],
      stub: ['done', 'usage-unwritten'],
      absent: ['done', 'usage-unwritten'],
    });
  });

  it('lists a feature MD whose frontmatter does not parse instead of dropping it silently', async () => {
    const ownership = await loadFdOwnership(
      featuresDir({
        alpha: { code: ['src/a.ts'] },
        broken: '---\nname: [unclosed\n---\n',
      }),
    );
    expect(ownership.unparseable).toEqual(['broken.md']);
    expect(ownersOf(['src/a.ts'], ownership).map((o) => o.slug)).toEqual(['alpha']);
  });
});

describe('usageWritten', () => {
  it.each([
    ['prose under Usage', '## Usage\n\nRun it.\n', true],
    ['a TODO stub', '## Usage\n\n<!-- TODO: UI steps -->\n', false],
    ['an empty section', '## Usage\n\n## PRs\n', false],
    ['no Usage heading', '## Summary\n\nText.\n', false],
    ['a usage-checked marker alone', '## Usage\n\n<!-- noldor:usage-checked abc123 -->\n', false],
  ])('%s → %s', (_label, md, expected) => {
    expect(usageWritten(md)).toBe(expected);
  });
});
