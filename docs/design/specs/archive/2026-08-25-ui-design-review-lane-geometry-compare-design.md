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
  session's `.pen` design and the booted implementation: element alignment, font sizes, and declared
  spacing (gap/padding, plus margin on the implementation side).
- Deterministic and unpaintable: the verdict must not move when colors, effects, images, or
  antialiasing change, and must move when the *population of layout values* drifts — a new alignment
  value, a changed font size, a spacing value the design never declared. It is explicitly not a
  per-element position check; see the localization limit in Risks.
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

Ordering is a registration decision, not an implementation detail.
[`src/cr/orchestrate.ts`](../../../src/cr/orchestrate.ts) chains `render-compare` off the verifier
run so the two never boot at once; a second lane chained off the same promise would run *concurrently
with* `render-compare`, and two dev servers over one project directory contend on the same build cache
(`.next`, vite's dep cache) even though `resolvePort` hands them different ports. So the chain becomes
a sequence: `verifier` → `render-compare` → `geometry-compare`, each waiting for the previous to
resolve, with a lane that is absent from the round simply not contributing a link.

The rest of the registration surface is one the existing `render-compare` rows make explicit: the
`LANE_RUNNERS` map, the `NO_DELTA_SHORTCIRCUIT` set, and the code-only lane list in orchestrate; the
dispatched role name in
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
`{width}`, `{height}`) plus optional per-family `geometryTolerance` and `geometryBudget` objects. One
recipe per surface then serves both lanes — `route`, `verifyCommand`, and the optional `page`
selector are identical inputs, and a consumer opting into both should not restate them.

Two existing-schema consequences follow, and both are in scope. First, `screenshotCommand` becomes
**optional**: a consumer running only `geometry-compare` has no screenshot tool to name, and the
schema must not force one. The recipe instead has to carry at least one capture command, and
`render-compare` reports `no-boot-recipe` for a surface whose recipe omits `screenshotCommand` — the
same row it already emits for a surface with no recipe at all, for the same reason (nothing to
capture with). Symmetrically, a recipe without `geometryCommand` is `no-geometry-recipe` for this
lane, never a pass. Second, template validation reuses `screenshotTemplateIssues` in
[`src/core/ui-boot.ts`](../../../src/core/ui-boot.ts) — the quoting contract is identical — but all
six of its messages hardcode the string `screenshotCommand`, so the helper takes the field label as a
parameter. Reusing it as-is would reject a bad `geometryCommand` while naming the wrong config key.

Substitution reuses `substituteScreenshotCommand` from
[`render-compare-core.ts`](../../../src/cr/lanes/render-compare-core.ts) unchanged — the placeholder
set is the same `SCREENSHOT_PLACEHOLDERS`, and the validator's single-quote contract is only sound if
the same helper performs the substitution. A second hand-rolled substituter is exactly where the
injection guard would silently lapse.

The command's contract is: render the route in the consumer's own browser tool and write a
`geometryDocSchema` document to `{out}` (D4). Satisfying that schema by hand is a real ask — the
capture root, the visibility filter, device pixel ratio 1, computed `gap`/`padding`/`margin`
normalization — so unlike `screenshotCommand`, the framework ships a reference producer:
`templates/scripts/geometry-capture.mjs`, a documented Playwright walk that `init` lands at the
consumer's `scripts/geometry-capture.mjs`. It is a **scaffold-only** template
(`SCAFFOLD_ONLY_TEMPLATES` in [`src/templates/manifest.ts`](../../../src/templates/manifest.ts)), not
a synced twin, because every real app needs its own waits and auth steps there and a synced twin
would turn each of those into a `template-sync` red. The browser dependency stays entirely in the
consumer's `package.json`.

### D3 — Design-side geometry extraction

Pencil `.pen` files are encrypted and pencil MCP is the only reader, so the design side is a
dispatched child exactly like `render-export-dispatch.ts`: a new
`src/cr/lanes/geometry-extract-dispatch.ts` built on `createDispatcherSeam`, reusing
`penBridgeRecipe` for the bridge-wake recipe and the same "child ENUMERATES, Node SELECTS" split for
`FINAL:` page resolution (`selectFinalPage` re-runs Node-side over the child's reported candidates).

The pencil API supports the read directly, and a raw schema read would not have: per
`read_skill('pen-schema.md')`, an entity's own `x`/`y` are ignored when its parent uses flex layout
and `width`/`height` may be `fit_content`, `fill_container`, or a `$variable` — declared position and
size are not geometry. What is geometry is the visitor context: `read_skill('execute.md')` documents
`Ctx.bounds` as the *resolved* bounds **in the parent's coordinate space**, so absolutization is the
visitor's job and has to happen inside the callback — the returned records carry no parent handle, so
nothing downstream could do it:

```js
const abs = (c) => { let x = 0, y = 0; for (let k = c; k; k = k.parentCtx) { x += k.bounds.x; y += k.bounds.y; } return { x, y }; };
Get(pageId, (n, c) => { const o = abs(c); return { id: n.id, name: n.name, type: n.type,
  x: o.x, y: o.y, w: c.bounds.width, h: c.bounds.height,
  fontSize: n.fontSize, layout: n.layout, gap: n.gap, padding: n.padding }; }, { resolveVariables: true })
```

The accumulated origin is canvas-absolute, so the child subtracts the `FINAL:` page node's own
accumulated origin from every node, making all boxes **page-relative** — the origin the implementation
side matches by subtracting its capture root's rect (D4). The page node's own `width`/`height` become
the document's viewport and the `{width}`/`{height}` substituted into `geometryCommand`, mirroring how
`render-compare` sizes a screenshot from the exported design raster. `resolveVariables: true` turns
`$`-bound font sizes and gaps into numbers.

The child also performs the two mappings the normalized document needs, since only it sees pen's own
vocabulary. `kind` comes from the pen node type: `text` → `'text'`, `frame` → `'container'`, every
other type (`rectangle`, `ellipse`, `polygon`, `path`, instance refs) → `'shape'`. `spacing` is
normalized per D4 from `layout`/`gap`/`padding`. And a node whose `Ctx.problems` is set is **excluded
from the document** — a clipped design node is a broken design, and its box is not a target worth
matching — with the exclusions listed in the child's own report rows (a separate schema from the
geometry document, exactly as `renderExportReportSchema` is separate from the exported PNG), which the
lane surfaces as `notes`. The page node itself is not a node in the document; it is the viewport.

### D4 — The normalized geometry document

One zod schema, `geometryDocSchema`, shared by both sides and validated at both boundaries (untrusted
child output; untrusted consumer-command output):

```ts
{ surface: string,                                                     // must equal the surface under review
  viewport: { width: number, height: number },                         // finite, > 0
  nodes: Array<{
    name?: string,
    kind: 'text' | 'container' | 'shape',
    box: { x: number, y: number, w: number, h: number },               // finite; w/h >= 0; origin-relative CSS px, dpr 1
    fontSize?: number,                                                 // required iff kind === 'text'; finite, > 0
    text?: string,
    spacing?: { rowGap?: number, columnGap?: number,                   // finite, >= 0
                padding?: [number, number, number, number],            // top right bottom left, each >= 0
                margin?: [number, number, number, number] } }> }       // implementation documents only
```

`text` is required on a text node and forbidden on every other kind, which is stricter than an
earlier draft of this section left it: `kind: 'text'` means text-bearing, so a producer that cannot
say what the text is has mis-classified the node. The shipped schema expresses the whole per-kind
contract as a discriminated union on `kind`, so the coupling holds in the type as well as at runtime —
and the extraction child (D3) must emit `text`, or every text-bearing surface lands
`geometry-unparseable`.

Those invariants are enforced, not just described: a non-finite coordinate, a negative dimension, a
`fontSize` on a non-text node or missing from a text node, a design-side document carrying `margin`, or
a `surface` that is not the one under review all fail validation and land the surface as
`geometry-unparseable`. Both sides are untrusted producers, so a structurally-valid document that
violates the prose is exactly the case the boundary exists to catch.

**Origin.** This is the contract both sides must agree on or every edge value drifts by a constant. The
design side reports boxes relative to the `FINAL:` page node's own accumulated origin (D3). The
implementation side reports them relative to its **capture root** — the element the route renders into
— computed as `getBoundingClientRect()` after transforms (what the viewer sees), with the current
scroll offsets added back so a scrolled capture matches an unscrolled one, and the capture root's own
rect then subtracted so the root sits at `{0, 0}`. Document-relative coordinates would put every body
margin, centering wrapper, and piece of app chrome into every `x`/`y`, and at a budget of 0 a correct
implementation would fail every run. The capture root is not itself a node in the document, mirroring
the design side's treatment of the page node.

**Spacing normalization.** Pen declares `gap` on the main axis only, so it maps to `rowGap` under
`layout: "vertical"` and `columnGap` under `layout: "horizontal"`; pen `padding` arrives as a number,
`[v, h]`, or `[t, r, b, l]` and always lands as the four-tuple. On the implementation side
`row-gap`/`column-gap` of `normal` are omitted, and the four padding and margin sides are read
individually. The four-tuple keeps zero sides positionally (`[8, 0, 8, 0]` is a real declaration and
cannot omit its zeros without losing which side is which); it is **the population in D5 that excludes
zero values**, which is where the exclusion belongs — `getComputedStyle`'s ubiquitous `0px` must not
enter the comparison, but it must not corrupt the record either. For the same class of reason
`fontSize` is carried only on `kind: 'text'` nodes (design: pen `type: "text"`; implementation: an
element with a direct non-whitespace text child), so an inherited root font-size on wrapper elements
never becomes a value.

**Node kinds and filtering.** `kind` is `'text'` for text-bearing nodes as just defined, `'container'`
for pen frames and for implementation elements with element children, `'shape'` otherwise. Flat, not a
tree: D5 compares value populations, so parentage buys nothing and a tree invites the two sides to
disagree about nesting that neither renders. What they cannot agree on is node count — a DOM carries
wrappers and text spans with no design counterpart — so the implementation-side capture rule is a
documented boundary contract rather than a producer heuristic: exclude zero-area,
`visibility: hidden`, `display: contents`, and `aria-hidden` subtrees; include SVG root elements but
not their internal geometry (paths are paint, not layout); exclude pseudo-elements.

### D5 — Feature families, not element pairs

From one geometry document the lane derives three families of *values* — `edges`, `fontSize`,
`spacing` — and the comparison in D6 operates only on these. Each family has one tolerance and one
budget under those exact three keys; there are no per-axis knobs. Each uses the instrument that
carries its signal most directly:

- **`edges`** — from resolved boxes. Values are clustered **per axis internally** (a 24px left edge
  and a 24px top edge are unrelated quantities): the x pass collects every node's `x` and `x + w`, the
  y pass every `y` and `y + h`, and the family's unmatched count is the sum of the two passes. One
  budget covers both, because "how many unexplained alignment values does this surface have" is one
  question. A design with three left-aligned cards contributes one x value; an implementation whose
  third card sits two pixels over contributes a second. Nothing else catches that — a mispositioned
  element declares no property to compare.
- **`fontSize`** — every `fontSize` on a `kind: 'text'` node. Both sides report it natively, and D4's
  text-node rule keeps inherited wrapper values out. Compared **symmetrically**: an implementation-only
  size is drift (text the design never specified), a design-only size is a specified size nothing
  renders.
- **`spacing`** — every non-zero `rowGap`, `columnGap`, and padding side on both sides, plus the
  non-zero margin sides on the implementation side. Compared **one-directionally**: only *design-only*
  values count as unmatched. The implementation's spacing values are a matching pool, never a source
  of failure.

That asymmetry is the fix for two problems at once. Pen has no `margin` property, so an implementation
spacing two cards with `margin: 16` where the design declared `gap: 16` must be able to satisfy the
design value — hence margin in the pool. But UA stylesheets put non-zero, fractional margins on
`h1`–`h6`, `p`, `ul`, and `blockquote` (roughly `21.44px` on `h1` at a 16px root) that pen has no
property to declare at all, and a single negative gutter (`-mx-4`) is unrepresentable in pen by
construction — so counting implementation-only spacing values would fail real UI deterministically,
and the only escape would be raising the budget, which is precisely the knob-with-no-useful-setting
this spec's Problem section rejects `maxDiffRatio` for. One-directional comparison asks the question
that is actually answerable: *is every spacing value the design declared honored somewhere in the
implementation?*

Comparison is over the **set of distinct values** each side declares, never over how many nodes carry
each one. That is forced by D4's node-count asymmetry: any count-sensitive comparison would mark
nearly every value unmatched, because a DOM wrapper stack reuses its child's edges. It is also the
load-bearing choice of the whole spec — a value-set verdict cannot mis-pair elements, and it is
invariant to everything the design cannot paint (colors, effects, shaders, generated SVG), because
none of those quantities appear in the document at all.

### D6 — Comparison and tolerances

Comparison is a two-stage rule per surface and per family, specified to the point where two
implementations produce identical unmatched sets:

1. **Cluster** each side's values independently. Deduplicate exact repeats, sort ascending, then admit
   a value into the open cluster only while the cluster's own WIDTH stays within the family's
   tolerance. Comparing against the PREVIOUS value instead (single linkage) chains: at tolerance 2,
   implementation edges 24, 26 and 28 become one cluster represented by 26, which then matches a
   design edge at 24 — hiding an edge 4px off. A cluster's representative is the **arithmetic mean** of its values —
   named because "median" is ambiguous for an even-sized cluster, and at a 1px tolerance that ambiguity
   flips match outcomes. Defaults: `edges` 2px, `fontSize` 1px, `spacing` 1px, consumer-overridable per
   recipe.
2. **Match** the two representative lists with a single order-preserving forward scan, which on
   sorted lists is already maximum-cardinality optimal: pair the two heads when they are within
   tolerance, otherwise drop the smaller head, since everything ahead of it on the other side is
   larger still. CLOSEST-PAIR greedy is what fails — at tolerance 2, design `{0, 3}` against
   implementation `{2, 5}` has the full matching `0→2, 3→5`, but taking the smallest difference first
   pairs `3→2` and leaves two unmatched, inventing drift out of the algorithm. The forward scan also
   allocates nothing beyond its outputs, which matters for documents this contract treats as
   untrusted: an edit-distance dynamic program would build an (n+1)x(m+1) table, and a long-page
   capture with a couple of thousand distinct values per side turns that into millions of cells.

Whatever is left unmatched is the family's count: implementation-only means the implementation
introduced a layout value the design does not have, design-only means a specified value the
implementation never renders. `edges` and `fontSize` count both directions; `spacing` counts design-only
leftovers alone (D5). The primary case — one card two pixels off while its siblings stay put — appears
only as an implementation-only edge cluster, since the design's own 24px value is still matched by the
other two cards.

Matching on representatives within a tolerance, rather than on shared indices of a fixed grid, is what
removes the boundary artifact: under bucketing a design edge at 23.9 and an implementation edge at 24.1
fall in adjacent buckets and read as unmatched despite a 0.2px difference, while 24.0 and 25.9 match.
Sub-pixel values are the norm on the implementation side (`getBoundingClientRect`, `rem` and `clamp`
font sizes), so that artifact would fire routinely.

The tolerance is a budget spent ONCE across the two stages, not per stage: clustering to width W puts
a member up to W/2 from its representative on each side and matching then allows another M, so
spending the full tolerance twice lets roughly double it pass silently. Half goes to the permitted
cluster width and half to the match, which yields the stated guarantee — a difference above the
tolerance can never pair, one at or under half of it always pairs.

A family fails when its unmatched count exceeds its budget, and **every budget defaults to 0**: with
D4's zero-exclusion and text-node rules removing the systematic noise, the tolerance absorbing
sub-pixel jitter, and spacing counting one direction only, a leftover value is a real difference.
Genuinely noisy surfaces raise that family's `geometryBudget` explicitly — an opt-in claim that "this
surface tolerates N unexplained layout values", which an operator should have to make rather than
inherit. Severity per failing family comes from its unmatched count, `1-2` → `med` and `3+` → `high`
(the `med`/`high` spelling is `severitySchema`'s in
[`src/cr/findings-schema.ts`](../../../src/cr/findings-schema.ts)), rather than from a multiple of the
budget the way `severityForRatio` does it — at a budget of 0 the `2x` form degenerates to always-high.

There is deliberately **no family-skip path**. An earlier draft let a side declare a family
unsupplied, which conflated "cannot measure" with "measured nothing" — and a design with no text would
then have silently skipped implementation-added text. Every family is always compared: a design with
no font sizes against an implementation with three simply has three implementation-only values, which
is the honest reading (the implementation introduced type the design never specified). The research
that made the earlier draft's escape hatch unnecessary is in D3 — pen supplies all three families.

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

An ordinary layout mismatch carries **no reason code** — it is a `fail` verdict whose findings name
the family, the unmatched values, and the evidence path, exactly as `render-compare` reports a
`diffRatio` fail. A surface with several failing families emits one finding per family, and the whole
round goes through `writeFailByMode`: blocking mode puts them in `blockers`, advisory mode in
`suggestions` with a passing exit, which is the same matrix the two sibling lanes use. Reason codes
exist only for rounds that could not compare, and six join `laneReasonCodeSchema`, one per stage that
can decline: `no-geometry-recipe` (no `geometryCommand`), `geometry-extract-failed` (the design-side
MCP child), `geometry-capture-failed` (the consumer command — non-zero exit, timeout, or no output
file), `geometry-unparseable` (either side's JSON failed `geometryDocSchema`), `geometry-empty`
(**either** side reported zero nodes, so there is nothing to compare against), and
`viewport-mismatch`. Existing codes carry over unchanged: `boot-failed`, `route-unreachable`,
`page-ambiguous`, `config-unreadable`, `scratch-unavailable`, `persist-failed`, `dispatch-failed`,
`pen-modified`.

### D8 — Evidence artifacts

Per round, `.noldor/cr/geometry-compare/<slug>/<sanitized>.design.json` and `<sanitized>.impl.json`
hold both normalized documents, and `<sanitized>.report.json` holds the per-family comparison: every
cluster on both sides with its representative and members, and for each unmatched cluster its family,
its representative, which side it came from, and the nodes that produced it (`name`, `kind`, box, and
text where present). `<sanitized>` is `sanitizeSurfaceName` from
[`src/core/ui-boot.ts`](../../../src/core/ui-boot.ts), the same helper `render-compare` joins with
(`render-compare.ts` artifact paths) and the reason its collision check exists: surface names are
consumer-config record keys, so an unsanitized join would let a `/` or `..` in a key write outside the
round's directory.

That node list is the substitute for element pairing — an unmatched-value count is only actionable if
the operator can see which nodes produced it, and the design side supplies pen's own layer names,
which is usually enough to recognise the component. Persistence reuses `render-compare`'s atomic
tmp/trash swap and its rule that a round producing no documents must leave the prior round's evidence
in place; a round whose evidence could not be persisted terminates `persist-failed` rather than
reading as a clean verdict, since an unauditable verdict is not a verdict.

## Acceptance criteria

1. `geometry-compare` is a valid `crLanes.code` lane, `geometryCompareMode` reads `blocking |
   advisory` with a fail-soft `advisory` default, the sink lands at
   `.noldor/cr/<slug>-code-geometry-compare.json` in the standard `LaneFindings` shape, and a round
   containing `render-compare` runs the two sequentially rather than concurrently.
2. A `geometryCommand` template missing a required placeholder, or containing a quote, is rejected by
   `validate noldor-config` **naming `geometryCommand`**; a recipe with neither capture command is
   rejected; a recipe with only `geometryCommand` validates, and `render-compare` reports
   `no-boot-recipe` for that surface while a recipe with only `screenshotCommand` yields
   `no-geometry-recipe` here.
3. Both sides report origin-relative boxes: a design node inside a `layout: vertical` frame lands with
   its `ctx.bounds` accumulated up the ancestor chain minus the page origin, and an implementation
   inside a centered wrapper lands with its capture root's rect subtracted — so a correct
   implementation of a design produces no edge drift from the wrapper.
4. Normalization holds on both sides: pen `gap` under a vertical layout becomes `rowGap`, pen
   `padding: 8` becomes `[8,8,8,8]`, computed `row-gap: normal` is omitted, `[8,0,8,0]` keeps its zero
   sides in the document, and those zeros do not enter the spacing population.
5. `fontSize` is present exactly on `kind: 'text'` nodes, so a wrapper's inherited computed
   `font-size` never becomes a value; a document violating that, carrying a non-finite coordinate, a
   negative dimension, a design-side `margin`, or the wrong `surface` fails validation as
   `geometry-unparseable`.
6. Either side reporting zero nodes yields `geometry-empty`; viewports differing by more than 1px yield
   `viewport-mismatch` — each a `cannot-review`, never a comparison and never a `pass`.
7. Clustering is deterministic (exact duplicates collapsed, representative = arithmetic mean) and
   matching is optimal: design `{0, 3}` against implementation `{2, 5}` at tolerance 2 matches fully
   and reports zero unmatched, where closest-pair greedy would report two.
8. Moving one node's left edge past the `edges` tolerance while its siblings stay put fails the `edges`
   family at the default budget of 0, and the finding names the unmatched representative and the nodes
   behind it; a `fontSize` the design declares and the implementation never renders also fails.
9. The `spacing` family counts design-only values only: a design `gap: 16` satisfied by an
   implementation `margin: 16` passes, and UA-default margins (`h1`, `p`, `ul`) plus a negative gutter
   in the implementation add no unmatched value.
10. Budget semantics: a surface with `geometryBudget.edges` at 2 passes with two unmatched edge
    clusters and fails with three.
11. Severity on a default-budget surface is `med` at one or two unmatched values in a family and `high`
    at three or more, and a surface failing two families emits one finding per family, routed to
    `blockers` in blocking mode and `suggestions` in advisory mode.
12. Adding a wrapper element that shares its child's box introduces no unmatched value; a clipped
    design node is excluded from the document and named in `notes`; the design file's hash changing
    during the round yields `pen-modified` regardless of every other outcome; and a round that produced
    no documents leaves the prior round's evidence intact.

## Risks / trade-offs

Value-set comparison has a blind spot, and it is the direct price of needing no element pairing: a
node that relocates onto an alignment value the surface already uses moves no value into or out of
either set, so the verdict does not change. Moving a card from the left column to the right column of
the same grid is invisible; moving it two pixels off that column is caught. The lane therefore claims
drift in the *population of layout values*, not per-element position — which is why the Goals say so
explicitly rather than promising that any box shift moves the verdict. The upgrade that closes it is
per-element pairing, and it is already half-built: the document carries pen's layer names, so pairing
becomes a comparison rule plus an implementation-side tagging convention, not a schema change.

Localization is the second cost. An operator reading a fail sees which layout value drifted, not which
component owns it; D8's per-cluster node listing (names, boxes, text) is the substitute.

Declared spacing is the family most exposed to a modeling mismatch, and the one-directional rule buys
its robustness by giving up a signal: because implementation-only spacing values never fail, a
component that quietly gains `padding: 40` where the design declared nothing is invisible to this lane.
That is the deliberate trade — the alternative counts every UA-default margin as drift. What remains
arguable is composition: a design declaring `gap: 16` against an implementation producing the same
rhythm from `gap: 8` plus `padding: 8` reports the design's 16 as unmatched, which is a true statement
about how the spacing is composed but not always one the operator cares about.

Two mechanical design lanes both boot the app, so a consumer running `render-compare` and
`geometry-compare` together pays two boot cycles per round. Sharing one boot needs orchestrate-level
coordination the lane API does not have today; the cost is accepted and named.

The reference capture script is scaffold-only, so a consumer's copy drifts from the framework's as
soon as they add their waits — by design, but a later `geometryDocSchema` change cannot be delivered
by `init --update`. Schema evolution therefore stays additive, and the boundary validation is what
turns a stale producer into an explicit `geometry-unparseable` rather than a wrong comparison.

## User Story

As an operator shipping UI whose design cannot be pixel-faithful, I want a mechanical lane that
compares element alignment, font sizes, and spacing between my `.pen` design and the booted
implementation, so that I get a real layout-drift signal instead of a pixel-diff I have to ignore.

## Usage

Opt in per repo, alongside or instead of `render-compare` (this example runs geometry only, so it
declares no `screenshotCommand`):

```jsonc
{
  "crLanes": { "code": ["reviewer", "geometry-compare"] },
  "autonomous": { "geometryCompareMode": "advisory" },
  "consumer": {
    "uiPaths": ["src/app/**", "src/components/**"],
    "uiSurfaces": { "dashboard": ["src/app/dashboard/**"] },
    "uiBoot": {
      "dashboard": {
        "verifyCommand": "dev",
        "route": "/dashboard",
        "page": "overview",
        "geometryCommand": "node scripts/geometry-capture.mjs {url} {out} {width} {height}",
        "geometryTolerance": { "edges": 2, "fontSize": 1, "spacing": 1 },
        "geometryBudget": { "edges": 0, "fontSize": 0, "spacing": 0 }
      }
    }
  }
}
```

`uiSurfaces` is what makes the surface affected by a diff, `page` selects among several
`FINAL:dashboard: <name>` design pages, and `scripts/geometry-capture.mjs` is scaffolded by
`noldor init` and yours to edit — add the waits and auth your app needs. Sink:
`.noldor/cr/<slug>-code-geometry-compare.json`. Evidence:
`.noldor/cr/geometry-compare/<slug>/<surface>.report.json`, which lists the nodes behind every
unmatched value — open it before arguing with a count.

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
3. *Count-based or ratio-based failure predicate?* -> A per-family unmatched-cluster count against a
   per-family budget, every budget defaulting to 0 (D6). A count is legible in a sink line; a ratio
   needs the design's own cluster count to interpret and hair-triggers on small designs. The budgets
   default to 0 rather than to a noise allowance because D4's zero-value and text-node rules remove the
   systematic noise at the source — an allowance would instead have to be large enough to swallow
   `getComputedStyle`'s `0px` and inherited font sizes, which is large enough to swallow real drift.
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
7. *`screenshotCommand` is required today — what happens to a geometry-only consumer?* -> It becomes
   optional, with a recipe having to carry at least one capture command (D2), and `render-compare`
   reporting `no-boot-recipe` for a surface that omits it. Forcing a screenshot tool on a consumer who
   does not run the pixel lane is config theatre.
8. *Does the matching need a stable tie-break?* -> It needs no tie-break at all, because it is not a
   choice among candidate pairs: the two representative lists are sorted and matching is
   order-preserving, so a single forward scan is deterministic and already maximum-cardinality
   optimal. Selecting pairs by ascending difference — an earlier answer here — is the closest-pair
   greedy that loses cardinality outright.
9. *One budget per edge axis, or one for both?* -> One `edges` budget covering both axes (D5). Axes
   cluster separately because a left edge and a top edge are unrelated quantities, but "how many
   unexplained alignment values does this surface have" is a single question, and per-axis keys were
   the source of a four-way inconsistency between the schema, the defaults, the criteria, and Usage.
10. *Does a side get to declare a family unsupplied?* -> No (D6). The flag conflated "cannot measure"
   with "measured nothing", let a design with no text silently skip implementation-added text, and let
   an untrusted producer suppress comparison outright. Every family is always compared; the research in
   D3 established that pen supplies all three, so the escape hatch was solving a problem that does not
   exist.
11. *Symmetric or one-directional spacing comparison?* -> One-directional, design-only (D5). UA-default
   margins and negative gutters are unrepresentable in pen, so counting implementation-only spacing
   values fails real UI deterministically and the only escape is a budget large enough to hide real
   drift.
