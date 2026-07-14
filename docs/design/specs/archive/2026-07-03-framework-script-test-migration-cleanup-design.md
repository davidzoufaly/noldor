# Framework Script + Test Migration Cleanup — Design

**Slug:** framework-script-test-migration-cleanup
**FD:** docs/features/noldor.md
**Date:** 2026-07-03
**Tier:** specs-only
**Deps:** none

## Problem

The 2026-07 deep audit inventoried cruft that accumulated during the Charuy → Noldor extraction and the migration-era churn (FD frontmatter shape changes, gate path additions, garden detector rollouts). It is all still on disk:

- `src/core/cr-retry.ts` (56 lines) + `src/core/__tests__/cr-retry.test.ts` (47 lines) — dead code. `.claude/skills/gate/SKILL.md:248` explicitly says "`src/core/cr-retry.ts` survives on disk as dead code for a separate refactor pass; the gate no longer calls it." Nothing outside the test imports it.
- `scripts/migration/` — five one-shot extraction scripts (`classify.ts`, `classify-feature-track.ts`, `cross-tree-link-audit.ts`, `partition-blocks.ts`, `stage-framework-docs.ts`) plus four tests. Referenced only by archived specs/plans (`docs/design/{specs,plans}/archive/2026-05-28-framework-doc-extraction-*`); no `package.json` script, no pipeline, no live doc points at them. They ran once for PR #57 (Phase B doc migration).
- `src/index.ts` is an empty placeholder ("Task 3 onward adds `export * from …` lines here. Until then this module is empty.") yet `package.json` declares `"main": "./dist/index.js"` and a `"."` export — the published package advertises a library entry that exports nothing.
- Duplicate semver: `src/migrations/semver.ts` (hand-rolled `parseSemver`/`compareSemver`, 16 lines, consumed only by `src/migrations/chain.ts:3`) coexists with the npm `semver` package already in `dependencies` and used by `src/release/release-version.ts:4`.
- Stale pre-extraction path comments: `src/core/consumer-config.ts:7` points at `packages/noldor/src/invariants/boundaries.ts` (now `src/invariants/boundaries.ts`); `src/core/release-markers.ts:9` points at `scripts/release/release-markers.ts` (the FD-marker logic now lives in `src/core/release-markers.ts` itself / `src/release/`).
- `ideas.md` lives at repo root (gitignored-then-untracked history noted in `src/triage/triage-list-untriaged.ts:73`), but `src/core/doc-roots.ts:28` maps `ideas: join(cwd, 'docs', 'ideas.md')` — a path that has never existed. No code reads `DocRoots.ideas`; the two real consumers (`src/triage/triage-list-untriaged.ts:76`, `src/garden/sdd-report.ts:1118`) hardcode `readFile('ideas.md')`, bypassing the provider entirely.
- `src/graphify-out/junk.ts` (`export const x=1`) + `src/graphify-out/cache/` — untracked stray graphify output inside a scanned source dir. `.gitignore:50-52` already ignores nested `*/graphify-out/`, so it can't be committed, but it sits on disk polluting globs and per-dir scans.

Conversely, the audit asks where shipped features lack tests. A per-directory sweep of `src/` shows exactly two zero-test directories: `src/invariants/` (6 source files — `boundaries.ts`, `keyboard-binding.ts`, `public-api-tsdoc.ts`, `rule-conflicts.ts`, `index.ts`, `types.ts` — 0 tests) and `src/validate/` (`noldor-config.ts`, 0 tests). Every other directory has meaningful coverage (e.g. core 46/36, cr 30/30, release 22/28).

## Goals

- Delete migration-era dead code and one-shot scripts that no live pipeline references.
- Collapse the duplicate semver implementation onto the npm `semver` dependency.
- Make the published package honest: no library `main`/`"."` export pointing at an empty module.
- Fix the two stale path comments and sweep for any remaining `packages/noldor/` or `scripts/release/` path references in `src/` comments.
- Reconcile `DocRoots.ideas` with reality and route the two hardcoded `ideas.md` readers through the provider.
- Add first tests to the only two zero-test directories: `src/invariants/` and `src/validate/`.

## Non-goals

- No new `/garden` detector for migration-era scripts (see D4 — one-pass sweep suffices; the orphan-source detector already walks `scripts/`).
- No touching `scripts/test-contract.mjs` — live via `package.json` `"test:contract"` script.
- No rewriting archived specs/plans that mention `scripts/migration/` — archives are historical record.
- No exhaustive per-file coverage push inside directories that already have tests.

## Design

### U1 — Delete dead CR retry loop

Remove `src/core/cr-retry.ts` and `src/core/__tests__/cr-retry.test.ts`. Update the historical note at `.claude/skills/gate/SKILL.md:248` (and its template twin `templates/.claude/skills/gate/SKILL.md:248`) to drop the "survives on disk as dead code for a separate refactor pass" clause — the sentence becomes "Both are removed" full stop. Twin edit needs `NOLDOR_ALLOW_SHARED` per the shared-files guard.

### U2 — Delete `scripts/migration/`

Remove the whole directory (5 scripts, 4 tests under `scripts/migration/__tests__/`, `.gitkeep`). Verification before delete: `grep -rn "scripts/migration"` across `src/`, `package.json`, `.github/`, `lefthook.yml`, non-archive `docs/` must return nothing (current state: only archive hits).

### U3 — Semver dedup

In `src/migrations/chain.ts:3`, replace `import { compareSemver } from './semver.js'` with `import semver from 'semver'` and swap `compareSemver(a, b)` call sites for `semver.compare(a, b)` (identical `-1|0|1` contract). Delete `src/migrations/semver.ts` and `src/migrations/__tests__/semver.test.ts`. `parseSemver` has no consumer outside the deleted module. `semver` is already a runtime dependency (`package.json:52`), so no dependency change.

### U4 — Package entry honesty

Delete `src/index.ts`. Remove `"main": "./dist/index.js"` (`package.json:15`) and the `"."` entry from `"exports"` (`package.json:17-21`); the package stays bin-first (`"bin": { "noldor": "./bin/noldor.mjs" }`) with `templates/` shipped via `"files"`. Run `pnpm test:contract` (packs + installs the tarball into the consumer fixture) to prove no consumer path imports the library root.

### U5 — Stale path comment sweep

Fix `src/core/consumer-config.ts:7` (`packages/noldor/src/invariants/boundaries.ts` → `src/invariants/boundaries.ts`) and `src/core/release-markers.ts:9` (`scripts/release/release-markers.ts` → `src/core/release-markers.ts`). Then one grep sweep: `grep -rn "packages/noldor/\|scripts/release/" src/ --include='*.ts'` and fix every comment hit the same way (code hits, if any, are bugs to surface, not silently rewrite).

### U6 — `DocRoots.ideas` reconciliation

Change `src/core/doc-roots.ts:28` to `ideas: join(cwd, 'ideas.md')` (repo root — matching both real readers). Route `src/triage/triage-list-untriaged.ts:76` and `src/garden/sdd-report.ts:1118` through `loadDocRoots().ideas` instead of hardcoded `'ideas.md'` strings, preserving the existing `.catch(() => '')` missing-file tolerance (ideas.md is a per-user local inbox). Update the JSDoc at `src/core/doc-roots.ts:17` accordingly.

### U7 — graphify litter removal

`rm -rf src/graphify-out/` (untracked: `git ls-files src/graphify-out` is empty; `.gitignore:52` `*/graphify-out/` already prevents recurrence). Disk-only cleanup, no commit content beyond nothing.

### U8 — First tests for zero-test directories

- `src/invariants/__tests__/rule-conflicts.test.ts` — exercise the conflict-detection function(s) on a minimal conflicting/non-conflicting rule pair.
- `src/invariants/__tests__/boundaries.test.ts` — assert `FORBIDDEN_RULES` entries parse against `BoundaryRuleSchema` from `src/core/consumer-config.ts` (locks the "regex strings, not globs" contract the U5 comment references).
- `src/validate/__tests__/noldor-config.test.ts` — accept a minimal valid `.noldor/config.json` shape; reject a malformed one with a readable error.

Scope cap: one focused test file per module actually exercised; this is a floor, not a coverage campaign.

## Acceptance criteria

- `src/core/cr-retry.ts`, its test, `scripts/migration/` (entire dir), `src/migrations/semver.ts`, its test, and `src/index.ts` no longer exist; `pnpm test` and `pnpm typecheck` pass.
- `grep -rn "cr-retry" src/ .claude/ templates/` returns zero hits.
- `package.json` has no `"main"` and no `"."` export; `pnpm test:contract` passes against the packed tarball.
- `src/migrations/chain.ts` imports `semver` from npm; `grep -rn "compareSemver\|parseSemver" src/` returns zero hits.
- `grep -rn "packages/noldor/\|scripts/release/" src/ --include='*.ts'` returns zero comment hits.
- `loadDocRoots().ideas` resolves to `<cwd>/ideas.md`; `triage-list-untriaged.ts` and `sdd-report.ts` contain no hardcoded `'ideas.md'` literal outside the provider; existing triage/sdd-report tests still pass.
- `src/graphify-out/` absent from disk.
- `src/invariants/__tests__/` and `src/validate/__tests__/` exist with the three test files above, all green.
- Gate SKILL.md (both copies) no longer claims cr-retry survives on disk.

## Risks / trade-offs

- **Dropping `main`/`"."` export is a published-package surface change.** The package went to npm via registry-distribution (PR #139) but is not yet live (Trusted Publisher pending), so no external consumer can break; `pnpm test:contract` is the safety net. If a consumer someday wants library imports, re-adding an entry is additive.
- **Gate SKILL.md edit touches a shared skill twin** — requires `NOLDOR_ALLOW_SHARED` and keeping `.claude/skills/gate/SKILL.md` + `templates/.claude/skills/gate/SKILL.md` byte-identical, a known pre-commit tripwire.
- **`semver.compare` vs hand-rolled `compareSemver`** — npm semver rejects malformed versions by throwing where `parseSemver` returned `NaN` tuples; migration chain inputs are package versions from our own registry, so throwing on garbage is an improvement, but the swap should keep `chain.test.ts` green.
- **U6 changes read paths in two live consumers** — behavior-preserving only because both already read root `ideas.md`; the provider indirection must not change the missing-file tolerance.

## User Story

As a framework maintainer, I want migration-era scripts, dead code, duplicate implementations, and stale path references swept out in one pass — and the only zero-test directories given a coverage floor — so that the codebase agents navigate reflects only the live framework, not the scaffolding used to build it.

## Usage

**One-pass sweep (implementer):**

1. `/gate` on this FD (specs-only tier), then execute units U1–U8 in order; U1–U7 are deletions/edits, U8 adds tests.
2. Verify: `pnpm test && pnpm typecheck && pnpm test:contract`.
3. Grep gates from Acceptance criteria (`cr-retry`, `compareSemver`, `packages/noldor/`, `scripts/release/`) must all come back empty.

**Operator-visible surface:** none — no CLI, config, or doc-page changes beyond the gate SKILL.md historical-note edit and `package.json` entry-point removal. `pnpm noldor triage` and `pnpm garden:detect` behave identically (same root `ideas.md` file, now resolved via `loadDocRoots()`).

## Open questions (resolved)

1. *Should the package keep a library entry point (`main` + `"."` export) with real re-exports instead of deleting `src/index.ts`?* -> Delete it; ship bin-first. (D1) No consumer imports the library root (contract test proves it), the placeholder has been empty since extraction, and re-adding an export map later is additive and cheap.
2. *Replace `src/migrations/semver.ts` with npm `semver`, or keep the hand-rolled copy to keep the migration chain dependency-light?* -> Replace with npm `semver`. (D2) It is already a runtime dependency used by `src/release/release-version.ts`, so "dependency-light" buys nothing; two semver implementations is exactly the drift the audit flagged.
3. *Fix `DocRoots.ideas` to root `ideas.md`, or move the file to `docs/ideas.md` to match the provider?* -> Fix the provider to root `ideas.md`. (D3) Both live readers, the triage skill, and the operator's muscle memory already use root `ideas.md`; moving the file breaks a per-user untracked inbox for zero benefit.
4. *Build the `/garden` detector that flags scripts referenced only in migration-era commits?* -> No — one-pass sweep only. (D4) After U2 the migration-script class is empty, the orphan-source detector already walks `scripts/`, and a commit-history heuristic detector is M-sized work guarding against a low-recurrence failure mode.
5. *How far should the coverage-gap side go?* -> Only the two genuinely zero-test directories (`src/invariants/`, `src/validate/`), one focused test file per exercised module. (D5) The per-directory sweep shows every other dir has real coverage; a broader campaign belongs in its own entry, not a cleanup sweep.
