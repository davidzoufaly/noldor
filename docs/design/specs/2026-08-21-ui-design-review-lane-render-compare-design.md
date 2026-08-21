# UI Render-Compare Lane — Design

**Slug:** ui-design-review-lane (attach: render-compare)
**FD:** docs/features/ui-design-review-lane.md
**Date:** 2026-08-21
**Tier:** specs-only
**Deps:** ui-design-review-lane (Q-0145, shipped PR #343), pendev-ui-design-phase (Q-0144, shipped PR #342)

UI verdict: skip — the enhancement touches CR-lane and config code only; the noldor consumer config declares no `uiPaths`.

## Problem

Q-0145's `ui-reviewer` lane reviews the *code text* against the `.pen` design: the child reads changed files and the design structure, and reasons about what the code would render. It never sees actual pixels. A CSS regression, a broken layout, a component that renders blank, or a route that 500s all pass structural review — the code plausibly renders the design, but the running app does not show it.

The roadmap entry (Q-0146) wants the mechanical half: boot the consumer's app, capture what a real route actually renders, and **pixel-diff** it against a raster of the committed feature `.pen` — a deterministic comparison, not a second model-judgment pass. It was deferred out of Q-0145 because it needs a per-consumer app-boot recipe — how to start the app, which route renders a surface — that did not exist. This spec defines that recipe and the lane that consumes it.

Two facts shape the design:

- **The design raster does not exist yet.** `.pen` is encrypted; pencil MCP is the only reader, and no headless `.pen` → PNG export path is verified to exist (probed 2026-08-21: every pencil MCP call requires a file already open in the editor, and no `.pen` exists in any repo to open). The feature therefore **blocks on an export spike**: implementation task 0 proves an export path or the session stops and the entry re-parks with the spike result recorded.
- **Two rendering engines never match pixel-perfectly.** A pencil canvas export and a browser screenshot differ on font rasterization, antialiasing, and sub-pixel layout even when the implementation is faithful. The diff is therefore a **coarse drift detector** — threshold-gated, catching layout breakage, blank renders, and moved/missing regions — while literal copy and element inventory remain the structural lane's job. The two lanes are complementary, not redundant.

## Goals

- A code-stage CR lane, `render-compare`, that boots the consumer's app from a declared recipe, captures per-surface screenshots of real routes, rasterizes the session's approved `FINAL:` pages, and pixel-diffs the pair deterministically — no dispatched reviewer judgment in the verdict.
- A `consumer.uiBoot` recipe schema that reuses `verifyCommands` for boot/health and declares route + screenshot capture per surface.
- An explicit, machine-recorded capability gate: the `.pen` export spike is implementation task 0, and its failure stops the feature honestly instead of shipping a lane that can never run.
- Same honesty contract as Q-0145: every terminating path writes exactly one sink; `verdict`/`reason` say what actually happened; advisory by default, blocking behind a knob.
- Reuse, not duplication: target resolution (`resolveUiReviewTarget`), scratch-copy + sha256 integrity, sink conventions, and the reason-code vocabulary all extend Q-0145's implementation.

## Non-goals

- **Model-judgment comparison.** A child reasoning over screenshots is Q-0145's failure mode with extra steps; the verdict here is computed by a diff algorithm. A dispatched agent appears in exactly one role: running the export script against the scratch `.pen` when export requires pencil MCP (see R5) — it exports, it does not judge.
- **Fine-grained inventory/copy findings.** Font-level and text-level fidelity is the structural lane's territory; this lane's findings are regions and percentages, not element narratives.
- **Reaching arbitrary app states.** v1 captures each surface's declared route as-rendered (default state). `FINAL:` pages whose state the route does not show are named in `notes` as uncaptured, never silently dropped. A state-script convention is a later slice.
- **Replacing the `ui-reviewer` lane.** Sibling, not successor; a consumer can run either or both.
- **Design-side quality judgment, baseline review, spec/plan-stage variants** — same exclusions as Q-0145, same reasons.

## Design

### R0 — Export spike (capability gate, implementation task 0)

Before any lane code: prove a headless-enough `.pen` → PNG path. Candidate mechanisms, tried in order: (1) a pencil MCP `execute` script against an open scratch `.pen` that renders/exports a page to PNG bytes on disk — the script API surface is undocumented from outside an open file, so this is discovery, not implementation; (2) a pencil desktop CLI export flag, if one exists. The spike's deliverable is a recorded result either way: a working export invocation (command/script + constraints, e.g. "editor app must be running") written into this spec's R5, or a negative result written to the roadmap when the entry re-parks. **A failed spike stops this feature at zero lane code shipped** — the recipe schema and lane units below are specified but not built. This unit exists because the operator chose the pixel-diff mechanism knowing the export path is unproven; the gate converts that risk into a bounded first task instead of a mid-implementation surprise.

### R1 — Lane and role registration

`'render-compare'` joins `CANONICAL_LANES` in [`src/core/lanes.ts`](../../../src/core/lanes.ts) and — only if the spike lands on MCP-mediated export — `AGENT_ROLES` in [`src/core/agent-runner/types.ts`](../../../src/core/agent-runner/types.ts), so a consumer can pin the exporter child to a pencil-capable runner. Opt-in via `crLanes.code`; not in `DEFAULT_CR_LANES`. Code-only (rejected at `--kind spec|plan` with the existing message). Excluded from the delta short-circuit for the same reason `ui-reviewer` is: the review object is the running app, not the `--artifact` label. `inferLaneFromFilename`'s longest-first matching (Q-0145 U2) already handles the new name with no code change.

### R2 — Boot recipe (`consumer.uiBoot`)

New consumer-config block, validated by `validate noldor-config`:

```json
"uiBoot": {
  "dashboard": {
    "verifyCommand": "dashboard",
    "route": "/",
    "screenshotCommand": "npx playwright screenshot --viewport-size={width},{height} {url} {out}"
  }
}
```

Keyed by **surface name** — the same names `uiSurfaces` declares, which is what ties a recipe to the `FINAL:<surface>:` pages it captures. `verifyCommand` references an existing `consumer.verifyCommands` entry of `kind: "server"` (reusing its `command`, `healthPath`, `readyTimeoutMs` — boot is not respecified); `route` is the path that renders the surface; `screenshotCommand` is a consumer-owned template with `{url}`, `{out}`, `{width}`, `{height}` placeholders, following the `{port}` templating precedent. `{width}`/`{height}` are filled from the exported design raster's dimensions so the two images are size-comparable by construction. Validation cross-checks that `verifyCommand` resolves and that recipe keys exist in `uiSurfaces`.

### R3 — Firing predicate and target resolution (reused)

Identical inputs to Q-0145 U3/U4, by calling the same `resolveUiReviewTarget` ([`src/cr/lanes/ui-design-resolve.ts`](../../../src/cr/lanes/ui-design-resolve.ts)): whole-feature range from `resolveDefaultBase`, `sessionUiVerdict` over the real diff, waiver/`kind: 'none'` handling, ownership-gated `.pen` resolution — every terminal it returns maps to this lane's sink unchanged. One addition after resolution: affected surfaces with **no `uiBoot` recipe**. The bootable subset is reviewed; unbootable surfaces are named in `notes`; zero bootable surfaces is `cannot-review` (`no-boot-recipe`).

### R4 — Boot and capture (screenshot half)

Extract the boot/probe/kill machinery from `runSmoke` ([`src/verify/smoke.ts`](../../../src/verify/smoke.ts)) into a shared helper rather than copying it: pre-boot occupancy check, detached own-process-group spawn, `waitForHttp200` against `healthPath`, SIGKILL of the process group on every exit path. Port resolution follows the worktree dev-surfaces convention ([`src/worktrees/dev-surfaces.ts`](../../../src/worktrees/dev-surfaces.ts) — exact helper pinned at implementation). Then per affected surface: run `screenshotCommand` with `{url}` = `http://127.0.0.1:{port}{route}`, `{out}` = a path in the lane's scratch dir, `{width}`/`{height}` = the design raster's dimensions (R5 runs first). Non-zero exit or a missing/empty output file is `screenshot-failed`; boot failure is `boot-failed`. Both are `cannot-review` classes, never silent.

### R5 — Design raster export

The mechanism the R0 spike proved, run per in-scope `FINAL:` page against the **scratch copy** of the `.pen` (scratch-copy + sha256-before/after integrity reused verbatim from `ui-review.ts`; `pen-modified` reds in both modes). If export is MCP-mediated, the lane dispatches one exporter child (role `render-compare`) whose entire instruction is: open the scratch `.pen`, export the named pages to the named output paths, report the file list — no judgment, no findings; its output is validated by the files existing and parsing as PNG, not by trusting the report. If export is CLI-mediated, no child is dispatched at all. Export failure per page is `export-failed`; a page exported with unparseable/zero-dimension output is the same code. The exported raster's dimensions feed R4's `{width}`/`{height}`. This section is finalized by the spike: the invocation, its environmental constraints (e.g. editor app running — which likely confines the lane to interactive sessions and is recorded as an adoption constraint if so), and the child role's existence are all spike outputs.

### R6 — Diff engine and thresholds

`pixelmatch` + `pngjs` join the framework's dependencies (small, pure-JS, no native/browser footprint — unlike playwright, which stays consumer-side). Per surface: compare screenshot vs design raster at equal dimensions; a dimension mismatch after R4's sizing is `dimension-mismatch` (`cannot-review` — something in the capture pipeline lied, do not resize-and-pretend). The verdict is threshold-gated, tuned for coarse drift: `diffRatio = differing pixels / total pixels` with pixelmatch's per-pixel `threshold` at a forgiving default (anti-aliasing tolerant), and a surface fails when `diffRatio > maxDiffRatio` (default `0.25`, per-recipe override `"maxDiffRatio": 0.1` in `uiBoot.<surface>`). Defaults are deliberately loose: cross-engine rendering guarantees a nonzero floor, and the lane's job is layout breakage, blank renders, and moved/missing regions — not font fidelity. A `fail` finding carries the surface, both image paths (design raster + screenshot, both persisted into `.noldor/cr/render-compare/<slug>/` so the operator can look), the diff image path, and the ratio vs the threshold. `pass` carries the ratios in `notes` so a creeping ratio is visible before it crosses.

### R7 — Verdicts, reasons, mode knob

Sink at `.noldor/cr/<slug>-code-render-compare.json`, same `laneFindingsSchema` shape, same verdict vocabulary (`pass | fail | cannot-review | not-applicable`). New reason codes joining the closed vocabulary: `no-boot-recipe`, `boot-failed`, `route-unreachable`, `screenshot-failed`, `export-failed`, `dimension-mismatch`. All applicable Q-0145 codes (`no-feature-pen`, `ambiguous-design`, `pen-modified`, `scratch-unavailable`, `range-unresolvable`, …) apply unchanged. Mode knob: `autonomous.renderCompareMode` (`'blocking' | 'advisory'`, default `'advisory'`), separate from `uiReviewMode` — an adopter's confidence in structural review and in a booted-app pixel pipeline diverge. Same mode matrix as Q-0145 U6: advisory `fail` → `low` suggestions with `ok: true`; blocking `fail` → blockers (severity `high` when `diffRatio > 2×maxDiffRatio` or the render is blank, else `med`) with `ok: false`; `pen-modified` reds in both modes.

### R8 — Gate wiring and docs

`orchestrate.ts` gains `'render-compare': runRenderCompare` in `LANES`; code-only rejection extended; `renderCompareMode` joins the autonomous config schema. Docs: one row in the CR-lane table ([`docs/noldor/cr-pipeline.md`](../../../docs/noldor/cr-pipeline.md), which already names this feature as deferred), the `uiBoot` schema in the config reference, `templates/` twins in the same pass. Gate prose: opt-in code lane, no new step.

## Acceptance criteria

1. The R0 spike result is recorded before any lane code: a working export invocation in this spec, or a re-parked entry carrying the negative result — a session that shipped lane code without a recorded spike outcome is a spec violation.
2. `render-compare` is accepted in `crLanes.code`, absent from `DEFAULT_CR_LANES`, rejected at `--kind spec|plan`, and excluded from the delta short-circuit.
3. `validate noldor-config` rejects a `uiBoot` entry whose `verifyCommand` does not resolve to a `kind: "server"` verify command or whose key is not in `uiSurfaces`; an invalid `renderCompareMode` or non-numeric/out-of-range `maxDiffRatio` is rejected; defaults are `advisory` and `0.25`.
4. A verdict-`skip` round writes `not-applicable` without booting; a waived session writes `not-applicable` (`waived`); zero bootable affected surfaces writes `cannot-review` (`no-boot-recipe`).
5. Boot failure, screenshot failure, export failure, and dimension mismatch write mutually distinguishable reason codes, and the app process group is killed on every exit path including timeouts and sink-write failure.
6. The repo's `.pen` is sha256-identical across the round; a mismatch writes the `pen-modified` high blocker in both modes; export always runs against the scratch copy.
7. The diff is deterministic: same screenshot + same raster + same config ⇒ identical verdict and ratio; no agent output influences pass/fail (an exporter child, when one exists, is validated by produced files only).
8. A `fail` finding names the surface, persists design raster + screenshot + diff image under `.noldor/cr/render-compare/<slug>/`, and states the ratio vs threshold; a `pass` sink carries per-surface ratios in `notes`.
9. Mode matrix holds: advisory `fail` → `low` suggestions, `ok: true`; blocking `fail` → blockers with the R7 severity rule, `ok: false`; blocking `cannot-review` reds, advisory does not.
10. Every terminating path writes exactly one schema-valid sink (Q-0145's U6b table plus the new boot/capture/export rows), except a sink-write failure, which reds via `unresolved`; `ui-reviewer` and `render-compare` sinks coexist without filename misattribution.
11. Consumer docs and `templates/` twins carry the lane row, the `uiBoot` schema (including `maxDiffRatio`), and the `renderCompareMode` key; template-sync passes.

## Risks / trade-offs

- **The export spike can fail, and the feature dies at task 0.** Accepted knowingly: the operator chose pixel-diff over a shippable-today judgment hybrid. The spike is cheap, its negative result re-parks the entry with evidence, and no half-built lane ships.
- **Export may be editor-bound.** If the only working path requires the pencil desktop app running, the lane is unusable in headless CI — an adoption constraint recorded at spike time, not discovered by consumers. Advisory default means it degrades to `cannot-review` (`export-failed`) there, honestly.
- **Cross-engine rendering floor.** Fonts and antialiasing guarantee nonzero diff ratios on faithful implementations; the loose default threshold trades sensitivity for signal. A consumer chasing precision tightens `maxDiffRatio` per surface and owns the false-positive rate.
- **Dynamic app content.** Live data behind a route differs from design placeholders and inflates ratios; the loose threshold absorbs some, masking/state-scripting is the deferred slice. Named per-surface override is the interim remedy.
- **Consumer-owned screenshot command.** `npx playwright screenshot` requires the consumer's toolchain; the framework adds only pixelmatch+pngjs. A consumer without a browser cannot adopt — `screenshot-failed` names it.
- **Boot cost per round.** Seconds-to-minutes per code round; opt-in and short-circuit-excluded, so adopters pay knowingly.

## User Story

As an agent shipping a UI-bearing feature, I want the code-stage CR to boot the app and pixel-diff what a real route renders against the design my session approved, so that regressions invisible in code text — broken layout, blank renders, moved or missing regions — are caught deterministically before merge.

## Usage

Declare the recipe and opt in, per consumer, in `.noldor/config.json`:

```json
{
  "consumer": {
    "uiSurfaces": { "dashboard": ["src/dashboard/**"] },
    "uiBoot": {
      "dashboard": {
        "verifyCommand": "dashboard",
        "route": "/",
        "screenshotCommand": "npx playwright screenshot --viewport-size={width},{height} {url} {out}",
        "maxDiffRatio": 0.25
      }
    }
  },
  "crLanes": { "code": ["reviewer", "render-compare"] },
  "autonomous": { "renderCompareMode": "advisory" }
}
```

The ordinary code-stage round then runs it:

```
pnpm noldor cr orchestrate --slug <slug> --artifact <code-paths> --kind code \
  --lanes reviewer,render-compare --base-sha origin/main
pnpm noldor cr aggregate --slug <slug> --kind code
```

Sink: `.noldor/cr/<slug>-code-render-compare.json`. Read `verdict` before `blockers`; `reason` names why a review did not happen (`no-boot-recipe`, `boot-failed`, `screenshot-failed`, `export-failed`, …). On a `fail`, open the persisted diff image under `.noldor/cr/render-compare/<slug>/` before arguing with the ratio. Flip `renderCompareMode` to `blocking` once the pipeline is reliable in your CI.

## Open questions (resolved)

1. *Pixel diff or model comparison?*
   -> True pixel-diff, blocking on the export spike (D1, operator-decided). Model judgment over screenshots is Q-0145 with extra steps; the entry's value is a deterministic verdict.
2. *What if the export path does not exist?*
   -> R0 spike as implementation task 0; a negative result re-parks the entry with evidence and zero lane code ships (D-spike). Cheaper than discovering it mid-build.
3. *Where does the boot recipe live?*
   -> `consumer.uiBoot`, keyed by surface, referencing `verifyCommands` for boot/health (D2). Boot machinery exists and is consumer-owned; respecifying per lane would drift.
4. *Who takes the screenshot?*
   -> The lane, via a consumer-declared `screenshotCommand` template (D3). Framework stays browser-free; capture stays mechanical and runner-independent.
5. *New lane or a mode of `ui-reviewer`?*
   -> New sibling lane `render-compare` (D4). Different failure surface, different trust curve, independent adoption decision.
6. *Same mode knob as `ui-reviewer`?*
   -> Separate `renderCompareMode`, default advisory (D5). Confidence in the two pipelines diverges, especially in CI.
7. *How do two rendering engines compare without permanent redness?*
   -> Coarse-drift thresholds: anti-aliasing-tolerant pixelmatch, `maxDiffRatio` default 0.25 with per-surface override (D6). The lane detects breakage, not font fidelity — that split is what keeps both lanes honest.
8. *`FINAL:` pages whose state the route cannot show?*
   -> Uncaptured pages named in `notes`, never silently dropped; state-reach is a later slice (D7).
9. *Partial recipe coverage?*
   -> Review the bootable subset, name the gap in `notes`; wholesale `no-boot-recipe` only at zero (D8). A partial honest review beats none.
