// @tests: pendev-ui-design-phase
import { describe, expect, it } from 'vitest';

import type { CoverageDeclaration, PenDocument, PenFinding } from '../pen-doc.js';
import { checkLayout } from '../pen-layout.js';

const label = (id: string, y: number, extra: Record<string, unknown> = {}) => ({
  type: 'text',
  id,
  name: `Area — ${id}`,
  content: id,
  fontSize: 200,
  x: 0,
  y,
  ...extra,
});

const frame = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  type: 'frame',
  id,
  name: `FINAL:app: ${id}`,
  x,
  y,
  width: 100,
  height: 100,
  children: [],
  ...extra,
});

const doc = (children: unknown[]): PenDocument => ({ version: '2.19', children });

const codes = (findings: readonly PenFinding[]) => findings.map((f) => f.code);

const messageOf = (findings: readonly PenFinding[], code: PenFinding['code']): string => {
  const found = findings.find((f) => f.code === code);
  if (found === undefined) throw new Error(`no ${code} finding in ${JSON.stringify(findings)}`);
  return found.message;
};

const TWINS: CoverageDeclaration = { states: ['rest', 'chat-open'], modes: ['dark', 'light'] };

/** Two labelled rows, each holding one state's dark page beside its light twin, with path ids inside. */
const conforming = () =>
  doc([
    label('area-scene', 0),
    frame('rest-dark', 0, 240, {
      children: [
        {
          type: 'frame',
          id: 'rest-dark.bar',
          children: [
            { type: 'text', id: 'rest-dark.bar.icon-plus' },
            { type: 'text', id: 'rest-dark.bar.icon-plus-2' },
          ],
        },
      ],
    }),
    frame('rest-light', 140, 240),
    label('area-chat', 600),
    frame('chat-open-dark', 0, 840),
    frame('chat-open-light', 140, 840),
  ]);

describe('checkLayout — a conforming document', () => {
  it('reports nothing, with or without declared modes', () => {
    expect(checkLayout(conforming(), { coverage: TWINS })).toEqual([]);
    expect(checkLayout(conforming())).toEqual([]);
  });

  it('reports nothing for an empty document', () => {
    expect(checkLayout(doc([]))).toEqual([]);
  });
});

describe('checkLayout — ids', () => {
  it('reports an id carried by two nodes, naming it', () => {
    const findings = checkLayout(
      doc([
        label('area-scene', 0),
        frame('rest', 0, 240, {
          children: [
            { type: 'text', id: 'rest.title' },
            { type: 'text', id: 'rest.title' },
          ],
        }),
      ]),
    );
    expect(codes(findings)).toEqual(['duplicate-id']);
    expect(messageOf(findings, 'duplicate-id')).toContain('rest.title');
  });

  // The exception is a suppressor: it must drop exactly the case coverage's
  // duplicate-page reports, and keep every other repeat.
  it.each([
    {
      shape: 'a declared page id carried by a page and a node nested inside one',
      children: [
        label('area-scene', 0),
        frame('rest-dark', 0, 240, { children: [{ type: 'text', id: 'rest-dark' }] }),
      ],
      coverage: TWINS,
    },
    {
      shape: 'a page id carried by two top-level pages when no coverage is declared',
      children: [label('area-scene', 0), frame('rest-dark', 0, 240), frame('rest-dark', 140, 240)],
      coverage: undefined,
    },
    {
      shape: 'an undeclared id carried by two top-level pages',
      children: [label('area-scene', 0), frame('scratch', 0, 240), frame('scratch', 140, 240)],
      coverage: TWINS,
    },
  ])('still reports $shape', ({ children, coverage }) => {
    expect(codes(checkLayout(doc(children), { coverage }))).toContain('duplicate-id');
  });

  it('leaves a declared page id carried only by top-level nodes to coverage', () => {
    const findings = checkLayout(
      doc([label('area-scene', 0), frame('rest-dark', 0, 240), frame('rest-dark', 140, 240)]),
      { coverage: TWINS },
    );
    expect(codes(findings)).not.toContain('duplicate-id');
  });

  it('reports an id containing a slash, naming it', () => {
    const findings = checkLayout(
      doc([
        label('area-scene', 0),
        frame('rest', 0, 240, { children: [{ type: 'text', id: 'rest/title' }] }),
      ]),
    );
    expect(codes(findings)).toEqual(['slash-id']);
    expect(messageOf(findings, 'slash-id')).toContain('rest/title');
  });

  it('reports ten counter-style ids sharing a prefix, naming the prefix', () => {
    const counted = Array.from({ length: 10 }, (_, i) => ({ type: 'text', id: `n${i + 1}` }));
    const findings = checkLayout(
      doc([label('area-scene', 0), frame('rest', 0, 240, { children: counted })]),
    );
    expect(codes(findings)).toEqual(['counter-id']);
    expect(messageOf(findings, 'counter-id')).toMatch(/\bn\b/);
  });

  it.each([
    {
      shape: 'nine counter-style ids on one prefix',
      ids: Array.from({ length: 9 }, (_, i) => `n${i + 1}`),
    },
    { shape: 'states that end in a number', ids: ['step1', 'step2', 'step3'] },
    {
      shape: 'editor-generated ids',
      ids: ['T7JlYn', 'igUDq', 'erStL', 'A7Nu0J', 'k2Hq9', 'Zp03x', 'mW8rT', 'q1', 'b22', 'c3'],
    },
    {
      shape: 'path ids that end in a number',
      ids: Array.from({ length: 12 }, (_, i) => `rest.list.row${i + 1}`),
    },
  ])('does not report $shape as counters', ({ ids }) => {
    const nodes = ids.map((id) => ({ type: 'text', id }));
    const findings = checkLayout(
      doc([label('area-scene', 0), frame('rest', 0, 240, { children: nodes })]),
    );
    expect(codes(findings)).not.toContain('counter-id');
  });
});

describe('checkLayout — pages stay top-level', () => {
  it.each([
    {
      shape: 'inside a page',
      holder: frame('rest', 0, 240, { children: [frame('menu', 0, 0)] }),
    },
    {
      shape: 'two levels down, inside a row frame',
      holder: {
        type: 'frame',
        id: 'row',
        x: 0,
        y: 240,
        children: [{ type: 'group', id: 'band', children: [frame('menu', 0, 0)] }],
      },
    },
  ])('reports a FINAL page nested $shape, naming it', ({ holder }) => {
    const findings = checkLayout(doc([label('area-scene', 0), holder]));
    expect(codes(findings)).toContain('nested-page');
    expect(messageOf(findings, 'nested-page')).toContain('FINAL:app: menu');
  });

  it('does not report a nested node that is not a FINAL page', () => {
    const findings = checkLayout(
      doc([
        label('area-scene', 0),
        frame('rest', 0, 240, { children: [{ type: 'frame', id: 'rest.menu', name: 'Menu' }] }),
      ]),
    );
    expect(codes(findings)).not.toContain('nested-page');
  });
});

describe('checkLayout — rows', () => {
  it('reports every page of a document with no row label in one finding', () => {
    const findings = checkLayout(doc([frame('rest-dark', 0, 0), frame('rest-light', 140, 0)]));
    expect(codes(findings)).toEqual(['page-outside-row']);
    expect(messageOf(findings, 'page-outside-row')).toContain('rest-dark');
    expect(messageOf(findings, 'page-outside-row')).toContain('rest-light');
  });

  it('reports a page above the first row label', () => {
    const findings = checkLayout(
      doc([frame('stray', 0, -500), label('area-scene', 0), frame('rest', 0, 240)]),
    );
    expect(codes(findings)).toEqual(['page-outside-row']);
    expect(messageOf(findings, 'page-outside-row')).toContain('stray');
    expect(messageOf(findings, 'page-outside-row')).not.toContain('rest');
  });

  it('reports a page closer to its label than the label is tall, and passes one exactly that far', () => {
    const close = checkLayout(doc([label('area-scene', 0), frame('rest', 0, 199)]));
    expect(codes(close)).toEqual(['page-outside-row']);
    expect(messageOf(close, 'page-outside-row')).toContain('rest');
    expect(checkLayout(doc([label('area-scene', 0), frame('rest', 0, 200)]))).toEqual([]);
  });

  it('reports a page reaching past the next label, and passes one that touches it', () => {
    const past = checkLayout(
      doc([label('area-scene', 0), frame('rest', 0, 240), label('area-chat', 339)]),
    );
    expect(codes(past)).toEqual(['page-outside-row']);
    expect(messageOf(past, 'page-outside-row')).toContain('rest');
    expect(
      checkLayout(doc([label('area-scene', 0), frame('rest', 0, 240), label('area-chat', 340)])),
    ).toEqual([]);
  });

  it('skips the next-label rule for a page whose height is not a number', () => {
    for (const height of ['fit_content(900)', '$page-height']) {
      const findings = checkLayout(
        doc([label('area-scene', 0), frame('rest', 0, 240, { height }), label('area-chat', 300)]),
      );
      expect(findings).toEqual([]);
    }
  });

  it('reads a missing y as 0', () => {
    const { y: _y, ...noY } = frame('rest', 0, 0);
    const findings = checkLayout(doc([label('area-scene', 0), noY]));
    expect(codes(findings)).toEqual(['page-outside-row']);
  });

  it('skips top-level nodes that are neither frames nor text', () => {
    const findings = checkLayout(
      doc([
        { type: 'rectangle', id: 'backdrop', x: 0, y: -900, width: 10, height: 10 },
        { type: 'group', id: 'scratch', x: 0, y: -900, children: [] },
        label('area-scene', 0),
        frame('rest', 0, 240),
      ]),
    );
    expect(findings).toEqual([]);
  });
});

describe('checkLayout — row label size', () => {
  it('reports a label under 200, naming it and its size, and passes one at 200', () => {
    const findings = checkLayout(
      doc([label('area-scene', 0, { fontSize: 199 }), frame('rest', 0, 240)]),
    );
    expect(codes(findings)).toEqual(['small-row-label']);
    expect(messageOf(findings, 'small-row-label')).toContain('area-scene');
    expect(messageOf(findings, 'small-row-label')).toContain('199');
    expect(checkLayout(doc([label('area-scene', 0), frame('rest', 0, 240)]))).toEqual([]);
  });

  it('reports a label whose size is missing or bound to a variable, and skips its gap rule', () => {
    const { fontSize: _fontSize, ...unsized } = label('area-scene', 0);
    for (const bad of [unsized, label('area-scene', 0, { fontSize: '$title-size' })]) {
      const findings = checkLayout(doc([bad, frame('rest', 0, 10)]));
      expect(codes(findings)).toEqual(['small-row-label']);
    }
  });
});

describe('checkLayout — twins', () => {
  const row = (...pages: ReturnType<typeof frame>[]) => doc([label('area-scene', 0), ...pages]);

  it('reports a state whose twins have another page between them, naming the state', () => {
    const findings = checkLayout(
      row(
        frame('rest-dark', 0, 240),
        frame('chat-open-dark', 140, 240),
        frame('rest-light', 280, 240),
      ),
      { coverage: TWINS },
    );
    expect(codes(findings)).toEqual(['twin-order']);
    expect(messageOf(findings, 'twin-order')).toContain('rest');
  });

  it('reports twins out of mode order', () => {
    const findings = checkLayout(row(frame('rest-light', 0, 240), frame('rest-dark', 140, 240)), {
      coverage: TWINS,
    });
    expect(codes(findings)).toEqual(['twin-order']);
  });

  it('reports twins split across two rows', () => {
    const findings = checkLayout(
      doc([
        label('area-scene', 0),
        frame('rest-dark', 0, 240),
        label('area-chat', 600),
        frame('rest-light', 0, 840),
      ]),
      { coverage: TWINS },
    );
    expect(codes(findings)).toEqual(['twin-order']);
  });

  it('orders by canvas position, not file order, and ignores the gap between twins', () => {
    const findings = checkLayout(row(frame('rest-light', 5000, 240), frame('rest-dark', 0, 240)), {
      coverage: TWINS,
    });
    expect(findings).toEqual([]);
  });

  it('leaves a page with no declared state and mode out of the rule', () => {
    const findings = checkLayout(
      row(
        frame('rest-dark', 0, 240),
        frame('rest-light', 140, 240),
        frame('debug-panel', 280, 240),
      ),
      { coverage: TWINS },
    );
    expect(findings).toEqual([]);
  });

  it('checks nothing about twins when the surface declares no modes', () => {
    const findings = checkLayout(row(frame('rest-light', 0, 240), frame('rest-dark', 140, 240)), {
      coverage: { states: ['rest-light', 'rest-dark'] },
    });
    expect(findings).toEqual([]);
  });
});

describe('checkLayout — every finding', () => {
  it('is red and points to the contract page', () => {
    const counted = Array.from({ length: 10 }, (_, i) => ({ type: 'text', id: `n${i + 1}` }));
    const findings = checkLayout(
      doc([
        frame('stray', 0, -900),
        label('area-scene', 0, { fontSize: 48 }),
        frame('rest-light', 0, 240, {
          children: [
            ...counted,
            { type: 'text', id: 'a/b' },
            { type: 'text', id: 'dup' },
            { type: 'text', id: 'dup' },
            frame('menu', 0, 0),
          ],
        }),
        frame('rest-dark', 140, 240),
      ]),
      { coverage: TWINS },
    );
    expect(codes(findings).toSorted()).toEqual([
      'counter-id',
      'duplicate-id',
      'nested-page',
      'page-outside-row',
      'slash-id',
      'small-row-label',
      'twin-order',
    ]);
    for (const f of findings) {
      expect(f.severity).toBe('red');
      expect(f.message).toContain('docs/noldor/ui-baseline.md');
    }
  });
});
