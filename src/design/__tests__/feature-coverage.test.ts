// @tests: feature-pen-coverage-from-acceptance-criteria
import { describe, expect, it } from 'vitest';

import { checkFeatureCoverage, type CoverageFinding } from '../feature-coverage.js';

const TABLE = [
  '| Page               | Criteria | Shows           |',
  '| ------------------ | -------- | --------------- |',
  '| `FINAL:app: rest`  | 1        | the card closed |',
  '| `FINAL:app: empty` | 2        | zero area       |',
  '| not drawn          | 3        | behaviour       |',
];
const CRITERIA = ['1. The card renders.', '2. An empty scene reads zero.', '3. One cut, not two.'];
const PAGES = ['BASE:app: rest', 'FINAL:app: rest', 'FINAL:app: empty'];

function spec(
  opts: { table?: readonly string[] | null; criteria?: readonly string[] } = {},
): string {
  const table = opts.table === undefined ? TABLE : opts.table;
  return [
    '# Card — Design',
    '',
    '## Design',
    '',
    ...(table === null ? [] : ['### Design coverage', '', ...table, '']),
    '## Acceptance criteria',
    '',
    ...(opts.criteria ?? CRITERIA),
    '',
    '## Risks / trade-offs',
    '',
    '- none',
  ].join('\n');
}

const codes = (findings: readonly CoverageFinding[]): string[] => findings.map((f) => f.code);

function only(findings: readonly CoverageFinding[], code: string): string {
  const hit = findings.filter((f) => f.code === code);
  expect(hit).toHaveLength(1);
  return hit[0]!.message;
}

/** The table with row `index` (0 = the first body row) replaced. */
function withRow(index: number, row: string): string[] {
  return TABLE.map((line, i) => (i === index + 2 ? row : line));
}

describe('checkFeatureCoverage — a covered design', () => {
  it('finds nothing when every criterion has a row and the FINAL pages are exactly the table', () => {
    expect(checkFeatureCoverage(spec(), PAGES)).toEqual([]);
    expect(codes(checkFeatureCoverage(spec(), PAGES.slice(0, 2)))).toEqual(['missing-page']);
  });

  it('holds a charuy Q-0275-shaped spec to its eight pages, and misses the one dropped', () => {
    const table = [
      '| Page                          | Criteria        | Shows |',
      '| ----------------------------- | --------------- | ----- |',
      '| `FINAL:app: at rest`          | 1, 2            | x     |',
      '| `FINAL:app: card open`        | 4, 6, 8, 9      | x     |',
      '| `FINAL:app: keyboard focus`   | 5               | x     |',
      '| `FINAL:app: empty scene`      | 11              | x     |',
      '| `FINAL:app: engine error`     | 12              | x     |',
      '| `FINAL:app: 320 px`           | 13              | x     |',
      '| `FINAL:app: short room list`  | 14              | x     |',
      '| `FINAL:app: volume computing` | 15              | x     |',
      '| `FINAL:app: short viewport`   | —               | x     |',
      '| not drawn                     | 3, 7, 10, 16–18 | x     |',
    ];
    const criteria = Array.from({ length: 18 }, (_, i) => `${i + 1}. criterion ${i + 1}`);
    const pages = [
      'FINAL:app: at rest',
      'FINAL:app: card open',
      'FINAL:app: keyboard focus',
      'FINAL:app: empty scene',
      'FINAL:app: engine error',
      'FINAL:app: 320 px',
      'FINAL:app: short room list',
      'FINAL:app: volume computing',
      'FINAL:app: short viewport',
    ];
    expect(checkFeatureCoverage(spec({ table, criteria }), pages)).toEqual([]);
    const dropped = pages.filter((p) => p !== 'FINAL:app: engine error');
    const findings = checkFeatureCoverage(spec({ table, criteria }), dropped);
    expect(codes(findings)).toEqual(['missing-page']);
    expect(findings[0]!.message).toContain('FINAL:app: engine error');
  });

  it('lets several pages cite one criterion, and a page cite none', () => {
    const table = withRow(1, '| `FINAL:app: empty` | 1, 2 | zero area |').concat(
      '| `FINAL:app: short` | — | a decision |',
    );
    const pages = [...PAGES, 'FINAL:app: short'];
    expect(checkFeatureCoverage(spec({ table }), pages)).toEqual([]);
    expect(codes(checkFeatureCoverage(spec({ table }), PAGES))).toEqual(['missing-page']);
  });

  it('expands ranges written with an en dash or a hyphen', () => {
    const criteria = ['1. a', '2. b', '3. c', '4. d'];
    const pages = ['FINAL:app: rest', 'FINAL:app: empty'];
    const tableFor = (range: string): string[] => [
      ...TABLE.slice(0, 3),
      `| \`FINAL:app: empty\` | ${range} | zero |`,
    ];
    for (const range of ['2–4', '2-4', '2 - 4']) {
      expect(checkFeatureCoverage(spec({ table: tableFor(range), criteria }), pages)).toEqual([]);
    }
    const short = checkFeatureCoverage(spec({ table: tableFor('2–3'), criteria }), pages);
    expect(codes(short)).toEqual(['unaccounted-criterion']);
    expect(short[0]!.message).toContain('4');
  });

  it('reads a table whatever its padding and alignment markers', () => {
    const table = [
      '|page|criteria|',
      '|:--|--:|',
      '|`FINAL:app: rest`|1|',
      '|  `FINAL:app: empty`  |  2  |',
      '|Not drawn|3|',
    ];
    expect(checkFeatureCoverage(spec({ table }), PAGES)).toEqual([]);
    expect(codes(checkFeatureCoverage(spec({ table }), ['FINAL:app: rest']))).toEqual([
      'missing-page',
    ]);
  });

  it('compares page names after trimming their ends, and exactly inside them', () => {
    expect(checkFeatureCoverage(spec(), ['  FINAL:app: rest', 'FINAL:app: empty  '])).toEqual([]);
    expect(codes(checkFeatureCoverage(spec(), ['FINAL:app: rest', 'FINAL:app:  empty']))).toEqual([
      'missing-page',
      'undeclared-page',
    ]);
  });
});

describe('checkFeatureCoverage — the table and the criteria must be readable', () => {
  it('reports a spec with no Design coverage section', () => {
    expect(codes(checkFeatureCoverage(spec({ table: null }), PAGES))).toEqual([
      'no-coverage-table',
    ]);
  });

  it('reports a Design coverage section that holds no Page | Criteria table', () => {
    const table = ['| State | What |', '| ----- | ---- |', '| `FINAL:app: rest` | x |'];
    expect(codes(checkFeatureCoverage(spec({ table }), PAGES))).toEqual(['no-coverage-table']);
  });

  it('reports a spec with no acceptance criteria to account for', () => {
    expect(codes(checkFeatureCoverage(spec({ criteria: ['Prose only.'] }), PAGES))).toEqual([
      'no-criteria',
    ]);
  });

  it('names the first criterion whose typed number is out of step', () => {
    const criteria = ['1. a', '2. b', '3. c', '4. d', '5. e', '6. f', '9. g', '9. h'];
    const message = only(checkFeatureCoverage(spec({ criteria }), PAGES), 'misnumbered-criteria');
    expect(message).toContain('7');
    expect(message).toContain('9');
  });

  it.each([
    [
      'a page that is not a backticked FINAL name',
      '| FINAL:app: rest | 1 | x |',
      'FINAL:app: rest',
    ],
    ['a FINAL name with no surface', '| `FINAL: rest` | 1 | x |', 'FINAL: rest'],
    ['a FINAL name with no state', '| `FINAL:app:` | 1 | x |', 'FINAL:app:'],
    ['a criterion that is not a number', '| `FINAL:app: rest` | one | x |', 'FINAL:app: rest'],
    ['a range that runs backwards', '| `FINAL:app: rest` | 3-1 | x |', 'FINAL:app: rest'],
    ['an empty criteria cell', '| `FINAL:app: rest` |  | x |', 'FINAL:app: rest'],
    ['a page declared twice', '| `FINAL:app: empty` | 1 | x |', 'FINAL:app: empty'],
    ['a second not-drawn row', '| not drawn | 1 | x |', 'not drawn'],
  ])('reports %s as a malformed row, naming it', (_, row, named) => {
    const message = only(
      checkFeatureCoverage(spec({ table: withRow(0, row) }), PAGES),
      'malformed-row',
    );
    expect(message).toContain(named);
  });

  it('checks nothing else until the table is well formed', () => {
    const table = withRow(1, '| `FINAL:app: empty` | two | zero |');
    expect(codes(checkFeatureCoverage(spec({ table }), ['FINAL:app: other']))).toEqual([
      'malformed-row',
    ]);
  });
});

describe('checkFeatureCoverage — every criterion is accounted for', () => {
  it('names a criterion no row cites', () => {
    const table = withRow(2, '| not drawn | — | behaviour |');
    const message = only(checkFeatureCoverage(spec({ table }), PAGES), 'unaccounted-criterion');
    expect(message).toContain('3');
  });

  it('names a cited criterion the spec does not have, with its row', () => {
    const table = withRow(0, '| `FINAL:app: rest` | 1, 7 | the card closed |');
    const message = only(checkFeatureCoverage(spec({ table }), PAGES), 'unknown-criterion');
    expect(message).toContain('7');
    expect(message).toContain('FINAL:app: rest');
  });

  it('names a criterion that is both drawn and not drawn', () => {
    const table = withRow(2, '| not drawn | 2, 3 | behaviour |');
    const message = only(checkFeatureCoverage(spec({ table }), PAGES), 'contradictory-criterion');
    expect(message).toContain('2');
  });
});

describe('checkFeatureCoverage — the FINAL pages are exactly the declared pages', () => {
  it('names a declared page the design does not hold, and says a nested page does not count', () => {
    const message = only(checkFeatureCoverage(spec(), ['FINAL:app: rest']), 'missing-page');
    expect(message).toContain('FINAL:app: empty');
    expect(message).toContain('top-level');
  });

  it('names a declared page the design holds twice', () => {
    const pages = [...PAGES, 'FINAL:app: rest'];
    expect(only(checkFeatureCoverage(spec(), pages), 'duplicate-page')).toContain(
      'FINAL:app: rest',
    );
  });

  it('names a FINAL page the table does not declare, and ignores every other page', () => {
    const pages = [...PAGES, 'FINAL:app: focus', 'app: variant B', 'BASE:app: empty'];
    const findings = checkFeatureCoverage(spec(), pages);
    expect(codes(findings)).toEqual(['undeclared-page']);
    expect(findings[0]!.message).toContain('FINAL:app: focus');
    expect(findings[0]!.message).not.toContain('variant B');
  });

  it('points a missing page at an undeclared one that differs only in spacing or case', () => {
    const findings = checkFeatureCoverage(spec(), ['FINAL:app: rest', 'FINAL:App:empty']);
    expect(codes(findings)).toEqual(['missing-page', 'undeclared-page']);
    expect(findings[0]!.message).toContain('FINAL:App:empty');
  });
});
