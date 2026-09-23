// @tests: bootstrap-immunity-for-self-gating-features, feature-md-links-overhaul, framework-milestones-support-poc-mvp-100

import { describe, expect, it } from 'vitest';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  backupFeatures,
  collectCandidateFiles,
  collectTestOwners,
  generateProposal,
  parseLlmResponse,
  parseProposal,
  resolveByPath,
} from '../fill-links-code-gaps.js';
import type { FeatureFrontmatter } from '../../core/feature-schema.js';

type FeatureRow = { slug: string; frontmatter: FeatureFrontmatter };

const fmBase: Omit<FeatureFrontmatter, 'name' | 'area' | 'packages'> = {
  category: 'Core',
  deps: [],
  links: { code: [], docs: [], tests: [] },
  phase: 'done',
  'noldor-tier': 'specs-only',
};

const features: FeatureRow[] = [
  {
    slug: 'manifold-wasm-integration',
    frontmatter: { ...fmBase, area: 'engine', name: 'Manifold WASM', packages: ['engine'] },
  },
  {
    slug: 'boolean-operations',
    frontmatter: {
      ...fmBase,
      area: 'engine',
      name: 'Boolean Operations',
      packages: ['engine'],
    },
  },
  {
    slug: 'scene-tree-panel',
    frontmatter: {
      ...fmBase,
      area: 'web',
      category: 'Tooling',
      name: 'Scene Tree Panel',
      packages: ['apps-web'],
    },
  },
];

describe('resolveByPath', () => {
  it('returns single high-confidence match when only one package candidate', () => {
    const result = resolveByPath({
      filePath: 'packages/format/src/serialize.ts',
      features: [
        ...features,
        {
          slug: 'format-package',
          frontmatter: { ...fmBase, area: 'format', name: 'Format', packages: ['format'] },
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].fdSlug).toBe('format-package');
    expect(result[0].confidence).toBe('high');
  });

  it('disambiguates multi-candidate via slug substring', () => {
    const result = resolveByPath({
      filePath: 'packages/engine/src/booleans.ts',
      features,
    });
    expect(result).toHaveLength(1);
    expect(result[0].fdSlug).toBe('boolean-operations');
    expect(result[0].confidence).toBe('high');
  });

  it('returns empty array when no package match', () => {
    const result = resolveByPath({
      filePath: 'docs/some-doc.md',
      features,
    });
    expect(result).toHaveLength(0);
  });

  it('uses area fallback for apps/web/ paths', () => {
    const result = resolveByPath({
      filePath: 'apps/web/src/components/scene-tree/TreeNode.tsx',
      features,
      appPathPrefix: 'apps/web',
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((m) => m.fdSlug === 'scene-tree-panel')).toBe(true);
  });

  it('matches cross-area FDs via packages.includes("web") for apps/web/ paths', () => {
    const crossArea: FeatureRow = {
      slug: 'export-import-acme-file',
      frontmatter: {
        ...fmBase,
        area: 'format',
        category: 'Other',
        name: 'Export / Import .acme File',
        packages: ['format', 'web'],
      },
    };
    const result = resolveByPath({
      filePath: 'apps/web/src/file/import-acme.ts',
      features: [...features, crossArea],
      appPathPrefix: 'apps/web',
    });
    expect(result.some((m) => m.fdSlug === 'export-import-acme-file')).toBe(true);
  });

  it('matches scripts/ paths via packages.includes("scripts") + area-group fallback', () => {
    const scriptFd: FeatureRow = {
      slug: 'noldor',
      frontmatter: {
        ...fmBase,
        area: 'docs',
        category: 'Tooling',
        name: 'Noldor Framework',
        packages: ['scripts'],
      },
    };
    const releaseFd: FeatureRow = {
      slug: 'release-pipeline',
      frontmatter: {
        ...fmBase,
        area: 'release',
        category: 'Tooling',
        name: 'Release Pipeline',
        packages: ['scripts'],
      },
    };
    const result = resolveByPath({
      filePath: 'scripts/release/release-notes.ts',
      features: [scriptFd, releaseFd],
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((m) => m.fdSlug === 'release-pipeline')).toBe(true);
  });

  // Regression (Q-0173): on a standalone src/ repo whose FDs are all
  // `area: tooling, packages: [scripts]`, the appPathPrefix branch matched
  // every file and found no web FD, so every row came back `candidates []`.
  const toolingFd = (slug: string, code: string[]): FeatureRow => ({
    slug,
    frontmatter: {
      ...fmBase,
      area: 'tooling',
      name: slug,
      packages: ['scripts'],
      links: { code, docs: [], tests: [] },
    },
  });

  it('falls back to sibling-directory owners when no layout branch has a candidate', () => {
    const result = resolveByPath({
      filePath: 'src/cr/lanes/new-lane.ts',
      features: [toolingFd('cr-pipeline', ['src/cr/lanes/reviewer.ts']), toolingFd('other', [])],
      appPathPrefix: 'src',
    });
    expect(result).toEqual([
      { fdSlug: 'cr-pipeline', confidence: 'medium', reason: 'owns a sibling in src/cr/lanes/' },
    ]);
  });

  it('credits the FDs tagged by tests that import the file', () => {
    const result = resolveByPath({
      filePath: 'src/cr/lanes/new-lane.ts',
      features: [toolingFd('cr-pipeline', ['src/cr/lanes/reviewer.ts']), toolingFd('lanes', [])],
      appPathPrefix: 'src',
      testOwners: new Map([['src/cr/lanes/new-lane.ts', ['lanes', 'cr-pipeline', 'gone-fd']]]),
    });
    expect(result).toEqual([
      {
        fdSlug: 'cr-pipeline',
        confidence: 'medium',
        reason: 'owns a sibling in src/cr/lanes/; tagged by a test that imports it',
      },
      { fdSlug: 'lanes', confidence: 'medium', reason: 'tagged by a test that imports it' },
    ]);
  });

  it('never rates an ownership-fallback match high, so --auto-high cannot apply it', () => {
    const result = resolveByPath({
      filePath: 'src/widget.ts',
      features: [toolingFd('only-owner', ['src/other.ts'])],
      appPathPrefix: '',
    });
    expect(result.map((m) => m.confidence)).toEqual(['medium']);
  });
});

describe('parseLlmResponse', () => {
  it('parses valid JSON response', () => {
    const raw =
      '{"chosen_fd_slug": "manifold-wasm-integration", "confidence": "high", "reason": "owns wasm module"}';
    const parsed = parseLlmResponse(raw);
    expect(parsed).toEqual({
      fdSlug: 'manifold-wasm-integration',
      confidence: 'high',
      reason: 'owns wasm module',
    });
  });

  it('returns null on malformed JSON', () => {
    expect(parseLlmResponse('not-json')).toBeNull();
  });

  it('returns null on missing required fields', () => {
    expect(parseLlmResponse('{"chosen_fd_slug": "foo"}')).toBeNull();
  });

  it('returns null on invalid confidence', () => {
    expect(
      parseLlmResponse('{"chosen_fd_slug": "foo", "confidence": "extreme", "reason": "x"}'),
    ).toBeNull();
  });
});

describe('generateProposal', () => {
  it('groups assignments by FD slug', () => {
    const md = generateProposal({
      assignments: [
        {
          filePath: 'packages/engine/src/mesh.ts',
          match: { fdSlug: 'manifold-wasm-integration', confidence: 'high', reason: 'pkg' },
        },
        {
          filePath: 'packages/engine/src/booleans.ts',
          match: { fdSlug: 'boolean-operations', confidence: 'high', reason: 'slug' },
        },
      ],
      unassigned: [],
    });
    expect(md).toContain('## manifold-wasm-integration');
    expect(md).toContain('packages/engine/src/mesh.ts');
    expect(md).toContain('## boolean-operations');
    expect(md).toContain('packages/engine/src/booleans.ts');
  });

  it('emits UNASSIGNED section when present', () => {
    const md = generateProposal({
      assignments: [],
      unassigned: [
        {
          filePath: 'apps/web/src/lib/utils.ts',
          candidates: ['editor-shell', 'state-management'],
        },
      ],
    });
    expect(md).toContain('## UNASSIGNED');
    expect(md).toContain('apps/web/src/lib/utils.ts');
    expect(md).toContain('candidates [editor-shell, state-management]');
  });

  it('labels a candidate-less row as unmatched, not as an LLM verdict', () => {
    const md = generateProposal({
      assignments: [],
      unassigned: [{ filePath: 'src/orphan.ts', candidates: [] }],
    });
    expect(md).toContain(
      '- src/orphan.ts (no candidates: no path, sibling, or test-import signal matched)',
    );
    expect(md).not.toContain('LLM low confidence');
  });

  it('omits UNASSIGNED when no unassigned files', () => {
    const md = generateProposal({
      assignments: [
        {
          filePath: 'foo.ts',
          match: { fdSlug: 'foo', confidence: 'high', reason: 'r' },
        },
      ],
      unassigned: [],
    });
    expect(md).not.toContain('UNASSIGNED');
  });
});

describe('parseProposal', () => {
  it('extracts FD-to-files mapping from markdown', () => {
    const md = `# links.code Backfill Proposal

## manifold-wasm-integration

- packages/engine/src/mesh.ts (high — pkg)
- packages/engine/src/primitives.ts (high — pkg)

## boolean-operations

- packages/engine/src/booleans.ts (high — slug)
`;
    const parsed = parseProposal(md);
    expect(parsed.get('manifold-wasm-integration')).toEqual([
      'packages/engine/src/mesh.ts',
      'packages/engine/src/primitives.ts',
    ]);
    expect(parsed.get('boolean-operations')).toEqual(['packages/engine/src/booleans.ts']);
  });

  it('skips lines starting with #', () => {
    const md = `## fd-a

- foo.ts (high)
- # bar.ts (skipped)
`;
    const parsed = parseProposal(md);
    expect(parsed.get('fd-a')).toEqual(['foo.ts']);
  });

  it('skips UNASSIGNED section', () => {
    const md = `## fd-a

- foo.ts (high)

## UNASSIGNED (operator must choose)

- bar.ts (LLM)
`;
    const parsed = parseProposal(md);
    expect(parsed.get('fd-a')).toEqual(['foo.ts']);
    expect(parsed.has('UNASSIGNED')).toBe(false);
  });
});

describe('backupFeatures', () => {
  it('copies all FD MDs to a timestamped backup dir', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'backfill-test-'));
    const featuresDir = join(tempRoot, 'features');
    const backupRoot = join(tempRoot, 'backups');
    mkdirSync(featuresDir);
    writeFileSync(join(featuresDir, 'foo.md'), 'foo content', 'utf8');
    writeFileSync(join(featuresDir, 'bar.md'), 'bar content', 'utf8');

    const backupDir = backupFeatures(featuresDir, backupRoot);

    expect(backupDir).toContain(backupRoot);
    expect(existsSync(join(backupDir, 'foo.md'))).toBe(true);
    expect(existsSync(join(backupDir, 'bar.md'))).toBe(true);
    expect(readFileSync(join(backupDir, 'foo.md'), 'utf8')).toBe('foo content');
  });

  it('skips non-md files', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'backfill-test-'));
    const featuresDir = join(tempRoot, 'features');
    const backupRoot = join(tempRoot, 'backups');
    mkdirSync(featuresDir);
    writeFileSync(join(featuresDir, 'foo.md'), 'foo', 'utf8');
    writeFileSync(join(featuresDir, 'README.txt'), 'readme', 'utf8');

    const backupDir = backupFeatures(featuresDir, backupRoot);

    expect(existsSync(join(backupDir, 'foo.md'))).toBe(true);
    expect(existsSync(join(backupDir, 'README.txt'))).toBe(false);
  });
});

function makeStandaloneRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-standalone-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor', 'config.json'),
    JSON.stringify({
      consumer: {
        name: 'acme',
        repoUrl: 'https://github.com/x/y',
        lockstepPackages: ['package.json'],
        scanPaths: [],
        boundaries: [],
        deprecatedPackages: [],
        e2ePrefix: '',
        samplesPath: '',
        packagePrefix: '',
        appPathPrefix: '',
      },
    }),
  );
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'widget.ts'), 'export const widget = 1;\n');
  writeFileSync(join(dir, 'src', 'widget.test.ts'), 'export {};\n');
  return dir;
}

describe('collectCandidateFiles', () => {
  // Regression: the hardcoded packages/apps/scripts trio saw nothing on a
  // standalone src/ layout, so the gap filler silently proposed nothing.
  it('sees a standalone src/ layout via the scanRoots union (empty scanPaths)', async () => {
    const dir = makeStandaloneRepo();
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const files = await collectCandidateFiles(new Set());
      expect(files).toEqual(['src/widget.ts']);
    } finally {
      process.chdir(previousCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops files already referenced in some FD links.code', async () => {
    const dir = makeStandaloneRepo();
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const files = await collectCandidateFiles(new Set(['src/widget.ts']));
      expect(files).toEqual([]);
    } finally {
      process.chdir(previousCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('collectTestOwners', () => {
  it("maps each file a tagged test imports to the test's @tests slugs", async () => {
    const dir = makeStandaloneRepo();
    mkdirSync(join(dir, 'src', '__tests__'));
    writeFileSync(
      join(dir, 'src', '__tests__', 'widget.test.ts'),
      "// @tests: widget-fd\n\nimport { widget } from '../widget.js';\n",
    );
    writeFileSync(join(dir, 'src', '__tests__', 'untagged.test.ts'), "import '../gadget.js';\n");
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const owners = await collectTestOwners();
      expect(owners.get('src/widget.ts')).toEqual(['widget-fd']);
      expect(owners.has('src/gadget.ts')).toBe(false);

      // Deletion test from Q-0173: a repo with a known unreferenced file
      // yields a non-empty candidate list for it.
      const [file] = await collectCandidateFiles(new Set());
      const matches = resolveByPath({
        filePath: file,
        features: [
          {
            slug: 'widget-fd',
            frontmatter: { ...fmBase, area: 'tooling', name: 'W', packages: [] },
          },
        ],
        appPathPrefix: '',
        testOwners: owners,
      });
      expect(matches.map((m) => m.fdSlug)).toEqual(['widget-fd']);
    } finally {
      process.chdir(previousCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
