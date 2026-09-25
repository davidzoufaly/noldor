// @fd: architecture-design-phase
// The honesty rules for the architecture baseline (spec: "Honesty check").
// Pure — the model and the module list in, findings out — so each rule is a
// unit test; `arch-baseline.ts` gathers the inputs.

import { ARCH_VIEWS, type ArchDoc, type ArchPage } from './arch-pen.js';

export type ArchFindingKind =
  | 'unreadable'
  | 'missing-module'
  | 'unknown-module'
  | 'duplicate-module'
  | 'dangling-edge';

export interface ArchFinding {
  readonly kind: ArchFindingKind;
  /** The view it is on — `baseline` for a problem with the file as a whole. */
  readonly view: string;
  /** What it names: a module path, an arrow, a view or a file. */
  readonly subject: string;
  readonly message: string;
}

export interface ArchCheckResult {
  readonly findings: readonly ArchFinding[];
}

const KIND_ORDER: readonly ArchFindingKind[] = [
  'unreadable',
  'missing-module',
  'unknown-module',
  'duplicate-module',
  'dangling-edge',
];

/** Registry order for a view; `baseline` (the whole file) sorts first. */
function viewRank(view: string): number {
  return ARCH_VIEWS.findIndex((v) => v === view);
}

/**
 * Hold a baseline to the module list: one page per view, every arrow end on
 * every page resolving, and the `modules` page covering each module once.
 */
export function checkArchDoc(doc: ArchDoc, modules: readonly string[]): ArchCheckResult {
  const findings: ArchFinding[] = [];
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
  if (modulesPages.length === 1 && modulesPage !== undefined)
    checkCoverage(modulesPage, modules, findings);

  findings.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      viewRank(a.view) - viewRank(b.view) ||
      a.subject.localeCompare(b.subject),
  );
  return { findings };
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
