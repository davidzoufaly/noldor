---
area: tooling
category: Tooling
deps:
  - pendev-ui-design-phase
entry-id: Q-0145
links:
  code:
    - src/cr/lanes/ui-review.ts
    - src/cr/lanes/ui-review-dispatch.ts
    - src/cr/findings-schema.ts
    - src/cr/filename.ts
    - src/cr/orchestrate.ts
    - src/core/lanes.ts
    - src/core/agent-runner/types.ts
    - src/core/config.ts
  tests:
    - src/cr/__tests__/lanes/ui-review-dispatch.test.ts
    - src/cr/__tests__/lanes/ui-review.test.ts
name: UI-Design Review Lane
packages:
  - package.json
phase: in-progress
since: 2026-08-19T00:00:00.000Z
noldor-tier: specs-only
---
## Summary

Second slice of Q-0144 (pen.dev UI Design Phase, shipped in PR #342): a code-stage CR lane, `ui-reviewer`, that checks the implemented UI against the feature's committed `.pen` design. It mirrors the `reviewer` lane's dispatch shape — the lane resolves the `.pen` path and the affected surfaces, and the dispatched child opens the design itself through pencil MCP (Node cannot read an encrypted `.pen`), compares it against the diff, and returns a verdict the lane writes into a standard lane sink beside the codex and verifier lanes. Fires on the same `consumer.uiPaths` predicate the design stage uses, recomputed from the real diff; non-UI and waived sessions get an explicit `not-applicable` sink, and a session whose design cannot be read gets `cannot-review` rather than a green. Advisory by default, blocking behind one config knob. Mechanical render-compare (screenshot diff against a running app) is out of scope — tracked as Q-0146.

## User Story

As an agent shipping a UI-bearing feature, I want the code-stage CR to compare what I built against the design my session approved, so that implementation drift is caught before merge instead of being silently ratified by a baseline written from the as-built UI.

## Usage

Opt in per consumer in `.noldor/config.json`:

```json
{
  "crLanes": { "code": ["reviewer", "verifier", "ui-reviewer"] },
  "autonomous": { "uiReviewMode": "advisory" },
  "agents": { "roles": { "ui-reviewer": { "runner": "claude" } } }
}
```

The ordinary code-stage round then runs it:

```
pnpm noldor cr orchestrate --slug <slug> --artifact <code-paths> --kind code \
  --lanes reviewer,ui-reviewer --base-sha origin/main
pnpm noldor cr aggregate --slug <slug> --kind code
```

Sink: `.noldor/cr/<slug>-code-ui-reviewer.json`. Read `verdict` before `blockers`: `not-applicable` means the round had no UI to review, `cannot-review` means no comparison happened and `reason` names the class. Flip `uiReviewMode` to `blocking` once your reviewer runners are pencil-capable.

## PRs

<!-- @prs-since-last-release: ui-design-review-lane -->

## Changelog
