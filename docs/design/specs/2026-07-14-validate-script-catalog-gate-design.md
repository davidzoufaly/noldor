# Validate Script-Catalog Gate — Design

**Slug:** validate-script-catalog-gate
**FD:** docs/features/validate-script-catalog-gate.md
**Date:** 2026-07-14
**Tier:** specs-only

## Problem

`validate skill-catalog` ([`src/core/validate-skill-catalog.ts`](../../../src/core/validate-skill-catalog.ts)) keeps `docs/noldor/skill-catalog.md` perfectly 1:1 with the skills on disk — add a skill without a catalog entry and pre-commit blocks. Its sibling `docs/noldor/script-catalog.md` (self-declared canonical for the CLI surface) has **no such gate**, so it rotted: **28 manifest subcommands are undocumented** (whole groups `prep`, `research`, `roadmap`; plus `cr bootstrap`, `triage mint-id`, `worktrees create/up/down`, `noldor split-check`, `clones`, `wait`, `fmt`, `upgrade`, …). The page also carries two lies:

1. Line 10: *"Strict `validate:script-catalog` drift gate is not yet implemented … Backlog entry tracks the gate."* — no such backlog entry exists (verified: `docs/backlog.md` has none).
2. Line 172: *"the 19 numbered detectors"* — the canonical numbered table at `docs/noldor/garden-and-drift.md:26-47` has **20** rows. Separately, `docs/noldor/lifecycle.md:88` and `docs/noldor/triage.md:121` say **13** SDD detectors, but `collectGaps()` ([`src/garden/sdd-report.ts:588`](../../../src/garden/sdd-report.ts)) runs **14** (slots 1-13 + 19).

Gated docs stay true; ungated docs rot. This closes the gap for the CLI surface.

## Goals

- A check-only `validate script-catalog` gate that fails when a manifest leaf command is undocumented in `docs/noldor/script-catalog.md`, mirroring the skill-catalog gate's structure and pre-commit wiring (incl. the template twin under `templates/`).
- One-time catch-up: document the 28 absent subcommands so the gate is green when it lands.
- Fix the two false claims (line 10 gate/backlog claim; the stale counts) and add an honest note that `detectAll()` runs unnumbered detectors beyond the numbered 20.

## Non-goals

- No `fd-command-rot` detector (verifying FD-documented commands still exist) — split to roadmap entry **Q-0050**.
- No enforcement of detector *counts* (the count fix is a one-time doc correction, not a new gate).
- No rewrite of `script-catalog.md` into a uniform machine-keyed format (rejected — widens the M feature; the src-path join tolerates the existing heterogeneous format).
- Not added to `pnpm verify` / CI — pre-commit only, exactly as `validate skill-catalog` is today.

## Design

### Unit 1 — `flattenManifest()` (new export in [`src/cli/manifest.ts`](../../../src/cli/manifest.ts))

`MANIFEST: Record<string, Group>` where `Group = { desc; subs: Record<string, SubCmd> }` and `SubCmd = { src; desc }`. Leaf convention (manifest.ts:6-8): a group whose `subs` has a single `''` key is itself a leaf (`init`, `doctor`, `next-priority`, …).

```ts
export interface ManifestLeaf { command: string; src: string; desc: string }
export function flattenManifest(): ManifestLeaf[]
```

Walk `Object.entries(MANIFEST)` → `Object.entries(group.subs)`; `command` = `group` when `sub === ''`, else `` `${group} ${sub}` ``; `src` normalized to repo-relative `src/<path>` (manifest stores `src`-relative like `core/validate-skill-catalog.ts` → prefix `src/`). Reuses the `isLeaf` shape already encoded in [`src/garden/detectors/skill-code-drift.ts:129`](../../../src/garden/detectors/skill-code-drift.ts). No existing helper flattens MANIFEST (only `help.ts` iterates two-level); this is the shared enumerator.

### Unit 2 — `src/core/validate-script-catalog.ts` (mirrors validate-skill-catalog.ts)

**Join key = the Source `src/…` path** (D1). Every catalog entry already cites its source (`### `-entry Source bullet, or the table Source column) — a markdown link to `src/…`. The manifest leaf also owns a `src`. Diffing the two src-sets sidesteps the doc's colon-form display names (`validate:features`, `hook:noldor:pre-commit`, `sdd:report`, `toon`) which do **not** map 1:1 to manifest `group sub` (group renames hook→hooks, worktree→worktrees, sdd→garden; concern-names `gaps:links-code`→`features fill-links-code-gaps`). Aliases sharing a src (`autonomous run` + `autonomous queue-drain` → `queue-drain.ts`) collapse in a `Set`, so a single documented Source link covers them all — no alias-allowlist needed.

- `CATALOG_PATH = 'docs/noldor/script-catalog.md'`.
- `manifestSrcSet(): Set<string>` — `new Set(flattenManifest().map(l => l.src))`.
- `parseCatalogSrcs(md: string): Set<string>` — regex-harvest every markdown-link target resolving under `src/`; normalize `../../src/x.ts` and bare `src/x.ts` → `src/x.ts` (D4: harvest all `src/` links, not only Source-labeled — simpler; Source-link convention dominates so the false-negative risk is negligible).
- `diffCatalogSrcs(manifestSrcs, docSrcs): { missingFromCatalog: string[]; extraInCatalog: string[] }` — sorted. `missingFromCatalog` = manifest srcs not cited in the doc (**blocking**). `extraInCatalog` = doc-cited srcs with no manifest leaf (**advisory** — composites like `docs:build`/`test:contract` cite `scripts/`, and helper modules; never block, D3).
- `main()` — `repo = process.cwd()`; read doc; diff. `missingFromCatalog` non-empty → print `✗ Manifest commands missing from script-catalog.md:` + list to stderr, `process.exitCode = 1`. Else print `Validated script-catalog: N leaf command(s), M documented source(s).` + advisory extras (exit 0). Bottom dispatch guard `if (import.meta.url === \`file://${process.argv[1]}\`) void main();` — required by the `src/cli/index.ts` dispatch contract.

### Unit 3 — Registration + pre-commit wiring

- [`src/cli/manifest.ts`](../../../src/cli/manifest.ts) `validate` group: add `'script-catalog': { src: 'core/validate-script-catalog.ts', desc: 'Validate script catalog' }`.
- [`lefthook/noldor.yml`](../../../lefthook/noldor.yml) `validate` group: new job `script-catalog`, `glob: '{src/cli/manifest.ts,docs/noldor/script-catalog.md}'`, `run: pnpm noldor validate script-catalog` — mirrors the `skill-catalog` job at lines 61-63.
- [`templates/lefthook/noldor.yml`](../../../templates/lefthook/noldor.yml): the byte-identical twin edit (`check:template-sync` fails the commit otherwise).

### Unit 4 — One-time doc catch-up (`docs/noldor/script-catalog.md` + twin)

Add Source-linked entries for the **28** absent commands so `missingFromCatalog` is empty. Group them into the existing concern sections (or compact `Command | Source | Purpose` tables, mirroring the Autonomous/Utilities table style) — new/extended sections for: `prep` (fanout/promote/format), `research fanout`, `roadmap remove-block`, `garden demote-stale`, `cr bootstrap`, `triage` (mint-id/backfill-ids/merge-candidates), `features` (migrate-code-tags/propose-pointers/migrate-link-rot/phase-flip-done/phase-revert), `sync code-links`, `release publish`, `graphify enrich-docs`, `dashboard ensure`, `worktrees` (create/up/down), `verify smoke`, `noldor split-check`, `clones`, `wait`, `fmt`, `upgrade`. The 6 alias paths (`autonomous queue-drain`, `triage validate`, `features validate`, `milestones validate`, `checks feature-slug-scope`, `invariants run`) need **no** new line — their srcs are already cited by a documented alias; note the alias in the owning entry's prose (D6). Every edit lands identically in `templates/docs/noldor/script-catalog.md`.

### Unit 5 — Honesty fixes (pure doc edits)

- `docs/noldor/script-catalog.md:10` — replace the "not yet implemented / backlog entry tracks it" disclaimer with: the gate is live, blocking at pre-commit, parallel to `validate:skill-catalog`.
- `docs/noldor/script-catalog.md:172` — `19` → `20` numbered detectors.
- `docs/noldor/lifecycle.md:88` and `docs/noldor/triage.md:121` — `13` → `14` SDD detectors.
- `docs/noldor/garden-and-drift.md` — add one note: `detectAll()` also runs unnumbered detectors beyond the numbered 20 (skill-code-drift, fd-link-rot, code-links-drift, migration-coverage, milestone-shipped-incomplete, bootstrap-override-audit) (D2).

### Unit 6 — Tests (`src/core/__tests__/validate-script-catalog.test.ts`)

Mirror `validate-skill-catalog.test.ts` (pure-fn unit tests, fixtures — no live-tree dependence): `flattenManifest` emits bare group for `''` leaves and `group sub` otherwise; `parseCatalogSrcs` extracts + normalizes `../../src/…` and bare `src/…` from both `###`-Source-bullets and table Source cells; `diffCatalogSrcs` flags a manifest src absent from the doc and does **not** flag an alias whose shared src is documented.

## Acceptance criteria

- `pnpm noldor validate script-catalog` exits **0** on this repo after the Unit-4 catch-up.
- Removing any single documented Source link for a non-aliased command makes it exit **1** and name that command's src on stderr (fixture test).
- `flattenManifest()` returns exactly one entry per manifest leaf; `subs['']` groups appear as the bare group name.
- The `script-catalog` pre-commit job exists in **both** `lefthook/noldor.yml` and `templates/lefthook/noldor.yml`; `pnpm noldor checks template-sync` is green (byte-identical twins).
- `docs/noldor/script-catalog.md` and `templates/docs/noldor/script-catalog.md` are byte-identical after catch-up.
- `docs/noldor/script-catalog.md` no longer claims the gate is unimplemented nor that a backlog entry tracks it; says **20** numbered detectors. `lifecycle.md` + `triage.md` say **14** SDD; `garden-and-drift.md` carries the unnumbered-detectors note.
- `pnpm verify` green (lint + fmt:check + typecheck + test).

## Risks / trade-offs

- **Src-link accuracy is load-bearing.** The gate is only as good as the doc's Source links; a wrong/stale link mis-joins. Mitigation: Source links are already the page's convention — the gate makes them enforced instead of decorative.
- **Harvest-all-`src/`-links can under-report** (a stray `src/` link matching a manifest src hides real drift). Soft failure, rare; accepted over a brittle Source-label-only parser (D4).
- **Aliases documented once** — a reader wanting `autonomous queue-drain` finds it under `autonomous run`. Accepted; prose calls out the alias.
- **Detector-count note is prose, not enforced** — a future detector won't bump the count. That enforcement is Q-0050 territory, out of scope.
- **Pre-commit only, not CI** — inherited from `validate skill-catalog`; a `--no-verify` commit skips it. Consistent with the sibling gate, not a regression.

## User Story

As a Noldor maintainer (human or agent), I want a pre-commit gate that fails when a CLI subcommand exists in the manifest but is undocumented in the script catalog, so that `docs/noldor/script-catalog.md` stays 1:1 with the CLI the same way the skill-catalog gate keeps the skill page honest.

## Usage

- `pnpm noldor validate script-catalog` — check-only. Exit 0 when every manifest leaf's Source `src/…` is cited in `docs/noldor/script-catalog.md`; exit 1 with a stderr list of undocumented commands otherwise.
- Runs automatically at pre-commit when `src/cli/manifest.ts` or `docs/noldor/script-catalog.md` is staged (lefthook `validate` group).
- Fixing drift: add a Source-linked entry for the flagged command to `docs/noldor/script-catalog.md` **and** its twin `templates/docs/noldor/script-catalog.md`, in the same commit.

## Open questions (resolved)

1. *Join key between documented commands and manifest leaves?* → **Source `src/…` path** (operator-ratified). Rationale: the doc's colon-form display names don't map 1:1 to manifest `group sub`; the src path is canonical, already cited, and makes aliases free (D1).
2. *How far to take the detector-count reconciliation?* → **Fix stated counts (19→20, 13→14) + one honest note** for the unnumbered detectors; no renumber (operator-ratified). Rationale: honors "code has more" without widening the M feature (D2).
3. *Block direction?* → **Block on manifest-src-missing-from-doc; doc extras advisory.** Rationale: the gate's purpose is preventing doc rot (a new command left undocumented), not policing doc extras like pnpm composites (D3).
4. *Harvest all `src/` links or only Source-labeled?* → **All `src/` links.** Rationale: simpler parser tolerant of the heterogeneous doc; Source-link convention dominates so the false-negative risk is negligible (D4).
5. *Refactor `skill-code-drift.ts` to share `flattenManifest()`?* → **Defer unless trivial.** Rationale: keep the M scope tight; the existing inverse check works (D5).
6. *Alias commands (shared src)?* → **Documented once via the shared src; note the alias in prose.** Rationale: the src-join makes duplicate doc lines unnecessary (D6).
