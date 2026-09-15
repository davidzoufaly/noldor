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

The full `npx vitest run` fails on a *shifting* set of files that each pass in isolation, so a green suite is currently a matter of timing. Observed twice within ten minutes on 2026-08-20: run one failed `src/garden/__tests__/sdd-report.test.ts` (2 tests), run two failed `src/release/__tests__/preflight.test.ts` + `src/dashboard/__tests__/route-sweep.test.ts` (8 tests) with sdd-report green; all three files passed together in isolation (141 tests). The common factor is tests that read live repository state — `.noldor/session.json`, which the same session's `noldor set-autonomous` rewrites mid-run, and the dashboard port — rather than a fixture. Identify which suites read live `.noldor/` state or bind a fixed port and give them a fixture or a temp root, since the alternative is that every future red suite gets retried instead of read. Deletion test: the full suite passes with a session marker present, an autonomous flag flip mid-run, and a dashboard already listening. (found 2026-08-20 draining the XS batch)

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
