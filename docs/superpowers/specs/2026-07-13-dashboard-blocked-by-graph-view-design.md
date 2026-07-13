# Dashboard Blocked-By Graph View — Design

**Slug:** dashboard-blocked-by-graph-view
**FD:** docs/features/dashboard-blocked-by-graph-view.md
**Date:** 2026-07-13
**Tier:** specs-only

## Problem

`blocked-by:` edges across `docs/roadmap.md` + `docs/backlog.md` shipped as a first-class field (data model, `unknown-blocked-by-ref` validation, `circular-blocked-by` garden detector), but the graph itself is invisible — operators read dependency structure by scanning bullet lists across two files. Cycles flagged by the detector have no visual surface at all. The dashboard visualization was explicitly deferred out of `first-class-blocked-by-field` as its own piece.

## Goals

- A `/blocked-by` dashboard page rendering the roadmap+backlog dependency graph: nodes = entries, directed edges = `blocked-by` (legacy `deps:` alias included — `parse-blocks.ts` already merges both into `deps`).
- Cycle members (per `findBlockedByCycles`, `src/garden/detectors/circular-blocked-by.ts`) visually highlighted.
- `?format=json` machine surface, consistent with `/wip-age`'s pattern.
- Zero new client dependencies — reuse the mermaid 11 runtime already loaded by `src/dashboard/layout.ts` (`MERMAID_SCRIPT`, `startOnLoad: true` renders any `<pre class="mermaid">`).

## Non-goals

- No interactive graph editing (drag, edge add/remove) — read-only view.
- No FD-level dependency graph (`docs/features/*.md` `deps:` frontmatter) — this page covers queue entries (roadmap + backlog); FD deps are a different lifecycle stage.
- No graphify/AST integration — `/graph-health` owns code-graph concerns.
- No cycle auto-fix — the garden detector already classifies cycles `action: 'manual-edit'`.

## Design

### Unit 1 — data loader: `loadBlockedByGraph()` in `src/dashboard/data.ts`

```ts
export interface BlockedByNode {
  slug: string;
  name: string;
  id?: string;          // Q-NNNN when present
  source: 'roadmap' | 'backlog';
  size?: string;
  inCycle: boolean;
}
export interface BlockedByEdge {
  from: string;         // blocked entry slug
  to: string;           // blocker entry slug (resolved from slug or Q-id ref)
  dangling?: string;    // set instead of `to` resolution when the ref matches nothing
}
export interface BlockedByGraph {
  nodes: BlockedByNode[];
  edges: BlockedByEdge[];
  cycles: string[][];   // findBlockedByCycles output
  unlinked: number;     // entries with no in- or out-edges (not rendered as nodes)
}
```

Reads `docs/roadmap.md` + `docs/backlog.md` (same `readFile` + `parseRoadmapBlocks`/`parseBacklog` pattern the existing loaders use — cf. `parseRoadmapFromString` at `src/dashboard/data.ts:280`). Ref resolution copies the detector's rule: `Q-id → slug` map first, then slug identity; a ref resolving to nothing becomes a `dangling` edge (rendered distinctly, since `unknown-blocked-by-ref` validation is advisory). Cycles come from calling `findBlockedByCycles(roadmapRaw, backlogRaw)` directly — single source of truth with the garden detector; no reimplementation. Nodes with no edges are counted in `unlinked` but excluded from `nodes` (a fully-disconnected scatter of every queue entry is noise; the page states the count).

### Unit 2 — view: `renderBlockedBy(graph)` in `src/dashboard/views.ts`

- Headline strip: node count, edge count, cycle count, unlinked count.
- Mermaid `flowchart LR` inside `<pre class="mermaid">` (auto-rendered by the layout's `MERMAID_SCRIPT`). Node line per entry: `s_<idx>["<name> (<Q-id>)"]` — synthetic `s_<n>` mermaid IDs sidestep slug-vs-mermaid-syntax collisions; labels escaped (quotes stripped/replaced). Edge per `BlockedByEdge`: `s_a --> s_b` (arrow points blocked → blocker). Dangling edge: `s_a -.-> d_<n>["<ref> (unknown)"]`.
- Cycle members get `classDef cycle` styling (red stroke) via one `class s_x,s_y cycle` line; a cycle list renders under the graph as text (`cycle: a → b → a`) mirroring the detector's `message` format.
- Backlog nodes get a muted `classDef backlog` so queue-vs-parking-lot reads at a glance.
- Empty state (`edges.length === 0 && cycles.length === 0`): the dashboard's existing empty-state convention (cf. `metricEmpty` in views.ts) with copy "No blocked-by edges declared — the queue is dependency-free." — no mermaid block emitted.

### Unit 3 — route + nav wiring in `src/dashboard/server.ts` + `src/dashboard/layout.ts`

- `'/blocked-by': handleBlockedBy` in the route table; handler mirrors `handleGraphHealth` (no params except `format`): `?format=json` → `jsonResult(200, graph)`; else `{ status: 200, body: renderBlockedBy(graph), title: 'Blocked-by', activeNav: '/blocked-by' }`.
- `NAV_LINKS`: `{ href: '/blocked-by', label: 'Blocked-by' }` after `/backlog` (adjacent to the surfaces it visualizes).
- The existing route-sweep regression test enumerates the route table, so `/blocked-by` is auto-covered for a 200 sweep.

### Data flow

`handleBlockedBy` → `loadBlockedByGraph()` → fs reads + `parse-blocks` + `findBlockedByCycles` → `renderBlockedBy` → mermaid text in HTML → client-side mermaid renders.

### Error handling

- Missing `docs/roadmap.md`/`docs/backlog.md` → treat as empty string (loader catch → `''`), page renders empty state; consistent with other loaders' fail-open reads.
- Mermaid render failure is client-side only (CDN dev-tool dependency, accepted at layout level); the cycle text list under the graph keeps the page informative without JS.

### Testing

- `src/dashboard/__tests__/blocked-by.test.ts` (tagged `// @tests: dashboard-blocked-by-graph-view`), fixture temp-dirs:
  1. Two entries with a `blocked-by:` slug ref → one edge, both nodes, `unlinked` counts the rest.
  2. Q-id ref resolves to slug (`blocked-by: Q-0002` → edge to that entry's slug).
  3. Legacy `deps:` alias produces an edge.
  4. Cycle a↔b → both `inCycle: true`, `cycles` = one 2-element list.
  5. Dangling ref → `dangling` edge, no crash.
  6. Render: mermaid block contains node + edge lines; cycle classline present; empty graph renders empty-state copy and no `<pre class="mermaid">`.
- Route-sweep test covers `/blocked-by` automatically (route-table enumeration).

## Acceptance criteria

- `/blocked-by` renders a mermaid graph of all roadmap+backlog `blocked-by`/`deps` edges; cycle members visually distinct; backlog nodes visually distinct from roadmap nodes.
- `/blocked-by?format=json` returns `{ nodes, edges, cycles, unlinked }`.
- Cycles shown match `garden detect`'s `circularBlockedBy` output exactly (shared `findBlockedByCycles`).
- Empty queue → empty-state copy, no mermaid block, still HTTP 200.
- Suite + typecheck green; route-sweep passes with the new route.

## Risks / trade-offs

- **Mermaid CDN dependency** — page is blank-graph if offline. Accepted at layout level already (internal dev tool); the text cycle list keeps critical signal server-rendered.
- **Graph legibility at scale** — dozens of edges could tangle. Mitigated by excluding unlinked nodes and `flowchart LR` layout; revisit with filtering only if real queues outgrow it (YAGNI).
- **`dashboard → garden detector` import** (`findBlockedByCycles`): no boundary rule forbids it (`.noldor/config.json` restricts `core→*`, `invariants→garden`, `sync→garden`); the function is pure string-in/lists-out.

## User Story

As an operator triaging the queue, I want the roadmap+backlog blocked-by graph rendered visually on the dashboard with cycles highlighted, so that I can read dependency structure and spot deadlocks at a glance instead of cross-scanning bullet lists in two files.

## Usage

**UI**

1. Open the tracking dashboard (`pnpm noldor dashboard server`).
2. Click **Blocked-by** in the nav (after Backlog).
3. Read the graph: arrows point blocked → blocker; red nodes are cycle members; muted nodes live in the backlog; dashed arrows mark dangling refs. Cycle chains are also listed as text under the graph.

**Agent/Programmatic API**

- `GET /blocked-by?format=json` → `{ nodes, edges, cycles, unlinked }` (`loadBlockedByGraph()` shape in `src/dashboard/data.ts`).

## Open questions (resolved)

1. *Mermaid client-render vs server-side SVG?*
   -> Mermaid client-render. (D1) The layout already ships mermaid 11 with `startOnLoad`; server-side SVG would add a heavyweight dependency for an internal dev tool.
2. *Include FD `deps:` frontmatter edges too?*
   -> No — queue entries only. (D2) FD deps model a different lifecycle stage; mixing the two node types muddies both. Separate entry if wanted later.
3. *Render unlinked entries as isolated nodes?*
   -> No — count them in a headline stat. (D3) Most queue entries have no deps; rendering them all buries the actual graph.
4. *Where does the nav item go?*
   -> After Backlog. (D4) It visualizes roadmap+backlog data; adjacency beats appending to the tail of an already-long nav.
