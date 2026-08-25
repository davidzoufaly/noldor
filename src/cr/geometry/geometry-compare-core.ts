// @tests: ui-design-review-lane
// The `geometry-compare` lane's pure half (spec D5/D6): pull three value
// families out of a normalized document, cluster each side's values, match the
// clusters optimally, and turn what is left over into a per-surface verdict.
// No IO and no process state, so every rule the spec pins is testable without
// pencil MCP or a booted app.

import type { Severity } from '../findings-schema.js';
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

/** One cluster of within-tolerance values and its representative. */
export interface Cluster {
  rep: number;
  values: number[];
}

/**
 * Single-linkage clustering (spec D6 stage 1): exact duplicates collapse, the
 * list sorts ascending, and a new cluster starts whenever the next value
 * exceeds the previous one by MORE than the tolerance. The representative is
 * the arithmetic mean — named explicitly because "median" is ambiguous for an
 * even-sized cluster, and at a 1px tolerance that ambiguity flips match
 * outcomes.
 */
export function clusterValues(values: readonly number[], tolerance: number): Cluster[] {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const out: Cluster[] = [];
  let current: number[] = [];
  for (const v of sorted) {
    if (current.length > 0 && v - current[current.length - 1] > tolerance) {
      out.push({ rep: mean(current), values: current });
      current = [];
    }
    current.push(v);
  }
  if (current.length > 0) out.push({ rep: mean(current), values: current });
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
 * Optimal matching (spec D6 stage 2). Both sides are sorted one-dimensional
 * sequences, so the optimum is order-preserving and an edit-distance-shaped DP
 * finds it: maximize the number of within-tolerance pairs, and among the
 * maximizing matchings minimize the total absolute difference.
 *
 * Closest-pair greedy is NOT sufficient and the difference is not academic: at
 * tolerance 2, design {0,3} against implementation {2,5} has the full matching
 * 0->2, 3->5, but greedy takes 3->2 first and reports two unmatched clusters —
 * inventing drift out of the algorithm.
 *
 * noldor:cut O(n*m) time and memory, fine for the hundreds of clusters a real
 * surface produces — a full assignment solver would be needed only if families
 * ever compared unordered multi-dimensional keys.
 */
export function matchClusters(
  design: readonly Cluster[],
  impl: readonly Cluster[],
  tolerance: number,
): ClusterMatch {
  const n = design.length;
  const m = impl.length;
  // best[i][j] = optimum over design[i..n) x impl[j..m); walked backwards so the
  // forward reconstruction below prefers the lowest representatives on a tie.
  const best: { pairs: number; cost: number }[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => ({ pairs: 0, cost: 0 })),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      let pick = best[i + 1][j];
      const skipImpl = best[i][j + 1];
      if (better(skipImpl, pick)) pick = skipImpl;
      const diff = Math.abs(design[i].rep - impl[j].rep);
      if (diff <= tolerance) {
        const withPair = {
          pairs: best[i + 1][j + 1].pairs + 1,
          cost: best[i + 1][j + 1].cost + diff,
        };
        if (better(withPair, pick)) pick = withPair;
      }
      best[i][j] = pick;
    }
  }
  const pairs: [number, number][] = [];
  const designOnly: number[] = [];
  const implOnly: number[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const diff = Math.abs(design[i].rep - impl[j].rep);
    const matched =
      diff <= tolerance &&
      best[i][j].pairs === best[i + 1][j + 1].pairs + 1 &&
      best[i][j].cost === best[i + 1][j + 1].cost + diff;
    if (matched) {
      pairs.push([design[i].rep, impl[j].rep]);
      i++;
      j++;
      continue;
    }
    // Drop whichever side the optimum drops; on a tie drop the lower
    // representative first, which keeps the walk deterministic.
    if (best[i + 1][j].pairs > best[i][j + 1].pairs) {
      designOnly.push(design[i].rep);
      i++;
    } else if (best[i + 1][j].pairs < best[i][j + 1].pairs) {
      implOnly.push(impl[j].rep);
      j++;
    } else if (design[i].rep <= impl[j].rep) {
      designOnly.push(design[i].rep);
      i++;
    } else {
      implOnly.push(impl[j].rep);
      j++;
    }
  }
  for (; i < n; i++) designOnly.push(design[i].rep);
  for (; j < m; j++) implOnly.push(impl[j].rep);
  return { pairs, designOnly, implOnly };
}

/** More pairs wins; equal pairs, lower total difference wins. */
const better = (a: { pairs: number; cost: number }, b: { pairs: number; cost: number }): boolean =>
  a.pairs > b.pairs || (a.pairs === b.pairs && a.cost < b.cost);

/** One family's comparison result. `implOnly` is always empty for `spacing`. */
export interface FamilyOutcome {
  family: GeometryFamily;
  unmatched: number;
  budget: number;
  designOnly: number[];
  implOnly: number[];
  severity: Severity;
}

export interface GeometryComparison {
  verdict: 'pass' | 'fail';
  families: FamilyRecord<FamilyOutcome>;
}

/** Ratio-free, count-derived severity (spec D6): `2x budget` degenerates at budget 0. */
export const severityForUnmatched = (unmatched: number): Severity =>
  unmatched >= 3 ? 'high' : 'med';

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
    return {
      family,
      unmatched,
      budget: budget[family],
      designOnly,
      implOnly,
      severity: severityForUnmatched(unmatched),
    };
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
