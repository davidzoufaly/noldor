---
noldor-page: architecture-canvas
introduced: 1.14.0
---

# Architecture Canvas

How to draw and keep `docs/design/architecture/baseline.pen`, the repo's one detailed architecture picture. Follow this page whenever you are asked to draw, finish, fix or update the architecture canvas. The `docs/architecture/*.md` mermaid pages are the short overview and stay hand-written; this canvas is the detailed picture, and the two are never generated from each other.

## The level

One page, named `architecture`, drawn between C4 containers and components. It reads from the outside in:

1. **Externals** round the edge: an `external: <Name>` box for each system the repo talks to (git, GitHub, npm, an agent runtime).
2. **Containers and stores:** a `container: <Name>` frame for each runnable unit (a CLI, a server, a hook runner), and a `store: <Name>` box for each place durable state lives.
3. **Modules** inside the containers: one box per module directory under the scan roots, named by its path (`src/cr`), inside `group: <Name>` frames by responsibility. A module more than one container uses goes in a `group: Shared` frame outside every container, and the containers point into it.
4. **Parts** inside each module box: smaller boxes named by a path under that module (`src/cr/lanes`, `src/cr/orchestrate.ts`). Keep the entry points and the sub-folders a reader needs, not every file.

## The names are the contract

The check reads layer names, never labels or geometry.

- A box named by a path is a module when the path is a module directory, and a part when it sits under one. `src/a + src/b` joins two modules in one box; every path in it must be a module.
- A part box must sit inside its module's box.
- `group: <Name>` frames group boxes. An arrow to a group stands for the modules in it, never its parts.
- `external:`, `container:` and `store:` name the outer layers. Spacing after the colon does not matter.
- An arrow is a path named `<from> -> <to>`, where each end is a box's name, one path a box covers, or a group's name.
- Anything else is decoration.

`pnpm noldor checks arch-baseline` holds the names to the code:

- `missing-module`, `unknown-module`, `duplicate-module`: every module is boxed exactly once.
- `unknown-part`, `misplaced-part`: every part exists and sits inside its module.
- `phantom-edge`: an arrow between two code paths needs a real import. Each end stands for the files under its path; when one end sits inside the other, the outer end counts only its files outside the inner one, so `src/cr/lanes -> src/cr` means "lanes imports the rest of `src/cr`".
- `dangling-edge`: an arrow end names nothing, or more than one box.
- `undrawn-edge` (advisory): a module import no arrow shows. It never fails the check.

Arrows that touch an external, container or store are checked only for resolving.

## Draw it the first time

1. `pnpm noldor design arch-draw` writes the baseline: every module in `group: Unplaced` with its sub-folders as parts, and one `container:`, `store:` and `external:` placeholder. It draws no arrows.
2. `pnpm noldor checks arch-baseline` is green on it straight away.
3. Open the file: `pnpm noldor design pen-bridge --pen docs/design/architecture/baseline.pen`. Pencil MCP needs a terminal Claude Code session; it does not connect under the VS Code extension.
4. Rename the placeholders and copy them for each runnable unit, store and external.
5. Move the modules out of `Unplaced` into `group:` frames inside the containers, and the shared ones into `group: Shared`. Delete `Unplaced` once it is empty.
6. Prune the parts a reader does not need, and add boxes for key files.
7. Draw the arrows that matter, group arrows first (`group: Workflow -> src/core`), then the module and part arrows the `undrawn-edge` rows point at. Do not draw them all.
8. Save, then `pnpm -s noldor design arch-route --pen docs/design/architecture/baseline.pen` and pass its stdout to pencil `execute` to lay the arrows border to border.
9. `pnpm noldor checks arch-baseline` until it is green.

## Keep it true

- **A module appears:** the check reports `missing-module`. Run `pnpm noldor design arch-draw --refresh`: the new module lands in `Unplaced` with its parts, and nothing else moves. Close or reload the file in the editor first, or its next save overwrites the refresh. Place the new box when an editor is at hand.
- **A module goes:** `--refresh` lists its box as gone. Delete it on the canvas.
- **A design changes the architecture:** `/noldor-spec` step 1.6 copies the baseline, the design ends on a `FINAL:architecture: <name>` page, and gate Step 4 writes the approved change back onto the current baseline.
- **Boxes moved:** arrows are loose paths, so re-run `design arch-route` after dragging.
