---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/graphify/enrich-doc-nodes.ts
    - src/garden/garden-detect.ts
    - src/garden/plan-resolution.ts
    - src/cli/manifest.ts
  docs: []
  tests:
    - src/graphify/__tests__/enrich-doc-nodes.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-06-14-graphify-plan-of-edges-nodes-for-plans-specs-design.md
name: Graphify `plan-of` edges + nodes for plans/specs
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.4.0
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

### Initial Release (v0.4.0)

#### Summary

fd nodes + plan-of/spec-of edges added to graph, plus graph-adjacency stale fallback (#109).

#### PRs

- #109: doc nodes + plan-of/spec-of edges, graph-adjacency stale fallback ([link](https://github.com/davidzoufaly/noldor/pull/109))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-06-14-graphify-plan-of-edges-nodes-for-plans-specs-design.md`](../../docs/superpowers/specs/archive/2026-06-14-graphify-plan-of-edges-nodes-for-plans-specs-design.md)
- **Code:**
  - [`src/graphify/enrich-doc-nodes.ts`](../../src/graphify/enrich-doc-nodes.ts)
  - [`src/garden/garden-detect.ts`](../../src/garden/garden-detect.ts)
  - [`src/garden/plan-resolution.ts`](../../src/garden/plan-resolution.ts)
  - [`src/cli/manifest.ts`](../../src/cli/manifest.ts)
- **Tests:**
  - [`src/graphify/__tests__/enrich-doc-nodes.test.ts`](../../src/graphify/__tests__/enrich-doc-nodes.test.ts)

<!-- /generated: resources -->
