# Agent Rules

Project rules for agents working in this repo go in this file, outside the Noldor
block below. `noldor init --update` rewrites that block and nothing else.

<!-- noldor:rules:start -->

## Noldor

This repo runs the Noldor discipline framework. Claude Code, Codex and opencode all
read this file; it is the framework's one rules file. The block between the
`noldor:rules` markers is kept current by `noldor init --update` — do not edit it by
hand.

- `docs/noldor/README.md` is the route table: every workflow has a page, so open the
  matching one before any change.
- On a repo that targets Claude Code, the engineering baseline is
  `.claude/engineering-rules.md`.

## Hard rules

- Every code change enters through the gate: run `pnpm noldor next-priority`
  to pick work; follow `docs/noldor/workflow.md` for the path (micro-chore /
  fast-track / specs-only / full). In Claude Code the `/noldor-gate` skill runs
  it. Bypass with a `Noldor-Path-Override: <reason>` trailer only when a hook
  genuinely cannot run.
- Never edit `docs/roadmap.md`, `docs/backlog.md`, or `docs/release-notes.md`
  outside triage/promote flows — they are queue state, not docs.
- Commits carry `Noldor-FD: <slug>` (and `Noldor-Path:` when a session is
  active); lefthook injects/validates trailers — do not bypass hooks.
- Specs live at `docs/design/specs/`, plans at `docs/design/plans/`;
  formats: `pnpm noldor prep format spec|plan`.
- Feature docs (`docs/features/<slug>.md`) are the single source of truth —
  update User Story / Usage before flipping `phase: done`.
- On any weird or opaque failure (commit rejected with no clear message, gate
  abort, tool exit that makes no sense), grep `docs/noldor/gotchas.md` and the
  area runbook BEFORE debugging from scratch — known traps are documented there.

## Command catalog

`pnpm noldor <group> <cmd>` — discover with `pnpm noldor --help`. Key entries:
`next-priority`, `validate features`, `cr orchestrate|aggregate|escalate`,
`prep fanout|promote|format`, `autonomous run|status`, `worktrees create`,
`init`, `doctor`. Full catalog: `docs/noldor/script-catalog.md`. Agent-runtime
matrix: `docs/noldor/agent-runtimes.md`.

<!-- noldor:capabilities:start -->

## Capability index

Every `pnpm noldor` verb group and its subcommands, generated from the CLI manifest
(`pnpm noldor docs capability-index --write`; do not edit by hand). Check here before
building something by hand — the framework may already ship it. Per-command inputs,
outputs and exit codes: `docs/noldor/script-catalog.md`.

- `autonomous` — Autonomous runners (queue-drain / plan-runner): run, queue-drain, watch, inbox, unpark, branch-state, status
- `prep` — Parallel prep: fan out spec/plan drafts, then promote approved ones to FDs: fanout, promote, format
- `design` — Running design context for a spec/plan dialogue (ledger + inline block): archive, ui-sync, capture, pen-bridge, arch-route, arch-progress, open, verdict, context, graph-context, log, support-check, geometry-diff, geometry-validate
- `research` — Parallel read-only research agents (fanout + opt-in synthesis): fanout
- `garden` — Garden drift detection + SDD report + receipts: detect, receipt, sdd-report, demote-stale
- `metrics` — Effectiveness metrics derived from repo history: compute
- `cr` — Code-review orchestration (subagent / codex / standalone lanes): orchestrate, aggregate, codex, escalate, autofix, bootstrap, arbitration
- `triage` — Triage + score backlog entries: score, list-untriaged, validate, mint-id, backfill-ids, merge-candidates
- `rules` — Engineering rule store: resolve / list / validate: resolve, brief, list, validate
- `features` — Feature MD validators + migrations: validate, attach-milestone, fill-links-code-gaps, migrate-features, migrate-code-tags, propose-pointers, seed-test-tags, migrate-fd-commits-to-prs, migrate-link-rot, phase-flip-done, phase-revert
- `roadmap` — Roadmap/backlog block operations: remove-block, has-block
- `milestones` — Milestone validators: validate, show
- `sync` — Sync links across docs/tests/FDs: test-links, doc-links, code-links, spec-links, fd-resources
- `validate` — Validators (noldor config + skill catalog + scope): noldor, noldor-config, noldor-scope, skill-catalog, script-catalog, features, milestones, triage, feature-slug-scope
- `release` — Release pipeline: run, publish
- `hooks` — Lefthook entrypoints (pre-commit / commit-msg / pre-push): pre-commit, inject-trailers, validate-trailer, enforce-review-receipt, enforce-arbitration, pre-push, pre-edit-guard, open-artifact
- `checks` — Invariant + shared-file checks: invariants, shared-files, feature-slug-scope, template-sync, ui-design-freshness, arch-baseline, push-gates, readme, skill-portability, pen-bridge
- `graphify` — Graphify runner + helpers: build, graph-to-toon, enrich-docs, refactor-precondition
- `dashboard` — Dev dashboard: server, ensure, status
- `docs` — Docs builders + checks: api, howto, check, transclude, adr, architecture, capability-index
- `worktrees` — Worktree create + status + launch: create, status, conflicts, launch, up, down
- `verify` — Acceptance verification (smoke floor): smoke
- `invariants` — Same as `checks invariants`; alias kept for the spec cheatsheet: run
- `noldor` — Noldor utilities (changelog, session marker, etc.): changelog, bump-session-marker, set-autonomous, lint-plan-snippets, split-check, rename-plan-only-tier
- `next-priority` — Next-priority pickup
- `pr-flow` — PR flow (push + create + auto-merge + poll)
- `clones` — Token-based code-clone detection (Type-1/2/3)
- `indirection` — Transitive-import-closure indirection ratchet
- `wait` — Poll a state file until a predicate matches
- `changelog` — Generate changelog (hoisted)
- `fmt` — Run oxfmt with the all-ignored no-op guard
- `adr` — Decision records (docs/adr/): new
- `commit` — Run git commit and print a pipe-proof verdict (real exit code + post-commit status)
- `init` — Scaffold framework files into the consumer repo
- `doctor` — Diff consumer files against pkg templates (non-zero exit on drift)
- `upgrade` — Run version-aware migration chain (anchored → installed framework version)

<!-- noldor:capabilities:end -->

## Skills

Claude Code runs the framework's interactive flows as skills in `.claude/skills/`
(`/noldor-gate`, `/noldor-spec`, …). Codex and opencode invoke the matching
`pnpm noldor` verb + the named doc; opencode users also have thin
`.opencode/command/<name>` shims (codex reads this prose instead):

- **gate** — `docs/noldor/workflow.md`; start every change here. Surface an artifact path
  via the link rule below.
- **spec** — `pnpm noldor prep format spec`; `docs/noldor/workflow.md`. After writing the
  spec, run `pnpm noldor design open <path>` and report its `link:` line.
- **plan** — `pnpm noldor prep format plan`. Same: `design open` after writing, report the
  `link:` line.
- **triage** — `pnpm noldor triage merge-candidates`; `docs/noldor/triage.md`.
- **promote / new-feature** — `docs/noldor/feature-md-schema.md`.
- **draft-feature-md** — draft User Story / Usage from spec/code (before `phase: done`).
- **milestone** — `pnpm noldor milestone`; `docs/noldor/milestones.md`.
- **garden** — `pnpm noldor garden-detect`; `docs/noldor/garden-and-drift.md`.
- **research** — `pnpm noldor research fanout`; `docs/noldor/research-fanout.md`.

**Reporting a spec/plan path — never build the link yourself.** Run
`pnpm noldor design open <artifact-path>`: it prints both the raw path and a ready-made
`link:` line. Report that line verbatim. It opens a tab only when the repo sets
`design.autoOpen: true`, or when you pass `--open` — off by default, because a launch can
raise a different editor window and interrupt the operator. A markdown link
resolves against the **editor's workspace folder**, while an artifact's repo-relative path
is relative to the **session's checkout** — and every `specs-only-*` / `full-*` session runs
inside `.worktrees/<slug>/`. The two coincide on `main` and diverge in a worktree, so a
hand-built link renders as a link and does nothing. Exit 2 means the path is not a live
design artifact; a missing `code` still prints the link and exits 0. Set
`NOLDOR_WORKSPACE_ROOT` when the editor's workspace folder is not the session's cwd (a
multi-root workspace, or a session started elsewhere).

`noldor-refactor` / `noldor-release-sweep` are Claude-agent orchestrations (no
thin-shim equivalent); `noldor-verify` and `noldor-debug` are discipline rules — see the Hard rules
above. Deep interactive behavior of any skill is Claude-primary.

<!-- noldor:rules:end -->
