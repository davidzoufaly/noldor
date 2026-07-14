# README Rewrite — Consumer-Journey Order — Design

**Slug:** readme-rewrite-consumer-journey-order
**FD:** docs/features/readme-rewrite-consumer-journey-order.md
**Date:** 2026-07-14
**Tier:** specs-only
**Deps:** none

## Problem

The top-level [`README.md`](../../../README.md) (68 lines) is not factually *wrong* after PR #126 (version now deferred to `package.json`, README.md:7), but it under-serves the reader it should serve first — a new consumer adopting Noldor into their repo:

1. **Structure is inverted for the audience.** Order is `Status → Quick start → Configuration → Development → CLI`. A repo-history "Status" blurb leads; the contributor-only `file:../noldor` "Development" setup sits above the CLI. A consumer wants: what is it → install → initialize → configure → daily workflow → upgrade.
2. **CLI section shows 5 of 32 command groups.** README.md:59-63 lists `doctor`, `dashboard server`, `invariants run`, `garden detect`, `validate features`. The manifest ([`src/cli/manifest.ts`](../../../src/cli/manifest.ts)) defines 32 top-level groups. The section reads like the full surface but silently omits the whole consumer-facing spine: `init`, `upgrade`, `autonomous`, `cr`, `pr-flow`, `worktrees`, `prep`, `research`, `metrics`, and more.
3. **`init --adopt` / `--update` / `--agents` are invisible.** Quick start (README.md:22) shows bare `pnpm noldor init` only. The real flags live in [`src/cli/commands/init.ts`](../../../src/cli/commands/init.ts) (`--update` re-pull templates, `--adopt` reverse-bootstrap an existing repo, `--agents claude,codex,opencode` shim selection). `init --adopt` (PR #163) is *the* existing-repo adoption path and gets no mention.
4. **No link to the adoption guide.** [`docs/noldor/adoption-guide.md`](../../../docs/noldor/adoption-guide.md) is a full 105-line onboarding doc (prerequisites floor table, monorepo `-Dw` gotcha, CI `NPM_TOKEN` 401 trap, first-commit hook gotchas, full `consumer:` field table). The README never links it. Its only doc link is `cr-pipeline.md` (README.md:35).
5. **No gate / drain / upgrade / dashboard sections.** The gate is "the single mandatory entry for any code change" yet the word "gate" never appears. Drain, `noldor upgrade`, and the dashboard get at most a parenthetical clause in the Status prose.
6. **Configuration section enumerates a drifting field set.** README.md:28 lists nine `consumer:` fields; the schema ([`src/core/consumer-config.ts`](../../../src/core/consumer-config.ts)) has more (`name`, `scanPaths`, `categories`, `areaCategories`, `scopeAliases`, `verifyCommands`, `dev`). README.md:32-33 names only two optional blocks (`crLanes`, `autonomous`); the full config schema ([`src/core/config.ts`](../../../src/core/config.ts)) has `agents`, `gate`, `cr`, `release`, `garden`, `watch`, `clones` too. Any hand-maintained field list drifts silently.

**Adjacent drift (same pass):** the docs index [`docs/noldor/README.md`](../../../docs/noldor/README.md) still labels `adoption-guide.md` a "stub — framework still WIP" (index lines 26 and 49) — it is fully written (105 lines, live consumers) — and its Pages section + When-to-read table omit four pages that exist on disk: `agent-runtimes.md`, `autonomy.md`, `drain-mode.md`, `metrics.md`.

## Goals

- Rewrite `README.md` in consumer-journey order so a new adopter reads install → init → configure → daily workflow → upgrade top-to-bottom.
- Surface the previously-invisible consumer spine: `init --adopt`/`--update`/`--agents`, the gate workflow, autonomous drain, `noldor upgrade`, and the dashboard.
- Replace enumerated field lists with a link to the adoption-guide table + a pointer to `noldor validate noldor-config`, so the README stops drifting against the schema.
- Curate the CLI section to a small journey-relevant subset and point at `noldor --help` (the manifest's own full render) + `script-catalog.md` as the exhaustive surfaces.
- Fix `docs/noldor/README.md`: drop the stale "stub — WIP" label on `adoption-guide.md` and add the four missing pages to both the When-to-read table and the Pages list.

## Non-goals

- **No behavior changes.** This is a documentation-only pass — no code, CLI, or config edits. `init.ts`, `manifest.ts`, `consumer-config.ts` are *referenced*, not modified.
- **No new adoption content.** The README links `adoption-guide.md`; it does not duplicate or expand it. Fixing the guide's own content is out of scope (only its index label changes here).
- **No automated README ↔ manifest coverage sentinel.** Findings item #10 (a `garden detect` or `doctor` check that README coverage doesn't drift) is a real follow-up but is deferred — see Open questions (D3).
- **No changes to any other `docs/noldor/*` page body** beyond the index (`README.md`) label + missing-page additions.

## Design

Two units, both documentation edits. No shared code. Each is independently verifiable by reading the rendered file.

### Unit A — `README.md` full rewrite (consumer-journey order)

Replace the current six-section body with the following top-level section order. Content sourced from the audited research outline ([`.noldor/research/2026-07-13-184850/readme-quality.findings.md`](../../../.noldor/research/2026-07-13-184850/readme-quality.findings.md)) and verified against live source:

1. **Pitch (H1 + 1 paragraph).** One-paragraph "discipline framework for agent-driven dev — single gate, doc-anchored changes, autonomous drain." Fold the load-bearing facts from the current standalone `## Status` into this paragraph: pre-1.0 (version in `package.json`, printed by `noldor --version`), self-hosting, **private GitHub Packages** distribution (`@davidzoufaly/noldor`, closed-source by design — the tarball ships readable `src/`). Drop the Charuy-lift repo-history sentence (belongs to `git log`, not the README). Remove the standalone `## Status` section.
2. **`## Prerequisites`.** 3 lines naming the floor (Node ≥20, pnpm ≥9, git, gh, lefthook, an agent runner) + a link to the adoption-guide floor table + "`pnpm noldor doctor` verifies."
3. **`## Install`.** Keep the existing `.npmrc` + `NPM_TOKEN` block verbatim (README.md:11-24 — still correct). Add a one-line monorepo `pnpm add -Dw` note (bare `-D` fails `ERR_PNPM_ADDING_TO_ROOT`) and a one-line CI-auth callout (the ps-offsite `NPM_TOKEN` 401 trap), each pointing at the adoption guide for detail.
4. **`## Initialize`.** `pnpm noldor init` (new repo — scaffolds `docs/noldor`, hooks, `.noldor/config.json`, arms the gate rollout marker) and `pnpm noldor init --adopt` (existing repo, reverse-bootstrap). Note `--update` (re-pull templates) and `--agents claude,codex,opencode` (driver shims). Flags sourced from `src/cli/commands/init.ts`.
5. **`## Configure`.** Point at the adoption-guide `consumer:` field table + `pnpm noldor validate noldor-config`. State that optional blocks (`crLanes`, `autonomous`, `agents`, `gate`, `cr`, `release`, `garden`, `watch`, `clones`) all default sanely and link `cr-pipeline.md` for the autonomous-review reference. **Do not enumerate individual fields** — this is the anti-drift change.
6. **`## Daily workflow`.** `/noldor-gate` is the mandatory entry; one-line description of the 6-path model; hooks enforce; `pr-flow` ships. Link `lifecycle.md`, `complexity-gating.md`, `workflow.md`.
7. **`## Dashboard`.** `pnpm noldor dashboard server --port 4321 --docs ./docs` (flags per [`src/dashboard/server.ts`](../../../src/dashboard/server.ts)); one line on what the pages show.
8. **`## Autonomous drain`.** `autonomous run` / `watch --detach` / `status` / `inbox`. Link `drain-mode.md` and `autonomy.md`.
9. **`## Upgrading`.** `noldor doctor` skew warning → `upgrade --dry-run` → `upgrade`. Link `versioning.md`.
10. **`## CLI reference`.** State `noldor --help` prints the full manifest. Show a short table of ~8 journey-critical groups (`init`, `doctor`, `dashboard`, `autonomous`, `upgrade`, `cr`, `pr-flow`, `worktrees`) with an explicit "not exhaustive" note + link to `script-catalog.md`. **Stop listing commands as if complete.**
11. **`## Docs`.** Link the `docs/noldor/README.md` index (fixed in Unit B).
12. **`## Contributing`.** The current `## Development` content (`file:../noldor` sibling setup, `pnpm install/build/test/typecheck`), **moved to the bottom** — contributor concern, not consumer.
13. **`## License`.** MIT (unchanged).

### Unit B — `docs/noldor/README.md` index fix

- **Stub-label removal.** Index line 26 (When-to-read table, "Bootstrapping Noldor in another repo" row): drop `(stub — framework still WIP)`. Index line 49 (Pages list): replace `stub; framework is WIP, standalone-package lift tracked in backlog` with an accurate one-line description of the guide's contents.
- **Add 4 missing pages** to the Pages list (and, where a natural reader-intent row exists, the When-to-read table): `agent-runtimes.md` (multi-runner registry: claude/codex/opencode), `autonomy.md` (autonomous-mode rules + safety rails), `drain-mode.md` (runner-neutral drain contract), `metrics.md` (metrics CLI + `/metrics` dashboard page). Match the existing one-line-per-page style.

## Acceptance criteria

- `README.md` top-level sections appear in this order: pitch (no standalone `## Status`), `## Prerequisites`, `## Install`, `## Initialize`, `## Configure`, `## Daily workflow`, `## Dashboard`, `## Autonomous drain`, `## Upgrading`, `## CLI reference`, `## Docs`, `## Contributing`, `## License`.
- `README.md` contains a link to `docs/noldor/adoption-guide.md` and to the `docs/noldor/README.md` index.
- `README.md` documents `init --adopt`, `init --update`, and `init --agents`.
- `README.md` names `/noldor-gate`, autonomous drain (`autonomous run`/`watch`), `noldor upgrade`, and the dashboard, each with at least one working doc link.
- `README.md` Configure section links the adoption-guide field table + `noldor validate noldor-config` and does **not** enumerate individual `consumer:` fields.
- `README.md` CLI reference points at `noldor --help` and `script-catalog.md` and is explicitly marked non-exhaustive.
- `README.md` `.npmrc` + `NPM_TOKEN` install block is preserved (present and unchanged in substance).
- `docs/noldor/README.md` no longer contains the string "stub" on the `adoption-guide.md` rows (lines ~26 and ~49).
- `docs/noldor/README.md` Pages list includes `agent-runtimes.md`, `autonomy.md`, `drain-mode.md`, and `metrics.md`.
- Every relative link added in both files resolves to a real file on disk (no broken links).
- `pnpm noldor validate features` passes (the new FD is not corrupted by this pass).

## Risks / trade-offs

- **Curated CLI list can itself go stale.** Showing ~8 groups risks the same drift the current 5-group list has. Mitigation: the section is explicitly non-exhaustive and defers the authoritative surface to `noldor --help` (rendered from the manifest) and `script-catalog.md`. The curated set is chosen to be journey-stable (install/init/upgrade/gate/review/ship), not a moving frontier. A mechanical coverage sentinel is the durable fix but is deferred (D3).
- **Adoption facts split between README and guide.** Folding install gotchas into one-liners with "see the adoption guide" risks a reader missing detail. Accepted: the README's job is to route, not to duplicate; the guide remains the single source for the full floor table and traps.
- **Dropping the Charuy-lift history.** Minor loss of provenance in the README; recoverable from `git log` and the `noldor-package-lift` FD. Accepted per the findings.

## User Story

As a developer or agent evaluating or adopting Noldor into a repo, I want the README to walk me through install → init → configure → daily gate workflow → upgrade in that order and point me at the adoption guide and per-topic docs, so that I can go from "never heard of it" to a working gated repo without reverse-engineering the CLI surface or discovering `init --adopt` by accident.

## Usage

Read `README.md` top-to-bottom. A new consumer follows: Prerequisites (`pnpm noldor doctor` to verify) → Install (`.npmrc` + `pnpm add -D @davidzoufaly/noldor`) → Initialize (`pnpm noldor init`, or `init --adopt` for an existing repo) → Configure (`.noldor/config.json`, validated by `pnpm noldor validate noldor-config`) → Daily workflow (`/noldor-gate`) → Upgrading (`noldor upgrade`). Deep dives are one click away via the linked `docs/noldor/*` pages and the fixed `docs/noldor/README.md` index.

## Open questions (resolved)

1. *Rewrite aggressiveness — full journey reorder vs additive?* -> **Full journey rewrite**, standalone `## Status` folded into the pitch (D1). Ratified by the operator at the gate path picker; the additive option leaves the contributor-first ordering the findings flagged as inverted for consumers.
2. *CLI section — full 32-group table vs curated subset?* -> **Curated ~8-group subset + `noldor --help` + `script-catalog.md` link** (D2). A full table duplicates the manifest and drifts; `--help` already renders the authoritative surface from `src/cli/help.ts`.
3. *Add a mechanical README ↔ manifest coverage check (findings #10)?* -> **Defer to a separate roadmap entry** (D3). It is a `garden`/`doctor` code change, out of scope for a docs-only pass; folding it in would break the specs-only tier and single-FD scope. Note it in the FD Changelog as a spun-off follow-up.
4. *Exact `consumer:` optional-block set to name in Configure?* -> **Name the blocks, enumerate no fields** (D4). Listing block *names* (`crLanes`, `autonomous`, `agents`, `gate`, `cr`, `release`, `garden`, `watch`, `clones`, per `src/core/config.ts`) is low-drift and useful for orientation; listing their *fields* is the high-drift part the rewrite removes.
