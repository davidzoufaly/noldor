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

Adoption assumes a TS/JS consumer with Node already present — `pnpm add`, `npx noldor`, `engines.node >=20` — which covers the entire current market. A self-contained executable built with `bun build --compile` removes that floor so a Go, Python or Rust repository can adopt the framework at all, and cuts hook startup further than a `dist` entrypoint alone. This is a packaging change and not a rewrite: 100% of the TypeScript source survives; the binary bundles the compiled `dist/` output that Q-0117 made canonical (shipped in v1.4.0), embeds the runtime assets (`templates/`, dashboard static, CR schema/prompts) as an extractable pack, and re-execs itself for internal subprocess spawns. The npm package stays untouched as the canonical Node channel. Scope: a four-target release matrix (darwin and linux × arm64 and amd64) with per-target native smoke tests, a checksum-verified `install.sh`, and a version-keyed asset cache. **Explicitly not sufficient for cross-language adoption on its own:** the checks still hardcode the TypeScript toolchain (`CODE_FILE_RE = /\.(ts|tsx|js|jsx)$/` in `src/core/repo-paths.ts:63`, `**/*.tsx` in `src/core/allowlist.ts:90`, the oxlint / oxfmt / vitest / tsc wrappers, dependency-cruiser import graphs), so pluggable per-language check adapters remain the separate and larger prerequisite for a non-TS consumer to get full check value — on the binary channel those commands fail with their ordinary tool-missing errors.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: single-static-binary-distribution -->

## Changelog
