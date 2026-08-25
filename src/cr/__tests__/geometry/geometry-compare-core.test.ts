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

import {
  compareGeometry,
  DEFAULT_BUDGET,
  DEFAULT_TOLERANCE,
  unmatchedValues,
} from '../../geometry/geometry-compare-core.js';

const card = (x: number): GeometryDoc['nodes'][number] => ({
  kind: 'shape',
  box: { x, y: 0, w: 100, h: 40 },
});

describe('compareGeometry', () => {
  it('passes two documents differing in nothing measurable', () => {
    const d = doc([card(24), card(24)]);
    const r = compareGeometry(d, d, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(r.verdict).toBe('pass');
    expect(r.families.edgesX.unmatched).toBe(0);
  });

  it('fails the edges family when one card sits past the tolerance', () => {
    const design = doc([card(24), card(24), card(24)]);
    const impl = doc([card(24), card(24), card(30)]);
    const r = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(r.verdict).toBe('fail');
    expect(r.families.edgesX.implOnly).toContain(30);
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
      edgesX: 4,
    });
    expect(lenient.verdict).toBe('pass');
    const strict = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(strict.verdict).toBe('fail');
    expect(strict.families.edgesX.unmatched).toBeGreaterThanOrEqual(3);
  });

  it('adds no unmatched value for a wrapper that shares its child box', () => {
    const design = doc([card(24)]);
    // A DOM wrapper stack reuses its child's edges — the population is a value
    // set, so the duplicate collapses instead of reading as drift.
    const impl = doc([card(24), card(24), card(24)]);
    const r = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(r.verdict).toBe('pass');
    expect(r.families.edgesX.unmatched).toBe(0);
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

describe('unmatchedValues', () => {
  it('reports a value with no counterpart within tolerance', () => {
    expect(unmatchedValues([24, 30], [24], 2)).toEqual([30]);
  });

  it('explains a value by any counterpart within tolerance, including duplicates', () => {
    expect(unmatchedValues([24, 24.4, 25.9], [24], 2)).toEqual([]);
  });

  it('is exact at the boundary: at the tolerance is covered, past it is not', () => {
    expect(unmatchedValues([26], [24], 2)).toEqual([]);
    expect(unmatchedValues([26.5], [24], 2)).toEqual([26.5]);
  });

  it('does not compose tolerances across neighbouring values', () => {
    // A chain 24, 26, 28 does not let 28 borrow 26's proximity to 24.
    expect(unmatchedValues([24, 26, 28], [24], 2)).toEqual([28]);
  });

  it('finds the nearest counterpart on either side of a value', () => {
    expect(unmatchedValues([10], [4, 12], 2)).toEqual([]);
    expect(unmatchedValues([10], [4, 16], 2)).toEqual([10]);
  });

  it('reports everything when the other side is empty, and nothing for an empty side', () => {
    expect(unmatchedValues([1, 2], [], 2)).toEqual([1, 2]);
    expect(unmatchedValues([], [1], 2)).toEqual([]);
  });

  it('handles negatives and collapses exact duplicates', () => {
    expect(unmatchedValues([-4, -4, 8], [-4], 1)).toEqual([8]);
  });
});

describe('drift past the tolerance is never hidden', () => {
  it('fails an edge 2.5px off at the 2px default', () => {
    const design = doc([card(24)]);
    const impl = doc([card(24), card(26.5)]);
    const r = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(r.verdict).toBe('fail');
    expect(r.families.edgesX.implOnly).toContain(26.5);
  });

  it('fails the case an intermediate value would have bridged', () => {
    const design = doc([card(24)]);
    const impl = doc([card(24), card(26), card(28)]);
    const r = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(r.verdict).toBe('fail');
    expect(r.families.edgesX.implOnly).toContain(28);
  });

  it('fails the case two clustered representatives would have matched', () => {
    // design {0,2} vs impl {2.5,3.5}: design 0 is 2.5 from its nearest.
    const design = doc([{ kind: 'shape', box: { x: 0, y: 0, w: 2, h: 0 } }]);
    const impl = doc([{ kind: 'shape', box: { x: 2.5, y: 0, w: 1, h: 0 } }]);
    const r = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
    expect(r.verdict).toBe('fail');
    expect(r.families.edgesX.designOnly).toContain(0);
  });

  it('still passes a sub-pixel difference', () => {
    const design = doc([{ kind: 'shape', box: { x: 24, y: 48, w: 100, h: 40 } }]);
    const impl = doc([{ kind: 'shape', box: { x: 24.4, y: 48.4, w: 100, h: 40 } }]);
    expect(compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET).verdict).toBe('pass');
  });
});
