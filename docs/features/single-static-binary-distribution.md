---
area: tooling
category: Tooling
deps: []
entry-id: Q-0133
links:
  code: []
  tests:
    - src/binary/__tests__/asset-pack.test.ts
    - src/binary/__tests__/asset-root.test.ts
    - src/binary/__tests__/build-pipeline.test.ts
    - src/binary/__tests__/install-mapping.test.ts
    - src/cli/__tests__/init-adopt-guard.test.ts
    - src/core/__tests__/noldor-cli.test.ts
  spec: docs/design/specs/2026-08-21-single-static-binary-distribution-design.md
name: Single Static Binary Distribution
packages:
  - noldor
  - scripts
phase: in-progress
since: 2026-08-17T00:00:00.000Z
noldor-tier: full
---
## Summary

Adoption assumes a TS/JS consumer with Node already present — `pnpm add`, `npx noldor`, `engines.node >=20` — which covers the entire current market. A self-contained executable built with `bun build --compile` removes that floor so a Go, Python or Rust repository can adopt the framework at all, and cuts hook startup further than a `dist` entrypoint alone. This is a packaging change and not a rewrite: 100% of the TypeScript source survives; the binary bundles the compiled `dist/` output that Q-0117 made canonical (shipped in v1.4.0), embeds the runtime assets (`templates/`, dashboard static, CR schema/prompts) as an extractable pack, and re-execs itself for internal subprocess spawns. The npm package stays untouched as the canonical Node channel. Scope: a four-target release matrix (darwin and linux × arm64 and amd64) with per-target native smoke tests, a checksum-verified `install.sh`, and a version-keyed asset cache. **Explicitly not sufficient for cross-language adoption on its own:** the checks still hardcode the TypeScript toolchain (`CODE_FILE_RE = /\.(ts|tsx|js|jsx)$/` in `src/core/repo-paths.ts:63`, `**/*.tsx` in `src/core/allowlist.ts:90`, the oxlint / oxfmt / vitest / tsc wrappers, dependency-cruiser import graphs), so pluggable per-language check adapters remain the separate and larger prerequisite for a non-TS consumer to get full check value — on the binary channel those commands fail with their ordinary tool-missing errors.

## User Story

As an operator of a non-Node repository (Go, Python, Rust), I want to install noldor as a single self-contained binary, so that I can adopt the framework's gate/docs/queue discipline without Node, pnpm, or any JS toolchain on my machine.

## Usage

**CLI**

1. Install (checksum-verified, defaults to `~/.local/bin`): `curl -fsSL https://raw.githubusercontent.com/davidzoufaly/noldor/main/install.sh | sh`
2. Pin a version (env on the shell side of the pipe): `curl -fsSL … | NOLDOR_VERSION=v1.5.0 sh`
3. Verify: `noldor --version`
4. First run extracts embedded assets to a version-keyed cache (`~/Library/Caches/noldor/<version>/pkg` on macOS, `$XDG_CACHE_HOME/noldor/<version>/pkg` elsewhere); later runs reuse it.

**Maintainer**

- `pnpm build:binary` — compile a host-target binary locally (requires bun at the pinned floor).
- Tag `v*` — CI builds all four targets, smokes each natively, attaches binaries + `SHA256SUMS` + notices to the GitHub release.

**Overrides**

- `NOLDOR_CACHE_DIR=<dir>` — cache base; version key still appended.
- `NOLDOR_ASSET_ROOT=<abs path>` — pre-extracted package root; skips extraction entirely.

**Binary-channel limits** — `init --adopt` and the `stub` runner are npm-channel-only; commands spawning consumer JS tooling fail with their ordinary tool-missing errors. Node consumers: nothing changes (`pnpm add -D @david.zoufaly/noldor`).

## PRs

<!-- @prs-since-last-release: single-static-binary-distribution -->

## Changelog
