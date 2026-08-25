// @tests: ui-design-review-lane
// The `geometry-compare` lane's pure half (spec D5/D6): pull value families out
// of a normalized document, then ask of each value whether the opposite side
// declares anything within tolerance of it, and turn what nothing explains into
// a per-surface verdict. No IO and no process state, so every rule the spec pins
// is testable without pencil MCP or a booted app.

import type { GeometryDoc } from './geometry-doc.js';

/** The families a surface is compared on. Edges are split by axis all the way
 * through — an unmatched value is only actionable if the operator knows whether
 * it is an x or a y coordinate. These are also the keys the parked lane's
 * per-surface `geometryTolerance`/`geometryBudget` recipe fields will carry
 * (Q-0180); today the two commands compare at the defaults below. */
export const GEOMETRY_FAMILIES = ['edgesX', 'edgesY', 'fontSize', 'spacing'] as const;
/** One of the families a surface is compared on. */
export type GeometryFamily = (typeof GEOMETRY_FAMILIES)[number];

/** Per-family numbers, keyed identically in config and in outcomes. */
export type FamilyRecord<T> = Record<GeometryFamily, T>;

/** Covering tolerance in CSS px per family, overridable per `uiBoot` recipe. */
export const DEFAULT_TOLERANCE: FamilyRecord<number> = {
  edgesX: 2,
  edgesY: 2,
  fontSize: 1,
  spacing: 1,
};
/** Unmatched values a family tolerates before it fails — zero, since the
 * document rules remove the systematic noise at its source. */
export const DEFAULT_BUDGET: FamilyRecord<number> = {
  edgesX: 0,
  edgesY: 0,
  fontSize: 0,
  spacing: 0,
};

/** Raw values per family. Edges are split by axis — a 24px left edge and a 24px
 * top edge are unrelated quantities that must never explain each other (spec
 * D5) — and each axis carries its own tolerance and budget so an unmatched value
 * arrives labelled. */
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

/**
 * The values in `side` that no value in `other` explains: a value is UNMATCHED
 * when nothing on the opposite side sits within `tolerance` of it. Linear over
 * two sorted lists, and exact — a value farther than the tolerance from every
 * counterpart is reported, one within the tolerance of any counterpart is not.
 *
 * This is a covering test, not a matching, and that distinction is the lesson of
 * the earlier attempts here. Pairing values one-to-one raised questions a
 * covering has no reason to ask: closest-pair greedy lost cardinality (design
 * {0,3} against {2,5}); pre-pairing exact values lost it differently (design
 * {1,2.5} against {2.5,4}); an edit-distance DP fixed cardinality but allocated
 * an (n+1)x(m+1) table over untrusted documents; and clustering-then-matching
 * composed two tolerances, so drift up to 1.5x the tolerance passed while the
 * docs claimed a hard bound. None of it served the question the spec asks —
 * whether a layout value one side declares appears on the other at all.
 * Near-duplicates, which clustering existed to absorb, are covered here by
 * construction: a wrapper stack repeating its child's edge is explained by
 * whatever design value the child's edge is.
 */
export function unmatchedValues(
  side: readonly number[],
  other: readonly number[],
  tolerance: number,
): number[] {
  const sorted = [...new Set(side)].sort((a, b) => a - b);
  if (other.length === 0) return sorted;
  const others = [...new Set(other)].sort((a, b) => a - b);
  const out: number[] = [];
  let j = 0;
  for (const v of sorted) {
    // `others` and `sorted` both ascend, so this pointer only moves forward:
    // advance while the NEXT counterpart is still no farther than the current
    // one, leaving `others[j]` as the nearest.
    while (j + 1 < others.length && Math.abs(others[j + 1] - v) <= Math.abs(others[j] - v)) j++;
    if (Math.abs(others[j] - v) > tolerance) out.push(v);
  }
  return out;
}

/** One family's comparison result. `implOnly` is always empty for `spacing`.
 * Severity is deliberately absent: it is a pure function of `unmatched` that
 * ignores `budget`, so storing it would put a `med` on a family with zero
 * unmatched values. Whichever caller reports findings derives it there — the
 * parked lane (Q-0180) is the first that will need to. */
export interface FamilyOutcome {
  unmatched: number;
  budget: number;
  designOnly: number[];
  implOnly: number[];
}

/** One surface's verdict plus the per-family record behind it. */
export interface GeometryComparison {
  verdict: 'pass' | 'fail';
  families: FamilyRecord<FamilyOutcome>;
}

/**
 * Compare two documents family by family (spec D5/D6). The edge axes and
 * `fontSize` count unmatched values in BOTH directions; `spacing` counts
 * design-only values alone, because UA-stylesheet margins (`h1`, `p`, `ul`) and
 * negative gutters are unrepresentable in pen, so counting implementation-only
 * spacing would fail real UI deterministically. Every family is always compared
 * — there is no skip path, so an implementation that introduces type the design
 * never specified surfaces as implementation-only font sizes rather than
 * vanishing.
 */
export function compareGeometry(
  design: GeometryDoc,
  impl: GeometryDoc,
  tolerance: FamilyRecord<number>,
  budget: FamilyRecord<number>,
): GeometryComparison {
  const d = extractFamilies(design);
  const i = extractFamilies(impl);
  // Each family is a two-way covering test at its own tolerance, and the two
  // edge axes stay separate families rather than one merged list: a bare
  // coordinate is not actionable unless the operator knows which axis it is on.
  // The whole tolerance applies to the single comparison that decides a value's
  // fate, so the guarantee is exact rather than composed across stages.
  // Both directions for every family EXCEPT spacing: an implementation spacing
  // value can only ever EXPLAIN a design value, never fail on its own —
  // UA-stylesheet margins on h1/p/ul and negative gutters are unrepresentable in
  // pen, so counting them would fail real UI deterministically.
  const sides: FamilyRecord<{ design: number[]; impl: number[]; twoWay: boolean }> = {
    edgesX: { design: d.edgesX, impl: i.edgesX, twoWay: true },
    edgesY: { design: d.edgesY, impl: i.edgesY, twoWay: true },
    fontSize: { design: d.fontSize, impl: i.fontSize, twoWay: true },
    spacing: { design: d.spacing, impl: i.spacing, twoWay: false },
  };
  const families = Object.fromEntries(
    GEOMETRY_FAMILIES.map((family) => {
      const { design: dv, impl: iv, twoWay } = sides[family];
      const designOnly = unmatchedValues(dv, iv, tolerance[family]);
      const implOnly = twoWay ? unmatchedValues(iv, dv, tolerance[family]) : [];
      return [
        family,
        {
          unmatched: designOnly.length + implOnly.length,
          budget: budget[family],
          designOnly,
          implOnly,
        },
      ];
    }),
  ) as FamilyRecord<FamilyOutcome>;
  const anyOverBudget = GEOMETRY_FAMILIES.some((f) => families[f].unmatched > families[f].budget);
  return { verdict: anyOverBudget ? 'fail' : 'pass', families };
}
