# Specs-Only Tier Produces a Spec File — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip the `specs-only` tier to produce a spec file (not a plan), and update all hooks / framework docs / skill prompts atomically in a single PR. **No new tier is introduced — the roster stays at 2 tiers (`specs-only`, `full`).** The 29 existing FDs tagged `noldor-tier: specs-only` keep their tag (the label is a historical carryover; the legacy plan-producing behavior simply ceases to be reachable from `/gate` after this PR).

**Architecture:** Single-PR atomic rollout. The `specs-only-*` path enum strings stay (semantics flip behind them — they now invoke `superpowers:brainstorming` instead of `superpowers:writing-plans`). Hook validators add a spec-file existence check for `specs-only-new` (matching what `full-*` paths already required). Phase-revert detection uses a dedicated `Noldor-Phase-Revert: 1` trailer (not subject-line regex). `SessionMarker` gains an `enhancement` field used by `*-attach` paths; `prepare-commit-msg` emits a `Noldor-Enhancement: <slug>` trailer so `noldor-validate-trailer.ts` can assert the spec filename matches. A `markerVersion: 2` field + Zod refinement guards against pre-flip stale markers (resume-time confusion is the main risk because the enum strings stay the same).

**Tech Stack:** TypeScript 5.9, Zod 3.25 (schema), Vitest 3.2 (tests), tsx (runtime), lefthook (commit hooks), oxlint + oxfmt (lint/format), pnpm (package manager).

**Findings folded in (2026-05-25 CR pass):**

- **High — fragile phase-revert detection fixed:** Phase-revert detection switches from subject-line regex (Unicode `→` arrow + exact wording) to a dedicated `Noldor-Phase-Revert: 1` trailer emitted by the gate-skill phase-revert sequence and read by `noldor-validate-trailer.ts`.
- **High — markerVersion migration tightened:** Session schema adds a Zod refinement that requires `markerVersion === 2` when `path` is `specs-only-new` or `specs-only-attach`. Pre-flip markers without the field are rejected at resume time. A `pnpm noldor:bump-session-marker` helper hand-fixes a stale marker in a known-state worktree.
- **Medium — specs-only-attach hook tightened:** `SessionMarker` gains an `enhancement` field; `prepare-commit-msg` emits a `Noldor-Enhancement: <slug>` trailer; `noldor-validate-trailer.ts` asserts the spec filename ends with `-<enhancement>-design.md`.
- **Medium — Task 8 baseline-diff:** Hard-coded test counts replaced with "no new failures vs. baseline" (baseline captured in Task 8 Step 0).

**Findings dropped (architecture changed):**

- Critical task-ordering bug (no migration needed → no enum-vs-migration ordering issue).
- Migration helper's Node `globSync` concern (no migration helper at all).

---

## File Structure

**New files:**

- `scripts/noldor/bump-session-marker.ts` — helper that hand-fixes a stale `.noldor/session.json` by adding `markerVersion: 2`. Wired via `pnpm noldor:bump-session-marker`.

**Modified files:**

- `scripts/noldor/session.ts` — `SessionMarkerSchema` gains `enhancement` + `markerVersion` fields + refinement. `PATHS` unchanged.
- `scripts/noldor/__tests__/session.test.ts` — new cases for `markerVersion` refinement + `enhancement` field.
- `scripts/hooks/noldor-validate-trailer.ts` — `specs-only-new` requires spec file; `specs-only-attach` + `full-attach` require `Noldor-Enhancement` trailer + enhancement-slug-suffixed spec file; `Noldor-Phase-Revert: 1` trailer bypasses spec-file existence check on `*-attach` paths.
- `scripts/hooks/__tests__/noldor-validate-trailer.test.ts` — new cases for the new behaviors + updates to existing `specs-only-new` / `full-attach` cases.
- `scripts/hooks/noldor-inject-trailers.ts` — read `enhancement` from session marker, emit `Noldor-Enhancement: <slug>` trailer.
- `scripts/hooks/__tests__/noldor-inject-trailers.test.ts` — test that `Noldor-Enhancement` is emitted when session marker has `enhancement`.
- `docs/features/noldor.md` — append enhancement entry under parent FD.
- `docs/features/rename-plan-only-tier-to-specs-only.md` — append `## Follow-up` linking forward to this FD.
- `docs/noldor/complexity-gating.md` — path-matrix rewrite to reflect new `specs-only-*` semantics (Design Spec column flips from ✗ → ✓ for specs-only rows).
- `docs/noldor/lifecycle.md` — mermaid flow + path-list update for new `specs-only-*` semantics.
- `docs/noldor/cr-pipeline.md` — `kind=spec` semantics note for `specs-only-*`.
- `docs/noldor/skill-catalog.md` — refresh tier descriptions if listed.
- `.claude/skills/gate/SKILL.md` — Step 2 path-specific scaffolds (change `specs-only-*` to invoke brainstorming, add enhancement-slug prompt for `*-attach` paths, phase-revert sequence emits `Noldor-Phase-Revert: 1` trailer), Step 2.5 kind-mapping note.
- `.claude/skills/promote/SKILL.md` — tier-picker wording (specs-only label changes from "no brainstorm" to "spec, no plan").
- `.claude/skills/new-feature/SKILL.md` — same tier-picker wording update.
- `package.json` — new `noldor:bump-session-marker` script wiring.

**Deleted files:** None.

---

## Task 1: Inventory — confirm no live spec belongs to a `specs-only` FD

**Files:**

- Read-only inventory.

> **Rationale:** The 29 existing `noldor-tier: specs-only` FDs were tagged before the rename followed through. Confirm none of them have a real spec file under `docs/design/specs/` — they remain label-only carryovers. Live specs should all belong to `full` FDs.

- [ ] **Step 1: List live specs**

```bash
ls docs/design/specs/ | grep -v archive
```

Expected: 3 files, one is the in-flight spec for THIS FD.

- [ ] **Step 2: Verify each live spec's parent FD is `noldor-tier: full`** (excluding this in-flight spec)

```bash
grep "noldor-tier:" docs/features/framework-pr-flow-agent-auto-merge.md docs/features/specs-cr-gate-multi-reviewer.md
```

Expected: both `noldor-tier: full`. This confirms no `specs-only`-tagged FD has a real spec file — the 29 mislabeled FDs are safely label-only.

- [ ] **Step 3: Confirm no external in-flight sessions with `path: specs-only-*`**

```bash
find ~ -path '*/.noldor/session.json' 2>/dev/null -exec grep -l 'specs-only' {} \;
```

Expected: only this current worktree's session marker.

No commit — read-only verification.

---

## Task 2: Extend session schema (markerVersion + enhancement + refinement)

**Files:**

- Modify: `scripts/noldor/session.ts`
- Modify: `scripts/noldor/__tests__/session.test.ts`
- Create: `scripts/noldor/bump-session-marker.ts`
- Modify: `package.json` (new `noldor:bump-session-marker` script)

> **Rationale:** The semantics of `specs-only-*` paths flip behind the same enum strings. A stale `.noldor/session.json` from before this PR would silently execute the new flow on resume — confusing the operator mid-feature. The `markerVersion: 2` field + Zod refinement gates against this. The `enhancement` field tightens the `specs-only-attach` / `full-attach` filename assertion downstream.

- [ ] **Step 1: Write failing tests**

Append to `scripts/noldor/__tests__/session.test.ts`:

```typescript
describe('SessionMarker markerVersion field', () => {
  it('rejects specs-only-new without markerVersion (pre-flip stale marker)', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'specs-only-new',
        slug: 'foo',
        startedAt: '2026-05-25T00:00:00Z',
      }),
    ).toThrow();
  });

  it('rejects specs-only-attach without markerVersion (pre-flip stale marker)', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'specs-only-attach',
        parent: 'foo',
        startedAt: '2026-05-25T00:00:00Z',
      }),
    ).toThrow();
  });

  it('accepts specs-only-new when markerVersion: 2', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'specs-only-new',
        slug: 'foo',
        startedAt: '2026-05-25T00:00:00Z',
        markerVersion: 2,
      }),
    ).not.toThrow();
  });

  it('accepts full-attach without markerVersion (no semantic conflict)', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'full-attach',
        parent: 'foo',
        startedAt: '2026-05-25T00:00:00Z',
      }),
    ).not.toThrow();
  });

  it('rejects markerVersion values other than 2', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'specs-only-new',
        slug: 'foo',
        startedAt: '2026-05-25T00:00:00Z',
        markerVersion: 1,
      }),
    ).toThrow();
  });
});

describe('SessionMarker enhancement field', () => {
  it('accepts enhancement on specs-only-attach', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'specs-only-attach',
        parent: 'noldor',
        enhancement: 'my-enhancement',
        startedAt: '2026-05-25T00:00:00Z',
        markerVersion: 2,
      }),
    ).not.toThrow();
  });

  it('accepts enhancement on full-attach', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'full-attach',
        parent: 'noldor',
        enhancement: 'my-enhancement',
        startedAt: '2026-05-25T00:00:00Z',
      }),
    ).not.toThrow();
  });

  it('allows enhancement to be absent', () => {
    expect(() =>
      SessionMarkerSchema.parse({
        path: 'full-attach',
        parent: 'noldor',
        startedAt: '2026-05-25T00:00:00Z',
      }),
    ).not.toThrow();
  });
});
```

Existing tests that use `path: 'specs-only-new'` without `markerVersion` will start failing — update them to include `markerVersion: 2`.

- [ ] **Step 2: Run failing tests**

```bash
pnpm vitest run scripts/noldor/__tests__/session.test.ts 2>&1 | tail -15
```

- [ ] **Step 3: Update `session.ts`**

```typescript
const SPECS_ONLY_PATHS: ReadonlySet<Path> = new Set(['specs-only-new', 'specs-only-attach']);

export const SessionMarkerSchema = z
  .object({
    path: z.enum(PATHS),
    slug: z.string().min(1).optional(),
    parent: z.string().min(1).optional(),
    enhancement: z.string().min(1).optional(),
    startedAt: z.string().min(1),
    autonomous: z.boolean().optional(),
    markerVersion: z.literal(2).optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (SPECS_ONLY_PATHS.has(m.path) && m.markerVersion !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `Session marker for path '${m.path}' must declare markerVersion: 2. ` +
          `Pre-flip markers without the field have stale semantics — re-pick path via /gate, ` +
          `or run 'pnpm noldor:bump-session-marker' from the worktree root.`,
        path: ['markerVersion'],
      });
    }
  });
```

`PATHS` stays unchanged. No new path enum values.

- [ ] **Step 4: All tests pass**

```bash
pnpm vitest run scripts/noldor/__tests__/session.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Write `bump-session-marker.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit, stdout, cwd } from 'node:process';
import { fileURLToPath } from 'node:url';

const FILE = '.noldor/session.json';

export function bumpSessionMarker(workdir: string): { changed: boolean; reason: string } {
  const p = join(workdir, FILE);
  if (!existsSync(p)) return { changed: false, reason: `no marker at ${p}` };
  const m = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  if (m.markerVersion === 2) return { changed: false, reason: 'already markerVersion: 2' };
  m.markerVersion = 2;
  writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8');
  return { changed: true, reason: `bumped markerVersion to 2 at ${p}` };
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  const r = bumpSessionMarker(cwd());
  stdout.write(`${r.reason}\n`);
  exit(0);
}
```

- [ ] **Step 6: Wire `pnpm noldor:bump-session-marker`** in `package.json`.

- [ ] **Step 7: Commit**

```bash
git add scripts/noldor/session.ts scripts/noldor/__tests__/session.test.ts scripts/noldor/bump-session-marker.ts package.json
git commit -m "feat(noldor): markerVersion + enhancement fields, refinement, bump-session-marker helper" -m "Noldor-FD: noldor"
```

---

## Task 3: Update validate-trailer + inject-trailers hooks

**Files:**

- Modify: `scripts/hooks/noldor-validate-trailer.ts`
- Modify: `scripts/hooks/__tests__/noldor-validate-trailer.test.ts`
- Modify: `scripts/hooks/noldor-inject-trailers.ts`
- Modify: `scripts/hooks/__tests__/noldor-inject-trailers.test.ts`

> **Rationale (folded-in findings — High + Medium):**
>
> - Phase-revert detection switches from subject-regex (Unicode `→`) to `Noldor-Phase-Revert: 1` trailer. Robust under subject rewording.
> - `specs-only-attach` + `full-attach` filename assertion uses `Noldor-Enhancement: <slug>` trailer (emitted by `inject-trailers` from the session marker's `enhancement` field).
> - `specs-only-new` now requires a spec file at `docs/design/specs/<date>-<slug>-design.md` (matching the new tier semantics).

- [ ] **Step 1: Add failing tests for `inject-trailers`**

Append to `scripts/hooks/__tests__/noldor-inject-trailers.test.ts`:

```typescript
it('emits Noldor-Enhancement when session marker has enhancement field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qfi-'));
  mkdirSync(join(dir, '.noldor'));
  writeFileSync(
    join(dir, '.noldor', 'session.json'),
    JSON.stringify({
      path: 'full-attach',
      parent: 'noldor',
      enhancement: 'my-enhancement',
      startedAt: '2026-05-25T00:00:00Z',
    }),
  );
  const msgFile = join(dir, 'COMMIT_EDITMSG');
  writeFileSync(msgFile, 'docs(features:noldor): add spec for my-enhancement\n');
  injectTrailers({ messageFile: msgFile, cwd: dir });
  const out = readFileSync(msgFile, 'utf8');
  expect(out).toContain('Noldor-Enhancement: my-enhancement');
});

it('does NOT emit Noldor-Enhancement when session marker lacks enhancement field', () => {
  // setup with full-new + slug only, then assert Noldor-Enhancement is not present
});
```

Existing `specs-only-new` test will need `markerVersion: 2` to pass under the new refinement.

- [ ] **Step 2: Add failing tests for `validate-trailer`**

Append to `scripts/hooks/__tests__/noldor-validate-trailer.test.ts`:

```typescript
describe('Noldor-Phase-Revert: 1 trailer bypasses spec-file existence check', () => {
  it('lets full-attach commit through with the trailer (no spec file present)', () => {
    // setup full-attach FD, no spec — commit with Noldor-Phase-Revert: 1 should pass
  });

  it('lets specs-only-attach commit through with the trailer', () => {
    /* same shape */
  });

  it('does NOT bypass without the trailer (regular attach commit must have spec)', () => {
    // setup full-attach FD, no spec, with Noldor-Enhancement but no Phase-Revert — should fail
  });
});

describe('specs-only-attach requires Noldor-Enhancement + spec file matching enhancement', () => {
  it('rejects when no spec file matches the enhancement suffix', () => {
    /* */
  });
  it('passes when spec file matches enhancement suffix', () => {
    /* */
  });
});

describe('specs-only-new requires existing FD with matching tier + spec file', () => {
  it('rejects when spec file missing', () => {
    /* */
  });
  it('passes when spec file at <date>-<slug>-design.md exists', () => {
    /* */
  });
});
```

The existing `full-attach requires spec file at docs/design/specs/` test needs to be reshaped to include `Noldor-Enhancement: enhance` in the commit message and a spec file matching `-parent-enhance-design.md`.

- [ ] **Step 3: Run failing tests**

```bash
pnpm vitest run scripts/hooks/__tests__/ 2>&1 | tail -25
```

- [ ] **Step 4: Update `inject-trailers.ts`**

After the existing `Noldor-FD` emission:

```typescript
if (session.enhancement) args.push('--trailer', `Noldor-Enhancement: ${session.enhancement}`);
```

- [ ] **Step 5: Update `validate-trailer.ts`**

Add the phase-revert helper at the top of the per-path validation block:

```typescript
const isPhaseRevert = t['Noldor-Phase-Revert'] === '1';
```

Update branches:

(a) **specs-only-new** — keep tier check, add spec-file requirement:

```typescript
if (path === 'specs-only-new') {
  if (tier !== 'specs-only') {
    return { ok: false, reason: `FD ${slug} has tier ${tier ?? '<unset>'}, expected specs-only` };
  }
  if (isPhaseRevert) return { ok: true };
  const specsDir = join(opts.cwd, 'docs', 'superpowers', 'specs');
  const expectedSuffix = `-${slug}-design.md`;
  if (!existsSync(specsDir)) {
    return {
      ok: false,
      reason: `specs-only-new requires a spec file at docs/design/specs/<date>${expectedSuffix}`,
    };
  }
  const files = readdirSync(specsDir).filter((f) => f.endsWith(expectedSuffix));
  if (files.length === 0) {
    return {
      ok: false,
      reason: `specs-only-new requires a spec file at docs/design/specs/<date>${expectedSuffix}`,
    };
  }
  return { ok: true };
}
```

(b) **specs-only-attach + full-attach** — share the same shape (enhancement trailer + matching spec file):

```typescript
if (path === 'specs-only-attach' || path === 'full-attach') {
  if (isPhaseRevert) return { ok: true };
  const enhancement = t['Noldor-Enhancement'];
  if (!enhancement) {
    return {
      ok: false,
      reason: `${path} requires Noldor-Enhancement trailer (session marker's enhancement field). Re-run /gate.`,
    };
  }
  const specsDir = join(opts.cwd, 'docs', 'superpowers', 'specs');
  const expectedSuffix = `-${slug}-${enhancement}-design.md`;
  if (!existsSync(specsDir)) {
    return {
      ok: false,
      reason: `${path} requires a spec file at docs/design/specs/<date>${expectedSuffix}`,
    };
  }
  const files = readdirSync(specsDir).filter((f) => f.endsWith(expectedSuffix));
  if (files.length === 0) {
    return {
      ok: false,
      reason: `${path} requires a spec file at docs/design/specs/<date>${expectedSuffix}`,
    };
  }
}
```

(c) **full-new** — keep existing tier-check + `links.spec` requirement, no change.

- [ ] **Step 6: All hook tests pass**

```bash
pnpm vitest run scripts/hooks/__tests__/ 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add scripts/hooks/noldor-validate-trailer.ts scripts/hooks/__tests__/noldor-validate-trailer.test.ts scripts/hooks/noldor-inject-trailers.ts scripts/hooks/__tests__/noldor-inject-trailers.test.ts
git commit -m "feat(hooks): specs-only-* spec-file requirement, trailer-based phase-revert, Noldor-Enhancement assertion" -m "Noldor-FD: noldor"
```

---

## Task 4: Rewrite gate SKILL.md (Step 2 scaffolds, enhancement-slug prompt, trailer-based phase-revert)

**Files:**

- Modify: `.claude/skills/gate/SKILL.md`

- [ ] **Step 1: Read sections that change**

```bash
sed -n '42,90p' .claude/skills/gate/SKILL.md
grep -n "revert phase done" .claude/skills/gate/SKILL.md
```

- [ ] **Step 2: Update Step 2 `specs-only-*` scaffolds to invoke brainstorming + emit `markerVersion: 2`**

```markdown
- `specs-only-new`: Prompt slug + category. **Create the worktree first** via `superpowers:using-git-worktrees` (`.worktrees/<slug>`, branch `feat/<slug>`); run `pnpm install` inside the new worktree per `docs/noldor/worktree-discipline.md`. Write session marker `{ path, slug, startedAt, markerVersion: 2 }` _inside_ the worktree's `.noldor/session.json`. **Then** invoke `/promote <slug> --tier=specs-only` (or `/new-feature <slug> --tier=specs-only` when slug isn't in roadmap/backlog). Then `superpowers:brainstorming` to produce the spec at `docs/design/specs/<date>-<slug>-design.md`. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, advance directly to implementation (no plan stage).
- `specs-only-attach`: Prompt parent slug. Prompt enhancement slug (`Enhancement slug (short, kebab-case, scopes the spec filename)?`). Validate parent FD exists. Worktree. Session `{ path, parent, enhancement, startedAt, markerVersion: 2 }`. Run the phase-revert sequence below if applicable. `superpowers:brainstorming` writing spec named `<date>-<parent>-<enhancement>-design.md`. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, advance directly to implementation (no plan stage).
```

Update `full-attach` to prompt for enhancement slug:

```markdown
- `full-attach`: Prompt parent slug. Prompt enhancement slug (`Enhancement slug (short, kebab-case, scopes the spec/plan filename)?`). Worktree. Session `{ path, parent, enhancement, startedAt }`. Run the phase-revert sequence below if applicable. `superpowers:brainstorming` writing spec named `<date>-<parent>-<enhancement>-design.md`. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, continue: `superpowers:writing-plans`. **After plan returns, run Step 2.5 with `--kind plan` again.**
```

- [ ] **Step 3: Rewrite phase-revert sequence to emit `Noldor-Phase-Revert: 1` trailer**

Replace the existing phase-revert commit command:

```bash
git diff --quiet docs/features/<parent-slug>.md || (git add docs/features/<parent-slug>.md && git commit -m "docs(features:<parent-slug>): revert phase done → in-progress for attach session" -m "Noldor-FD: <parent-slug>" -m "Noldor-Phase-Revert: 1")
```

Note: "The `Noldor-Phase-Revert: 1` trailer is what `noldor-validate-trailer.ts` reads to bypass the spec-file existence check — the subject line is informational only and may be reworded freely without breaking the bypass."

- [ ] **Step 4: Update Step 2.5 autonomous-mode note**

Add below the existing autonomous bullet:

```markdown
For `specs-only-*` paths, the kind=spec continue-dialog has no `proceed-autonomous` option — these paths have no plan stage. Operators wanting autonomy through implementation should use `full-*` paths.

For `specs-only-*` paths, `proceed` at the kind=spec continue-dialog advances directly to implementation (no `/draft-feature-md`, no plan stage). For `full-*` paths, `proceed` at kind=spec advances to `/draft-feature-md` + `writing-plans` (today's behavior).
```

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/gate/SKILL.md
git commit -m "docs(noldor): gate skill — specs-only-* invokes brainstorming, phase-revert trailer, enhancement-slug prompt" -m "Noldor-FD: noldor"
```

---

## Task 5: Update promote + new-feature tier-picker wording

**Files:**

- Modify: `.claude/skills/promote/SKILL.md`
- Modify: `.claude/skills/new-feature/SKILL.md`

- [ ] **Step 1: Replace the AskUserQuestion wording**

Change:

```
FD creation depth — specs-only (no brainstorm) or full (spec + brainstorm)?
```

to:

```
FD creation depth — specs-only (spec, no plan) or full (spec + plan)?
```

(The tier roster stays at 2 values; only the behavior description changes.)

- [ ] **Step 2: Validate skill-catalog**

```bash
pnpm validate:skill-catalog 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/promote/SKILL.md .claude/skills/new-feature/SKILL.md
git commit -m "docs(noldor): promote + new-feature tier wording reflects specs-only-produces-spec" -m "Noldor-FD: noldor"
```

---

## Task 6: Rewrite complexity-gating.md path matrix + prose

**Files:**

- Modify: `docs/noldor/complexity-gating.md`

- [ ] **Step 1: Read current table**

```bash
sed -n '10,25p' docs/noldor/complexity-gating.md
```

- [ ] **Step 2: Update path matrix — Design Spec column flips ✗ → ✓ for `specs-only-*` rows**

The path roster stays at 6 (micro-chore, fast-track, specs-only-new, specs-only-attach, full-new, full-attach). What changes:

- `specs-only-new` and `specs-only-attach` rows: Design Spec column flips from ✗ → ✓, Plan column flips from ✓ → ✗. Use-case prose updates: "design needed, spec sufficient context" / "design-light enhancement under parent FD".
- `full-new` and `full-attach` rows: unchanged.
- Worked examples: update Example 3 (or add Example 4) to demonstrate the new `specs-only-new` flow.

Replace the `Brainstorm` column header if present with `Design Spec`. Update prose around "Review handoff after spec/plan":

```markdown
- `full-new` and `full-attach` hit this pause twice: once after `superpowers:brainstorming` (spec, `kind=spec`) and again after `superpowers:writing-plans` (plan, `kind=plan`).
- `specs-only-new` and `specs-only-attach` hit this pause once at `kind=spec`. No plan stage — implementation follows directly from the spec.
```

Update `### Autonomous mode`:

```markdown
Autonomous mode triggers on plan-confirm. `specs-only-*` paths have no plan stage, so they cannot enter autonomous mode. Operators wanting autonomy through implementation should use `full-*` paths.
```

- [ ] **Step 3: Commit**

```bash
git add docs/noldor/complexity-gating.md
git commit -m "docs(noldor): complexity-gating reflects specs-only-produces-spec flip" -m "Noldor-FD: noldor"
```

---

## Task 7: Update lifecycle.md flow diagram + path descriptions

**Files:**

- Modify: `docs/noldor/lifecycle.md`

- [ ] **Step 1: Inspect**

```bash
sed -n '1,80p' docs/noldor/lifecycle.md
```

- [ ] **Step 2: Update mermaid diagram + path-list labels**

Path list (6 paths, 2 tiers):

```markdown
3. **`specs-only-new`** — new FD with spec file (no plan). Design needed, but small enough that the spec is sufficient context for direct implementation.
4. **`specs-only-attach`** — attach enhancement to existing FD with spec file (no plan).
5. **`full-new`** — new FD with spec + plan. New design dialogue + decomposition needed.
6. **`full-attach`** — attach enhancement to existing FD with spec + plan.
```

Update mermaid arrows to reflect that `specs-only-*` now writes a spec (the diagram likely shows "writing-plans" for those branches — flip to "brainstorming").

- [ ] **Step 3: Commit**

```bash
git add docs/noldor/lifecycle.md
git commit -m "docs(noldor): lifecycle flow reflects specs-only-produces-spec" -m "Noldor-FD: noldor"
```

---

## Task 8: Add kind=spec note to cr-pipeline.md

**Files:**

- Modify: `docs/noldor/cr-pipeline.md`

- [ ] **Step 1: Inspect**

```bash
grep -n "kind\|spec\|plan" docs/noldor/cr-pipeline.md | head -20
```

- [ ] **Step 2: Append clarifying section**

```markdown
### Artifact kind semantics

The orchestrator's `--kind` flag accepts `spec`, `plan`, or `code` (see `scripts/cr/findings-schema.ts:artifactKindSchema`). Path-to-kind mapping at `/gate` Step 2.5:

| Path                | Step 2.5 invocations                    |
| ------------------- | --------------------------------------- |
| `specs-only-new`    | 1× `--kind spec`                        |
| `specs-only-attach` | 1× `--kind spec`                        |
| `full-new`          | 1× `--kind spec`, then 1× `--kind plan` |
| `full-attach`       | 1× `--kind spec`, then 1× `--kind plan` |

`kind=spec` and `kind=plan` route to the same lane implementations today; the kind value lands in the `LaneFindings.kind` field for audit trail only.
```

- [ ] **Step 3: Commit**

```bash
git add docs/noldor/cr-pipeline.md
git commit -m "docs(noldor): cr-pipeline kind=spec mapping for specs-only paths" -m "Noldor-FD: noldor"
```

---

## Task 9: Update rename-FD follow-up + noldor.md enhancement entry

**Files:**

- Modify: `docs/features/rename-plan-only-tier-to-specs-only.md`
- Modify: `docs/features/noldor.md`

> The roadmap entry rename is dropped in the 2-tier model — there is no `plan-only` to redirect the "Print Detailed Plan Summary" entry toward. The entry can stay as `#### Specs-Only Path: Print Detailed Plan Summary to Operator` (the entry refers to specs-only's actual handoff behavior, which under the new semantics is "implementation follows directly from the spec" — the "print detailed plan summary" framing still fits with light prose adjustments, but rewriting the body is out of scope for this PR).

- [ ] **Step 1: Append `## Follow-up` to rename-plan-only-tier-to-specs-only.md**

```markdown
## Follow-up

The rename's User Story stated the intent was to make the tier label reflect what it actually produces (a spec). The implementation in this FD was label-only — the tier kept its plan-producing behavior. The follow-up FD `noldor-specs-only-tier-produces-spec` (2026-05-25) honored the original intent by flipping the tier's actual behavior to produce a spec file. The 29 existing FDs tagged `noldor-tier: specs-only` keep their tag as a historical label-only carryover (none of them had a real spec file at the time of the flip). See [`docs/design/specs/2026-05-25-noldor-specs-only-tier-produces-spec-design.md`](../superpowers/specs/2026-05-25-noldor-specs-only-tier-produces-spec-design.md).
```

- [ ] **Step 2: Append enhancement entry to noldor.md**

```markdown
- **Specs-only tier produces a spec file** (2026-05-25): flipped tier behavior to match the rename's original intent. See [spec](../superpowers/specs/2026-05-25-noldor-specs-only-tier-produces-spec-design.md) + [plan](../superpowers/plans/2026-05-25-noldor-specs-only-tier-produces-spec.md).
```

- [ ] **Step 3: Commit**

```bash
git add docs/features/rename-plan-only-tier-to-specs-only.md docs/features/noldor.md
git commit -m "docs(features:noldor): rename-FD follow-up + noldor enhancement entry" -m "Noldor-FD: noldor"
```

---

## Task 10: Verification gates (baseline-diff)

**Files:** none modified — full repo verification.

> **Rationale (folded-in finding — Medium):** Hard-coded test counts replaced with baseline-diff. Step 0 captures baseline before Task 2 begins.

- [ ] **Step 0: Capture baseline (BEFORE Task 2)**

```bash
pnpm test 2>&1 | tee /tmp/baseline-test.txt
pnpm validate:features 2>&1 | tee /tmp/baseline-features.txt
pnpm validate:skill-catalog 2>&1 | tee /tmp/baseline-skill-catalog.txt
```

- [ ] **Step 1: `pnpm validate:features` matches baseline**

```bash
pnpm validate:features 2>&1 | tail -5
```

- [ ] **Step 2: `pnpm typecheck` clean**

- [ ] **Step 3: `pnpm lint` clean**

- [ ] **Step 4: Test suite vs baseline**

```bash
pnpm test 2>&1 | tee /tmp/post-impl-test.txt
diff <(grep "Test Files\|Tests" /tmp/baseline-test.txt) <(grep "Test Files\|Tests" /tmp/post-impl-test.txt)
```

No new failures; new passing tests added by Tasks 2 + 3 should appear in the post-impl count.

- [ ] **Step 5: Validate noldor docs**

```bash
pnpm validate:noldor 2>&1 | tail -5 && pnpm validate:skill-catalog 2>&1 | tail -5
```

- [ ] **Step 6: Dogfood manual flow (no commit)**

In a scratch worktree, pick `specs-only-new` via `/gate`, confirm it invokes brainstorming + produces a spec file. Tear down before continuing.

- [ ] **Step 7: No commit unless a step surfaced a failure** — fix inline as `fix(noldor): <description>` with `Noldor-FD: noldor` trailer.

---

## Task 11: End-of-flow handoff to `/gate` Step 4

- [ ] **Step 1: Mark phase=done on noldor.md** (idempotent — no-op if already done)

```bash
pnpm exec tsx -e "import {readFileSync as r, writeFileSync as w} from 'node:fs'; import {flipPhaseToDone as f} from './scripts/noldor/phase-flip-done.ts'; const p = 'docs/features/noldor.md'; const m = r(p, 'utf8'); const o = f(m); if (o !== m) w(p, o, 'utf8');"
```

If file changed: `git add docs/features/noldor.md && git commit -m "docs(features:noldor): mark phase=done" -m "Noldor-FD: noldor"`.

- [ ] **Step 2: Hand off to gate Step 4 (CR pipeline → PR flow).** The remaining steps (code-stage `cr:orchestrate --kind code`, aggregate, escalate-on-red, `pnpm pr-flow`, post-merge cleanup) are owned by the gate skill's Step 4.

---

## Self-Review

**Spec coverage:**

- §Tier roster (2 tiers, unchanged) → no schema task needed.
- §Path roster (6 paths, unchanged) → no PATHS task needed.
- §Gate flow per path → Task 4.
- §Session schema (markerVersion + enhancement + refinement) → Task 2.
- §Hook updates → Task 3.
- §Adjacent fix (phase-revert ordering) → Task 3 (trailer-based) + Task 4 (gate skill emits trailer).
- §Step 2.5 reshape → Task 4, Task 8.
- §Framework docs → Tasks 4, 5, 6, 7, 8, 9.
- §In-flight session marker migration → Task 2 (`markerVersion` + refinement + `bump-session-marker`).

**Findings resolved (2026-05-25 CR):**

- ~Critical task-ordering~ → no longer applicable (no migration).
- High fragile phase-revert → Task 3 trailer-based, Task 4 gate emits trailer.
- High markerVersion incomplete → Task 2 refinement + `bump-session-marker`.
- Medium specs-only-attach loose match → Task 2 `enhancement` field + Task 3 `Noldor-Enhancement` trailer + filename suffix.
- ~Medium Node engine for `globSync`~ → no longer applicable (no migration helper).
- Medium hardcoded test counts → Task 10 baseline-diff.

**Placeholder scan:** No "TBD" / "TODO".

---

## Execution Handoff

Plan complete. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.

**2. Inline Execution** — execute tasks in this session using executing-plans.

Which approach?
