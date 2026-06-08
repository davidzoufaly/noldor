---
area: tooling
category: Tooling
deps: []
links:
  code: []
  tests: []
name: Trailer Scope-Alias Map
packages:
  - scripts
phase: done
noldor-tier: specs-only
---
## Summary

`scripts/garden/detectors/trailer-scope-mismatch.ts` rejects commits where the Conventional Commits scope doesn't equal (or end with `:`) the `Noldor-FD:` slug. v0.4.0 release surfaced 24 such mismatches: `feat(sdd):` commits tagged to FD `sdd-co-tag-detector`, `feat(cr):` commits tagged to FD `noldor`, etc. — the team has informally adopted shorter scope tokens. Required `RELEASE_SKIP_GATE_COMPLIANCE=1` bypass. Fix: add a config-driven alias map (`scope-aliases.json` or detector frontmatter) where `sdd → sdd-co-tag-detector`, `cr → noldor`, etc., so the detector accepts the team's actual usage instead of demanding artificial scope expansion.

## User Story

As a release maintainer (or agent running the release gate), I want the
trailer-scope-mismatch detector to accept our team's short commit-scope tokens
through a configured alias map, so that informal scopes like `feat(cr):` ship
without the `RELEASE_SKIP_GATE_COMPLIANCE=1` bypass.

## Usage

**Configuration** (`.noldor/config.json` → `consumer.scopeAliases`)

1. Add a `scopeAliases` map: each key is a short scope token, each value an
   array of the FD slugs that token may front.
   ```json
   "scopeAliases": { "cr": ["noldor"], "sdd": ["sdd-co-tag-detector"] }
   ```
2. The `trailer-scope-mismatch` garden detector then accepts any commit whose
   scope's last `:`-delimited segment is a registered alias for that commit's
   `Noldor-FD` slug (e.g. `feat(cr):` or `feat(garden:cr):` carrying
   `Noldor-FD: noldor`). An empty or absent map (`{}`) preserves the original
   scope-equals-slug behavior.

_No UI, keyboard shortcut, or agent API — this is release-gate configuration._

## PRs

<!-- @prs-since-last-release: trailer-scope-alias-map -->

## Changelog
