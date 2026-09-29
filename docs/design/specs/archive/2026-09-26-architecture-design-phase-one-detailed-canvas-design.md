# One Detailed Architecture Canvas — Design

**Slug:** architecture-design-phase
**FD:** docs/features/architecture-design-phase.md
**Date:** 2026-09-26
**Tier:** full

## Problem

`docs/design/architecture/baseline.pen` copies the four mermaid pages one for one: it has a page each for `context`, `containers`, `modules` and `flows` (`ARCH_VIEWS`, `src/design/arch-pen.ts:13`, taken from `ARCHITECTURE_PAGES`). So the canvas says what the mermaid already says, at the same small level of detail. Three of its four pages have no code truth. An infinite canvas can hold far more than a mermaid box graph, and today it holds a second copy of the overview.

A consumer cannot make one either. This repo's baseline came from a one-off script that never shipped. A consumer's agent gets a one-line recipe (the FD Usage, step 1) and has to invent the layout, the grouping and the level of detail itself. Charuy has no baseline, so every architecture step in its gate stays switched off.

UI verdict: skip — this repo declares no `consumer.uiPaths`, and the change draws no screen.

Architecture verdict: skip — the change rebuilds the canvas itself through a generator. It adds no module, package or import to design first.

## Goals

1. One page, one picture: a detailed canvas at a level between C4 containers and components. It shows externals, runnable units and stores, the modules inside them, and the parts inside each module.
2. The mermaid pages stay the short overview, and the canvas is the detailed one. They stop repeating each other.
3. A shipped command draws the first canvas from the code and adds new modules later, so every consumer starts from the same place.
4. A shipped procedure page tells any agent (Claude, codex, opencode) how to finish, check and maintain the canvas.
5. The check, re-route, progress, verdict, and the spec and milestone steps all work on the one page.

## Non-goals

- Generating mermaid from the canvas, or the canvas from mermaid. The two are written separately on purpose.
- Moving FD `## Diagram` sections off mermaid.
- Archify (backlog Q-0210). It is dropped, not deferred.
- Code truth for externals, containers and stores. Nothing in the repo derives them.
- Auto-layout after the first draw. Placing boxes is the operator's job, and it is the reason to use a canvas.
- Redrawing the whole canvas at every ship. It would throw the hand layout away.

## Design

### Structural context

Graph read over the parent FD's code (`design graph-context`, status `fresh`). The reader, re-route and progress sit together in community c58, owned by `architecture-design-phase`. The check wrapper and `checkArchBaseline` sit in c110. Its cross-community edges run to release preflight (`preflight-probes.ts`, c59), `scanRoots()` (c56), `docs-architecture.ts` (c0) and `design-artifact-names.ts` (c34). `arch-check.ts` is alone in c115 and imports `pairKey()` from `module-pairs.ts` (c57, owned by `abstraction-cost-ratchet`). No god node is on the path. Every file is interior to this feature except two call sites: the release probe, and `design-approval-cli.ts` (c30), which reads `ARCH_VIEWS` for `--surface`. So the change stays inside the feature's own files plus those two.

### Canvas level and layers

Recorded as [ADR 0010](../../adr/0010-architecture-canvas-is-one-detailed-page.md). The baseline has one top-level page, named `architecture`. It reads from the outside in, the way you zoom:

1. **Externals** round the edge: `external: <Name>` boxes (git, GitHub, npm, agent runtimes, pencil, graphify).
2. **Containers and stores:** a `container: <Name>` frame per runnable unit (CLI, hook jobs, dashboard), and a `store: <Name>` box per durable state (`.noldor/`, `docs/`).
3. **Modules** inside the containers: the `src/*` boxes, in `group:` frames as today. A module used by more than one container sits in a `group: Shared` frame outside every container, and the containers point into it. Nobody has to judge which container "owns" it, so two agents draw it the same way.
4. **Parts** inside each module box: smaller boxes named by a path under that module (`src/cr/lanes`, `src/cr/orchestrate.ts`). This is the level between containers and components. An agent keeps the entry points and the sub-folders that matter, not every file.

Arrows still use `<from> -> <to>`, and they may join any two named things at any layer.

### Tag contract

The layer-name grammar in `arch-pen.ts` gains three prefixes, `external:`, `container:` and `store:`, beside `group:`. A box whose name is a path is a **path box**: segments of `A-Z a-z 0-9 _ . @ -` joined by `/`, the grammar `moduleRefsOf` already uses (`src/design/arch-pen.ts`), and ` + ` still joins several paths into one box (`src/a + src/b`). Every path a `+` box names must be a module; a member that is not gives `unknown-module`. The pure reader cannot tell a module from a part, because it has no module list, so it returns each path box with the path of its nearest path-box ancestor. The check sorts them, because it has the list: a path in `listModuleDirs` is a module box, a path under a module is a part box, and anything else is `unknown-module`. The three new prefixes take the same spacing canonicalization `group:` gets, so `container:CLI` and `container: CLI` are one name. An endpoint naming a `container:`, `store:` or `external:` box resolves to that box, and never expands to the modules inside it, so such an arrow is checked for resolving only.

`ARCH_VIEWS` and the page-per-view read go away. In a baseline, the reader wants exactly one top-level page named `architecture`; none, or more than one, reads as `unreadable`. In a design file, it reads `BASE:architecture: …`, `architecture: <variant>` and `FINAL:architecture: <name>`. The `FINAL:<surface>:` grammar and page roles are unchanged, with `architecture` as the only surface. `ARCHITECTURE_PAGES` (`src/docs/architecture-schema.ts:49`) stays as it is, because the mermaid surface still uses it. A baseline with the old four pages and no `architecture` page reads as `unreadable`, and the message names `design arch-draw`.

### Honesty check

`checks arch-baseline` keeps its module rules on the one page: `missing-module`, `unknown-module`, `duplicate-module`, `phantom-edge`, `dangling-edge`, `unreadable`, and the advisory `undrawn-edge`. Module-to-module and group arrows expand and match against module pairs exactly as today (`checkArchDoc`, `src/design/arch-check.ts`). A group expands to the module boxes inside it, never to parts. It gains two part rules, both exit 1: `unknown-part`, a part whose path does not exist on disk, and `misplaced-part`, a part box that is not inside the box of the module its path falls under. The pure rule function takes the set of existing part paths as an input, and `checkArchBaseline` (`src/design/arch-baseline.ts:37`) gathers it with `stat`, so `arch-check.ts` stays pure.

An arrow that touches a part is held to the files. Each end stands for the files under its path. When one end's path is inside the other's, the outer end stands only for its files outside the inner path. The arrow is real when a file of its `from` end imports a file of its `to` end, and `phantom-edge` otherwise. So `src/cr/lanes -> src/cr` means "lanes imports the rest of `src/cr`", `src/cr -> src/cr/lanes` means "the rest of `src/cr` imports lanes", and imports inside `src/cr/lanes` back neither — the file-level twin of `pairsFromFiles` dropping `to === from` (`src/indirection/module-pairs.ts:34`). That covers part-to-part, part-to-module and module-to-part arrows alike. The file edges come from the one cruise `moduleImportPairs` already runs (`cruiseFileGraph`, `src/indirection/module-pairs.ts:52`). A sibling result field returns the file edges before `pairsFromFiles` (:25) collapses them to modules, so the check still cruises once. An import between parts that no arrow covers is **not** reported, because at file level that list would bury the module advisories. Arrows that touch an external, container or store are checked only for resolving.

### Draw command

`pnpm noldor design arch-draw` (new, `src/design/arch-draw.ts`) writes the baseline from code truth when none exists. It puts every module from `listModuleDirs` in a grid inside one `group: Unplaced` frame. It adds one placeholder each of `container: <Name>`, `store: <Name>` and `external: <Name>`, so the agent sees the three prefixes in use and renames or copies them. Inside each module box it seeds one part box per direct sub-folder, skipping test folders (`__tests__`, `test`, `tests`, `fixtures`), so every repo's agent starts from the same parts. The agent then prunes the parts that do not matter and adds key files by hand. It draws **no arrows**. This repo has about 120 module import pairs, and all of them at once would be a hairball the agent has to delete down. The check's `undrawn-edge` advisories already list every import, and the procedure page says which to draw, group arrows such as `group: Workflow -> src/core` first. It writes the `.pen` JSON directly, like the old bootstrap, because the check reads the file on disk. It refuses to overwrite an existing baseline (exit 1), writing a temp file and linking it into place without replacing, so two draws cannot race and a crash leaves no half-written baseline.

`--refresh`, run with a baseline present, adds a box for each module no box covers to `group: Unplaced`, seeds that box's parts, and lists (never deletes) boxes whose module is gone. It never moves, resizes or renames a box that is already there, and writes through `atomicWriteFileSync` (`src/core/atomic-write.ts`) so a crash leaves the old file whole. Because it needs no editor, `--refresh` is also how a headless drain or a bridge-less session pays `missing-module` debt: the new module lands in `Unplaced`, the check goes green, and the placing waits for a human. Exit 0 on a write or a no-op, 1 on an unreadable baseline.

### Agent procedure

`docs/noldor/architecture-canvas.md` (new, with its `templates/docs/noldor/` twin and a row in the `docs/noldor/README.md` route table) is the one place an agent learns the job. It covers the four layers and what goes in each, the layer-name grammar, and the steps: run `arch-draw`, then open the file with `design pen-bridge`. Next, place the modules into groups and containers, move shared modules into `group: Shared`, prune and add parts, add externals and stores, and draw the arrows that matter. Finish with `design arch-route` and `checks arch-baseline` until green. It also says how to keep the canvas true: the gate Step 4 write-back for approved designs, and `arch-draw --refresh` whenever the check reports `missing-module`.

`arch-design.md` (spec step 1.6), the gate's `design-writeback.md` and the milestone skill's target step link to this page rather than each carrying its own copy of the contract. That is why a charuy agent handed "draw the architecture canvas" acts the same as ours: the router table points it at one page, and every step on that page is a shipped command.

### Other call sites

- `design arch-route` (`src/design/arch-route.ts`): `--view` goes away, and it routes every arrow on the page.
- `design arch-progress` (`src/design/arch-progress.ts`): it compares the target's one `FINAL:` page with the baseline page. Modules and parts compare by path, other boxes by name, and arrows by endpoint pair.
- `design verdict` (`src/design/design-approval-cli.ts:536`): for an architecture `.pen`, `--surface` takes `architecture` only.
- `/noldor-spec` step 1.6 and `/noldor-milestone` draft: the seed renames one page to `BASE:architecture: as-built`, not four.
- `design-writeback.md`: one `FINAL:architecture:` page to re-apply, and `arch-draw --refresh` as the fix when the check reports `missing-module` on a session with no approved design.
- `docs/noldor/gotchas.md`, `docs/noldor/script-catalog.md` and the regenerated `AGENTS.md` capability index gain `arch-draw`. Skill files ride this branch under `NOLDOR_ALLOW_SHARED=1`, as in Q-0201.
- The FD's Summary and Usage: rewritten at close to the one-page contract. Its current "every arrow backed by a real import" is true only of arrows that touch a module or part; outer-layer arrows are held to resolving.
- This repo's baseline: regenerated with `arch-draw`. The old six groups and ten arrows are not carried over; the operator regroups the modules and draws the arrows at the canvas, guided by the `undrawn-edge` advisories.

### Backlog cleanup

Q-0210 (archify) is removed with `pnpm noldor roadmap remove-block --backlog`, in its own `docs(triage)` commit on this branch. It rides this PR because dropping archify is part of this design, and the tool removes the block rather than a hand edit.

## Acceptance criteria

1. `readArchPen` reads one `architecture` page from a baseline, and the `BASE:`, variant and `FINAL:` forms from a design file. A baseline with no `architecture` page, or more than one, is `unreadable`.
2. On the one page, module boxes, module-to-module arrows and group arrows give the same findings the `modules` view gives today.
3. A part whose path does not exist gives `unknown-part`. A part outside its module's box gives `misplaced-part`. Both exit 1.
4. An arrow that touches a part passes when a file of its `from` end imports a file of its `to` end, where the outer of two nested ends counts only its files outside the inner one. It gives `phantom-edge` when none does, including a nested arrow backed only by imports inside the inner path. An undrawn import between parts is not reported.
5. An arrow touching an `external:`, `container:` or `store:` box passes when both ends resolve, and gives `dangling-edge` when one does not.
6. With no baseline, `design arch-draw` writes one that `checks arch-baseline` passes. It boxes every module once, seeds each module's non-test sub-folders as parts, and draws no arrows. With a baseline present it exits 1 and leaves the file untouched.
7. `design arch-draw --refresh` adds a box (with parts) for each uncovered module, keeps every existing box's position, size and name, and lists boxes whose module is gone without deleting them.
8. `design arch-route` and `design arch-progress` work on the one page, and `design verdict --surface architecture` records an approval for an architecture `.pen`.
9. `docs/noldor/architecture-canvas.md` exists with its template twin and a route-table row, and the spec, gate and milestone skills link to it.
10. This repo's `baseline.pen` is one `architecture` page, and `checks arch-baseline` is green on it.
11. Q-0210 is gone from `docs/backlog.md`.

## Risks / trade-offs

- **Busy canvas.** A detailed page for a repo with many modules gets big. Groups, containers and zoom are the answer, and it stays one page.
- **Parts rot slowly.** A part is existence-checked, so it stays drawn after it stops mattering and fails only when its path is deleted.
- **No truth for the outer layers.** Externals, containers and stores can drift, as the mermaid pages can.
- **Part arrows are coarse.** A part arrow is real when any one file pair across its two ends imports, so a part folder with one real import can hide a stale claim.
- **A breaking change to the baseline format.** The old four-page file stops reading. Only this repo has a baseline, and charuy is the only consumer, so there is no migration path, per the no-compat policy.
- **The first draw looks bad.** Everything starts in one `Unplaced` grid. The picture is only good after a human places it, and a `--refresh` from a drain adds to that pile.
- **Refresh under an open editor.** A `--refresh` while pen.dev holds the baseline is lost if the editor saves its own copy afterwards. The procedure page says to close or reload the file first. Two refreshes at once can lose one side's added boxes; the next refresh adds them again.
- **Write-back conflicts.** Two PRs that both touch `baseline.pen` conflict inside one JSON file, as today. One page makes that more likely than four did.

## User Story

As an operator or a consumer's agent, I want one detailed architecture canvas that a shipped command starts from the code and a shipped page tells me how to finish and keep true, so that every repo gets the same picture at the same level without inventing the method.

## Usage

1. Start: `pnpm noldor design arch-draw` writes `docs/design/architecture/baseline.pen`, with every module in `group: Unplaced` and its sub-folders as parts.
2. Finish by following `docs/noldor/architecture-canvas.md`: open the file with `pnpm noldor design pen-bridge --pen docs/design/architecture/baseline.pen`, place and group the modules, add externals, containers, stores and parts, and draw the arrows that matter. Then run `pnpm -s noldor design arch-route --pen docs/design/architecture/baseline.pen` (stdout to pencil `execute`) and `pnpm noldor checks arch-baseline` until green.
3. Keep it true: gate Step 4 writes approved designs back. When the check reports `missing-module`, run `pnpm noldor design arch-draw --refresh`, then place the new boxes.
4. Design on it: `/noldor-spec` step 1.6 seeds a copy with one `BASE:architecture: as-built` page. Draw on variants, mark the winner `FINAL:architecture: <name>`, and approve with `design verdict --surface architecture`.

## Open questions (resolved)

1. *One page, or several pages at different zoom levels?* → One page. The canvas is infinite, and one page keeps seed, verdict and progress simple. (D1)
2. *Keep `flows` on the canvas?* → No. A flow is a sequence, which mermaid draws better, and it stays in `docs/architecture/flows.md`. (D2)
3. *How detailed is "between containers and components"?* → Four layers: externals, containers and stores, modules, and parts inside modules. Parts are the detail mermaid cannot hold. (D3)
4. *Where does a module used by several containers go?* → `group: Shared`, outside every container. There is no ownership call, so agents agree. (D4)
5. *Must a part arrow have an import behind it?* → Yes, at file level. The most detailed layer stays as honest as the module layer. Undrawn part imports stay unreported, to avoid noise. (D5)
6. *Does `arch-draw` seed parts and arrows?* → It seeds parts (non-test sub-folders), because a code-picked start is the same everywhere. It seeds no arrows, because every import is a hairball. The advisories list them instead. (D6)
7. *Seed by code and finish by hand, or regenerate at every ship?* → Seed and finish. Regenerating throws the layout away, and then the canvas is only a big mermaid. (D7)
8. *Drop Q-0210 here or in a separate triage?* → Here, in its own `docs(triage)` commit. The decision to drop it belongs to this design. (D8)
</content>
