import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectContradictions,
  detectInvariants,
  detectStalePlans,
  detectStaleSpecs,
  detectUnusedBacklog,
  hasBlockingFindings,
  shouldFlagSourceDrift,
  SOURCE_DRIFT_PAIRS,
  specSlugFromFilename,
} from '../garden-detect.js';

import type { GateComplianceFindings } from '../garden-detect.js';

import type { Invariant } from '../garden-invariants.js';
import type { Invariant as ArchitectureInvariant } from '../../invariants/types.js';

// @tests: doc-gardening-skill, architecture-invariants, noldor

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), 'garden-'));
  await mkdir(join(root, 'docs/superpowers/plans'), { recursive: true });
  await mkdir(join(root, 'docs/superpowers/specs'), { recursive: true });
  await mkdir(join(root, 'docs/features'), { recursive: true });
  return root;
}

describe('detectStalePlans (primary: feature done)', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  it('propagates non-ENOENT errors when a feature MD is malformed', async () => {
    await writeFile(join(repo, 'docs/superpowers/plans/2026-04-19-broken.md'), '# Broken Plan\n');
    await writeFile(
      join(repo, 'docs/features/broken.md'),
      `---
name: Broken
phase: not-a-real-phase
---
body
`,
    );

    await expect(detectStalePlans(repo)).rejects.toThrow();
  });

  it('flags a plan whose feature is done and has merged PRs', async () => {
    await writeFile(
      join(repo, 'docs/superpowers/plans/2026-04-19-tooltips.md'),
      '# Tooltips Plan\n',
    );
    await writeFile(
      join(repo, 'docs/features/tooltips.md'),
      `---
name: Tooltips
phase: done
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

    const result = await detectStalePlans(repo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'archive',
      reason: 'feature-done',
      slug: 'tooltips',
    });
    expect(result[0].path).toContain('2026-04-19-tooltips.md');
  });

  it('does not flag a plan whose feature is in-progress', async () => {
    await writeFile(
      join(repo, 'docs/superpowers/plans/2026-04-19-tooltips.md'),
      '# Tooltips Plan\n',
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

    const result = await detectStalePlans(repo);
    expect(result).toHaveLength(0);
  });

  it('flags a done feature even before PR refs are backfilled', async () => {
    await writeFile(
      join(repo, 'docs/superpowers/plans/2026-04-29-architecture-invariants.md'),
      '# Architecture Invariants Plan\n',
    );
    await writeFile(
      join(repo, 'docs/features/architecture-invariants.md'),
      `---
name: Architecture Invariants
phase: done
area: tooling
category: Tooling
packages: ['tooling']
'noldor-tier': specs-only
links:
  code: []
  tests: []
  docs: []
---
body
`,
    );

    const result = await detectStalePlans(repo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'archive',
      reason: 'feature-done',
      slug: 'architecture-invariants',
    });
  });
});

describe('detectStalePlans (secondary: age + no feature)', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  it('flags a plan with mtime > stale-days threshold and no matching feature', async () => {
    const plan = join(repo, 'docs/superpowers/plans/2024-01-01-orphan.md');
    await writeFile(plan, '# Orphan Plan\n');
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await utimes(plan, oldDate, oldDate);

    const result = await detectStalePlans(repo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'archive',
      reason: 'age-no-feature',
      slug: 'orphan',
    });
  });

  it('does not flag a recent plan with no feature', async () => {
    const plan = join(repo, 'docs/superpowers/plans/2026-04-29-recent.md');
    await writeFile(plan, '# Recent Plan\n');

    const result = await detectStalePlans(repo);
    expect(result).toHaveLength(0);
  });

  it('does not flag an old plan whose feature is in-progress', async () => {
    const plan = join(repo, 'docs/superpowers/plans/2024-01-01-active.md');
    await writeFile(plan, '# Active Plan\n');
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await utimes(plan, oldDate, oldDate);
    await writeFile(
      join(repo, 'docs/features/active.md'),
      `---
name: Active
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

    const result = await detectStalePlans(repo);
    expect(result).toHaveLength(0);
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
      await writeFile(
        join(repo, 'docs/features/passive-ui.md'),
        `---
name: Passive UI
phase: done
area: web
category: Tooling
packages: ['web']
'noldor-tier': specs-only
links:
  code: []
  tests: []
  docs: []
---
## Summary
No opt-out here.
`,
      );
      await writeFile(
        join(repo, 'docs/features/keyboard-shortcuts.md'),
        `---
name: Keyboard Shortcuts
phase: done
area: web
category: Tooling
packages: ['web']
'noldor-tier': specs-only
links:
  code: []
  tests: []
  docs: []
---
## Usage
No feature coverage.
`,
      );

      const result = await detectInvariants(repo);
      expect(result.map((r) => r.invariant)).toContain('keyboard-binding');
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

describe('detectStaleSpecs (primary: feature done)', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  it('flags a spec whose feature is done', async () => {
    await writeFile(
      join(repo, 'docs/superpowers/specs/2026-04-19-tooltips-design.md'),
      '# Tooltips Spec\n',
    );
    await writeFile(
      join(repo, 'docs/features/tooltips.md'),
      `---
name: Tooltips
phase: done
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

    const result = await detectStaleSpecs(repo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'archive',
      reason: 'feature-done',
      slug: 'tooltips',
    });
    expect(result[0].path).toContain('2026-04-19-tooltips-design.md');
  });

  it('does not flag a spec whose feature is in-progress', async () => {
    await writeFile(
      join(repo, 'docs/superpowers/specs/2026-04-19-tooltips-design.md'),
      '# Tooltips Spec\n',
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

    const result = await detectStaleSpecs(repo);
    expect(result).toHaveLength(0);
  });

  it('skips files that do not match the spec naming pattern', async () => {
    await writeFile(join(repo, 'docs/superpowers/specs/README.md'), '# specs\n');
    const result = await detectStaleSpecs(repo);
    expect(result).toHaveLength(0);
  });
});

describe('detectStaleSpecs (secondary: age + no feature)', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  it('flags an old spec with no matching feature', async () => {
    const spec = join(repo, 'docs/superpowers/specs/2024-01-01-orphan-design.md');
    await writeFile(spec, '# Orphan Spec\n');
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await utimes(spec, oldDate, oldDate);

    const result = await detectStaleSpecs(repo);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: 'archive',
      reason: 'age-no-feature',
      slug: 'orphan',
    });
  });

  it('does not flag a recent spec with no feature', async () => {
    await writeFile(
      join(repo, 'docs/superpowers/specs/2026-04-29-recent-design.md'),
      '# Recent Spec\n',
    );

    const result = await detectStaleSpecs(repo);
    expect(result).toHaveLength(0);
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
          planPath: 'docs/superpowers/plans/2026-01-01-orphan-plan.md',
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
