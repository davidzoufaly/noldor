---
description: Noldor draft-feature-md — draft a feature MD's User Story/Usage from spec/code
---

Run the Noldor draft-feature-md flow. Read `docs/noldor/workflow.md`, then draft the
`User Story` + `Usage` sections of `docs/features/<slug>.md` — from the spec
(`--from-spec`) after approval, or from spec+code+tests (`--refresh`) before the flip to
`phase: done`. Non-destructive; never overwrites non-TODO content without confirmation.
Does not stage or commit.
