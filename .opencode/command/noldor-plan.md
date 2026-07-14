---
description: Noldor plan — decompose an approved spec into a bite-size TDD plan
---

Run the Noldor plan flow. Read the approved spec + `docs/noldor/workflow.md`, then:

1. Map every file to create/modify (one responsibility each).
2. Write bite-size TDD tasks (failing test → implement → pass → commit) per `pnpm noldor prep format plan` to `docs/design/plans/YYYY-MM-DD-<slug>.md`.
3. Run `pnpm noldor noldor split-check --plan <path>`; split into parts on a P1 signal.
4. Stop after the plan — the gate owns review.

Commit messages need a `Noldor-FD: <slug>` trailer.
