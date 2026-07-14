---
description: Noldor spec — dialogue an idea into an approved design spec
---

Run the Noldor spec flow for this repo. Read `docs/noldor/workflow.md` and the
feature doc at `docs/features/<slug>.md` when one exists, then:

1. Ground in the real code/docs/tests the idea touches — cite actual paths.
2. Clarify one question at a time; present 2-3 approaches, lead with a recommendation.
3. Write the spec per `pnpm noldor prep format spec` to `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md`.
4. Stop after the spec — the gate owns review (`pnpm noldor cr orchestrate --kind spec`).

Commit messages need a `Noldor-FD: <slug>` trailer.
