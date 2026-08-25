# Geometry Compare Lane — Design

**Slug:** ui-design-review-lane
**FD:** docs/features/ui-design-review-lane.md
**Date:** 2026-08-25
**Tier:** full
**Deps:** pendev-ui-design-phase

## Problem

The `render-compare` lane (Q-0146) compares a rendered route against its `FINAL:` design page by
pixel-diff. That is the right instrument only when the design can actually express what the
implementation renders. It often cannot: Pencil has no equivalent for SVG-driven effects, filters,
gradients-in-motion, or platform text rendering, so a faithful implementation reads as a large
`diffRatio` and the operator learns to ignore the lane. Raising `maxDiffRatio` until the noise stops
also raises it past every real regression, so the knob has no useful setting.

What survives that mismatch is *layout*: where elements sit relative to each other, how big the text
is, and how much space separates things. Those are the properties a design actually pins and an
implementation actually drifts on, and none of them depend on whether the paint matches. Today
there is no lane that checks them, so the framework's only mechanical design check is the one whose
signal-to-noise is worst on real UI.

## Goals

- A second mechanical comparison lane, `geometry-compare`, that reports layout drift between the
  session's `.pen` design and the booted implementation: element alignment, font sizes, and
  spacing (margins/paddings/gaps).
- Deterministic and unpaintable: the verdict must not move when colors, effects, images, or
  antialiasing change, and must move when a box shifts or text resizes.
- Reuses the design-lane skeleton already in place — `openDesignReviewRound`, `pen-scratch`
  integrity, `bootServer`/`resolvePort`, `writeFailByMode`, the closed `LaneReasonCode` vocabulary —
  so it is a sibling of `render-compare`, not a second framework.
- Consumer-owned capture: the framework ships no browser dependency, exactly as `render-compare`
  delegates screenshots to a `screenshotCommand` template.

## Non-goals

- Replacing `render-compare`. Pixel-diff stays the right tool for surfaces the design can express
  faithfully; this lane is the option for the ones it cannot.
- Per-element identity mapping between design nodes and DOM nodes. Naming every node in the design
  and every element in the DOM so they can be paired one-to-one is a large authoring burden and its
  own feature; this lane compares *populations* of layout features (see D5).
- Color, typography-family, effect, or accessibility review. `ui-reviewer` (judgment lane) already
  owns everything that needs a reader.
- Cross-viewport / responsive comparison. One viewport per surface, as `render-compare` does.

## Design

### D1 — Lane registration and mode knob

`geometry-compare` joins `CANONICAL_LANES` in [`src/core/lanes.ts`](../../../src/core/lanes.ts) as a
code-only lane, and `geometryCompareMode` joins the mode-key union in
[`src/cr/lane-mode.ts`](../../../src/cr/lane-mode.ts) and the `autonomous` block in
[`src/core/config.ts`](../../../src/core/config.ts) with the same fail-soft `advisory` default. Like
its two siblings it opts in through `crLanes.code`, and `pen-modified` reds in both modes. Nothing
about the sink layout or the aggregate changes: the lane writes
`.noldor/cr/<slug>-code-geometry-compare.json` in the standard `LaneFindings` shape.

The registration surface is wider than the lane file itself, and every seat is one the existing
`render-compare` rows make explicit: the `LANE_RUNNERS` map, the `NO_DELTA_SHORTCIRCUIT` set, the
code-only lane list, and the verifier-ordering special case in
[`src/cr/orchestrate.ts`](../../../src/cr/orchestrate.ts) (a geometry round boots the app, so it waits
for `verifier` to resolve exactly as `render-compare` does); the dispatched role name in
[`src/core/agent-runner/types.ts`](../../../src/core/agent-runner/types.ts) for the design-side
extractor; the reason codes in [`src/cr/findings-schema.ts`](../../../src/cr/findings-schema.ts) (D7);
the recipe schema in [`src/core/consumer-config.ts`](../../../src/core/consumer-config.ts) (D2); and
the prose twins under `docs/noldor/` plus their `templates/docs/noldor/` copies —
`cr-pipeline.md`, `adoption-guide.md`, and `script-catalog.md` all carry per-lane rows, and
`template-sync` reds on a one-sided edit.

### D2 — Consumer config: the geometry recipe

The lane needs, per surface, the same boot information `render-compare` needs plus one different
capture command, so it extends the existing `UiBootRecipeSchema` in
[`src/core/consumer-config.ts`](../../../src/core/consumer-config.ts) rather than adding a parallel
`consumer.uiGeometry` block: an optional `geometryCommand` template (placeholders `{url}`, `{out}`,
`{width}`, `{height}`, validated by the same `screenshotTemplateIssues` quoting contract in
[`src/core/ui-boot.ts`](../../../src/core/ui-boot.ts)) plus optional per-family `geometryTolerance`
and `geometryBudget` objects. One recipe per surface then serves both lanes — `route`,
`verifyCommand`, and `page` are identical inputs, and a consumer opting into both should not restate
them. A surface with a recipe but no `geometryCommand` is `no-geometry-recipe`, never a pass.

The command's contract is: render the route in the consumer's own browser tool and write a
`geometryDocSchema` document to `{out}` (D4). Satisfying that schema by hand is a real ask — visibility
filtering, device pixel ratio 1, computed `gap`/`padding` — so unlike `screenshotCommand`, the
framework ships a reference producer: `templates/scripts/geometry-capture.mjs`, a documented
Playwright walk that `init` lands at the consumer's `scripts/geometry-capture.mjs`. It is a
**scaffold-only** template (`SCAFFOLD_ONLY_TEMPLATES` in
[`src/templates/manifest.ts`](../../../src/templates/manifest.ts)), not a synced twin, because every
real app needs its own waits and auth steps there and a synced twin would turn each of those into a
`template-sync` red. The browser dependency stays entirely in the consumer's `package.json`.

### D3 — Design-side geometry extraction

Pencil `.pen` files are encrypted and pencil MCP is the only reader, so the design side is a
dispatched child exactly like `render-export-dispatch.ts`: a new
`src/cr/lanes/geometry-extract-dispatch.ts` built on `createDispatcherSeam`, reusing
`penBridgeRecipe` for the bridge-wake recipe and the same "child ENUMERATES, Node SELECTS" split.
The child opens the scratch copy, resolves each surface's `FINAL:` page via the candidates it
reports (`selectFinalPage` re-runs Node-side), and reads geometry with one visitor pass:
`Get(pageId, (n, c) => ({ id: n.id, name: n.name, type: n.type, b: c.bounds, fs: n.fontSize,
gap: n.gap, pad: n.padding }), { resolveVariables: true })`.

The pencil API supports this directly, and a raw schema read would not have: per
`read_skill('pen-schema.md')`, an entity's own `x`/`y` are ignored when its parent uses flex layout
and `width`/`height` may be `fit_content`, `fill_container`, or a `$variable` — so declared position
and size are not geometry. What is geometry is the visitor context: `read_skill('execute.md')`
documents `Ctx.bounds` as the *resolved* bounds in the parent's coordinate space, with `Ctx.parentCtx`
walkable for the absolute frame, `Ctx.depth`/`Ctx.index` for structure, and `Ctx.problems`
(`"partially clipped" | "fully clipped"`) as pen's own overflow verdict. `resolveVariables: true`
turns `$`-bound font sizes and gaps into numbers. Spacing on the design side is `gap` and `padding`
only — pen has no `margin` property at all — which is why D5 treats observed gaps, not box-model
values, as the comparable quantity.

### D4 — The normalized geometry document

One zod schema, `geometryDocSchema`, shared by both sides and validated at both boundaries (untrusted
child output; untrusted consumer-command output). Per surface: a viewport `{width, height}` and a flat
array of nodes, each `{name?, kind, box: {x, y, w, h}, fontSize?, text?}` in CSS pixels with the
surface's top-left as origin. The design side fills it from the `Get` visitor pass in D3 — `ctx.bounds`
is parent-relative, so the child walks `ctx.parentCtx` to absolutize before reporting — and the
implementation side fills it from the consumer's browser command. Two measurement engines, one
contract; the design side is pen's own resolved layout, with nothing translating it on the way to the
verdict. `name` is carried because pen supplies it per node, which is what keeps the per-element
pairing upgrade (D5's deferred half) open without a schema change.

Flat, not a tree: the comparison in D6 is population-based, so parentage buys nothing and a tree
invites the two sides to disagree about nesting that neither renders. Both sides must agree on scale
(device pixel ratio 1). What they cannot agree on is node count — a DOM carries wrappers and text
spans that have no design counterpart, so the implementation side reports an order of magnitude more
nodes than the design side. That asymmetry is why D5 compares derived feature populations rather than
nodes, and why the impl-side filtering rule (exclude zero-area, `visibility:hidden`, and
`display:contents` elements at minimum) is a boundary rule the schema documents rather than a
heuristic the consumer improvises.

### D5 — Feature families, not element pairs

From one geometry document the lane derives three quantized multisets, and the comparison in D6
operates only on these. Each family uses the instrument that carries its signal most directly rather
than deriving all three from one source:

- **Alignment edges** — from resolved boxes: the multiset of left edges (`x`), right edges (`x + w`),
  and the `y`/`y + h` equivalents, each quantized to a tolerance bucket. A design with three
  left-aligned cards has one left-edge value; an implementation whose third card sits two pixels over
  has two. Nothing else catches that — a mispositioned element declares no property to compare.
- **Font sizes** — the multiset of distinct `fontSize` values over nodes that carry one. Both sides
  report this natively (pen's `TextStyle.fontSize` with `resolveVariables`, `getComputedStyle`'s
  `font-size`).
- **Spacing** — from *declared* properties, not observed gaps: pen frames carry `gap` and `padding`,
  while the DOM side reads `gap`, `padding` **and `margin`** off `getComputedStyle`. Pen has no
  `margin` property at all, so an implementation that spaces two cards with `margin: 16px` where the
  design declared `gap: 16` would otherwise show an unmatched bucket for a visually identical result.
  Folding margin into the same population fixes that precisely because the comparison is over *values*,
  not owners: the value 16 lands in both multisets regardless of which property carried it. An observed
  sibling gap, by contrast, would conflate padding, margin, and wrapper boxes, and a DOM wrapper with
  no design counterpart would invent buckets that read as drift.

This is the load-bearing choice of the whole spec: it produces a verdict with no element pairing, so
it cannot mis-pair, and it is invariant to everything the design cannot paint — colors, effects,
shaders, generated SVG. Its cost is localization: the lane reports "the implementation introduces a
left edge at 26px that the design does not have", not "the third card is misaligned". The evidence
artifact (D8) is what closes that gap, by listing the nodes sitting in each drifted bucket.

### D6 — Comparison and tolerances

Per surface and per family: quantize both sides' values into buckets of the family's tolerance
(defaults 2px for edges, 1px for font size, 1px for declared spacing — consumer-overridable per
recipe), then compare the two bucket sets in both directions. An impl-only bucket and a design-only
bucket both count as unmatched, and neither direction is droppable: the primary case — one card two
pixels off while its siblings stay aligned — appears *only* as an impl-only edge bucket (the design's
own 24px bucket is still matched by the other two cards), while a design-only bucket is how a
specified value that the implementation never renders surfaces at all.

The surface fails when a family's unmatched-bucket count exceeds that family's budget, and the
budgets differ because the noise floors do: `fontSize` and declared spacing default to **0** — both
are small enumerable sets, so any unmatched value is real drift — while edges default to **2**, because
dynamic content legitimately introduces edges the design never had (text wrap, a scrollbar,
truncation). Severity comes from the unmatched count itself, `1-2` → `med` and `3+` → `high`, rather
than from a multiple of the budget the way `severityForRatio` does it: at a budget of 0 the `2x` form
degenerates to always-high.

### D7 — Per-surface outcomes and aggregation

The lane reuses the outcome semantics of
[`render-compare-core.ts`](../../../src/cr/lanes/render-compare-core.ts): every surface in scope gets
its own row, the top verdict is the worst by `fail` > `cannot-review` > `pass` with ties broken by
surface name, `pen-modified` precedence is absolute, and a zero-affected-surface round falls back to
every declared surface rather than passing on emptiness. Because the two lanes' payloads differ
(per-family unmatched counts vs a single `diffRatio`), `aggregateOutcomes` is lifted to a generic over
the outcome type rather than copied — the rule is identical and the clones ratchet would flag a copy.
The opening sequence is `openDesignReviewRound` from
[`pen-scratch.ts`](../../../src/cr/lanes/pen-scratch.ts) unchanged, with `'geometryCompareMode'` as
the mode key, so sink/mode/target-resolution/scratch-staging behavior cannot drift between the three
design lanes.

Five reason codes join `laneReasonCodeSchema`, one per pipeline stage that can decline:
`no-geometry-recipe` (surface has no `geometryCommand`), `geometry-extract-failed` (the design-side MCP
child), `geometry-capture-failed` (the consumer command — non-zero exit, timeout, or no output file),
`geometry-unparseable` (either side's JSON failed `geometryDocSchema`), and `geometry-empty` (a side
reported zero nodes, so no honest comparison exists). Existing codes carry over unchanged:
`boot-failed`, `route-unreachable`, `page-ambiguous`, `config-unreadable`, `scratch-unavailable`,
`persist-failed`, `dispatch-failed`, `pen-modified`.

### D8 — Evidence artifacts

Per round, `.noldor/cr/geometry-compare/<slug>/<surface>.design.json` and `<surface>.impl.json` hold
both normalized documents, and `<surface>.report.json` holds the per-family bucket comparison:
for every unmatched bucket, its family, its value, which side it came from, and the nodes sitting in
it (`name`, `kind`, box, and text where present). That node list is the substitute for element
pairing — a bucket count is only actionable if the operator can see which nodes produced it, and the
design side supplies pen's own layer names, which is usually enough to recognise the component.

Persistence reuses `render-compare`'s atomic tmp/trash swap and its rule that a round producing no
documents must leave the prior round's evidence in place: the images-vs-JSON difference does not change
either property. A round whose evidence could not be persisted terminates `persist-failed` rather than
reading as a clean verdict, for the same reason — an unauditable verdict is not a verdict.

## Acceptance criteria

1. `geometry-compare` is a valid `crLanes.code` lane and its sink lands at
   `.noldor/cr/<slug>-code-geometry-compare.json` in the standard `LaneFindings` shape.
2. `geometryCompareMode` reads `blocking | advisory` with the same fail-soft `advisory` default as the
   sibling knobs, and `pnpm noldor validate noldor-config` accepts/rejects it accordingly.
3. A `geometryCommand` template missing a required placeholder, or containing a quote, is rejected at
   `validate noldor-config` time; a recipe without `geometryCommand` yields a `no-geometry-recipe` row
   and the round never aggregates to `pass` on it.
4. The design side reports resolved absolute boxes: a node inside a `layout: vertical` frame — whose
   own `x`/`y` pen ignores — still lands with the box `ctx.bounds` resolved for it.
5. Either side's output failing `geometryDocSchema` yields `geometry-unparseable` for that surface, and
   both sides reporting zero nodes yields `geometry-empty` — never a comparison against a partial
   document, never a `pass`.
6. Two documents differing only in colors, effects, and image content compare `pass`.
7. Moving one node's left edge past the edge tolerance while its siblings stay put produces a `fail`
   naming that impl-only edge bucket and the nodes in it.
8. A design-only bucket (a specified value the implementation never renders) also counts as unmatched
   and can fail its family.
9. Per-family budgets hold: one unmatched `fontSize` or declared-spacing bucket fails, while two
   unmatched edge buckets do not.
10. Severity derives from the unmatched count — `1-2` → `med`, `3+` → `high` — including when a
    family's budget is 0.
11. A family the design side cannot supply is skipped for that surface with a `notes` line, and the
    remaining families still decide the verdict.
12. The design file's hash changing during the round yields `pen-modified` regardless of every other
    outcome, and a round that produced no geometry documents leaves the prior round's evidence intact.

## Risks / trade-offs

Population comparison trades localization for robustness. An operator reading a fail sees which layout
value drifted, not which component owns it; D8's per-bucket node listing is a partial substitute, and
the full fix — per-element pairing — needs a naming convention on the implementation side that this
spec deliberately defers. The upgrade path is already open: the design document carries pen's layer
names, so pairing becomes a comparison rule rather than a schema change.

Declared spacing is the family most exposed to a modeling mismatch. Folding `margin` into the
implementation side neutralizes the pen-has-no-margin asymmetry for equal values, but a design that
declares `gap: 16` against an implementation that produces the same visual rhythm from `gap: 8` plus
`padding: 8` still reads as two unmatched buckets. That is a true report of a real difference in how
the spacing is composed, and an operator who does not care can raise the family's budget — but it will
be the most common source of arguable fails.

Two mechanical design lanes both boot the app, so a consumer running `render-compare` and
`geometry-compare` together pays two boot cycles per round. Sharing one boot across lanes needs
orchestrate-level coordination the lane API does not have today; the cost is accepted and named.

The reference capture script is scaffold-only, so a consumer's copy drifts from the framework's as
soon as they add their waits — by design, but it means a later schema change to `geometryDocSchema`
cannot be delivered by `init --update`. Schema evolution therefore has to stay additive, and the
boundary validation is what turns a stale producer into an explicit `geometry-unparseable` rather than
a wrong comparison.

## User Story

As an operator shipping UI whose design cannot be pixel-faithful, I want a mechanical lane that
compares element alignment, font sizes, and spacing between my `.pen` design and the booted
implementation, so that I get a real layout-drift signal instead of a pixel-diff I have to ignore.

## Usage

Opt in per repo, alongside or instead of `render-compare`:

```jsonc
{
  "crLanes": { "code": ["reviewer", "geometry-compare"] },
  "autonomous": { "geometryCompareMode": "advisory" },
  "consumer": {
    "uiBoot": {
      "dashboard": {
        "verifyCommand": "dev",
        "route": "/dashboard",
        "screenshotCommand": "pnpm shot {url} {out} {width} {height}",
        "geometryCommand": "node scripts/geometry-capture.mjs {url} {out} {width} {height}",
        "geometryTolerance": { "edges": 2, "fontSize": 1, "spacing": 1 },
        "geometryBudget": { "edges": 2, "fontSize": 0, "spacing": 0 }
      }
    }
  }
}
```

`scripts/geometry-capture.mjs` is scaffolded by `noldor init` and is yours to edit — add the waits and
auth your app needs. Sink: `.noldor/cr/<slug>-code-geometry-compare.json`. Evidence:
`.noldor/cr/geometry-compare/<slug>/<surface>.report.json`, which lists the nodes sitting in each
unmatched bucket — open it before arguing with a bucket count.

## Open questions (resolved)

1. *Extend `UiBootRecipeSchema` with `geometryCommand`, or add a separate `consumer.uiGeometry`
   block?* -> Extend the existing recipe (D2). `route`/`verifyCommand`/`page` are identical inputs for
   both lanes and restating them invites drift.
1b. *Does the framework ship a reference `geometryCommand` producer?* -> Yes, as a scaffold-only
   template (D2). The schema is too involved to hand-roll per consumer, and scaffold-only keeps
   app-specific waits out of `template-sync`.
2. *Is the population comparison of D5 enough, or does the lane need element pairing?* -> Population
   first, pairing deferred. Pairing needs a naming convention on both sides and cannot be added
   honestly without it.
3. *Count-based or ratio-based failure predicate?* -> A per-family unmatched-bucket count with
   per-family budgets (D6). A count is legible in a sink line; a ratio needs the design's bucket count
   to interpret and hair-triggers on small designs. One uniform budget is rejected separately: the
   three families have different noise floors.
4. *Does the lane share `render-compare`'s boot when both run?* -> No. Accepted double boot; sharing
   needs orchestrate-level coordination outside this scope.
5. *Lane name — `geometry-compare` or `layout-compare`?* -> `geometry-compare`, because the compared
   data is geometric (boxes and sizes) while "layout" suggests it understands flow/stacking, which it
   does not.
6. *Measure the design side through pencil MCP, or export it to HTML and measure both sides with the
   same browser tool?* -> Through pencil MCP (D4). `Export` does offer `html-css`/`html-tailwind` with
   layer-name data attributes, but that only names the design side — pairing also needs the
   implementation tagged, which no export format supplies. The symmetric option therefore buys one
   measurement engine in exchange for an unproven pen-to-HTML translation between the design and its
   own verdict, plus a static server for the export.
