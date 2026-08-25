# Geometry Compare Lane — Part 2: The Comparison Engine Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Ship the comparison engine as a runnable capability: `pnpm noldor design geometry-diff <design.json> <impl.json>` compares two conformant geometry documents and reports per-family unmatched values. No pen, no browser, no CR round required.
**Architecture:** One pure module (`geometry-compare-core.ts`: families, clustering, optimal matching, verdict) over part 1's document contract, plus a thin CLI entrypoint. Part 3 wires the lane that feeds it from pencil MCP and a booted app.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod 3, vitest.

**Depends on:** part 1 (`src/cr/geometry/geometry-doc.ts` and its boundary parse must exist).

---

## File Structure

- `src/cr/geometry/geometry-compare-core.ts` — family extraction, clustering, optimal matching, per-family outcomes and severity. Pure: no IO, no process state.
- `src/cr/geometry/geometry-diff-cli.ts` — `noldor design geometry-diff`: read two documents, print per-family rows, exit 0 clean / 1 drift / 2 usage-or-parse.
- `src/cli/manifest.ts` — one `design.subs['geometry-diff']` row (Modify).
- `docs/noldor/script-catalog.md` + `templates/docs/noldor/script-catalog.md` — the catalog entry, twinned (Modify).
- `src/cr/__tests__/geometry/geometry-compare-core.test.ts` — extraction, clustering, matching, verdict tests.
- `src/cr/__tests__/geometry/geometry-diff-cli.test.ts` — CLI exit-code + output tests.

---

## Task 1: Family extraction

**Files:**
- Create: `src/cr/geometry/geometry-compare-core.ts`
- Test: `src/cr/__tests__/geometry/geometry-compare-core.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/geometry/geometry-compare-core.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { extractFamilies } from '../../geometry/geometry-compare-core.js';
import type { GeometryDoc } from '../../geometry/geometry-doc.js';

const doc = (nodes: GeometryDoc['nodes']): GeometryDoc => ({
  surface: 'dashboard',
  viewport: { width: 1440, height: 900 },
  nodes,
});

describe('extractFamilies', () => {
  it('collects edges per axis from every node box', () => {
    const f = extractFamilies(
      doc([
        { kind: 'shape', box: { x: 24, y: 10, w: 100, h: 40 } },
        { kind: 'shape', box: { x: 24, y: 60, w: 100, h: 40 } },
      ]),
    );
    expect(f.edgesX.sort((a, b) => a - b)).toEqual([24, 24, 124, 124]);
    expect(f.edgesY.sort((a, b) => a - b)).toEqual([10, 50, 60, 100]);
  });

  it('collects fontSize from text nodes only', () => {
    const f = extractFamilies(
      doc([
        { kind: 'text', box: { x: 0, y: 0, w: 10, h: 10 }, fontSize: 14, text: 'a' },
        { kind: 'container', box: { x: 0, y: 0, w: 10, h: 10 } },
      ]),
    );
    expect(f.fontSize).toEqual([14]);
  });

  it('excludes zero spacing values but keeps non-zero sides and negative margins', () => {
    const f = extractFamilies(
      doc([
        {
          kind: 'container',
          box: { x: 0, y: 0, w: 10, h: 10 },
          spacing: { rowGap: 0, columnGap: 16, padding: [8, 0, 8, 0], margin: [0, -4, 0, -4] },
        },
      ]),
    );
    expect(f.spacing.sort((a, b) => a - b)).toEqual([-4, -4, 8, 8, 16]);
  });

  it('is empty for a document with no nodes', () => {
    const f = extractFamilies(doc([]));
    expect(f).toEqual({ edgesX: [], edgesY: [], fontSize: [], spacing: [] });
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-compare-core.test.ts
```

Expected output: collection error — `Failed to resolve import "../../geometry/geometry-compare-core.js"`.

- [ ] **Step 3: Implement extraction.** Create `src/cr/geometry/geometry-compare-core.ts`:

```ts
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

/**
 * Raw values per family. `edges` splits by axis because a 24px left edge and a
 * 24px top edge are unrelated quantities that must not match each other; the
 * two axes still share one tolerance and one budget (spec D5).
 */
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
    if (n.kind === 'text' && n.fontSize !== undefined) out.fontSize.push(n.fontSize);
    spacing(n.spacing?.rowGap);
    spacing(n.spacing?.columnGap);
    for (const side of n.spacing?.padding ?? []) spacing(side);
    for (const side of n.spacing?.margin ?? []) spacing(side);
  }
  return out;
}
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-compare-core.test.ts
```

Expected output: `Test Files 1 passed`, `Tests 4 passed`.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/geo-t2.msg <<'MSG'
feat(cr): extract the three geometry families from a document

Why — the lane compares populations of layout values, not elements, so the
first step is turning a node list into exactly three value families. Two of the
rules that make those families usable are noise rules rather than modeling
rules: a zero spacing value must never enter the population, because
getComputedStyle reports 0px on nearly every element and would otherwise give
every implementation a value no design has, and font size must come only from
text-bearing nodes so an inherited wrapper size cannot.

How — one pass over the nodes collecting x and x+w into the x-edge population,
y and y+h into the y-edge population, fontSize from text nodes, and every
non-zero gap, padding side and margin side into the spacing population. The
axes split because a left edge and a top edge are unrelated quantities that
must not match each other; they still share one tolerance and one budget.

What — src/cr/geometry/geometry-compare-core.ts with GEOMETRY_FAMILIES, the
default tolerance and budget records, and extractFamilies, plus tests covering
axis separation, text-only font sizes, zero exclusion with negative margins
kept, and the empty document.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/geometry/geometry-compare-core.ts src/cr/__tests__/geometry/geometry-compare-core.test.ts
git commit -F /tmp/geo-t2.msg
```

---

## Task 2: Clustering

**Files:**
- Modify: `src/cr/geometry/geometry-compare-core.ts`
- Test: `src/cr/__tests__/geometry/geometry-compare-core.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/geometry/geometry-compare-core.test.ts`:

```ts
import { clusterValues } from '../../geometry/geometry-compare-core.js';

describe('clusterValues', () => {
  it('collapses exact duplicates and clusters within tolerance', () => {
    expect(clusterValues([24, 24, 25, 40], 2)).toEqual([
      { rep: 24.5, values: [24, 25] },
      { rep: 40, values: [40] },
    ]);
  });

  it('starts a new cluster only past the tolerance', () => {
    expect(clusterValues([10, 12, 14.1], 2).map((c) => c.values)).toEqual([[10, 12], [14.1]]);
  });

  it('uses the arithmetic mean as the representative for an even-sized cluster', () => {
    expect(clusterValues([10, 11], 2)[0].rep).toBe(10.5);
  });

  it('sorts negatives correctly and handles the empty list', () => {
    expect(clusterValues([-4, 8, -4], 1).map((c) => c.rep)).toEqual([-4, 8]);
    expect(clusterValues([], 2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-compare-core.test.ts -t clusterValues
```

Expected output: `Failed to resolve import` on `clusterValues`, or `clusterValues is not a function`.

- [ ] **Step 3: Implement clustering.** Append to `src/cr/geometry/geometry-compare-core.ts`:

```ts
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
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-compare-core.test.ts
```

Expected output: `Test Files 1 passed`, `Tests 8 passed`.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/geo-t3.msg <<'MSG'
feat(cr): cluster geometry values by single linkage

Why — comparing raw values would report drift for a 0.1px difference, and
comparing bucket indices off a fixed grid is worse: at a 2px tolerance a design
edge at 23.9 and an implementation edge at 24.1 fall in adjacent buckets and
read as two unmatched values, while 24.0 and 25.9 land together. Sub-pixel
values are the norm on the implementation side, so that artifact would fire on
every real surface.

How — deduplicate, sort ascending, and start a new cluster only when the next
value exceeds the previous one by more than the tolerance. The representative
is the arithmetic mean, pinned by name because a median is ambiguous for an
even-sized cluster and that ambiguity changes match outcomes at a one-pixel
tolerance.

What — clusterValues plus the Cluster type in geometry-compare-core.ts, with
tests covering duplicate collapse, the strict tolerance boundary, the even-size
representative, negatives, and the empty list.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/geometry/geometry-compare-core.ts src/cr/__tests__/geometry/geometry-compare-core.test.ts
git commit -F /tmp/geo-t3.msg
```

---

## Task 3: Optimal matching

**Files:**
- Modify: `src/cr/geometry/geometry-compare-core.ts`
- Test: `src/cr/__tests__/geometry/geometry-compare-core.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/geometry/geometry-compare-core.test.ts`:

```ts
import { matchClusters } from '../../geometry/geometry-compare-core.js';

const cl = (reps: number[]): { rep: number; values: number[] }[] =>
  reps.map((rep) => ({ rep, values: [rep] }));

describe('matchClusters', () => {
  it('finds the full matching greedy would miss', () => {
    // Closest-pair greedy takes 3->2 first and leaves 0 and 5 unmatched.
    const m = matchClusters(cl([0, 3]), cl([2, 5]), 2);
    expect(m.designOnly).toEqual([]);
    expect(m.implOnly).toEqual([]);
    expect(m.pairs).toEqual([
      [0, 2],
      [3, 5],
    ]);
  });

  it('leaves out-of-tolerance clusters unmatched on both sides', () => {
    const m = matchClusters(cl([24]), cl([24, 26.5]), 2);
    expect(m.designOnly).toEqual([]);
    expect(m.implOnly).toEqual([26.5]);
  });

  it('reports a design-only cluster when the implementation renders nothing near it', () => {
    const m = matchClusters(cl([14, 32]), cl([14]), 1);
    expect(m.designOnly).toEqual([32]);
    expect(m.implOnly).toEqual([]);
  });

  it('minimizes total difference among maximizing matchings', () => {
    const m = matchClusters(cl([10, 11]), cl([10, 11]), 2);
    expect(m.pairs).toEqual([
      [10, 10],
      [11, 11],
    ]);
  });

  it('handles either side being empty', () => {
    expect(matchClusters(cl([1]), [], 2).designOnly).toEqual([1]);
    expect(matchClusters([], cl([1]), 2).implOnly).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-compare-core.test.ts -t matchClusters
```

Expected output: `matchClusters is not a function`.

- [ ] **Step 3: Implement matching.** Append to `src/cr/geometry/geometry-compare-core.ts`:

```ts
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
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-compare-core.test.ts
```

Expected output: `Test Files 1 passed`, `Tests 13 passed`.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/geo-t4.msg <<'MSG'
feat(cr): match geometry clusters optimally rather than greedily

Why — the unmatched set IS the verdict, so a matching algorithm that leaves
matchable clusters unpaired invents drift. Closest-pair greedy does exactly
that: at a tolerance of 2, design clusters {0,3} against implementation
clusters {2,5} have a full matching, but greedy pairs 3 with 2 first and then
reports both 0 and 5 as unmatched — a fail on a surface with no drift at all.

How — both sides are sorted one-dimensional sequences, so the optimum is
order-preserving and an edit-distance-shaped dynamic program finds it in
quadratic time: maximize the number of within-tolerance pairs, then minimize the
total absolute difference among the maximizing matchings. The reconstruction
walks forward and drops the lower representative on a tie, so two runs over the
same clusters report identical unmatched sets.

What — matchClusters and the ClusterMatch type in geometry-compare-core.ts,
with tests pinning the case greedy fails, out-of-tolerance leftovers on both
sides, design-only reporting, cost minimization among equal-cardinality
matchings, and either side empty.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/geometry/geometry-compare-core.ts src/cr/__tests__/geometry/geometry-compare-core.test.ts
git commit -F /tmp/geo-t4.msg
```

---

## Task 4: The per-surface verdict

**Files:**
- Modify: `src/cr/geometry/geometry-compare-core.ts`
- Test: `src/cr/__tests__/geometry/geometry-compare-core.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/geometry/geometry-compare-core.test.ts`:

```ts
import { compareGeometry, DEFAULT_BUDGET, DEFAULT_TOLERANCE } from '../../geometry/geometry-compare-core.js';

const card = (x: number): GeometryDoc['nodes'][number] => ({
  kind: 'shape',
  box: { x, y: 0, w: 100, h: 40 },
});

describe('compareGeometry', () => {
  it('passes two documents differing in nothing measurable', () => {
    const d = doc([card(24), card(24)]);
    const r = compareGeometry(d, d, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(r.verdict).toBe('pass');
    expect(r.families.edges.unmatched).toBe(0);
  });

  it('fails the edges family when one card sits past the tolerance', () => {
    const design = doc([card(24), card(24), card(24)]);
    const impl = doc([card(24), card(24), card(30)]);
    const r = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(r.verdict).toBe('fail');
    expect(r.families.edges.implOnly).toContain(30);
    expect(r.families.edges.severity).toBe('med');
  });

  it('counts spacing one-directionally: an impl margin satisfies a design gap', () => {
    const design = doc([
      { kind: 'container', box: { x: 0, y: 0, w: 10, h: 10 }, spacing: { rowGap: 16 } },
    ]);
    const impl = doc([
      {
        kind: 'container',
        box: { x: 0, y: 0, w: 10, h: 10 },
        spacing: { margin: [16, 0, 21.44, 0], padding: [40, 0, 0, 0] },
      },
    ]);
    const r = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(r.families.spacing.unmatched).toBe(0);
    expect(r.families.spacing.implOnly).toEqual([]);
  });

  it('fails spacing when a declared design value is honored nowhere', () => {
    const design = doc([
      { kind: 'container', box: { x: 0, y: 0, w: 10, h: 10 }, spacing: { rowGap: 16 } },
    ]);
    const impl = doc([{ kind: 'container', box: { x: 0, y: 0, w: 10, h: 10 } }]);
    const r = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(r.families.spacing.designOnly).toEqual([16]);
    expect(r.verdict).toBe('fail');
  });

  it('honors a per-family budget and escalates severity past three unmatched', () => {
    const design = doc([card(24)]);
    const impl = doc([card(24), card(40), card(60)]);
    const lenient = compareGeometry(design, impl, DEFAULT_TOLERANCE, {
      ...DEFAULT_BUDGET,
      edges: 4,
    });
    expect(lenient.verdict).toBe('pass');
    const strict = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(strict.families.edges.severity).toBe('high');
  });

  it('adds no unmatched value for a wrapper that shares its child box', () => {
    const design = doc([card(24)]);
    // A DOM wrapper stack reuses its child's edges — the population is a value
    // set, so the duplicate collapses instead of reading as drift.
    const impl = doc([card(24), card(24), card(24)]);
    const r = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(r.verdict).toBe('pass');
    expect(r.families.edges.unmatched).toBe(0);
  });

  it('compares every family even when one side has none of it', () => {
    const design = doc([card(24)]);
    const impl = doc([
      card(24),
      { kind: 'text', box: { x: 24, y: 0, w: 10, h: 10 }, fontSize: 13, text: 'x' },
    ]);
    const r = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(r.families.fontSize.implOnly).toEqual([13]);
    expect(r.verdict).toBe('fail');
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-compare-core.test.ts -t compareGeometry
```

Expected output: `compareGeometry is not a function`.

- [ ] **Step 3: Implement the verdict.** Append to `src/cr/geometry/geometry-compare-core.ts`:

```ts
import type { Severity } from '../findings-schema.js';

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
  /** Families over budget, in `GEOMETRY_FAMILIES` order — one finding each. */
  failed: FamilyOutcome[];
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
  const match = (
    dv: readonly number[],
    iv: readonly number[],
    tol: number,
  ): ClusterMatch => matchClusters(clusterValues(dv, tol), clusterValues(iv, tol), tol);

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
  const failed = GEOMETRY_FAMILIES.map((f) => families[f]).filter(
    (o) => o.unmatched > o.budget,
  );
  return { verdict: failed.length > 0 ? 'fail' : 'pass', families, failed };
}
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-compare-core.test.ts && pnpm typecheck
```

Expected output: `Test Files 1 passed`, `Tests 20 passed`, then typecheck with no errors.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/geo-t5.msg <<'MSG'
feat(cr): derive the per-surface geometry verdict from unmatched values

Why — the families and the matcher only produce leftovers; something has to
turn leftovers into a verdict, and the two directions do not mean the same
thing per family. An implementation-only edge is the primary signal the lane
exists for, but an implementation-only spacing value is usually a UA-stylesheet
margin on an h1 or a negative gutter, neither of which pen can declare at all.
Counting those would fail real UI on its first run, and the only escape would
be a budget large enough to hide genuine drift.

How — edges and font size count unmatched clusters in both directions; spacing
counts design-only leftovers alone, so an implementation margin can satisfy a
design gap while UA defaults cannot fail anything. A family fails when its
unmatched count exceeds its own budget, all of which default to zero now that
the noise is removed at the source, and severity comes from the count itself
because a multiple of the budget degenerates to always-high at zero. Every
family is always compared — there is no skip path to hide an implementation
that added type the design never specified.

What — compareGeometry, severityForUnmatched, and the FamilyOutcome and
GeometryComparison types, with tests covering the aligned pass, one card past
tolerance, an impl margin satisfying a design gap, a design gap honored
nowhere, budget and severity behavior, and a family present on one side only.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/geometry/geometry-compare-core.ts src/cr/__tests__/geometry/geometry-compare-core.test.ts
git commit -F /tmp/geo-t5.msg
```

---

## Task 5: `noldor design geometry-diff`

**Files:**
- Create: `src/cr/geometry/geometry-diff-cli.ts`
- Modify: `src/cli/manifest.ts`, `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`
- Test: `src/cr/__tests__/geometry/geometry-diff-cli.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/geometry/geometry-diff-cli.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runGeometryDiff } from '../../geometry/geometry-diff-cli.js';

const write = async (dir: string, name: string, body: unknown): Promise<string> => {
  const p = join(dir, name);
  await writeFile(p, JSON.stringify(body), 'utf8');
  return p;
};

const doc = (nodes: unknown[]): unknown => ({
  surface: 'dashboard',
  viewport: { width: 1440, height: 900 },
  nodes,
});
const card = (x: number): unknown => ({ kind: 'shape', box: { x, y: 0, w: 100, h: 40 } });

describe('runGeometryDiff', () => {
  it('exits 0 and reports every family clean on identical documents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'geo-diff-'));
    const a = await write(dir, 'design.json', doc([card(24)]));
    const b = await write(dir, 'impl.json', doc([card(24)]));
    const out: string[] = [];
    const code = await runGeometryDiff([a, b, '--surface', 'dashboard'], (s) => out.push(s));
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('edges: 0 unmatched');
  });

  it('exits 1 and names the unmatched value on drift', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'geo-diff-'));
    const a = await write(dir, 'design.json', doc([card(24)]));
    const b = await write(dir, 'impl.json', doc([card(24), card(30)]));
    const out: string[] = [];
    const code = await runGeometryDiff([a, b, '--surface', 'dashboard'], (s) => out.push(s));
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('impl-only');
  });

  it('exits 2 on an unparseable document and on a missing argument', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'geo-diff-'));
    const a = await write(dir, 'design.json', doc([{ kind: 'text', box: { x: 0, y: 0, w: 1, h: 1 } }]));
    const b = await write(dir, 'impl.json', doc([card(24)]));
    const out: string[] = [];
    expect(await runGeometryDiff([a, b, '--surface', 'dashboard'], (s) => out.push(s))).toBe(2);
    expect(await runGeometryDiff([a], (s) => out.push(s))).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-diff-cli.test.ts
```

Expected output: collection error — `Failed to resolve import "../../geometry/geometry-diff-cli.js"`.

- [ ] **Step 3: Implement the CLI.** Create `src/cr/geometry/geometry-diff-cli.ts`:

```ts
// @tests: ui-design-review-lane
// noldor design geometry-diff — compare two normalized geometry documents by
// hand. The `geometry-compare` lane produces these documents from pencil MCP
// and a booted app; this entrypoint exists so a consumer can validate a capture
// script's output, and an operator can re-read a failing round's evidence,
// without booting anything.

import { readFile } from 'node:fs/promises';

import { runIfDirect } from '../../core/cli-entry.js';
import { errMessage } from '../../core/err-message.js';
import {
  compareGeometry,
  DEFAULT_BUDGET,
  DEFAULT_TOLERANCE,
  GEOMETRY_FAMILIES,
} from './geometry-compare-core.js';
import { parseGeometryDoc } from './geometry-doc.js';

const USAGE =
  'usage: noldor design geometry-diff <design.json> <impl.json> [--surface <name>]';

const list = (xs: readonly number[]): string => xs.map((v) => v.toFixed(2)).join(', ');

/**
 * Exit 0 = every family within budget, 1 = drift, 2 = usage error or either
 * document failing the boundary parse. Writes through the injected `emit` so
 * the tests read output instead of capturing a stream.
 */
export async function runGeometryDiff(
  argv: readonly string[],
  emit: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
): Promise<number> {
  const positional = argv.filter((a) => !a.startsWith('--'));
  if (positional.length < 2) {
    emit(USAGE);
    return 2;
  }
  const si = argv.indexOf('--surface');
  const surface = si >= 0 ? argv[si + 1] : undefined;
  if (si >= 0 && (surface === undefined || surface.startsWith('--'))) {
    emit(USAGE);
    return 2;
  }
  let rawDesign: unknown;
  let rawImpl: unknown;
  try {
    rawDesign = JSON.parse(await readFile(positional[0], 'utf8'));
    rawImpl = JSON.parse(await readFile(positional[1], 'utf8'));
  } catch (err) {
    emit(`geometry-diff: could not read both documents: ${errMessage(err)}`);
    return 2;
  }
  // The surface defaults to whatever the design document claims: this is a
  // by-hand tool, and requiring the flag would just make the common case noisy.
  const expected =
    surface ??
    (typeof (rawDesign as { surface?: unknown }).surface === 'string'
      ? ((rawDesign as { surface: string }).surface)
      : '');
  const design = parseGeometryDoc(rawDesign, 'design', expected);
  const impl = parseGeometryDoc(rawImpl, 'impl', expected);
  if (!design.ok || !impl.ok) {
    if (!design.ok) emit(`geometry-diff: ${design.detail}`);
    if (!impl.ok) emit(`geometry-diff: ${impl.detail}`);
    return 2;
  }
  const cmp = compareGeometry(design.doc, impl.doc, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
  emit(`surface '${expected}' — ${cmp.verdict}`);
  for (const family of GEOMETRY_FAMILIES) {
    const o = cmp.families[family];
    emit(
      `  ${family}: ${o.unmatched} unmatched (budget ${o.budget})` +
        (o.designOnly.length > 0 ? ` design-only [${list(o.designOnly)}]` : '') +
        (o.implOnly.length > 0 ? ` impl-only [${list(o.implOnly)}]` : ''),
    );
  }
  return cmp.verdict === 'fail' ? 1 : 0;
}

await runIfDirect(import.meta.url, async () => {
  process.exitCode = await runGeometryDiff(process.argv.slice(2));
});
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-diff-cli.test.ts
```

Expected output: `Test Files 1 passed`, `Tests 3 passed`.

- [ ] **Step 5: Register the subcommand.** In `src/cli/manifest.ts`, inside the `design` group's `subs`, add after the `log` entry:

```ts
      'geometry-diff': {
        src: 'cr/geometry/geometry-diff-cli.ts',
        desc: 'Compare two normalized geometry documents (design vs implementation) by hand',
      },
```

- [ ] **Step 6: Verify the command routes.**

```bash
node bin/noldor.mjs design geometry-diff
```

Expected output: `usage: noldor design geometry-diff <design.json> <impl.json> [--surface <name>]` and exit code 2.

- [ ] **Step 7: Add the catalog entry, twinned.** Append to `docs/noldor/script-catalog.md` immediately after the `design:pen-bridge` section, then copy the identical block into `templates/docs/noldor/script-catalog.md` at the same position:

```markdown
### `design:geometry-diff`

- **Trigger:** `pnpm noldor design geometry-diff <design.json> <impl.json> [--surface <name>]`. Run by hand while writing or debugging a `geometryCommand` capture script, or over a failing `geometry-compare` round's evidence files.
- **Inputs:** two normalized geometry documents (`geometryDocSchema`). `--surface` names the surface both documents must report; it defaults to whatever the design document claims.
- **Outputs:** one line per family — unmatched count, budget, and the design-only and implementation-only representatives. Exit 0 = every family within budget, 1 = drift, 2 = usage error or either document failing the boundary parse.
- **When to use:** validating that a capture script produces a conformant document, and reading a round's evidence without booting the app.
- **Source:** [`src/cr/geometry/geometry-diff-cli.ts`](../../src/cr/geometry/geometry-diff-cli.ts)
```

- [ ] **Step 8: Verify the catalog gate and the template twin.**

```bash
pnpm noldor validate script-catalog && pnpm noldor checks template-sync
```

Expected output: both exit 0 — the catalog lists every manifest row, and no templated file differs from its `templates/` copy.

- [ ] **Step 9: Full verification.**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run src/cr/__tests__/geometry
```

Expected output: typecheck clean, lint clean, `Test Files 2 passed`, `Tests 23 passed`.

- [ ] **Step 10: Commit.**

```bash
cat > /tmp/geo-t6.msg <<'MSG'
feat(cli): add design geometry-diff to compare two geometry documents

Why — the comparison engine is only trustworthy if a consumer can see what it
says about their own capture output, and the lane that will feed it needs pencil
MCP plus a booted app to run at all. Without a hand-runnable surface, writing a
geometryCommand script would mean debugging it through a full CR round, and
reading a failing round's evidence would mean re-running one.

How — a thin entrypoint that reads both documents, runs them through the same
boundary parse the lane uses, compares them with the default tolerances and
budgets, and prints one line per family with the unmatched count and the
offending representatives. Exit 0 within budget, 1 on drift, 2 on a usage error
or a document that fails the parse — so it is usable from a script as well as
by eye.

What — src/cr/geometry/geometry-diff-cli.ts, its manifest row under the design
group, the twinned script-catalog entry, and tests covering the clean, drifting,
unparseable, and missing-argument paths.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/geometry/geometry-diff-cli.ts src/cr/__tests__/geometry/geometry-diff-cli.test.ts src/cli/manifest.ts docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md
git commit -F /tmp/geo-t6.msg
```
