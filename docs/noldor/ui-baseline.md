---
noldor-page: ui-baseline
---

# UI Baseline Contract

How a UI baseline — `docs/design/ui/baseline/<surface>.pen` — is laid out and named. Your capture command (`consumer.uiCapture`) writes the file, and a hand edit (`pnpm noldor design ui-sync`, or the gate's Step 4 write-back) keeps to the same rules. `pnpm noldor design capture` refuses a receipt for a baseline that breaks them, and `pnpm noldor checks ui-design-freshness` reports it as `invalid`. Both name the node.

## Layout

- **Pages are top-level frames.** Every page is a direct child of the document. Never nest a page inside a row frame or a group: the review lanes read only top-level `FINAL:<surface>:` frames, so a nested page is invisible to review.
- **One labelled row per app area.** A top-level text node sits above each row as its label. The label is the pages' sibling, not their parent, for the same reason. Every top-level text node counts as a row label. A top-level node of any other type — a group, a rectangle, a note — is neither a page nor a label.
- **A row is a band.** It runs from its label's top edge down to the next label's top edge, and a page belongs to the band its top edge falls in. The page's top edge sits at least one label `fontSize` below its label's top, so the title never covers it. Its bottom edge is no lower than the next label's top.
- **Titles are huge.** Every row label has a `fontSize` of at least 200, so each area can be read with the whole canvas zoomed to fit.
- **Twins sit side by side.** When the surface declares `consumer.uiCoverage.<surface>.modes`, read each row left to right by `x`. A state's pages are consecutive — no other page between them — and in the order `modes` lists them. The gap between them is free.

## Ids

- **Unique** across the whole document. A declared page id carried by two top-level pages is reported once, by coverage, as a duplicate page.
- **No `/`.** The pen schema forbids it in an id: `/` separates a descendant path.
- **Never counted.** Ten or more ids of the form `<lowercase letters><number>` on one prefix (`n1` … `n10`) read as an emitter counting nodes. A counted id shifts when a node is added before it, so no review, spec or agent can cite it.

### Recommended grammar

Not enforced, but it gives every id a meaning that survives the next capture:

| Node      | Id                                                               | Example                          |
| --------- | ---------------------------------------------------------------- | -------------------------------- |
| Page      | `<state>-<mode>`, or `<state>` alone when the surface has no modes | `empty-scene-dark`               |
| Row label | `area-<area>`                                                    | `area-chat`                      |
| Element   | `<parent id>.<segment>`                                          | `empty-scene-dark.bar.icon-plus` |

The segment is the kebab-cased `data-testid`, else the icon name, the `aria-label`, the slot, the role, then the layer name. Only a repeated sibling takes a `-2`, `-3` … suffix. Siblings are unique and a segment carries no `.`, so every id is unique across the document.

## Example

Two rows, each with one state's dark page beside its light twin:

```json
{
  "version": "2.19",
  "children": [
    { "type": "text", "id": "area-scene", "content": "Scene", "fontSize": 240, "x": 0, "y": 0 },
    { "type": "frame", "id": "rest-dark", "name": "FINAL:app: rest — dark", "x": 0, "y": 320, "width": 1440, "height": 900, "children": [] },
    { "type": "frame", "id": "rest-light", "name": "FINAL:app: rest — light", "x": 1480, "y": 320, "width": 1440, "height": 900, "children": [] },
    { "type": "text", "id": "area-chat", "content": "Chat", "fontSize": 240, "x": 0, "y": 1460 },
    { "type": "frame", "id": "chat-open-dark", "name": "FINAL:app: chat open — dark", "x": 0, "y": 1780, "width": 1440, "height": 900, "children": [] },
    { "type": "frame", "id": "chat-open-light", "name": "FINAL:app: chat open — light", "x": 1480, "y": 1780, "width": 1440, "height": 900, "children": [] }
  ]
}
```

## Findings

| Code               | Means                                                                                                        | Fix                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `duplicate-id`     | An id is carried by more than one node.                                                                      | Rename all but one.                          |
| `slash-id`         | An id contains `/`.                                                                                          | Use `.` as the path separator instead.       |
| `counter-id`       | Ten or more `<letters><number>` ids share a prefix.                                                          | Build ids from names, not from a counter.    |
| `nested-page`      | A `FINAL:` page is not a top-level frame.                                                                    | Move it to the top level.                    |
| `page-outside-row` | A page has no label above it, starts closer to its label than the label's `fontSize`, or reaches past the next label. | Move the page or the label.                  |
| `small-row-label`  | A row label's `fontSize` is under 200, or is not a plain number.                                             | Set a `fontSize` of at least 200.            |
| `twin-order`       | A state's pages are not side by side in `modes` order.                                                       | Reorder the row.                             |

Fix a captured baseline in the capture command and run `pnpm noldor design capture` again. Fix a hand-authored one in the editor, following `pnpm noldor design ui-sync`.
