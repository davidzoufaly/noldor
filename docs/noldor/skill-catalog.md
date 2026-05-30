---
noldor-page: skill-catalog
introduced: 0.4.0
---

# Skill Catalog

Noldor ships 9 user-invocable skills, each owned by a single concern. This page is the canonical reference — run any skill via its slash command in Claude Code. Skill source lives in `.claude/skills/`.

> **Strict drift gate.** `pnpm noldor validate skill-catalog` (pre-commit, see [`garden-and-drift.md`](garden-and-drift.md) Detector 16) asserts that every `## /<slug>` heading on this page maps to a `<slug>.md` (or `<slug>/SKILL.md`) under `.claude/skills/`, and vice versa. Add or rename a skill → update this page in the same commit, or pre-commit blocks.

## /promote

- **Trigger:** `/promote <slug>`. Manual at work-start.
- **Inputs:** kebab-case slug matching a `### <heading>` block in `docs/roadmap.md` (preferred) or `docs/backlog.md`.
- **Outputs:** scaffolded `docs/features/<slug>.md` with `phase: in-progress`; residue check runs before source-block deletion (scans body for sub-items beyond the FD scope — alt implementation paths, scope-named bullets, nested sub-headings — operator disposes per-item via fold-into-FD / write-back-as-sibling / drop); source block removed. No roadmap-side tracker is added — the FD's `phase: in-progress` frontmatter is the canonical in-progress signal. In attach-to-parent mode (source block carries `parent: <fd-slug>` or LLM finds a strong semantic match): no new FD scaffolded; residue check still runs before source-block deletion.
- **When to use:** any non-trivial implementation already in `docs/roadmap.md` or `docs/backlog.md`. See [`complexity-gating.md`](complexity-gating.md) for which work qualifies. Always after brainstorming for the `brainstorm-first` tier. For features not present in either source, use `/new-feature` instead.

## /triage

- **Trigger:** `/triage`. Bulk operation, run when `ideas.md` accumulates new bullets.
- **Inputs:** untagged top-level bullets in `ideas.md`; `docs/vision.md` for strategic rubric; existing schema-C blocks in `docs/roadmap.md` + `docs/backlog.md` for merge-candidate matching.
- **Outputs:** schema-C blocks inserted into `docs/roadmap.md` (flat priority list — position chosen via `top` / `after:<slug>` / `bottom`) or appended to `docs/backlog.md`; sub-bullets appended to host blocks for `merge:<slug>` proposals; `[triaged YYYY-MM-DD → <slug>]` markers appended to source bullets in `ideas.md`. Never commits.
- **When to use:** when raw ideas have piled up and you want to advance them onto the engineering queue. Bias toward `merge` when an existing block plausibly covers the idea. Promotion of a roadmap entry to a feature MD is `/promote`'s territory, not `/triage`'s.

## /garden

- **Trigger:** `/garden`. Run when the doc framework feels drifty or before a release.
- **Inputs:** JSON output from `pnpm noldor garden detect` (stale plans, unused backlog entries, rule contradictions, SDD gaps, architecture invariant violations); doc-pair excerpts for LLM-filtered contradiction triage.
- **Outputs:** operator-confirmed checklist; on confirm, archives stale plans (`git mv` to `docs/superpowers/plans/archive/`), drops unused backlog blocks, runs the regen chain (`sync:test-links && sync:doc-links && sync:fd-resources && validate:features`). Rule contradictions and SDD gaps stay as Manual TODOs. Never commits.
- **When to use:** periodic doc maintenance, especially before a release. Includes a manual plan sweep for multi-feature/infra plans the deterministic detector can't slug-match. Surfaces a code-link backfill prompt for `pnpm noldor features fill-links-code-gaps` after the regen chain.

## /draft-feature-md

- **Trigger:** `/draft-feature-md <slug> [--from-spec | --refresh]`. `--from-spec` is the default.
- **Inputs:** kebab-case slug; `docs/features/<slug>.md`; the latest matching spec at `docs/superpowers/specs/*-<slug>-design.md` (`--from-spec` mode); plus `links.code` + `links.tests` files (`--refresh` mode).
- **Outputs:** drafted `## User Story` + `## Usage` sections presented inline as fenced markdown blocks for inline confirmation/edit. On approval, applies via Edit tool. Never modifies Summary or frontmatter. Never stages or commits.
- **When to use:** `--from-spec` after a spec is approved (before invoking `superpowers:writing-plans`) to fill the feature MD's `<!-- TODO -->` stubs while the spec is fresh. `--refresh` before flipping `phase: in-progress → done` in the shipping commit, so User Story / Usage reflect what actually shipped (reality wins over spec claims).

## /gate

- **Trigger:** `/gate`. Mandatory before any code edit.
- **Inputs:** interactive path selection (one of 6 paths: `micro-chore`, `fast-track`, `specs-only-new`, `specs-only-attach`, `full-new`, `full-attach`); optional `--resume <slug>` to re-establish session for an existing in-progress FD.
- **Outputs:** session marker written to `.noldor/session.json`; path-appropriate artifact scaffold (FD, worktree, brainstorm, spec, plan); end-of-flow review wiring. See [`complexity-gating.md`](complexity-gating.md) for the 6-path model.
- **When to use:** single mandatory entry for all change types. Run before any Edit/Write to tracked files. Pre-edit guard enforces this via Claude PreToolUse hook.

## /milestone

- **Trigger:** `/milestone <sub-command> [args]`. Sub-commands: `draft`, `activate`, `edit`, `list`.
- **Inputs:** sub-command name; `slug` (kebab-case codename) for `activate` + `edit`, optional for `draft` (skill proposes one when omitted); optional `description` one-liner for `draft`.
- **Outputs:** `draft` scaffolds `docs/milestones/<slug>.md` with `status: draft` + body stubs. `activate` flips previous active to `shipped`, target to `active`, and updates `docs/vision.md` `current-milestone:`; preflights all state before any write so partial failures leave the filesystem unchanged. `edit` opens the file for body edits (never mutates `name` / `status`). `list` prints all milestones grouped by status. Never commits.
- **When to use:** managing strategic gates decoupled from semver. Milestones are optional; framework validates green without any active milestone. Use `draft` when starting to scope a new gate, `activate` once the definition is locked, `edit` for iterative refinement of gate/success-criteria/out-of-scope, `list` for inspection. Backed by `tsx scripts/milestones/cli.ts`.

## /new-feature

- **Trigger:** `/new-feature`. Manual at work-start when the feature is not in roadmap or backlog.
- **Inputs:** `slug` (kebab-case), `name` (human-readable), `area`, `category` (Modeling | Editor | Agents | Distribution | Docs | Tooling | Other), `packages` (array, non-empty), `deps` (optional).
- **Outputs:** `docs/features/<slug>.md` scaffolded with `phase: in-progress` and `<!-- TODO -->` body stubs; `pnpm noldor validate features` run to confirm schema. Never commits.
- **When to use:** starting work on a feature that is not in `docs/roadmap.md` or `docs/backlog.md` — urgent work, matured spike, or bug-fix-became-feature. For promoting a backlog/roadmap entry, use `/promote` instead.

## /refactor

- **Trigger:** `/refactor`, or natural-language cues ("clean up", "restructure", "simplify module", "extract function", "rename across codebase", "reduce complexity", "split this file"). Also fires when the user identifies code smells without saying "refactor".
- **Inputs:** the refactoring target (files, functions, types); `graphify-out/GRAPH_REPORT.md` + `graphify-out/graph.json` for community structure / god-node baselines; pre-refactor `pnpm typecheck` + `pnpm test` snapshot.
- **Outputs:** structured Refactoring Report covering Summary, Changed Files (with diffs + per-file rationale), Verification table, Import Impact, Breaking Changes, Dead Code, Complexity Delta, Suggested Commit, and a Graph Impact section comparing god-node degree / community cohesion / cross-package bridges before vs. after.
- **When to use:** any structured refactor where traceability matters. Mandatory as part of the release sweep — `/refactor` runs against the freshly-generated `GRAPH_REPORT.md` to fix god nodes, low-cohesion communities, and dead exports before tagging. Skip Phase 6 (graph impact) for rename-only or comment-only refactors.

## /release-sweep

- **Trigger:** `/release-sweep`. Run when the user signals they're ready to release.
- **Inputs:** must start on `main` with a clean tree and a passing `pnpm verify`. Sweep stages call `/graphify`, `pnpm toon`, and `/refactor` in turn.
- **Outputs:** fresh `graphify-out/` (graph.json, GRAPH_REPORT.md, toon files) twice — pre-refactor and post-refactor; possible README drift edits; a single `chore(release): pre-release graphify + refactor sweep` commit; final `pnpm verify` pass. Stops at an explicit `release now` confirmation gate before invoking `pnpm release`.
- **When to use:** the moment between "feature merged to main" and "tag the release". Never runs `pnpm release` without the explicit confirmation. Don't use mid-feature, for routine graph rebuilds, or for one-line hotfixes where structural drift is impossible.
