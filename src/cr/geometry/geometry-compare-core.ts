// @tests: ui-design-review-lane
// The `geometry-compare` lane's pure half (spec D5/D6): pull three value
// families out of a normalized document, cluster each side's values, match the
// clusters optimally, and turn what is left over into a per-surface verdict.
// No IO and no process state, so every rule the spec pins is testable without
// pencil MCP or a booted app.

import type { GeometryDoc } from './geometry-doc.js';

/** The three families. These are also the keys the parked lane's per-surface
 * `geometryTolerance`/`geometryBudget` recipe fields will carry (Q-0180); today
 * the two commands compare at the defaults below. */
export const GEOMETRY_FAMILIES = ['edges', 'fontSize', 'spacing'] as const;
/** One of the three families a surface is compared on. */
export type GeometryFamily = (typeof GEOMETRY_FAMILIES)[number];

/** Per-family numbers, keyed identically in config and in outcomes. */
export type FamilyRecord<T> = Record<GeometryFamily, T>;

/** Clustering tolerance in CSS px per family, overridable per `uiBoot` recipe. */
export const DEFAULT_TOLERANCE: FamilyRecord<number> = { edges: 2, fontSize: 1, spacing: 1 };
/** Unmatched values a family tolerates before it fails — zero, since the
 * document rules remove the systematic noise at its source. */
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

/**
 * Cluster near-duplicate values into representatives (spec D6 stage 1): exact
 * duplicates collapse, the list sorts ascending, and a cluster admits a value
 * only while the cluster's own WIDTH stays within the tolerance. The
 * representative is the arithmetic mean — named explicitly because "median" is
 * ambiguous for an even-sized cluster, and at a 1px tolerance that ambiguity
 * flips match outcomes.
 *
 * The width bound is what makes the result sound. Single-linkage (compare
 * against the PREVIOUS value instead of the cluster's first) chains: at
 * tolerance 2, implementation edges 24, 26 and 28 would form one cluster with
 * representative 26, which then matches a design edge at 24 — so a 28px edge
 * sitting 4px off the design reports nothing at all. Bounding the width caps how
 * far a representative can drift from every member it speaks for.
 */
export function clusterValues(values: readonly number[], tolerance: number): number[] {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const out: number[] = [];
  let current: number[] = [];
  for (const v of sorted) {
    if (current.length > 0 && v - current[0] > tolerance) {
      out.push(mean(current));
      current = [];
    }
    current.push(v);
  }
  if (current.length > 0) out.push(mean(current));
  return out;
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** What matching one family's two cluster lists produced. */
export interface ClusterMatch {
  /** `[designRep, implRep]` per matched pair, in ascending design order. */
  pairs: [number, number][];
  designOnly: number[];
  implOnly: number[];
}

/**
 * Match the two sides' representatives (spec D6 stage 2). Both lists are sorted
 * and matching must be order-preserving, so a single forward scan is
 * maximum-cardinality optimal: pair the two heads when they are within
 * tolerance, otherwise drop the smaller head, which can never match anything
 * further along the other side because everything ahead of it is larger. Linear
 * time, and nothing allocated beyond the outputs — which matters for documents
 * this module treats as untrusted, since an edit-distance dynamic program would
 * build an (n+1)x(m+1) table and a long-page capture with a couple of thousand
 * distinct values per side turns that into millions of cells.
 *
 * CLOSEST-PAIR greedy is what fails on cardinality: taking the globally
 * smallest difference first turns design {0,3} against implementation {2,5} at
 * tolerance 2 into one pair (3-2) plus two unmatched values, inventing drift.
 * Pre-pairing EXACT values first fails the same way, less obviously — design
 * {1, 2.5} against implementation {2.5, 4} at tolerance 2 has a full matching
 * (1-2.5 and 2.5-4), but consuming 2.5-2.5 first strands 1 and 4 three apart.
 *
 * Known reporting caveat, deliberately not fixed here. The COUNT of unmatched
 * values is exact and is what the verdict rests on, but when several values sit
 * within tolerance of each other the leftover this scan NAMES can be a
 * neighbour of the true intruder: design [3] against implementation [1, 3]
 * pairs 3 with 1 and names an implementation-only 3, when 1 is the value with
 * no counterpart. Both are within tolerance of 3, so either answer is a
 * defensible partner; only the label is arguable. A post-pass that swapped
 * labels was tried and removed — it cost two review rounds and an O(pairs x
 * leftovers) scan to improve a cosmetic field, and the evidence artifact lists
 * every value on both sides anyway.
 */
export function matchClusters(
  design: readonly number[],
  impl: readonly number[],
  tolerance: number,
): ClusterMatch {
  const pairs: [number, number][] = [];
  const designOnly: number[] = [];
  const implOnly: number[] = [];
  let i = 0;
  let j = 0;
  while (i < design.length && j < impl.length) {
    if (Math.abs(design[i] - impl[j]) <= tolerance) {
      pairs.push([design[i], impl[j]]);
      i++;
      j++;
    } else if (design[i] < impl[j]) {
      designOnly.push(design[i]);
      i++;
    } else {
      implOnly.push(impl[j]);
      j++;
    }
  }
  for (; i < design.length; i++) designOnly.push(design[i]);
  for (; j < impl.length; j++) implOnly.push(impl[j]);
  return { pairs, designOnly, implOnly };
}

/** One family's comparison result. `implOnly` is always empty for `spacing`.
 * Severity is deliberately absent: it is a pure function of `unmatched` that
 * ignores `budget`, so storing it would put a `med` on a family with zero
 * unmatched values. Whichever caller reports findings derives it there — the
 * parked lane (Q-0180) is the first that will need to. */
export interface FamilyOutcome {
  family: GeometryFamily;
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
 * Compare two documents family by family (spec D5/D6). `edges` and `fontSize`
 * count unmatched clusters in BOTH directions; `spacing` counts design-only
 * leftovers alone, because UA-stylesheet margins (`h1`, `p`, `ul`) and negative
 * gutters are unrepresentable in pen, so counting implementation-only spacing
 * would fail real UI deterministically. Every family is always compared — there
 * is no skip path, so an implementation that introduces type the design never
 * specified surfaces as implementation-only font sizes rather than vanishing.
 */
export function compareGeometry(
  design: GeometryDoc,
  impl: GeometryDoc,
  tolerance: FamilyRecord<number>,
  budget: FamilyRecord<number>,
): GeometryComparison {
  const d = extractFamilies(design);
  const i = extractFamilies(impl);
  const match = (dv: readonly number[], iv: readonly number[], tol: number): ClusterMatch =>
    matchClusters(clusterValues(dv, tol), clusterValues(iv, tol), tol);

  const x = match(d.edgesX, i.edgesX, tolerance.edges);
  const y = match(d.edgesY, i.edgesY, tolerance.edges);
  const font = match(d.fontSize, i.fontSize, tolerance.fontSize);
  const space = match(d.spacing, i.spacing, tolerance.spacing);

  const outcome = (
    family: GeometryFamily,
    designOnly: number[],
    implOnly: number[],
  ): FamilyOutcome => {
    const unmatched = designOnly.length + implOnly.length;
    return { family, unmatched, budget: budget[family], designOnly, implOnly };
  };

  const families: FamilyRecord<FamilyOutcome> = {
    edges: outcome('edges', [...x.designOnly, ...y.designOnly], [...x.implOnly, ...y.implOnly]),
    fontSize: outcome('fontSize', font.designOnly, font.implOnly),
    // One-directional: the implementation's spacing values are a matching pool,
    // never a source of failure.
    spacing: outcome('spacing', space.designOnly, []),
  };
  // The failing set is recomputed by callers that need it (one filter over
  // `families`) rather than carried here: `verdict === 'fail'` already encodes
  // the same predicate, and a second derived view is one more thing to keep
  // consistent for no reader.
  const anyOverBudget = GEOMETRY_FAMILIES.some((f) => families[f].unmatched > families[f].budget);
  return { verdict: anyOverBudget ? 'fail' : 'pass', families };
}
