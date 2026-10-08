---
area: tooling
category: Tooling
deps: []
entry-id: Q-0341
links:
  code:
    - src/worktrees/code-freshness-cli.ts
    - src/worktrees/code-freshness.ts
  tests:
    - src/worktrees/__tests__/code-freshness.test.ts
  spec: >-
    docs/design/specs/archive/2026-10-08-graph-and-main-freshness-before-coding-design.md
name: Graph and Main Freshness Before Coding
packages:
  - scripts
phase: done
since: 2026-10-07T00:00:00.000Z
noldor-tier: specs-only
introduced: 1.16.0
---

## Summary

Graph freshness is checked once per session, at the spec's structural-read step, and never again (surfaced 2026-10-04, charuy Q-0145). `noldor-spec` step 1.7 runs `design graph-context`, rebuilds on `stale`, reads the digest, then restores `graphify-out/`. Nothing re-checks before implementation starts, during it, or before the code-stage CR, so a long session (spec → 3 review rounds → code) can plan and code against a graph the tree has moved past, and other sessions' merges to `origin/main` mid-session are never pulled in. Worktrees branch from `origin/main` at create time and `pr-flow` fetches at the end, but nothing fetches in between. Options: (a) gate Step 3.5 (rule brief before the first edit) also runs `design graph-context` over the files about to be touched and rebuilds locally on `stale` (~15 s, restored afterwards, never committed); (b) a `git fetch origin main` + "main moved N commits since worktree create" notice at the same seam, so the operator can merge main in before coding rather than at push.

## Diagram

noldor:cut one CLI running two independent checks — no structure worth drawing beyond the Usage list

## User Story

As an agent (or operator) about to write the first line of code in a long spec session, I want one command that tells me whether the knowledge graph is still fresh for my files and whether `origin/main` has moved under them, so that I rebase before coding instead of finding the drift as a conflict at push.

## Usage

**Agent/Programmatic API**

- `pnpm noldor worktrees freshness [--file <path>]... [--rebuild] [--json]` — run by gate Step 3.5 (and drain mode) with the session's first `rules brief`, over the same `--file` set. Prints a `graph:` verdict (with per-path digests when fresh) and a `main:` verdict (commits behind, graph-refresh-only commits counted apart, commits touching the files). Always exits 0; 2 on a usage error.
- `--rebuild` rebuilds a stale graph and always restores `graphify-out/` afterwards, a failed build included; an already-dirty `graphify-out/` is left alone.
- A `next: git rebase origin/main` line means rebase before the first edit, then re-run once; on a conflicting rebase, `git rebase --abort` (see `.claude/skills/noldor-gate/freshness.md`).
- `--json` prints `{ graph: { verdict, reason, digests, warnings }, main: { verdict, reason, behind, graphOnly, touching, overlap, rebaseAdvised } }`.

## PRs

<!-- @prs-since-last-release: graph-and-main-freshness-before-coding -->

## Changelog

### Initial Release (v1.16.0)

#### Summary

This release checks that the graph and `main` are fresh before the first edit (#685).

#### PRs

- #685: check graph and main freshness before the first edit ([link](https://github.com/davidzoufaly/noldor/pull/685))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-10-08-graph-and-main-freshness-before-coding-design.md`](../../docs/design/specs/archive/2026-10-08-graph-and-main-freshness-before-coding-design.md)
- **Code:**
  - [`src/worktrees/code-freshness-cli.ts`](../../src/worktrees/code-freshness-cli.ts)
  - [`src/worktrees/code-freshness.ts`](../../src/worktrees/code-freshness.ts)
- **Tests:**
  - [`src/worktrees/__tests__/code-freshness.test.ts`](../../src/worktrees/__tests__/code-freshness.test.ts)

<!-- /generated: resources -->
