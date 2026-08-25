// @tests: ui-design-review-lane
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
