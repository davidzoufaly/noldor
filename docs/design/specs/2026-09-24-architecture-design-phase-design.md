# pen.dev Architecture Design Phase — Design

**Slug:** architecture-design-phase
**FD:** docs/features/architecture-design-phase.md
**Date:** 2026-09-24
**Tier:** full

## Problem

The architecture surface is four hand-written mermaid pages (`docs/architecture/{context,containers,modules,flows}.md`, registry `ARCHITECTURE_PAGES` in `src/docs/architecture-schema.ts:49`). Mermaid reads well but designs badly: nothing can be placed by hand, variants cannot sit side by side, and the layout jumps on every edit. It also has no place in the gate flow. A spec describes an architecture change in prose, and the pages are updated afterwards, or not at all.

UI work already has a loop: a baseline `.pen` of what shipped, a design `.pen` seeded from it, an approved `FINAL:` page, a write-back at ship, and a freshness check (FD `pendev-ui-design-phase`). Architecture has no such loop. Nothing checks the diagrams against the code either, beyond module names: `checkArchitecture` (`src/docs/docs-architecture.ts:272`) flags a module `modules.md` never names, but it never looks at an arrow.

## Goals

1. An as-built architecture baseline on the pen.dev canvas, with the same four views as `docs/architecture/`.
2. A `/noldor-spec` step that seeds a design `.pen` from the baseline, iterates on the canvas and ends with an approved `FINAL:` page per changed view, using the same mechanics as the UI step.
3. A ship write-back, so the baseline stays as-built.
4. A check that holds the baseline's modules and arrows to the real code.
5. Reuse of the UI machinery through one design-kind seam, not a second copy of it.
6. A milestone can carry a target-architecture design. It is drawn from the baseline and approved against the milestone file, and the framework reports how far the baseline still is from it.

## Non-goals

- Generating the `docs/architecture/*.md` mermaid from the baseline. It is a follow-up slice, and that slice is also where backlog Q-0210 (archify) gets decided.
- Enforcing that a milestone's target is reached before the milestone ships. The progress report is advisory, because milestones are optional and the framework never pushes one (`/noldor-milestone` rules).
- A semantic `.pen` diff for PR review (`added box X, removed arrow Y`). This is a follow-up slice.
- A code-stage review lane that compares the approved design with the implementation.
- Code truth for the `context`, `containers` and `flows` views. Only `modules` has one (see Design → Honesty check).
- Sticky connectors. pen.dev v2.17 has no connector node type, and building one is not this framework's job.
- `noldor init` scaffolding a `.pen`. The editor authors `.pen` files.

## Design

### Structural context

Graph read over the files this design expects to touch (`design graph-context`, status `fresh`). The change lands mostly in community c25 (`src/core/design-artifact-names.ts`, `src/checks/check-shared-files.ts`, `src/design/archive-resolve.ts`), the design-naming and `.pen` guard cluster owned by `pendev-ui-design-phase`. It also lands in c26 (`src/design/design-approval.ts`, beside `src/cr/lanes/ui-design-resolve.ts`), c33 (`design-approval-cli.ts`), c51 (`src/docs/docs-architecture.ts` with the garden architecture detector) and c92 (`src/indirection/detect.ts`, whose cross-community edges run to `src/core/repo-paths.ts`, the toolchain floor, the indirection CLI and baseline, and `src/invariants/boundaries.ts`). One god node sits on the path: `loadDocRoots()` in `src/core/doc-roots.ts` (rank #1, 89 edges). The change only adds a field to its return value. `design-artifact-names.ts` is imported across five communities (garden c13, ui-design-resolve c26, design-approval-cli c33, validate-trailer c44, ui-design-freshness c46), so new constants go beside the UI ones rather than changing them.

### Baseline file and views

The baseline is one file: `docs/design/architecture/baseline.pen`. It has one top-level page per `ARCHITECTURE_PAGES` id: `context`, `containers`, `modules`, `flows`. One file, not one per view, because a design session seeds by copying a single file and a session may own only one design `.pen`. With no baseline file, everything in this design is inert. The file's presence is the opt-in, and there is no config key. Each view is exactly one page. A consumer with many modules folds them into multi-module boxes or groups rather than splitting the view (see Risks).

### Tag contract (layer names)

The canvas says what it means through **layer names**, which the operator can see and edit in the pen.dev layers panel:

- On the `modules` view, a box whose layer name is a module path covers that module: `src/cr`. `src/utils + src/types` covers both.
- A frame named `group: <Name>` is a group. An arrow endpoint that names a group stands for every module inside it.
- An arrow is a `path` named `<endpoint> -> <endpoint>`, for example `src/cr -> src/core` or `group: Workflow -> src/core`.
- On the other views, names are free, and an arrow names its two boxes by their layer names.
- Anything that doesn't match the grammar is decoration.

Only `frame`, `rectangle`, `ellipse` and `ref` nodes count as boxes. Text, icon and path nodes never do. This keeps a box and the label inside it from both claiming `src/cr`. A box name is a module reference when it contains a `/` and uses only path characters, with ` + ` joining several. Whether the path really is a module is the check's job, not the grammar's.

Endpoints resolve like this:
- An endpoint equal to a box's full name, or to one module path that box covers, resolves to that box.
- An endpoint equal to a group's name resolves to the group.
- An endpoint that matches more than one box, or none, does not resolve.

Arrows expand to modules: a module path stands for itself, a box for every module it covers, and a group for every module of every box inside it.

Code paths live in names, not ids, because a pen id may not contain `/` (`entity.id` pattern `^[^/]+$`). The alternative is `metadata: {type: 'noldor.arch.node', ...}` on each node. It survives a label edit but is invisible in the editor and gets copied when a box is duplicated (see Open question 1).

### Reader

`src/design/arch-pen.ts` holds a pure reader, `readArchPen(bytes) → ArchDoc | error`. It runs `JSON.parse`, picks out the view pages by name (baseline: the bare view id; design file: `BASE:<view>:` / `FINAL:<view>:` / other), and returns each view's nodes, groups and arrows with their endpoints resolved. It never writes a `.pen`. `design verdict` already reads a `.pen` as JSON (`readPenPages`, `src/design/design-approval-cli.ts:284`), so the reader follows that precedent.

### Code truth

Modules come from `listModuleDirs(cwd)` (`src/docs/docs-architecture.ts:211`, over `scanRoots()` → `consumer.scanPaths`). Import edges come from dependency-cruiser's `cruise()`, which the repo already runs in two places: `measureIndirection` (`src/indirection/detect.ts:490`, cruise at :576) and `makeBoundariesInvariant` (`src/invariants/boundaries.ts:84`). This design pulls a shared `moduleImportPairs(cwd)` out of the indirection code, into a sibling `src/indirection/module-pairs.ts`, and reuses it. It turns cruise's file-to-file `dependencies[].resolved` into a set of `src/a → src/b` pairs, with tests excluded, aliases resolved and the same fail-closed guard. A file that sits directly in a scan root belongs to no module and contributes no pair. graphify's `graph.json` is not used, because it can be stale and needs a regeneration to refresh.

The new files fit the repo's `consumer.boundaries` rules. For `no-module-cycles`: the pure rules (`arch-pen.ts`, `arch-check.ts`, `module-pairs.ts`) import nothing from `src/checks` or `src/release`, so the CLI wrapper and the release probe can import them without closing a file-level cycle. For `core-is-foundation`: `src/core` gains only constants.

### Honesty check

`pnpm noldor checks arch-baseline` reads the baseline's `modules` view against code truth. The rules are a pure function in `src/design/arch-check.ts`, which maps an `ArchDoc`, a module list and the import pairs to findings. The CLI wrapper, `src/checks/check-arch-baseline.ts`, gathers the three inputs and prints the rows.

Findings (exit 1):
- `missing-module` — a module no box covers
- `unknown-module` — a box naming a path that is not a module
- `duplicate-module` — two boxes cover one module
- `phantom-edge` — an arrow with no import behind it, after group expansion: a group arrow is real if any member pair imports
- `dangling-edge` — an endpoint that resolves to no box or group on the page, or to more than one
- `unreadable` — the file cannot be parsed, or the view is missing

Advisory (exit unchanged): `undrawn-edge`, an import between two modules that no arrow covers. It is only advisory so that the view need not become a hairball.

The other three views get the contract checks only: every arrow endpoint resolves to exactly one box or group on its page. An import between two modules that share one box is internal and never reported. An absent baseline reports `absent` and exits 0.

Release preflight gains an `arch-baseline` row, built with the same `docSurfaceRow` pattern the `architecture` row uses (`src/release/preflight-probes.ts:746`). It blocks when the baseline exists and the check is red, and `RELEASE_SKIP_ARCH_BASELINE=1` overrides it. Gate Step 4 runs the check as advisory: its exit code never blocks `pr-flow` (see Ship write-back).

### Design-kind seam

Recorded as [ADR 0007](../../adr/0007-design-kinds-share-one-machinery.md): every design kind goes through one set of machinery.

`src/core/design-artifact-names.ts` gains `DesignKind = 'ui' | 'architecture'` and per-kind locations: the existing `UI_DESIGN_DIR` / `UI_BASELINE_DIR` (:38, :29) stay, and `ARCH_DESIGN_DIR = 'docs/design/architecture'` and `ARCH_BASELINE_PATH` are added beside them. `loadDocRoots()` gains `designArch` beside `designUi` (`src/core/doc-roots.ts:72`). The call sites that hard-code the UI directory take the kind from the path:

- `resolveFeaturePen` in `design verdict`
- `collect` in `archive-resolve` (:115, :182)
- the two prefixes in the pre-commit guard (`check-shared-files.ts:27`, :121)
- the guard's record-tamper rule, which derives a record's `.pen` from its path, and `stagedAwarePenLookup`, which it resolves through (`check-shared-files.ts:271`, :163)
- `rankPenCandidates` in `pen-bridge` (:39)

An approval record's path mirrors the `.pen`'s place. UI records stay at `.noldor/design-approval/<stem>.json`. An architecture `.pen` at `docs/design/architecture/[milestones/]<stem>.pen` records at `.noldor/design-approval/architecture/[milestones/]<stem>.json`. Records are keyed by stem only today (`approvalRelPath`, `design-approval.ts:82`), so without this a UI `.pen` and an architecture `.pen` with the same date and key would collide.

The `FINAL:<surface>:` grammar is reused unchanged: for architecture, a "surface" is a view id, and `--surface` must name one of the four. The FD gains `links.arch`, a `.pen` path beside `links.design` (`src/core/feature-schema.ts:55`). The session marker gains `archVerdict` and `archWaiver` (the schema is `.strict()`, `src/core/session.ts:20`). The `ui-reviewer` lane is untouched. It resolves only under `designUi` (`src/cr/lanes/ui-design-resolve.ts:347`), so an architecture `.pen` can never be mistaken for a UI design.

### Spec step

`/noldor-spec` gains a step 1.6 beside the UI step 1.5. It runs on `specs-only-*` / `full-*` sessions when a baseline exists:

1. **Verdict.** The agent recommends `required` or `skip` from signals it can name: a new module directory in scope, a new package, a new runnable unit or external, a new cross-module import the design introduces. The operator confirms, and the result goes in `archVerdict`.
2. **Seed.** `cp` the baseline to `docs/design/architecture/<date>-<dialogue-key>.pen`, open it with `design pen-bridge --pen`, and rename the four pages to `BASE:<view>: as-built`.
3. **Iterate.** Variants are pages. The winner per changed view is `FINAL:<view>: <name>`.
4. **Record.** The spec's `## Design` names the choice, and FD `links.arch` points at the file.
5. **Verdict at step 7.5.** `design verdict --pen <arch pen> --approve --surface <view>… --spec … --editor-page …` runs exactly as for UI.

One more verdict signal: the FD's `milestone:` has a target design, and this feature moves the baseline toward it. The UI step's hazards carry over word for word: assert the write target, wake the bridge, verify in a follow-up `execute`, and waive only after a wake attempt (`archWaiver`, plus `design verdict --waive` once Seed has run). Gate Step 2.5 runs `design verdict --check` on the architecture `.pen` exactly as it does on the UI one, whenever `archVerdict` is `required` and there is no waiver.

### Milestone target

A milestone's target architecture is `docs/design/architecture/milestones/<slug>.pen`. It is undated and keyed by the milestone slug, so `penSlugFromFilename` never matches it and no session's resolve or archive picks it up. It stays in place after the milestone ships, just as the milestone file stays with `status: shipped`.

- **Drawn at draft time.** `/noldor-milestone draft` (and `edit`) gains an optional step when a baseline exists. It uses the same Seed and Iterate mechanics as the spec step: `cp` the baseline, rename the pages `BASE:<view>: as-built`, and mark each target view `FINAL:<view>: <name>`.
- **Approved against the milestone file.** `design verdict --pen <milestone pen> --approve --surface <view>… --milestone <slug> --editor-page …` binds the record to the blob of `docs/milestones/<slug>.md` instead of a spec. `--milestone` and `--spec` exclude each other, because `--spec` must sit in the specs root (`design-approval-cli.ts:243`). `--milestone <slug>` also requires the `--pen` to be that milestone's own target file, and `docs/milestones/<slug>.md` must exist. The record goes to `.noldor/design-approval/architecture/milestones/<slug>.json`. `--check` reports drift once the milestone file changes.
- **Linked from the milestone body.** The milestone gains an `## Architecture target` section linking the file. Milestone frontmatter is `.strict()` (`src/milestones/lib.ts:20`), but body sections are not validated, so no schema change is needed.
- **Committed through micro-chore.** Drafting a milestone is a micro-chore. `MICRO_CHORE_GLOBS` (`src/core/allowlist.ts:3`) gains `docs/design/architecture/milestones/*.pen` and the matching approval-record glob, so the target lands in the same commit as the milestone file. The pre-commit approval rule still applies to it. The file is undated, so the guard keys it by the milestone slug rather than through `penSlugFromFilename`. Revising a target mid-milestone means an edit plus a fresh verdict. The guard's record-tamper rule keeps the two in step.
- **Progress.** `pnpm noldor design arch-progress --milestone <slug>` compares the target's `FINAL:` pages with the baseline by name: modules by path, arrows by endpoint pair, and other views by box name. It lists `to-build` (in the target, not in the baseline), `to-remove` (in the baseline, gone from a view the target covers) and `done`. It exits 0 with the report, or 1 when a file cannot be read. The spec step shows it for an FD whose milestone has a target, and `/noldor-milestone activate` prints it for the milestone being shipped. A view with no `FINAL:` page in the target means "no change planned", so `arch-progress` reports nothing for it.

### Arrow re-route

pen.dev has no sticky arrows, so moving a box leaves its arrows behind. `pnpm noldor design arch-route --pen <path> [--view <view>]` works in two halves:

1. **Resolve.** It runs the check's own reader over the file on disk to match each arrow to its two boxes, so re-route and check can never disagree about what an arrow connects.
2. **Print.** It prints a JavaScript snippet for pencil `execute` with those node ids baked in. The snippet reads each box's live bounds by id, walking up through parent frames to page coordinates. It then rewrites the arrow's path geometry: a straight segment from border to border, plus a two-stroke arrowhead in the same path, since `<marker>` does not exist in the format.

Moved boxes need no save, because bounds are read live. A newly drawn arrow does need one, because the matching reads the file on disk. The snippet template is a file in the package with a unit test that runs it against a fixture page through stub `Get`/`Update` functions, so the code the agent pastes is tested code. The check does not depend on this unit, but the canvas is only pleasant with it. Dragging boxes by hand is the reason to use a canvas at all, and without re-route every drag leaves its arrows behind.

### Ship write-back

Gate Step 4, after the archive seam: for each `FINAL:<view>:` page in the archived architecture `.pen`, the agent applies the feature's change to the **current** baseline view through pencil MCP. It does not copy the page over, because another feature may have written the view back in the meantime. It then re-routes the arrows on each changed view, runs `checks arch-baseline`, and commits with `NOLDOR_ALLOW_PEN_WRITE=1`.

Step 4 runs the check on every path, not only on sessions that designed. A session whose diff changes the module set or its imports sees the check go red whatever its `archVerdict` was. It then writes the baseline back the same way, with no design file needed, which mirrors the UI rule for a `skip` that turns `required` at ship. When pencil MCP is unavailable (a headless drain, for instance), the step skips loudly and prints the debt, and release preflight holds the line. Re-applying a delta is judgment work for now (see Risks). The check is what catches a bad re-apply.

### Bootstrap

This repo draws its own baseline once, through pencil MCP: the four views from `docs/architecture/*.md`, and `modules` from `listModuleDirs` plus the cruise pairs, with names set as each box is created. The check must be green on it before the slice ships. A consumer bootstraps the same way, and the FD Usage carries the recipe. SVG paste of rendered mermaid is not the route: it drops arrow tips (`<marker>`) and HTML labels (`foreignObject`), and it leaves every box unnamed.

### Docs and twins

These change, each with its `templates/` twin, which `check-template-sync` holds byte for byte:

- `.claude/skills/noldor-spec/SKILL.md`: step 1.6 and the step 7.5 verdict.
- `.claude/skills/noldor-gate/SKILL.md`: the Step 2.5 drift check and the Step 4 write-back.
- `.claude/skills/noldor-milestone/SKILL.md`: the draft/edit target step and the `activate` progress print.
- `docs/noldor/gotchas.md`: loose arrows, SVG paste losses, and layer-name typos.
- `docs/noldor/script-catalog.md`: the three new commands, `checks arch-baseline`, `design arch-route` and `design arch-progress`.

The `AGENTS.md` capability index is regenerated rather than hand-edited. Skill files are shared files that `checks shared-files` refuses from a worktree, so they ride this branch under `NOLDOR_ALLOW_SHARED=1`, following the precedent of Q-0201, PR #511.

## Acceptance criteria

1. With no baseline file, `checks arch-baseline` exits 0 and reports `absent`, and the release `arch-baseline` row reads `skipped`.
2. A baseline whose `modules` view covers every `listModuleDirs` module exactly once, and whose every arrow is backed by an import, exits 0.
3. An uncovered module, a box naming a non-module path, or one module on two boxes each exit 1, and the output names the module.
4. An arrow with no import behind it (after group expansion), or with an endpoint that names nothing on the page, exits 1, and the output names the arrow.
5. An import between two modules that no arrow covers prints an advisory row and does not change the exit code.
6. Release preflight blocks on a red check when the baseline exists. `RELEASE_SKIP_ARCH_BASELINE=1` forces `skipped` and writes an audit-log entry.
7. `design verdict --approve` on an architecture design `.pen` binds the record to its spec, or with `--milestone <slug>` to `docs/milestones/<slug>.md`. Records land in per-kind directories and never overwrite a UI record with the same stem. `--check` exits 1 once the bound file changes.
8. Pre-commit refuses a new architecture design `.pen` with no matching record (`pen-unapproved`). It also refuses `docs/design/architecture/baseline.pen` staged from a `.worktrees/` checkout (`pen-baseline`), unless `NOLDOR_ALLOW_PEN_WRITE=1` is set. And it refuses a commit that drops or degrades an architecture record while its `.pen` stays.
9. `design archive` moves the session's architecture `.pen` into `docs/design/architecture/archive/` and repoints `links.arch`.
10. `design arch-route` matches each arrow to the same two boxes the check resolves. Its snippet, run against a fixture page (nested frames included) through stub `Get`/`Update`, leaves every arrow's two ends on its two boxes' borders.
11. The session marker accepts `archVerdict` / `archWaiver`, and the FD schema accepts `links.arch` ending in `.pen`.
12. This repo's `docs/design/architecture/baseline.pen` exists with the four views, and `checks arch-baseline` is green on it.
13. `design arch-progress --milestone <slug>` lists every target box and arrow missing from the baseline as `to-build`, and every baseline item gone from a covered view as `to-remove`, then exits 0.
14. A micro-chore commit that carries `docs/milestones/<slug>.md`, its target `.pen` and the target's approval record is accepted. The same commit without the record is refused `pen-unapproved`.

## Risks / trade-offs

- **Loose arrows.** Re-route fixes them, but only when someone runs it after moving boxes. Until then, the picture can look wrong while the check stays green, because the check reads names, not geometry.
- **Typos in layer names.** A mistyped path becomes `unknown-module` or `dangling-edge`, so the check catches it. But it's still friction.
- **Three views without code truth.** `context`, `containers` and `flows` can rot the way mermaid pages rot today. This is accepted and documented.
- **Group arrows are coarse.** A group arrow counts as real when any member pair imports, so one real import can hide phantom siblings.
- **Write-back by eye.** Re-applying a delta onto a baseline that moved is judgment work until the semantic diff exists.
- **Bridge availability.** `.pen` work needs terminal Claude Code with the pencil bridge up. The same limit applies to UI.
- **Large module sets.** One page per view. A consumer with hundreds of modules has to fold them into multi-module boxes or groups. Sub-pages would be a follow-up.
- **Cruise cost.** Each check run does one dependency-cruiser pass, which takes seconds on this repo. The check runs at gate Step 4 and at release, not on every commit, so a slower consumer pays the cost twice per feature at most.
- **Release pressure from drains.** A headless drain that adds a module leaves baseline debt, and release preflight then blocks until someone with the bridge writes the baseline back. That pressure is the point, but it lands on the release sweep.
- **Big slice.** 14 criteria across a reader, a check, a seam, two skills, the milestone flow and a bootstrap. The plan will likely split into parts. The seam and the check come first, so each later part lands on a tested base.

## User Story

As an operator designing a new milestone, feature or package, I want an as-built architecture canvas I can copy, redraw and approve beside the spec, and that the ship step writes back and the code keeps honest, so that architecture decisions are made on a current picture and the picture stays true.

## Usage

1. Bootstrap once: open `docs/design/architecture/baseline.pen` in VS Code and have the agent draw the four views (recipe in the FD). Then run `pnpm noldor checks arch-baseline` until it is green.
2. Design: in any `specs-only-*` / `full-*` session, `/noldor-spec` step 1.6 asks whether the change is architectural. On `required`, it seeds `docs/design/architecture/<date>-<key>.pen`. Iterate on the canvas, mark `FINAL:<view>: <name>`, and approve at step 7.5.
3. After moving boxes: `pnpm noldor design arch-route --pen <the .pen> --view <view>` prints the snippet the agent runs through pencil `execute` to redraw the arrows. Save first if you drew new arrows.
4. Ship: gate Step 4 writes the change back into the baseline and runs the check.
5. Milestone: `/noldor-milestone draft` offers to sketch a target once a baseline exists. Approve it with `pnpm noldor design verdict --pen docs/design/architecture/milestones/<slug>.pen --approve --surface <view> --milestone <slug> --editor-page "<name>"`, and track it with `pnpm noldor design arch-progress --milestone <slug>`.
6. Any time: `pnpm noldor checks arch-baseline`. Release preflight runs it too.

## Open questions (resolved)

1. *Tags in layer names or in `metadata`?* → Layer names. The operator can read and fix them in the editor without an agent. `metadata` is invisible and is copied when a box is duplicated, which silently makes duplicate tags. (D1)
2. *Milestone designs in this slice?* → Yes, by the operator's call. A milestone sets a target picture, features realize it, and `arch-progress` measures the gap. (D2)
3. *Must every import be drawn?* → No. Drawn arrows must be real, and undrawn imports are advisory. Requiring every import would force a hairball on the one view that has code truth. (D3)
4. *Path predicate or a question?* → A question with the agent's recommendation, asked on every `specs-only-*` / `full-*` session once a baseline exists. The ship-time check is the backstop. Architecture changes are rarer and more deliberate than UI changes, and a module-level miss is caught at ship anyway. (D4)
5. *Generate the mermaid pages now?* → No, a follow-up slice. It doubles the surface, and Q-0210 should be decided in the same place. (D5)
6. *One baseline file or one per view?* → One file with four pages. The seed copies one file, and a session owns one design `.pen`. (D6)
7. *How do UI and architecture approvals avoid colliding?* → A kind-scoped approval directory. Filename tricks would break `penSlugFromFilename`. (D7)
8. *Re-route as prose or as a tested snippet?* → A tested snippet printed by a CLI. Untested JavaScript in skill prose would rot silently. (D8)
9. *Which views are held to code?* → `modules` only. The others get contract checks, because nothing in the repo derives actors, runnable units or flows deterministically. (D9)
10. *Where does a milestone target live, and what is it approved against?* → `docs/design/architecture/milestones/<slug>.pen`, approved against the milestone file with `--milestone`. A milestone has no spec. An undated name keeps every session-keyed resolver away from it. (D10)
11. *Does a milestone need its target reached to ship?* → No. `arch-progress` is advisory at `activate`, because milestones are optional and never block. (D11)
