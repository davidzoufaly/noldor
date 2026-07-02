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
    - docs/noldor/adoption-guide.md
    - .noldor/config.json
  tests:
    - src/cr/__tests__/lanes/verify-dispatch.test.ts
    - src/cr/__tests__/lanes/verify.test.ts
    - src/verify/__tests__/port.test.ts
    - src/verify/__tests__/smoke.test.ts
  spec: docs/superpowers/specs/archive/2026-06-12-acceptance-verify-lane-design.md
name: Acceptance-Verify Lane
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.4.0
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

As an operator running autonomous paths (drain, watch, gate autonomous mode), I want an independent verify lane that boots the shipped artifact and checks its real behavior against the FD's acceptance text, so that a misunderstood requirement with self-confirming tests cannot merge unnoticed.

## Usage

- Configure boot surfaces once per consumer in `.noldor/config.json` → `consumer.verifyCommands` (`server` surfaces get `{port}` + health probe, `cli` surfaces get exit-0 check).
- Opt the lane in: `crLanes.code: ["subagent", "verify"]`; choose policy via `autonomous.verifyMode: "advisory" | "blocking"` (default advisory — governs only the agent's intent-level judgment; the smoke floor blocks in both modes).
- Smoke floor standalone: `pnpm noldor verify smoke [--json]` — doctor + boot every surface + probe; exit 0/1.
- Full lane rides the existing flow: `pnpm noldor cr orchestrate --slug <slug> --artifact . --kind code --autonomous` → verdict sink at `.noldor/cr/<slug>-code-verify.json`; `pnpm noldor cr aggregate --slug <slug> --kind code` turns blocking failures into the escalate flow.
- Drain/watch need no flags — they inherit `crLanes.code` from config.

## PRs

<!-- @prs-since-last-release: acceptance-verify-lane -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-06-12-acceptance-verify-lane-design.md`](../../docs/superpowers/specs/archive/2026-06-12-acceptance-verify-lane-design.md)
- **Code:**
  - [`src/cr/`](../../src/cr/)
  - [`src/core/consumer-config.ts`](../../src/core/consumer-config.ts)
  - [`src/autonomous/`](../../src/autonomous/)
  - [`docs/noldor/cr-pipeline.md`](../../docs/noldor/cr-pipeline.md)
  - [`docs/noldor/adoption-guide.md`](../../docs/noldor/adoption-guide.md)
  - [`.noldor/config.json`](../../.noldor/config.json)
- **Tests:**
  - [`src/cr/__tests__/lanes/verify-dispatch.test.ts`](../../src/cr/__tests__/lanes/verify-dispatch.test.ts)
  - [`src/cr/__tests__/lanes/verify.test.ts`](../../src/cr/__tests__/lanes/verify.test.ts)
  - [`src/verify/__tests__/port.test.ts`](../../src/verify/__tests__/port.test.ts)
  - [`src/verify/__tests__/smoke.test.ts`](../../src/verify/__tests__/smoke.test.ts)

<!-- /generated: resources -->
