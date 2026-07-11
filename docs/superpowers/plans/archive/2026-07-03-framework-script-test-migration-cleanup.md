# Framework Script + Test Migration Cleanup Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Execute spec units U1–U8 of [2026-07-03-framework-script-test-migration-cleanup-design.md](../specs/2026-07-03-framework-script-test-migration-cleanup-design.md): delete migration-era dead code (`cr-retry`, `scripts/migration/`, hand-rolled semver, empty `src/index.ts`), make the published package bin-first, sweep stale pre-extraction path comments, reconcile `DocRoots.ideas` with the repo-root `ideas.md` reality, remove graphify litter, and give the only two zero-test directories (`src/invariants/`, `src/validate/`) a coverage floor.

**Architecture:** Pure-deletion units invert TDD sensibly (grep-verify-no-references → delete → suite green). Behavior-preserving rewires (semver dedup, `DocRoots.ideas`) go failing-test-first. New coverage exercises real exports: `makeRuleConflictsInvariant` on temp doc pairs, `makeBoundariesInvariant` + `BoundaryRuleSchema` on a temp consumer repo with a real dependency-cruiser run, and `noldor validate noldor-config` as a subprocess (its module runs `main()` at import time, so it cannot be imported by a test).

**Tech Stack:** TypeScript ESM, vitest (`pnpm vitest run <path>`), zod, npm `semver`, dependency-cruiser, pnpm, git.

**Sequencing (IMPORTANT):** This plan executes SECOND in a 5-plan drain. A later plan (`self-boundaries-declaration-and-cycle-break`) will move files inside `src/invariants/` and DELETE `keyboard-binding.ts`. Task 7's tests therefore target only modules that survive that plan — `rule-conflicts.ts`, `boundaries.ts` (via `makeBoundariesInvariant` + `BoundaryRuleSchema`), and `src/validate/noldor-config.ts`. Do NOT add tests for `keyboard-binding.ts`.

**Grep-gate scoping (verified 2026-07-04):** a leftover git worktree at `.claude/worktrees/fast-co-tag-drift/` contains a stale full-tree copy (cr-retry, old pr-flow.md, graphify output). It is not part of this feature — every grep gate below scopes to `src/`, `templates/`, and `.claude/skills/` instead of bare `.claude/`. Surface the leftover worktree to the operator; do not delete it in this plan.

**Reality deltas from the spec (verified before planning):** `FORBIDDEN_RULES` no longer exists in `src/invariants/boundaries.ts` (boundaries come from consumer config) — the boundaries test targets `BoundaryRuleSchema` + `makeBoundariesInvariant` instead. `vitest.config.ts` still includes `scripts/migration/__tests__/**` — Task 2 removes it. `package.json` also carries a top-level `"types": "./dist/index.d.ts"` the spec didn't list — Task 4 removes it. `src/garden/sdd-report.ts:70` defines its own separate `compareSemver` which stays (out of U3's scope) — the semver grep gate scopes to `src/migrations/`. The FD-only `fillMarkers` lives at `src/release/release-markers.ts` — that is the correct comment-fix target in Task 5. `docs/features/framework-pr-flow-agent-auto-merge.md` links to both cr-retry files — Task 1 removes those links so the fd-link-rot detector stays at 0 gaps.

---

## File Structure

- `src/core/cr-retry.ts` — dead codex retry loop (DELETE, U1)
- `src/core/__tests__/cr-retry.test.ts` — its test (DELETE, U1)
- `.claude/skills/gate/SKILL.md` — gate skill; line 248 historical note drops the "survives on disk" clause (U1)
- `templates/.claude/skills/gate/SKILL.md` — template twin, must stay byte-identical (U1)
- `docs/features/framework-pr-flow-agent-auto-merge.md` — FD whose `links.code`/`links.tests` + Resources block reference the deleted cr-retry files (U1)
- `scripts/migration/` — five one-shot extraction scripts + 4 tests + `.gitkeep` (DELETE, U2)
- `vitest.config.ts` — drop the `scripts/migration/__tests__/**` include entry (U2)
- `src/graphify-out/` — untracked stray graphify output (disk-only rm, U7, folded into Task 2)
- `src/migrations/chain.ts` — swap `compareSemver` for npm `semver.compare` (U3)
- `src/migrations/__tests__/chain.test.ts` — new failing test locking npm-semver error semantics (U3)
- `src/migrations/semver.ts` — hand-rolled semver (DELETE, U3)
- `src/migrations/__tests__/semver.test.ts` — its test (DELETE, U3)
- `src/index.ts` — empty library placeholder (DELETE, U4)
- `package.json` — remove `main`, `types`, and the `"."` export (U4)
- `src/core/consumer-config.ts` — rewrite stale boundary-rules comment (U5)
- `src/core/release-markers.ts` — fix `scripts/release/release-markers.ts` → `src/release/release-markers.ts` comment (U5)
- `src/garden/garden-detect-runner.ts` — fix `scripts/release/index.ts` → `src/release/index.ts` comment (U5)
- `src/release/{release-fd-changelog,release-fd-commits,fd-prs-since-tag,release-noise-types,llm-polish-summary}.ts` — stale `// scripts/release/…` header comments (U5)
- `src/checks/__tests__/check-feature-slug-scope.test.ts`, `src/features/__tests__/{migrate-fd-commits-to-prs,migrate-changelog-unreleased}.test.ts`, `src/release/__tests__/{llm-polish-summary,release-fd-changelog,fd-prs-since-tag,sdd-report-diff,release-noise-types,release-fd-commits}.test.ts` — stale `// packages/noldor/src/…` header comments (U5)
- `src/dashboard/__tests__/dashboard-views.test.ts`, `src/dashboard/__tests__/dashboard-render-markdown.test.ts`, `src/hooks/__tests__/noldor-pre-commit.test.ts` — stale `packages/noldor/…` path mentions inside comments (U5)
- `src/cli/commands/init.ts`, `src/templates/manifest.ts` — `packages/noldor/` mentions that describe consumer-monorepo consumption; meaning-preserving rewords (U5)
- `src/core/doc-roots.ts` — `ideas` maps to repo-root `ideas.md`; JSDoc updated (U6)
- `src/core/__tests__/doc-roots.test.ts` — expectation flips first (RED) (U6)
- `src/triage/triage-list-untriaged.ts` — route `main()` through `loadDocRoots().ideas` (U6)
- `src/garden/sdd-report.ts` — route the `main()` ideas read through `loadDocRoots().ideas` (U6)
- `src/invariants/__tests__/rule-conflicts.test.ts` — NEW: first test for `makeRuleConflictsInvariant` (U8)
- `src/invariants/__tests__/boundaries.test.ts` — NEW: `BoundaryRuleSchema` contract + real dep-cruiser run via `makeBoundariesInvariant` (U8)
- `src/validate/__tests__/noldor-config.test.ts` — NEW: subprocess tests for `noldor validate noldor-config` (U8)

---

## Task 1: Delete dead CR retry loop (U1)

**Files:**
- Delete: `src/core/cr-retry.ts`, `src/core/__tests__/cr-retry.test.ts`
- Modify: `.claude/skills/gate/SKILL.md`, `templates/.claude/skills/gate/SKILL.md`, `docs/features/framework-pr-flow-agent-auto-merge.md`

- [ ] **Step 1: Verify nothing outside its own test imports cr-retry**

```bash
grep -rn "cr-retry\|runCrRetryLoop" src/ --include='*.ts' | grep -v "src/core/cr-retry.ts:\|src/core/__tests__/cr-retry.test.ts:"
```

Expected output: empty (exit 1). The only `src/` references live in the two files being deleted.

- [ ] **Step 2: Delete the module and its test**

```bash
git rm src/core/cr-retry.ts src/core/__tests__/cr-retry.test.ts
```

Expected output:
```
rm 'src/core/__tests__/cr-retry.test.ts'
rm 'src/core/cr-retry.ts'
```

- [ ] **Step 3: Drop the "survives on disk" clause from the gate skill — both twins**

In `.claude/skills/gate/SKILL.md` (line 248), replace:

```
rather than a forced retry loop. `src/core/cr-retry.ts` survives on disk as dead code for a separate refactor pass; the gate no longer calls it.
```

with:

```
rather than a forced retry loop.
```

Apply the identical edit to `templates/.claude/skills/gate/SKILL.md` (same line). The paragraph's earlier sentence "Both are removed — the subagent now runs via …" already carries the meaning the spec wants.

- [ ] **Step 4: Verify the twins are byte-identical**

```bash
diff .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md && echo TWINS-IDENTICAL
```

Expected output: `TWINS-IDENTICAL`

- [ ] **Step 5: Remove the two rotted cr-retry links from the pr-flow FD**

In `docs/features/framework-pr-flow-agent-auto-merge.md`, delete these four lines (frontmatter `links.code`, frontmatter `links.tests`, Resources Code bullet, Resources Tests bullet):

```
    - src/core/cr-retry.ts
```

```
    - src/core/__tests__/cr-retry.test.ts
```

```
  - [`src/core/cr-retry.ts`](../../src/core/cr-retry.ts)
```

```
  - [`src/core/__tests__/cr-retry.test.ts`](../../src/core/__tests__/cr-retry.test.ts)
```

Leave the Changelog paragraph's prose mention of "a cr-retry runCrRetryLoop module" untouched — it is historical record. (This step is a verified spec gap: leaving the links would trip the fd-link-rot garden detector.)

- [ ] **Step 6: Run the core suite and the grep gate**

```bash
pnpm vitest run src/core && grep -rn "cr-retry" src/ templates/ .claude/skills/; echo "grep exit: $?"
```

Expected output: vitest green (all `src/core` files pass, cr-retry.test.ts no longer listed), then `grep exit: 1` (zero hits). Note: the spec's acceptance grep over bare `.claude/` fails on the leftover `.claude/worktrees/fast-co-tag-drift/` copy — scope stays `.claude/skills/`.

- [ ] **Step 7: Commit**

```bash
git add src/core/cr-retry.ts src/core/__tests__/cr-retry.test.ts .claude/skills/gate/SKILL.md templates/.claude/skills/gate/SKILL.md docs/features/framework-pr-flow-agent-auto-merge.md
NOLDOR_ALLOW_SHARED=1 git commit -m "chore(core): delete dead cr-retry loop, drop gate survives-on-disk note" -m "Noldor-FD: framework-script-test-migration-cleanup"
```

`NOLDOR_ALLOW_SHARED=1` is required: the commit touches the shared gate skill twin (pre-commit shared-files guard).

---

## Task 2: Delete `scripts/migration/` + vitest include + graphify litter (U2 + U7)

**Files:**
- Delete: `scripts/migration/` (entire directory: `classify.ts`, `classify-feature-track.ts`, `cross-tree-link-audit.ts`, `partition-blocks.ts`, `stage-framework-docs.ts`, `.gitkeep`, `__tests__/classify.test.ts`, `__tests__/cross-tree-link-audit.test.ts`, `__tests__/partition-blocks.test.ts`, `__tests__/stage-framework-docs.test.ts`), `src/graphify-out/` (untracked, disk only)
- Modify: `vitest.config.ts`

- [ ] **Step 1: Verify the only live references are the vitest include and one pure test fixture**

```bash
grep -rn "scripts/migration" src/ package.json .github/ lefthook.yml vitest.config.ts tsconfig.json 2>/dev/null
```

Expected output — exactly two hits:
```
src/garden/__tests__/sdd-report.test.ts:479:        path: 'scripts/migration/__tests__/classify.test.ts',
vitest.config.ts:6:    include: ['src/**/__tests__/**/*.test.ts', 'scripts/migration/__tests__/**/*.test.ts'],
```

The sdd-report hit is a path-shaped fixture STRING fed to the pure function `detectUntaggedTests` (it asserts script tests are exempt from the tag rule) — it does not read the disk and stays valid after deletion. Leave it. The vitest include is fixed in Step 3. (The spec's claim "only archive hits" was false on both counts.)

- [ ] **Step 2: Delete the directory**

```bash
git rm -r scripts/migration
```

Expected output: ten `rm 'scripts/migration/…'` lines (5 scripts, 4 tests, `.gitkeep`).

- [ ] **Step 3: Drop the dead vitest include entry**

In `vitest.config.ts`, replace:

```ts
    include: ['src/**/__tests__/**/*.test.ts', 'scripts/migration/__tests__/**/*.test.ts'],
```

with:

```ts
    include: ['src/**/__tests__/**/*.test.ts'],
```

- [ ] **Step 4: Remove the untracked graphify litter (U7 — disk-only, nothing to commit)**

```bash
git ls-files src/graphify-out; rm -rf src/graphify-out; ls src/graphify-out 2>&1; grep -n '\*/graphify-out/' .gitignore
```

Expected output: `git ls-files` prints nothing (untracked, as the spec says), `ls` prints `No such file or directory`, and `.gitignore` shows `52:*/graphify-out/` (recurrence already prevented).

- [ ] **Step 5: Run the full suite (proves the include removal and deletion are clean)**

```bash
pnpm test
```

Expected output: vitest green; no `scripts/migration` test files listed anywhere in the run.

- [ ] **Step 6: Commit**

```bash
git add scripts/migration vitest.config.ts
git commit -m "chore(scripts): delete one-shot migration scripts and their vitest include" -m "Noldor-FD: framework-script-test-migration-cleanup"
```

---

## Task 3: Semver dedup — `chain.ts` onto npm `semver` (U3)

**Files:**
- Test: `src/migrations/__tests__/chain.test.ts`
- Modify: `src/migrations/chain.ts`
- Delete: `src/migrations/semver.ts`, `src/migrations/__tests__/semver.test.ts`

- [ ] **Step 1: Write the failing test locking npm-semver error semantics**

In `src/migrations/__tests__/chain.test.ts`, append inside the existing `describe('resolveChain', …)` block (after the `'throws on a chain gap'` case):

```ts
  it('rejects malformed versions via npm semver (Invalid Version)', () => {
    expect(() => resolveChain(ALL, 'not-a-version', '0.4.0')).toThrow(/Invalid Version/);
  });
```

- [ ] **Step 2: Run it — must FAIL**

```bash
pnpm vitest run src/migrations/__tests__/chain.test.ts
```

Expected output: 1 failing test — the hand-rolled `parseSemver` throws `not a semver: "not-a-version"`, which does not match `/Invalid Version/`. All other chain tests stay green.

- [ ] **Step 3: Swap `chain.ts` onto npm semver**

Replace the import block at the top of `src/migrations/chain.ts`:

```ts
import type { ConsumerConfig } from '../core/consumer-config.js';
import type { ChainResult, Migration, MigrationStep } from './types.js';
import { compareSemver } from './semver.js';
```

with:

```ts
import semver from 'semver';

import type { ConsumerConfig } from '../core/consumer-config.js';
import type { ChainResult, Migration, MigrationStep } from './types.js';
```

Then replace the `resolveChain` body's five call sites — the function becomes:

```ts
export function resolveChain(
  migrations: readonly Migration[],
  from: string,
  to: string,
): Migration[] {
  if (semver.compare(from, to) > 0) {
    throw new Error(`downgrade unsupported: anchored ${from} > installed ${to}`);
  }
  const selected = migrations
    .filter((m) => semver.compare(m.to, from) > 0 && semver.compare(m.to, to) <= 0)
    .toSorted((a, b) => semver.compare(a.to, b.to));
  let cursor = from;
  for (const m of selected) {
    if (semver.compare(m.from, cursor) !== 0) {
      throw new Error(
        `migration chain gap: expected a migration from ${cursor}, got ${m.from} (→${m.to})`,
      );
    }
    cursor = m.to;
  }
  return selected;
}
```

`runChain` and `renderSteps` are untouched. `semver` is already a runtime dependency (`package.json`: `"semver": "^7.7.4"`), and `@types/semver` is already a devDependency — no dependency change. The default-import style matches `src/release/release-version.ts:4`.

- [ ] **Step 4: Run the chain tests — must PASS**

```bash
pnpm vitest run src/migrations/__tests__/chain.test.ts
```

Expected output: all tests green, including the new `Invalid Version` case.

- [ ] **Step 5: Delete the hand-rolled module and its test, run the grep gate**

```bash
git rm src/migrations/semver.ts src/migrations/__tests__/semver.test.ts
grep -rn "compareSemver\|parseSemver" src/migrations/; echo "grep exit: $?"
pnpm vitest run src/migrations
```

Expected output: two `rm` lines; `grep exit: 1` (zero hits in `src/migrations/`); vitest green. NOTE (verified spec deviation): the spec's acceptance grep over all of `src/` cannot come back empty — `src/garden/sdd-report.ts:70` defines its own separate exported `compareSemver` (with its own test), which U3 does not schedule for removal. The gate is scoped to `src/migrations/` accordingly; leave sdd-report untouched.

- [ ] **Step 6: Commit**

```bash
git add src/migrations/chain.ts src/migrations/__tests__/chain.test.ts src/migrations/semver.ts src/migrations/__tests__/semver.test.ts
git commit -m "refactor(migrations): use npm semver, drop hand-rolled parse/compare" -m "Noldor-FD: framework-script-test-migration-cleanup"
```

---

## Task 4: Package entry honesty — delete `src/index.ts`, drop `main`/`types`/`"."` export (U4)

**Files:**
- Delete: `src/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Verify nothing imports the package root or `src/index.ts`**

```bash
grep -rn "from '\.\./index\.js'" src/ --include='*.ts'; echo "parent-index imports exit: $?"
grep -rn "from 'noldor'\|require('noldor')\|import('noldor')" src/testing/ scripts/test-contract.mjs; echo "root-import exit: $?"
```

Expected output: both greps empty, both exit 1. (The one `./index.js` import in `src/release/release-publish.ts:14` resolves to `src/release/index.ts` — a sibling, not `src/index.ts`.)

- [ ] **Step 2: Delete the empty placeholder**

```bash
git rm src/index.ts
```

Expected output: `rm 'src/index.ts'`

- [ ] **Step 3: Remove the library entry points from `package.json`**

Replace:

```json
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./templates/*": "./templates/*"
  },
```

with:

```json
  "type": "module",
  "exports": {
    "./templates/*": "./templates/*"
  },
```

NOTE (verified spec gap): the spec lists only `"main"` and the `"."` export; the top-level `"types": "./dist/index.d.ts"` (line 16) must also go — after deleting `src/index.ts`, `tsc` never emits `dist/index.d.ts`, so the field would dangle. The package stays bin-first: `"bin": { "noldor": "./bin/noldor.mjs" }`, `templates/` shipped via `"files"`.

- [ ] **Step 4: Typecheck, then prove the packed tarball still works for the consumer fixture**

```bash
pnpm typecheck && pnpm test:contract
```

Expected output: typecheck clean; `test:contract` packs the tarball, installs it into the consumer fixture, and passes (no consumer path imports the library root — this is the spec's safety net for the surface change; the package is not yet live on npm).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts package.json
git commit -m "chore(package): ship bin-first — drop empty src/index.ts and main/types/. export" -m "Noldor-FD: framework-script-test-migration-cleanup"
```

---

## Task 5: Stale pre-extraction path-comment sweep (U5)

**Files:**
- Modify: `src/core/consumer-config.ts`, `src/core/release-markers.ts`, `src/garden/garden-detect-runner.ts`, `src/release/release-fd-changelog.ts`, `src/release/release-fd-commits.ts`, `src/release/fd-prs-since-tag.ts`, `src/release/release-noise-types.ts`, `src/release/llm-polish-summary.ts`, `src/checks/__tests__/check-feature-slug-scope.test.ts`, `src/features/__tests__/migrate-fd-commits-to-prs.test.ts`, `src/features/__tests__/migrate-changelog-unreleased.test.ts`, `src/release/__tests__/llm-polish-summary.test.ts`, `src/release/__tests__/release-fd-changelog.test.ts`, `src/release/__tests__/fd-prs-since-tag.test.ts`, `src/release/__tests__/sdd-report-diff.test.ts`, `src/release/__tests__/release-noise-types.test.ts`, `src/release/__tests__/release-fd-commits.test.ts`, `src/dashboard/__tests__/dashboard-views.test.ts`, `src/dashboard/__tests__/dashboard-render-markdown.test.ts`, `src/hooks/__tests__/noldor-pre-commit.test.ts`, `src/cli/commands/init.ts`, `src/templates/manifest.ts`

- [ ] **Step 1: Fix the two named comments (judgment edits, meaning verified)**

In `src/core/consumer-config.ts` (lines 5–8), replace:

```ts
// Boundary rules mirror dependency-cruiser's forbidden-rule shape.
// `from.path` / `to.path` are REGEX STRINGS consumed by dep-cruiser,
// not glob patterns. See packages/noldor/src/invariants/boundaries.ts
// FORBIDDEN_RULES for canonical examples.
```

with:

```ts
// Boundary rules mirror dependency-cruiser's forbidden-rule shape.
// `from.path` / `to.path` are REGEX STRINGS consumed by dep-cruiser,
// not glob patterns. See the `boundaries` array in `.noldor/config.json`
// (consumed by src/invariants/boundaries.ts) for canonical examples.
```

(Verified: `FORBIDDEN_RULES` no longer exists in `boundaries.ts` — rules are sourced from consumer config — so the spec's suggested path-only fix would still point at a dead symbol.)

In `src/core/release-markers.ts` (line 9), replace:

```ts
 * Differs from `scripts/release/release-markers.ts` (FD-only, phase=done-gated):
```

with:

```ts
 * Differs from `src/release/release-markers.ts` (FD-only, phase=done-gated):
```

(Verified: the FD-only, phase=done-gated `fillMarkers` lives at `src/release/release-markers.ts`. The spec's parenthetical "→ `src/core/release-markers.ts`" would make the comment self-referential — this file IS `src/core/release-markers.ts`.)

- [ ] **Step 2: Fix the remaining self-describing stale comments (mechanical sweep)**

In `src/garden/garden-detect-runner.ts` (line 83), replace:

```ts
 * script's auto-restamp gate (`scripts/release/index.ts`) to decide
```

with:

```ts
 * script's auto-restamp gate (`src/release/index.ts`) to decide
```

Then run the mechanical header/comment swaps:

```bash
for f in release-fd-changelog release-fd-commits fd-prs-since-tag release-noise-types llm-polish-summary; do
  sed -i '' "1s|^// scripts/release/|// src/release/|" "src/release/$f.ts"
done
for f in src/checks/__tests__/check-feature-slug-scope.test.ts \
         src/features/__tests__/migrate-fd-commits-to-prs.test.ts \
         src/features/__tests__/migrate-changelog-unreleased.test.ts \
         src/release/__tests__/llm-polish-summary.test.ts \
         src/release/__tests__/release-fd-changelog.test.ts \
         src/release/__tests__/fd-prs-since-tag.test.ts \
         src/release/__tests__/sdd-report-diff.test.ts \
         src/release/__tests__/release-noise-types.test.ts \
         src/release/__tests__/release-fd-commits.test.ts; do
  sed -i '' "1s|^// packages/noldor/src/|// src/|" "$f"
done
sed -i '' 's|`packages/noldor/src/sync/__tests__/sync-fd-resources.test.ts`|`src/sync/__tests__/sync-fd-resources.test.ts`|' src/dashboard/__tests__/dashboard-views.test.ts
sed -i '' 's|packages/noldor/src/release/__tests__/fd-prs-since-tag.test.ts|src/release/__tests__/fd-prs-since-tag.test.ts|' src/dashboard/__tests__/dashboard-render-markdown.test.ts
sed -i '' 's|packages/noldor/src/release/index.ts:249-256|src/release/index.ts:249-256|' src/hooks/__tests__/noldor-pre-commit.test.ts
```

Expected output: no output (sed is silent). The pattern-anchored seds cannot touch the fixture strings in `dashboard-views.test.ts` (those reference `dashboard/data.ts`, not `sync/`).

- [ ] **Step 3: Reword the two consumer-monorepo comments (meaning-preserving, NOT mechanical)**

These two hits describe the CONSUMER monorepo consumption scenario (where the package genuinely lives at `packages/<pkg>/`), so a mechanical path swap would corrupt their meaning — reword instead.

In `src/cli/commands/init.ts` (lines 7–9), replace:

```ts
//   --adopt                          reverse direction: copy consumer files INTO
//                                    packages/noldor/templates/ (writes the pkg's own
//                                    templates from the live consumer state)
```

with:

```ts
//   --adopt                          reverse direction: copy consumer files INTO
//                                    the package's own templates/ dir (writes the pkg's
//                                    templates from the live consumer state)
```

In `src/templates/manifest.ts` (lines 7–8), replace:

```ts
// package is consumed via `workspace:*` (this file lives at
// `packages/noldor/src/templates/manifest.ts`) or installed flat under
```

with:

```ts
// package is consumed via `workspace:*` (this file lives under the consumer
// monorepo's `packages/<pkg>/src/templates/manifest.ts`) or installed flat under
```

- [ ] **Step 4: Run the sweep grep gate — only deliberate fixture strings remain**

```bash
grep -rn "packages/noldor/\|scripts/release/" src/ --include='*.ts'
```

Expected output — exactly these NINE hits, all string literals inside test fixtures (test DATA exercising path parsing/rendering, not comments; the spec's "zero comment hits" criterion is met):
```
src/core/__tests__/extract-touches.test.ts:68:…'Summary. Touches: `packages/noldor/src/utils/parse-blocks.ts` …
src/core/__tests__/extract-touches.test.ts:70:…toContain('packages/noldor/src/utils/parse-blocks.ts');
src/core/__tests__/allowlist.test.ts:106:…isReleaseSweepAllowed(['packages/noldor/src/core/session.ts'])…
src/core/__tests__/validate-noldor-scope.test.ts:73:…stagedFiles: ['packages/noldor/src/garden/sdd-report.ts', …
src/garden/detectors/__tests__/override-audit.test.ts:129:…['packages/noldor/src/garden/foo.ts'],
src/garden/__tests__/sdd-report.test.ts:1136:…'packages/noldor/src/garden/x.ts',
src/features/__tests__/fill-links-code-gaps.test.ts:141:…filePath: 'scripts/release/release-notes.ts',
src/dashboard/__tests__/dashboard-views.test.ts:933:…path: 'packages/noldor/src/dashboard/data.ts',
src/dashboard/__tests__/dashboard-views.test.ts:959-960:…blob/main/packages/noldor/src/dashboard/data.ts…
```

Any OTHER hit is an unswept comment (fix it the same way) or a code hit (surface it — do not silently rewrite, per spec).

- [ ] **Step 5: Verify comment-only changes broke nothing**

```bash
pnpm typecheck && pnpm test && pnpm fmt:check
```

Expected output: all clean (every edit in this task is inside comments).

- [ ] **Step 6: Commit**

```bash
git add src/core/consumer-config.ts src/core/release-markers.ts src/garden/garden-detect-runner.ts src/release/release-fd-changelog.ts src/release/release-fd-commits.ts src/release/fd-prs-since-tag.ts src/release/release-noise-types.ts src/release/llm-polish-summary.ts src/checks/__tests__/check-feature-slug-scope.test.ts src/features/__tests__/migrate-fd-commits-to-prs.test.ts src/features/__tests__/migrate-changelog-unreleased.test.ts src/release/__tests__ src/dashboard/__tests__/dashboard-views.test.ts src/dashboard/__tests__/dashboard-render-markdown.test.ts src/hooks/__tests__/noldor-pre-commit.test.ts src/cli/commands/init.ts src/templates/manifest.ts
git commit -m "chore(core): fix stale pre-extraction path comments across src/" -m "Noldor-FD: framework-script-test-migration-cleanup"
```

---

## Task 6: `DocRoots.ideas` reconciliation (U6)

**Files:**
- Test: `src/core/__tests__/doc-roots.test.ts`
- Modify: `src/core/doc-roots.ts`, `src/triage/triage-list-untriaged.ts`, `src/garden/sdd-report.ts`

- [ ] **Step 1: Verify no third consumer of `DocRoots.ideas` exists**

```bash
grep -rn "loadDocRoots().ideas\|\.ideas\b" src/ --include='*.ts' | grep -v "__tests__" | grep -v "ideas:"
```

Expected output: empty — the spec's claim "No code reads `DocRoots.ideas`" holds; the two live readers hardcode `'ideas.md'` and are rewired below. If a hit appears, stop and surface it before flipping the provider.

- [ ] **Step 2: Flip the doc-roots test expectation (RED)**

In `src/core/__tests__/doc-roots.test.ts`, replace:

```ts
    expect(r.ideas).toBe('/tmp/example/docs/ideas.md');
```

with:

```ts
    expect(r.ideas).toBe('/tmp/example/ideas.md');
```

- [ ] **Step 3: Run it — must FAIL**

```bash
pnpm vitest run src/core/__tests__/doc-roots.test.ts
```

Expected output: 1 failing test — provider still returns `/tmp/example/docs/ideas.md`.

- [ ] **Step 4: Fix the provider + its JSDoc (GREEN)**

In `src/core/doc-roots.ts`, replace:

```ts
    ideas: join(cwd, 'docs', 'ideas.md'),
```

with:

```ts
    ideas: join(cwd, 'ideas.md'),
```

and update the JSDoc block — replace:

```ts
 * `cwd`: features/ (feature MDs), roadmap.md, backlog.md, vision.md,
 * ideas.md, milestones/ (milestone MDs), plans/ (superpowers/plans), and
```

with:

```ts
 * `cwd`: features/ (feature MDs), roadmap.md, backlog.md, vision.md,
 * ideas.md (repo ROOT, not docs/ — the per-user untracked triage inbox),
 * milestones/ (milestone MDs), plans/ (superpowers/plans), and
```

Then re-run: `pnpm vitest run src/core/__tests__/doc-roots.test.ts` — expected: green.

- [ ] **Step 5: Route the triage reader through the provider**

In `src/triage/triage-list-untriaged.ts`, replace the import block:

```ts
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
```

with:

```ts
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { loadDocRoots } from '../core/doc-roots.js';
```

and replace `main()`:

```ts
async function main(): Promise<void> {
  // ideas.md is a per-user local inbox (gitignored since PR #14). Treat a
  // missing file as "no untriaged bullets" rather than crashing — matches the
  // pattern in scripts/garden/sdd-report.ts and scripts/dashboard/data.ts.
  const raw = await readFile('ideas.md', 'utf8').catch(() => '');
  const untriaged = extractUntriagedBullets(raw);
  const payload = { ideasMd: 'ideas.md', untriaged };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
```

with:

```ts
async function main(): Promise<void> {
  // ideas.md is a per-user local inbox (gitignored since PR #14) at the repo
  // root. Treat a missing file as "no untriaged bullets" rather than crashing —
  // matches the pattern in src/garden/sdd-report.ts.
  const ideasPath = loadDocRoots().ideas;
  const raw = await readFile(ideasPath, 'utf8').catch(() => '');
  const untriaged = extractUntriagedBullets(raw);
  const payload = { ideasMd: ideasPath, untriaged };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
```

The `.catch(() => '')` missing-file tolerance is preserved exactly. Two side notes, both deliberate: the stale `scripts/garden/…` comment paths get fixed while touching this comment, and `payload.ideasMd` now carries the absolute resolved path instead of the literal `'ideas.md'` (required by the acceptance criterion "no hardcoded `'ideas.md'` literal outside the provider"; the payload stays truthful).

- [ ] **Step 6: Route the sdd-report reader through the provider**

In `src/garden/sdd-report.ts` (`main()`, ~line 1118 — `loadDocRoots` is already imported and used on the line above), replace:

```ts
  const ideasMd = await readFile('ideas.md', 'utf8').catch(() => '');
```

with:

```ts
  const ideasMd = await readFile(loadDocRoots().ideas, 'utf8').catch(() => '');
```

`.catch(() => '')` preserved.

- [ ] **Step 7: Run the affected suites + literal gate — must PASS**

```bash
pnpm vitest run src/core/__tests__/doc-roots.test.ts src/triage src/garden/__tests__/sdd-report.test.ts
grep -n "'ideas.md'" src/garden/sdd-report.ts src/triage/triage-list-untriaged.ts; echo "literal gate exit: $?"
pnpm typecheck
```

Expected output: vitest green (triage tests exercise only the pure `extractUntriagedBullets`, so no payload assertions break — verified), `literal gate exit: 1` (zero string-literal hits), typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/core/doc-roots.ts src/core/__tests__/doc-roots.test.ts src/triage/triage-list-untriaged.ts src/garden/sdd-report.ts
git commit -m "fix(core): DocRoots.ideas resolves to repo-root ideas.md, readers use the provider" -m "Noldor-FD: framework-script-test-migration-cleanup"
```

---

## Task 7: First tests for `src/invariants/` (U8, part 1)

**Files:**
- Create: `src/invariants/__tests__/rule-conflicts.test.ts`, `src/invariants/__tests__/boundaries.test.ts`

Both tests target factory functions that survive the later `self-boundaries-declaration-and-cycle-break` plan. No `keyboard-binding.ts` tests (that module gets deleted by the later plan).

- [ ] **Step 1: Write the rule-conflicts test**

Create `src/invariants/__tests__/rule-conflicts.test.ts`:

```ts
// @tests: framework-script-test-migration-cleanup
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeRuleConflictsInvariant } from '../rule-conflicts.js';

import type { Invariant as RuleInvariant } from '../../garden/garden-invariants.js';

const pair: RuleInvariant = {
  name: 'test-pair',
  docA: 'docs/a.md',
  docB: 'docs/b.md',
  patternA: /pnpm test\b/,
  patternB: /pnpm test\b/,
  message: 'docs/a.md and docs/b.md must both reference `pnpm test`.',
};

describe('makeRuleConflictsInvariant', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rule-conflicts-'));
    mkdirSync(join(root, 'docs'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes when both docs match the canonical phrasing', async () => {
    writeFileSync(join(root, 'docs', 'a.md'), 'run pnpm test before pushing\n');
    writeFileSync(join(root, 'docs', 'b.md'), 'CI runs pnpm test\n');
    const result = await makeRuleConflictsInvariant(root, [pair]).run();
    expect(result.invariant).toBe('rule-conflicts');
    expect(result.violations).toEqual([]);
  });

  it('flags the non-matching side when exactly one doc matches', async () => {
    writeFileSync(join(root, 'docs', 'a.md'), 'run pnpm test before pushing\n');
    writeFileSync(join(root, 'docs', 'b.md'), 'CI runs the suite\n');
    const result = await makeRuleConflictsInvariant(root, [pair]).run();
    expect(result.violations).toEqual([{ file: 'docs/b.md', message: pair.message }]);
  });

  it('stays silent when neither doc matches (rule absent in both)', async () => {
    writeFileSync(join(root, 'docs', 'a.md'), 'nothing here\n');
    writeFileSync(join(root, 'docs', 'b.md'), 'nothing here either\n');
    const result = await makeRuleConflictsInvariant(root, [pair]).run();
    expect(result.violations).toEqual([]);
  });

  it('treats a missing doc as non-matching (missing-file tolerance)', async () => {
    writeFileSync(join(root, 'docs', 'a.md'), 'run pnpm test before pushing\n');
    const result = await makeRuleConflictsInvariant(root, [pair]).run();
    expect(result.violations).toEqual([{ file: 'docs/b.md', message: pair.message }]);
  });
});
```

- [ ] **Step 2: Run it — must PASS (coverage-floor tests assert existing behavior; no RED phase to fabricate)**

```bash
pnpm vitest run src/invariants/__tests__/rule-conflicts.test.ts
```

Expected output: 4 tests green.

- [ ] **Step 3: Write the boundaries test (schema contract + real dep-cruiser run)**

Create `src/invariants/__tests__/boundaries.test.ts`:

```ts
// @tests: framework-script-test-migration-cleanup
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BoundaryRuleSchema } from '../../core/consumer-config.js';
import { makeBoundariesInvariant } from '../boundaries.js';

// Regex-string rule in dependency-cruiser's forbidden-rule shape — the
// "regex strings, not globs" contract documented in consumer-config.ts.
const RULE = {
  name: 'no-a-to-b',
  severity: 'error' as const,
  from: { path: '^src/a\\.ts$' },
  to: { path: '^src/b\\.ts$' },
};

function writeConsumerConfig(root: string, scanPaths: string[]): void {
  const config = {
    consumer: {
      name: 'fixture',
      repoUrl: 'https://example.com/fixture',
      lockstepPackages: ['package.json'],
      scanPaths,
      boundaries: [RULE],
      deprecatedPackages: [],
      e2ePrefix: 'e2e/',
      samplesPath: 'samples',
      packagePrefix: '@fixture/',
      appPathPrefix: 'src',
    },
  };
  mkdirSync(join(root, '.noldor'), { recursive: true });
  writeFileSync(join(root, '.noldor', 'config.json'), JSON.stringify(config, null, 2));
}

describe('BoundaryRuleSchema', () => {
  it('accepts a dep-cruiser forbidden rule with regex-string paths', () => {
    expect(BoundaryRuleSchema.parse(RULE)).toEqual(RULE);
  });

  it('rejects unknown keys (strict schema)', () => {
    const result = BoundaryRuleSchema.safeParse({ ...RULE, glob: 'src/**' });
    expect(result.success).toBe(false);
  });
});

describe('makeBoundariesInvariant', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'boundaries-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it(
    'flags a forbidden import between configured scan paths',
    async () => {
      writeConsumerConfig(root, ['src']);
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'a.ts'), "import './b';\nexport const a = 1;\n");
      writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 1;\n');
      const result = await makeBoundariesInvariant(root).run();
      expect(result.invariant).toBe('boundaries');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].file).toBe('src/a.ts');
      expect(result.violations[0].message).toContain('forbidden import (no-a-to-b)');
      expect(result.violations[0].message).toContain('src/b.ts');
    },
    20_000,
  );

  it('returns zero violations when no configured scanPath exists on disk', async () => {
    writeConsumerConfig(root, ['no-such-dir']);
    const result = await makeBoundariesInvariant(root).run();
    expect(result.violations).toEqual([]);
  });
});
```

NOTE (verified spec deviation): the spec's U8 asked to "assert `FORBIDDEN_RULES` entries parse against `BoundaryRuleSchema`", but `FORBIDDEN_RULES` was removed from `boundaries.ts` (rules now come from the consumer config). This test locks the same regex-strings-not-globs contract via `BoundaryRuleSchema` directly plus a real `makeBoundariesInvariant` run (which internally `realpath`s the tmp root — macOS `/var` symlink safe).

- [ ] **Step 4: Run it — must PASS**

```bash
pnpm vitest run src/invariants/__tests__/boundaries.test.ts
```

Expected output: 4 tests green (the dep-cruiser case takes ~1–2s, inside its 20s budget).

- [ ] **Step 5: Commit**

```bash
git add src/invariants/__tests__/rule-conflicts.test.ts src/invariants/__tests__/boundaries.test.ts
git commit -m "test(invariants): first tests — rule-conflicts pairs + boundaries schema/dep-cruiser" -m "Noldor-FD: framework-script-test-migration-cleanup"
```

---

## Task 8: First test for `src/validate/` + final acceptance sweep (U8 part 2 + wrap-up)

**Files:**
- Create: `src/validate/__tests__/noldor-config.test.ts`

- [ ] **Step 1: Write the subprocess test for `noldor validate noldor-config`**

`src/validate/noldor-config.ts` runs `main()` at module load (top-level `main();` with `process.exit`), so importing it under vitest would kill the worker — exercise it the way it ships: through the CLI router (`src/cli/manifest.ts` wires it as `noldor validate noldor-config`), spawned with a temp cwd (its `loadConfig` resolves `.noldor/config.json` against `process.cwd()`).

Create `src/validate/__tests__/noldor-config.test.ts`:

```ts
// @tests: framework-script-test-migration-cleanup
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '..', '..', '..', 'bin', 'noldor.mjs');

function runValidate(cwd: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, 'validate', 'noldor-config'], {
    cwd,
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('noldor validate noldor-config', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'noldor-config-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it(
    'accepts a minimal valid .noldor/config.json',
    () => {
      mkdirSync(join(root, '.noldor'));
      writeFileSync(
        join(root, '.noldor', 'config.json'),
        JSON.stringify({ crLanes: { code: ['subagent'] } }),
      );
      const r = runValidate(root);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('.noldor/config.json valid');
    },
    30_000,
  );

  it(
    'rejects a malformed config with a readable error',
    () => {
      mkdirSync(join(root, '.noldor'));
      // crLanes lanes require at least one entry — zod .min(1) violation.
      writeFileSync(join(root, '.noldor', 'config.json'), JSON.stringify({ crLanes: { code: [] } }));
      const r = runValidate(root);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('.noldor/config.json INVALID:');
    },
    30_000,
  );

  it(
    'treats an absent config as OK (interactive mode only)',
    () => {
      const r = runValidate(root);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('absent (OK — interactive mode only)');
    },
    30_000,
  );
});
```

- [ ] **Step 2: Run it — must PASS**

```bash
pnpm vitest run src/validate/__tests__/noldor-config.test.ts
```

Expected output: 3 tests green (each spawn pays tsx startup, ~2–4s per case — inside the 30s budgets).

- [ ] **Step 3: Full verification — suite, types, lint/fmt, contract**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm fmt:check && pnpm test:contract
```

Expected output: everything green against the fully-swept tree.

- [ ] **Step 4: Acceptance grep gates (scoped per the verified reality deltas in the preamble)**

```bash
grep -rn "cr-retry" src/ templates/ .claude/skills/; echo "cr-retry: $?"
grep -rn "compareSemver\|parseSemver" src/migrations/; echo "semver: $?"
grep -rcn "packages/noldor/\|scripts/release/" src/ --include='*.ts' | grep -v ':0' | wc -l
grep -n "'ideas.md'" src/garden/sdd-report.ts src/triage/triage-list-untriaged.ts; echo "ideas: $?"
ls src/graphify-out 2>&1; ls scripts/migration 2>&1; ls src/index.ts src/core/cr-retry.ts src/migrations/semver.ts 2>&1
```

Expected output: `cr-retry: 1`, `semver: 1`, `ideas: 1` (all empty); the `packages/noldor|scripts/release` count shows only the 8 fixture-bearing test files from Task 5 Step 4; every `ls` prints `No such file or directory`.

- [ ] **Step 5: Commit**

```bash
git add src/validate/__tests__/noldor-config.test.ts
git commit -m "test(validate): subprocess coverage for noldor validate noldor-config" -m "Noldor-FD: framework-script-test-migration-cleanup"
```
