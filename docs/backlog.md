# Backlog

### Audit Gate Documentation

- area: docs
- type: docs
- since: 2026-06-12
- size: S
- impact: low
- confidence: low

Verify the gate function is properly documented — audit `/gate` docs (skill + `docs/noldor/`) for completeness and accuracy.

### Does SQL in a Framework Make Sense?

- area: tooling
- type: feat
- since: 2026-06-12
- size: M
- impact: low
- confidence: low

Open question — does it make sense to introduce SQL into the framework? Explore use cases (dashboard queries, metrics, entry indexing) before committing.

### CLI Standalone Tool

- area: tooling
- type: feat
- since: 2026-06-12
- size: M
- impact: low
- confidence: low

Explore packaging Noldor's CLI as a fully standalone tool, decoupled from the in-repo install path.

### Idempotent Drain Delivery Guard

- area: tooling
- type: fix
- since: 2026-06-12
- size: S
- impact: med
- confidence: low

A triage commit that lived un-pushed on local `main` got delivered twice — once by a concurrent process and once by the operator (PRs #76 + #77, identical content) — because nothing detected that the local commit was already mirrored on `origin` under a different sha. Add an idempotency guard before re-delivering: when about to push/PR a local commit, check whether its tree/content already landed on `origin/main` (e.g. patch-id match) and skip the redundant delivery. Niche trigger (requires a concurrent delivery race), hence parked.
