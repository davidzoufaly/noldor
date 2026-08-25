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
    - src/cr/geometry/geometry-compare-core.ts
    - src/cr/geometry/geometry-diff-cli.ts
    - src/cr/geometry/geometry-doc.ts
    - src/cr/geometry/geometry-validate-cli.ts
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
    - src/cr/__tests__/geometry/geometry-compare-core.test.ts
    - src/cr/__tests__/geometry/geometry-diff-cli.test.ts
    - src/cr/__tests__/geometry/geometry-doc.test.ts
    - src/cr/__tests__/geometry/geometry-validate-cli.test.ts
    - src/cr/__tests__/lanes/render-compare-core.test.ts
    - src/cr/__tests__/lanes/render-compare.test.ts
    - src/cr/__tests__/lanes/ui-review-dispatch.test.ts
    - src/cr/__tests__/lanes/ui-review.test.ts
name: UI-Design Review Lane
packages:
  - package.json
phase: done
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

**Geometry compare (layout, Q-0180 enhancement).** Pixel-diff is the wrong instrument whenever the design cannot express what the implementation renders — SVG-driven effects, shaders, generated artwork, platform text — because a faithful implementation then reads as a large `diffRatio` and no `maxDiffRatio` setting separates that from a real regression. What survives the mismatch is layout, so two commands compare *layout values* instead of paint:

```bash
# Does my capture script emit a conformant document?
pnpm noldor design geometry-validate impl.json --side impl --surface dashboard

# What drifted between the design and the implementation?
pnpm noldor design geometry-diff design.json impl.json --surface dashboard
```

Both take normalized geometry documents (`geometryDocSchema` in [`src/cr/geometry/geometry-doc.ts`](../../src/cr/geometry/geometry-doc.ts)) — no pen, no browser, no lane involved. Three families are compared. Each side's values collapse into representatives — a cluster admits a value only while the cluster's own WIDTH stays inside the family tolerance (`edges` 2px, `fontSize` 1px, `spacing` 1px), so linkage cannot chain a representative away from the values it speaks for — and the two representative lists are matched by a single order-preserving forward scan, which on sorted lists is already maximum-cardinality optimal. Closest-pair greedy is not: design `{0,3}` against impl `{2,5}` at tolerance 2 matches fully, but taking the smallest difference first pairs 3 with 2 and invents two unmatched values. What is left over is the verdict, against a per-family budget defaulting to 0:

- **`edges`** — every box's `x`/`x+w` clustered on one axis and `y`/`y+h` on the other. Counted in **both** directions, unlike spacing: an implementation-only edge is the signal the whole comparison exists for, and a wrapper element shares its child's box, so wrapper stacks collapse into the same representative rather than accumulating. A surface that genuinely gains edges the design never had — a scrollbar, a truncation — is what `geometryBudget.edges` is for. A card offset from its siblings by MORE than the tolerance shows up here and nowhere else — clustering starts a new cluster only past the tolerance, so an offset of exactly 2px still clusters with its siblings and passes.
- **`fontSize`** — values from text-bearing nodes only, so an inherited wrapper `font-size` never enters the population.
- **`spacing`** — declared `rowGap`/`columnGap`/`padding`, compared **design-only**: an implementation `margin: 16` can satisfy a design `gap: 16` (pen has no margin property), while UA-stylesheet margins on `h1`/`p`/`ul` and negative gutters cannot fail anything.

Exit 0 within budget, 1 on drift, 2 when a document could not be read or parsed. The blind spot is deliberate and worth knowing: a node that relocates onto an alignment value the surface already uses moves no value into or out of either set, so moving a card between two columns of the same grid is invisible while moving it two pixels off one is caught. The lane that runs this per surface against a booted app is parked as roadmap entry `Q-0180`; the design of record for it is `docs/design/specs/archive/2026-08-25-ui-design-review-lane-geometry-compare-design.md`.

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
  - [`src/cr/geometry/geometry-compare-core.ts`](../../src/cr/geometry/geometry-compare-core.ts)
  - [`src/cr/geometry/geometry-diff-cli.ts`](../../src/cr/geometry/geometry-diff-cli.ts)
  - [`src/cr/geometry/geometry-doc.ts`](../../src/cr/geometry/geometry-doc.ts)
  - [`src/cr/geometry/geometry-validate-cli.ts`](../../src/cr/geometry/geometry-validate-cli.ts)
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
  - [`src/cr/__tests__/geometry/geometry-compare-core.test.ts`](../../src/cr/__tests__/geometry/geometry-compare-core.test.ts)
  - [`src/cr/__tests__/geometry/geometry-diff-cli.test.ts`](../../src/cr/__tests__/geometry/geometry-diff-cli.test.ts)
  - [`src/cr/__tests__/geometry/geometry-doc.test.ts`](../../src/cr/__tests__/geometry/geometry-doc.test.ts)
  - [`src/cr/__tests__/geometry/geometry-validate-cli.test.ts`](../../src/cr/__tests__/geometry/geometry-validate-cli.test.ts)
  - [`src/cr/__tests__/lanes/render-compare-core.test.ts`](../../src/cr/__tests__/lanes/render-compare-core.test.ts)
  - [`src/cr/__tests__/lanes/render-compare.test.ts`](../../src/cr/__tests__/lanes/render-compare.test.ts)
  - [`src/cr/__tests__/lanes/ui-review-dispatch.test.ts`](../../src/cr/__tests__/lanes/ui-review-dispatch.test.ts)
  - [`src/cr/__tests__/lanes/ui-review.test.ts`](../../src/cr/__tests__/lanes/ui-review.test.ts)

<!-- /generated: resources -->
