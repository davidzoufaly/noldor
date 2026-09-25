// @fd: architecture-design-phase
// The honesty rules for the architecture baseline (spec: "Honesty check"):
// does the `modules` view cover every module exactly once, is every arrow
// backed by an import, and does every arrow end on something? Pure — the
// model, the module list and the import pairs in, findings out — so each rule
// is a unit test; `arch-baseline.ts` gathers the inputs.

import { ARCH_VIEWS, pairKey, type ArchDoc, type ArchPage } from './arch-pen.js';

export type ArchFindingKind =
  | 'unreadable'
  | 'missing-module'
  | 'unknown-module'
  | 'duplicate-module'
  | 'dangling-edge'
  | 'phantom-edge';

export interface ArchFinding {
  readonly kind: ArchFindingKind;
  /** The view it is on — `baseline` for a problem with the file as a whole. */
  readonly view: string;
  /** What it names: a module path, an arrow, a view or a file. */
  readonly subject: string;
  readonly message: string;
}

/** Reported, never blocking: an import the modules view does not draw. */
export interface ArchAdvisory {
  readonly kind: 'undrawn-edge';
  readonly view: 'modules';
  readonly subject: string;
  readonly message: string;
}

export interface ArchCheckResult {
  readonly findings: readonly ArchFinding[];
  readonly advisories: readonly ArchAdvisory[];
}

const KIND_ORDER: readonly ArchFindingKind[] = [
  'unreadable',
  'missing-module',
  'unknown-module',
  'duplicate-module',
  'dangling-edge',
  'phantom-edge',
];

/** Registry order for a view; `baseline` (the whole file) sorts first. */
function viewRank(view: string): number {
  return ARCH_VIEWS.findIndex((v) => v === view);
}

/**
 * Hold a baseline to the code: one page per view, every arrow end on every page
 * resolving, the `modules` page covering each module once, and no arrow there
 * that `pairs` does not back. An import no arrow draws is advisory — a view that
 * had to draw every import would be a hairball.
 */
export function checkArchDoc(
  doc: ArchDoc,
  modules: readonly string[],
  pairs: ReadonlySet<string>,
): ArchCheckResult {
  const findings: ArchFinding[] = [];
  const advisories: ArchAdvisory[] = [];
  const baseline = doc.pages.filter((page) => page.role === 'baseline');

  for (const view of ARCH_VIEWS) {
    const count = baseline.filter((page) => page.view === view).length;
    if (count === 0)
      findings.push({
        kind: 'unreadable',
        view,
        subject: view,
        message: `the baseline has no \`${view}\` page`,
      });
    if (count > 1)
      findings.push({
        kind: 'unreadable',
        view,
        subject: view,
        message: `the baseline has ${count} \`${view}\` pages — keep one`,
      });
  }

  for (const page of baseline) {
    for (const arrow of page.arrows) {
      for (const end of [arrow.from, arrow.to]) {
        if (end.kind !== 'unresolved') continue;
        findings.push({
          kind: 'dangling-edge',
          view: page.view,
          subject: arrow.name,
          message:
            end.matches === 0
              ? `\`${end.text}\` names nothing on the page`
              : `\`${end.text}\` names ${end.matches} boxes — rename all but one`,
        });
      }
    }
  }

  const modulesPages = baseline.filter((page) => page.view === 'modules');
  const [modulesPage] = modulesPages;
  if (modulesPages.length === 1 && modulesPage !== undefined) {
    checkCoverage(modulesPage, modules, findings);
    checkArrows(modulesPage, pairs, findings, advisories);
  }

  findings.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      viewRank(a.view) - viewRank(b.view) ||
      a.subject.localeCompare(b.subject, 'en'),
  );
  advisories.sort((a, b) => a.subject.localeCompare(b.subject, 'en'));
  return { findings, advisories };
}

function checkCoverage(page: ArchPage, modules: readonly string[], findings: ArchFinding[]): void {
  const known = new Set(modules);
  const coveredBy = new Map<string, string[]>();
  for (const box of page.boxes) {
    for (const ref of box.refs) {
      if (known.has(ref)) coveredBy.set(ref, [...(coveredBy.get(ref) ?? []), box.name]);
      else
        findings.push({
          kind: 'unknown-module',
          view: 'modules',
          subject: ref,
          message: `box \`${box.name}\` names ${ref}, which is not a module`,
        });
    }
  }
  for (const mod of modules) {
    const boxes = coveredBy.get(mod) ?? [];
    if (boxes.length === 0)
      findings.push({
        kind: 'missing-module',
        view: 'modules',
        subject: mod,
        message: `no box covers ${mod}`,
      });
    if (boxes.length > 1) {
      findings.push({
        kind: 'duplicate-module',
        view: 'modules',
        subject: mod,
        message: `${mod} is covered by ${boxes.length} boxes: ${boxes.join(', ')}`,
      });
    }
  }
}

function checkArrows(
  page: ArchPage,
  pairs: ReadonlySet<string>,
  findings: ArchFinding[],
  advisories: ArchAdvisory[],
): void {
  const drawn: Array<{ from: readonly string[]; to: readonly string[] }> = [];
  for (const arrow of page.arrows) {
    if (arrow.from.kind === 'unresolved' || arrow.to.kind === 'unresolved') continue;
    const from = arrow.from.refs;
    const to = arrow.to.refs;
    drawn.push({ from, to });
    if (from.some((a) => to.some((b) => a !== b && pairs.has(pairKey(a, b))))) continue;
    findings.push({
      kind: 'phantom-edge',
      view: 'modules',
      subject: arrow.name,
      message:
        from.length === 0 || to.length === 0
          ? 'one end covers no module, so no import can back it'
          : `no import from ${from.join(' + ')} into ${to.join(' + ')}`,
    });
  }

  /** Module → the id of the first box covering it, for the internal-import test. */
  const homeBox = new Map<string, string>();
  for (const box of page.boxes)
    for (const ref of box.refs) if (!homeBox.has(ref)) homeBox.set(ref, box.id);
  for (const pair of pairs) {
    const [a, b] = pair.split(' -> ');
    if (a === undefined || b === undefined) continue;
    const home = homeBox.get(a);
    const away = homeBox.get(b);
    // An uncovered module is already `missing-module`; an import inside one box is not an edge.
    if (home === undefined || away === undefined || home === away) continue;
    if (drawn.some((d) => d.from.includes(a) && d.to.includes(b))) continue;
    advisories.push({
      kind: 'undrawn-edge',
      view: 'modules',
      subject: pair,
      message: `${a} imports ${b}, but no arrow shows it`,
    });
  }
}
