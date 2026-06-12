# Backlog

### Slow-Loading Tests

- area: tooling
- type: test
- since: 2026-05-02
- size: M
- impact: low

Tests that simulate slow network / heavy CSG ops to verify loading-state UX (skeletons, progress, no-flicker). Demoted from roadmap 2026-05-04 — adopt once the UI surface stabilizes and loading states become a recurring source of bugs.

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
