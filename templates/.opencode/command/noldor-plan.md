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
4. Stop after the plan — the gate owns review.

Commit messages need a `Noldor-FD: <slug>` trailer.
