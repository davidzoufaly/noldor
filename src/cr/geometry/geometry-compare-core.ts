// @tests: ui-design-review-lane
// The `geometry-compare` lane's pure half (spec D5/D6): pull three value
// families out of a normalized document, cluster each side's values, match the
// clusters optimally, and turn what is left over into a per-surface verdict.
// No IO and no process state, so every rule the spec pins is testable without
// pencil MCP or a booted app.

import type { GeometryDoc } from './geometry-doc.js';

/** The three families, and the exact keys `geometryTolerance`/`geometryBudget` use. */
export const GEOMETRY_FAMILIES = ['edges', 'fontSize', 'spacing'] as const;
export type GeometryFamily = (typeof GEOMETRY_FAMILIES)[number];

/** Per-family numbers, keyed identically in config and in outcomes. */
export type FamilyRecord<T> = Record<GeometryFamily, T>;

export const DEFAULT_TOLERANCE: FamilyRecord<number> = { edges: 2, fontSize: 1, spacing: 1 };
export const DEFAULT_BUDGET: FamilyRecord<number> = { edges: 0, fontSize: 0, spacing: 0 };

/** Raw values per family. `edges` splits by axis — a 24px left edge and a 24px
 * top edge are unrelated quantities that must not match each other — while both
 * axes still share one tolerance and one budget (spec D5). */
export interface FamilyValues {
  edgesX: number[];
  edgesY: number[];
  fontSize: number[];
  spacing: number[];
}

/**
 * Zero spacing values are dropped HERE rather than at the document boundary:
 * `getComputedStyle` reports `0px` on nearly every element, so a zero would put
 * a value in every implementation population and none in any design one — while
 * the record itself must keep zero sides positionally (see `geometry-doc.ts`).
 */
export function extractFamilies(doc: GeometryDoc): FamilyValues {
  const out: FamilyValues = { edgesX: [], edgesY: [], fontSize: [], spacing: [] };
  const spacing = (v: number | undefined): void => {
    if (v !== undefined && v !== 0) out.spacing.push(v);
  };
  for (const n of doc.nodes) {
    out.edgesX.push(n.box.x, n.box.x + n.box.w);
    out.edgesY.push(n.box.y, n.box.y + n.box.h);
    // Narrowing on the discriminant, not an undefined check: the union's text
    // member types fontSize as a required number.
    if (n.kind === 'text') out.fontSize.push(n.fontSize);
    spacing(n.spacing?.rowGap);
    spacing(n.spacing?.columnGap);
    for (const side of n.spacing?.padding ?? []) spacing(side);
    for (const side of n.spacing?.margin ?? []) spacing(side);
  }
  return out;
}
