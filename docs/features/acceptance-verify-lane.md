---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/cr/
    - src/core/consumer-config.ts
    - src/autonomous/
    - docs/noldor/cr-pipeline.md
    - adoption-guide.md
    - .noldor/config.json
  tests: []
  spec: >-
    docs/superpowers/specs/2026-06-12-acceptance-verify-lane-design.md
name: Acceptance-Verify Lane
packages:
  - scripts
phase: in-progress
noldor-tier: full
---

## Summary

Autonomous paths merge on tests + CR. Both have a structural blind spot: the implementer agent writes the code _and_ the tests, so a misunderstood requirement produces tests that assert the misunderstanding — green suite, wrong feature. CR reads diffs and can ratify the same error. Nobody runs the artifact and checks it against what the FD/entry actually promised. Add a `verify` lane: an independent agent that boots the real artifact and judges the shipped behavior against the acceptance text.

**What to do:**

- Lane plumbing: extend the `crLanes` config vocabulary with a `verify` lane kind for `code` artifacts (`"code": ["subagent", "verify"]`), riding the existing lane-runner machinery in `src/cr/` — same verdict-artifact pattern into `.noldor/cr/`, same orchestrate consumption, so the drain merge gate gets it for free.
- Verify agent contract: input = FD acceptance criteria / Usage section (or the roadmap-entry prose for FD-less fast-tracks) + the diff + boot instructions; it must (1) start the artifact, (2) exercise the _specific new behavior_ through the real interface — CLI invocation, HTTP request, file output — never by reading the code, (3) compare observed vs promised, (4) emit verdict `{ pass | fail | cannot-verify, evidence: [command + observed output], mismatches: [] }`. `cannot-verify` is an honest first-class outcome (no boot path, behavior needs external services) and routes to advisory, not silent pass.
- Boot knowledge: new consumer-config block `verifyCommands` — named run surfaces (`{ "dashboard": "pnpm noldor dashboard server --port {port}", "cli": "pnpm noldor {args}" }`) + health-check hints. Self-host config seeds dashboard + CLI entries.
- Smoke floor (sub-item, ships first): a fixed, feature-agnostic pre-merge check for autonomous paths — `noldor doctor` + boot each `verifyCommands` surface + HTTP 200/exit-0 probe. Catches "build broken / server 500s" for S-effort before the per-FD lane lands.
- Policy: blocking vs advisory per consumer (`autonomous.verifyMode: "blocking" | "advisory"`, default advisory for one bake-in release, then flip self-host to blocking); `fail` on blocking → same flow as CR fail (`onFailure`: prompt / spawn-deep-review / abort).
- Sandboxing + hygiene: verify runs in the feature worktree on a per-tree port (worktree-discipline port convention already exists); must clean up spawned processes; wall-clock cap per verify.

**What it enables:** breaks the implementer self-confirming-test loop — the riskiest failure mode of unsupervised shipping; concrete catches of the PR-#53/#55 class ("does `/hot-zones?format=json` return the promised shape on a real server", "is `/features` actually ordered by commit date"), not just fixture assertions; raises the trust ceiling enough to make the continuous-drain-daemon responsible.

**Open questions:** judge strictness — exact-shape matching vs intent-level judgment (lean intent-level with evidence quoted, mismatches enumerated); UI-only changes without an API surface (out of scope v1 — `cannot-verify`); whether verify evidence gets attached to the PR body (probably yes — it's the best reviewer aid in the whole pipeline).

**Acceptance sketch:** seed a deliberately-wrong implementation (endpoint returns array, FD promises object) with passing self-written tests → verify lane boots server, curls endpoint, emits `fail` with quoted mismatch; honest implementation → `pass` with evidence; drain respects blocking mode.

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: acceptance-verify-lane -->

## Changelog
