import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectContradictions,
  loadOverrideAuditOptions,
  detectInvariants,
  detectStalePlans,
  detectStaleSpecs,
  detectUnusedBacklog,
  hasBlockingFindings,
  shouldFlagSourceDrift,
  staleGraphGaps,
  SOURCE_DRIFT_PAIRS,
} from '../garden-detect.js';

import { specSlugFromFilename } from '../../core/design-artifact-names.js';

import type { GateComplianceFindings, StaleDesignArtifact } from '../garden-detect.js';

import type { RulePairInvariant as Invariant } from '../../invariants/rule-pairs.js';
import type { Invariant as ArchitectureInvariant } from '../../invariants/types.js';

// @tests: architecture-invariants, bootstrap-immunity-for-self-gating-features, dashboard-roadmap-drag-drop, doc-gardening-skill, framework-milestones-support-poc-mvp-100, graphify-plan-of-edges-nodes-for-plans-specs, noldor, outcome-telemetry-and-effectiveness-metrics, release-sweep-process-hardening

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), 'garden-'));
  await mkdir(join(root, 'docs/design/plans'), { recursive: true });
  await mkdir(join(root, 'docs/design/specs'), { recursive: true });
  await mkdir(join(root, 'docs/features'), { recursive: true });
  return root;
}

// --- Shared stale-design-artifact matrix (plans + specs) ---------------------
// detectStalePlans and detectStaleSpecs are two thin callers over one
// implementation, so the behavioural matrix runs against both kinds rather
// than drifting per kind (the coverage asymmetry Q-0116 measured).

interface ArtifactKindFixture {
  readonly label: string;
  readonly detect: (repo: string) => Promise<StaleDesignArtifact[]>;
  readonly relDir: string;
  /** Canonical filename for a dated artifact of this kind. */
  readonly fileName: (date: string, slug: string) => string;
  /** FD frontmatter field that names an artifact of this kind verbatim. */
  readonly linkField: 'plan' | 'spec';
  /** Enriched-graph edge from artifact node → owning FD node. */
  readonly relation: 'plan-of' | 'spec-of';
}

const ARTIFACT_KINDS: readonly ArtifactKindFixture[] = [
  {
    label: 'plans',
    detect: (repo) => detectStalePlans(repo),
    relDir: 'docs/design/plans',
    fileName: (date, slug) => `${date}-${slug}.md`,
    linkField: 'plan',
    relation: 'plan-of',
  },
  {
    label: 'specs',
    detect: (repo) => detectStaleSpecs(repo),
    relDir: 'docs/design/specs',
    fileName: (date, slug) => `${date}-${slug}-design.md`,
    linkField: 'spec',
    relation: 'spec-of',
  },
];

const OLD_DATE = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

function fd(opts: { name: string; phase: string; link?: string; linkField?: 'plan' | 'spec' }) {
  const link = opts.link ? `\n  ${opts.linkField}: ${opts.link}` : '';
  return `---
name: ${opts.name}
phase: ${opts.phase}
area: tooling
category: Tooling
packages: ['@acme/web']
'noldor-tier': specs-only
links:
  code: []
  tests: []
  docs: []${link}
---

body
`;
}

describe.each(ARTIFACT_KINDS)('stale design artifacts — $label', (kind) => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  /** Write an artifact of this kind; returns its absolute path. */
  const writeArtifact = async (date: string, slug: string): Promise<string> => {
    const path = join(repo, kind.relDir, kind.fileName(date, slug));
    await writeFile(path, `# ${slug}\n`);
    return path;
  };

  const writeFd = async (slug: string, phase: string, link?: string) => {
    await writeFile(
      join(repo, 'docs/features', `${slug}.md`),
      fd({ link, linkField: kind.linkField, name: slug, phase }),
    );
  };

  it('does not flag an artifact whose owning feature is in-progress', async () => {
    await writeArtifact('2026-04-19', 'tooltips');
    await writeFd('tooltips', 'in-progress');

    expect(await kind.detect(repo)).toHaveLength(0);
  });

  it('flags an artifact whose owning feature is done', async () => {
    await writeArtifact('2026-04-19', 'tooltips');
    await writeFd('tooltips', 'done');

    const result = await kind.detect(repo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'archive',
      reason: 'feature-done',
      slug: 'tooltips',
    });
    expect(result[0].path).toBe(join(kind.relDir, kind.fileName('2026-04-19', 'tooltips')));
  });

  it('does not age-flag an old artifact owned via links by an in-progress FD', async () => {
    const path = await writeArtifact('2024-01-01', 'parent-feat-extra');
    await utimes(path, OLD_DATE, OLD_DATE);
    await writeFd(
      'parent-feat',
      'in-progress',
      join(kind.relDir, kind.fileName('2024-01-01', 'parent-feat-extra')),
    );

    expect(await kind.detect(repo)).toHaveLength(0);
  });

  it('flags an artifact owned via links when the owning FD is done', async () => {
    await writeArtifact('2024-01-01', 'parent-feat-extra');
    await writeFd(
      'parent-feat',
      'done',
      join(kind.relDir, kind.fileName('2024-01-01', 'parent-feat-extra')),
    );

    const result = await kind.detect(repo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'archive',
      reason: 'feature-done',
      slug: 'parent-feat',
    });
    expect(result[0].path).toContain(kind.fileName('2024-01-01', 'parent-feat-extra'));
  });

  it('still age-flags an old artifact when no FD links it', async () => {
    const path = await writeArtifact('2024-01-01', 'parent-feat-extra');
    await utimes(path, OLD_DATE, OLD_DATE);
    await writeFd('unrelated', 'in-progress');

    const result = await kind.detect(repo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ reason: 'age-no-feature', slug: 'parent-feat-extra' });
  });

  describe('graph-adjacency fallback', () => {
    const writeGraph = async (docPath: string, ownerSlug: string) => {
      await mkdir(join(repo, 'graphify-out'), { recursive: true });
      await writeFile(
        join(repo, 'graphify-out/graph.json'),
        JSON.stringify({
          links: [{ relation: kind.relation, source: 'artifact-node', target: 'fd-node' }],
          nodes: [
            { id: 'artifact-node', source_file: docPath },
            { id: 'fd-node', source_file: `docs/features/${ownerSlug}.md` },
          ],
        }),
      );
    };

    it('does not age-flag an old artifact whose only owner is a live FD in the graph', async () => {
      const path = await writeArtifact('2024-01-01', 'graph-only');
      await utimes(path, OLD_DATE, OLD_DATE);
      await writeGraph(join(kind.relDir, kind.fileName('2024-01-01', 'graph-only')), 'graph-owner');
      await writeFd('graph-owner', 'in-progress');

      expect(await kind.detect(repo)).toHaveLength(0);
    });

    it('flags an artifact whose graph-resolved owner is done', async () => {
      await writeArtifact('2024-01-01', 'graph-only');
      await writeGraph(join(kind.relDir, kind.fileName('2024-01-01', 'graph-only')), 'graph-owner');
      await writeFd('graph-owner', 'done');

      const result = await kind.detect(repo);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        action: 'archive',
        reason: 'feature-done',
        slug: 'graph-owner',
      });
    });
  });

  it('flags an ownerless artifact older than the stale-days threshold', async () => {
    const path = await writeArtifact('2024-01-01', 'orphan');
    await utimes(path, OLD_DATE, OLD_DATE);

    const result = await kind.detect(repo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'archive',
      reason: 'age-no-feature',
      slug: 'orphan',
    });
  });

  it('does not flag a recent ownerless artifact', async () => {
    await writeArtifact('2026-04-29', 'recent');

    expect(await kind.detect(repo)).toHaveLength(0);
  });

  it('returns no findings when the artifact directory does not exist', async () => {
    await rm(join(repo, kind.relDir), { force: true, recursive: true });

    expect(await kind.detect(repo)).toEqual([]);
  });

  it('skips files that do not match the naming convention', async () => {
    await writeFile(join(repo, kind.relDir, 'README.md'), '# index\n');

    expect(await kind.detect(repo)).toHaveLength(0);
  });

  it('propagates non-ENOENT errors when the owning feature MD is malformed', async () => {
    await writeArtifact('2026-04-19', 'broken');
    await writeFd('broken', 'not-a-real-phase');

    await expect(kind.detect(repo)).rejects.toThrow();
  });
});

describe(detectUnusedBacklog, () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  it('flags a backlog entry older than 180d with no matching feature', async () => {
    await writeFile(
      join(repo, 'docs/backlog.md'),
      `# Backlog

## Later

### Old Idea
- area: tooling
- phase: later
- since: 2025-01-01

Description text.
`,
    );

    const result = await detectUnusedBacklog(repo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'drop',
      reason: 'age-no-promotion',
      since: '2025-01-01',
      slug: 'old-idea',
    });
  });

  it('does not flag a recent backlog entry', async () => {
    await writeFile(
      join(repo, 'docs/backlog.md'),
      `# Backlog

## Later

### New Idea
- area: tooling
- phase: later
- since: 2026-04-01

Description text.
`,
    );

    const result = await detectUnusedBacklog(repo);
    expect(result).toHaveLength(0);
  });

  it('flags a backlog entry whose slug duplicates an existing feature', async () => {
    await writeFile(
      join(repo, 'docs/backlog.md'),
      `# Backlog

## Now

### Tooltips
- area: ui
- phase: now
- since: 2026-04-20

Description text.
`,
    );
    await writeFile(
      join(repo, 'docs/features/tooltips.md'),
      `---
name: Tooltips
phase: in-progress
area: ui
category: Tooling
packages: ['@acme/web']
'noldor-tier': specs-only
links:
  code: []
  tests: []
  docs: []
---
body
`,
    );

    const result = await detectUnusedBacklog(repo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'drop',
      reason: 'redundant-with-feature',
      slug: 'tooltips',
    });
  });

  it('matches /promote slug derivation for apostrophes (no -s- artifact)', async () => {
    await writeFile(
      join(repo, 'docs/backlog.md'),
      `# Backlog

## Now

### It's Complicated
- area: tooling
- phase: now
- since: 2026-04-20

Description text.
`,
    );
    await writeFile(
      join(repo, 'docs/features/its-complicated.md'),
      `---
name: It's Complicated
phase: in-progress
area: tooling
category: Tooling
packages: ['scripts']
'noldor-tier': specs-only
links:
  code: []
  tests: []
  docs: []
---
body
`,
    );

    const result = await detectUnusedBacklog(repo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'drop',
      reason: 'redundant-with-feature',
      slug: 'its-complicated',
    });
  });

  it('skips a backlog entry with a malformed `since` date and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeFile(
      join(repo, 'docs/backlog.md'),
      `# Backlog

## Later

### Bad Date Idea
- area: tooling
- phase: later
- since: not-a-date

Description text.
`,
    );

    const result = await detectUnusedBacklog(repo);
    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("malformed since='not-a-date'"));
    warnSpy.mockRestore();
  });
});

describe(detectContradictions, () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  const fakeInvariant: Invariant = {
    docA: 'a.md',
    docB: 'b.md',
    message: 'a and b must agree on ownership',
    name: 'test rule',
    patternA: /pnpm release owns introduced/,
    patternB: /pnpm release owns introduced/,
  };

  it('flags a pair where only one side matches', async () => {
    await writeFile(join(repo, 'a.md'), 'pnpm release owns introduced\n');
    await writeFile(join(repo, 'b.md'), 'something else\n');

    const result = await detectContradictions(repo, [fakeInvariant]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'manual-edit',
      pair: ['a.md', 'b.md'],
      rule: 'test rule',
    });
  });

  it('does not flag when both sides match', async () => {
    await writeFile(join(repo, 'a.md'), 'pnpm release owns introduced\n');
    await writeFile(join(repo, 'b.md'), 'pnpm release owns introduced\n');

    const result = await detectContradictions(repo, [fakeInvariant]);
    expect(result).toHaveLength(0);
  });

  it('does not flag when neither side matches', async () => {
    await writeFile(join(repo, 'a.md'), 'unrelated\n');
    await writeFile(join(repo, 'b.md'), 'also unrelated\n');

    const result = await detectContradictions(repo, [fakeInvariant]);
    expect(result).toHaveLength(0);
  });

  it('skips invariants where one of the docs is missing', async () => {
    await writeFile(join(repo, 'a.md'), 'pnpm release owns introduced\n');
    // B.md absent

    const result = await detectContradictions(repo, [fakeInvariant]);
    expect(result).toHaveLength(0);
  });

  it('the live seed list produces zero contradictions against the current repo', async () => {
    const { fileURLToPath } = await import('node:url');
    const { existsSync, readFileSync } = await import('node:fs');
    const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
    if (!existsSync(join(repoRoot, '.noldor/config.json'))) {
      throw new Error(`Smoke test could not anchor repo root at ${repoRoot}`);
    }
    expect(readFileSync(join(repoRoot, 'package.json'), 'utf8').length).toBeGreaterThan(0);

    const result = await detectContradictions(repoRoot);
    expect(result).toStrictEqual([]);
  });
});

describe(detectInvariants, () => {
  it('returns only failing invariants (advisory mode)', async () => {
    const result = await detectInvariants();
    // On a clean repo, this should be empty. We just assert the shape.
    expect(Array.isArray(result)).toBeTruthy();
    for (const r of result) {
      expect(r.violations.length).toBeGreaterThan(0);
    }
  });

  it('surfaces invariant runner exceptions as advisory violations', async () => {
    const repo = await makeRepo();
    const throwing: ArchitectureInvariant = {
      description: 'throws while running',
      name: 'throws',
      async run() {
        throw new Error('boom');
      },
    };

    const result = await detectInvariants(repo, [throwing]);
    expect(result).toHaveLength(1);
    expect(result[0]?.invariant).toBe('throws');
    expect(result[0]?.violations[0]?.message).toContain('boom');
  });

  it('uses the repo argument instead of process.cwd()', async () => {
    const repo = await makeRepo();
    try {
      // The bare temp repo has no .noldor/config.json, so the boundaries
      // invariant fails there — but only if `repo` is actually forwarded
      // (this workspace's own config parses clean and passes).
      const result = await detectInvariants(repo);
      expect(result.map((r) => r.invariant)).toContain('boundaries');
    } finally {
      await rm(repo, { force: true, recursive: true });
    }
  });
});

describe('shouldFlagSourceDrift (Detector 15)', () => {
  it('flags when source is newer than page by more than tolerance', () => {
    const source = '2026-05-08T12:00:00Z';
    const page = '2026-04-01T12:00:00Z'; // 37 days earlier
    expect(shouldFlagSourceDrift(source, page, 30)).toBe(true);
  });

  it('does not flag when source is within tolerance window', () => {
    const source = '2026-05-08T12:00:00Z';
    const page = '2026-04-15T12:00:00Z'; // 23 days earlier
    expect(shouldFlagSourceDrift(source, page, 30)).toBe(false);
  });

  it('does not flag when page is newer than source', () => {
    const source = '2026-04-01T12:00:00Z';
    const page = '2026-05-08T12:00:00Z';
    expect(shouldFlagSourceDrift(source, page, 30)).toBe(false);
  });

  it('does not flag when source date is null (path never committed)', () => {
    expect(shouldFlagSourceDrift(null, '2026-05-08T12:00:00Z', 30)).toBe(false);
  });

  it('does not flag when page date is null (page never committed)', () => {
    expect(shouldFlagSourceDrift('2026-05-08T12:00:00Z', null, 30)).toBe(false);
  });

  it('returns false on malformed dates', () => {
    expect(shouldFlagSourceDrift('not-a-date', '2026-05-08T12:00:00Z', 30)).toBe(false);
  });

  // Regression: a stale `sources` path (e.g. after a dir rename) makes
  // lastCommitISO return null, silently no-op'ing the detector for that page.
  // Every source must resolve to a real path on disk so the detector stays live.
  it('every SOURCE_DRIFT_PAIRS source path exists on disk', async () => {
    const { fileURLToPath } = await import('node:url');
    const { existsSync } = await import('node:fs');
    const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
    for (const pair of SOURCE_DRIFT_PAIRS) {
      for (const src of pair.sources) {
        expect(existsSync(join(repoRoot, src)), `missing source path: ${src}`).toBe(true);
      }
      expect(existsSync(join(repoRoot, pair.page)), `missing page: ${pair.page}`).toBe(true);
    }
  });
});

describe('specSlugFromFilename', () => {
  it('strips date prefix and -design suffix', () => {
    expect(specSlugFromFilename('2026-04-23-feature-md-framework-design.md')).toBe(
      'feature-md-framework',
    );
  });

  it('returns null for files missing the -design suffix', () => {
    expect(specSlugFromFilename('2026-04-19-tooltips.md')).toBeNull();
  });

  it('returns null for non-spec filenames', () => {
    expect(specSlugFromFilename('README.md')).toBeNull();
  });
});

describe('hasBlockingFindings', () => {
  const emptyFindings: GateComplianceFindings = {
    overrideAudit: { severity: 'INFO', count: 0, overrides: [] },
    codexCrOverrideAudit: [],
    tierMismatch: [],
    allowlistDrift: [],
    trailerScopeMismatch: [],
    planWithoutFd: [],
    fdWithoutPlan: [],
  };

  it('returns false when all lists are empty and override-audit is INFO', () => {
    expect(hasBlockingFindings(emptyFindings)).toBe(false);
  });

  it('returns true when tier-mismatch is non-empty', () => {
    const findings: GateComplianceFindings = {
      ...emptyFindings,
      tierMismatch: [
        {
          slug: 'foo',
          path: 'docs/features/foo.md',
          reason: 'full-tier-missing-spec',
          action: 'add-spec-link',
        },
      ],
    };
    expect(hasBlockingFindings(findings)).toBe(true);
  });

  it('returns true when allowlist-drift is non-empty', () => {
    const findings: GateComplianceFindings = {
      ...emptyFindings,
      allowlistDrift: [
        {
          sha: 'abc123',
          subject: 'chore(noldor): micro-chore',
          offendingFiles: ['scripts/foo.ts'],
          reason: 'non-allowlisted-files',
          action: 'investigate',
        },
      ],
    };
    expect(hasBlockingFindings(findings)).toBe(true);
  });

  it('returns true when trailer-scope-mismatch is non-empty', () => {
    const findings: GateComplianceFindings = {
      ...emptyFindings,
      trailerScopeMismatch: [
        {
          sha: 'abc123',
          subject: 'feat(other): unrelated',
          fdSlug: 'my-feature',
          scope: 'other',
          reason: 'scope-missing-fd-slug',
          action: 'fix-scope-or-trailer',
        },
      ],
    };
    expect(hasBlockingFindings(findings)).toBe(true);
  });

  it('returns true when override-audit severity is WARN', () => {
    const findings: GateComplianceFindings = {
      ...emptyFindings,
      overrideAudit: { severity: 'WARN', count: 2, overrides: [] },
    };
    expect(hasBlockingFindings(findings)).toBe(true);
  });

  it('returns false for informational-only plan-without-fd findings', () => {
    const findings: GateComplianceFindings = {
      ...emptyFindings,
      planWithoutFd: [
        {
          slug: 'orphan-plan',
          planPath: 'docs/design/plans/2026-01-01-orphan-plan.md',
          reason: 'no-matching-fd',
          action: 'create-fd-or-archive-plan',
        },
      ],
    };
    expect(hasBlockingFindings(findings)).toBe(false);
  });

  it('returns false for informational-only fd-without-plan findings', () => {
    const findings: GateComplianceFindings = {
      ...emptyFindings,
      fdWithoutPlan: [
        {
          slug: 'orphan-fd',
          fdPath: 'docs/features/orphan-fd.md',
          reason: 'in-progress-post-rollout-no-plan',
          action: 'create-plan',
        },
      ],
    };
    expect(hasBlockingFindings(findings)).toBe(false);
  });
});

describe('loadOverrideAuditOptions', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  it('returns no rules and no threshold when the config file is absent', async () => {
    const opts = await loadOverrideAuditOptions(repo);
    expect(opts.expected).toEqual([]);
    expect(opts.threshold).toBeUndefined();
  });

  it('extracts threshold and expected rules from garden.overrideAudit', async () => {
    await mkdir(join(repo, '.noldor'), { recursive: true });
    await writeFile(
      join(repo, '.noldor/config.json'),
      JSON.stringify({
        garden: {
          overrideAudit: {
            threshold: 6,
            expected: [{ reasonIncludes: 'declared noise', note: 'operator-accepted' }],
          },
        },
      }),
      'utf8',
    );
    const opts = await loadOverrideAuditOptions(repo);
    expect(opts.threshold).toBe(6);
    expect(opts.expected).toEqual([
      { reasonIncludes: 'declared noise', note: 'operator-accepted' },
    ]);
  });

  it('fails open on a malformed config (no crash, no rules)', async () => {
    await mkdir(join(repo, '.noldor'), { recursive: true });
    await writeFile(join(repo, '.noldor/config.json'), '{ not json', 'utf8');
    const opts = await loadOverrideAuditOptions(repo);
    expect(opts.expected).toEqual([]);
  });
});

describe('staleGraphGaps', () => {
  const staleGap = {
    category: 'Tests with incomplete co-tag',
    itemId: 'graphify-out/graph.json',
    message:
      'Co-tag detector ran in degraded mode: graphify-out/graph.json regen 2026-08-01, latest source mtime 2026-08-07. Run /graphify + pnpm toon (preferred) or perform a manual co-tag audit.',
  };
  const missingGraphGap = {
    category: 'Tests with incomplete co-tag',
    itemId: 'graphify-out/graph.json',
    message: 'graphify-out/graph.json does not exist. Run /graphify + pnpm toon.',
  };
  const coTagGap = {
    category: 'Tests with incomplete co-tag',
    itemId: 'src/garden/__tests__/garden-detect.test.ts',
    message: 'imports files owned by FDs missing from @tests: tag — add: doc-gardening-skill',
  };

  it('picks the stale-graph meta-gap out of a mixed gap list', () => {
    expect(staleGraphGaps([coTagGap, staleGap, missingGraphGap])).toEqual([staleGap]);
  });

  it('is empty when the graph is fresh (no meta-gap emitted)', () => {
    expect(staleGraphGaps([coTagGap])).toEqual([]);
  });

  it('ignores a missing graph — graphify is optional, so --ci must not fail on it', () => {
    expect(staleGraphGaps([missingGraphGap])).toEqual([]);
  });
});
