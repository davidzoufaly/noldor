---
description: Noldor gate — single mandatory entry for any code change
---

Run the Noldor gate flow for this repo. Read `docs/noldor/workflow.md` and
`docs/noldor/complexity-gating.md`, then:

1. `pnpm noldor next-priority --suggestions --json` — pick the top entry.
2. Follow the suggested path. Worktree paths: `pnpm noldor worktrees create <slug>`.
3. Specs/plans per `pnpm noldor prep format spec|plan`.
4. CR: `pnpm noldor cr orchestrate --slug <slug> --artifact <path> --kind <kind> --autonomous`.
5. Ship via `pnpm noldor pr-flow`.

Commit messages need a `Noldor-FD: <slug>` trailer (lefthook injects it when a
session marker exists).
