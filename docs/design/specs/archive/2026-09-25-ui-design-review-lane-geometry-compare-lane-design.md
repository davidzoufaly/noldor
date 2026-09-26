# Geometry Compare Lane (the Automated Half) — Design

**Slug:** ui-design-review-lane
**FD:** docs/features/ui-design-review-lane.md
**Date:** 2026-09-25
**Tier:** full
**Deps:** pendev-ui-design-phase
**Entry:** Q-0180 (split from Q-0145)

UI verdict: skip — this repo declares no `consumer.uiPaths`; the change is framework code under
`src/` and `templates/`, not a rendered surface.

Architecture verdict: skip — every new file lands inside a module the baseline already draws
(`src/cr`, `src/core`, `templates/`); no new package, external, or cross-module arrow.

## Problem

The `render-compare` lane pixel-diffs a booted route against its `FINAL:` design page. That is the
right instrument only where the design can express what the implementation paints, and on real UI it
often cannot: pen has no equivalent for SVG filters, shader output, or platform text rendering. The
first consumer to enable the lane shows the cost. charuy runs `crLanes.code: ["reviewer",
"render-compare"]` with `maxDiffRatio: 0.25` on its one surface — a quarter of the pixels may differ
before the lane objects, which is loose enough to pass most real layout regressions and still the
setting a faithful implementation needs to stop reading red.

What survives the paint mismatch is layout: alignment, font size, and spacing. The comparison engine
for that already shipped (PR #383): `geometryDocSchema` in
[`src/cr/geometry/geometry-doc.ts`](../../../src/cr/geometry/geometry-doc.ts) and the covering test
in [`src/cr/geometry/geometry-compare-core.ts`](../../../src/cr/geometry/geometry-compare-core.ts),
reachable by hand as `design geometry-validate` and `design geometry-diff`. Nothing produces the two
documents those commands compare, and no lane runs them. An operator who wants the signal has to
hand-write both JSON files, which nobody does, so the engine has no users.

## Goals

- A second verification mode, `geometry-compare`, that runs **beside** pixel comparison and checks
  element alignment, font size, and margins/paddings between the session's `.pen` and the booted
  implementation. It is not pixel-diff with loose thresholds; its tolerances are in CSS pixels on
  layout values, and pixel matching stays reserved for surfaces where it holds.
- Automate both sides of the shipped engine: a pencil-MCP child that reads a `FINAL:` page's resolved
  geometry, and a consumer-owned capture command (with a scaffolded Playwright reference) that writes
  the implementation document.
- Hand-runnable at every step before the lane exists: `design geometry-export` (design side) and
  `design geometry-review` (one surface, end to end) so each piece is usable and testable alone.
- A code-stage lane that opts in through `crLanes.code`, shares the design-lane skeleton with
  `render-compare`, and writes a standard `LaneFindings` sink.

## Non-goals

- Replacing or retuning `render-compare`. Consumers can run either lane or both.
- Per-element pairing between design nodes and DOM nodes. The shipped engine compares value
  populations; pairing is a later upgrade (see Risks).
- Changing the comparison semantics PR #383 shipped — families, tolerances, budgets, one-directional
  spacing. This spec consumes them.
- Sharing one app boot between `render-compare` and `geometry-compare` in the same round.
- Enabling the lane in charuy. Adoption is the consumer's config edit; this spec ships what they
  enable.

## Design

### Structural context

The lane work lands in graph community c3 — the booting design lanes (`render-compare.ts`,
`pen-scratch.ts`, `verify.ts`, `ui-review.ts`, and `src/core/ui-boot.ts`), owned mostly by
`acceptance-verify-lane` and `ui-design-review-lane`. Its cross-community edges are the ones the lane
must touch anyway: `orchestrate.ts` and `lanes.ts` (c13, lane registration), `findings-schema.ts`
(c16, reason codes), and `consumer-config.ts` (c82). `consumer-config.ts` defines the repo's #4 god
node, `loadConsumerConfig()` (41 edges), so the recipe-schema change in D2 is the one edit with wide
blast radius — it must stay additive. The design-side child joins community c67 beside
`render-export-dispatch.ts` and `ui-review-dispatch.ts`. The shipped engine
(`geometry-compare-core.ts`, c21) is an interior file: no god node, no bridge.

### D1 — Carry forward the August plan, drift-fixed

The August spec for this lane (archived at
`docs/design/specs/archive/2026-08-25-ui-design-review-lane-geometry-compare-design.md`) went through
three review rounds, and its plan parts 3–6 were written and reviewed before the lane was parked.
They are recovered from PR #383's head (`refs/pull/383/head`, commit `3ce77e3`). This spec re-states
the decisions that still hold, fixes the ones the shipped code superseded, and names the drift a
month of other work introduced. The plan stage then carries parts 3–6 forward with a drift-fix pass
rather than re-planning; D8 lists the drift.

### D2 — Recipe config and the reference capture script

`UiBootRecipeSchema` in [`src/core/consumer-config.ts`](../../../src/core/consumer-config.ts) gains
an optional `geometryCommand` template (placeholders `{url}`, `{out}`, `{width}`, `{height}`) and
optional `geometryTolerance` / `geometryBudget` records keyed by the four shipped families —
`edgesX`, `edgesY`, `fontSize`, `spacing` (`GEOMETRY_FAMILIES`), each partial, defaults from
`DEFAULT_TOLERANCE` / `DEFAULT_BUDGET`. One recipe per surface serves both lanes. `screenshotCommand`
becomes optional; a recipe must carry at least one capture command. `render-compare` reports
`no-boot-recipe` for a recipe with no `screenshotCommand`, and this lane reports `no-geometry-recipe`
for one with no `geometryCommand`.

`screenshotTemplateIssues` in [`src/core/ui-boot.ts`](../../../src/core/ui-boot.ts) takes the field
label as a parameter so a bad `geometryCommand` is rejected naming the right key; substitution reuses
`substituteScreenshotCommand` unchanged so the quoting guard cannot lapse.

The framework ships `templates/scripts/geometry-capture.mjs`, a Playwright walk that writes a
`geometryDocSchema` document, as a scaffold-only template (`SCAFFOLD_ONLY_TEMPLATES`): `init` lands
it once and the consumer owns it. The browser dependency stays in the consumer's `package.json`.

### D3 — Design-side extraction: `geometry-extract` and `design geometry-export`

A dispatched pencil-MCP child, `src/cr/lanes/geometry-extract-dispatch.ts`, built on
`createAnswerSeam` the way
[`render-export-dispatch.ts`](../../../src/cr/lanes/render-export-dispatch.ts) is: the child
enumerates `FINAL:` candidates and Node selects with `selectFinalPage`. It reads resolved geometry
from the `Get` visitor's `ctx.bounds`, absolutized up `parentCtx` inside the callback, made
page-relative, with `resolveVariables: true`. It maps pen types to `kind`, normalizes `gap` /
`padding` into `spacing`, **emits non-empty `text` on every `kind: 'text'` node** (the shipped schema
requires it — without it every text-bearing surface lands `geometry-unparseable`), excludes nodes
with `ctx.problems` and lists them in a separate report. A new agent-runner role `geometry-extract`
lets a consumer pin it to a pencil-capable runner. `pnpm noldor design geometry-export --pen <f>
--surface <s> --out <doc.json>` drives one surface.

### D4 — One-surface review: `design geometry-review`

`reviewSurfaceGeometry` composes design read → capture → `compareGeometry` for one surface against a
URL it is given, returning per-family outcomes or a decline with a reason code. It boots nothing,
which makes it hand-runnable (`pnpm noldor design geometry-review --pen <f> --surface <s> --url <u>
--capture <tpl>`) and reusable by the lane. Two pieces of `render-compare` are lifted rather than
copied: the atomic evidence-directory swap and the per-`verifyCommand` boot-and-route-probe loop
(`runCapture` is already shared); `aggregateOutcomes` becomes generic over the outcome payload.

### D5 — The lane

`src/cr/lanes/geometry-compare.ts` is an orchestration shell over `reviewSurfaceGeometry`:
`openDesignReviewRound` from [`pen-scratch.ts`](../../../src/cr/lanes/pen-scratch.ts) opens the round
with `geometryCompareMode`, the boot loop supplies URLs once per `verifyCommand` group, and the
generic `aggregateOutcomes` picks the verdict (`fail` > `cannot-review` > `pass`, `pen-modified`
absolute). Registration: `geometry-compare` in `CANONICAL_LANES`
([`src/core/lanes.ts`](../../../src/core/lanes.ts)), `geometryCompareMode` (fail-soft `advisory`
default) in [`src/cr/lane-mode.ts`](../../../src/cr/lane-mode.ts) and the `autonomous` config block,
the runner map / no-delta set / code-only list in [`src/cr/orchestrate.ts`](../../../src/cr/orchestrate.ts).
Booting lanes run in sequence — `verifier` → `render-compare` → `geometry-compare` — so two dev
servers never contend on one build cache.

### D6 — Outcomes and reason codes

An ordinary layout mismatch is a `fail` with one finding per failing family naming the unmatched
values and the evidence path; severity is `med` for 1–2 unmatched values and `high` for 3+; the mode
matrix routes findings to `blockers` (blocking) or `suggestions` (advisory) via `writeFailByMode`.
Six reason codes join `laneReasonCodeSchema` for rounds that could not compare:
`no-geometry-recipe`, `geometry-extract-failed`, `geometry-capture-failed`, `geometry-unparseable`,
`geometry-empty`, `viewport-mismatch`. Existing codes carry over.

### D7 — Evidence

Per round, `.noldor/cr/geometry-compare/<slug>/<sanitized>.design.json`, `.impl.json`, and
`.report.json` (every value, and for each unmatched one its family, side, and producing nodes),
joined through `sanitizeSurfaceName`. A round that produces no documents leaves the prior evidence in
place; a round whose evidence cannot be persisted is `persist-failed`.

### D8 — Drift from the August plan

An audit of every code reference in parts 3–6 against current `main` found the architecture,
ordering, registration list, and reason codes still right. What moved, and what the plan pass fixes:

- **Dispatch seam replaced.** `createDispatcherSeam`, `parseFencedJson`, and `fencedJsonInstruction`
  are gone. The child goes through `createAnswerSeam`
  ([`src/cr/lane-spawn.ts`](../../../src/cr/lane-spawn.ts)) with a `LaneAnswerContract` (`lane`,
  `shape`, `schema`, `repairPrompt`) and an `AnswerLocation` (`repoRoot`, `slug`, `kind`), returning a
  `LaneAnswer<T>` the caller branches on — modelled on `render-export-dispatch.ts`.
- **CLI slug.** `geometry-export` and `geometry-review` run outside a CR round, so they have no slug
  for an `AnswerLocation`. Both take an optional `--slug`, defaulting to a fixed `geometry-adhoc`
  minted through `parseSlug`.
- **Family keys.** The recipe's `geometryTolerance` / `geometryBudget` use the four shipped keys
  (`edgesX`, `edgesY`, `fontSize`, `spacing`), not the plan's three (`edges`, `fontSize`, `spacing`).
- **Node text.** The extraction walk returns pen's text content and the child's rules require it
  non-empty; a pen text node with empty content maps to `kind: 'shape'`.
- **Severity.** `FamilyOutcome` deliberately carries no severity; the lane derives it (`med` at 1–2
  unmatched values, `high` at 3+).
- **Surface name reaches the capture script.** The script reads `NOLDOR_GEOMETRY_SURFACE`;
  `runCapture` ([`src/core/run-capture.ts`](../../../src/core/run-capture.ts)) gains an optional env
  argument and both the CLI and the lane set it. Without it every surface not named `app` fails the
  surface check as `geometry-unparseable`.
- **Viewport.** The script reports the viewport it set (`{width}` × `{height}`), not `<body>`'s box,
  which is shorter than the design page on any non-full-height route.
- **Playwright loads lazily.** The script parses its arguments first and then `await
  import('playwright')`, so a usage error prints without the browser dependency installed.
- **Already lifted.** `runCapture` already lives in `src/core/run-capture.ts`; that plan step drops.
- **Shared boot helper.** The plan copies ~120 lines of `render-compare`'s boot and route-probe loop,
  including a single-request probe where `render-compare` retries within `routeProbeBudgetMs`. Part 5
  lifts one shared per-`verifyCommand` boot-and-probe helper beside the evidence swap instead.
- **Mode-key type.** `openDesignReviewRound` types its mode key as `'uiReviewMode' |
  'renderCompareMode'`; it widens alongside `lane-mode.ts`.
- **Report names nodes.** `compareGeometry` returns bare values. The lane's report builder maps each
  unmatched value back to the nodes that produced it by re-scanning that side's document, so the
  shipped core stays unchanged.
- **Mechanical.** New test files start with `// @tests: ui-design-review-lane`; CLIs use
  `readValueFlags` ([`src/core/cli-entry.ts`](../../../src/core/cli-entry.ts)); the orchestrate runner
  map is `LANES`; `cr-pipeline.md` uses H2 lane sections and its judge-exclusion list gains the lane;
  `adoption-guide.md`'s `uiBoot` row and both twins are updated; docs describe the covering test, not
  clustering; new import edges re-record the indirection baseline in their own commit.

The August spec's own inconsistencies resolve toward the shipped code: its AC7 describes clustering
and optimal matching where the core runs a linear covering test, and its AC10 and Usage key budgets as
`edges`.

## Acceptance criteria

1. `geometry-compare` is a valid `crLanes.code` lane; `geometryCompareMode` reads `blocking |
   advisory` with a fail-soft `advisory` default; the sink lands at
   `.noldor/cr/<slug>-code-geometry-compare.json` in the standard `LaneFindings` shape.
2. A round containing `verifier`, `render-compare`, and `geometry-compare` runs the booting lanes
   one after another, never two at once.
3. `validate noldor-config` rejects a `geometryCommand` missing a placeholder or containing a quote,
   naming `geometryCommand`; rejects a recipe with neither capture command; accepts a recipe with
   only `geometryCommand`; and rejects a `geometryTolerance` / `geometryBudget` key outside the four
   families.
4. `render-compare` reports `no-boot-recipe` for a surface whose recipe has no `screenshotCommand`;
   `geometry-compare` reports `no-geometry-recipe` for one with no `geometryCommand`.
5. `noldor init` scaffolds `scripts/geometry-capture.mjs` once and `doctor` / `template-sync` never
   flag a consumer's edits to it.
6. `design geometry-export` writes a document that passes `design geometry-validate` for a `.pen`
   whose `FINAL:` page contains text, frames under vertical and horizontal layout, and padding in all
   three pen forms; a clipped design node is absent from the document and named in the report.
7. `design geometry-review` against a running URL exits 0 with per-family outcomes on a match and
   non-zero naming the failing family on drift, without booting anything — for a surface of any
   name, not only `app`.
8. Moving one node's left edge past the `edgesX` tolerance fails `edgesX` at the default budget and
   the finding names the value and the nodes behind it; raising that surface's `geometryBudget.edgesX`
   to the unmatched count passes it.
9. Either side reporting zero nodes yields `geometry-empty`; viewports differing by more than 1px
   yield `viewport-mismatch`; each is `cannot-review`, never `pass`.
10. The design file's hash changing during the round yields `pen-modified` regardless of every other
    outcome.
11. A surface failing two families emits two findings, in `blockers` under blocking mode and in
    `suggestions` (exit 0) under advisory mode.
12. A round that produced no documents leaves the prior round's evidence intact; evidence paths are
    joined through `sanitizeSurfaceName`.

## Risks / trade-offs

The shipped engine compares value populations, so a node that moves onto an alignment value the
surface already uses is invisible; the lane claims drift in the population of layout values, not
per-element position. Pairing closes that gap later; the document already carries pen layer names.

Spacing is one-directional: an implementation that gains `padding: 40` the design never declared is
invisible. That is the price of not failing on UA-default margins and negative gutters.

Running both design lanes costs two app boots per round (charuy's `readyTimeoutMs` is 180 s). Sharing
a boot needs orchestrate-level coordination; accepted and named.

The capture script is scaffold-only, so a later `geometryDocSchema` change cannot reach a consumer
through `init --update`. Schema changes stay additive; boundary validation turns a stale producer
into `geometry-unparseable`, not a wrong comparison.

Carrying the August plan forward risks importing a stale assumption the drift pass misses. The
code-stage review reads the real diff, and each part lands a hand-runnable command whose tests run
against current code, so a stale step fails loudly at implementation time.

## User Story

As an operator shipping UI whose design cannot be pixel-faithful, I want a lane that compares element
alignment, font sizes, and spacing between my `.pen` design and the booted implementation — as a
second check beside pixel comparison — so that I get a real layout-drift signal instead of a
pixel-diff threshold loose enough to hide it.

## Usage

Opt in per repo, alongside `render-compare` or instead of it:

```jsonc
{
  "crLanes": { "code": ["reviewer", "render-compare", "geometry-compare"] },
  "autonomous": { "geometryCompareMode": "advisory" },
  "consumer": {
    "uiBoot": {
      "app": {
        "verifyCommand": "web",
        "route": "/",
        "page": "default — dark",
        "screenshotCommand": "…",
        "geometryCommand": "node scripts/geometry-capture.mjs {url} {out} {width} {height}",
        "geometryBudget": { "edgesX": 0, "edgesY": 0, "fontSize": 0, "spacing": 0 }
      }
    }
  }
}
```

By hand, before or without the lane:

```
pnpm noldor design geometry-export --pen docs/design/ui/<file>.pen --surface app --out design.json
NOLDOR_GEOMETRY_SURFACE=app node scripts/geometry-capture.mjs http://localhost:5173/ impl.json 1440 900
pnpm noldor design geometry-diff design.json impl.json --surface app
pnpm noldor design geometry-review --pen docs/design/ui/<file>.pen --surface app --url http://localhost:5173/ --capture "node scripts/geometry-capture.mjs {url} {out} {width} {height}"
```

Sink: `.noldor/cr/<slug>-code-geometry-compare.json`. Evidence:
`.noldor/cr/geometry-compare/<slug>/<surface>.report.json` lists the nodes behind every unmatched
value.

## Open questions (resolved)

1. *Re-plan from scratch, or carry the August parts 3–6 forward?* -> Carry forward with a drift-fix
   pass (D1). They survived review, their tests pin behaviour against current code, and re-planning
   would re-derive decisions the shipped engine already fixed.
2. *Default mode?* -> `advisory` (D5). A new lane on a first consumer should report before it blocks;
   `render-compare` started the same way.
3. *Share one boot with `render-compare`?* -> No (Risks). Needs orchestrate-level coordination this
   scope does not have.
4. *Verify against charuy as part of this feature?* -> Yes, as a manual check at ship time, not an
   acceptance criterion: charuy has the recipe fields, Playwright, and a baseline `.pen`, so one
   `design geometry-review` run there proves the automation end to end. The design side needs pencil
   MCP, which connects only in a terminal Claude Code session; when it is unreachable at ship time,
   the run is skipped loudly and recorded as debt rather than blocking the ship. Enabling the lane in
   charuy's config stays the consumer's call.
