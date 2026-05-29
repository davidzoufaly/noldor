# Backlog

### PR-Flow Tree-Shape Validation (auditReleasePushes)

- area: tooling
- type: feat
- since: 2026-05-15
- size: S
- impact: med
- parent: framework-pr-flow-agent-auto-merge

`scripts/garden/detectors/override-audit.ts`'s `auditReleasePushes` only validates the receipt-log format today (per spec §7 of `framework-pr-flow-agent-auto-merge`). Extend the detector to cross-check each receipt SHA against the canonical release-commit signature: `git show --name-only <sha>` must include `package.json` and `docs/release-notes.md`. Suspicious receipts (env-var-bypass written but commit doesn't match release shape) get downgraded to WARN. Closes the spec gap noted as a TODO comment above `auditReleasePushes`.

### Trailer Scope-Alias Map

- area: tooling
- type: feat
- since: 2026-05-11
- size: S
- impact: high
- parent: noldor

`scripts/garden/detectors/trailer-scope-mismatch.ts` rejects commits where the Conventional Commits scope doesn't equal (or end with `:`) the `Noldor-FD:` slug. v0.4.0 release surfaced 24 such mismatches: `feat(sdd):` commits tagged to FD `sdd-co-tag-detector`, `feat(cr):` commits tagged to FD `noldor`, etc. — the team has informally adopted shorter scope tokens. Required `RELEASE_SKIP_GATE_COMPLIANCE=1` bypass. Fix: add a config-driven alias map (`scope-aliases.json` or detector frontmatter) where `sdd → sdd-co-tag-detector`, `cr → noldor`, etc., so the detector accepts the team's actual usage instead of demanding artificial scope expansion.

- triage 2026-05-11: relocated from `### UI Bugs & Polish` — misfiled at intake, semantically framework-scope.

### Slow-Loading Tests

- area: tooling
- type: test
- since: 2026-05-02
- size: M
- impact: low

Tests that simulate slow network / heavy CSG ops to verify loading-state UX (skeletons, progress, no-flicker). Demoted from roadmap 2026-05-04 — adopt once the UI surface stabilizes and loading states become a recurring source of bugs.
