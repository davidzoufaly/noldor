# Agent Rules — Noldor Consumer

This repo runs the Noldor discipline framework. Codex and opencode agents read
this file natively; Claude Code reads `.claude/` instead. Same rules, one gate.

## Hard rules

- Every code change enters through the gate: run `pnpm noldor next-priority`
  to pick work; follow `docs/noldor/workflow.md` for the path (micro-chore /
  fast-track / specs-only / full).
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

## Skills (codex/opencode)

The framework's interactive flows are CLI-backed. Invoke via the matching
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
