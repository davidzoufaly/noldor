// @tests: feature-md-links-overhaul, sdd-co-tag-detector

import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  buildGateComplianceSection,
  compareSemver,
  detectCodeOrphans,
  detectDoneFeaturesMissingCode,
  detectDoneFeaturesMissingIntroduced,
  detectDoneFeaturesWithoutDocs,
  detectDoneFeaturesWithoutTests,
  detectFeaturesWithoutSpec,
  detectMissingCoTags,
  detectPlansWithoutSpec,
  detectReadmePackageDrift,
  detectSpecsWithoutFeatures,
  detectStaleBacklog,
  detectUntaggedDocs,
  detectUntaggedTests,
  detectUntriagedIdeas,
  extractPlanSlug,
  extractSpecSlug,
  isInfraFile,
  isLinkEnforced,
  resolveReportOutPath,
} from '../sdd-report.js';
import type { FeatureRecord } from '../sdd-report.js';

import type { FeatureFrontmatter } from '../../features/feature-schema.js';
import type { BacklogEntry } from '../../utils/parse-blocks.js';

const fmDoneNoTests: FeatureFrontmatter = {
  area: 'example',
  category: 'Other',
  deps: [],
  introduced: '0.2.0',
  links: { code: ['x.ts'], docs: ['x.md'], spec: 'x', tests: [] },
  name: 'Done No Tests',
  packages: ['format'],
  phase: 'done',
  'noldor-tier': 'specs-only',
};

const fmClean: FeatureFrontmatter = {
  ...fmDoneNoTests,
  links: { ...fmDoneNoTests.links, tests: ['x.test.ts'] },
  name: 'Clean',
};

describe(detectDoneFeaturesWithoutTests, () => {
  it('flags done features whose links.tests is empty', async () => {
    const gaps = await detectDoneFeaturesWithoutTests([
      { frontmatter: fmDoneNoTests, slug: 'done-no-tests' },
      { frontmatter: fmClean, slug: 'clean' },
    ]);
    expect(gaps.map((g) => g.itemId)).toStrictEqual(['done-no-tests']);
  });

  it('returns empty when all done features have tests', async () => {
    const gaps = await detectDoneFeaturesWithoutTests([{ frontmatter: fmClean, slug: 'clean' }]);
    expect(gaps).toStrictEqual([]);
  });

  it('exempts features whose links.tests contains the n/a sentinel', async () => {
    const fm = {
      ...fmDoneNoTests,
      links: { ...fmDoneNoTests.links, tests: ['n/a'] },
    };
    const gaps = await detectDoneFeaturesWithoutTests([{ frontmatter: fm, slug: 'opt-out' }]);
    expect(gaps).toStrictEqual([]);
  });
});

describe(detectDoneFeaturesWithoutDocs, () => {
  it('flags done features whose links.docs is empty', async () => {
    const fm = { ...fmClean, links: { ...fmClean.links, docs: [] } };
    const gaps = await detectDoneFeaturesWithoutDocs([{ frontmatter: fm, slug: 'no-docs' }]);
    expect(gaps.map((g) => g.itemId)).toStrictEqual(['no-docs']);
  });

  it('exempts category: Tooling (internal devloop features)', async () => {
    const fm = {
      ...fmClean,
      category: 'Tooling' as const,
      links: { ...fmClean.links, docs: [] },
    };
    const gaps = await detectDoneFeaturesWithoutDocs([{ frontmatter: fm, slug: 'tooling-feat' }]);
    expect(gaps).toStrictEqual([]);
  });

  it('exempts features whose links.docs contains the n/a sentinel', async () => {
    const fm = { ...fmClean, links: { ...fmClean.links, docs: ['n/a'] } };
    const gaps = await detectDoneFeaturesWithoutDocs([{ frontmatter: fm, slug: 'opt-out' }]);
    expect(gaps).toStrictEqual([]);
  });
});

describe(detectDoneFeaturesMissingCode, () => {
  it('flags done features whose links.code is empty', async () => {
    const fmDoneNoCode: FeatureFrontmatter = {
      ...fmDoneNoTests,
      links: { ...fmDoneNoTests.links, code: [], tests: ['x.test.ts'] },
      name: 'Done No Code',
    };
    const gaps = await detectDoneFeaturesMissingCode([
      { frontmatter: fmDoneNoCode, slug: 'done-no-code' },
      { frontmatter: fmClean, slug: 'clean' },
    ]);
    expect(gaps.map((g) => g.itemId)).toStrictEqual(['done-no-code']);
  });

  it('exempts features with the n/a sentinel in links.code', async () => {
    const fm: FeatureFrontmatter = {
      ...fmDoneNoTests,
      links: { ...fmDoneNoTests.links, code: ['n/a'], tests: ['x.test.ts'] },
    };
    const gaps = await detectDoneFeaturesMissingCode([{ frontmatter: fm, slug: 'opt-out' }]);
    expect(gaps).toStrictEqual([]);
  });

  it('skips in-progress features', async () => {
    const fm: FeatureFrontmatter = {
      ...fmDoneNoTests,
      links: { ...fmDoneNoTests.links, code: [] },
      phase: 'in-progress',
    };
    const gaps = await detectDoneFeaturesMissingCode([{ frontmatter: fm, slug: 'wip' }]);
    expect(gaps).toStrictEqual([]);
  });

  it('exempts pre-MVP grandfathered features', async () => {
    const fm: FeatureFrontmatter = {
      ...fmDoneNoTests,
      introduced: '0.1.0',
      links: { ...fmDoneNoTests.links, code: [] },
    };
    const gaps = await detectDoneFeaturesMissingCode([{ frontmatter: fm, slug: 'pre-mvp' }]);
    expect(gaps).toStrictEqual([]);
  });
});

describe(detectFeaturesWithoutSpec, () => {
  it('flags full features without links.spec set', async () => {
    const fm = {
      ...fmClean,
      'noldor-tier': 'full' as const,
      links: { ...fmClean.links, spec: undefined },
    };
    const gaps = await detectFeaturesWithoutSpec([{ frontmatter: fm, slug: 'no-spec' }]);
    expect(gaps.map((g) => g.itemId)).toStrictEqual(['no-spec']);
  });

  it('does not flag specs-only features without links.spec set', async () => {
    const fm = { ...fmClean, links: { ...fmClean.links, spec: undefined } };
    const gaps = await detectFeaturesWithoutSpec([{ frontmatter: fm, slug: 'no-spec' }]);
    expect(gaps).toStrictEqual([]);
  });

  it('passes when spec is set', async () => {
    const gaps = await detectFeaturesWithoutSpec([{ frontmatter: fmClean, slug: 'clean' }]);
    expect(gaps).toStrictEqual([]);
  });
});

describe(detectDoneFeaturesMissingIntroduced, () => {
  it('flags done features without introduced', async () => {
    const fm = { ...fmClean, introduced: undefined };
    const gaps = await detectDoneFeaturesMissingIntroduced([
      { frontmatter: fm, slug: 'no-introduced' },
    ]);
    expect(gaps.map((g) => g.itemId)).toStrictEqual(['no-introduced']);
  });

  it('does not flag in-progress features', async () => {
    const fm = {
      ...fmClean,
      introduced: undefined,
      phase: 'in-progress' as const,
    };
    const gaps = await detectDoneFeaturesMissingIntroduced([{ frontmatter: fm, slug: 'wip' }]);
    expect(gaps).toStrictEqual([]);
  });
});

describe(detectUntriagedIdeas, () => {
  it('returns each top-level bullet without [triaged …] marker', () => {
    const ideas = `# Ideas

## Verticals

### Business

#### Next

- still raw
- raw [triaged 2026-04-27 → cloud-sync]
`;
    const gaps = detectUntriagedIdeas(ideas);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.itemId).toBe('ideas.md:9');
  });
});

describe(detectStaleBacklog, () => {
  it('flags entries whose since is older than threshold', () => {
    const today = new Date('2026-04-27');
    const entries: BacklogEntry[] = [
      {
        area: 'persistence',
        description: 'x',
        name: 'Old',
        slug: 'old',
        since: '2026-01-01',
      },
      {
        area: 'persistence',
        description: 'x',
        name: 'Fresh',
        slug: 'fresh',
        since: '2026-04-20',
      },
    ];
    const gaps = detectStaleBacklog(entries, 90, today);
    expect(gaps.map((g) => g.itemId)).toStrictEqual(['Old']);
  });

  it('skips entries without a since field', () => {
    const today = new Date('2026-04-27');
    const entries: BacklogEntry[] = [
      {
        area: 'persistence',
        description: 'x',
        name: 'NoSince',
        slug: 'nosince',
      },
    ];
    expect(detectStaleBacklog(entries, 90, today)).toStrictEqual([]);
  });
});

describe(detectSpecsWithoutFeatures, () => {
  it('flags spec files not referenced by any feature links.spec, excluding meta specs', () => {
    const allSpecPaths = [
      'docs/superpowers/specs/2026-04-21-product-dev-framework-brainstorm.md',
      'docs/superpowers/specs/2026-04-23-feature-md-framework-design.md',
      'docs/superpowers/specs/2026-05-01-orphan.md',
    ];
    const features: FeatureRecord[] = [
      {
        frontmatter: {
          ...fmClean,
          links: {
            ...fmClean.links,
            spec: 'docs/superpowers/specs/2026-04-23-feature-md-framework-design.md',
          },
        },
        slug: 'a',
      },
    ];
    const gaps = detectSpecsWithoutFeatures(allSpecPaths, features);
    expect(gaps.map((g) => g.itemId)).toStrictEqual([
      'docs/superpowers/specs/2026-05-01-orphan.md',
    ]);
  });
});

describe(extractSpecSlug, () => {
  it('strips YYYY-MM-DD- prefix and -design suffix', () => {
    expect(extractSpecSlug('2026-04-15-editor-shell-design.md')).toBe('editor-shell');
    expect(extractSpecSlug('2026-04-14-engine-design.md')).toBe('engine');
  });

  it('handles spec without -design suffix', () => {
    expect(extractSpecSlug('2026-04-14-engine.md')).toBe('engine');
  });
});

describe(extractPlanSlug, () => {
  it('strips YYYY-MM-DD- prefix and plan\\d+- prefix', () => {
    expect(extractPlanSlug('2026-04-14-plan2-engine.md')).toBe('engine');
    expect(extractPlanSlug('2026-04-14-plan1-monorepo-format.md')).toBe('monorepo-format');
  });

  it('strips date prefix only when no plan-N prefix', () => {
    expect(extractPlanSlug('2026-04-15-editor-shell.md')).toBe('editor-shell');
  });

  it('strips trailing -partN so split plans match the base spec slug', () => {
    expect(extractPlanSlug('2026-04-23-feature-md-framework-part1.md')).toBe(
      'feature-md-framework',
    );
    expect(extractPlanSlug('2026-04-27-docs-generation-part3.md')).toBe('docs-generation');
  });

  it('strips both plan-N prefix and -partN suffix together', () => {
    expect(extractPlanSlug('2026-04-14-plan2-engine-part1.md')).toBe('engine');
  });
});

describe(detectPlansWithoutSpec, () => {
  it('flags plan files whose slug has no matching spec', () => {
    const planPaths = [
      'docs/superpowers/plans/2026-04-14-plan2-engine.md',
      'docs/superpowers/plans/2026-04-15-zombie.md',
    ];
    const specPaths = ['docs/superpowers/specs/2026-04-14-engine-design.md'];
    const gaps = detectPlansWithoutSpec(planPaths, specPaths);
    expect(gaps.map((g) => g.itemId)).toStrictEqual([
      'docs/superpowers/plans/2026-04-15-zombie.md',
    ]);
  });

  it('returns empty when every plan slug matches some spec', () => {
    const planPaths = ['docs/superpowers/plans/2026-04-15-editor-shell.md'];
    const specPaths = ['docs/superpowers/specs/2026-04-15-editor-shell-design.md'];
    expect(detectPlansWithoutSpec(planPaths, specPaths)).toStrictEqual([]);
  });
});

describe(detectCodeOrphans, () => {
  it('flags .ts files not referenced and not in ignore patterns', () => {
    const allPaths = [
      'packages/format/src/types.ts',
      'packages/format/src/orphan.ts',
      'packages/format/src/__tests__/types.test.ts',
      'packages/test-fixtures/src/scenes/single-box.json',
    ];
    const features: FeatureRecord[] = [
      {
        frontmatter: {
          ...fmClean,
          links: { ...fmClean.links, code: ['packages/format/src/types.ts'] },
        },
        slug: 'a',
      },
    ];
    const gaps = detectCodeOrphans(allPaths, features);
    expect(gaps.map((g) => g.itemId)).toStrictEqual(['packages/format/src/orphan.ts']);
  });

  it('treats a directory entry (no trailing slash) as covering every nested file', () => {
    const allPaths = [
      'packages/sample-scenes/src/empty-room.ts',
      'packages/sample-scenes/src/index.ts',
      'packages/sample-scenes/src/manifest.ts',
      'packages/orphan/src/foo.ts',
    ];
    const features: FeatureRecord[] = [
      {
        frontmatter: {
          ...fmClean,
          links: { ...fmClean.links, code: ['packages/sample-scenes'] },
        },
        slug: 'gallery',
      },
    ];
    const gaps = detectCodeOrphans(allPaths, features);
    expect(gaps.map((g) => g.itemId)).toStrictEqual(['packages/orphan/src/foo.ts']);
  });

  it('treats a directory entry with trailing slash as covering every nested file', () => {
    const allPaths = ['packages/sample-scenes/src/empty-room.ts'];
    const features: FeatureRecord[] = [
      {
        frontmatter: {
          ...fmClean,
          links: { ...fmClean.links, code: ['packages/sample-scenes/'] },
        },
        slug: 'gallery',
      },
    ];
    expect(detectCodeOrphans(allPaths, features)).toStrictEqual([]);
  });

  it('appends probable-owner suggestion when graph is fresh and orphan shares community with owned files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orphan-suggest-'));
    try {
      const graphPath = join(dir, 'graph.json');
      writeFileSync(
        graphPath,
        JSON.stringify({
          nodes: [
            {
              id: 'orphan',
              source_file: 'packages/a/src/orphan.ts',
              source_location: 'L1',
              community: 5,
            },
            {
              id: 'sib1',
              source_file: 'packages/a/src/owned.ts',
              source_location: 'L1',
              community: 5,
            },
          ],
          links: [],
        }),
      );
      const future = new Date(Date.now() + 60_000);
      utimesSync(graphPath, future, future);
      writeFileSync(join(dir, 'src.ts'), 'x');
      const past = new Date(Date.now() - 120_000);
      utimesSync(join(dir, 'src.ts'), past, past);

      const allPaths = ['packages/a/src/orphan.ts', 'packages/a/src/owned.ts'];
      const features: FeatureRecord[] = [
        {
          frontmatter: {
            ...fmClean,
            links: { ...fmClean.links, code: ['packages/a/src/owned.ts'] },
          },
          slug: 'fd-owner',
        },
      ];
      const gaps = detectCodeOrphans(allPaths, features, {
        graphPath,
        srcRoots: [dir],
      });
      expect(gaps).toHaveLength(1);
      expect(gaps[0].itemId).toBe('packages/a/src/orphan.ts');
      expect(gaps[0].message).toMatch(/probable owner: fd-owner/);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('omits probable-owner suggestion when graph is stale (degraded mode)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orphan-stale-'));
    try {
      const graphPath = join(dir, 'graph.json');
      writeFileSync(graphPath, '{"nodes":[],"links":[]}');
      const past = new Date(Date.now() - 60_000);
      utimesSync(graphPath, past, past);
      writeFileSync(join(dir, 'src.ts'), 'x');

      const allPaths = ['packages/a/src/orphan.ts'];
      const features: FeatureRecord[] = [
        {
          frontmatter: {
            ...fmClean,
            links: { ...fmClean.links, code: ['packages/a/src/other.ts'] },
          },
          slug: 'fd-other',
        },
      ];
      const gaps = detectCodeOrphans(allPaths, features, {
        graphPath,
        srcRoots: [dir],
      });
      expect(gaps).toHaveLength(1);
      expect(gaps[0].message).not.toMatch(/probable owner:/);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe(detectUntaggedTests, () => {
  it('flags test files whose first non-import line lacks // @tests:', () => {
    const inputs = [
      {
        content: '// @tests: foo\nimport x;\n',
        path: 'packages/x/src/__tests__/a.test.ts',
      },
      { content: 'import x;\n', path: 'packages/x/src/__tests__/b.test.ts' },
    ];
    const gaps = detectUntaggedTests(inputs);
    expect(gaps.map((g) => g.itemId)).toStrictEqual(['packages/x/src/__tests__/b.test.ts']);
  });

  it('does not apply the validator-hard-fail tag rule to script tests', () => {
    const gaps = detectUntaggedTests([
      {
        content: 'import x;\n',
        path: 'scripts/migration/__tests__/classify.test.ts',
      },
    ]);
    expect(gaps).toStrictEqual([]);
  });

  it('appends suggested slugs when graph is fresh and test imports owned files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'untag-suggest-'));
    try {
      const graphPath = join(dir, 'graph.json');
      writeFileSync(
        graphPath,
        JSON.stringify({
          nodes: [
            {
              id: 'test_a',
              source_file: 'packages/a/__tests__/x.test.ts',
              source_location: 'L1',
            },
            {
              id: 'src_a',
              source_file: 'packages/a/src/x.ts',
              source_location: 'L1',
            },
          ],
          links: [{ source: 'test_a', target: 'src_a', relation: 'imports_from' }],
        }),
      );
      const future = new Date(Date.now() + 60_000);
      utimesSync(graphPath, future, future);
      writeFileSync(join(dir, 'src.ts'), 'x');
      const past = new Date(Date.now() - 120_000);
      utimesSync(join(dir, 'src.ts'), past, past);

      const features: FeatureRecord[] = [feature('fd-a', ['packages/a/src/x.ts'])];
      const inputs = [{ content: 'import x;\n', path: 'packages/a/__tests__/x.test.ts' }];
      const gaps = detectUntaggedTests(inputs, {
        features,
        graphPath,
        srcRoots: [dir],
      });
      expect(gaps).toHaveLength(1);
      expect(gaps[0].itemId).toBe('packages/a/__tests__/x.test.ts');
      expect(gaps[0].message).toMatch(/suggested: fd-a/);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('omits suggestion when graph is stale (degraded mode)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'untag-stale-'));
    try {
      const graphPath = join(dir, 'graph.json');
      writeFileSync(graphPath, '{"nodes":[],"links":[]}');
      const past = new Date(Date.now() - 60_000);
      utimesSync(graphPath, past, past);
      writeFileSync(join(dir, 'src.ts'), 'x');

      const inputs = [{ content: 'import x;\n', path: 'packages/a/__tests__/x.test.ts' }];
      const gaps = detectUntaggedTests(inputs, {
        features: [],
        graphPath,
        srcRoots: [dir],
      });
      expect(gaps).toHaveLength(1);
      expect(gaps[0].message).not.toMatch(/suggested:/);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe(detectUntaggedDocs, () => {
  it('flags tutorial/explanation files lacking <!-- @feature: -->', () => {
    const inputs = [
      {
        content: '<!-- @feature: foo -->\n# A\n',
        path: 'docs/user/tutorials/a.md',
      },
      { content: '# B\n\nbody\n', path: 'docs/user/explanation/b.md' },
    ];
    const gaps = detectUntaggedDocs(inputs);
    expect(gaps.map((g) => g.itemId)).toStrictEqual(['docs/user/explanation/b.md']);
  });
});

describe(compareSemver, () => {
  it('orders by major, minor, patch', () => {
    expect(compareSemver('0.1.0', '0.2.0')).toBeLessThan(0);
    expect(compareSemver('0.2.0', '0.1.0')).toBeGreaterThan(0);
    expect(compareSemver('0.2.0', '0.2.0')).toBe(0);
    expect(compareSemver('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });
});

describe(isLinkEnforced, () => {
  it('exempts pre-MIN_ENFORCED_VERSION done features (grandfathered)', () => {
    const fm: FeatureFrontmatter = { ...fmDoneNoTests, introduced: '0.1.0' };
    expect(isLinkEnforced({ frontmatter: fm, slug: 'pre-mvp' })).toBeFalsy();
  });

  it('enforces MIN_ENFORCED_VERSION and above', () => {
    expect(isLinkEnforced({ frontmatter: fmDoneNoTests, slug: 'a' })).toBeTruthy();
  });

  it('always enforces in-progress features', () => {
    const fm: FeatureFrontmatter = {
      ...fmDoneNoTests,
      introduced: undefined,
      phase: 'in-progress',
    };
    expect(isLinkEnforced({ frontmatter: fm, slug: 'wip' })).toBeTruthy();
  });
});

describe('grandfathering of pre-MVP features', () => {
  const preMvp: FeatureRecord = {
    frontmatter: {
      ...fmDoneNoTests,
      introduced: '0.1.0',
      links: { ...fmDoneNoTests.links, spec: undefined },
    },
    slug: 'pre-mvp',
  };

  it('detectFeaturesWithoutSpec skips pre-MVP', async () => {
    await expect(detectFeaturesWithoutSpec([preMvp])).resolves.toStrictEqual([]);
  });

  it('detectCodeOrphans short-circuits when every done feature is pre-MVP', () => {
    const allPaths = ['packages/format/src/orphan.ts'];
    expect(detectCodeOrphans(allPaths, [preMvp])).toStrictEqual([]);
  });
});

describe(detectReadmePackageDrift, () => {
  // Hermetic config so the test does not depend on the live consumer config.
  const cfg = { packagePrefix: '@charuy/', deprecatedPackages: ['@charuy/agent-api'] };
  const readmeWithFour = `## Architecture
### Packages

| Package | Purpose | Status |
|---------|---------|--------|
| \`@charuy/format\` | x | Done |
| \`@charuy/engine\` | x | Done |
| \`@charuy/viewport\` | x | Done |
| \`@charuy/agent-api\` | y | Planned |
`;

  it('flags packages on disk missing from README table', () => {
    const actual = [
      '@charuy/format',
      '@charuy/engine',
      '@charuy/viewport',
      '@charuy/test-fixtures',
    ];
    const gaps = detectReadmePackageDrift(actual, readmeWithFour, cfg);
    expect(gaps.map((g) => g.itemId)).toStrictEqual(['@charuy/test-fixtures']);
  });

  it('flags README rows whose package directory does not exist', () => {
    const actual = ['@charuy/format', '@charuy/engine'];
    const gaps = detectReadmePackageDrift(actual, readmeWithFour, cfg);
    expect(gaps.map((g) => g.itemId)).toStrictEqual(['@charuy/viewport']);
  });

  it('treats @charuy/agent-api as allowed-planned even if absent from disk', () => {
    const actual = ['@charuy/format', '@charuy/engine', '@charuy/viewport'];
    const gaps = detectReadmePackageDrift(actual, readmeWithFour, cfg);
    expect(gaps).toStrictEqual([]);
  });

  it('returns no gaps when README and disk agree', () => {
    const readme = `### Packages

| Package | Purpose | Status |
|---------|---------|--------|
| \`@charuy/format\` | x | Done |
| \`@charuy/engine\` | x | Done |
`;
    const gaps = detectReadmePackageDrift(['@charuy/format', '@charuy/engine'], readme, cfg);
    expect(gaps).toStrictEqual([]);
  });
});

describe('sdd:report --json', () => {
  it('emits a JSON array of {category, itemId, message} on stdout', () => {
    const out = execSync('tsx src/garden/sdd-report.ts --json', {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out) as {
      category: string;
      itemId: string;
      message: string;
    }[];
    expect(Array.isArray(parsed)).toBeTruthy();
    if (parsed.length > 0) {
      expect(parsed[0]).toHaveProperty('category');
      expect(parsed[0]).toHaveProperty('itemId');
      expect(parsed[0]).toHaveProperty('message');
    }
  });
});

describe('sdd:report markdown output', () => {
  // Tests in this describe invoke the real CLI. The `--out <tmp>` flag points
  // each invocation at a tmpdir-scoped path so the live `docs/sdd-report.md`
  // is never mutated — running `pnpm test` no longer dirties the working
  // tree, which previously broke `pnpm release`'s clean-tree precondition.
  let tmpDir: string;
  let outPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sdd-report-'));
    outPath = join(tmpDir, 'sdd-report.md');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes oxfmt-compliant markdown (no extra fmt pass needed)', () => {
    execSync(`tsx src/garden/sdd-report.ts --out ${outPath}`, {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const result = execSync(`pnpm --silent fmt:check ${outPath}`, {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(result).toContain('use the correct format');
  });

  it('omits Gate compliance section by default (review-skip counter only shipped at release)', () => {
    execSync(`tsx src/garden/sdd-report.ts --out ${outPath}`, {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const md = readFileSync(outPath, 'utf8');
    expect(md).not.toMatch(/## Gate compliance/);
    expect(md).not.toMatch(/Review-skip count/);
    expect(md).not.toMatch(/Noldor-Reviewed.* trailer/);
  });

  it('includes Gate compliance section when --release flag is passed', () => {
    execSync(`tsx src/garden/sdd-report.ts --release --out ${outPath}`, {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const md = readFileSync(outPath, 'utf8');
    expect(md).toMatch(/## Gate compliance/);
    expect(md).toMatch(/Review-skip count/);
  });
});

describe(resolveReportOutPath, () => {
  it('returns the value following `--out` when present', () => {
    expect(resolveReportOutPath(['--out', '/tmp/x.md'], {})).toBe('/tmp/x.md');
  });

  it('falls back to CHARUY_SDD_REPORT_OUT when --out is absent', () => {
    expect(resolveReportOutPath([], { CHARUY_SDD_REPORT_OUT: '/tmp/y.md' })).toBe('/tmp/y.md');
  });

  it('defaults to docs/sdd-report.md when no override is supplied', () => {
    expect(resolveReportOutPath([], {})).toBe('docs/sdd-report.md');
  });

  it('prefers --out over the env var when both are present', () => {
    expect(
      resolveReportOutPath(['--out', '/tmp/flag.md'], {
        CHARUY_SDD_REPORT_OUT: '/tmp/env.md',
      }),
    ).toBe('/tmp/flag.md');
  });
});

describe('isInfraFile', () => {
  it.each([
    'vitest.config.ts',
    'vite.config.ts',
    'playwright.config.ts',
    'eslint.config.ts',
    'tsdown.config.mjs',
    'oxfmt.config.js',
    'tsconfig.json',
    'tsconfig.build.json',
    'tsconfig.eslint.json',
    'lefthook.yml',
    'lefthook.yaml',
  ])('returns true for %s', (name) => {
    expect(isInfraFile(`some/path/${name}`)).toBe(true);
  });

  it.each([
    'index.ts',
    'mesh.ts',
    'foo.tsx',
    'vite-env-not-really.ts',
    'mesh.config.tsx',
    'package.json',
    'README.md',
  ])('returns false for %s', (name) => {
    expect(isInfraFile(`some/path/${name}`)).toBe(false);
  });

  it('returns true for vite-env.d.ts', () => {
    expect(isInfraFile('apps/web/src/vite-env.d.ts')).toBe(true);
  });
});

function makeFm(slug: string, code: string[]): FeatureFrontmatter {
  return {
    area: 'engine',
    category: 'Modeling',
    deps: [],
    links: { code, docs: [], spec: 's', tests: [] },
    name: slug,
    packages: ['engine'],
    phase: 'done',
    'noldor-tier': 'specs-only',
  };
}

function feature(slug: string, code: string[]): FeatureRecord {
  return { frontmatter: makeFm(slug, code), slug };
}

describe(detectMissingCoTags, () => {
  function withGraphTmp<T>(fn: (ctx: { dir: string; graphPath: string }) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'cotag-'));
    try {
      const graphPath = join(dir, 'graph.json');
      return fn({ dir, graphPath });
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  }

  function writeFreshGraph(graphPath: string, dir: string, payload: object): void {
    writeFileSync(graphPath, JSON.stringify(payload));
    // Ensure graph mtime > any source file in dir
    const future = new Date(Date.now() + 60_000);
    utimesSync(graphPath, future, future);
    // Touch dir parent to avoid empty-roots edge
    writeFileSync(join(dir, 'src.ts'), 'x');
    const past = new Date(Date.now() - 120_000);
    utimesSync(join(dir, 'src.ts'), past, past);
  }

  it('returns 0 gaps when test fully co-tags every imported FD', () => {
    withGraphTmp(({ dir, graphPath }) => {
      writeFreshGraph(graphPath, dir, {
        nodes: [
          {
            id: 'pkg_a_test',
            source_file: 'packages/a/src/__tests__/foo.test.ts',
            source_location: 'L1',
          },
          {
            id: 'pkg_a_src',
            source_file: 'packages/a/src/foo.ts',
            source_location: 'L1',
          },
        ],
        links: [
          {
            source: 'pkg_a_test',
            target: 'pkg_a_src',
            relation: 'imports_from',
          },
        ],
      });
      const features = [feature('foo', ['packages/a/src/foo.ts'])];
      const testInputs = [
        {
          content: '// @tests: foo\nimport "x";',
          path: 'packages/a/src/__tests__/foo.test.ts',
        },
      ];
      const gaps = detectMissingCoTags(features, testInputs, graphPath, [dir]);
      expect(gaps).toEqual([]);
    });
  });

  it('flags a test missing one co-tag', () => {
    withGraphTmp(({ dir, graphPath }) => {
      writeFreshGraph(graphPath, dir, {
        nodes: [
          {
            id: 'pkg_a_test',
            source_file: 'packages/a/src/__tests__/foo.test.ts',
            source_location: 'L1',
          },
          {
            id: 'pkg_a_src',
            source_file: 'packages/a/src/foo.ts',
            source_location: 'L1',
          },
        ],
        links: [
          {
            source: 'pkg_a_test',
            target: 'pkg_a_src',
            relation: 'imports_from',
          },
        ],
      });
      const features = [
        feature('foo', ['packages/a/src/foo.ts']),
        feature('meta', ['packages/a/src/foo.ts']),
      ];
      const testInputs = [
        {
          content: '// @tests: foo\nimport "x";',
          path: 'packages/a/src/__tests__/foo.test.ts',
        },
      ];
      const gaps = detectMissingCoTags(features, testInputs, graphPath, [dir]);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].itemId).toBe('packages/a/src/__tests__/foo.test.ts');
      expect(gaps[0].message).toMatch(/add: meta/);
    });
  });

  it('skips e2e files under apps/web/e2e/', () => {
    withGraphTmp(({ dir, graphPath }) => {
      writeFreshGraph(graphPath, dir, {
        nodes: [
          {
            id: 'e2e_test',
            source_file: 'apps/web/e2e/scenarios/foo.spec.ts',
            source_location: 'L1',
          },
          {
            id: 'pkg_a_src',
            source_file: 'packages/a/src/foo.ts',
            source_location: 'L1',
          },
        ],
        links: [{ source: 'e2e_test', target: 'pkg_a_src', relation: 'imports_from' }],
      });
      const features = [feature('foo', ['packages/a/src/foo.ts'])];
      const testInputs = [
        {
          content: '// @tests: foo',
          path: 'apps/web/e2e/scenarios/foo.spec.ts',
        },
      ];
      const gaps = detectMissingCoTags(features, testInputs, graphPath, [dir]);
      expect(gaps).toEqual([]);
    });
  });

  it('emits stale meta-gap when graph predates source mtime', () => {
    withGraphTmp(({ dir, graphPath }) => {
      writeFileSync(graphPath, '{"nodes":[],"links":[]}');
      const past = new Date(Date.now() - 60_000);
      utimesSync(graphPath, past, past);
      writeFileSync(join(dir, 'src.ts'), 'x');
      const gaps = detectMissingCoTags([], [], graphPath, [dir]);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].category).toBe('Tests with incomplete co-tag');
      expect(gaps[0].message).toMatch(/degraded mode/);
    });
  });

  it('FD with empty links.code is silently invisible (no gap, no candidate)', () => {
    withGraphTmp(({ dir, graphPath }) => {
      writeFreshGraph(graphPath, dir, {
        nodes: [
          {
            id: 'pkg_a_test',
            source_file: 'packages/a/src/__tests__/foo.test.ts',
            source_location: 'L1',
          },
          {
            id: 'pkg_a_src',
            source_file: 'packages/a/src/foo.ts',
            source_location: 'L1',
          },
        ],
        links: [
          {
            source: 'pkg_a_test',
            target: 'pkg_a_src',
            relation: 'imports_from',
          },
        ],
      });
      const features = [feature('empty-code', [])];
      const testInputs = [
        {
          content: '// @tests: empty-code',
          path: 'packages/a/src/__tests__/foo.test.ts',
        },
      ];
      const gaps = detectMissingCoTags(features, testInputs, graphPath, [dir]);
      expect(gaps).toEqual([]);
    });
  });

  it('flags multi-FD miss with both slugs in sorted order', () => {
    withGraphTmp(({ dir, graphPath }) => {
      writeFreshGraph(graphPath, dir, {
        nodes: [
          {
            id: 'pkg_a_test',
            source_file: 'packages/a/src/__tests__/foo.test.ts',
            source_location: 'L1',
          },
          {
            id: 'src_x',
            source_file: 'packages/a/src/x.ts',
            source_location: 'L1',
          },
          {
            id: 'src_y',
            source_file: 'packages/a/src/y.ts',
            source_location: 'L1',
          },
        ],
        links: [
          { source: 'pkg_a_test', target: 'src_x', relation: 'imports_from' },
          { source: 'pkg_a_test', target: 'src_y', relation: 'imports_from' },
        ],
      });
      const features = [
        feature('zeta', ['packages/a/src/x.ts']),
        feature('alpha', ['packages/a/src/y.ts']),
      ];
      const testInputs = [
        {
          content: '// @tests: other',
          path: 'packages/a/src/__tests__/foo.test.ts',
        },
      ];
      const gaps = detectMissingCoTags(features, testInputs, graphPath, [dir]);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].message).toMatch(/add: alpha, zeta/);
    });
  });
});

describe('buildGateComplianceSection', () => {
  let repo: string;

  function makeGitRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'gate-compliance-'));
    execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', {
      cwd: dir,
      stdio: 'ignore',
    });
    execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
    return dir;
  }

  function commit(dir: string, msg: string): void {
    const msgFile = join(dir, '.commitmsg');
    writeFileSync(join(dir, `${Date.now()}-${Math.random()}.txt`), msg);
    writeFileSync(msgFile, msg);
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync(`git commit -F ${JSON.stringify(msgFile)}`, {
      cwd: dir,
      stdio: 'ignore',
    });
  }

  function commitTouchingPaths(dir: string, msg: string, paths: string[]): void {
    const msgFile = join(dir, '.commitmsg');
    for (const rel of paths) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, `${msg}-${rel}`);
    }
    writeFileSync(msgFile, msg);
    execSync(`git add ${paths.map((p) => JSON.stringify(p)).join(' ')}`, {
      cwd: dir,
      stdio: 'ignore',
    });
    execSync(`git commit -F ${JSON.stringify(msgFile)}`, {
      cwd: dir,
      stdio: 'ignore',
    });
  }

  beforeEach(() => {
    repo = makeGitRepo();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const fmPlanOnly: FeatureFrontmatter = {
    ...fmDoneNoTests,
    'noldor-tier': 'specs-only',
  };

  const fmFull: FeatureFrontmatter = {
    ...fmDoneNoTests,
    'noldor-tier': 'full',
    links: {
      ...fmDoneNoTests.links,
      spec: 'docs/superpowers/specs/2026-01-01-foo-design.md',
    },
  };

  it('counts tier distribution correctly', () => {
    const features: FeatureRecord[] = [
      { slug: 'a', frontmatter: fmFull },
      { slug: 'b', frontmatter: fmPlanOnly },
      { slug: 'c', frontmatter: fmPlanOnly },
    ];
    const result = buildGateComplianceSection(features, repo);
    expect(result.tierDistribution.full).toBe(1);
    expect(result.tierDistribution.specsOnly).toBe(2);
  });

  it('detects override commits in the last 30 days', () => {
    commit(
      repo,
      'chore(noldor): cutover\n\nNoldor-Path-Override: rollout; gate not yet active\nNoldor-FD: gate-v1',
    );
    const result = buildGateComplianceSection([], repo);
    expect(result.overrides).toHaveLength(1);
    expect(result.overrides[0]!.reason).toBe('rollout; gate not yet active');
  });

  it('returns empty overrides when no override commits exist', () => {
    commit(repo, 'feat(foo): something\n\nNoldor-Path: fast-track');
    const result = buildGateComplianceSection([], repo);
    expect(result.overrides).toHaveLength(0);
  });

  it('counts review-skip: gated path with no Noldor-Reviewed trailer', () => {
    commit(repo, 'feat(foo): thing\n\nNoldor-Path: fast-track\nNoldor-FD: foo');
    const result = buildGateComplianceSection([], repo);
    expect(result.reviewSkipCount).toBe(1);
  });

  it('does not count as review-skip when Noldor-Reviewed is present', () => {
    commit(
      repo,
      'feat(foo): thing\n\nNoldor-Path: fast-track\nNoldor-FD: foo\nNoldor-Reviewed: true',
    );
    const result = buildGateComplianceSection([], repo);
    expect(result.reviewSkipCount).toBe(0);
  });

  it('does not count micro-chore or release-automation commits as review-skips', () => {
    commit(repo, 'docs(noldor): fix typo\n\nNoldor-Path: micro-chore');
    commit(repo, 'chore(release): v1.0.0\n\nNoldor-Path: release-automation');
    const result = buildGateComplianceSection([], repo);
    expect(result.reviewSkipCount).toBe(0);
    expect(result.overrides).toHaveLength(0);
  });

  it('skips override commits whose only touched file is docs/sdd-report.md', () => {
    commitTouchingPaths(repo, 'fix(garden): legit override\n\nNoldor-Path-Override: emergency', [
      'packages/noldor/src/garden/x.ts',
    ]);
    commitTouchingPaths(repo, 'chore(release): sdd-report drift\n\nNoldor-Path-Override: pass', [
      'docs/sdd-report.md',
    ]);
    const result = buildGateComplianceSection([], repo);
    expect(result.overrides).toHaveLength(1);
    expect(result.overrides[0]!.reason).toBe('emergency');
  });

  it('does not skip override commits that touch sdd-report.md alongside other files', () => {
    commitTouchingPaths(repo, 'chore(release): sdd-report + tidy\n\nNoldor-Path-Override: mixed', [
      'docs/sdd-report.md',
      'ideas.md',
    ]);
    const result = buildGateComplianceSection([], repo);
    expect(result.overrides).toHaveLength(1);
    expect(result.overrides[0]!.reason).toBe('mixed');
  });
});
