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
    - src/cr/lanes/ui-design-resolve.ts
    - src/cr/lanes/render-compare.ts
    - src/cr/lanes/render-compare-core.ts
    - src/cr/lanes/render-export-dispatch.ts
    - src/cr/lanes/pen-scratch.ts
    - src/cr/lanes/prompt-parts.ts
    - src/cr/lane-spawn.ts
    - src/cr/lane-mode.ts
    - src/cr/extract-json.ts
    - src/cr/findings-schema.ts
    - src/cr/filename.ts
    - src/cr/orchestrate.ts
    - src/core/lanes.ts
    - src/core/agent-runner/types.ts
    - src/core/config.ts
    - src/core/consumer-config.ts
    - src/core/ui-boot.ts
    - src/verify/boot.ts
    - src/core/err-message.ts
  tests:
    - src/core/__tests__/err-message.test.ts
    - src/cr/__tests__/lanes/render-compare-core.test.ts
    - src/cr/__tests__/lanes/render-compare.test.ts
    - src/cr/__tests__/lanes/ui-review-dispatch.test.ts
    - src/cr/__tests__/lanes/ui-review.test.ts
name: UI-Design Review Lane
packages:
  - package.json
phase: in-progress
since: 2026-08-19T00:00:00.000Z
noldor-tier: specs-only
introduced: 1.4.0
updated: 1.5.0
---
## Summary

Second slice of Q-0144 (pen.dev UI Design Phase, shipped in PR #342): a code-stage CR lane, `ui-reviewer`, that checks the implemented UI against the feature's committed `.pen` design. It mirrors the `reviewer` lane's dispatch shape — the lane resolves the `.pen` path and the affected surfaces, and the dispatched child opens the design itself through pencil MCP (Node cannot read an encrypted `.pen`), compares it against the diff, and returns a verdict the lane writes into a standard lane sink beside the codex and verifier lanes. Fires on the same `consumer.uiPaths` predicate the design stage uses, recomputed from the real diff; non-UI and waived sessions get an explicit `not-applicable` sink, and a session whose design cannot be read gets `cannot-review` rather than a green. Advisory by default, blocking behind one config knob. Mechanical render-compare (screenshot diff against a running app) ships as the sibling `render-compare` lane — the Q-0146 enhancement described under Usage.

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

Under `advisory` a `fail` lands as `low` suggestions rather than blockers; under `blocking` it blocks with the severities the reviewer assigned. A design file that changes during its own review (`reason: pen-modified`) blocks in both modes.

The lane is code-only — passing it at `--kind spec` or `--kind plan` is rejected at entry — and it is excluded from the empty-diff short-circuit, so it re-runs on every code round instead of inheriting a prior green.

**Render-compare (mechanical sibling, Q-0146 enhancement).** The `render-compare` lane boots the app and pixel-diffs each affected surface's real route against the surface's selected `FINAL:` page — deterministic, no dispatched judgment (its one agent role, `render-compare`, only exports the design to PNG through pencil MCP). Declare a per-surface recipe and opt in:

```json
{
  "consumer": {
    "uiSurfaces": { "dashboard": ["src/dashboard/**"] },
    "verifyCommands": {
      "dashboard": { "command": "pnpm dev --port {port}", "kind": "server", "healthPath": "/" }
    },
    "uiBoot": {
      "dashboard": {
        "verifyCommand": "dashboard",
        "route": "/",
        "page": "overview",
        "screenshotCommand": "pnpm exec playwright screenshot --viewport-size={width},{height} {url} {out}",
        "maxDiffRatio": 0.25
      }
    }
  },
  "crLanes": { "code": ["reviewer", "render-compare"] },
  "autonomous": { "renderCompareMode": "advisory" }
}
```

Sink: `.noldor/cr/<slug>-code-render-compare.json`. Every affected surface gets its own outcome row (a recipe-less surface is `no-boot-recipe`, so partial coverage never reads `pass`); the top verdict is the worst by `fail` > `cannot-review` > `pass`, and `reason` is the headline class. A surface fails when `diffRatio > maxDiffRatio` (severity `high` past 2×). On a `fail`, open the persisted images under `.noldor/cr/render-compare/<slug>/` before arguing with the ratio. `renderCompareMode` mirrors `uiReviewMode` (advisory default, `pen-modified` reds in both modes); when the `verifier` lane shares the round, render-compare starts only after it resolves. The export path needs a running VS Code window with the Pencil extension, so headless CI degrades to `cannot-review` (`export-failed`) honestly.

## PRs

<!-- @prs-since-last-release: ui-design-review-lane -->

## Changelog

### 1.5.0

#### Summary

This release adds the render-compare lane, which boots the app and pixel-diffs routes against the session's .pen (#366).

#### PRs

- #366: add the render-compare lane — boot the app and pixel-diff routes against the session's .pen ([link](https://github.com/davidzoufaly/noldor/pull/366))

### Initial Release (v1.4.0)

#### Summary

This release adds the ui-reviewer lane, a design-fidelity review that checks work against the session's `.pen` (#343).

#### PRs

- #343: add the ui-reviewer lane — design-fidelity review against the session's .pen ([link](https://github.com/davidzoufaly/noldor/pull/343))

<!-- generated: resources -->

## Resources

- **Code:**
  - [`src/cr/lanes/ui-review.ts`](../../src/cr/lanes/ui-review.ts)
  - [`src/cr/lanes/ui-review-dispatch.ts`](../../src/cr/lanes/ui-review-dispatch.ts)
  - [`src/cr/lanes/ui-design-resolve.ts`](../../src/cr/lanes/ui-design-resolve.ts)
  - [`src/cr/lanes/render-compare.ts`](../../src/cr/lanes/render-compare.ts)
  - [`src/cr/lanes/render-compare-core.ts`](../../src/cr/lanes/render-compare-core.ts)
  - [`src/cr/lanes/render-export-dispatch.ts`](../../src/cr/lanes/render-export-dispatch.ts)
  - [`src/cr/lanes/pen-scratch.ts`](../../src/cr/lanes/pen-scratch.ts)
  - [`src/cr/lanes/prompt-parts.ts`](../../src/cr/lanes/prompt-parts.ts)
  - [`src/cr/lane-spawn.ts`](../../src/cr/lane-spawn.ts)
  - [`src/cr/lane-mode.ts`](../../src/cr/lane-mode.ts)
  - [`src/cr/extract-json.ts`](../../src/cr/extract-json.ts)
  - [`src/cr/findings-schema.ts`](../../src/cr/findings-schema.ts)
  - [`src/cr/filename.ts`](../../src/cr/filename.ts)
  - [`src/cr/orchestrate.ts`](../../src/cr/orchestrate.ts)
  - [`src/core/lanes.ts`](../../src/core/lanes.ts)
  - [`src/core/agent-runner/types.ts`](../../src/core/agent-runner/types.ts)
  - [`src/core/config.ts`](../../src/core/config.ts)
  - [`src/core/consumer-config.ts`](../../src/core/consumer-config.ts)
  - [`src/core/ui-boot.ts`](../../src/core/ui-boot.ts)
  - [`src/verify/boot.ts`](../../src/verify/boot.ts)
  - [`src/core/err-message.ts`](../../src/core/err-message.ts)
- **Tests:**
  - [`src/core/__tests__/err-message.test.ts`](../../src/core/__tests__/err-message.test.ts)
  - [`src/cr/__tests__/lanes/render-compare-core.test.ts`](../../src/cr/__tests__/lanes/render-compare-core.test.ts)
  - [`src/cr/__tests__/lanes/render-compare.test.ts`](../../src/cr/__tests__/lanes/render-compare.test.ts)
  - [`src/cr/__tests__/lanes/ui-review-dispatch.test.ts`](../../src/cr/__tests__/lanes/ui-review-dispatch.test.ts)
  - [`src/cr/__tests__/lanes/ui-review.test.ts`](../../src/cr/__tests__/lanes/ui-review.test.ts)

<!-- /generated: resources -->
