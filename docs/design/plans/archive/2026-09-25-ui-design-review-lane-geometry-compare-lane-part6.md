# Geometry Compare Lane — Part 6: Adoption Docs Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** A consumer can adopt `geometry-compare` from the docs alone: what it compares, what it cannot see, how to opt in, where the evidence is, and how to reproduce a lane row by hand.
**Architecture:** Documentation only, over the lane parts 1–5 shipped. `cr-pipeline.md` gains an H2 lane section beside `## Render-compare lane`, the lane joins the refutation judge's exclusion list, the boot sentence describes the three-lane chain, and `adoption-guide.md`'s `uiBoot` row gains the geometry fields — each page with its `templates/docs/noldor/` twin. The FD gets its Usage paragraph, `opt-in` key and links. The comparison is described as the covering test the shipped core runs, never as clustering or matching.
**Tech Stack:** Markdown, the repo's doc checks (`template-sync`, `validate features`).

**Depends on:** parts 1–5 (the documented commands, recipe fields, reason codes, lane and chain must exist).

---

## File Structure

- `docs/noldor/cr-pipeline.md` + `templates/docs/noldor/cr-pipeline.md` — `## Geometry-compare lane`, the judge-exclusion list, the boot-chain sentence (Modify).
- `docs/noldor/adoption-guide.md` + `templates/docs/noldor/adoption-guide.md` — the `uiBoot` row (Modify).
- `docs/features/ui-design-review-lane.md` — Usage paragraph for the lane, `opt-in`, `links` (Modify).

---

## Task 1: Document the lane for adoption

**Files:**
- Modify: `docs/noldor/cr-pipeline.md`, `templates/docs/noldor/cr-pipeline.md`, `docs/noldor/adoption-guide.md`, `templates/docs/noldor/adoption-guide.md`, `docs/features/ui-design-review-lane.md`

- [ ] **Step 1: Confirm the gap.**

```bash
grep -c 'geometry-compare' docs/noldor/cr-pipeline.md docs/noldor/adoption-guide.md
```

Expected output: `docs/noldor/cr-pipeline.md:0` and `docs/noldor/adoption-guide.md:0`.

- [ ] **Step 2: Update the judge-exclusion list and the boot sentence.** In `docs/noldor/cr-pipeline.md`, in `## Refutation judge`, replace the bullet `- anything from the \`manual\`, \`verifier\`, \`ui-reviewer\` or \`render-compare\` lanes.` with:

```markdown
- anything from the `manual`, `verifier`, `ui-reviewer`, `render-compare` or `geometry-compare` lanes.
```

In `## Render-compare lane`, in the **Boot** bullet, replace the sentence that begins `When \`verifier\` shares the round, render-compare starts only after it` and ends `the two lanes boot the same servers.` with:

```markdown
The booting lanes run as a chain — `verifier`, then `render-compare`, then
  `geometry-compare` — each starting only after the previous resolves, because
  they boot the same servers and two dev servers over one project directory
  contend on the same build cache.
```

- [ ] **Step 3: Add the lane section.** In `docs/noldor/cr-pipeline.md`, insert immediately before `## Deferred (post-MVP)`:

````markdown
## Geometry-compare lane

The `geometry-compare` lane (code artifacts only) is the layout sibling of
`render-compare`. It is for surfaces whose design cannot be pixel-faithful:
SVG-driven effects, shaders, generated artwork, platform text rendering. It
compares **layout values** (alignment edges, font sizes, declared spacing)
instead of diffing rasters, so a faithful implementation of an effect pen cannot
draw does not read as drift.

How it runs:

- **Firing, design resolution and boot** match `render-compare`: the same
  `resolveUiReviewTarget`, the same whole-design fallback when no affected
  surface resolves, and the same per-`verifyCommand` boot with a retried route
  probe (`forEachBootedSurface`). A surface without a recipe, or whose recipe has
  no `geometryCommand`, is a full `no-geometry-recipe` outcome.
- **Design side:** one dispatched child (`role: geometry-extract`) opens a scratch
  copy of the `.pen` through pencil MCP. For the selected `FINAL:` page it writes a
  normalized document (`geometryDocSchema`): each node's page-relative box, the
  `fontSize` and text of text nodes, and the declared `gap` / `padding` of frames.
  The child reports the page candidates and Node re-runs the page selection. Nodes
  pen reports clipped are left out and named in the round's notes.
- **Implementation side:** the recipe's `geometryCommand` renders the route at the
  design page's own size and writes the same document. It takes `{url}` `{out}`
  `{width}` `{height}`, single-quoted exactly like `screenshotCommand`, and
  receives the surface name as `NOLDOR_GEOMETRY_SURFACE`. `noldor init` scaffolds a
  reference Playwright producer at `scripts/geometry-capture.mjs`, which the
  consumer owns from then on.
- **Comparison:** four families. `edgesX` and `edgesY` hold every box's two edges
  on each axis, `fontSize` holds text nodes only, and `spacing` holds declared
  gaps and padding. Each family is a **covering test** at its tolerance (defaults:
  `edgesX` / `edgesY` 2px, `fontSize` 1px, `spacing` 1px). A value is unmatched
  when nothing on the other side sits within tolerance of it (`unmatchedValues`
  in `geometry-compare-core.ts`). The edge and font-size families count both
  directions. `spacing` counts design-only values alone, so an implementation
  `margin` can satisfy a design `gap`, and UA-stylesheet margins and negative
  gutters fail nothing. A family fails when its unmatched count exceeds its
  budget, which defaults to 0. Viewports that differ by more than 1px give
  `viewport-mismatch`, and a side with no nodes gives `geometry-empty`.
- **Verdicts** land in `.noldor/cr/<slug>-code-geometry-compare.json`. Each failing
  family gets one finding that names the unmatched values and the nodes behind
  them. Severity is `med` for 1–2 unmatched values and `high` for 3 or more. The
  worst outcome wins (`fail` > `cannot-review` > `pass`), and `pen-modified`
  overrides everything in both modes.
- **Evidence:** `.noldor/cr/geometry-compare/<slug>/<surface>.{design,impl,report}.json`,
  swapped in atomically per round. A round that produced no documents keeps the
  prior set, and a round that cannot persist its evidence is `persist-failed`.
  The report lists every value per side and, for each unmatched value, its family,
  side and producing nodes. Open it before arguing with a count.

Reason codes for a surface that could not be compared: `no-geometry-recipe`,
`geometry-extract-failed`, `geometry-capture-failed`, `geometry-unparseable`,
`geometry-empty`, `viewport-mismatch`, plus the shared `boot-failed`,
`route-unreachable`, `page-ambiguous` and `persist-failed`. An ordinary layout
mismatch has no reason code: it is a `fail` with findings.

Policy: `autonomous.geometryCompareMode: "blocking" | "advisory"` (default
`advisory`). It is separate from `renderCompareMode` because trust in a layout
diff and trust in a pixel diff diverge. Advisory mode turns fail findings into
`low` suggestions and greens `cannot-review`; blocking mode reds both.

Known limits (accepted, not bugs): the comparison is over populations of values,
not per element, so a node that moves onto an alignment value the surface already
uses is invisible. Spacing is one-directional, so padding the implementation adds
without the design declaring it is invisible. Running both design lanes costs two
app boots per round. The capture script is scaffold-only, so a later
`geometryDocSchema` change does not reach a consumer through `init --update`; a
stale producer shows up as `geometry-unparseable`, not as a wrong comparison.

Opt in per consumer:

```json
{
  "consumer": {
    "uiBoot": {
      "dashboard": {
        "verifyCommand": "dashboard",
        "route": "/",
        "geometryCommand": "node scripts/geometry-capture.mjs {url} {out} {width} {height}",
        "geometryTolerance": { "edgesX": 2, "edgesY": 2 },
        "geometryBudget": { "edgesX": 0, "edgesY": 0, "fontSize": 0, "spacing": 0 }
      }
    }
  },
  "crLanes": { "code": ["reviewer", "geometry-compare"] },
  "autonomous": { "geometryCompareMode": "advisory" }
}
```

Each piece can be run by hand: `design geometry-export` (design side),
`design geometry-validate` (a capture script's output), `design geometry-diff`
(two documents), and `design geometry-review` (a whole surface against a running
app, with the same reason codes as the lane). The lane is opt-in, code-only, and
excluded from the delta short-circuit for the same reason `render-compare` is.
````

- [ ] **Step 4: Update the adoption guide's `uiBoot` row.** In `docs/noldor/adoption-guide.md`, replace the whole table row that starts `| \`uiBoot\`            |` with:

```markdown
| `uiBoot`            | Per-surface boot recipes for the `render-compare` and `geometry-compare` CR lanes: `{ "<surface>": { "verifyCommand": "<verifyCommands server entry>", "route": "/…", "page": "<FINAL: page name>", "screenshotCommand": "… {url} {out} {width} {height}", "geometryCommand": "node scripts/geometry-capture.mjs {url} {out} {width} {height}", "geometryTolerance": { "edgesX": 2 }, "geometryBudget": { "edgesX": 0 }, "maxDiffRatio": 0.25, "captureTimeoutMs": 60000 } }`. Keys must be declared in `uiSurfaces`; a recipe carries at least one of `screenshotCommand` (render-compare) and `geometryCommand` (geometry-compare); every placeholder substitutes single-quoted; routes carry a narrow charset; `geometryTolerance` / `geometryBudget` are partial records over `edgesX`, `edgesY`, `fontSize`, `spacing` (unnamed families keep their defaults). Optional. Pair with `autonomous.renderCompareMode` / `autonomous.geometryCompareMode` (`"advisory"` default \| `"blocking"`). Full contract in [cr-pipeline.md](cr-pipeline.md#render-compare-lane) and [cr-pipeline.md](cr-pipeline.md#geometry-compare-lane). |
```

- [ ] **Step 5: Mirror both pages into their template twins.** Apply Steps 2–4 identically to `templates/docs/noldor/cr-pipeline.md` and `templates/docs/noldor/adoption-guide.md` (each twin is byte-identical to its page today), then verify:

```bash
diff docs/noldor/cr-pipeline.md templates/docs/noldor/cr-pipeline.md && diff docs/noldor/adoption-guide.md templates/docs/noldor/adoption-guide.md && pnpm noldor checks template-sync
```

Expected output: no diff output, and `template-sync` exits 0.

- [ ] **Step 6: Update the FD.** In `docs/features/ui-design-review-lane.md`:

1. Under `opt-in:` in the frontmatter, add `  - crLanes.code=geometry-compare` after `  - crLanes.code=render-compare`.
2. Under `links.code:`, add each of these that is not listed yet: `src/cr/lanes/geometry-compare.ts`, `src/cr/lanes/boot-probe.ts`, `src/cr/lanes/round-artifacts.ts`, `src/cr/geometry/geometry-review.ts`, `src/cr/geometry/geometry-review-cli.ts`, `src/cr/geometry/geometry-report.ts`.
3. In the **Geometry compare** paragraph, change `Three families are compared.` to `Four families are compared.`.
4. In the paragraph that starts `Exit 0 within budget, 1 on drift`, replace the sentence `Reading them back against the two documents is how you find the node responsible; the persisted per-round evidence report that lists nodes beside each value belongs to the parked lane (\`Q-0180\`), not to these commands.` with `Reading them back against the two documents is how you find the node responsible; the lane's per-round report does that for you.` Then replace the paragraph's last sentence, the one beginning `The lane that runs this per surface against a booted app is parked as roadmap entry`, with the new paragraph below, placed directly before `## PRs`:

````markdown
**Geometry-compare lane (Q-0180).** The `geometry-compare` lane runs this comparison per affected surface against the booted app in a code-stage CR round. The design side comes from a pencil-MCP reader child (`geometry-extract`), and the implementation side from your recipe's `geometryCommand`, which gets the surface name as `NOLDOR_GEOMETRY_SURFACE`. `noldor init` scaffolds `scripts/geometry-capture.mjs` as a starting producer. Opt in alongside `render-compare` or instead of it:

```json
{
  "crLanes": { "code": ["reviewer", "render-compare", "geometry-compare"] },
  "autonomous": { "geometryCompareMode": "advisory" },
  "consumer": {
    "uiBoot": {
      "app": {
        "verifyCommand": "web",
        "route": "/",
        "geometryCommand": "node scripts/geometry-capture.mjs {url} {out} {width} {height}",
        "geometryBudget": { "edgesX": 0, "edgesY": 0, "fontSize": 0, "spacing": 0 }
      }
    }
  }
}
```

Sink: `.noldor/cr/<slug>-code-geometry-compare.json`, with one finding per failing family (`med` for 1–2 unmatched values, `high` for 3+). A surface with no `geometryCommand` is `no-geometry-recipe`, so partial coverage never reads `pass`. Evidence: `.noldor/cr/geometry-compare/<slug>/<surface>.report.json` lists every value and the nodes behind each unmatched one. Spacing stays design-only here too. To reproduce a lane row by hand against a running app, run `pnpm noldor design geometry-review --pen <file.pen> --surface app --url http://localhost:5173/ --capture "node scripts/geometry-capture.mjs {url} {out} {width} {height}"`; for the design half alone, run `pnpm noldor design geometry-export --pen <file.pen> --surface app --out design.json`. The booting lanes run one after another (`verifier`, `render-compare`, `geometry-compare`). The design side needs a live pencil bridge, so headless CI degrades to `cannot-review` (`geometry-extract-failed`), advisory by default.
````

- [ ] **Step 7: Refresh the FD's test links.** `links.tests` is tag-driven; sync only this FD:

```bash
pnpm noldor sync test-links --slug ui-design-review-lane && git diff --stat -- docs/features/
```

Expected output: only `docs/features/ui-design-review-lane.md` changes. Its `links.tests` gains the parts 3–5 test files (`run-capture.test.ts`, `round-artifacts.test.ts`, `boot-probe.test.ts`, `geometry-review.test.ts`, `geometry-review-cli.test.ts`, `geometry-registration.test.ts`, `geometry-report.test.ts`, `geometry-compare.test.ts`) plus any part 2 file not yet listed.

- [ ] **Step 8: Format and verify.**

```bash
pnpm fmt && pnpm noldor checks template-sync && pnpm noldor validate features
```

Expected output: `oxfmt` reflows any pasted block; both checks exit 0.

- [ ] **Step 9: Commit.**

```bash
cat > /tmp/geo-p6t1.msg <<'MSG'
docs(features:ui-design-review-lane): document the geometry-compare lane

A consumer can only adopt the lane if the docs say what it compares, what it
cannot see and how to opt in. cr-pipeline gets a Geometry-compare lane section
covering both document producers, the covering test with its per-family
tolerances and budgets, the one-directional spacing rule, the derived severity,
the reason codes, the evidence report and the opt-in snippet. The lane joins the
judge-exclusion list, and the boot sentence now describes the three-lane chain.
The adoption guide's uiBoot row gains geometryCommand and the partial family
records. Both pages are mirrored into their template twins. The FD gets the
opt-in key, the new code links, synced test links and a Usage paragraph for the
lane.

Noldor-FD: ui-design-review-lane
Noldor-Sibling-Scope: noldor:cr-pipeline, noldor:adoption-guide
MSG
git add docs/noldor/cr-pipeline.md templates/docs/noldor/cr-pipeline.md docs/noldor/adoption-guide.md templates/docs/noldor/adoption-guide.md docs/features/ui-design-review-lane.md
git commit -F /tmp/geo-p6t1.msg
```

---

## Task 2: The full gate

**Files:**
- None (verification only).

- [ ] **Step 1: Run the whole gate.**

```bash
pnpm verify && pnpm noldor doctor && pnpm noldor checks push-gates
```

Expected output: `pnpm verify` exits 0. It runs the repo's own chain: lint, `fmt:check`, typecheck, the full test suite and `triage validate --strict-refs`. `doctor` reports no new red; a missing `gh` binary is the one pre-existing exception. `checks push-gates` exits 0, with the clones and indirection ratchets green against the baselines parts 3–5 recorded.
