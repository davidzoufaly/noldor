---
description: Noldor plan — decompose an approved spec into a bite-size TDD plan
---

Run the Noldor plan flow. Read the approved spec + `docs/noldor/workflow.md`, then:

1. Draft a skeleton plan first — header, `## File Structure`, one `## Task N` heading per
   known task with a sentence each — per `pnpm noldor prep format plan`, BEFORE asking
   anything. Say it is a strawman; without it the `--section` loop has no prose to render.
2. Map every file to create/modify (one responsibility each).
2.5. Any question while planning names its heading:
   `pnpm noldor design context --slug <slug> --kind plan --section "<heading>"` pasted above it,
   then `pnpm noldor design log --slug <slug> --decide "…" --because "…" --instead-of "…" --section "…"`,
   and update that plan section on disk before the next question.
   `--kind plan --confirm-section "<heading>"` on a signed-off task block — `--kind plan`
   is required, since `design log` defaults to the spec and would digest the wrong file.
2. Write bite-size TDD tasks (failing test → implement → pass → commit) per `pnpm noldor prep format plan` to `docs/design/plans/YYYY-MM-DD-<slug>.md`.
3. Run `pnpm noldor noldor split-check --plan <path>`. On a P1 signal, diagnose first: oversized **scope** bounces to a scope split (siblings back to the roadmap, plan narrowed to slice 1); a right-sized but verbose plan splits into `-part<N>` files.
4. Report the plan with `pnpm noldor design open <path>` — it prints a ready-made `link:`
   line. Report that line verbatim; never build the link yourself. It opens a tab only when
   the repo sets `design.autoOpen: true` or you pass `--open` (off by default, so a launch
   cannot raise a different editor window mid-task). A markdown link resolves against the editor's workspace folder while the
   plan's repo-relative path is relative to this session's checkout, and every `full-*`
   session runs inside `.worktrees/<slug>/` — so a hand-built link works on `main` and
   silently does nothing from a worktree. Set `NOLDOR_WORKSPACE_ROOT` when the editor's
   folder is not this session's cwd.
5. Stop after the plan — the gate owns review.

Commit messages need a `Noldor-FD: <slug>` trailer.
