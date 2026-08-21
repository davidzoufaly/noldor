---
description: Noldor spec — dialogue an idea into an approved design spec
---

Run the Noldor spec flow for this repo. Read `docs/noldor/workflow.md` and the
feature doc at `docs/features/<slug>.md` when one exists, then:

1. Ground in the real code/docs/tests the idea touches — cite actual paths.
2. Draft a strawman spec to `docs/design/specs/YYYY-MM-DD-<slug>-design.md` per
   `pnpm noldor prep format spec` BEFORE asking anything — every section present, each a
   short paragraph naming its own unknowns. Say it is a strawman.
3. Clarify one question at a time, each declaring the heading it is about:
   `pnpm noldor design context --slug <slug> --section "<heading>"` pasted above the question,
   then `pnpm noldor design log --slug <slug> --decide "…" --because "…" --instead-of "…" --section "…"`.
   Update the drafted section on disk after each answer. Present 2-3 approaches, lead with a
   recommendation.
4. Walk the sections in order: bring each to one or two paragraphs, ask, then
   `pnpm noldor design log --slug <slug> --confirm-section "<heading>"` on the yes.
5. Stop after the spec — the gate owns review (`pnpm noldor cr orchestrate --kind spec`).

Commit messages need a `Noldor-FD: <slug>` trailer.
