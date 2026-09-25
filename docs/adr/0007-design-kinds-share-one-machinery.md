---
status: accepted
date: 2026-09-24
---

# Design Kinds Share One Machinery

## Context

The pen.dev UI design phase (`pendev-ui-design-phase`) grew a full loop around `.pen` files:
- a baseline of what shipped
- a design file seeded per session and keyed by its dialogue key (`dialogueKeyFromSession`, `src/design/archive-resolve.ts`)
- an approval record bound to the `.pen` blob and the spec (`src/design/design-approval.ts`)
- a pre-commit guard that refuses an unapproved design or a baseline staged from a feature worktree (`src/checks/check-shared-files.ts`)
- an archive move at ship
- a `pen-bridge` that wakes the editor

`architecture-design-phase` (Q-0296) adds a second kind of design with the same lifecycle: an architecture baseline, a design `.pen` per feature or milestone, approval, and a ship write-back.

Most of that machinery is already generic: receipts, blob ids, the approval schema, dialogue-key matching, archive ownership and ancestry. What ties it to UI is paths, hard-coded as `UI_DESIGN_DIR` / `UI_BASELINE_DIR` in `src/core/design-artifact-names.ts`, plus approval records keyed by `.pen` stem alone. A separate architecture flow was weighed and set aside. It would leave the UI code untouched, but it would copy about eight mechanisms whose copies would then drift apart, and the operator would have two flows to learn for one lifecycle.

## Structural context

The decision lands in community c25: `src/core/design-artifact-names.ts`, `src/checks/check-shared-files.ts` and `src/design/archive-resolve.ts`, the naming and `.pen` guard cluster. It reaches c26 (`src/design/design-approval.ts`), c33 (`src/design/design-approval-cli.ts`) and c0 (`src/design/pen-bridge.ts`) through their existing imports. It touches one god node, `loadDocRoots()` in `src/core/doc-roots.ts` (rank #1, 89 edges), by adding a field to its return value rather than changing its shape. `design-artifact-names.ts` is imported across five communities, which is why the per-kind locations go beside the UI constants instead of replacing them.

## Decision

Every kind of design artifact goes through one set of machinery. There is one approval record, one pre-commit `.pen` guard, one archive move, one `pen-bridge` and one dialogue-key resolver, and each takes the design kind (`DesignKind`, today `'ui' | 'architecture'`) from the artifact's path. The kind decides where things live — the design directory, the baseline location and the approval-record directory — and, for an architecture design, that every approved surface is one of the four views; the rest of the lifecycle is the same for every kind. An approval record's path mirrors its `.pen`'s place, so two kinds never collide on a shared stem.

A new design kind declares its locations and reuses the lifecycle. It does not get a parallel flow. Kind-specific behaviour, such as UI capture or the architecture honesty check, lives in its own module beside the shared machinery.

## Consequences

Easier:
- The operator learns one lifecycle (seed, iterate, `FINAL:`, verdict, archive, write-back) for every design kind.
- A fix to the guard, the approval binding or the archive move reaches every kind at once.
- A third kind costs a set of locations, not a copy of the flow.

Harder:
- Changes to the shared machinery now have to hold for every kind. A UI-motivated edit to the approval CLI or the guard must keep architecture working, and the reverse.
- Tests have to cover each kind at every shared seam.

Ruled out:
- A per-kind copy of the approval, guard, archive or bridge code.
- Approval records keyed by stem alone once a second kind exists.
- Telling kinds apart by filename tricks, which would break `penSlugFromFilename`.
