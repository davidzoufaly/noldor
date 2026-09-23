---
area: tooling
category: Tooling
deps: []
entry-id: Q-0260
links:
  code: []
  spec: docs/design/specs/2026-09-22-self-refreshing-compact-knowledge-graph-design.md
  tests: []
name: Self-Refreshing, Compact Knowledge Graph
packages:
  - scripts
phase: in-progress
noldor-tier: full
---

## Summary

<!-- TODO 1-3 sentences. What the feature is. -->

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

As an agent reading a repo I did not write, I want the committed knowledge graph to be
fresh and to carry a table of contents, so that I can load one community's topology
instead of a 697 KB file — or, worse, reason from a graph that no longer matches the code.

## Usage

```bash
# Consumers get the workflow from init. It is scaffold-only, so your edits survive.
pnpm noldor init            # writes .github/workflows/update-knowledge-graph.yml
pnpm noldor init --update   # never overwrites a modified copy

# Locally nothing changes — the renderer just emits v3 now
pnpm noldor graphify graph-to-toon graphify-out/graph.json
```

On CI, a merged PR titled `feat`, `fix` or `refactor` regenerates `graphify-out/` onto the
fixed `noldor/graph-refresh` branch and opens one `chore(graph): …` PR, force-updated by
each later run — so the queue never grows past one. Where auto-merge is enabled the PR
merges itself; where it is not (charuy today) it waits for a human. Two repository
settings the template cannot set for you: auto-merge must be enabled, and a PR opened
with the default `GITHUB_TOKEN` does not trigger other workflows, so required checks on
the graph PR need a PAT or app token.

Reading one community means taking its line range from the `toc` block at the top of
`graph.brainstorm.toon` and passing it as `Read offset/limit`:

```
# TOC: <key>: <startLine>-<endLine>
  c85: 1204-1231
```

Agent API: a pure render function in `src/graphify/graph-to-toon.ts` takes a parsed graph
object and returns the `.toon` text without writing a file; the CLI reads, calls, writes.

## PRs

<!-- @prs-since-last-release: self-refreshing-compact-knowledge-graph -->

## Changelog
