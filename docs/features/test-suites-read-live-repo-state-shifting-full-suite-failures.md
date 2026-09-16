---
area: testing
category: Tooling
deps: []
entry-id: Q-0171
links:
  code:
    - src/release/run-command.ts
  tests:
    - src/release/__tests__/no-probe-spawns.test.ts
    - src/release/__tests__/run-command.test.ts
name: Test Suites Read Live Repo State — Shifting Full-Suite Failures
packages:
  - scripts
phase: done
since: 2026-08-23T00:00:00.000Z
noldor-tier: specs-only
---

## Summary

`npx vitest run` failed on a shifting set of files that each passed in isolation, so a green suite was a matter of timing. Q-0171 recorded two runs ten minutes apart on 2026-08-20 with disjoint failure sets across `sdd-report.test.ts`, `preflight.test.ts` and `route-sweep.test.ts`.

The entry blamed live `.noldor/session.json` and the dashboard port. Reading the files falsified both: `preflight.test.ts` builds a `mkdtemp` repo per test and `route-sweep.test.ts` binds `port: 0`. What reading did establish was a specific defect in one file — `src/release/preflight-probes.ts` performed unbounded external I/O (`gh --version`, `gh auth status`, `npm view`) with no seam to intercept it, driven 19 times per run, under a harness bound (10s) *shorter* than the probes' own (15s), so the probes' timeout branch was unreachable and a slow keychain killed the test instead.

**This feature fixes that one file.** Every probe now reaches the outside world through one injectable `RunCommand` (`src/release/run-command.ts`), timeout enforcement moved into `runProbe` as a per-probe budget, and a static scan keeps spawn primitives out of the probes module. Measured: 31s → ~5s alone, ~14s in the full parallel suite.

**It does not fix the full-suite flake, and does not claim to.** The residue is `git`, not `gh` — `inspectTreeState` spawns `git fetch` outside the seam (Q-0237) — and the `route-sweep.test.ts` and `sdd-report.test.ts` reds remain unexplained (Q-0238). Both were minted as follow-ups when this shipped, so retiring Q-0171 does not lose the open investigation.

## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->

## User Story

As an engineer or agent running `pnpm test`, I want a red suite to mean the code is broken rather than that the network was slow, so that I read the failure instead of retrying the run.

## Usage

No new command or UI. `pnpm test`, `pnpm verify` and `pnpm noldor release run --preflight` behave as before.

**Agent/Programmatic API**

- `runPreflight({ ..., runCommand })` — inject a `RunCommand` so the probes spawn nothing. It resolves `{ code, stdout, stderr }` and must never reject; `makeProbeContext` normalises it if it does, because a type cannot forbid a throw.
- `runPreflight({ ..., budgetMs })` — budget for one probe, shared by every command in it. A caller bounded by its own harness passes something smaller and gets a timeout row back instead of being killed mid-probe.
- `src/release/run-command.ts` exports `defaultRunCommand` (the only sanctioned spawn in the preflight path), `normalizeRunner`, and `resultFromError`.

## PRs

<!-- @prs-since-last-release: test-suites-read-live-repo-state-shifting-full-suite-failures -->

## Changelog

<!-- generated: resources -->

## Resources

- **Code:**
  - [`src/release/run-command.ts`](../../src/release/run-command.ts)
- **Tests:**
  - [`src/release/__tests__/no-probe-spawns.test.ts`](../../src/release/__tests__/no-probe-spawns.test.ts)
  - [`src/release/__tests__/run-command.test.ts`](../../src/release/__tests__/run-command.test.ts)

<!-- /generated: resources -->
