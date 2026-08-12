---
area: tooling
category: Tooling
deps: []
entry-id: Q-0033
links:
  code:
    - src/clones/tokenize.ts
    - src/clones/detect.ts
    - src/clones/diff-scope.ts
    - src/clones/baseline.ts
    - src/clones/clones-cli.ts
    - src/core/config.ts
    - src/core/repo-paths.ts
    - src/cli/manifest.ts
    - src/garden/sdd-report.ts
  tests:
    - src/clones/__tests__/baseline.test.ts
    - src/clones/__tests__/clones-cli.test.ts
    - src/clones/__tests__/detect.test.ts
    - src/clones/__tests__/diff-scope.test.ts
    - src/clones/__tests__/tokenize.test.ts
    - src/core/__tests__/cli-entry.test.ts
  spec: docs/design/specs/archive/2026-07-13-code-clone-detector-design.md
name: Code-Clone Detector
packages:
  - scripts
phase: done
since: 2026-07-11T00:00:00.000Z
noldor-tier: full
introduced: 1.0.0
---

## Summary

Token/AST-based Type-1/2/3 clone detection (copy-paste dups, à la `jscpd`). Deterministic corpus over `scanPaths`, no LLM. Surface duplicate blocks as a new signal in `sdd-report` + feed `/refactor`; optional CR-gate block above a configurable clone threshold. Fits the "deterministic detector + optional LLM triage" pattern (same shape as detector-5 idea-merge). Distinct from existing pieces: `/refactor` finds consolidation opportunities from god-nodes/cohesion but doesn't do line/token clone matching; `graphify` AST graph has structural similarity signal but no clone report. Semantic (Type-4) clones out of scope — that's the embeddings-infra entry.

## User Story

As a framework maintainer, I want a deterministic token-based clone report over the configured source roots, so that copy-paste duplication surfaces in sdd-report and refactor sessions target real duplicate blocks instead of guessing from file sizes.

## Usage

**Agent/Programmatic API**

- `pnpm noldor clones report` — human summary (top groups, duplication %); `--json` for the full `CloneReport` (feeds `/noldor-refactor`).
- `pnpm noldor clones baseline` — record the whole-corpus ratchet baseline at `.noldor/clones-baseline.json` (tracked, committed). Re-run to lock in an improvement; a re-record says whether it `lowered` or `RAISED` the number, so loosening the ratchet is visible.
- `pnpm noldor clones check` — three independent verdicts; red (exit 1) if any trips:
  - **diff-scoped** (default-on, no tuning): red when a clone group has at least one instance overlapping the lines this change wrote. `--against <ref>` names the base; omitted, it resolves `@{upstream}`, else the remote's default branch. Skipped green with a stderr reason when no base resolves; exit 3 when an explicit `--against` does not resolve.
  - **corpus threshold**: red when `clones.thresholdPct` (`.noldor/config.json`) is exceeded; unset = green.
  - **ratchet** (no tuning): red when `duplicatedTokens` rose above `.noldor/clones-baseline.json`. Absolute tokens, not the percentage — the ratio moves whenever clean code is added or deleted. No baseline = skipped green (nothing to ratchet against); a baseline recorded under other detection options is reported as not-comparable, never red; an unreadable baseline exits 3. Every could-not-compare state prints on stderr — only a real comparison and `clones.ratchet: false` stay on stdout, so a deleted baseline cannot silence the gate quietly.
- Runs automatically as the `noldor-clones` pre-push job (`lefthook/noldor.yml`). Opt out per verdict with `clones.diffScope: false` / `clones.ratchet: false`.
- Flags: `--against <ref>` (`check` only — a usage error elsewhere), `--min-tokens N` (50), `--min-lines N` (5), `--gap-tokens N` (10), `--include-tests`.
- `sdd-report` — `## Code clones` section renders group count + duplication % + top-5 groups on every regen.

## PRs

<!-- @prs-since-last-release: code-clone-detector -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-07-13-code-clone-detector-design.md`](../../docs/design/specs/archive/2026-07-13-code-clone-detector-design.md)
- **Code:**
  - [`src/clones/tokenize.ts`](../../src/clones/tokenize.ts)
  - [`src/clones/detect.ts`](../../src/clones/detect.ts)
  - [`src/clones/diff-scope.ts`](../../src/clones/diff-scope.ts)
  - [`src/clones/baseline.ts`](../../src/clones/baseline.ts)
  - [`src/clones/clones-cli.ts`](../../src/clones/clones-cli.ts)
  - [`src/core/config.ts`](../../src/core/config.ts)
  - [`src/core/repo-paths.ts`](../../src/core/repo-paths.ts)
  - [`src/cli/manifest.ts`](../../src/cli/manifest.ts)
  - [`src/garden/sdd-report.ts`](../../src/garden/sdd-report.ts)
- **Tests:**
  - [`src/clones/__tests__/baseline.test.ts`](../../src/clones/__tests__/baseline.test.ts)
  - [`src/clones/__tests__/clones-cli.test.ts`](../../src/clones/__tests__/clones-cli.test.ts)
  - [`src/clones/__tests__/detect.test.ts`](../../src/clones/__tests__/detect.test.ts)
  - [`src/clones/__tests__/diff-scope.test.ts`](../../src/clones/__tests__/diff-scope.test.ts)
  - [`src/clones/__tests__/tokenize.test.ts`](../../src/clones/__tests__/tokenize.test.ts)
  - [`src/core/__tests__/cli-entry.test.ts`](../../src/core/__tests__/cli-entry.test.ts)

<!-- /generated: resources -->
