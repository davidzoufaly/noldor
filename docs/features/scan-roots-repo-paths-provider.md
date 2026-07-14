---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/core/repo-paths.ts
    - src/sync/sync-code-links.ts
    - src/features/fill-links-code-gaps.ts
    - src/features/propose-pointers.ts
    - src/dashboard/data.ts
    - src/garden/sdd-report.ts
  docs: []
  tests:
    - src/core/__tests__/repo-paths.test.ts
  spec: >-
    docs/design/specs/archive/2026-07-03-scan-roots-repo-paths-provider-design.md
name: Scan-Roots Repo-Paths Provider
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.5.0
---

## Summary

Remaining hardcoded Charuy-layout scan roots (`packages`/`apps`/`scripts`) outside sdd-report: `src/features/fill-links-code-gaps.ts` (walkRepo ×2, lines 399-401 + 475-477) and `src/dashboard/data.ts` (walkRepo lines 1052-1056 + `readdir('packages')` line 1079) still walk the monorepo trio instead of consumer `scanPaths`, so on a standalone `src/` repo (self-host included) they see nothing. Also hardcoded: `readdir('packages')` for actualPackages in sdd-report main() and dashboard data. Mirror the `scanRoots()` fix shipped for sdd-report in PR #122 (`src/sync/sync-code-links.ts`), and unify the divergent fallbacks into one repo-paths provider — `src/features/propose-pointers.ts` falls back to `['src']` while `scanRoots()` falls back to the 4-dir union; the union semantics must win (PR #122 CR lesson: a `['src']` fallback regresses unconfigured monorepo consumers).

Fixed in this FD: the line numbers above describe the pre-fix state — every listed surface now resolves through `src/core/repo-paths.ts` (`scanRoots()` + `actualPackageNames()`), with `src/sync/sync-code-links.ts` keeping a compatibility re-export.

Separate operator-assisted follow-up surfaced by the PR #122 fix: 29 test files without `@tests:` tag (no import-owner hint derivable) and 51 src files unreferenced by any FD `links.code` (detector-9 probable-owner hints in sdd-report) — both need a judgment pass, not mechanical apply.

## User Story

As a Noldor consumer on a non-Charuy layout (standalone `src/` repo, self-host included), I want every repo-walking surface — links-code gap filling, dashboard SDD input, pointer proposals — to resolve scan roots from one consumer-aware provider, so that these tools see my code instead of silently walking empty `packages`/`apps`/`scripts` dirs.

## Usage

No new CLI surface — existing commands gain correct behavior on non-Charuy layouts:

1. Configure once (optional): set `consumer.scanPaths` in `.noldor/config.json` (e.g. `["src"]`). Unset → 4-dir union fallback.
2. `pnpm noldor fill-links-code-gaps --auto-high` (or the interactive `--dry-run`/`--apply` flow) — now walks `scanRoots()`.
3. Dashboard (`http://localhost:4321`) gap panel — now matches `pnpm sdd:report` output on any layout.
4. `pnpm noldor propose-pointers` — roots align with graph-freshness receipts; no `['src']` surprise on unconfigured monorepos.

Agent API: import `scanRoots()` / `actualPackageNames()` from `src/core/repo-paths.ts` for any new repo-walking feature; never hardcode layout dirs.

## PRs

<!-- @prs-since-last-release: scan-roots-repo-paths-provider -->

## Changelog

### Initial Release (v0.5.0)

#### Summary

Added a repo-paths provider exposing `scanRoots` and `actualPackageNames` (#144).

#### PRs

- #144: add repo-paths provider (scanRoots + actualPackageNames) ([link](https://github.com/davidzoufaly/noldor/pull/144))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-07-03-scan-roots-repo-paths-provider-design.md`](../../docs/design/specs/archive/2026-07-03-scan-roots-repo-paths-provider-design.md)
- **Code:**
  - [`src/core/repo-paths.ts`](../../src/core/repo-paths.ts)
  - [`src/sync/sync-code-links.ts`](../../src/sync/sync-code-links.ts)
  - [`src/features/fill-links-code-gaps.ts`](../../src/features/fill-links-code-gaps.ts)
  - [`src/features/propose-pointers.ts`](../../src/features/propose-pointers.ts)
  - [`src/dashboard/data.ts`](../../src/dashboard/data.ts)
  - [`src/garden/sdd-report.ts`](../../src/garden/sdd-report.ts)
- **Tests:**
  - [`src/core/__tests__/repo-paths.test.ts`](../../src/core/__tests__/repo-paths.test.ts)

<!-- /generated: resources -->
