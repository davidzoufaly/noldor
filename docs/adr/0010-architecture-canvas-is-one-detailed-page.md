---
status: accepted
date: 2026-09-28
---

# Architecture Canvas Is One Detailed Page

## Context

`architecture-design-phase` (Q-0296) drew the architecture baseline as a copy of the mermaid overview: `docs/design/architecture/baseline.pen` holds one page per `docs/architecture/` view (`context`, `containers`, `modules`, `flows`), read through `ARCH_VIEWS` in `src/design/arch-pen.ts`. The canvas therefore said what the mermaid already said, at the same level of detail, and three of its four pages had no code truth. Its baseline also came from a one-off script, so a consumer's agent had no shipped way to draw one and had to invent the layout and the level itself.

Three other shapes were weighed. Keeping one page per mermaid view keeps the two surfaces in step, but it spends an infinite canvas on a copy of the overview. Regenerating the whole canvas from code and a config file at every ship would never go stale, but it throws away the hand layout, which is the reason to use a canvas at all. Folding in archify (backlog Q-0210) as one generator for mermaid and canvas pictures alike would couple the two surfaces again.

## Structural context

The decision lands in the feature's own communities: c58 (`arch-pen.ts`, `arch-route.ts`, `arch-progress.ts`), c110 (`arch-baseline.ts` and the `checks arch-baseline` wrapper) and c115 (`arch-check.ts`). It crosses into c57 (`src/indirection/module-pairs.ts`), where the check's single cruise now also yields file edges, and into c30 (`design-approval-cli.ts`), where `--surface` for an architecture `.pen` narrows to one value. No god node is on the path.

## Decision

The architecture baseline is one top-level page, `architecture`, drawn at a level between C4 containers and components: externals, then containers and stores, then modules, then parts inside modules. Code seeds it (`design arch-draw`: every module and its non-test sub-folders, no arrows) and adds new modules later without moving anything (`--refresh`). A person or agent finishes the layout by hand, following one shipped procedure page, `docs/noldor/architecture-canvas.md`. `checks arch-baseline` holds modules, parts and every arrow that touches a module or part to the code.

The `docs/architecture/*.md` mermaid pages stay a separate, hand-written overview. Neither surface is generated from the other.

This narrows one clause of [ADR 0007](0007-design-kinds-share-one-machinery.md): an approved architecture surface is `architecture`, the single page, not one of four views. The rest of 0007, one machinery for every design kind, stands unchanged.

## Consequences

Easier:
- Every repo starts from the same code-drawn canvas, and every runtime's agent follows the same page and the same shipped commands.
- The canvas holds detail the mermaid cannot, and the check keeps its most detailed layer honest.
- A session with no editor can still pay `missing-module` debt with `arch-draw --refresh`.

Harder:
- One page gets big on a large repo; groups, containers and zoom have to carry it.
- Two PRs that write the baseline back are more likely to conflict inside the one page.
- Externals, containers and stores have no code truth and can drift.

Ruled out:
- A canvas page per mermaid view.
- Regenerating the canvas from code at every ship.
- Generating the mermaid pages from the canvas, or the canvas from them, and archify as the generator for both.
