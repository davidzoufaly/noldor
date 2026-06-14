---
area: tooling
category: Tooling
deps: []
links:
  code:
    - scripts/graphify/**
    - scripts/garden/garden-detect.ts
    - scripts/garden/plan-resolution.ts
  docs: []
  tests: []
  spec: >-
    docs/superpowers/specs/2026-06-14-graphify-plan-of-edges-nodes-for-plans-specs-design.md
name: Graphify `plan-of` edges + nodes for plans/specs
packages:
  - scripts
phase: in-progress
noldor-tier: specs-only
---
## Summary

Extend graphify to emit nodes for `docs/superpowers/plans/*.md` and `docs/superpowers/specs/*.md`, plus `plan-of` / `spec-of` relations linking them to owning FD nodes. Today's graph tracks `imports` / `imports_from` between source files only; plans/specs aren't represented. Once available, enables `scripts/garden/garden-detect.ts:detectStalePlans` graph-adjacency fallback (originally fallback B from release-sweep-process-hardening; deferred from that FD when audit confirmed the graph schema didn't support it).

## User Story

As a doc-gardening agent, I want plans and specs represented in the knowledge graph with
`plan-of` / `spec-of` edges to their owning feature MDs, so that `detectStalePlans` /
`detectStaleSpecs` can resolve ownership by graph adjacency when filename-slug and
`links.*` both miss — and stop flagging live-owned artifacts for archive.

## Usage

```bash
# After a graphify build, enrich the graph with doc nodes + plan-of/spec-of edges
pnpm graphify:enrich-docs          # reads + rewrites graphify-out/graph.json in place

# Regen chain (release-sweep / garden):
/graphify .                        # external build → graph.json (code nodes)
pnpm graphify:enrich-docs          # add FD/plan/spec nodes + edges
pnpm toon graphify-out/graph.json  # graph-to-toon, now includes doc community

# Garden then consumes the enriched graph automatically:
pnpm garden:detect                 # detectStalePlans/Specs use graph-adjacency fallback
```

Agent API: `resolveByGraphAdjacency({ repo, docPath, relation: 'plan-of' | 'spec-of' })`
in `src/garden/plan-resolution.ts` returns `ResolvedOwner | null`.

## PRs

<!-- @prs-since-last-release: graphify-plan-of-edges-nodes-for-plans-specs -->

## Changelog
