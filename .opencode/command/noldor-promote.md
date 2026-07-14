---
description: Noldor promote — promote a roadmap/backlog entry to a feature MD
---

Run the Noldor promote flow. Read `docs/noldor/workflow.md`, then:

1. Read the schema-C block for `<slug>` from `docs/roadmap.md` (or `docs/backlog.md`).
2. Scaffold `docs/features/<slug>.md` (frontmatter + body stubs) via the `pnpm noldor` features/roadmap verbs.
3. Remove the source block.

Commit messages need a `Noldor-FD: <slug>` trailer.
