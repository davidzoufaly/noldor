# UI Baseline .pen Layout and Id Contract — Design

**Slug:** pendev-ui-design-phase (enhancement: baseline-layout-contract)
**FD:** docs/features/pendev-ui-design-phase.md
**Date:** 2026-09-25
**Tier:** specs-only
**Entry:** Q-0292

UI verdict: skip — noldor declares no `consumer.uiPaths`; this work changes the framework code that reads a consumer's baseline, not a UI.

Architecture verdict: skip — the new check stays inside `src/design/`: no new directory, package, external system or cross-module import.

## Problem

A UI baseline `.pen` has no layout or id contract. `design capture` runs the consumer's `uiCapture` command and, since Q-0247, refuses a receipt for a baseline that `inspectBaseline` (`src/design/pen-doc.ts`) reds. But those findings only ask two things: is the file a usable document, and does it hold the pages its surface declares. Nothing says how the pages are arranged or how nodes are named.

charuy's first baseline was two unordered rows (full pages, then overlays) with counter ids (`n1`, `n2`…). Adding one control shifted every id after it, so no review, spec or agent could cite an id. charuy fixed this in its own emitter (charuy #228): one labelled row per app area, the dark page beside its light twin, and path ids. But the fix lives in one consumer's script. The next consumer, or the next hand edit at gate Step 4, can undo it and nothing notices.

The row labels charuy writes are 48 px. Its canvas is 8084 × 5490, so at zoom-to-fit a label renders at 7–10 px on screen. You cannot read the areas without zooming in.

## Goals

- Write the baseline contract down once, as a framework doc page every consumer receives: pages as top-level frames, one labelled row per area, twins side by side, a fixed minimum title size, and the id rules.
- Enforce the parts a file can prove, inside the one reader that `design capture` and `checks ui-design-freshness` already share. A baseline the check reds stays one that capture refuses to vouch for.
- Every failure names the node that breaks the rule.

## Non-goals

- **Feature `.pen` files are not checked.** A spec session seeds its `.pen` by copying the baseline, so it inherits the rows and labels. How variant pages lay out inside a feature `.pen` belongs with Q-0297 (feature `.pen` coverage).
- **The architecture `.pen` is not changed or checked.** `docs/design/architecture/baseline.pen` has its own layer-name contract (`checks arch-baseline`, ADR 0007), and its pages are views, not app areas. The entry's note asked for huge titles on "other `.pen` files too"; for the architecture canvas that goes back to the queue as Q-0298 (Huge View Titles on the Architecture .pen).
- **The check does not prove where an id came from.** The recommended id grammar (path ids built from test ids, aria labels, roles) is written down, not enforced. The check enforces what shifting ids break: duplicates, `/`, and counter families.
- **No new freshness status**, and no config switch to opt out of the contract.

## Design

### Structural context

The change lands in `src/design/pen-doc.ts`. It sits in its own small community (c98: the file and its test), with no god node — an interior module. Three modules read it from other communities:

- `src/design/ui-capture-cli.ts` (c36) calls `inspectBaseline` before it writes a receipt, for both a real capture and `--vouch-only`.
- `src/release/ui-design-freshness.ts` (c15) calls `inspectBaseline` on the committed baseline. Release preflight and `doctor` reach it through `evaluateUiDesignFreshness`.
- `src/design/design-approval-cli.ts` (c64) imports only `parsePenDocument` and `topLevelPages`, which this change leaves alone.

So one new call inside `inspectBaseline` reaches both enforcement points, and no import edge crosses a community line that did not before.

### Unit 1 — The contract

Written down in a new framework page, `docs/noldor/ui-baseline.md`. A baseline is `docs/design/ui/baseline/<surface>.pen`. The contract:

- **Pages are top-level frames.** No page is nested: every node whose name starts `FINAL:` is a direct child of the document. The review lanes enumerate only top-level `FINAL:<surface>:` frames (`render-export-dispatch.ts`, step 1), so a page inside a row frame is invisible to review.
- **Rows are labelled.** Each app area gets one row, and a top-level text node above it is the row's label. The label is the pages' sibling, never their parent, for the same reason. Every top-level text node counts as a row label; a top-level node that is neither a frame nor a text node (a group, a rectangle, a note) is neither a page nor a label, and the row rules skip it. The consumer picks the areas (charuy: Scene, Model pane, Bar & menus, Chat, Floor plan).
- **A row is a band.** It runs from its label's top edge down to the next label's top edge. Every page sits in exactly one band: its top edge at least one label font size below its label's top (so the title never covers the page), and its bottom edge no lower than the next label's top.
- **Titles are huge.** Every row label has `fontSize` of at least 200. On charuy's canvas that renders at 28–42 px at zoom-to-fit.
- **Twins sit together.** Read a row left to right by each page's `x`. The pages of one state are consecutive in that order — no other page between them — and in the order the surface's `modes` lists them (charuy: dark, then light). The gap between them is not part of the rule.
- **Ids are stable.** Unique across the document. Never containing `/` — the pen schema's `entity.id` pattern is `^[^/]+$`, because `/` separates a descendant path. Never taken from a counter.
- **Recommended id grammar** (written down, not enforced): page id `<state>-<mode>` — the id Q-0247's `uiCoverage` already expects; label id `area-<area>`; element id `<parent id>.<segment>`, where the segment is the kebab-cased `data-testid`, else the icon name, `aria-label`, slot, role, then layer name, with `-2`, `-3`… only on a repeated sibling. This is charuy's grammar from #228.

The page shows a small conforming example document and says how to read each finding below.

### Unit 2 — The layout check

A new module, `src/design/pen-layout.ts`, holds one pure function, `checkLayout(doc, opts)`, that returns `PenFinding[]`. Every finding is `red` and depends only on the file, never on the installed pen schema. The finding codes:

- `duplicate-id` — an id carried by more than one node. Names each such id. A declared page id carried twice is left to coverage's `duplicate-page`, so that baseline still reads `incomplete`.
- `slash-id` — an id containing `/`. Names the node.
- `counter-id` — ten or more ids of the form `<lowercase letters><integer>` that share their letters (`n1` … `n10`). Names the prefix and a few of the ids. A counting emitter makes a run as long as the document — charuy's pre-#228 baseline had 2264 `n` ids — so ten catches it with room to spare, while real names that end in a number (states `step1`, `step2`, `step3`) and editor-generated ids (5–6 mixed-case characters, such as `T7JlYn`) never reach ten on one prefix.
- `nested-page` — a node named `FINAL:…` below the top level. Names it and the top-level node that holds it.
- `page-outside-row` — a top-level frame with no label above it, starting less than one label font size below its label, or reaching past the next label. Names the page and which rule it breaks.
- `small-row-label` — a label under the minimum size. Names the label and its size.
- `twin-order` — checked only when the surface declares `uiCoverage.<surface>.modes`. Within each row, pages are ordered left to right by `x` (file order breaks a tie). A state whose pages are not consecutive in that order, or not in `modes` order, fails. Names the state. A page whose id is not `<state>-<mode>` for a declared state and mode is left out of this rule.

The minimum is one exported constant, `MIN_ROW_LABEL_FONT_SIZE = 200`. Row geometry reads `x`, `y`, `height` and `fontSize` as plain numbers; Error handling says what happens when one is not.

### Unit 3 — Wiring into the shared reader

`inspectBaseline` in `src/design/pen-doc.ts` appends `checkLayout` findings whenever the bytes parse, with or without declared coverage. It passes the declared `modes`, when there are any, for the twin rule.

There are no new call sites. `captureSurface` in `ui-capture-cli.ts` already refuses a receipt on any red finding — for a real capture and for `--vouch-only`. `withContent` in `ui-design-freshness.ts` already maps any red finding outside `COVERAGE_CODES` to `invalid`, which exits 1 and blocks release preflight. So a layout break reads `invalid` with the finding in the row's detail, and the remediation the row already names (re-capture, or `design ui-sync` by hand) is the right one. The meaning of `invalid` widens from "not a usable `.pen`" to "breaks the baseline contract".

### Unit 4 — Docs

- New page `docs/noldor/ui-baseline.md`, with its twin `templates/docs/noldor/ui-baseline.md` and a route row in `README.md`.
- `script-catalog.md` (and its template twin): the `design capture` and `checks ui-design-freshness` entries gain the layout findings and the wider meaning of `invalid`.
- Each layout finding's message ends with a pointer to the new page.
- The parent FD's Usage is refreshed at ship by gate Step 4.

### Error handling

- **Unparseable bytes:** `checkLayout` never runs; `validateBaseline` already reports `unparseable`.
- **Geometry that is not a number:** the pen schema types `x` and `y` as plain numbers, and a missing one reads as 0, the schema's default. A `height` the editor sizes to content (`fit_content`) or binds to a `$variable` cannot be measured, so that page skips only the next-label rule — the check never reds what it cannot measure.
- **A label whose `fontSize` is missing or not a plain number** (a `$variable` binding): it reports `small-row-label`, because the check cannot show it is at least 200, and its row skips the font-size gap rule, because there is nothing to measure.
- **No row labels at all** (a baseline from before this contract): the pages are reported together in one `page-outside-row` finding, not one finding per page, so the row's detail stays short.

### Testing

Unit tests in `src/design/__tests__/pen-layout.test.ts` build small documents in memory, one per rule, each asserting the finding code and the node it names. One fixture shaped like charuy's baseline (labelled rows, twins, path ids, 200 px labels) passes clean; one shaped like its pre-#228 baseline (counter ids, no labels) fails with `counter-id` and `page-outside-row`. The existing capture and freshness tests gain one case each proving a layout break refuses the receipt and reads `invalid`.

### Migration

charuy's committed baseline passes every rule except the title size — its labels are 48. After this ships and charuy upgrades, its freshness check reads `invalid` until it re-captures with labels of at least 200. That is a two-constant change in charuy's emitter (`fontSize` and `LABEL_HEIGHT` in `scripts/design/pen-emit.ts`). No other consumer has a UI baseline.

## Acceptance criteria

1. A baseline with two nodes sharing one id fails `design capture` (no receipt written, exit 1) and reads `invalid` in `checks ui-design-freshness` (exit 1); both name the id.
2. A baseline with an id containing `/` fails both the same way, naming the node.
3. A baseline with ten ids `n1` … `n10` fails both, naming the prefix. A document whose ids are editor-style random strings, or that holds states `step1`, `step2`, `step3`, passes.
4. A node named `FINAL:…` below the top level fails both, naming it.
5. A top-level frame whose top edge is above the first row label, or less than one label font size below its own label's top, or whose bottom edge is lower than the next label's top, fails both, naming the page. A page exactly one font size below its label, or whose bottom edge touches the next label, passes.
6. A row label with `fontSize` under 200 fails both, naming the label and its size.
7. With `uiCoverage.<surface>.modes` declared, a state whose pages have another page between them in their row's left-to-right order, or sit out of `modes` order, fails both, naming the state. Without declared modes, twin order is not checked.
8. A document laid out to the contract produces no layout finding — pinned by a fixture shaped like charuy's baseline.
9. Layout findings are red whether or not a pen schema is installed.
10. `docs/noldor/ui-baseline.md` exists with its template twin, and every layout finding's message points to it.

## Risks / trade-offs

- **charuy goes red on upgrade** until it re-captures (see Migration). Accepted: the title size is what the operator asked to fix, and the remedy is small and named in the finding.
- **The counter rule is a heuristic.** It catches the known failure (2264 `n` ids) and any emitter that counts with that shape, but an emitter could count with a different shape (`node-1`, `node-2`) and pass. Enforcing the full path grammar would close that, at the cost of every hand-authored baseline — see open question 2.
- **Widening `invalid`** makes a well-formed but badly laid-out baseline read the same status as a broken one. The detail tells them apart; a new status would touch the rank table, preflight, `doctor` and `ui-sync` for no difference in remedy.
- **Hand-authored baselines** (`design ui-sync`) must now add row labels. That is a few nodes per baseline.
- **Label height is estimated.** A text node with `textGrowth: auto` carries no height, so the check treats `fontSize` as the label's height — a lower bound, so the "title never covers the page" rule can only under-report.

## User Story

As an operator or agent who reads or edits a UI baseline, I want every baseline laid out in labelled rows with titles I can read at zoom-to-fit, with ids that never shift — and a capture that refuses a baseline that breaks this — so that I can find an app area at a glance and cite an element id that still means the same node after the next capture.

## Usage

- Write your capture command (or hand-author the baseline) to the contract in `docs/noldor/ui-baseline.md`: pages as top-level frames, one labelled row per area with a label of at least 200 px, twins side by side, unique ids with no `/` and no counters.
- `pnpm noldor design capture [--surface <name>]` refuses to write a receipt for a baseline that breaks the contract, and names the node.
- `pnpm noldor checks ui-design-freshness` reports such a baseline as `invalid`, with the finding in the row. Fix the emitter (or the file) and re-capture.

## Open questions (resolved)

1. *Where does the check bite: capture only, or capture and the freshness check?* → Both, through `inspectBaseline` (D1). The two already share that reader so they cannot disagree about a file; a capture-only check would let a hand edit break the layout and still read fresh until the next capture.
2. *Enforce the full path-id grammar, or only what shifting ids break?* → Only what shifting ids break: duplicates, `/`, counter runs (D2). Editor-generated ids are random but stable, so a hand-authored baseline and the gate Step 4 write-back stay legal; the grammar is documented for emitters that can follow it.
3. *A fixed title size, or one relative to the pages?* → Fixed: `fontSize` at least 200 (D3). One number is easy to state, emit and check; 200 renders at 28–42 px at zoom-to-fit on charuy's canvas, where 48 renders at 7–10.
4. *Does the "huge titles" note reach the architecture `.pen`?* → No; it goes back to the queue as Q-0298 (D4). Feature `.pen` files inherit the baseline's rows through Seed, but the architecture canvas has its own emitter, its own layer-name contract, and pages that are views rather than areas.
5. *A new freshness status for layout breaks, or reuse `invalid`?* → Reuse `invalid` and widen its meaning to "breaks the baseline contract" (D5). `withContent` already routes every non-coverage red there, the remedy is the same, and a new status would touch the rank table, preflight, `doctor` and `ui-sync` for nothing a reader can act on differently.
6. *Put the layout rules in `pen-doc.ts` or a new module?* → A new module, `src/design/pen-layout.ts` (D6). `pen-doc.ts` judges the document and its coverage; layout is its own concern with its own geometry helpers, and `pen-doc.ts` is already 265 lines.
7. *Check twin order everywhere?* → Only when the surface declares `modes` (D7). Without them, `empty-scene-dark` cannot be split into a state and a mode, so the rule has nothing to read.
8. *Do twins have to be neighbours in the file, or on the canvas?* → On the canvas: consecutive in the row's left-to-right order by `x`, with the gap unchecked (D8). The rule exists for a reader looking at the canvas, and file order is invisible there.
