# Scope Sibling Trailer for Doc-Sync Commits — Design

**Slug:** scope-sibling-trailer-for-doc-sync-commits
**FD:** docs/features/scope-sibling-trailer-for-doc-sync-commits.md
**Date:** 2026-07-03
**Tier:** specs-only
**Deps:** none

## Problem

The roadmap entry asked to **re-verify the pain before spec'ing**. Verified against current code (`src/core/validate-noldor-scope.ts`, `src/core/__tests__/validate-noldor-scope.test.ts`):

- **Doc-only edits do NOT bite.** Multi-page `docs/noldor/*.md` diffs pass under a plain `noldor` scope (`validateScope`, src/core/validate-noldor-scope.ts:134; test "passes with framework-wide noldor scope on multi-page diff"). The 2026-07-02 note is correct on this half.
- **Mixed code + doc-sync commits DO bite.** A commit like `feat(prep): add dispatch` staging `src/prep/*.ts` **and** `docs/noldor/workflow.md` fails: scope is neither `noldor` nor `noldor:<slug>` (src/core/validate-noldor-scope.ts:138-143; test "suggests the specific page slug when exactly one noldor file is staged", line 70). Today's options are all bad:
  1. **Split** into two commits → 2× gate dance (session, trailers, hook run); one logical change becomes two log entries. Memory of this friction is recent: PR #126 hit "noldor-scope hook forces commit split for docs/noldor/".
  2. **Retitle** to `feat(noldor)` → passes, but destroys the code scope: `git log --grep`/changelog semantics lose the real subsystem, and the commit masquerades as framework-docs work.
  3. **`Noldor-Path-Override`** → full bypass of the scope check (src/core/validate-noldor-scope.ts:109), lands in `.noldor/overrides.log` + the `/garden` `override-audit` detector — wrong tool for a legitimate, routine pattern.
- **The "3 commits" claim in the entry is overstated.** `docs/features/<slug>.md` syncs are never forced out: `validateScope` filters only `docs/noldor/` paths (line 77-79), and `check-feature-slug-scope.ts` (src/checks/check-feature-slug-scope.ts) validates only that a `<pkg>:<slug>` scope references an existing FD — it never inspects staged files. The real forced split is **2** commits, and only when `docs/noldor/` pages ride along with scoped code changes.

So: pain is real but narrower than the entry body claims. The fix should be scoped to exactly that case — let a code-scoped commit declare its doc-sync siblings explicitly.

## Goals

- One atomic commit for "feat in code + sibling `docs/noldor/<page>.md` sync", keeping the meaningful code scope in the subject.
- The mechanism is explicit and auditable (a trailer in git history), not a heuristic waiver.
- Sibling doc pages remain validated: unknown slugs still rejected.
- Page changelog derivation (`src/core/changelog.ts`) still sees these commits — the doc page **did** change.
- Validator error message teaches the new escape so agents discover it at the moment of failure.

## Non-goals

- **Heuristic auto-detect** of "doc-sync-for-this-feat" patterns (the entry's alternative). Rejected — implicit waivers erode the gate silently and are unauditable; see Open question 1.
- Auto-injecting the trailer in the `prepare-commit-msg` hook (`src/hooks/noldor-inject-trailers.ts`). The trailer must be deliberate.
- Any change to `check-feature-slug-scope.ts` — it never forces splits, so no sibling mechanism is needed there.
- Consumer-configurable trailer names or page-set exemptions.
- Relaxing the doc-only rules: a commit staging only `docs/noldor/` files must still use a `noldor`/`noldor:<slug>` subject scope.

## Design

### U1 — Trailer grammar + validation branch (`src/core/validate-noldor-scope.ts`)

New trailer: `Noldor-Sibling-Scope: <scope-list>` where `<scope-list>` is a comma-separated list of `noldor` or `noldor:<slug>` tokens, e.g.:

```
feat(prep): add dispatch runner

Noldor-Sibling-Scope: noldor:workflow, noldor:script-catalog
Noldor-Path: fast-track
```

`validateScope` already calls `parseTrailers` (from `src/core/trailers.ts`) for the `Noldor-Path` bypasses. Extend the flow after the subject-scope checks fail (i.e. scope is present but neither `noldor` nor `noldor:<slug>`, and also the no-scope branch):

1. Read `trailers['Noldor-Sibling-Scope']`. Absent → current behavior unchanged.
2. **Mixed-diff guard:** the trailer is honored only when `stagedFiles` contains at least one non-`docs/noldor/` file. A doc-only commit carrying the trailer fails with a dedicated error ("doc-only commit: put the scope in the subject, not Noldor-Sibling-Scope") — this keeps the trailer from becoming a general subject-scope bypass.
3. Parse the list. Each token must be `noldor` or `noldor:<slug>` with `<slug> ∈ knownSlugs` — reuse the existing `knownSlugs` set and the unknown-slug error shape (line 146-151). A malformed token fails the commit.
4. If the list contains bare `noldor` → all staged `docs/noldor/` files accepted (parity with subject-scope semantics, line 134).
5. Otherwise every staged noldor file's slug (via existing `pathToSlug`, line 52) must appear in the list; any uncovered file fails with the affected-files listing (`renderAffected`, line 72).

Because `parseTrailers` uses `git interpret-trailers --parse`, a sibling trailer stranded mid-body is ignored — same stranded-trailer discipline the `Noldor-Path-Override` fix established (test "ignores Noldor-Path-Override outside the trailer block"). The existing `detectDroppedTrailers` net in `src/hooks/noldor-validate-trailer.ts:89` already covers any `Noldor-*` key, so a wrapped sibling value is rejected loudly rather than silently dropped. `noldor-validate-trailer.ts` has no strict key whitelist, so the new trailer needs **no change** there.

### U2 — Error-message teaching (`buildSuggestion` call sites)

The mixed-diff failure message (line 138-143) currently suggests retitle-or-split. Append the third option:

```
... (or split: ...; or keep "feat(prep)" and add trailer "Noldor-Sibling-Scope: noldor:workflow").
```

Reuse the slug set computed in `buildSuggestion` (line 63-69): one page → `noldor:<slug>`, multiple pages → comma-joined `noldor:<slug>` list (NOT bare `noldor` — suggest the precise form).

### U3 — Changelog derivation learns the trailer (`src/core/changelog.ts`)

`filterCommitsForPage` (line 52-63) qualifies a commit for a page changelog only via subject scope, so sibling-trailer commits (subject `feat(prep)`) would become invisible to page history — a regression the design must prevent.

- `loadCommits` (line 71-94): extend the format to `--format=%H%x09%s%x09%(trailers:key=Noldor-Sibling-Scope,valueonly,separator=%x2C)` and parse the third tab field into a new `Commit.siblingScopes: string[]` (empty when absent). Trailer values cannot contain tabs, so the tab-split parse stays safe; the `COMMIT_LINE_RE` hash-prefix guard (line 80) is unaffected.
- `filterCommitsForPage`: a commit also qualifies when `siblingScopes` includes `noldor` or `noldor:<pageSlug>` AND `c.files` includes the page path (same file-touch condition as today, line 60-61).
- `parseScope` (line 32-40) unchanged.

`src/core/release-markers.ts` needs no change — it stamps `introduced` from file presence, not scope.

### U4 — Docs + template twins

- `docs/noldor/git-and-commits.md` "Trailer schema" block: add `Noldor-Sibling-Scope: <noldor scope-list>  # optional; mixed code+doc commits` line + a short subsection under "Conventional Commits" explaining when to use it.
- `docs/noldor/script-catalog.md` `validate:noldor-scope` entry (line 38-44): document the trailer acceptance path.
- Both pages have twins under `templates/docs/noldor/` — edit both sides or `checks/check-template-sync.ts` blocks the commit (known gotcha from prior drains).

### U5 — Tests

- `src/core/__tests__/validate-noldor-scope.test.ts`: mixed diff + covering trailer passes; trailer with uncovered page fails; unknown slug in trailer fails; doc-only commit + trailer fails (guard); bare `noldor` token accepts multi-page; stranded-mid-body trailer ignored (mirrors line 138-147 pattern).
- `src/core/__tests__/changelog.test.ts`: sibling-trailer commit appears in the page's filtered list; commit with trailer but not touching the page file stays excluded.

## Acceptance criteria

- `git commit -m "feat(prep): x" ` staging `src/prep/a.ts` + `docs/noldor/workflow.md` with trailer `Noldor-Sibling-Scope: noldor:workflow` passes the `noldor-scope` commit-msg job (lefthook/noldor.yml:80-83).
- Same commit **without** the trailer fails, and the error text names `Noldor-Sibling-Scope` with a concrete suggested value.
- Doc-only staged set + sibling trailer → commit rejected with the doc-only guard message.
- Trailer token `noldor:nonexistent` → rejected listing valid slugs (same shape as the subject-scope unknown-slug error).
- `pnpm noldor validate noldor-scope <msg-file>` CLI path exercises the same logic (single `validateScope` entry, `main()` at src/core/validate-noldor-scope.ts:176).
- `filterCommitsForPage` includes a sibling-trailer commit for the listed page and excludes it for unlisted pages; existing changelog tests stay green.
- No change needed in `src/hooks/noldor-validate-trailer.ts` behavior (unknown-key tolerance verified — asserted by a test that a message with only `Noldor-Sibling-Scope` + valid `Noldor-Path` passes trailer validation).
- `docs/noldor/git-and-commits.md` + `script-catalog.md` and their `templates/docs/noldor/` twins updated in lockstep (`checks/check-template-sync.ts` green).

## Risks / trade-offs

- **Gate erosion:** a lazy agent could stamp `Noldor-Sibling-Scope: noldor` on every mixed commit. Mitigated by the mixed-diff guard, slug validation, and the error message suggesting the precise slug form — and unlike `Noldor-Path-Override`, the trailer never bypasses anything else. Residual risk accepted; the trailer is greppable if an audit detector is ever wanted (deliberately deferred).
- **Changelog format change:** extending `git log --format` with `%(trailers:key=...)` requires git ≥ 2.22 (already required by `interpret-trailers --parse` usage patterns in the repo); parse relies on tab separation, safe because trailer values are single-line by the dropped-trailer rule.
- **Two validators drift:** scope acceptance now lives in the subject rules AND the trailer rules; a future page-slug rename must keep both test suites green. Low — both share `knownSlugs`/`pathToSlug`.

## User Story

As an agent shipping a feature that also syncs its `docs/noldor/` page, I want to declare the doc pages as sibling scopes via a `Noldor-Sibling-Scope` trailer, so that one logical change lands as one atomic commit with its real code scope instead of splitting into a doc commit and a code commit.

## Usage

```bash
# Mixed commit: code + its doc-sync page, one commit, real scope kept
git add src/prep/dispatch.ts docs/noldor/workflow.md
git commit -m "feat(prep): add dispatch runner" \
  -m "Noldor-Sibling-Scope: noldor:workflow" \
  -m "Noldor-Path: fast-track"

# Multiple sibling pages
git commit -m "feat(core): rework session markers" \
  -m "Noldor-Sibling-Scope: noldor:workflow, noldor:script-catalog" ...

# Validation is the existing commit-msg job — no new CLI surface
pnpm noldor validate noldor-scope .git/COMMIT_EDITMSG
```

On failure, the validator error itself prints the exact trailer line to add.

## Open questions (resolved)

1. *Explicit trailer or heuristic auto-waive of "doc-sync-for-this-feat" patterns (the entry's alternative)?*
   -> Explicit trailer (D1). A heuristic waiver is unauditable and silently widens over time; the trailer leaves an intent record in git history at zero runtime cost.
2. *Should the trailer accept bare `noldor` (any pages), or only enumerated `noldor:<slug>` tokens?*
   -> Accept bare `noldor` (D2). Parity with subject-scope semantics (subject `noldor` already accepts any page set) keeps one mental model; the error message still suggests the precise slug form, so laziness isn't taught.
3. *Should a doc-only commit be allowed to carry the trailer instead of a `noldor` subject scope?*
   -> No — reject with a dedicated error (D3). The trailer exists solely to preserve a meaningful code scope on a mixed diff; for doc-only commits the subject scope is strictly better (changelog derivation reads subjects first).
4. *Must changelog derivation (`filterCommitsForPage`) learn the trailer, or is subject-scope-only acceptable?*
   -> Must learn it (D4). Otherwise every commit using the new trailer makes its page edit invisible to page changelogs — the feature would degrade doc history exactly where it's used.
5. *Auto-inject the trailer in `noldor-inject-trailers` (prepare-commit-msg) from staged `docs/noldor/` files?*
   -> No (D5). Auto-injection would legitimize accidental doc edits riding in feature commits; deliberate authoring is the point, and the validator error already hands the agent the exact line to add.
6. *Extend the same mechanism to `check-feature-slug-scope.ts` for `docs/features/` siblings?*
   -> No (D6). Verified that validator never inspects staged files and never forces splits — the entry's "3 commits" premise was wrong on that leg; no pain, no mechanism.
