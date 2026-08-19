# pen.dev UI Design Phase (Part 1: Predicate + Freshness Engine) Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Land the code half of the UI-design stage: `consumer.uiPaths`/`uiSurfaces` config, the UI predicate with its verdict record, the session-marker + FD-frontmatter fields, and the per-surface ancestry-based freshness check with its CLI, release-preflight probe and doctor advisory. Ships alone: everything is inert until a consumer configures `uiPaths`.

**Architecture:** New pure module `src/core/ui-predicate.ts` (verdict + surface resolution), new `src/release/ui-design-freshness.ts` (git-ancestry engine, mirrors `graph-freshness.ts`), new `src/checks/check-ui-design-freshness.ts` CLI. Schema extensions in `src/core/consumer-config.ts`, `src/core/session.ts`, and the features frontmatter schema. Spec: [2026-08-19-pendev-ui-design-phase-design.md](../specs/2026-08-19-pendev-ui-design-phase-design.md) units U1, U2, U7 + the schema halves of U3/U4.

**Tech Stack:** TypeScript (ESM, strict), zod, minimatch, vitest, node:child_process execFile for git.

---

## File Structure

- `src/core/consumer-config.ts` — add optional `uiPaths` + `uiSurfaces` to `ConsumerConfigSchema` (modify)
- `src/core/ui-predicate.ts` — `UiVerdict`, `isUiBearing`, `expandCandidateValue`, `affectedSurfaces`, `sessionUiVerdict` (create)
- `src/core/__tests__/ui-predicate.test.ts` — truth-table + expansion + surface matrix (create)
- `src/core/__tests__/consumer-config.test.ts` — schema acceptance rows for the two new fields (modify)
- `src/core/session.ts` — add `uiVerdict`, `uiVerdictPaths`, `uiWaiver` to `SessionMarkerSchema` (modify)
- `src/features/validate-features.ts` — accept `design: required | skip` frontmatter (modify; locate the frontmatter zod schema in this file or the schema module it imports and extend it there)
- `src/release/ui-design-freshness.ts` — per-surface ancestry freshness engine (create)
- `src/release/__tests__/ui-design-freshness.test.ts` — fixture-repo matrix (create)
- `src/checks/check-ui-design-freshness.ts` — CLI: prints per-surface rows, exit contract (create)
- `src/cli/manifest.ts` — register `checks ui-design-freshness` (modify)
- `src/release/preflight-probes.ts` — add `ui-design-freshness` probe beside `graph-freshness` (modify)

---

## Task 1: Consumer config — `uiPaths` + `uiSurfaces`

**Files:**
- Modify: `src/core/consumer-config.ts`
- Test: `src/core/__tests__/consumer-config.test.ts`

- [ ] **Step 1: Write the failing schema tests.** Open `src/core/__tests__/consumer-config.test.ts`, find the existing `describe` block exercising `ConsumerConfigSchema.parse` (grep `ConsumerConfigSchema`), and append inside the top-level describe:

```ts
describe('uiPaths + uiSurfaces', () => {
  const base = {
    name: 'x',
    repoUrl: 'https://example.com/x',
    lockstepPackages: ['pkg'],
    e2ePrefix: 'e2e',
    samplesPath: 'samples',
    packagePrefix: '@x/',
    appPathPrefix: 'app',
  };

  it('both absent parses (back-compat)', () => {
    expect(() => ConsumerConfigSchema.parse(base)).not.toThrow();
  });

  it('accepts uiPaths globs and a surface map', () => {
    const cfg = ConsumerConfigSchema.parse({
      ...base,
      uiPaths: ['src/dashboard/app/**'],
      uiSurfaces: { dashboard: ['src/dashboard/app/**'] },
    });
    expect(cfg.uiPaths).toEqual(['src/dashboard/app/**']);
    expect(cfg.uiSurfaces).toEqual({ dashboard: ['src/dashboard/app/**'] });
  });

  it('rejects negation globs in uiPaths', () => {
    expect(() => ConsumerConfigSchema.parse({ ...base, uiPaths: ['!src/a/**'] })).toThrow();
  });

  it('rejects empty-string globs in uiPaths', () => {
    expect(() => ConsumerConfigSchema.parse({ ...base, uiPaths: [''] })).toThrow();
  });

  it('rejects a uiSurfaces entry with an empty glob list', () => {
    expect(() => ConsumerConfigSchema.parse({ ...base, uiSurfaces: { app: [] } })).toThrow();
  });

  it('rejects a non-slug surface name', () => {
    expect(() =>
      ConsumerConfigSchema.parse({ ...base, uiSurfaces: { 'Bad Name': ['a/**'] } }),
    ).toThrow();
  });

  it('rejects negation globs inside uiSurfaces lists', () => {
    expect(() =>
      ConsumerConfigSchema.parse({ ...base, uiSurfaces: { app: ['!a/**'] } }),
    ).toThrow();
  });
});
```

If the existing test file builds its own `base` fixture, reuse that fixture object instead of the literal above (keep required fields identical to what the file already passes).

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/core/__tests__/consumer-config.test.ts
```

Expected output: the new `uiPaths + uiSurfaces` tests fail — `accepts uiPaths globs and a surface map` throws because the strict schema rejects unknown key `uiPaths`.

- [ ] **Step 3: Implement the schema fields.** In `src/core/consumer-config.ts`, add above `ConsumerConfigSchema`:

```ts
/**
 * A repo-relative POSIX minimatch glob for UI-surface config. Negation is
 * rejected in v1 (the predicate defines no subtraction semantics), and the
 * schema — not the matcher — is where that contract is enforced.
 */
const UiGlobSchema = z
  .string()
  .min(1)
  .refine((g) => !g.startsWith('!'), { message: 'negation globs are not supported in uiPaths/uiSurfaces' });

/** Baseline surface names become `docs/design/ui/baseline/<name>.pen` — keep them slug-shaped. */
const SURFACE_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
```

Then inside the `ConsumerConfigSchema` object, after the `dev` field, add:

```ts
    /**
     * Globs naming this consumer's UI source (e.g. `src/dashboard/app/**`).
     * Drives the UI-design-stage predicate (`src/core/ui-predicate.ts`).
     * Absent or empty ⇒ the design stage never fires for this consumer.
     */
    uiPaths: z.array(UiGlobSchema).optional(),
    /**
     * Surface name → glob subset, mapping UI code to baseline files
     * `docs/design/ui/baseline/<surface>.pen`. Absent with `uiPaths` present ⇒
     * one implicit surface `app` covering all of `uiPaths`.
     */
    uiSurfaces: z
      .record(z.string().regex(SURFACE_NAME_RE), z.array(UiGlobSchema).min(1))
      .optional(),
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/core/__tests__/consumer-config.test.ts
```

Expected output: all tests pass, including the seven new ones.

- [ ] **Step 5: Commit.**

```bash
git add src/core/consumer-config.ts src/core/__tests__/consumer-config.test.ts
git commit -m "feat(core): add uiPaths + uiSurfaces to consumer config schema" -m "Noldor-FD: pendev-ui-design-phase"
```

## Task 2: UI predicate module

**Files:**
- Create: `src/core/ui-predicate.ts`
- Test: `src/core/__tests__/ui-predicate.test.ts`

- [ ] **Step 1: Write the failing tests** at `src/core/__tests__/ui-predicate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  expandCandidateValue,
  isUiBearing,
  sessionUiVerdict,
} from '../ui-predicate.js';

const FILES = [
  'src/dashboard/app/page.tsx',
  'src/dashboard/app/nested/chart.tsx',
  'src/core/session.ts',
  'docs/roadmap.md',
];

describe('isUiBearing', () => {
  it('true when any path matches any glob', () => {
    expect(isUiBearing(['src/dashboard/app/page.tsx'], ['src/dashboard/app/**'])).toBe(true);
  });
  it('false on no match', () => {
    expect(isUiBearing(['src/core/session.ts'], ['src/dashboard/app/**'])).toBe(false);
  });
  it('false on empty inputs', () => {
    expect(isUiBearing([], ['src/dashboard/app/**'])).toBe(false);
    expect(isUiBearing(['src/a.ts'], [])).toBe(false);
  });
  it('matches dotfiles ({ dot: true } semantics)', () => {
    expect(isUiBearing(['src/dashboard/app/.env.tsx'], ['src/dashboard/app/**'])).toBe(true);
  });
});

describe('expandCandidateValue', () => {
  it('passes a concrete path through', () => {
    expect(expandCandidateValue('src/core/session.ts', FILES, () => false)).toEqual([
      'src/core/session.ts',
    ]);
  });
  it('expands a glob value against the file list via minimatch', () => {
    expect(expandCandidateValue('src/dashboard/**', FILES, () => false)).toEqual([
      'src/dashboard/app/page.tsx',
      'src/dashboard/app/nested/chart.tsx',
    ]);
  });
  it('expands brace patterns with minimatch semantics', () => {
    expect(expandCandidateValue('src/{core,dashboard}/**', FILES, () => false)).toHaveLength(3);
  });
  it('treats an existing directory as <dir>/**', () => {
    expect(expandCandidateValue('src/dashboard', FILES, (p) => p === 'src/dashboard')).toEqual([
      'src/dashboard/app/page.tsx',
      'src/dashboard/app/nested/chart.tsx',
    ]);
  });
  it('a value expanding to nothing contributes nothing', () => {
    expect(expandCandidateValue('src/nothing/**', FILES, () => false)).toEqual([]);
  });
});

describe('sessionUiVerdict truth table', () => {
  const ui = ['src/dashboard/app/**'];
  const surfaces = { dashboard: ['src/dashboard/app/**'] };
  const hit = ['src/dashboard/app/page.tsx'];

  it('row 1: FD design: skip wins over everything', () => {
    const v = sessionUiVerdict({ design: 'skip' }, hit, { uiPaths: ui, uiSurfaces: surfaces });
    expect(v.verdict).toBe('skip');
  });
  it('row 2: FD design: required is absolute — even without uiPaths', () => {
    const v = sessionUiVerdict({ design: 'required' }, [], {});
    expect(v.verdict).toBe('required');
    expect(v.affectedSurfaces).toEqual([]);
  });
  it('row 3: no override, uiPaths absent → skip', () => {
    expect(sessionUiVerdict({}, hit, {}).verdict).toBe('skip');
    expect(sessionUiVerdict({}, hit, { uiPaths: [] }).verdict).toBe('skip');
  });
  it('row 4: no override, intersection non-empty → required with surfaces', () => {
    const v = sessionUiVerdict({}, hit, { uiPaths: ui, uiSurfaces: surfaces });
    expect(v.verdict).toBe('required');
    expect(v.affectedSurfaces).toEqual(['dashboard']);
    expect(v.unmappedPaths).toEqual([]);
  });
  it('row 5: no override, empty intersection or empty candidates → skip', () => {
    expect(sessionUiVerdict({}, ['src/core/session.ts'], { uiPaths: ui }).verdict).toBe('skip');
    expect(sessionUiVerdict({}, [], { uiPaths: ui }).verdict).toBe('skip');
  });
  it('implicit app surface when uiSurfaces absent', () => {
    const v = sessionUiVerdict({}, hit, { uiPaths: ui });
    expect(v.affectedSurfaces).toEqual(['app']);
  });
  it('config gap: matching path with no surface entry → unmappedPaths, still required', () => {
    const v = sessionUiVerdict({}, hit, {
      uiPaths: ['src/dashboard/app/**'],
      uiSurfaces: { other: ['src/other/**'] },
    });
    expect(v.verdict).toBe('required');
    expect(v.affectedSurfaces).toEqual([]);
    expect(v.unmappedPaths).toEqual(hit);
  });
  it('multi-surface: paths spanning two surfaces affect both, sorted', () => {
    const v = sessionUiVerdict(
      {},
      ['src/a/x.tsx', 'src/b/y.tsx'],
      { uiPaths: ['src/a/**', 'src/b/**'], uiSurfaces: { beta: ['src/b/**'], alpha: ['src/a/**'] } },
    );
    expect(v.affectedSurfaces).toEqual(['alpha', 'beta']);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/core/__tests__/ui-predicate.test.ts
```

Expected output: module resolution error — `src/core/ui-predicate.ts` does not exist.

- [ ] **Step 3: Implement** `src/core/ui-predicate.ts`:

```ts
// @tests: pendev-ui-design-phase
// UI-design-stage predicate: which sessions are UI-bearing, and which baseline
// surfaces they affect. Pure — callers inject the candidate paths, the config
// slice and (for expansion) the repo file list. Matching reuses the repo's one
// minimatch idiom (`{ dot: true }`, see src/core/allowlist.ts) so uiPaths
// globs behave exactly like every other glob the framework consumes.

import { minimatch } from 'minimatch';

/** Verdict + everything downstream quantifies over (spec U2). */
export interface UiVerdict {
  verdict: 'required' | 'skip';
  /** Sorted names of surfaces whose globs matched ≥1 candidate path. */
  affectedSurfaces: string[];
  /** Candidate paths that matched `uiPaths` but no declared surface — config gaps. */
  unmappedPaths: string[];
}

/** The FD frontmatter slice the predicate reads. `design` is operator-only. */
export interface UiFrontmatter {
  design?: 'required' | 'skip';
}

/** The consumer-config slice the predicate reads. */
export interface UiConfig {
  uiPaths?: string[];
  uiSurfaces?: Record<string, string[]>;
}

const GLOB_META_RE = /[*?[{]/;
const IMPLICIT_SURFACE = 'app';

const matches = (path: string, glob: string): boolean => minimatch(path, glob, { dot: true });

/** True when any concrete path matches any glob. Empty inputs prove nothing → false. */
export function isUiBearing(paths: string[], uiPaths: string[]): boolean {
  if (paths.length === 0 || uiPaths.length === 0) return false;
  return paths.some((p) => uiPaths.some((g) => matches(p, g)));
}

/**
 * Expand one `Touches:` / `links.code` value into concrete repo paths. One
 * pattern language everywhere: glob values are minimatch patterns evaluated
 * against the caller-provided file list (`git ls-files` output), never git
 * pathspecs. An existing directory reads as `<dir>/**`. Concrete paths pass
 * through untouched (they need not exist — ship-time diffs are authoritative).
 */
export function expandCandidateValue(
  value: string,
  repoFiles: readonly string[],
  isDirectory: (path: string) => boolean,
): string[] {
  const pattern = GLOB_META_RE.test(value)
    ? value
    : isDirectory(value)
      ? `${value.replace(/\/$/, '')}/**`
      : null;
  if (pattern === null) return [value];
  return repoFiles.filter((f) => matches(f, pattern));
}

/**
 * The U2 truth table. FD `design:` override first (absolute in both
 * directions), then glob intersection; surface resolution rides the verdict so
 * callers never re-derive it. A `required` verdict may carry zero affected
 * surfaces (override without config, or config gaps) — the design step, not
 * this function, enforces the zero-affected-surfaces rule.
 */
export function sessionUiVerdict(
  fd: UiFrontmatter,
  candidatePaths: readonly string[],
  config: UiConfig,
): UiVerdict {
  const uiPaths = config.uiPaths ?? [];
  const matching = candidatePaths.filter((p) => uiPaths.some((g) => matches(p, g)));

  const resolveSurfaces = (paths: string[]): Pick<UiVerdict, 'affectedSurfaces' | 'unmappedPaths'> => {
    if (config.uiSurfaces === undefined) {
      return { affectedSurfaces: paths.length > 0 ? [IMPLICIT_SURFACE] : [], unmappedPaths: [] };
    }
    const affected = new Set<string>();
    const unmapped: string[] = [];
    for (const p of paths) {
      const owners = Object.entries(config.uiSurfaces).filter(([, globs]) =>
        globs.some((g) => matches(p, g)),
      );
      if (owners.length === 0) unmapped.push(p);
      for (const [name] of owners) affected.add(name);
    }
    return { affectedSurfaces: [...affected].sort(), unmappedPaths: unmapped };
  };

  if (fd.design === 'skip') return { verdict: 'skip', affectedSurfaces: [], unmappedPaths: [] };
  if (fd.design === 'required') return { verdict: 'required', ...resolveSurfaces(matching) };
  if (uiPaths.length === 0 || matching.length === 0) {
    return { verdict: 'skip', affectedSurfaces: [], unmappedPaths: [] };
  }
  return { verdict: 'required', ...resolveSurfaces(matching) };
}
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/core/__tests__/ui-predicate.test.ts
```

Expected output: all tests pass (4 + 5 + 9 cases).

- [ ] **Step 5: Commit.**

```bash
git add src/core/ui-predicate.ts src/core/__tests__/ui-predicate.test.ts
git commit -m "feat(core): UI predicate — verdict record, surface resolution, candidate expansion" -m "Noldor-FD: pendev-ui-design-phase"
```

## Task 3: Session-marker + FD-frontmatter fields

**Files:**
- Modify: `src/core/session.ts`
- Modify: `src/features/validate-features.ts` (or the frontmatter schema module it imports — locate `FeatureFrontmatter`'s zod schema with `grep -rn "FeatureFrontmatter" src/features/ src/core/` and edit where the zod object lives)
- Test: `src/core/__tests__/session.test.ts`, `src/features/__tests__/validate-features.test.ts`

- [ ] **Step 1: Write the failing session tests.** In `src/core/__tests__/session.test.ts` (create the describe if the file groups differently, matching its existing style):

```ts
describe('ui-design fields', () => {
  const base = { path: 'full-new', slug: 's', startedAt: '2026-08-19T00:00:00Z' };

  it('accepts uiVerdict + uiVerdictPaths + uiWaiver', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        ...base,
        uiVerdict: 'required',
        uiVerdictPaths: ['src/dashboard/app/page.tsx'],
        uiWaiver: { reason: 'pencil MCP unavailable', at: '2026-08-19T10:00:00Z' },
      }),
    ).not.toThrow();
  });

  it('rejects an unknown uiVerdict value', () => {
    expect(() => SessionMarkerSchema.parse({ ...base, uiVerdict: 'maybe' })).toThrow();
  });

  it('all three fields are optional (back-compat)', () => {
    expect(() => SessionMarkerSchema.parse(base)).not.toThrow();
  });
});
```

- [ ] **Step 2: Write the failing features tests.** In `src/features/__tests__/validate-features.test.ts`, next to existing frontmatter-field tests, add:

```ts
describe('design frontmatter field', () => {
  it('accepts design: required and design: skip', () => {
    for (const v of ['required', 'skip']) {
      expect(() => FeatureFrontmatterSchema.parse({ ...validFrontmatterFixture, design: v })).not.toThrow();
    }
  });
  it('rejects any other design value', () => {
    expect(() =>
      FeatureFrontmatterSchema.parse({ ...validFrontmatterFixture, design: 'auto' }),
    ).toThrow();
  });
});
```

Use the file's actual exported schema name and its existing valid-frontmatter fixture (grep the test file for how sibling fields like `noldor-tier` are tested and mirror that harness exactly — if validation is exercised through a function rather than the schema, drive these two cases through that same function).

- [ ] **Step 3: Run to verify FAIL.**

```bash
pnpm vitest run src/core/__tests__/session.test.ts src/features/__tests__/validate-features.test.ts
```

Expected output: new cases fail — strict schemas reject the unknown keys `uiVerdict` / `design`.

- [ ] **Step 4: Implement.** In `src/core/session.ts`, inside `SessionMarkerSchema` after `injectedRules`, add:

```ts
    /** Spec-time UI-design verdict (spec U2). Written by the design step; audit + ship-time reconciliation input. */
    uiVerdict: z.enum(['required', 'skip']).optional(),
    /** The candidate paths that matched uiPaths when the verdict was computed. */
    uiVerdictPaths: z.array(z.string().min(1)).optional(),
    /** Operator waiver for a required session with no editor (spec U4) — machine-readable, distinguishes waived from missing. */
    uiWaiver: z.object({ reason: z.string().min(1), at: z.string().min(1) }).strict().optional(),
```

In the features frontmatter schema (located in Step 2's grep), add beside `noldor-tier`:

```ts
    /** UI-design-stage override (spec U2): absolute in both directions. Operator-only — no framework code path writes it. */
    design: z.enum(['required', 'skip']).optional(),
```

- [ ] **Step 5: Run to verify PASS.**

```bash
pnpm vitest run src/core/__tests__/session.test.ts src/features/__tests__/validate-features.test.ts
```

Expected output: all pass.

- [ ] **Step 6: Commit.**

```bash
git add src/core/session.ts src/features/ src/core/__tests__/session.test.ts
# ALSO add the frontmatter schema file if Step 2's grep located it outside src/features/
# (e.g. git add src/core/<schema-file>.ts) — the commit must carry the design: field edit.
git commit -m "feat(core): session uiVerdict/uiWaiver fields + FD design: override" -m "Noldor-FD: pendev-ui-design-phase"
```

## Task 4: Freshness engine

**Files:**
- Create: `src/release/ui-design-freshness.ts`
- Test: `src/release/__tests__/ui-design-freshness.test.ts`

- [ ] **Step 1: Write the failing tests.** Mirror the fixture-repo harness used by `src/release/__tests__/graph-freshness.test.ts` (temp dir, `git init`, helper to commit files — copy its `run`/`commit` helpers verbatim if they are local to that file). Cases:

```ts
import { describe, expect, it } from 'vitest';
// + the same tmp-git-repo helpers graph-freshness.test.ts uses

import { evaluateUiDesignFreshness } from '../ui-design-freshness.js';

describe('evaluateUiDesignFreshness', () => {
  it('whole check skipped when uiPaths absent or empty', async () => {
    const repo = await makeRepo(); // helper: git init + one commit
    for (const config of [{}, { uiPaths: [] }]) {
      const v = await evaluateUiDesignFreshness(repo, config);
      expect(v.overall).toBe('skipped');
      expect(v.surfaces).toEqual([]);
    }
  });

  it('uninitialized when surface globs have commits but baseline file is absent', async () => {
    const repo = await makeRepo();
    await commit(repo, 'src/app/page.tsx', 'feat: ui');
    const v = await evaluateUiDesignFreshness(repo, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('uninitialized');
    expect(v.surfaces[0]).toMatchObject({ surface: 'app', status: 'uninitialized' });
  });

  it('per-surface skipped when no commit ever touched the globs', async () => {
    const repo = await makeRepo();
    await commit(repo, 'docs/design/ui/baseline/app.pen', 'docs: baseline');
    const v = await evaluateUiDesignFreshness(repo, { uiPaths: ['src/app/**'] });
    expect(v.surfaces[0].status).toBe('skipped');
  });

  it('fresh when baseline commit is at or after the UI commit (ancestry)', async () => {
    const repo = await makeRepo();
    await commit(repo, 'src/app/page.tsx', 'feat: ui');
    await commit(repo, 'docs/design/ui/baseline/app.pen', 'docs: baseline sync');
    const v = await evaluateUiDesignFreshness(repo, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('fresh');
  });

  it('fresh when one commit touches both (U == B)', async () => {
    const repo = await makeRepo();
    await commitMany(repo, ['src/app/page.tsx', 'docs/design/ui/baseline/app.pen'], 'feat: ui+baseline');
    const v = await evaluateUiDesignFreshness(repo, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('fresh');
  });

  it('stale when UI moved after the baseline, with both commits named', async () => {
    const repo = await makeRepo();
    await commit(repo, 'docs/design/ui/baseline/app.pen', 'docs: baseline');
    await commit(repo, 'src/app/page.tsx', 'feat: ui drift');
    const v = await evaluateUiDesignFreshness(repo, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('stale');
    expect(v.surfaces[0].uiCommit).toBeTruthy();
    expect(v.surfaces[0].baselineCommit).toBeTruthy();
    expect(v.surfaces[0].detail).toContain('ui-sync');
  });

  it('test/doc-only commits do not stale a surface', async () => {
    const repo = await makeRepo();
    await commit(repo, 'docs/design/ui/baseline/app.pen', 'docs: baseline');
    await commit(repo, 'src/app/__tests__/page.test.tsx', 'test: only');
    await commit(repo, 'src/app/README.md', 'docs: only');
    const v = await evaluateUiDesignFreshness(repo, { uiPaths: ['src/app/**'] });
    expect(v.overall).toBe('fresh');
  });

  it('multi-surface worst-of aggregation', async () => {
    const repo = await makeRepo();
    await commit(repo, 'docs/design/ui/baseline/a.pen', 'docs: a');
    await commit(repo, 'src/a/x.tsx', 'feat: a drift');           // a: stale
    await commit(repo, 'src/b/y.tsx', 'feat: b');
    await commit(repo, 'docs/design/ui/baseline/b.pen', 'docs: b'); // b: fresh
    const v = await evaluateUiDesignFreshness(repo, {
      uiPaths: ['src/a/**', 'src/b/**'],
      uiSurfaces: { a: ['src/a/**'], b: ['src/b/**'] },
    });
    expect(v.overall).toBe('stale');
    expect(v.surfaces.map((s) => [s.surface, s.status])).toEqual([
      ['a', 'stale'],
      ['b', 'fresh'],
    ]);
  });
});
```

Diverged-branch / shallow-clone cases: assert via the decision function directly rather than building exotic repos — export the pure `classifyAncestry(uiIsAncestorOfBaseline: boolean, baselineIsAncestorOfUi: boolean)` helper (exact Task 4 Step 3 signature and parameter order; no separate `equal` parameter — `git merge-base --is-ancestor A A` is true, so `U == B` already lands in the first argument) and test its three rows (`uiIsAncestorOfBaseline→fresh`, `baselineIsAncestorOfUi (only)→stale`, `neither→skipped`).

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/release/__tests__/ui-design-freshness.test.ts
```

Expected output: module resolution error — file does not exist.

- [ ] **Step 3: Implement** `src/release/ui-design-freshness.ts`:

```ts
// @tests: pendev-ui-design-phase
// Per-surface UI-design baseline freshness (spec U7). Same posture as
// graph-freshness.ts — reported, never thrown — but ancestry-based
// (merge-base), never committer timestamps, and evaluated per configured
// surface so one surface's sync cannot mask another's drift.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { UiConfig } from '../core/ui-predicate.js';
import { GRAPH_IRRELEVANT_EXCLUDES } from './graph-freshness.js';

const execFileAsync = promisify(execFile);

export interface UiSurfaceFreshness {
  surface: string;
  status: 'fresh' | 'stale' | 'uninitialized' | 'skipped';
  uiCommit?: string;
  baselineCommit?: string;
  detail: string;
}

export interface UiFreshnessVerdict {
  overall: 'fresh' | 'stale' | 'uninitialized' | 'skipped';
  surfaces: UiSurfaceFreshness[];
}

export const BASELINE_DIR = 'docs/design/ui/baseline';

const REMEDIATION = 'run `pnpm noldor design ui-sync` in a pencil-capable session, then commit';

/**
 * Pure ancestry classifier — the U7 decision procedure, testable without a
 * repo. No `equal` parameter: `git merge-base --is-ancestor A A` exits 0, so
 * the U == B case already arrives as `uiIsAncestorOfBaseline: true`.
 */
export function classifyAncestry(
  uiIsAncestorOfBaseline: boolean,
  baselineIsAncestorOfUi: boolean,
): 'fresh' | 'stale' | 'skipped' {
  if (uiIsAncestorOfBaseline) return 'fresh';
  if (baselineIsAncestorOfUi) return 'stale';
  return 'skipped'; // unrelated / diverged / shallow-cut — never a false red
}

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return { ok: true, stdout: stdout.trim() };
  } catch {
    return { ok: false, stdout: '' };
  }
}

async function latestCommit(cwd: string, paths: string[]): Promise<string> {
  const { stdout } = await git(cwd, ['log', '-1', '--format=%H', '--', ...paths]);
  return stdout;
}

async function isAncestor(cwd: string, a: string, b: string): Promise<boolean> {
  const { ok } = await git(cwd, ['merge-base', '--is-ancestor', a, b]);
  return ok;
}

const RANK: Record<UiSurfaceFreshness['status'], number> = {
  stale: 3,
  uninitialized: 2,
  fresh: 1,
  skipped: 0,
};

/**
 * Evaluate baseline freshness for every configured surface. `config` is the
 * consumer's `uiPaths`/`uiSurfaces` slice; absent/empty `uiPaths` skips the
 * whole check (feature not adopted). Every git failure degrades to a
 * per-surface `skipped` with detail — reported, never thrown.
 */
export async function evaluateUiDesignFreshness(
  cwd: string,
  config: UiConfig,
): Promise<UiFreshnessVerdict> {
  const uiPaths = config.uiPaths ?? [];
  if (uiPaths.length === 0) {
    return { overall: 'skipped', surfaces: [] };
  }

  const shallow = await git(cwd, ['rev-parse', '--is-shallow-repository']);
  if (shallow.ok && shallow.stdout === 'true') {
    return {
      overall: 'skipped',
      surfaces: [
        { surface: '*', status: 'skipped', detail: 'shallow clone — ancestry unavailable' },
      ],
    };
  }

  const surfaceMap: Record<string, string[]> = config.uiSurfaces ?? { app: uiPaths };
  const surfaces: UiSurfaceFreshness[] = [];

  for (const [surface, globs] of Object.entries(surfaceMap).sort(([a], [b]) => a.localeCompare(b))) {
    const baselineFile = `${BASELINE_DIR}/${surface}.pen`;
    // `:(glob)` magic: surface globs are minimatch patterns (predicate side);
    // plain git pathspecs use wildmatch where `*` crosses `/` and `**` degrades.
    // The glob magic makes git honor the same double-star semantics, keeping
    // "one pattern language everywhere" true (the excludes already rely on it,
    // see GRAPH_IRRELEVANT_EXCLUDES in graph-freshness.ts).
    const uiCommit = await latestCommit(cwd, [
      ...globs.map((g) => `:(glob)${g}`),
      ...GRAPH_IRRELEVANT_EXCLUDES,
    ]);
    if (uiCommit === '') {
      surfaces.push({ surface, status: 'skipped', detail: 'no commits touch this surface' });
      continue;
    }
    const baselineCommit = await latestCommit(cwd, [baselineFile]);
    if (baselineCommit === '') {
      surfaces.push({
        surface,
        status: 'uninitialized',
        uiCommit,
        detail: `${baselineFile} does not exist in history — bootstrap: ${REMEDIATION}`,
      });
      continue;
    }
    const status = classifyAncestry(
      await isAncestor(cwd, uiCommit, baselineCommit),
      await isAncestor(cwd, baselineCommit, uiCommit),
    );
    surfaces.push({
      surface,
      status,
      uiCommit,
      baselineCommit,
      detail:
        status === 'fresh'
          ? `baseline at/after UI (${baselineCommit.slice(0, 8)})`
          : status === 'stale'
            ? `UI ${uiCommit.slice(0, 8)} newer than baseline ${baselineCommit.slice(0, 8)} — ${REMEDIATION}`
            : `commits ${uiCommit.slice(0, 8)} / ${baselineCommit.slice(0, 8)} share no ancestry — indeterminate`,
    });
  }

  const overall = surfaces.reduce<UiFreshnessVerdict['overall']>(
    (worst, s) => (RANK[s.status] > RANK[worst] ? s.status : worst),
    'skipped',
  );
  return { overall: surfaces.length === 0 ? 'skipped' : overall, surfaces };
}
```

Note: `GRAPH_IRRELEVANT_EXCLUDES` entries are `:(exclude,glob)` pathspecs — appending them to the surface globs inside one `git log -- <paths>` call is exactly how `graph-freshness.ts` composes them; reuse, don't re-declare.

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/release/__tests__/ui-design-freshness.test.ts
```

Expected output: all matrix cases pass.

- [ ] **Step 5: Commit.**

```bash
git add src/release/ui-design-freshness.ts src/release/__tests__/ui-design-freshness.test.ts
git commit -m "feat(release): per-surface ancestry-based UI-design freshness engine" -m "Noldor-FD: pendev-ui-design-phase"
```

## Task 5: `checks ui-design-freshness` CLI + wiring

**Files:**
- Create: `src/checks/check-ui-design-freshness.ts`
- Modify: `src/cli/manifest.ts`
- Modify: `src/release/preflight-probes.ts`
- Test: `src/checks/__tests__/check-ui-design-freshness.test.ts`

- [ ] **Step 1: Write the failing CLI test** at `src/checks/__tests__/check-ui-design-freshness.test.ts`, exercising the exported `runUiDesignFreshnessCheck(cwd)` result mapper (mirror how sibling `check-*` tests drive their run function; keep process-exit at the entry seam only):

```ts
import { describe, expect, it } from 'vitest';

import { exitCodeFor, renderRows } from '../check-ui-design-freshness.js';

describe('exitCodeFor', () => {
  it('0 on fresh and skipped', () => {
    expect(exitCodeFor('fresh')).toBe(0);
    expect(exitCodeFor('skipped')).toBe(0);
  });
  it('non-zero on stale and uninitialized', () => {
    expect(exitCodeFor('stale')).toBe(1);
    expect(exitCodeFor('uninitialized')).toBe(1);
  });
});

describe('renderRows', () => {
  it('prints one row per surface with status and detail', () => {
    const out = renderRows([
      { surface: 'app', status: 'stale', uiCommit: 'a'.repeat(40), baselineCommit: 'b'.repeat(40), detail: 'drift — run ui-sync' },
    ]);
    expect(out).toContain('app');
    expect(out).toContain('stale');
    expect(out).toContain('ui-sync');
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/checks/__tests__/check-ui-design-freshness.test.ts
```

Expected output: module resolution error.

- [ ] **Step 3: Implement** `src/checks/check-ui-design-freshness.ts` (follow the entry/`runIfDirect` idiom of `src/checks/check-template-sync.ts` — note `src/core/cli-entry.ts` already exists and exports `runIfDirect`):

```ts
// @tests: pendev-ui-design-phase
// CLI wrapper for the UI-design baseline freshness check (spec U7 wiring (a)).
// Advisory or blocking is the CALLER's choice: gate Step 4 ignores the exit
// code (advisory), release preflight blocks on stale. This binary only reports.

import { runIfDirect } from '../core/cli-entry.js';
import { loadConsumerConfig } from '../core/consumer-config.js';
import {
  evaluateUiDesignFreshness,
  type UiSurfaceFreshness,
  type UiFreshnessVerdict,
} from '../release/ui-design-freshness.js';

export function exitCodeFor(overall: UiFreshnessVerdict['overall']): number {
  return overall === 'fresh' || overall === 'skipped' ? 0 : 1;
}

export function renderRows(surfaces: readonly UiSurfaceFreshness[]): string {
  if (surfaces.length === 0) return 'ui-design-freshness: skipped (no uiPaths configured)';
  return surfaces
    .map((s) => `  ${s.surface.padEnd(20)} ${s.status.padEnd(14)} ${s.detail}`)
    .join('\n');
}

export async function main(cwd: string = process.cwd()): Promise<number> {
  const config = loadConsumerConfig(cwd);
  const verdict = await evaluateUiDesignFreshness(cwd, {
    uiPaths: config.uiPaths,
    uiSurfaces: config.uiSurfaces,
  });
  console.log(`ui-design-freshness: ${verdict.overall}`);
  console.log(renderRows(verdict.surfaces));
  return exitCodeFor(verdict.overall);
}

runIfDirect('check-ui-design-freshness.ts', 'checks ui-design-freshness', async () =>
  process.exit(await main()),
);
```

Match `loadConsumerConfig`'s real signature when wiring (it throws when no config — catch and print `skipped (no consumer config)` returning 0, consistent with the check being inert for non-adopters). `runIfDirect` takes `(stem, label, main)` — confirm the exact parameter meanings against `src/core/cli-entry.ts` and an existing `check-*` caller before copying.

- [ ] **Step 4: Register in the manifest.** In `src/cli/manifest.ts`, inside the `checks` group's `sub` map after `'template-sync'`, add:

```ts
      'ui-design-freshness': {
        src: 'checks/check-ui-design-freshness.ts',
        desc: 'UI-design baseline freshness per surface; exit 1 on stale/uninitialized — callers choose whether that blocks',
      },
```

- [ ] **Step 5: Add the release-preflight probe.** In `src/release/preflight-probes.ts`: add `'ui-design-freshness'` to the probe id list next to `'graph-freshness'` (line ~47), import the engine, and add beside the `'graph-freshness'` probe implementation (line ~319):

```ts
  'ui-design-freshness': async (ctx) => {
    const verdict = await evaluateUiDesignFreshness(ctx.cwd, uiConfigSlice(ctx));
    if (verdict.overall === 'skipped') {
      return { id: 'ui-design-freshness', status: 'skipped', detail: 'no uiPaths / shallow' };
    }
    if (verdict.overall === 'fresh') {
      return { id: 'ui-design-freshness', status: 'ok', detail: 'all surfaces fresh' };
    }
    if (verdict.overall === 'uninitialized') {
      // v1: adoption must not brick releases — advisory only.
      return {
        id: 'ui-design-freshness',
        status: 'skipped',
        detail: `uninitialized surfaces: ${verdict.surfaces.filter((s) => s.status === 'uninitialized').map((s) => s.surface).join(', ')} (advisory)`,
      };
    }
    return {
      id: 'ui-design-freshness',
      status: 'fail',
      detail: verdict.surfaces
        .filter((s) => s.status === 'stale')
        .map((s) => `${s.surface}: ${s.detail}`)
        .join('; '),
    };
  },
```

Mirror the exact `ProbeResult` field names and the ctx shape the `graph-freshness` probe uses (read that probe first; `uiConfigSlice` means "however that probe reaches consumer config through ctx — reuse the same access path"). Check `pnpm noldor validate script-catalog` requirements for new manifest rows (the catalog gate from PR #217 may require a docs row — run it and follow its error if red).

- [ ] **Step 6: Run to verify PASS + full gates.**

```bash
pnpm vitest run src/checks/__tests__/check-ui-design-freshness.test.ts
pnpm noldor checks ui-design-freshness
pnpm typecheck && pnpm vitest run src/release src/core src/checks src/features
```

Expected output: unit tests pass; the CLI prints `ui-design-freshness: skipped` (this repo configures no `uiPaths`) and exits 0; typecheck + suites green.

- [ ] **Step 7: Commit.**

```bash
git add src/checks/check-ui-design-freshness.ts src/checks/__tests__/check-ui-design-freshness.test.ts src/cli/manifest.ts src/release/preflight-probes.ts
git commit -m "feat(checks): ui-design-freshness CLI + release preflight probe" -m "Noldor-FD: pendev-ui-design-phase"
```

## Task 6: Doctor advisory

**Files:**
- Modify: the doctor probe registry (locate with `grep -rn "doctor" src/cli/manifest.ts` then read the doctor implementation it dispatches to; add the advisory where sibling advisory probes live)
- Test: extend the doctor's existing probe-list test

- [ ] **Step 1: Read the doctor implementation** found via the grep; identify how an advisory (non-blocking) probe is declared and how probes surface `skipped`.
- [ ] **Step 2: Add a failing test row** to the doctor's probe-list test asserting a probe named `ui-design-freshness` exists and is advisory; run it to verify FAIL (exact command: the doctor test file's `pnpm vitest run <path>`).
- [ ] **Step 3: Implement** — register a probe that calls `evaluateUiDesignFreshness` with the consumer-config slice and maps `stale`/`uninitialized` to the doctor's advisory-warning shape (never a hard fail), `fresh`/`skipped` to ok/skip.
- [ ] **Step 4: Run to verify PASS**, then run `pnpm noldor doctor` and confirm the new row renders as skipped on this repo.
- [ ] **Step 5: Commit.**

```bash
git add src/
git commit -m "feat(doctor): advisory ui-design-freshness probe" -m "Noldor-FD: pendev-ui-design-phase"
```

(Task 6 names no exact code because the doctor's probe shape must be read first; every decision it needs is pinned above — advisory mapping, engine call, config slice. If doctor probes turn out to live in the same `preflight-probes.ts` registry, this task collapses into verifying Task 5's probe renders in doctor and the test row.)
