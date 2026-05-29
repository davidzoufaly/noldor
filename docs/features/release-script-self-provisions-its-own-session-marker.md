---
area: tooling
category: Tooling
deps: []
links:
  code:
    - scripts/hooks/noldor-pre-commit.ts
    - scripts/noldor/session.ts
    - scripts/release/index.ts
  tests: []
name: Release Script Self-Provisions Its Own Session Marker
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.6.0
---

## Summary

`scripts/release/index.ts:257-263` runs `git commit -m "chore(release): vX.Y.Z" -m "Noldor-Path: release-automation"` without first writing `.noldor/session.json`. Post-rollout, `scripts/hooks/noldor-pre-commit.ts:58-63` hard-walls any commit lacking a session, rejecting the release commit with "No /gate session. Run /gate before committing: CHANGELOG.md, …". Discovered 2026-05-17 during v0.5.1 release sweep: operator had to manually write a `fast-track` session marker before `pnpm release` succeeded, because `release-automation` is not a valid value in the session-path enum (`scripts/noldor/session.ts` zod schema rejects it). Fix candidates: (a) extend session-path enum to include `release-automation` and have the release script write the marker itself before staging, with cleanup in a `finally`; (b) teach `noldor-pre-commit.ts` to short-circuit when the pending `.git/COMMIT_EDITMSG` already carries `Noldor-Path: release-automation` (peek-at-msg pattern, similar to override-trailer fix candidate at line 592); (c) `noldor-inject-trailers.ts` writes a transient session marker for the release commit. Without this fix, every `pnpm release` invocation requires the operator to remember the `fast-track` workaround — a quiet rollout-era regression no one has documented yet.

## User Story

As a release operator (human or agent), I want `pnpm release` to write its own
`.noldor/session.json` marker before committing, so that I don't have to
manually provision a `fast-track` session marker every time I run a release.

## Usage

1. From the `main` workspace with a clean working tree, run `pnpm release`.
2. The script invokes `withReleaseSession(process.cwd(), ...)` (see
   `scripts/release/release-session.ts`), which writes
   `{ path: 'release-automation', startedAt: <iso> }` to
   `.noldor/session.json` before any commit.
3. The `prepare-commit-msg` hook reads that marker and injects
   `Noldor-Path: release-automation` into the release commit's trailer
   block — no manual `-m` argument is needed.
4. After the release commit + tag + push, the `finally` block in
   `withReleaseSession` deletes the session marker so subsequent commits
   start from a clean session state.

If a prior release crashed mid-flow and left a stale `release-automation`
marker behind, the helper overwrites it with a fresh `startedAt` on the next
run (crash-recovery branch). If an active `/gate` session marker is present
(any non-release-automation path), the helper throws with a clear error
naming the marker path and the recovery command (`rm .noldor/session.json`).

## PRs

<!-- @prs-since-last-release: release-script-self-provisions-its-own-session-marker -->

## Changelog

<!-- generated: resources -->

## Resources

- **Code:**
  - [`scripts/hooks/noldor-pre-commit.ts`](../../scripts/hooks/noldor-pre-commit.ts)
  - [`scripts/noldor/session.ts`](../../scripts/noldor/session.ts)
  - [`scripts/release/index.ts`](../../scripts/release/index.ts)

<!-- /generated: resources -->
