# Framework Doc Extraction — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework/product classification snapshot (Phase 0 of the multi-phase spec). No file moves. Single PR deliverable: a classifier script + committed `.noldor/classification/` outputs that Phases 1–6 consume.

**Architecture:** Plain Node + tsx script under `packages/noldor/scripts/migration/` (outside `src/` to keep off the npm publish path). Reuses existing loaders from `packages/noldor/src/`:

- `loadSddFeatures(dir)` from `src/garden/sdd-report.ts` — parses every `docs/features/*.md` into `FeatureRecord`.
- `parseRoadmap(raw)` / `parseBacklog(raw)` from `src/utils/parse-blocks.ts` — parses schema-C blocks into `BacklogEntry[]` (same shape; the parser is shared).

This avoids drift in frontmatter-shape assumptions. The migration scripts add only the classification rule, not parsing logic.

The entrypoint emits four files to `.noldor/classification/`, one bucket per type using a `<type>\t<id>` columnar format so consumers can filter by type without re-parsing filenames. CLI invocation via a root `package.json` script (`pnpm noldor:classify`). The proper `pnpm noldor classify-feature-track` subcommand lands at Phase 6 when the publish allowlist is in place.

**Note on `ideas.md`:** It's gitignored in this repo (verify with `grep -n '^ideas.md$' .gitignore`). The classifier audits it locally if present but does NOT commit any output naming individual ideas. The split mechanism for `ideas.md` is a Phase 4 concern that may need a separate decision (un-gitignore vs leave operator-local); flagged in Task 7 as a Phase 0 finding.

**Body-link audit scope (Phase 0 caveat):** the audit's body scan matches only `[[slug]]`-style transclusion-flavoured links — the convention used in FD bodies for cross-FD references. Markdown-style links `[label](../slug.md)` are NOT scanned at Phase 0. If those become a real source of cross-tree links during Phase 2's downgrade pass, extend the regex then; for Phase 0 the simpler scope is sufficient and matches existing FD conventions.

**Tech Stack:** TypeScript, tsx, vitest, gray-matter (already in deps), pnpm.

**Phase scope:** This plan covers **only Phase 0** of the spec. Phases 1–6 ship as separate `specs-only-attach` / `full-attach` sessions in later cycles. Each phase has its own plan.

---

## File structure

**Create:**

- `packages/noldor/scripts/migration/classify-feature-track.ts` — classifier entrypoint. Reads all FDs / roadmap / backlog / plans / specs, classifies, writes outputs to `.noldor/classification/`.
- `packages/noldor/scripts/migration/classify.ts` — pure classification logic (`classifyFeature`, `classifyRoadmapEntry`, regex constant). No I/O. Easy to unit-test.
- `packages/noldor/scripts/migration/cross-tree-link-audit.ts` — pure audit logic (`auditCrossTreeLinks` given a classification map + FD bodies). No I/O.
- `packages/noldor/scripts/migration/__tests__/classify.test.ts` — unit tests for `classify.ts`.
- `packages/noldor/scripts/migration/__tests__/cross-tree-link-audit.test.ts` — unit tests for audit.
- `.noldor/classification/framework.txt` (output, committed at end-of-task)
- `.noldor/classification/product.txt` (output)
- `.noldor/classification/ambiguous.txt` (output)
- `.noldor/classification/cross-tree-links.txt` (output)

**Modify:**

- `.noldor/.gitignore` — append the four whitelist lines from spec Phase 0 deliverables.
- `package.json` (root) — add `noldor:classify` script.
- `packages/noldor/vitest.config.ts` — extend `include` to cover `scripts/migration/__tests__/**` (its default is `src/**/__tests__/**`).

**Not in scope this plan:** `move-feature.ts`, `split-roadmap.ts`, `split-ideas.ts` — those are Phase 2/3/4 plans.

---

### Task 1: Scaffold migration directory + vitest config

**Files:**

- Create: `packages/noldor/scripts/migration/.gitkeep`
- Modify: `packages/noldor/vitest.config.ts`
- Test: re-run existing tests; new dir must not break vitest.

- [ ] **Step 1: Read current vitest config**

Open `packages/noldor/vitest.config.ts` with the Read tool.

Expected current content:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 2: Extend `include` to cover migration tests**

Replace the current single-pattern `include` with a two-pattern array. The exact target state:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts', 'scripts/migration/__tests__/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 10_000,
  },
});
```

Only the `include` line changes; the rest stays byte-identical.

- [ ] **Step 3: Create the migration dir with a placeholder**

```bash
mkdir -p packages/noldor/scripts/migration/__tests__
touch packages/noldor/scripts/migration/.gitkeep
```

(No fixture dir — all tests use inline data.)

- [ ] **Step 4: Verify vitest still runs**

Run from the worktree root:

```bash
pnpm --filter noldor test --run
```

Expected: green (no migration tests yet, so no new tests run).

- [ ] **Step 5: Commit**

```bash
git add packages/noldor/scripts/migration/.gitkeep packages/noldor/vitest.config.ts
git commit -m "chore(noldor): scaffold scripts/migration/ + extend vitest include"
```

Note: pre-commit hook will require `Noldor-FD:` trailer. The hook should auto-inject it from `.noldor/session.json` via `prepare-commit-msg`. If commit fails on trailer scope, verify the session marker still reads `framework-doc-extraction`.

---

### Task 2: Pure classification logic — unit tests first

**Files:**

- Create: `packages/noldor/scripts/migration/classify.ts`
- Create: `packages/noldor/scripts/migration/__tests__/classify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/noldor/scripts/migration/__tests__/classify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FRAMEWORK_PREFIX_RE, classifyFeature, type Track } from '../classify.ts';

describe('classifyFeature', () => {
  it('classifies area=tooling + dashboard- slug as framework', () => {
    const got = classifyFeature({
      slug: 'dashboard-hot-zones-page',
      name: 'Dashboard Hot Zones Page',
      area: 'tooling',
    });
    expect(got).toBe('framework' satisfies Track);
  });

  it('classifies area=web + dashboard-* slug as product (area guard blocks)', () => {
    const got = classifyFeature({
      slug: 'dashboard-roadmap-drag-drop',
      name: 'Dashboard Roadmap Drag-Drop',
      area: 'web', // product area
    });
    expect(got).toBe('product' satisfies Track);
  });

  it('classifies area=tooling + non-matching slug as ambiguous (manual review)', () => {
    const got = classifyFeature({
      slug: 'architecture-invariants',
      name: 'Architecture Invariants',
      area: 'tooling',
    });
    expect(got).toBe('ambiguous' satisfies Track);
  });

  it('classifies area=editor + non-tooling slug as product', () => {
    const got = classifyFeature({
      slug: 'auto-save',
      name: 'Auto-save',
      area: 'editor',
    });
    expect(got).toBe('product' satisfies Track);
  });

  it('slug wins over name when they disagree', () => {
    const got = classifyFeature({
      slug: 'auto-save', // doesn't match regex (auto- not in regex)
      name: 'Dashboard Auto-Save Hot Zone', // would match (starts with Dashboard- in name regex form)
      area: 'tooling',
    });
    // slug fails regex, falls back to name; name has 'Dashboard' but `^dashboard-` requires lowercase prefix on slug-form
    // we test slug-wins by ensuring slug-failure does NOT auto-promote to framework
    expect(got).toBe('ambiguous' satisfies Track);
  });

  it('regex matches framework- prefix', () => {
    expect(FRAMEWORK_PREFIX_RE.test('framework-doc-extraction')).toBe(true);
    expect(FRAMEWORK_PREFIX_RE.test('auto-save')).toBe(false); // auto- excluded per spec YAGNI
    expect(FRAMEWORK_PREFIX_RE.test('specs-only-tier')).toBe(false); // specs- excluded
  });
});
```

- [ ] **Step 2: Run test — expect failure (module missing)**

```bash
pnpm --filter noldor test scripts/migration/__tests__/classify.test.ts --run
```

Expected: FAIL — `Cannot find module '../classify.ts'`.

- [ ] **Step 3: Write minimal `classify.ts`**

Create `packages/noldor/scripts/migration/classify.ts`:

```ts
/**
 * Pure classification logic for the framework/product doc split.
 * No I/O. Unit-testable. Consumed by `classify-feature-track.ts` (entrypoint).
 *
 * Spec: docs/superpowers/specs/2026-05-28-framework-doc-extraction-design.md
 */

export type Track = 'framework' | 'product' | 'ambiguous';

/**
 * Regex from spec § Categorisation heuristic. Slug-prefix matcher.
 *
 * Excluded prefixes (YAGNI): `auto-`, `garden-`, `specs-` — no current matches.
 * Add them back via one-line edit when first match lands.
 */
export const FRAMEWORK_PREFIX_RE = /^(dashboard|noldor|gate|release|triage|sdd|framework|doc|fd)-/;

export interface ClassifyInput {
  readonly slug: string;
  readonly name: string;
  readonly area: string;
}

/**
 * Classify a feature by area + slug/name prefix.
 *
 * Rule (spec):
 * 1. `area === 'tooling'` (AND)
 * 2. `slug` (canonical) OR `name` matches `FRAMEWORK_PREFIX_RE`.
 *
 * Tie-breaker: slug wins. Reader tries slug first; falls back to name only
 * when slug fails to match.
 *
 * @returns `framework` (both clauses pass), `product` (area guard fails),
 *          `ambiguous` (area=tooling but slug/name don't prefix-match).
 */
export function classifyFeature(input: ClassifyInput): Track {
  if (input.area !== 'tooling') return 'product';

  // Slug wins. Try canonical form first.
  if (FRAMEWORK_PREFIX_RE.test(input.slug)) return 'framework';

  // Fall back to name. Normalise to slug-form for the regex.
  const nameAsSlug = input.name.toLowerCase().replace(/\s+/g, '-');
  if (FRAMEWORK_PREFIX_RE.test(nameAsSlug)) return 'framework';

  // area=tooling but no prefix match → operator decides.
  return 'ambiguous';
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm --filter noldor test scripts/migration/__tests__/classify.test.ts --run
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/noldor/scripts/migration/classify.ts packages/noldor/scripts/migration/__tests__/classify.test.ts
git commit -m "feat(noldor): add pure classifyFeature logic + tests"
```

---

### Task 3: Roadmap / backlog entry classification — same rule, different input shape

**Files:**

- Modify: `packages/noldor/scripts/migration/classify.ts` (add `classifyRoadmapEntry`)
- Modify: `packages/noldor/scripts/migration/__tests__/classify.test.ts` (add tests)

- [ ] **Step 1: Write failing tests**

Append to `__tests__/classify.test.ts`:

```ts
import { classifyRoadmapEntry } from '../classify.ts';

describe('classifyRoadmapEntry', () => {
  it('classifies area=tooling + dashboard- slug as framework', () => {
    expect(
      classifyRoadmapEntry({
        slug: 'dashboard-foo',
        name: 'Dashboard Foo',
        area: 'tooling',
      }),
    ).toBe('framework');
  });

  it('falls back to product when area not tooling', () => {
    expect(
      classifyRoadmapEntry({
        slug: 'dashboard-foo',
        name: 'Dashboard Foo',
        area: 'web',
      }),
    ).toBe('product');
  });

  it('marks ambiguous when area=tooling but no prefix match', () => {
    expect(
      classifyRoadmapEntry({
        slug: 'foo-bar',
        name: 'Foo Bar',
        area: 'tooling',
      }),
    ).toBe('ambiguous');
  });
});
```

- [ ] **Step 2: Run — expect fail (`classifyRoadmapEntry` undefined)**

```bash
pnpm --filter noldor test scripts/migration/__tests__/classify.test.ts --run
```

Expected: FAIL — `classifyRoadmapEntry` is not exported.

- [ ] **Step 3: Add `classifyRoadmapEntry` to `classify.ts`**

Append to `packages/noldor/scripts/migration/classify.ts`:

```ts
/**
 * Roadmap and backlog entries share the same shape as features
 * (slug + name + area at schema-C top level). Same classification rule;
 * alias the function for caller clarity.
 */
export const classifyRoadmapEntry = classifyFeature;
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm --filter noldor test scripts/migration/__tests__/classify.test.ts --run
```

Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/noldor/scripts/migration/classify.ts packages/noldor/scripts/migration/__tests__/classify.test.ts
git commit -m "feat(noldor): add classifyRoadmapEntry alias + tests"
```

---

### Task 4: Plan/spec classification by FD parent

**Files:**

- Modify: `packages/noldor/scripts/migration/classify.ts` (add `classifyPlanOrSpec`)
- Modify: `__tests__/classify.test.ts` (add tests)

- [ ] **Step 1: Write failing tests**

Append:

```ts
import { classifyPlanOrSpec } from '../classify.ts';

describe('classifyPlanOrSpec', () => {
  const featureTracks = new Map<string, Track>([
    ['dashboard-hot-zones-page', 'framework'],
    ['auto-save', 'product'],
  ]);

  it('inherits track from owning FD slug embedded in filename', () => {
    expect(
      classifyPlanOrSpec({
        filename: '2026-04-29-dashboard-hot-zones-page-design.md',
        featureTracks,
      }),
    ).toBe('framework');

    expect(
      classifyPlanOrSpec({
        filename: '2026-03-15-auto-save-design.md',
        featureTracks,
      }),
    ).toBe('product');
  });

  it('returns ambiguous when no embedded slug matches a known FD', () => {
    expect(
      classifyPlanOrSpec({
        filename: '2026-01-01-something-else-design.md',
        featureTracks,
      }),
    ).toBe('ambiguous');
  });

  it('matches longest slug when multiple slugs are substrings', () => {
    // Edge case: filename contains a slug that is a prefix of another known slug.
    const tracks = new Map<string, Track>([
      ['dashboard', 'framework'],
      ['dashboard-hot-zones-page', 'product'], // hypothetical conflicting classification
    ]);
    expect(
      classifyPlanOrSpec({
        filename: '2026-04-29-dashboard-hot-zones-page-design.md',
        featureTracks: tracks,
      }),
    ).toBe('product'); // longer slug wins
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
pnpm --filter noldor test scripts/migration/__tests__/classify.test.ts --run
```

Expected: FAIL — `classifyPlanOrSpec` undefined.

- [ ] **Step 3: Implement `classifyPlanOrSpec`**

Append to `classify.ts`:

```ts
export interface ClassifyPlanOrSpecInput {
  readonly filename: string;
  readonly featureTracks: ReadonlyMap<string, Track>;
}

/**
 * Plans + specs are named `YYYY-MM-DD-<slug>-design.md` (or just `<slug>.md`
 * for plans). The owning FD's track determines the plan/spec track.
 *
 * Matches the longest slug that appears as a substring (handles cases where
 * a short slug is a prefix of a longer one, e.g. `dashboard` ⊂ `dashboard-foo`).
 *
 * @returns inherited track, or `'ambiguous'` if no known FD slug matches.
 */
export function classifyPlanOrSpec(input: ClassifyPlanOrSpecInput): Track {
  const slugs = [...input.featureTracks.keys()].sort((a, b) => b.length - a.length);
  for (const slug of slugs) {
    if (input.filename.includes(slug)) {
      return input.featureTracks.get(slug) ?? 'ambiguous';
    }
  }
  return 'ambiguous';
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm --filter noldor test scripts/migration/__tests__/classify.test.ts --run
```

Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/noldor/scripts/migration/classify.ts packages/noldor/scripts/migration/__tests__/classify.test.ts
git commit -m "feat(noldor): add classifyPlanOrSpec (longest-slug match) + tests"
```

---

### Task 5: Cross-tree link audit — pure logic, unit-tested

**Files:**

- Create: `packages/noldor/scripts/migration/cross-tree-link-audit.ts`
- Create: `packages/noldor/scripts/migration/__tests__/cross-tree-link-audit.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/cross-tree-link-audit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { auditCrossTreeLinks, type CrossTreeFinding } from '../cross-tree-link-audit.ts';
import type { Track } from '../classify.ts';

const tracks = new Map<string, Track>([
  ['dashboard-hot-zones-page', 'framework'],
  ['auto-save', 'product'],
  ['noldor-package-lift', 'framework'],
]);

describe('auditCrossTreeLinks', () => {
  it('flags framework FD with deps: reference to product FD', () => {
    const findings = auditCrossTreeLinks({
      featureTracks: tracks,
      features: [
        {
          slug: 'dashboard-hot-zones-page',
          deps: ['auto-save'], // cross-tree: framework → product
          links: { spec: '', code: [], tests: [] },
          body: '',
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      sourceSlug: 'dashboard-hot-zones-page',
      sourceTrack: 'framework',
      targetSlug: 'auto-save',
      targetTrack: 'product',
      field: 'deps',
    } satisfies Partial<CrossTreeFinding>);
  });

  it('flags body [[slug]] reference across trees', () => {
    const findings = auditCrossTreeLinks({
      featureTracks: tracks,
      features: [
        {
          slug: 'dashboard-hot-zones-page',
          deps: [],
          links: { spec: '', code: [], tests: [] },
          body: 'Related: [[auto-save]] and [[noldor-package-lift]].',
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe('body');
    expect(findings[0].targetSlug).toBe('auto-save');
  });

  it('ignores same-tree references (framework → framework)', () => {
    const findings = auditCrossTreeLinks({
      featureTracks: tracks,
      features: [
        {
          slug: 'dashboard-hot-zones-page',
          deps: ['noldor-package-lift'],
          links: { spec: '', code: [], tests: [] },
          body: 'See [[noldor-package-lift]].',
        },
      ],
    });

    expect(findings).toHaveLength(0);
  });

  it('ignores unknown slugs (not in featureTracks)', () => {
    const findings = auditCrossTreeLinks({
      featureTracks: tracks,
      features: [
        {
          slug: 'dashboard-hot-zones-page',
          deps: ['something-unknown'],
          links: { spec: '', code: [], tests: [] },
          body: '',
        },
      ],
    });

    // Unknown slug isn't a cross-tree problem; it's a different kind of dangling
    // link. Out of scope for this audit.
    expect(findings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect fail (module missing)**

```bash
pnpm --filter noldor test scripts/migration/__tests__/cross-tree-link-audit.test.ts --run
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cross-tree-link-audit.ts`**

Create `packages/noldor/scripts/migration/cross-tree-link-audit.ts`:

```ts
/**
 * Cross-tree link audit. Pure logic; consumes a track map + parsed feature
 * data, returns findings. No I/O.
 *
 * Spec: § Phase 0 / cross-tree link audit. Findings drive the Phase 2 inline-
 * downgrade pass.
 */

import type { Track } from './classify.ts';

export interface FeatureLinks {
  readonly spec: string;
  readonly code: readonly string[];
  readonly tests: readonly string[];
}

export interface FeatureRecord {
  readonly slug: string;
  readonly deps: readonly string[];
  readonly links: FeatureLinks;
  readonly body: string;
}

export interface CrossTreeFinding {
  readonly sourceSlug: string;
  readonly sourceTrack: Track;
  readonly targetSlug: string;
  readonly targetTrack: Track;
  readonly field: 'deps' | 'body';
}

export interface AuditInput {
  readonly featureTracks: ReadonlyMap<string, Track>;
  readonly features: readonly FeatureRecord[];
}

const BODY_LINK_RE = /\[\[([a-z0-9-]+)\]\]/g;

/**
 * Find cross-tree links. A link is cross-tree iff source and target are both
 * known FDs and their tracks differ (and neither is 'ambiguous' — those need
 * manual classification before audit can decide).
 */
export function auditCrossTreeLinks(input: AuditInput): CrossTreeFinding[] {
  const findings: CrossTreeFinding[] = [];

  for (const feat of input.features) {
    const sourceTrack = input.featureTracks.get(feat.slug);
    if (sourceTrack === undefined || sourceTrack === 'ambiguous') continue;

    for (const targetSlug of feat.deps) {
      const targetTrack = input.featureTracks.get(targetSlug);
      if (targetTrack === undefined || targetTrack === 'ambiguous') continue;
      if (targetTrack !== sourceTrack) {
        findings.push({
          sourceSlug: feat.slug,
          sourceTrack,
          targetSlug,
          targetTrack,
          field: 'deps',
        });
      }
    }

    for (const match of feat.body.matchAll(BODY_LINK_RE)) {
      const targetSlug = match[1];
      const targetTrack = input.featureTracks.get(targetSlug);
      if (targetTrack === undefined || targetTrack === 'ambiguous') continue;
      if (targetTrack !== sourceTrack) {
        findings.push({
          sourceSlug: feat.slug,
          sourceTrack,
          targetSlug,
          targetTrack,
          field: 'body',
        });
      }
    }
  }

  return findings;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm --filter noldor test scripts/migration/__tests__/cross-tree-link-audit.test.ts --run
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/noldor/scripts/migration/cross-tree-link-audit.ts packages/noldor/scripts/migration/__tests__/cross-tree-link-audit.test.ts
git commit -m "feat(noldor): add cross-tree link audit + tests"
```

---

### Task 6: Whitelist `.noldor/classification/` in gitignore

**Files:**

- Modify: `.noldor/.gitignore`

- [ ] **Step 1: Read current `.noldor/.gitignore`**

```bash
cat .noldor/.gitignore
```

Expected output (current state):

```
*
!.gitignore
!rollout-marker
!config.json
```

- [ ] **Step 2: Append classification whitelist lines**

Edit `.noldor/.gitignore` to read:

```
*
!.gitignore
!rollout-marker
!config.json
!classification/
!classification/framework.txt
!classification/product.txt
!classification/ambiguous.txt
!classification/cross-tree-links.txt
```

- [ ] **Step 3: Verify the whitelist works (no actual files yet)**

```bash
mkdir -p .noldor/classification
touch .noldor/classification/framework.txt
git check-ignore -v .noldor/classification/framework.txt
echo "exit=$?"
```

Expected: empty stdout + `exit=1`. `git check-ignore` returns **exit 1 when the file is NOT ignored** (which is what we want — the whitelist worked). Exit 0 means the file IS still ignored (whitelist failed; adjust the `.gitignore` order and re-test).

- [ ] **Step 4: Clean up the dummy file**

```bash
rm -rf .noldor/classification
```

- [ ] **Step 5: Commit the gitignore change**

```bash
git add .noldor/.gitignore
git commit -m "chore(noldor): whitelist .noldor/classification/ for Phase 0 outputs"
```

---

### Task 7: Classifier entrypoint — wires it all up + writes outputs

**Files:**

- Create: `packages/noldor/scripts/migration/classify-feature-track.ts`
- Modify: `package.json` (root) — add `noldor:classify` script.

- [ ] **Step 1: Read root package.json scripts**

```bash
grep -A 30 '"scripts":' package.json | head -40
```

Expected: shows existing `pnpm <foo>` scripts. Find a sensible insertion point.

- [ ] **Step 2: Add `noldor:classify` script**

Add this entry to root `package.json` `scripts` object (alongside existing `noldor:*` entries if any, else in alphabetical position):

```json
"noldor:classify": "tsx packages/noldor/scripts/migration/classify-feature-track.ts"
```

- [ ] **Step 3: Write the entrypoint**

Create `packages/noldor/scripts/migration/classify-feature-track.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Phase 0 classifier entrypoint.
 *
 * Reads (via reused loaders from packages/noldor/src/):
 *   - docs/features/*.md            via loadSddFeatures
 *   - docs/roadmap.md               via parseRoadmap
 *   - docs/backlog.md               via parseBacklog
 *   - docs/superpowers/plans/*.md   filename only (classifyPlanOrSpec)
 *   - docs/superpowers/specs/*.md   filename only (classifyPlanOrSpec)
 *   - ideas.md                      local-only audit, gitignored — see note below
 *
 * Emits to `.noldor/classification/` (columnar: `<type>\t<id>` per line):
 *   - framework.txt — all framework entries
 *   - product.txt — all product entries
 *   - ambiguous.txt — needs operator review
 *   - cross-tree-links.txt — findings from auditCrossTreeLinks
 *
 * `<type>` is one of `feature`, `roadmap`, `backlog`, `plan`, `spec`.
 *
 * Idempotency: this script clobbers the four output files on every run.
 * Safe to re-run BEFORE Task 8 (operator manual review). DO NOT re-run AFTER
 * Task 8 — re-running will overwrite operator reclassifications.
 *
 * Spec: docs/superpowers/specs/2026-05-28-framework-doc-extraction-design.md § Phase 0.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { loadSddFeatures } from '../../src/garden/sdd-report.ts';
import { parseBacklog, parseRoadmap } from '../../src/utils/parse-blocks.ts';
import { classifyFeature, classifyPlanOrSpec, type Track } from './classify.ts';
import { auditCrossTreeLinks, type FeatureRecord } from './cross-tree-link-audit.ts';

const OUT_DIR = '.noldor/classification';

interface BucketLine {
  readonly type: 'feature' | 'roadmap' | 'backlog' | 'plan' | 'spec';
  readonly id: string;
}

function formatLine(b: BucketLine): string {
  return `${b.type}\t${b.id}`;
}

async function listMarkdownFilenames(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith('.md'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

async function main(): Promise<void> {
  // ─── Features ────────────────────────────────────────────────────────
  const features = await loadSddFeatures('docs/features');

  const featureTracks = new Map<string, Track>();
  for (const f of features) {
    featureTracks.set(
      f.slug,
      classifyFeature({
        slug: f.slug,
        name: f.frontmatter.name ?? f.slug,
        area: f.frontmatter.area ?? '',
      }),
    );
  }

  const framework: BucketLine[] = [];
  const product: BucketLine[] = [];
  const ambiguous: BucketLine[] = [];

  for (const [slug, track] of featureTracks) {
    const line: BucketLine = { type: 'feature', id: slug };
    if (track === 'framework') framework.push(line);
    else if (track === 'product') product.push(line);
    else ambiguous.push(line);
  }

  // ─── Roadmap + backlog (schema-C blocks) ─────────────────────────────
  const roadmapRaw = await readFileOrEmpty('docs/roadmap.md');
  const backlogRaw = await readFileOrEmpty('docs/backlog.md');

  for (const entry of parseRoadmap(roadmapRaw)) {
    const track = classifyFeature({ slug: entry.slug, name: entry.name, area: entry.area });
    const line: BucketLine = { type: 'roadmap', id: entry.slug || entry.name };
    if (track === 'framework') framework.push(line);
    else if (track === 'product') product.push(line);
    else ambiguous.push(line);
  }
  for (const entry of parseBacklog(backlogRaw)) {
    const track = classifyFeature({ slug: entry.slug, name: entry.name, area: entry.area });
    const line: BucketLine = { type: 'backlog', id: entry.slug || entry.name };
    if (track === 'framework') framework.push(line);
    else if (track === 'product') product.push(line);
    else ambiguous.push(line);
  }

  // ─── Plans + specs (inherit by FD slug embedded in filename) ─────────
  for (const filename of await listMarkdownFilenames('docs/superpowers/plans')) {
    const track = classifyPlanOrSpec({ filename, featureTracks });
    const line: BucketLine = { type: 'plan', id: filename };
    if (track === 'framework') framework.push(line);
    else if (track === 'product') product.push(line);
    else ambiguous.push(line);
  }
  for (const filename of await listMarkdownFilenames('docs/superpowers/specs')) {
    const track = classifyPlanOrSpec({ filename, featureTracks });
    const line: BucketLine = { type: 'spec', id: filename };
    if (track === 'framework') framework.push(line);
    else if (track === 'product') product.push(line);
    else ambiguous.push(line);
  }

  // ─── ideas.md — gitignored, local-only audit (summary count only) ────
  const ideasRaw = await readFileOrEmpty('ideas.md');
  const ideasBulletCount = ideasRaw.split('\n').filter((l) => /^[-*]\s/.test(l)).length;

  // ─── Cross-tree link audit ───────────────────────────────────────────
  // `loadSddFeatures` returns frontmatter only — no body. Re-read each FD
  // here to extract the markdown body for [[slug]] scanning. Single pass over
  // ~65 small files; cost is negligible.
  const records: FeatureRecord[] = [];
  for (const f of features) {
    const raw = await readFile(join('docs/features', `${f.slug}.md`), 'utf8');
    records.push({
      slug: f.slug,
      deps: (f.frontmatter.deps ?? []) as readonly string[],
      links: { spec: '', code: [], tests: [] },
      body: matter(raw).content,
    });
  }
  const findings = auditCrossTreeLinks({ featureTracks, features: records });

  // ─── Write outputs ───────────────────────────────────────────────────
  await mkdir(OUT_DIR, { recursive: true });

  const byLine = (a: BucketLine, b: BucketLine) =>
    a.type === b.type ? a.id.localeCompare(b.id) : a.type.localeCompare(b.type);

  await writeFile(
    join(OUT_DIR, 'framework.txt'),
    framework.sort(byLine).map(formatLine).join('\n') + '\n',
  );
  await writeFile(
    join(OUT_DIR, 'product.txt'),
    product.sort(byLine).map(formatLine).join('\n') + '\n',
  );
  await writeFile(
    join(OUT_DIR, 'ambiguous.txt'),
    ambiguous.sort(byLine).map(formatLine).join('\n') + '\n',
  );

  const findingsLines = findings.map(
    (f) => `${f.sourceSlug}\t${f.sourceTrack}\t${f.targetSlug}\t${f.targetTrack}\t${f.field}`,
  );
  await writeFile(join(OUT_DIR, 'cross-tree-links.txt'), findingsLines.sort().join('\n') + '\n');

  // ─── Console summary ─────────────────────────────────────────────────
  console.log(
    `classify-feature-track: framework=${framework.length} product=${product.length} ambiguous=${ambiguous.length} cross_tree=${findings.length}`,
  );
  console.log(
    `ideas.md (gitignored, local audit only): ${ideasBulletCount} bullet(s) detected; split mechanism deferred to Phase 4.`,
  );
  console.log(`Wrote .noldor/classification/{framework,product,ambiguous,cross-tree-links}.txt`);

  if (ambiguous.length > 0) {
    console.log(
      `\nAmbiguous entries (${ambiguous.length}) require manual review. Edit .noldor/classification/ambiguous.txt — move each line to framework.txt or product.txt (preserve the columnar <type>\\t<id> format) — then DO NOT re-run this script.`,
    );
  }
}

main().catch((err) => {
  console.error('classify-feature-track failed:', err);
  process.exit(1);
});
```

**`ideas.md` Phase 0 finding:** because the file is gitignored, the classifier only audits it locally and prints a summary count. No per-idea output is committed. The split mechanism described in spec § Phase 4 may require a separate decision (un-gitignore `ideas.md` or keep operator-local indefinitely). Flag this in the PR description so it surfaces during plan-CR for Phase 4 later.

- [ ] **Step 4: Run the classifier (smoke-test the body-extraction glue end-to-end)**

The audit's body-link scan glue (`readFile` + `matter().content` + `auditCrossTreeLinks`) is not covered by a unit test — fixtures for full-FD body parsing are out of scope per Task 1's "no fixtures" rule. End-to-end smoke this glue here:

```bash
pnpm noldor:classify
```

Expected:

1. Prints summary line `classify-feature-track: framework=X product=Y ambiguous=Z cross_tree=N`.
2. Prints `ideas.md (gitignored, local audit only): N bullet(s) detected; split mechanism deferred to Phase 4.` (or `0 bullet(s)` if `ideas.md` doesn't exist).
3. Creates four `.txt` files under `.noldor/classification/`.
4. Exit code 0.

If the cross_tree count is non-zero, manually verify at least one entry by opening the named source FD and confirming the `[[target-slug]]` reference exists in its body. This catches the regression where `f.body` was `undefined` in the prior revision.

- [ ] **Step 5: Eyeball the outputs**

```bash
wc -l .noldor/classification/*.txt
head .noldor/classification/framework.txt
head .noldor/classification/ambiguous.txt
```

Expected (per spec audit; counts are approximate — exact numbers drift as new FDs land between plan writing and plan execution):

- `framework.txt`: ~10–20 feature lines (the 9 prefix-matching framework FDs at writing time, ± drift) + plan/spec/roadmap/backlog lines that inherit. Each line `<type>\t<id>`.
- `product.txt`: ~30–40 feature lines + product plans/specs/roadmap/backlog inherits.
- `ambiguous.txt`: ~10–18 feature lines (framework FDs that don't prefix-match — `architecture-invariants`, `autonomous-plan-to-pr-merge`, etc.).
- `cross-tree-links.txt`: probably empty or very few entries; columns `source\tsource_track\ttarget\ttarget_track\tfield`.

Console line ends with the `ideas.md` summary count (gitignored, audit-only).

If `framework.txt` count is way off, sanity-check by counting FDs: `grep -l '^area: tooling' docs/features/*.md | wc -l` should be ~29.

- [ ] **Step 6: Commit the script + script registration**

```bash
git add package.json packages/noldor/scripts/migration/classify-feature-track.ts
git commit -m "feat(noldor): add classify-feature-track entrypoint + pnpm noldor:classify script"
```

---

### Task 8: Manual review of ambiguous.txt — operator-edited reclassification

This task is operator-driven, not script-driven. The classification snapshot only ships once `ambiguous.txt` is empty.

- [ ] **Step 1: Open `.noldor/classification/ambiguous.txt`**

Operator reads each entry and decides framework vs product manually. Reference: the spec's "Remaining ~14 framework FDs" list names which ambiguous slugs are framework (architecture-invariants, autonomous-plan-to-pr-merge, decouple-milestones-from-semver, parallel-worktree-workflow, replace-roadmap-buckets-with-flat-priority-order, etc.).

- [ ] **Step 2: Manually move each line**

For each line in `ambiguous.txt`, cut it and paste it into either `framework.txt` or `product.txt` (alphabetical order within the file). Save.

After this step, `ambiguous.txt` should be empty (a single newline or blank file).

- [ ] **Step 3: Verify totals are conserved**

```bash
# Total FD count
grep -l '^area: tooling' docs/features/*.md | wc -l
# Sum of feature lines across the three buckets (filter by `^feature\t`)
{ grep -c '^feature	' .noldor/classification/framework.txt; \
  grep -c '^feature	' .noldor/classification/product.txt; \
  grep -c '^feature	' .noldor/classification/ambiguous.txt; } | paste -sd+ - | bc
```

The sum across the three buckets (feature-type lines only) must equal the total FD count. After Task 8, `ambiguous.txt` should have zero feature-type lines.

**IMPORTANT: do NOT re-run `pnpm noldor:classify` after this task.** Re-running clobbers the operator reclassification. The script is idempotent only with respect to the source markdown — it has no awareness of operator edits to the output files.

**Phase 1 follow-up (deferred, not in this plan):** a future revision of `classify-feature-track.ts` should add a `--apply` / `--dry-run` flag pair plus a script-side guard that refuses to re-run after operator reclassification (e.g. via a content-hash compare against the last script-generated state). This is intentionally **out of scope** for Phase 0 — adding it inline would double the script's surface area for marginal value when only one Phase 0 reclassification ever runs. The plan flags the requirement for Phase 1's plan author.

- [ ] **Step 4: Commit the operator-reclassified snapshot**

```bash
git add .noldor/classification/
git commit -m "chore(noldor): manual reclassification of ambiguous Phase 0 entries"
```

---

### Task 9: Cross-tree-links sanity check + (optional) operator review

- [ ] **Step 1: Read `.noldor/classification/cross-tree-links.txt`**

```bash
cat .noldor/classification/cross-tree-links.txt
```

If empty: skip Steps 2–3.

- [ ] **Step 2: For each finding, decide on the resolution**

Per spec § Phase 2: default = **inline downgrade** (no operator decision needed). The two opt-out paths are:

- **Parent move** — recategorise one of the two FDs so the link becomes same-tree.
- **Extended dual-root resolver** — keep the machine link; Phase 1's resolver handles it.

Either override is recorded by editing `cross-tree-links.txt` inline (operator appends ` # parent-move` or ` # extend-resolver` after the finding line). Default findings stay un-annotated → script auto-downgrades them at Phase 2.

- [ ] **Step 3: Commit any operator annotations**

```bash
git diff .noldor/classification/cross-tree-links.txt
# If annotations were added:
git add .noldor/classification/cross-tree-links.txt
git commit -m "chore(noldor): annotate cross-tree-links overrides for Phase 2"
```

---

### Task 10: End-of-Phase-0 verification

- [ ] **Step 1: Run all tests one more time**

```bash
pnpm --filter noldor test --run
pnpm test --run  # workspace-wide
```

Expected: green.

- [ ] **Step 2: Sanity-check the FD validates cleanly**

```bash
pnpm noldor validate features
```

Expected: `Validated <N> feature MD(s) — all OK.` (where `<N>` is the current FD count; do not hardcode — `<N>` drifts as new FDs land between plan writing and plan execution.)

- [ ] **Step 3: Run garden detect for drift**

```bash
pnpm noldor garden detect
```

Expected: no new drift introduced by Phase 0 (the classification files are tracked + ignored-list-aware).

- [ ] **Step 4: Confirm `.noldor/classification/` is in working tree**

```bash
git ls-files .noldor/classification/
```

Expected: four `.txt` files listed.

- [ ] **Step 5: This is the end of Phase 0**

No final commit beyond what each task already committed. The PR for Phase 0 contains:

1. `chore(noldor): scaffold scripts/migration/ + extend vitest include`
2. `feat(noldor): add pure classifyFeature logic + tests`
3. `feat(noldor): add classifyRoadmapEntry alias + tests`
4. `feat(noldor): add classifyPlanOrSpec (longest-slug match) + tests`
5. `feat(noldor): add cross-tree link audit + tests`
6. `chore(noldor): whitelist .noldor/classification/ for Phase 0 outputs`
7. `feat(noldor): add classify-feature-track entrypoint + pnpm noldor:classify script`
8. `chore(noldor): manual reclassification of ambiguous Phase 0 entries`
9. `chore(noldor): annotate cross-tree-links overrides for Phase 2` (only if findings existed)

Phase 1 (pkg doc home + data-layer parametrisation) ships as a separate `full-attach` session in the next cycle.

---

## Self-review checklist

**Spec coverage (Phase 0 deliverables from the spec):**

- ✅ classify-feature-track.ts (Task 7)
- ✅ Located at `packages/noldor/scripts/migration/` (Tasks 1, 7)
- ✅ Emits four files to `.noldor/classification/` (Task 7)
- ✅ Whitelist in `.noldor/.gitignore` (Task 6)
- ✅ Manual review of `ambiguous.txt` (Task 8)
- ✅ Cross-tree link audit (Task 5, Task 9)
- ✅ Snapshot committed for Phase 2 consumption (Task 8)

**Spec items NOT in this plan (deliberately deferred):**

- Phase 1 deliverables (pkg doc home, `loadDocRoots()`, parametrised readers) — separate plan.
- Phase 2 (`move-feature.ts`) — separate plan.
- The `pnpm noldor classify-feature-track` proper subcommand (vs the interim `pnpm noldor:classify` script) — Phase 6 when `files:` allowlist is in place.

**Placeholder scan:** None. Each step contains the actual code or command.

**Type consistency:**

- `Track` defined in `classify.ts` (Task 2), used by audit (Task 5), entrypoint (Task 7), tests.
- `FeatureRecord` (migration-local) defined in `cross-tree-link-audit.ts` (Task 5), used in entrypoint (Task 7). The `links.{spec,code,tests}` fields are placeholders for the Phase 2 extended-resolver path; the Phase 0 audit reads only `deps` + `body`.
- `classifyFeature` / `classifyRoadmapEntry` / `classifyPlanOrSpec` signatures consistent. `classifyRoadmapEntry` is an alias for `classifyFeature`.
- The entrypoint imports `loadSddFeatures` (returns `src/garden/sdd-report.ts`'s `FeatureRecord` — a different type) and maps it onto the migration's `FeatureRecord` shape inline; both types co-exist under distinct module paths.

**Frequency of commits:** 9 commits across 10 tasks. Each task ends in a commit. Each commit is reviewable on its own.
