// @tests: ui-design-review-lane
import { describe, expect, it } from 'vitest';

import {
  compareGeometry,
  DEFAULT_BUDGET,
  DEFAULT_TOLERANCE,
} from '../../geometry/geometry-compare-core.js';
import type { GeometryDoc } from '../../geometry/geometry-doc.js';
import { buildSurfaceReport, familySeverity, nodeLabel } from '../../geometry/geometry-report.js';

const design: GeometryDoc = {
  surface: 'dashboard',
  viewport: { width: 1440, height: 900 },
  nodes: [
    {
      kind: 'container',
      name: 'Card',
      box: { x: 24, y: 0, w: 100, h: 40 },
      spacing: { padding: [16, 16, 16, 16] },
    },
    { kind: 'text', box: { x: 40, y: 8, w: 60, h: 20 }, fontSize: 14, text: 'Revenue' },
  ],
};
const impl: GeometryDoc = {
  surface: 'dashboard',
  viewport: { width: 1440, height: 900 },
  nodes: [
    { kind: 'container', name: 'Card', box: { x: 30, y: 0, w: 100, h: 40 } },
    { kind: 'container', name: 'Wrapper', box: { x: 30, y: 0, w: 100, h: 40 } },
    { kind: 'text', box: { x: 40, y: 8, w: 60, h: 20 }, fontSize: 14, text: 'Revenue' },
  ],
};

describe('buildSurfaceReport', () => {
  const cmp = compareGeometry(design, impl, DEFAULT_TOLERANCE, DEFAULT_BUDGET);
  const report = buildSurfaceReport('dashboard', design, impl, cmp);

  it('names every node that produced an unmatched value, on its own side', () => {
    const at30 = report.unmatched.find((u) => u.family === 'edgesX' && u.value === 30);
    expect(at30?.side).toBe('impl');
    expect(at30?.nodes.map((n) => n.name)).toEqual(['Card', 'Wrapper']);
    const at24 = report.unmatched.find((u) => u.family === 'edgesX' && u.value === 24);
    expect(at24?.side).toBe('design');
    expect(at24?.nodes).toEqual([
      { name: 'Card', kind: 'container', box: { x: 24, y: 0, w: 100, h: 40 } },
    ]);
  });

  it('maps a spacing value back to the frame that declared it', () => {
    const spacing = report.unmatched.filter((u) => u.family === 'spacing');
    expect(spacing).toHaveLength(1);
    expect(spacing[0]).toMatchObject({ side: 'design', value: 16 });
    expect(spacing[0].nodes.map((n) => n.name)).toEqual(['Card']);
  });

  it('carries every value per side and the per-family outcome', () => {
    expect(report.values.design.fontSize).toEqual([14]);
    expect(report.values.impl.edgesX).toEqual([30, 130, 30, 130, 40, 100]);
    expect(report.families.edgesX.unmatched).toBe(4);
    expect(report.verdict).toBe('fail');
  });
});

describe('familySeverity / nodeLabel', () => {
  it('is med for 1–2 unmatched values and high for 3 or more', () => {
    expect([1, 2, 3, 7].map(familySeverity)).toEqual(['med', 'med', 'high', 'high']);
  });

  it('labels a node by name, else by its text, else by its kind', () => {
    const box = { x: 0, y: 0, w: 1, h: 1 };
    expect(nodeLabel({ name: 'Card', kind: 'container', box })).toBe('Card');
    expect(nodeLabel({ kind: 'text', box, text: 'Revenue' })).toBe('"Revenue"');
    expect(nodeLabel({ kind: 'text', box, text: 'x'.repeat(30) })).toBe(`"${'x'.repeat(24)}…"`);
    expect(nodeLabel({ kind: 'shape', box })).toBe('shape');
  });
});
