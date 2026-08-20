# Root README Content Validator — Design

**Slug:** root-readme-content-validator
**FD:** docs/features/root-readme-content-validator.md
**Date:** 2026-08-20
**Tier:** full
**Deps:** none blocking. Q-0136 (typed advisory/blocking gap channels) is a follow-up, not a prerequisite — see Design § Channel.

## Problem

Root `README.md` is the only doc surface the framework never inspects for content. Four mechanisms touch the file and none read what it says:

- `pnpm noldor docs check` walks `docs/` then appends `README.md` ([`src/docs/docs-check.ts:222`](../../../src/docs/docs-check.ts)), but `checkLinks` only resolves internal links — it never asks whether the prose is true.
- The `bootstrap commands` rule-pair asserts `/pnpm test\b/` appears in the README ([`src/invariants/rule-pairs.ts:62`](../../../src/invariants/rule-pairs.ts)) at `severity: 'warn'`, soft by design because the README is consumer-owned.
- SDD detector 12 `detectReadmePackageDrift` ([`src/garden/sdd-report.ts:490`](../../../src/garden/sdd-report.ts)) keys on a `### Packages` table and `packages/<prefix>-*` directories. This repository has neither, so the detector is dead here.
- Release-sweep step 4 is prose asking an LLM to eyeball the architecture, stack and command sections.

The measured miss: Q-0093 shipped a `docs architecture` subcommand plus a four-page `docs/architecture/` surface with its own validator, garden detector, SDD gap and release probe — and the README's `## CLI reference` and `## Docs` sections both stayed silent. The string "architecture" appears nowhere in `README.md`.

Two facts discovered while grounding reshape the original three-check proposal:

1. **`## CLI reference` declares itself non-exhaustive** — "this is the journey-critical subset, **not exhaustive**" ([`README.md:116`](../../../README.md)). It lists 9 groups against 35 in `MANIFEST`, and the `docs` group is absent entirely. A manifest→README completeness check would demand 35 rows and contradict the section's stated contract.
2. **Exhaustive CLI coverage is already enforced elsewhere.** `validate script-catalog` ([`src/cli/validate-script-catalog.ts`](../../../src/cli/validate-script-catalog.ts)) diffs `flattenManifest()` leaf `src` paths against the source links in `docs/noldor/script-catalog.md` and blocks on `missingFromCatalog`. The exhaustive registry doc exists; the README is legitimately a curated front door.

So the gap is not "the README is not exhaustive". It is that **nothing checks the README's claims resolve**, and **nothing notices a whole doc surface the reader cannot navigate to**.

## Goals

- Every command the README quotes resolves to a real `MANIFEST` entry or a real `package.json` script.
- Every reader-facing doc surface is reachable from the README by following links.
- Findings surface author-side, before a PR is pushed, and never withhold a release.
- Zero new hand-maintained registry: a new doc surface enrols itself.

## Non-goals

- Manifest→README completeness (D1) — `validate script-catalog` owns exhaustive CLI coverage.
- Flag validation: whether `--adopt` / `--dry-run` / `--detach` are accepted by the subcommand they are quoted with (D4). `MANIFEST` carries no flag registry.
- Prose quality, tone, freshness-by-date, or screenshot currency.
- Reviving or repairing `detectReadmePackageDrift`. It is dead in this repo but harmless, and a single-package repo is not the case it was written for.
- Making the finding blocking at release, under any config knob (D6).

## Design

### Unit 1 — surface enumeration (`enumerateDocSurfaces`)

`src/docs/readme-content.ts`. Returns each directory one level under `docs/` that contains at least one `.md` **recursively**, excluding the workflow-artifact roots that `loadDocRoots()` ([`src/core/doc-roots.ts:54`](../../../src/core/doc-roots.ts)) already names — `docs/features` and `docs/design`.

The exclusion set is derived, not listed (D9). `docs/assets` needs no entry: it holds 5 non-markdown files and zero `.md`, so the recursive-`.md` predicate drops it. Measured on this repo the survivors are `adr` (1 md), `architecture` (4), `noldor` (26), `user` (1). A new `docs/<dir>/` surface enrols itself with no code change.

### Unit 2 — reachability walk (`reachableMdFiles`)

Seeded from every internal link in `README.md`, then transitively through each reached `.md`, to a fixpoint. Reuses the exported helpers in [`src/docs/docs-check.ts`](../../../src/docs/docs-check.ts): `stripCodeRegions`, `extractLinks`, `walkMd`.

`stripCodeRegions` is load-bearing rather than incidental. `docs/architecture/` and `docs/adr/` are mentioned in `docs/noldor/{script-catalog,versioning,garden-and-drift}.md` **only inside prose backticks, never as markdown links**. Counting a backticked path as a link would make the check green while the reader still has no route.

Seeding from the whole README rather than the `## Docs` section is deliberate (D2/D3): the README links `adoption-guide.md` from `## Quick start` and `lifecycle.md` from `## Daily workflow`, and a reader who arrives that way has genuinely reached the page.

### Unit 3 — surface verdict (`unreachableSurfaces`)

Pure set operation over Unit 1's surfaces and Unit 2's reached set. A surface is **reached** when at least one `.md` anywhere beneath it is in the reached set (D12). No per-surface `index.md` is required — `docs/adr/` holds numbered records and `docs/user/` holds only `how-to/index.md`, and demanding index pages would turn a validator into a doc-authoring feature.

### Unit 4 — command extraction (`parseReadmeCommands`)

Pure. Harvests command tokens from `README.md` — fenced blocks and inline code both — and normalizes each to either a `pnpm noldor <group> [<sub>]` invocation or a `pnpm <script>` invocation. Flags and trailing arguments are stripped (D4). Package-manager builtins (`add`, `install`, `dlx`, `exec`, `run`) are recognized and dropped.

Measured token set on this repo: 12 `pnpm noldor` forms (`--help`, `init`, `init --adopt`, `doctor`, `dashboard server`, `upgrade`, `upgrade --dry-run`, `validate noldor-config`, `autonomous run|watch|status|inbox`), 3 script forms (`build`, `test`, `typecheck`), 2 builtins (`add -D`, `install`).

### Unit 5 — command resolution (`resolveCommands`)

Pure. Compares Unit 4's tokens against `new Set(flattenManifest().map((l) => l.command))` ([`src/cli/manifest.ts:515`](../../../src/cli/manifest.ts) — `command` is the bare group for a `''`-subcommand leaf, else `<group> <sub>`) and against the key set of root `package.json` `scripts`. One finding per unresolved token, naming the token and the README line.

Direction is README→registry only (D1). A manifest entry with no README mention is not a finding.

`--help` is not a manifest leaf; it is recognized as a CLI-global and dropped alongside the builtins.

### Unit 6 — report (`checkReadme`)

`checkReadme(cwd): Promise<{ status: 'absent' | 'ok' | 'findings'; findings: readonly { message: string }[] }>` — deliberately the shape `docSurfaceRow` already consumes. `absent` when `README.md` does not exist, so a repo without one is skipped rather than failed.

### Unit 7 — CLI shell

`src/checks/check-readme.ts`, on the [`src/checks/check-ui-design-freshness.ts`](../../../src/checks/check-ui-design-freshness.ts) pattern: `runIfDirect`, an exported `main(cwd)` returning an exit code, printing one line per finding. Registered as `checks readme` in `src/cli/manifest.ts`. Exit 1 on findings; callers decide whether that blocks.

### Unit 8 — release preflight row

`docSurfaceRow` ([`src/release/preflight-probes.ts:156`](../../../src/release/preflight-probes.ts)) gains an optional `severity: 'blocking' | 'warn'` parameter defaulting to `'blocking'`, so the existing `architecture` and `adr` rows are unchanged. A new `readme` row calls `checkReadme` at `severity: 'warn'` with an audited `RELEASE_SKIP_README` override. `'readme'` joins the `PreflightRowId` union.

`warn` never aborts a release ([`src/release/preflight-types.ts:8`](../../../src/release/preflight-types.ts)), so `blockingIds()` excludes it by construction.

### Channel

`checks readme` plus the warn preflight row, and **no `GardenFindings` key** (D5). Routing to `sddGaps` would gate the garden receipt and therefore block a release through the four-hop chain Q-0136 exists to make structural. A hand-rolled advisory key on the `architectureAdvisories` precedent ([`src/garden/garden-detect.ts:596`](../../../src/garden/garden-detect.ts)) would avoid blocking but has no consumer beyond the JSON dump. Declining both is what lets this ship without waiting on Q-0136 — the follow-up remains worth doing, but this feature no longer needs it.

### Wiring

A `readme` job on `pre-push`, beside `template-sync` and `clones check` — the existing home for unglobbed whole-repo structural checks (D7). Once per push rather than per commit; a `docs/**/*.md` pre-commit glob would fire on nearly every commit. `/noldor-gate` Step 4's preflight bullet already replays the pre-push chain author-side, so a finding lands **before** the review receipt is earned rather than invalidating it.

`README.md` sits outside `RELEASE_SWEEP_GLOBS` ([`src/core/allowlist.ts:20`](../../../src/core/allowlist.ts)) and stays there — the sweep must not rewrite it. It is in `MICRO_CHORE_GLOBS` via root-level `*.md`, and feature paths carry no allowlist branch, so a finding is fixable in the same PR that caused it.

### Twins and registries this touches

- `lefthook/noldor.yml` + `templates/lefthook/noldor.yml` — the new pre-push job, mirrored.
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — a source link for `src/checks/check-readme.ts`, or `validate script-catalog` blocks on `missingFromCatalog`.
- `README.md` — three links added under `## Docs` so `docs/adr/`, `docs/architecture/` and `docs/user/` become reachable (D10). The check ships green and the feature dogfoods itself.

## Acceptance criteria

1. `pnpm noldor checks readme` exits 0 on this repository once the three `## Docs` links are added.
2. Deleting the `## Docs` link that reaches `docs/architecture/` makes the command exit 1 with a finding naming `docs/architecture`.
3. Renaming a `MANIFEST` group the README quotes (e.g. `upgrade`) makes the command exit 1 with a finding naming the unresolved token.
4. Adding a new subcommand to an existing `MANIFEST` group without touching the README leaves the command at exit 0.
5. A new `docs/<newdir>/page.md` with no link reaching it makes the command exit 1 naming `docs/<newdir>`.
6. `docs/assets` (zero `.md`), `docs/features` and `docs/design` are never reported as unreachable surfaces.
7. A path mentioned only inside prose backticks does not count as reaching its surface; the same path as a markdown link does.
8. A `pnpm <script>` token absent from root `package.json` `scripts` is reported; `add`, `install`, `dlx`, `exec`, `run` and `pnpm noldor --help` never are.
9. A surface is satisfied by a reached `.md` at any depth beneath it, with no `index.md` present.
10. Release preflight renders a `readme` row; when findings exist its status is `warn` and `blockingIds()` does not include it.
11. `RELEASE_SKIP_README=1` renders the row as `skipped` carrying the override name; a repo with no `README.md` renders it `skipped` and the CLI exits 0.
12. The `pre-push` `readme` job is present in `lefthook/noldor.yml` and byte-identical in `templates/lefthook/noldor.yml`, and `pnpm noldor validate script-catalog` passes with the new entrypoint documented.

## Risks / trade-offs

- **Walk cost on every push.** Unit 2 walks `docs/` (≈260 `.md` here) and reads each reached file. Bounded by the reachable set, not the whole tree, and comparable to `docs check`, which already reads every one. If it proves slow, the remedy is caching by tree sha, not narrowing the check.
- **A consumer with a private docs directory reds on first run.** Accepted rather than configured (D9): an unlinked `docs/<dir>/` is a genuine discoverability gap, and the fix is one link. A knob here would be the first crack in the derived-exclusion design.
- **The CLI half of the roadmap's deletion test no longer fires (D8).** Adding an undocumented subcommand reds `validate script-catalog` instead. Two checks own one concern between them; neither owns it alone.
- **Reachability is link-shaped, not comprehension-shaped.** A README can link every surface and still describe them wrongly. This check raises the floor from "unnavigable" to "navigable"; it does not verify the prose is accurate.
- **`docs/user/` is a projection target.** `docProjectionRoots()` treats `docs/user/{tutorials,explanation,how-to}` as generated. Including it means a generated surface must be linked by hand. Judged correct: generated or not, a reader needs a route to it.

## User Story

As a framework maintainer, I want the README's commands and doc-surface links checked against the real manifest and the real `docs/` tree before I push, so that a capability I add cannot drift out of the front door silently.

## Usage

```bash
pnpm noldor checks readme        # exit 0 clean, 1 with findings, one line per finding
```

Runs automatically as a `pre-push` job. Findings are fixable in the same PR — edit `README.md` and push again.

At release, `pnpm release --preflight` renders a `readme` row. It is advisory: a finding shows as `warn` and never aborts. `RELEASE_SKIP_README=1` skips the row and records the override.

## Open questions (resolved)

1. *Should the CLI-reference check demand that every `MANIFEST` group appear in the README?*
   → **No — reverse direction only (D1).** `README.md:116` declares the section a non-exhaustive journey-critical subset, and `validate script-catalog` already enforces exhaustive coverage against `docs/noldor/script-catalog.md`.

2. *Is the doc-surface set a registry or derived?*
   → **Derived (D2, D9).** Any `docs/<dir>/` with a `.md`, minus the `loadDocRoots()` artifact roots. A registry would be the hand-maintained parallel list Q-0093 warned about.

3. *Direct link from `## Docs`, or a transitive walk?*
   → **Transitive, seeded from the whole README (D2).** It respects the `docs/noldor/README.md` hub the README explicitly designates, and still has teeth: three surfaces are unreachable today.

4. *Do checks #1 and #3 stay separate?*
   → **They merge (D3).** 12 of the 16 quoted commands are `pnpm noldor` forms resolving through `MANIFEST`, so the two checks were the same check. Three checks become two.

5. *Which channel carries findings?*
   → **`checks` CLI + warn preflight row, no garden key (D5).** Non-blocking at release by construction, and it removes the Q-0136 dependency instead of working around it.

6. *Where does it run at change time?*
   → **`pre-push` (D7).** Same class as `template-sync` and `clones check`; the gate's Step 4 preflight already replays that chain author-side, so a finding costs one commit rather than a review-receipt re-earn.

7. *Does the first run ship red?*
   → **No — this PR adds the three missing links (D10).** A pre-push job that blocks every push until a later micro-chore is not shippable.

8. *Where do the units live?*
   → **Pure evaluator in `src/docs/readme-content.ts`, thin shell in `src/checks/check-readme.ts` (D11).** Mirrors `docs-architecture.ts` / `docs-adr.ts`, which the preflight probe already imports from.

9. *What counts as reaching a surface?*
   → **Any `.md` beneath it, recursively (D12).** Requiring a per-surface index would mean authoring two new index pages inside a validator feature.
