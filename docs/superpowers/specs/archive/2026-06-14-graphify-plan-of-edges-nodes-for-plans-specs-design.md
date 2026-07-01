# Graphify `plan-of` edges + nodes for plans/specs — Design

**Slug:** graphify-plan-of-edges-nodes-for-plans-specs
**FD:** docs/features/graphify-plan-of-edges-nodes-for-plans-specs.md
**Date:** 2026-06-14
**Tier:** specs-only
**Deps:** none

## Problem

`detectStalePlans` / `detectStaleSpecs` (`src/garden/garden-detect.ts`) resolve a
plan/spec to its owning feature MD through a 3-link chain:

1. filename-slug → `loadFeatureBySlug` (primary signal).
2. `resolveByLinksPlan` / `resolveByLinksSpec` (`src/garden/plan-resolution.ts`) —
   verbatim match against an FD's `links.plan` / `links.spec`.
3. age-out (mtime older than `STALE_DAYS_DEFAULT`, no owner found).

Plans/specs that match NEITHER a same-slug FD NOR any FD `links.*` entry (multi-feature
plans, infra plans, attach-path artifacts whose owner never declared the link) fall
straight to age-out — flagged for archive even when a live FD still owns the work. A
graph-adjacency fallback was designed for this (fallback B, from the
release-sweep-process-hardening work) and deferred: an audit confirmed the graph schema
**did not support it** — `graphify-out/graph.json` carries only `file_type: 'code'`
nodes and `imports_from / imports / contains / calls / method` relations. Plans, specs,
and feature MDs are not represented at all, so there is nothing to traverse.

This entry makes the graph schema support it.

## Goals

- Represent feature MDs, plans, and specs as nodes in `graphify-out/graph.json`.
- Emit `plan-of` / `spec-of` directed edges from each plan/spec node to its owning FD
  node, using a richer ownership signal than slug/`links.*` — specifically a transitive
  code-neighbor signal that catches the plans/specs the existing chain misses.
- Unblock the deferred graph-adjacency fallback in `detectStalePlans` /
  `detectStaleSpecs` by adding a `resolveByGraphAdjacency` resolver to
  `src/garden/plan-resolution.ts`, wired in **after** `resolveByLinks*` and **before**
  age-out.
- Keep the enrichment idempotent and re-runnable; do not regress
  `src/graphify/graph-to-toon.ts` output.

## Non-goals

- Patching the external `graphify` Python package. graphify is opinionated and external;
  this work is a post-build enrichment pass over its `graph.json` output, the same
  architectural slot `graph-to-toon.ts` already occupies.
- Running graphify (LLM-backed, expensive) from garden/detect time. The fallback reads
  whatever `graph.json` exists.
- Promoting graph-adjacency above the slug/`links.*` signals. It stays a last-resort
  fallback.
- New `area: docs`/`code` community semantics in the HTML/report visualization beyond
  what's needed to keep doc nodes out of the unlabeled bucket.

## Design

### Unit 1 — `enrichDocNodes` (`src/graphify/enrich-doc-nodes.ts`, new)

A post-build pass that reads `graphify-out/graph.json`, augments it, and writes it back
in place (idempotent). Mirrors the shape consumed by `graph-to-toon.ts`
(`GraphNode` = `{ id, label, file_type, source_file, community, norm_label }`,
`GraphLink` = `{ source, target, relation, ... }`).

Steps:

1. **Add FD nodes.** Scan `loadDocRoots(repo).features` (`docs/features/*.md`). For each
   FD, synthesize a node if its id is absent (`file_type: 'doc'`, `source_file` =
   relative FD path, deterministic id from `slugify`-of-path so re-runs are stable).
   Parse frontmatter with `FeatureFrontmatterSchema` (reuse the existing import) to read
   `links.code` / `links.plan` / `links.spec`.
2. **Add plan + spec nodes.** Scan `loadDocRoots(repo).plans` and `.specs`. One
   `file_type: 'doc'` node per `*.md` (skip non-`.md`, same as the detectors). Reuse
   `planSlugFromFilename` / `specSlugFromFilename` (exported from `garden-detect.ts`) for
   labels.
3. **Compute ownership + emit edges.** For each plan/spec node, resolve its owning FD via
   a priority chain and emit a directed `plan-of` (resp. `spec-of`) edge plan→FD:
   - (a) FD `links.plan` / `links.spec` contains the path verbatim (same predicate as
     `resolveByLinksPlan/Spec`).
   - (b) filename-slug equals an FD slug.
   - (c) **transitive code-neighbor** (the novel signal): the plan/spec markdown body
     references one or more source-file paths (markdown links + fenced/inline path
     mentions); an FD owns those paths via `links.code`; emit the edge to the FD sharing
     the most referenced code paths (no shared path → no edge).
   Confidence tag per edge records which rung fired (`EXTRACTED` for a/b, `INFERRED` for c)
   so the graph audit trail stays honest, matching graphify's existing edge tagging.
4. **Community.** Assign doc nodes a single synthetic community id (one above the current
   max) so `groupByCommunity` in `graph-to-toon.ts` doesn't dump them into the
   unlabeled `-1` bucket.

Exposed as `pnpm graphify:enrich-docs` (a `package.json` script invoking the module
via the existing tsx pattern), and called by the release-sweep / garden regen chain after
`/graphify` and before `pnpm toon`.

### Unit 2 — `resolveByGraphAdjacency` (`src/garden/plan-resolution.ts`)

New resolver alongside `resolveByLinksPlan` / `resolveByLinksSpec`, same
`ResolvedOwner | null` contract and `FsSeams` test-seam style:

```
resolveByGraphAdjacency({ repo, docPath, relation, graphPath?, readFile? }): Promise<ResolvedOwner | null>
```

- Read `graphify-out/graph.json` (path overridable for tests; missing file → `null`).
- Find the node whose `source_file` === `docPath`.
- Follow the outgoing `plan-of` / `spec-of` edge (per `relation`) to the FD node.
- Map the FD node's `source_file` back to a feature slug, `loadFeatureBySlug`, return the
  `ResolvedOwner`. Any miss (no node, no edge, FD unreadable) → `null`.

### Unit 3 — wire into the detectors (`src/garden/garden-detect.ts`)

In `detectStalePlans`, insert between the `resolveByLinksPlan` block (line ~140) and the
`stat`/age-out block (line ~153):

```
const byGraph = await resolveByGraphAdjacency({ repo, docPath: relPath, relation: 'plan-of' });
if (byGraph) {
  if (byGraph.fd.phase === 'done') {
    findings.push({ action: 'archive', path: relPath, reason: 'feature-done', slug: byGraph.slug });
  }
  continue;
}
```

Symmetric insertion in `detectStaleSpecs` with `relation: 'spec-of'`. Delete the
"graph-adjacency fallback deferred" comment now that it's live.

### Note — Touches paths corrected

The roadmap body cites `scripts/graphify/**`, `scripts/garden/garden-detect.ts`,
`scripts/garden/plan-resolution.ts` — Charuy-layout drift. Real surface in this repo is
`src/graphify/**`, `src/garden/garden-detect.ts`, `src/garden/plan-resolution.ts`.

## Acceptance criteria

- `enrichDocNodes` on a fixture `graph.json` adds one `file_type: 'doc'` node per FD,
  plan, and spec file, with deterministic ids; a second run is a no-op (idempotent).
- For a plan whose owning FD declares `links.plan`, an `EXTRACTED` `plan-of` edge plan→FD
  is emitted. Same for `spec-of` via `links.spec`.
- For a plan with no same-slug FD and no `links.plan`, but whose body references a source
  path owned by FD X via `links.code`, an `INFERRED` `plan-of` edge plan→X is emitted.
- A plan referencing no FD-owned code and matching no slug/link produces no edge.
- `resolveByGraphAdjacency` returns the correct `ResolvedOwner` by following the edge;
  returns `null` on missing graph file, missing node, or missing edge.
- `detectStalePlans` / `detectStaleSpecs` resolve a previously-age-out plan/spec to its
  live owner via the new fallback (suppresses the false archive finding); flips to a
  `feature-done` archive finding when the resolved owner has `phase: done`.
- `pnpm toon` on an enriched `graph.json` runs clean; doc nodes appear under the synthetic
  docs community, not the `-1` bucket.
- Existing `garden-detect.test.ts` / `plan-resolution.test.ts` still pass.

## Risks / trade-offs

- **Stale graph.** `graph.json` is only refreshed when graphify runs (LLM-backed,
  manual/sweep-time). A stale graph makes the fallback resolve against old adjacency.
  Mitigated by keeping it last-resort behind authoritative slug/`links.*` signals; a
  missing/old graph degrades to today's age-out behavior, never to a wrong-direction
  block.
- **Transitive false positives.** Body-text path scraping can mis-attribute a plan that
  merely *mentions* an unrelated file. Mitigated by max-shared-path tie-break and
  `INFERRED` tagging; it only ever *suppresses* an archive suggestion (conservative).
- **In-place graph.json writes.** Enrichment mutates the graphify output; a subsequent
  `/graphify` (non-`--update`) overwrites it, dropping doc nodes until enrich re-runs.
  Accepted — the regen chain always runs enrich after graphify; idempotence makes
  re-runs safe.

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

## Open questions (resolved)

1. *In-place `graph.json` enrichment vs a separate sidecar file?*
   -> In-place, idempotent post-build pass. (D1) The body wants plans/specs *represented in
   the graph*; `graph-to-toon.ts` is already `file_type`-agnostic, so doc nodes flow
   through without changes. A sidecar would fork the source of truth.

2. *Does `plan-of` ownership need a signal beyond slug + `links.*`?*
   -> Yes — add the transitive code-neighbor signal. (D2) Without a novel signal the
   fallback merely duplicates `resolveByLinksPlan/Spec` and resolves nothing new;
   transitive adjacency is the entire deferred-fallback-B value.

3. *Should garden run graphify to refresh the graph before reading it?*
   -> No; read whatever `graph.json` exists, treat absence as "no finding." (D3) graphify is
   LLM-backed and expensive; the fallback is last-resort and the slug/`links.*` signals
   are authoritative, so a stale/missing graph safely degrades to today's age-out.

4. *Community assignment for doc nodes?*
   -> A single synthetic "docs" community (max+1), not `-1`. (D4) Keeps
   `groupByCommunity` in `graph-to-toon.ts` from dumping doc nodes into the unlabeled
   cross bucket; trivial cost.

5. *`file_type` value for the new nodes?*
   -> `'doc'` (new value alongside `'code'`). (D5) Lets consumers filter doc vs code; nothing
   in `graph-to-toon.ts` switches on `file_type`, so no regression.
