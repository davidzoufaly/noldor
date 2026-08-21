---
area: tooling
category: Tooling
deps: []
entry-id: Q-0133
links:
  code: []
  tests: []
  spec: docs/design/specs/2026-08-21-single-static-binary-distribution-design.md
name: Single Static Binary Distribution
packages:
  - noldor
  - scripts
phase: in-progress
since: 2026-08-17
noldor-tier: full
---

## Summary

Adoption assumes a TS/JS consumer with Node already present — `pnpm add`, `npx noldor`, `engines.node >=20` — which covers the entire current market. A self-contained executable (`bun build --compile`, Node SEA, or `deno compile`) removes that floor so a Go, Python or Rust repository could adopt the framework at all, and cuts hook startup further than a `dist` entrypoint alone. This is a packaging change and not a rewrite: 100% of the TypeScript source survives. Distinct from Q-0117 because all three of that entry's options answer which TS representation ships inside the npm tarball, and every one of them still requires Node on the consumer machine; this removes the requirement. Blocked on Q-0117 because the compiled-entrypoint decision is the prerequisite — there is nothing coherent to embed while `bin/noldor.mjs` boots `src` through `tsx`. Costs to weigh before promoting: a cross-platform release matrix (darwin and linux × arm64 and amd64) with per-target smoke tests, keeping the npm package as a thin wrapper so `npx noldor` and every existing consumer keep working, and deciding what happens to the `templates/` payload and any other file the CLI reads from its own package at runtime — an embedded filesystem or an extraction step, neither free. **Explicitly not sufficient for cross-language adoption on its own:** the checks still hardcode the TypeScript toolchain (`CODE_FILE_RE = /\.(ts|tsx|js|jsx)$/` in `src/core/repo-paths.ts:63`, `**/*.tsx` in `src/core/allowlist.ts:90`, the oxlint / oxfmt / vitest / tsc wrappers, dependency-cruiser import graphs), so pluggable per-language check adapters are the separate and larger prerequisite for a non-TS consumer to get value. Park until either that adapter work is on the queue or a concrete non-Node consumer asks. (raised 2026-08-17 assessing a Go-rewrite question)

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: single-static-binary-distribution -->

## Changelog
