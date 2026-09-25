// @tests: pendev-ui-design-phase
import { describe, expect, it } from 'vitest';

import {
  checkCoverage,
  inspectBaseline,
  parsePenDocument,
  topLevelPages,
  validateBaseline,
  type PenSchemaFacts,
} from '../pen-doc.js';

const page = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  type: 'frame',
  id,
  name,
  children: [],
  ...extra,
});

const pen = (doc: Record<string, unknown>) => JSON.stringify({ version: '2.19', ...doc });

const codes = (findings: readonly { code: string }[]) => findings.map((f) => f.code);

const SCHEMA: PenSchemaFacts = {
  path: '/ext/pen.schema.json',
  version: '2.19',
  required: ['version', 'children'],
  topLevelKeys: ['version', 'fileToken', 'fonts', 'themes', 'imports', 'variables', 'children'],
};

describe('parsePenDocument', () => {
  it('refuses bytes that are not JSON', () => {
    expect(parsePenDocument('{ not json').ok).toBe(false);
  });

  it('refuses a document without a top-level children array', () => {
    expect(parsePenDocument(JSON.stringify({ version: '2.19' })).ok).toBe(false);
    expect(parsePenDocument(JSON.stringify({ version: '2.19', children: {} })).ok).toBe(false);
  });

  it('reads a document with a children array', () => {
    expect(parsePenDocument(pen({ children: [] })).ok).toBe(true);
  });
});

describe('topLevelPages', () => {
  it('lists the top-level nodes in file order with their id and name', () => {
    const parsed = parsePenDocument(
      pen({ children: [page('rest-dark', 'FINAL:app: rest — dark'), page('rest-light', 'b')] }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(topLevelPages(parsed.doc)).toEqual([
      { id: 'rest-dark', name: 'FINAL:app: rest — dark' },
      { id: 'rest-light', name: 'b' },
    ]);
  });

  it('reports an absent id or name as undefined rather than inventing one', () => {
    const parsed = parsePenDocument(pen({ children: [{ type: 'text' }] }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(topLevelPages(parsed.doc)).toEqual([{ id: undefined, name: undefined }]);
  });
});

describe('validateBaseline — red findings', () => {
  it('reports unparseable bytes as a red finding', () => {
    const findings = validateBaseline('{ not json', null);
    expect(codes(findings)).toEqual(['unparseable']);
    expect(findings[0]!.severity).toBe('red');
  });

  it('reports a document with no children array as unparseable', () => {
    expect(codes(validateBaseline(JSON.stringify({ version: '2.19' }), null))).toEqual([
      'unparseable',
    ]);
  });

  it('reports a missing version as missing-required', () => {
    const findings = validateBaseline(JSON.stringify({ children: [] }), null);
    expect(codes(findings)).toEqual(['missing-required']);
    expect(findings[0]!.severity).toBe('red');
    expect(findings[0]!.message).toContain('version');
  });

  it('reports a binding to a variable the empty variables block does not declare', () => {
    const findings = validateBaseline(
      pen({
        variables: {},
        children: [page('rest-dark', 'FINAL:app: rest — dark', { fill: '$dark-viewport-bg' })],
      }),
      null,
    );
    expect(codes(findings)).toEqual(['unresolved-variable']);
    expect(findings[0]!.severity).toBe('red');
    expect(findings[0]!.message).toContain('$dark-viewport-bg');
  });

  it('finds bindings nested in child nodes and in arrays', () => {
    const findings = validateBaseline(
      pen({
        variables: { gap: { type: 'number', value: 4 } },
        children: [
          page('a', 'a', {
            gap: '$gap',
            children: [
              { type: 'rectangle', id: 'r', fill: [{ type: 'color', color: '$missing' }] },
            ],
          }),
        ],
      }),
      null,
    );
    expect(codes(findings)).toEqual(['unresolved-variable']);
    expect(findings[0]!.message).toContain('$missing');
    expect(findings[0]!.message).not.toContain('$gap');
  });

  it('resolves a binding to a declared variable', () => {
    expect(
      validateBaseline(
        pen({
          variables: { 'dark-viewport-bg': { type: 'color', value: '#000000' } },
          children: [page('a', 'a', { fill: '$dark-viewport-bg' })],
        }),
        null,
      ),
    ).toEqual([]);
  });

  it('accepts a qualified binding whose alias is imported and reports one whose alias is not', () => {
    const doc = (fill: string) =>
      pen({ imports: { lib: './lib.pen' }, children: [page('a', 'a', { fill })] });
    expect(validateBaseline(doc('$lib:brand'), null)).toEqual([]);
    expect(codes(validateBaseline(doc('$ui:brand'), null))).toEqual(['unresolved-variable']);
  });

  it('counts a dollar-prefixed text content as a binding, as the schema does', () => {
    const findings = validateBaseline(
      pen({
        children: [page('a', 'a', { children: [{ type: 'text', id: 't', content: '$price' }] })],
      }),
      null,
    );
    expect(findings[0]!.message).toContain('$price');
  });

  it('does not read ids, names, types, urls or refs as bindings', () => {
    expect(
      validateBaseline(
        pen({
          children: [
            page('$odd-id', '$odd-name', {
              children: [{ type: 'ref', id: 'x', ref: '$component', url: '$asset.png' }],
            }),
          ],
        }),
        null,
      ),
    ).toEqual([]);
  });

  it('names one unresolved variable and counts the rest instead of listing every binding', () => {
    const findings = validateBaseline(
      pen({
        children: [
          page('a', 'a', { fill: '$one' }),
          page('b', 'b', { fill: '$two' }),
          page('c', 'c', { fill: '$two' }),
        ],
      }),
      null,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('$one');
    expect(findings[0]!.message).toContain('1 more');
  });
});

describe('validateBaseline — schema advisories', () => {
  it('reports version drift, unknown top-level keys and schema-required keys as advisories', () => {
    const findings = validateBaseline(
      JSON.stringify({ version: '2.13', legacy: true, children: [] }),
      { ...SCHEMA, required: ['version', 'children', 'themes'] },
    );
    expect(codes(findings).toSorted()).toEqual([
      'schema-required',
      'unknown-top-level-key',
      'version-drift',
    ]);
    expect(findings.every((f) => f.severity === 'advisory')).toBe(true);
    expect(findings.find((f) => f.code === 'version-drift')!.message).toContain('2.13');
    expect(findings.find((f) => f.code === 'unknown-top-level-key')!.message).toContain('legacy');
    expect(findings.find((f) => f.code === 'schema-required')!.message).toContain('themes');
  });

  it('reports no schema finding when no schema was found', () => {
    expect(
      validateBaseline(JSON.stringify({ version: '2.13', legacy: true, children: [] }), null),
    ).toEqual([]);
  });

  it('reports nothing for a document that matches the schema', () => {
    expect(validateBaseline(pen({ variables: {}, children: [] }), SCHEMA)).toEqual([]);
  });
});

describe('checkCoverage', () => {
  const declared = { states: ['rest', 'chat-open'], modes: ['light', 'dark'] };

  it('reports a declared state-mode page that is missing', () => {
    const findings = checkCoverage(
      [
        { id: 'rest-light', name: 'FINAL:app: rest — light' },
        { id: 'rest-dark', name: 'FINAL:app: rest — dark' },
        { id: 'chat-open-dark', name: 'FINAL:app: chat open — dark' },
      ],
      declared,
      'app',
    );
    expect(codes(findings)).toEqual(['missing-page']);
    expect(findings[0]!.severity).toBe('red');
    expect(findings[0]!.message).toContain('chat-open-light');
  });

  it('reports a declared id carried by two top-level frames', () => {
    const findings = checkCoverage(
      [
        { id: 'rest', name: 'FINAL:app: rest' },
        { id: 'rest', name: 'FINAL:app: rest again' },
      ],
      { states: ['rest'] },
      'app',
    );
    expect(codes(findings)).toEqual(['duplicate-page']);
    expect(findings[0]!.message).toContain('rest');
  });

  it("reports an undeclared FINAL page of this surface, and ignores other surfaces' and non-FINAL pages", () => {
    const findings = checkCoverage(
      [
        { id: 'rest', name: 'FINAL:app: rest' },
        { id: 'deleted', name: 'FINAL:app: deleted' },
        { id: 'notes', name: 'notes' },
        { id: 'other', name: 'FINAL:dashboard: other' },
        { id: undefined, name: 'Scene' },
      ],
      { states: ['rest'] },
      'app',
    );
    expect(codes(findings)).toEqual(['undeclared-page']);
    expect(findings[0]!.message).toContain('deleted');
  });

  it('expands states alone to bare ids when no modes are declared', () => {
    expect(
      checkCoverage([{ id: 'rest', name: 'FINAL:app: rest' }], { states: ['rest'] }, 'app'),
    ).toEqual([]);
  });
});

describe('inspectBaseline', () => {
  const rowLabel = { type: 'text', id: 'area-app', content: 'App', fontSize: 200, x: 0, y: 0 };

  it('combines validity and coverage findings for one surface', () => {
    const findings = inspectBaseline(
      pen({
        children: [
          rowLabel,
          page('rest-dark', 'FINAL:app: rest — dark', { fill: '$gone', y: 240 }),
        ],
      }),
      { schema: null, coverage: { states: ['rest'], modes: ['light', 'dark'] }, surface: 'app' },
    );
    expect(codes(findings).toSorted()).toEqual(['missing-page', 'unresolved-variable']);
  });

  it('adds red layout findings with or without declared coverage or an installed schema', () => {
    const bytes = pen({
      variables: {},
      children: [{ ...rowLabel, fontSize: 48 }, page('rest', 'FINAL:app: rest', { y: 240 })],
    });
    for (const schema of [null, SCHEMA]) {
      for (const coverage of [undefined, { states: ['rest'] }]) {
        const layout = inspectBaseline(bytes, { schema, coverage, surface: 'app' }).filter(
          (f) => f.code === 'small-row-label',
        );
        expect(layout).toHaveLength(1);
        expect(layout[0].severity).toBe('red');
      }
    }
  });

  it('leaves a declared page carried twice at the top level to coverage alone', () => {
    const findings = inspectBaseline(
      pen({
        children: [
          rowLabel,
          page('rest', 'FINAL:app: rest', { y: 240 }),
          page('rest', 'FINAL:app: rest again', { x: 140, y: 240 }),
        ],
      }),
      { schema: null, coverage: { states: ['rest'] }, surface: 'app' },
    );
    expect(codes(findings)).toEqual(['duplicate-page']);
  });

  it('reports a declared page id that a top-level text node shares, through coverage', () => {
    const findings = inspectBaseline(
      pen({
        children: [
          rowLabel,
          page('rest', 'FINAL:app: rest', { y: 240 }),
          { type: 'text', id: 'rest', content: 'Rest', fontSize: 200, x: 0, y: 2000 },
        ],
      }),
      { schema: null, coverage: { states: ['rest'] }, surface: 'app' },
    );
    expect(codes(findings)).toEqual(['duplicate-page']);
  });

  it('reports only unparseable when the bytes are not a .pen, since no page can be read', () => {
    expect(
      codes(
        inspectBaseline('nope', { schema: null, coverage: { states: ['rest'] }, surface: 'app' }),
      ),
    ).toEqual(['unparseable']);
  });

  it('skips coverage for a surface that declares none', () => {
    expect(inspectBaseline(pen({ children: [] }), { schema: null, surface: 'app' })).toEqual([]);
  });
});
