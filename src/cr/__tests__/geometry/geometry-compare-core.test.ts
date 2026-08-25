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
