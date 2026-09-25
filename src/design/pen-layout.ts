// @tests: pendev-ui-design-phase
// Judges how a baseline `.pen` is laid out, against the contract in
// docs/noldor/ui-baseline.md: pages as top-level frames in labelled rows,
// titles readable at zoom-to-fit, twins side by side, ids that never shift.
// Every finding rests on the file alone, so it means the same on any machine.

/** The smallest row-label `fontSize` the contract allows: it still reads at zoom-to-fit on a full baseline canvas. */
export const MIN_ROW_LABEL_FONT_SIZE = 200;

/** What {@link checkLayout} can report. */
export type LayoutFindingCode =
  | 'duplicate-id'
  | 'slash-id'
  | 'counter-id'
  | 'nested-page'
  | 'page-outside-row'
  | 'small-row-label'
  | 'twin-order';

/** One layout problem. Always red: the layout rules read nothing but the file. */
export interface LayoutFinding {
  readonly code: LayoutFindingCode;
  readonly severity: 'red';
  readonly message: string;
}

const CONTRACT = 'see docs/noldor/ui-baseline.md';

/** A run this long on one prefix is an emitter counting nodes; real names that end in a number never get there. */
const COUNTER_RUN = 10;

type PenNode = Readonly<Record<string, unknown>>;

interface Visit {
  readonly node: PenNode;
  readonly top: PenNode;
  readonly depth: number;
}

interface Label {
  readonly node: PenNode;
  readonly y: number;
  readonly size: number | undefined;
}

interface Seated {
  readonly node: PenNode;
  readonly x: number;
  readonly order: number;
}

const isRecord = (value: unknown): value is PenNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const numberOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const idOf = (node: PenNode): string | undefined =>
  typeof node.id === 'string' ? node.id : undefined;

const nameOf = (node: PenNode): string =>
  idOf(node) ?? (typeof node.name === 'string' ? node.name : '(unnamed)');

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isLowercase = (c: string): boolean => c >= 'a' && c <= 'z';

/** `n12` → `n`. Undefined unless the id is lowercase letters followed by digits. */
function counterPrefix(id: string): string | undefined {
  let end = id.length;
  while (end > 0 && isDigit(id[end - 1])) end--;
  const prefix = id.slice(0, end);
  return end < id.length && prefix !== '' && [...prefix].every(isLowercase) ? prefix : undefined;
}

function finding(code: LayoutFindingCode, lead: string, items: readonly string[]): LayoutFinding[] {
  return items.length === 0
    ? []
    : [{ code, severity: 'red', message: `${lead}: ${items.join(', ')} — ${CONTRACT}` }];
}

/** Every node in document order, with the top-level node that holds it. */
function visitAll(children: readonly unknown[]): Visit[] {
  const out: Visit[] = [];
  const visit = (node: PenNode, top: PenNode, depth: number): void => {
    out.push({ node, top, depth });
    if (Array.isArray(node.children)) {
      for (const child of node.children) if (isRecord(child)) visit(child, top, depth + 1);
    }
  };
  for (const top of children) if (isRecord(top)) visit(top, top, 0);
  return out;
}

function idFindings(
  visits: readonly Visit[],
  declaredPageIds: ReadonlySet<string>,
): LayoutFinding[] {
  const carriers = Map.groupBy(
    visits.flatMap((v) => {
      const id = idOf(v.node);
      return id === undefined ? [] : [{ id, depth: v.depth }];
    }),
    (c) => c.id,
  );
  const ids = [...carriers.keys()];
  // A declared page id carried only at the top level is exactly what coverage's
  // `duplicate-page` reports; reporting it here too would turn that baseline's
  // `incomplete` into `invalid`.
  const duplicated = [...carriers]
    .filter(
      ([id, found]) =>
        found.length > 1 && !(declaredPageIds.has(id) && found.every((c) => c.depth === 0)),
    )
    .map(([id]) => id);
  const counted = Map.groupBy(
    ids.flatMap((id) => {
      const prefix = counterPrefix(id);
      return prefix === undefined ? [] : [{ id, prefix }];
    }),
    (c) => c.prefix,
  );
  const runs = [...counted]
    .filter(([, run]) => run.length >= COUNTER_RUN)
    .map(
      ([prefix, run]) =>
        `${prefix} (${run
          .slice(0, 3)
          .map((c) => c.id)
          .join(', ')} … ${run.length} ids)`,
    );
  return [
    ...finding('duplicate-id', 'id(s) carried by more than one node', duplicated),
    ...finding(
      'slash-id',
      "id(s) containing '/', the pen schema's path separator",
      ids.filter((id) => id.includes('/')),
    ),
    ...finding('counter-id', `${COUNTER_RUN} or more counter-style ids on one prefix`, runs),
  ];
}

function nestedPageFindings(visits: readonly Visit[]): LayoutFinding[] {
  const nested = visits
    .filter(
      (v) => v.depth > 0 && typeof v.node.name === 'string' && v.node.name.startsWith('FINAL:'),
    )
    .map((v) => `${String(v.node.name)} (inside ${nameOf(v.top)})`);
  return finding('nested-page', 'FINAL page(s) below the top level', nested);
}

function sizeOf(label: Label): string {
  if (label.size !== undefined) return String(label.size);
  return label.node.fontSize === undefined ? 'no fontSize' : JSON.stringify(label.node.fontSize);
}

/**
 * Sort the top-level frames into the rows their labels open. A row runs from
 * its label's top edge to the next label's top edge; a page belongs to the row
 * its own top edge falls in.
 */
function seatPages(tops: readonly PenNode[]): {
  labels: Label[];
  rows: Seated[][];
  findings: LayoutFinding[];
} {
  const labels = tops
    .filter((n) => n.type === 'text')
    .map((node) => ({ node, y: numberOf(node.y) ?? 0, size: numberOf(node.fontSize) }))
    .toSorted((a, b) => a.y - b.y);
  const rows: Seated[][] = labels.map(() => []);
  const noLabel: string[] = [];
  const underLabel: string[] = [];
  const pastNext: string[] = [];
  tops.forEach((node, order) => {
    if (node.type !== 'frame') return;
    const y = numberOf(node.y) ?? 0;
    const row = labels.findLastIndex((l) => l.y <= y);
    if (row === -1) {
      noLabel.push(nameOf(node));
      return;
    }
    const own = labels[row];
    const next = labels.at(row + 1);
    const height = numberOf(node.height);
    if (own.size !== undefined && y < own.y + own.size) underLabel.push(nameOf(node));
    if (next !== undefined && height !== undefined && y + height > next.y) {
      pastNext.push(nameOf(node));
    }
    rows[row].push({ node, x: numberOf(node.x) ?? 0, order });
  });
  const reasons = [
    ['no row label above', noLabel],
    ["closer to its label than the label's fontSize", underLabel],
    ['reaching past the next row label', pastNext],
  ] as const;
  const parts = reasons
    .filter(([, pages]) => pages.length > 0)
    .map(([why, pages]) => `${why}: ${pages.join(', ')}`);
  return {
    labels,
    rows,
    findings:
      parts.length === 0
        ? []
        : [
            {
              code: 'page-outside-row',
              severity: 'red',
              message: `page(s) outside a labelled row — ${parts.join('; ')} — ${CONTRACT}`,
            },
          ],
  };
}

/** One state's pages sit in one row, in consecutive seats, in declared mode order. */
function sideBySide(seats: readonly { row: number; seat: number; rank: number }[]): boolean {
  if (new Set(seats.map((s) => s.row)).size > 1) return false;
  const ordered = seats.toSorted((a, b) => a.seat - b.seat);
  return ordered.every(
    (s, i) => i === 0 || (s.seat === ordered[i - 1].seat + 1 && s.rank >= ordered[i - 1].rank),
  );
}

function twinFindings(
  rows: readonly Seated[][],
  coverage: { states: readonly string[]; modes?: readonly string[] } | undefined,
): LayoutFinding[] {
  const modes = coverage?.modes;
  if (coverage === undefined || modes === undefined || modes.length === 0) return [];
  const twinOf = new Map<string, { state: string; rank: number }>(
    coverage.states.flatMap((state) =>
      modes.map((mode, rank) => [`${state}-${mode}`, { state, rank }] as const),
    ),
  );
  const seats = rows.flatMap((row, rowIndex) =>
    row
      .toSorted((a, b) => a.x - b.x || a.order - b.order)
      .flatMap((seated, seat) => {
        const id = idOf(seated.node);
        const twin = id === undefined ? undefined : twinOf.get(id);
        return twin === undefined ? [] : [{ ...twin, row: rowIndex, seat }];
      }),
  );
  const broken = [...Map.groupBy(seats, (s) => s.state)]
    .filter(([, own]) => !sideBySide(own))
    .map(([state]) => state);
  return finding(
    'twin-order',
    `state(s) whose pages are not side by side in mode order (${modes.join(', ')})`,
    broken,
  );
}

/**
 * Every layout finding for one baseline document. `coverage` is the surface's
 * declared states and modes, when it has any: the twin rule needs modes to read
 * a page id as `<state>-<mode>`, and a declared page id carried twice at the
 * top level is left to coverage's own `duplicate-page`.
 */
export function checkLayout(
  doc: { readonly children: readonly unknown[] },
  opts: { coverage?: { states: readonly string[]; modes?: readonly string[] } } = {},
): LayoutFinding[] {
  const { coverage } = opts;
  const modes = coverage?.modes;
  const declaredPageIds = new Set(
    coverage === undefined
      ? []
      : modes === undefined
        ? coverage.states
        : coverage.states.flatMap((s) => modes.map((m) => `${s}-${m}`)),
  );
  const visits = visitAll(doc.children);
  const tops = doc.children.filter(isRecord);
  const { labels, rows, findings: rowFindings } = seatPages(tops);
  const small = labels
    .filter((l) => l.size === undefined || l.size < MIN_ROW_LABEL_FONT_SIZE)
    .map((l) => `${nameOf(l.node)} at ${sizeOf(l)}`);
  return [
    ...idFindings(visits, declaredPageIds),
    ...nestedPageFindings(visits),
    ...rowFindings,
    ...finding('small-row-label', `row label(s) under fontSize ${MIN_ROW_LABEL_FONT_SIZE}`, small),
    ...twinFindings(rows, coverage),
  ];
}
