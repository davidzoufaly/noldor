// @fd: feature-pen-coverage-from-acceptance-criteria
// Does a feature design hold exactly the pages its spec's `### Design coverage`
// table declares, and does that table account for every acceptance criterion?
// Pure over the spec's text and a list of page names, so the editor's page list
// (`design verdict --coverage`) and the file on disk (`--approve`, `--reconfirm`)
// get the same answer.

import { readCriteria, type AcceptanceCriterion } from '../core/spec-criteria.js';
import { extractSection, stepFence, type FenceState } from '../utils/markdown-sections.js';

export type CoverageFindingCode =
  | 'no-coverage-table'
  | 'no-criteria'
  | 'misnumbered-criteria'
  | 'malformed-row'
  | 'unknown-criterion'
  | 'unaccounted-criterion'
  | 'contradictory-criterion'
  | 'missing-page'
  | 'duplicate-page'
  | 'undeclared-page';

/** One way a design falls short of its spec. Every finding refuses an approval. */
export interface CoverageFinding {
  readonly code: CoverageFindingCode;
  readonly message: string;
}

/** One table row: a `FINAL:` page, or the `not drawn` row when `page` is `null`. */
interface CoverageRow {
  readonly label: string;
  readonly page: string | null;
  readonly cites: ReadonlyArray<readonly [from: number, to: number]>;
}

const FINAL_PAGE_RE = /^FINAL:([^:]*):(.*)$/;
const BACKTICKED_RE = /^`([^`]+)`$/;
const SEPARATOR_CELL_RE = /^:?-+:?$/;
const NUMBER_RE = /^\d+$/;
const RANGE_RE = /^(\d+)\s*[–—-]\s*(\d+)$/;
const NONE_CELLS = new Set(['—', '–', '-']);

const finding = (code: CoverageFindingCode, message: string): CoverageFinding => ({
  code,
  message,
});

function listed(
  code: CoverageFindingCode,
  lead: string,
  items: readonly string[],
): CoverageFinding[] {
  return items.length === 0 ? [] : [finding(code, `${lead}: ${items.join(', ')}`)];
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** The first run of `|` lines outside a fence — the table the section holds. */
function tableLines(section: string): string[] {
  const table: string[] = [];
  let open: FenceState | null = null;
  for (const line of section.split(/\r\n|\r|\n/)) {
    const before = open;
    ({ open } = stepFence(line, open));
    const fenced = before !== null || open !== null;
    if (!fenced && line.trimStart().startsWith('|')) table.push(line);
    else if (table.length > 0) break;
  }
  return table;
}

function readTableBody(
  specMd: string,
): { ok: true; body: string[][] } | { ok: false; finding: CoverageFinding } {
  const section = extractSection(specMd, 'Design coverage');
  if (section === null) {
    return {
      ok: false,
      finding: finding(
        'no-coverage-table',
        'the spec has no ### Design coverage section — derive one row per page from the acceptance criteria',
      ),
    };
  }
  const [header, separator, ...body] = tableLines(section);
  const head = header === undefined ? [] : cells(header);
  const isTable =
    head[0]?.toLowerCase() === 'page' &&
    head[1]?.toLowerCase() === 'criteria' &&
    separator !== undefined &&
    cells(separator).every((cell) => SEPARATOR_CELL_RE.test(cell));
  if (!isTable) {
    return {
      ok: false,
      finding: finding(
        'no-coverage-table',
        'the ### Design coverage section holds no | Page | Criteria | table',
      ),
    };
  }
  return { ok: true, body: body.map(cells) };
}

/** `1, 4–6` → `[[1, 1], [4, 6]]`; `—` → `[]`; anything else → `null`. */
function readCites(cell: string): Array<[number, number]> | null {
  if (NONE_CELLS.has(cell)) return [];
  if (cell === '') return null;
  const cites: Array<[number, number]> = [];
  for (const token of cell.split(',').map((t) => t.trim())) {
    const range = NUMBER_RE.test(token) ? [token, token] : RANGE_RE.exec(token)?.slice(1, 3);
    if (range === undefined) return null;
    const [from, to] = range.map(Number) as [number, number];
    if (from > to) return null;
    cites.push([from, to]);
  }
  return cites;
}

function readRows(body: readonly string[][]): {
  rows: CoverageRow[];
  malformed: CoverageFinding[];
} {
  const rows: CoverageRow[] = [];
  const malformed: CoverageFinding[] = [];
  const bad = (label: string, why: string): void => {
    malformed.push(finding('malformed-row', `row ${label}: ${why}`));
  };
  for (const [label = '', cell = ''] of body) {
    const notDrawn = label.toLowerCase() === 'not drawn';
    const name = BACKTICKED_RE.exec(label)?.[1]?.trim();
    const parts = name === undefined ? null : FINAL_PAGE_RE.exec(name);
    const page =
      parts === null || parts[1]!.trim() === '' || parts[2]!.trim() === '' ? null : name!;
    const cites = readCites(cell);
    if (!notDrawn && page === null) {
      bad(label, 'the page must be a backticked FINAL:<surface>: <state> name, or "not drawn"');
    } else if (cites === null) {
      bad(label, 'criteria must be numbers and ranges such as 1, 4–6, or — for none');
    } else if (rows.some((row) => row.page === page)) {
      bad(label, notDrawn ? 'the table has one not drawn row' : `${page} is declared twice`);
    } else {
      rows.push({ label, page, cites });
    }
  }
  return { rows, malformed };
}

function misnumbered(criteria: readonly AcceptanceCriterion[]): CoverageFinding[] {
  const first = criteria.find((c) => c.typed !== null && c.typed !== c.position);
  return first === undefined
    ? []
    : [
        finding(
          'misnumbered-criteria',
          `acceptance criterion ${first.position} is numbered ${first.typed} — number the criteria in order from 1, so the table cites the numbers a reader sees`,
        ),
      ];
}

function accounting(rows: readonly CoverageRow[], count: number): CoverageFinding[] {
  const cited = (row: CoverageRow, n: number): boolean =>
    row.cites.some(([from, to]) => from <= n && n <= to);
  const numbers = Array.from({ length: count }, (_, i) => i + 1);
  const onPage = (n: number): boolean => rows.some((row) => row.page !== null && cited(row, n));
  const notDrawn = (n: number): boolean => rows.some((row) => row.page === null && cited(row, n));
  const unknown = rows.flatMap((row) =>
    row.cites
      .filter(([from, to]) => from < 1 || to > count)
      .map(([from, to]) => `${from === to ? from : `${from}–${to}`} (${row.label})`),
  );
  return [
    ...listed('unknown-criterion', `criteria the spec does not have (it has ${count})`, unknown),
    ...listed(
      'unaccounted-criterion',
      'criteria no row accounts for — tie each to a page, or list it on the not drawn row',
      numbers.filter((n) => !onPage(n) && !notDrawn(n)).map(String),
    ),
    ...listed(
      'contradictory-criterion',
      'criteria both on a page and on the not drawn row',
      numbers.filter((n) => onPage(n) && notDrawn(n)).map(String),
    ),
  ];
}

function pageFindings(
  rows: readonly CoverageRow[],
  pageNames: readonly string[],
): CoverageFinding[] {
  const declared = rows.flatMap((row) => (row.page === null ? [] : [row.page]));
  const carried = Map.groupBy(
    pageNames.map((name) => name.trim()),
    (name) => name,
  );
  const undeclared = [...carried.keys()].filter(
    (name) => name.startsWith('FINAL:') && !declared.includes(name),
  );
  const squash = (name: string): string => name.replace(/\s+/g, '').toLowerCase();
  const missing = declared
    .filter((page) => !carried.has(page))
    .map((page) => {
      const near = undeclared.find((name) => squash(name) === squash(page));
      return near === undefined ? page : `${page} (the design has "${near}")`;
    });
  return [
    ...listed(
      'missing-page',
      'declared page(s) with no top-level page in the design — a page nested inside another frame does not count',
      missing,
    ),
    ...listed(
      'duplicate-page',
      'declared page(s) the design holds more than once',
      declared.filter((page) => (carried.get(page)?.length ?? 0) > 1),
    ),
    ...listed(
      'undeclared-page',
      'FINAL: page(s) the Design coverage table does not declare',
      undeclared,
    ),
  ];
}

/**
 * Every way the design's pages fall short of the spec's `### Design coverage`
 * table, and the table of the spec's acceptance criteria. A table or criteria
 * list that cannot be read reports only that: the other checks would be
 * computed against an incomplete declaration.
 */
export function checkFeatureCoverage(
  specMd: string,
  pageNames: readonly string[],
): CoverageFinding[] {
  const criteria = readCriteria(specMd);
  const table = readTableBody(specMd);
  const read = table.ok ? readRows(table.body) : { rows: [], malformed: [] };
  const structural = [
    ...(table.ok ? [] : [table.finding]),
    ...(criteria.length === 0
      ? [finding('no-criteria', 'the spec has no acceptance criteria for the table to account for')]
      : []),
    ...misnumbered(criteria),
    ...read.malformed,
  ];
  if (structural.length > 0) return structural;
  return [...accounting(read.rows, criteria.length), ...pageFindings(read.rows, pageNames)];
}
