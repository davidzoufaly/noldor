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

- A code-stage CR lane, `render-compare`, that boots the consumer's app from a declared recipe, captures per-surface screenshots of real routes, rasterizes each surface's selected `FINAL:` page, and pixel-diffs the pair deterministically — no dispatched reviewer judgment in the verdict.
- A `consumer.uiBoot` recipe schema that reuses `verifyCommands` for boot/health and declares route, page selection, and screenshot capture per surface.
- An explicit, machine-recorded capability gate: the `.pen` export spike is implementation task 0, and its failure stops the feature honestly instead of shipping a lane that can never run.
- Same honesty contract as Q-0145: every terminating path writes exactly one sink; `verdict`/`reason` say what actually happened; advisory by default, blocking behind a knob.
- Reuse, not duplication: target resolution (`resolveUiReviewTarget`), scratch-copy + sha256 integrity, sink conventions, and the reason-code vocabulary all extend Q-0145's implementation.

## Non-goals

- **Model-judgment comparison.** A child reasoning over screenshots is Q-0145's failure mode with extra steps; the verdict here is computed by a diff algorithm. A dispatched agent appears in exactly one role: running the export script against the scratch `.pen` when export requires pencil MCP (see R5) — it exports, it does not judge.
- **Fine-grained inventory/copy findings.** Font-level and text-level fidelity is the structural lane's territory; this lane's findings are regions and ratios, not element narratives. Corollary, stated as a limitation in Risks: a blank render diffed against a mostly-blank design page scores a low ratio and passes here — the structural lane's inventory check is the guard for that case.
- **Reaching arbitrary app states.** v1 captures each surface's declared route as-rendered (default state) and diffs it against one selected `FINAL:` page per surface. Non-selected `FINAL:` pages are named in `notes` as unreviewed, never silently dropped. A state-script convention is a later slice.
- **Replacing the `ui-reviewer` lane.** Sibling, not successor; a consumer can run either or both.
- **Design-side quality judgment, baseline review, spec/plan-stage variants** — same exclusions as Q-0145, same reasons.

## Design

### R0 — Export spike (capability gate, implementation task 0)

Before any lane code: prove a headless-enough `.pen` → PNG path. Candidate mechanisms, tried in order: (1) a pencil MCP `execute` script against an open scratch `.pen` that renders/exports a page to PNG bytes on disk — the script API surface is undocumented from outside an open file, so this is discovery, not implementation; (2) a pencil desktop CLI export flag, if one exists. The spike's deliverable is a recorded result either way: a working export invocation (command/script + constraints, e.g. "editor app must be running") written into R5's *Export invocation* subsection, or a negative result recorded via the sanctioned intake flow — an `ideas.md` bullet carrying the evidence, triaged back onto the roadmap by `/noldor-triage` (roadmap files are never hand-edited outside triage/promote). **A failed spike stops this feature at zero lane code shipped** — the recipe schema and lane units below are specified but not built. This unit exists because the operator chose the pixel-diff mechanism knowing the export path is unproven; the gate converts that risk into a bounded first task instead of a mid-implementation surprise.

### R1 — Lane and role registration

`'render-compare'` joins `CANONICAL_LANES` in [`src/core/lanes.ts`](../../../src/core/lanes.ts) and — only if the spike lands on MCP-mediated export — `AGENT_ROLES` in [`src/core/agent-runner/types.ts`](../../../src/core/agent-runner/types.ts), so a consumer can pin the exporter child to a pencil-capable runner. Opt-in via `crLanes.code`; not in `DEFAULT_CR_LANES`. Code-only (rejected at `--kind spec|plan` with the existing message). Excluded from the delta short-circuit for the same reason `ui-reviewer` is: the review object is the running app, not the `--artifact` label. `inferLaneFromFilename`'s longest-first matching (Q-0145 U2) already handles the new name with no code change.

### R2 — Boot recipe (`consumer.uiBoot`)

New consumer-config block, validated by `validate noldor-config`:

```json
"uiBoot": {
  "dashboard": {
    "verifyCommand": "dashboard",
    "route": "/",
    "page": "overview",
    "screenshotCommand": "npx playwright screenshot --viewport-size={width},{height} {url} {out}",
    "maxDiffRatio": 0.25,
    "captureTimeoutMs": 60000
  }
}
```

Keyed by **surface name** — the same names `uiSurfaces` declares, which ties a recipe to the `FINAL:<surface>:` pages it reviews. Fields:

- `verifyCommand` (required) — references an existing `consumer.verifyCommands` entry of `kind: "server"`, reusing its `command`, `healthPath`, `readyTimeoutMs`; boot is not respecified.
- `route` (required) — the path that renders the surface. Validated against the deliberately narrow charset `^[A-Za-z0-9\-._~/?=&%]*$` (no shell metacharacters: `$`, backtick, quotes, parentheses, `;`, `&&`-forming `&` pairs are unrepresentable — `&` alone is allowed only because every substitution is quoted, below) and required to start with `/`.
- `page` (optional) — selects which `FINAL:<surface>: <name>` page this route renders. Matching is exact string equality on the `<name>` segment after stripping the `FINAL:<surface>: ` prefix and trimming surrounding whitespace, case-sensitive. Resolution: a surface with exactly one `FINAL:` page needs no selector (that page is selected, and a `page` that names it anyway is fine); several pages and no `page`, a `page` matching zero pages, **zero** `FINAL:` pages for the surface, or two pages whose `<name>` segments are identical (nothing to disambiguate by) — each is `cannot-review` (`page-ambiguous`), with the message naming the candidates found (possibly none). Non-selected pages ride `notes` as unreviewed.
- `screenshotCommand` (required) — consumer-owned template. All four placeholders `{url}`, `{out}`, `{width}`, `{height}` are required at validate time; any other `{token}` is rejected. Executed via `/bin/sh -c` (the `verifyCommands`/`runShell` precedent — [`src/verify/smoke.ts`](../../../src/verify/smoke.ts)), cwd = repo root, environment inherited. **Every placeholder substitutes as a single-quoted shell token**: the value is wrapped in `'…'`, and since the route charset forbids `'` and the lane generates `{out}` itself, no escape sequence is ever needed — a value that would need one (an `{out}` under a repo path containing `'`) fails the round as `screenshot-failed` rather than being spliced in. The consumer writes the template with bare placeholders (`--viewport-size={width},{height} {url} {out}`); the lane owns the quoting. This replaces any "safe by construction" hand-wave: safety comes from the narrowed charset **and** the quoting, not from trust in either alone.
- `maxDiffRatio` (optional, default `0.25`) — finite number in `[0, 1]` inclusive; anything else is rejected at validate.
- `captureTimeoutMs` (optional, default `60000`) — positive integer in `[1, 120000]`; anything else (non-integer, non-finite, out of range) is rejected at validate, never clamped.

Validation cross-checks that `verifyCommand` resolves to a `kind: "server"` entry and that every recipe key is declared in `uiSurfaces`.

### R3 — Firing predicate and target resolution (reused)

Identical inputs to Q-0145 U3/U4, by calling the same `resolveUiReviewTarget` ([`src/cr/lanes/ui-design-resolve.ts`](../../../src/cr/lanes/ui-design-resolve.ts)): whole-feature range from `resolveDefaultBase`, `sessionUiVerdict` over the real diff, waiver/`kind: 'none'` handling, ownership-gated `.pen` resolution — every terminal it returns maps to this lane's sink unchanged. One addition after resolution: affected surfaces with **no `uiBoot` recipe**. Each recipe-less affected surface becomes a per-surface `cannot-review` (`no-boot-recipe`) outcome that participates in R7's aggregation like any other — it is a full outcome row, not a `notes` footnote, so a round with an unconfigured affected surface can never aggregate to an overall `pass`. The bootable subset is still processed; zero bootable surfaces simply means every row is `no-boot-recipe`.

### R4 — Boot and capture (screenshot half)

Extract the boot/probe/kill machinery from `runSmoke` ([`src/verify/smoke.ts`](../../../src/verify/smoke.ts)) into a shared helper rather than copying it: pre-boot occupancy check, detached own-process-group spawn, `waitForHttp200` against `healthPath`, SIGKILL of the process group on every exit path. **Port contention with the `verifier` lane is real** — orchestrate runs lanes concurrently and `verifier` boots the same `verifyCommands` servers via `runSmoke`, so when both lanes are in the round's set, `render-compare` declares `verifier` as its pre-dep through orchestrate's existing pre-dep mechanism (the gate's summary already reports "skipped pre-dep lanes") and starts only after the verifier lane resolves; with `verifier` absent, it starts immediately. The occupancy check stays as the honest backstop for contention from outside the round. Surfaces are **grouped by `verifyCommand`**: each distinct referenced entry boots once, sequentially (one port serves the group, matching `runSmoke`'s sequential posture); the group's surfaces are processed against that instance; the process group is killed before the next boot and on every exit path including timeouts and thrown errors. Port resolution is the same path the verify lane's `runSmoke` caller uses today (the port injected into `{port}`); the render-compare lane resolves it once per boot group. A boot failure — spawn error, no HTTP 200 within `readyTimeoutMs`, or a pre-occupied port — marks **that group's surfaces** `boot-failed` and processing continues with the next group.

Per surface in a booted group, in order: (1) **route probe** — GET `{url}` = `http://127.0.0.1:{port}{route}` (following redirects, bounded by the same probe-fetch timeout the health check uses); a non-2xx final status or probe timeout is `route-unreachable` — this is what keeps a 404/500 route from producing a confident pixel verdict against an error page; (2) **capture** — run `screenshotCommand` (substituted per R2) under `captureTimeoutMs`; timeout kills the command's process group and is `screenshot-failed`, as are a non-zero exit, a missing/empty output file, or an output `pngjs` cannot decode. The stderr tail of a failed capture rides `notes` for diagnosis.

### R5 — Design raster export

The mechanism the R0 spike proved, run per selected `FINAL:` page against the **scratch copy** of the `.pen`. The scratch-copy + sha256 integrity discipline is reused verbatim from `ui-review.ts`, with the roles now explicit: the **repo file's** hash before/after the round is the only `pen-modified` trigger (reds in both modes); the **scratch copy** is expendable — an exporter is allowed to touch it (open-state metadata, save-on-export), and no hash is taken of it. If export is MCP-mediated, the lane dispatches one exporter child (role `render-compare`) whose entire instruction is: open the scratch `.pen`, export the named pages to the named output paths, exit — no judgment, no findings; the child's report is not trusted, its output files are: each expected PNG must exist and decode via `pngjs` with positive dimensions, anything else is `export-failed` for that surface. The child runs under `LaneInput.dispatchTimeoutMs` like every dispatched lane; a timeout or spawn failure is `export-failed` with the detail in `notes` (the export stage needs no separate code — the stage is unambiguous from the sink's per-surface rows). If export is CLI-mediated, no child is dispatched and the same output validation applies. The decoded raster's dimensions feed R4's `{width}`/`{height}`, so the pair is size-comparable by construction at `deviceScaleFactor` 1 — a consumer whose screenshot tool emits 2× rasters must pin its scale factor in `screenshotCommand` (named in Risks; the `dimension-mismatch` message states both observed sizes to make the misconfiguration one-glance).

**Export invocation — R0 spike result (2026-08-21, re-run): POSITIVE, MCP-mediated.** The working invocation is a pencil MCP `execute` script: `Export(["<pageNodeId>", …], "png", "<outputDir>", { scale: 1 })` with an explicit `filePath` pointing at the scratch `.pen`. Proven facts, each observed in the spike session: (a) `outputPath` is treated as a **directory**; the exporter writes `<outputDir>/<nodeId>.png` per node — the lane maps node id → surface artifact name rather than dictating filenames; (b) `scale` defaults to **2**, so the lane must pass `scale: 1` for the `deviceScaleFactor`-1 contract (an exported top-level 800×600 frame produced an 800×600 8-bit RGBA PNG under `scale: 1`); (c) the earlier NEGATIVE result was a **bridge-liveness gate, not a per-file lock**: every MCP call fails with "A file needs to be open in the editor" until *some* `.pen` is open in a running VS Code Pencil tab (extension `highagency.pencildev`, bridge `~/.pencil/mcp/visual_studio_code/mcp-server-darwin-arm64`) — `code <file>.pen` opens one programmatically and the bridge answered within seconds; once alive, `filePath` routes to **any** `.pen`, including a scratch copy that was never opened; (d) export did not mutate the source `.pen` (sha256 identical before/after), so `pen-modified` remains purely a repo-file discipline. Environmental constraint, recorded as the adoption constraint R0 anticipated: the lane requires a running VS Code window with the Pencil extension and at least one open `.pen` — interactive sessions only; in headless CI the exporter child fails and the surface degrades to `export-failed`, honestly. The exporter child role therefore exists (MCP-mediated path), and its instruction includes opening the scratch file via `code` first when the bridge is down.

### R6 — Diff engine and thresholds

`pixelmatch` + `pngjs` join the framework's dependencies (small, pure-JS, no native/browser footprint — unlike playwright, which stays consumer-side). Both images are decoded to RGBA via `pngjs`; alpha is compared as pixelmatch sees it (no pre-flattening). Result-affecting pixelmatch options are **pinned constants, not config**: `threshold: 0.2` (per-pixel color tolerance, antialiasing-friendly), `includeAA: false` (anti-aliased pixels are not counted as differences); everything else at library defaults. A dimension mismatch between the pair after R4's sizing is `dimension-mismatch` (`cannot-review` — something in the capture pipeline lied; the lane never resizes-and-pretends). `diffRatio = differing pixels / total pixels`; the surface **fails iff `diffRatio > maxDiffRatio`** (strict; ratios exactly at the threshold pass). Severity is ratio-derived and fully deterministic: `high` when `diffRatio > 2 × maxDiffRatio`, else `med` — there is no separate blank-render heuristic (dropped deliberately: a blankness predicate is a second algorithm with its own false positives, and the blank-vs-blank case is the structural lane's territory per Non-goals).

Per-surface artifacts — design raster, screenshot, and pixelmatch's diff image — are persisted under `.noldor/cr/render-compare/<slug>/` as `<surface>.design.png`, `<surface>.shot.png`, `<surface>.diff.png`. The filename-sanitization algorithm is fixed: lowercase, every character outside `[a-z0-9-]` replaced with `-`, runs of `-` collapsed, leading/trailing `-` trimmed. It is not injective, so `validate noldor-config` rejects a `uiSurfaces`/`uiBoot` name set in which two surface names sanitize to the same string or any name sanitizes to empty — collisions are a config error caught at validate time, never a silent artifact overwrite. The directory is rebuilt atomically per round: written to a fresh temp sibling, then swapped in place of the prior round's, so a crashed round never leaves a mixed set. Sink entries reference these as repo-relative paths. The directory is workspace evidence, not history: it joins the gitignore in the same change that introduces it. Worktree rounds write inside their own tree's `.noldor/`, so concurrent features cannot cross-write.

### R7 — Verdicts, aggregation, reasons, mode knob

Sink at `.noldor/cr/<slug>-code-render-compare.json`, standard `laneFindingsSchema` shape — no schema extensions. A failing surface becomes one standard `Finding`: `file` = the repo-relative diff-image path, `severity` per R6's rule (`high`/`med` are the schema's canonical spellings, already used by the sibling lanes), `message` = `[<surface>] diffRatio <observed> > <threshold> — design=<path> shot=<path>`. A passing surface contributes a `notes` row `[<surface>] diffRatio <observed> ≤ <threshold>` so creeping drift is visible before it crosses.

**Multi-surface aggregation (deterministic, total).** Every affected surface is processed to its own per-surface outcome — `pass`, `fail`, or a `cannot-review` class (`no-boot-recipe` from R3 included) — and a per-surface failure never aborts the round (boot failure fails its group's surfaces, processing continues). The sink's single verdict is the worst outcome by precedence **`fail` > `cannot-review` > `pass`** (`not-applicable` only ever appears alone, from R3's whole-round terminals). The top-level `reason` is set only when the verdict is `cannot-review` or `not-applicable` — with exactly one exception, `pen-modified`, below: the headline is the failing class of the highest-precedence surface, ties broken by surface name ascending. Every per-surface outcome is in the sink regardless (`fail` rows as findings, `cannot-review` rows as `notes` lines carrying their own class, `pass` rows as ratio notes), so the single `reason` is a headline, not the record.

**`pen-modified` precedence (global, absolute).** The repo-`.pen` hash check runs after all surfaces resolve; a mismatch **overrides the aggregation entirely** — the sink is `verdict: fail`, `reason: pen-modified`, one high blocker, `ok: false`, in both modes, with the per-surface rows kept in `notes` as forensics. This is the one `fail` that carries a `reason`, exactly the shape Q-0145's U6 table established: the mode knob governs review outcomes, and a modified design invalidates the review itself.

**Closed reason vocabulary — full enumeration.** Inherited from Q-0145, produced by `resolveUiReviewTarget`'s terminals (R3) or the shared integrity check, unchanged triggers: `waived`, `no-ui-paths`, `design-skip`, `no-consumer-config` (not-applicable classes); `no-session-key`, `no-design-artifact`, `no-feature-pen`, `ambiguous-design`, `surfaces-unmapped`, `range-unresolvable`, `fd-unreadable`, `design-dir-unreadable`, `scratch-unavailable` (cannot-review classes); `pen-modified` (integrity, above). New, this lane only: `no-boot-recipe` (affected surface without a recipe), `page-ambiguous` (R2's selector unresolvable in any direction), `boot-failed` (spawn/health/occupancy), `route-unreachable` (R4's probe), `screenshot-failed` (capture exit/timeout/missing/undecodable/unquotable-out), `export-failed` (R5's output validation, exporter spawn/timeout included), `dimension-mismatch` (R6). Every one of these may appear as a sink-level `reason`; the only Q-0145 code **excluded** is `pen-unreadable` — it is the structural child's code, and this lane's equivalent failure surfaces as `export-failed`.

Mode knob: `autonomous.renderCompareMode` (`'blocking' | 'advisory'`, default `'advisory'`), separate from `uiReviewMode` — an adopter's confidence in structural review and in a booted-app pixel pipeline diverge. Mode matrix as Q-0145 U6: advisory `fail` → findings as `low` suggestions, `ok: true`; blocking `fail` → findings as blockers with R6 severities, `ok: false`; blocking `cannot-review` → one high blocker naming the headline reason, `ok: false`; advisory `cannot-review` → `ok: true`; `pen-modified` → one high blocker, `ok: false`, **both** modes.

### R8 — Gate wiring and docs

`orchestrate.ts` gains `'render-compare': runRenderCompare` in `LANES`; code-only rejection extended; `renderCompareMode` joins the autonomous config schema. Docs: one row in the CR-lane table ([`docs/noldor/cr-pipeline.md`](../../../docs/noldor/cr-pipeline.md), which already names this feature as deferred), the `uiBoot` schema in the config reference, `templates/` twins in the same pass. Gate prose: opt-in code lane, no new step.

## Acceptance criteria

1. The R0 spike result is recorded before any lane code ships: a working export invocation filled into R5's subsection, or a negative result captured as an `ideas.md` intake bullet (never a hand-edited roadmap) with the session stopping at zero lane code.
2. `render-compare` is accepted in `crLanes.code`, absent from `DEFAULT_CR_LANES`, rejected at `--kind spec|plan`, and excluded from the delta short-circuit.
3. `validate noldor-config` rejects: a `uiBoot` key not in `uiSurfaces`; a `verifyCommand` not resolving to a `kind: "server"` entry; a `screenshotCommand` missing any of the four placeholders or carrying an unknown `{token}`; a `route` failing the narrowed charset/leading-`/` rule; a non-finite or out-of-`[0,1]` `maxDiffRatio`; a `captureTimeoutMs` that is not an integer in `[1, 120000]`; an invalid `renderCompareMode`; and any surface-name set with a sanitization collision or empty sanitization. Defaults: `advisory`, `0.25`, `captureTimeoutMs` 60000.
4. Terminal resolution: verdict-`skip` ⇒ `not-applicable` without booting; waived ⇒ `not-applicable` (`waived`); a recipe-less affected surface ⇒ a per-surface `no-boot-recipe` outcome (so such a round can never aggregate to `pass`); zero/multiple/duplicate/dangling `FINAL:`-page selection ⇒ `page-ambiguous` naming the candidates found.
5. `boot-failed`, `route-unreachable`, `screenshot-failed`, `export-failed`, and `dimension-mismatch` are mutually distinguishable, each fires from its documented trigger, and every spawned process group (app boots, capture commands, exporter child) is killed on every exit path including timeouts. Placeholder values substitute only as single-quoted tokens: a route surviving config validation cannot alter the shell command, and an unquotable `{out}` fails as `screenshot-failed`, never splices. When `verifier` shares the round, `render-compare` starts only after it resolves (pre-dep), and the occupancy check still guards external contention.
6. The repo `.pen`'s sha256 before/after the round is the sole `pen-modified` trigger (one high blocker, `ok: false`, both modes); exporter mutation of the scratch copy alone does not trip it.
7. The diff is deterministic and validated by versioned raster fixtures (no app boot): identical pair ⇒ pass at ratio 0; antialiasing-jitter pair ⇒ pass under the default threshold; a blanked region and a shifted region ⇒ fail with `high`/`med` per the 2× rule; a size-mismatched pair ⇒ `dimension-mismatch`. Fixture expectations pin the constants (`threshold: 0.2`, `includeAA: false`).
8. A `fail` finding's `file` is the repo-relative diff image; its message carries surface, observed ratio, threshold, and both image paths; all three per-surface images exist under `.noldor/cr/render-compare/<slug>/` under the fixed sanitization algorithm, the directory is atomically rebuilt per round, and it is gitignored.
9. Mode matrix holds: advisory `fail` ⇒ `low` suggestions with `ok: true`; blocking `fail` ⇒ blockers with ratio-derived severities and `ok: false`; blocking `cannot-review` reds, advisory does not; `pen-modified` overrides all per-surface outcomes as `verdict: fail`, `reason: pen-modified`, `ok: false` in both modes with the per-surface rows kept as notes.
10. Multi-surface aggregation: per-surface outcomes are all present in one sink (findings for fails, class-carrying notes for cannot-reviews including `no-boot-recipe`, ratio notes for passes); the top verdict follows `fail` > `cannot-review` > `pass` with the headline `reason` from the highest-precedence failure, name-ascending on ties; a boot failure fails only its group's surfaces and processing continues.
11. Every terminating path writes exactly one schema-valid sink — including `null` consumer config, torn session marker, malformed FD, unresolvable range, and every R4/R5/R6 failure row — except a sink-write failure, which reds via `unresolved`; `ui-reviewer` and `render-compare` sinks coexist without filename misattribution.
12. Consumer docs and `templates/` twins carry the lane row, the full `uiBoot` schema, and the `renderCompareMode` key; template-sync passes.

## Risks / trade-offs

- **The export spike can fail, and the feature dies at task 0.** Accepted knowingly: the operator chose pixel-diff over a shippable-today judgment hybrid. The spike is cheap, its negative result re-parks the entry with evidence, and no half-built lane ships.
- **Export may be editor-bound.** If the only working path requires the pencil desktop app running, the lane is unusable in headless CI — an adoption constraint recorded at spike time, not discovered by consumers. Advisory default means it degrades to `cannot-review` (`export-failed`) there, honestly.
- **Cross-engine rendering floor.** Fonts and antialiasing guarantee nonzero diff ratios on faithful implementations; the loose default threshold trades sensitivity for signal. A consumer chasing precision tightens `maxDiffRatio` per surface and owns the false-positive rate.
- **Blank-vs-blank passes.** With no blankness heuristic, a blank render diffed against a mostly-empty design page scores low and passes; the structural lane's inventory review is the intended guard. Named limitation, not a bug.
- **Dynamic app content.** Live data behind a route differs from design placeholders and inflates ratios; the loose threshold absorbs some, masking/state-scripting is the deferred slice. The per-surface override is the interim remedy.
- **Scale-factor mismatch.** A screenshot tool emitting 2× rasters hits `dimension-mismatch` every round; the message names both observed sizes, and the remedy (pin `deviceScaleFactor`/`--device-scale-factor=1` in `screenshotCommand`) lands in the config-reference docs.
- **Consumer-owned screenshot command.** `npx playwright screenshot` requires the consumer's toolchain and floats its version; docs recommend a pinned devDependency invocation (`pnpm exec playwright …`). The framework adds only pixelmatch+pngjs. A consumer without a browser cannot adopt — `screenshot-failed` names it.
- **Persisted screenshots may carry consumer data.** They are workspace-local evidence, gitignored, overwritten per round, and never uploaded by the lane; consumers with stricter hygiene delete `.noldor/cr/render-compare/` at will — nothing reads it back.
- **Boot cost per round.** Seconds-to-minutes per code round; opt-in and short-circuit-excluded, so adopters pay knowingly.

## User Story

As an agent shipping a UI-bearing feature, I want the code-stage CR to boot the app and pixel-diff what a real route renders against the design my session approved, so that regressions invisible in code text — broken layout, blank renders, moved or missing regions — are caught deterministically before merge.

## Usage

Declare the recipe and opt in, per consumer, in `.noldor/config.json` (complete, adoptable example — `verifyCommands` included):

```json
{
  "consumer": {
    "uiSurfaces": { "dashboard": ["src/dashboard/**"] },
    "verifyCommands": {
      "dashboard": {
        "command": "pnpm dev --port {port}",
        "kind": "server",
        "healthPath": "/"
      }
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

The ordinary code-stage round then runs it:

```
pnpm noldor cr orchestrate --slug <slug> --artifact <code-paths> --kind code \
  --lanes reviewer,render-compare --base-sha origin/main
pnpm noldor cr aggregate --slug <slug> --kind code
```

Sink: `.noldor/cr/<slug>-code-render-compare.json`. Read `verdict` before `blockers`; `reason` is the headline failure class and the per-surface rows in findings/`notes` are the record. On a `fail`, open the persisted diff image under `.noldor/cr/render-compare/<slug>/` before arguing with the ratio. Flip `renderCompareMode` to `blocking` once the pipeline is reliable in your CI.

## Open questions (resolved)

1. *Pixel diff or model comparison?*
   -> True pixel-diff, blocking on the export spike (D1, operator-decided). Model judgment over screenshots is Q-0145 with extra steps; the entry's value is a deterministic verdict.
2. *What if the export path does not exist?*
   -> R0 spike as implementation task 0; a negative result re-parks the entry via the ideas.md intake flow with evidence, and zero lane code ships (D2). Cheaper than discovering it mid-build.
3. *Where does the boot recipe live?*
   -> `consumer.uiBoot`, keyed by surface, referencing `verifyCommands` for boot/health (D3). Boot machinery exists and is consumer-owned; respecifying per lane would drift.
4. *Who takes the screenshot?*
   -> The lane, via a consumer-declared `screenshotCommand` template with a validated placeholder contract (D4). Framework stays browser-free; capture stays mechanical and runner-independent.
5. *New lane or a mode of `ui-reviewer`?*
   -> New sibling lane `render-compare` (D5). Different failure surface, different trust curve, independent adoption decision.
6. *Same mode knob as `ui-reviewer`?*
   -> Separate `renderCompareMode`, default advisory (D6). Confidence in the two pipelines diverges, especially in CI.
7. *How do two rendering engines compare without permanent redness?*
   -> Coarse-drift thresholds: pinned pixelmatch constants (`threshold: 0.2`, `includeAA: false`), `maxDiffRatio` default 0.25 with per-surface override, fixture-validated (D7). The lane detects breakage, not font fidelity — that split keeps both lanes honest.
8. *Which `FINAL:` page does the route's screenshot diff against?*
   -> One selected page per surface: auto when the surface has exactly one, the recipe's `page` field otherwise, `page-ambiguous` for every unresolvable shape — zero pages, several without a selector, a dangling selector, duplicate `<name>` segments (D8). Diff-all-take-best was rejected — a best-of-N verdict hides which state was actually reviewed.
9. *Multi-surface rounds — one verdict from many outcomes?*
   -> Process every surface, aggregate by `fail` > `cannot-review` > `pass`, headline `reason` from the highest-precedence failure, full per-surface record in the sink (D9). A single opaque verdict would erase partial coverage.
10. *Blank-render detection?*
    -> Dropped; severity is purely ratio-derived and the blank-vs-blank case is named a limitation guarded by the structural lane (D10). A blankness predicate is a second algorithm with its own false-positive budget.
11. *`FINAL:` pages whose state the route cannot show?*
    -> Non-selected pages named in `notes`, never silently dropped; state-reach is a later slice (D11).
12. *Partial recipe coverage?*
    -> Review the bootable subset; every recipe-less affected surface is a full per-surface `no-boot-recipe` outcome in the aggregation, so the round can never read `pass` while a surface went unreviewed (D12, revised at CR round 2 from the earlier notes-only wording). A partial honest review beats none, and the gap is verdict-visible, not a footnote.
