// @tests: ui-design-review-lane
import { describe, expect, it } from 'vitest';

import { parseGeometryDoc } from '../../geometry/geometry-doc.js';

const doc = (over: Record<string, unknown> = {}): unknown => ({
  surface: 'dashboard',
  viewport: { width: 1440, height: 900 },
  nodes: [{ kind: 'text', box: { x: 0, y: 0, w: 100, h: 20 }, fontSize: 14, text: 'Hi' }],
  ...over,
});

describe('parseGeometryDoc', () => {
  it('accepts a well-formed design document', () => {
    const r = parseGeometryDoc(doc(), 'design', 'dashboard');
    expect(r.ok).toBe(true);
    // Narrow on the discriminant before reading fontSize — the union is what
    // makes the un-narrowed read a type error.
    if (r.ok && r.doc.nodes[0].kind === 'text') expect(r.doc.nodes[0].fontSize).toBe(14);
  });

  it('rejects a surface that is not the one under review', () => {
    const r = parseGeometryDoc(doc(), 'design', 'settings');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain("reports surface 'dashboard'");
  });

  it('rejects a text node without fontSize', () => {
    const r = parseGeometryDoc(
      doc({ nodes: [{ kind: 'text', box: { x: 0, y: 0, w: 1, h: 1 } }] }),
      'impl',
      'dashboard',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('fontSize');
  });

  it('rejects fontSize on a non-text node', () => {
    const r = parseGeometryDoc(
      doc({ nodes: [{ kind: 'container', box: { x: 0, y: 0, w: 1, h: 1 }, fontSize: 14 }] }),
      'impl',
      'dashboard',
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a non-positive fontSize', () => {
    const r = parseGeometryDoc(
      doc({ nodes: [{ kind: 'text', box: { x: 0, y: 0, w: 1, h: 1 }, fontSize: 0 }] }),
      'impl',
      'dashboard',
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a non-finite coordinate and a negative dimension', () => {
    expect(
      parseGeometryDoc(
        doc({ nodes: [{ kind: 'shape', box: { x: Number.NaN, y: 0, w: 1, h: 1 } }] }),
        'impl',
        'dashboard',
      ).ok,
    ).toBe(false);
    expect(
      parseGeometryDoc(
        doc({ nodes: [{ kind: 'shape', box: { x: 0, y: 0, w: -1, h: 1 } }] }),
        'impl',
        'dashboard',
      ).ok,
    ).toBe(false);
  });

  it('rejects margin on the design side but accepts it on the implementation side', () => {
    const withMargin = doc({
      nodes: [
        {
          kind: 'container',
          box: { x: 0, y: 0, w: 10, h: 10 },
          spacing: { margin: [8, 0, 8, 0] },
        },
      ],
    });
    expect(parseGeometryDoc(withMargin, 'design', 'dashboard').ok).toBe(false);
    expect(parseGeometryDoc(withMargin, 'impl', 'dashboard').ok).toBe(true);
  });

  it('rejects a zero viewport and an unknown field', () => {
    expect(
      parseGeometryDoc(doc({ viewport: { width: 0, height: 900 } }), 'impl', 'dashboard').ok,
    ).toBe(false);
    expect(parseGeometryDoc(doc({ extra: 1 }), 'impl', 'dashboard').ok).toBe(false);
  });
});
