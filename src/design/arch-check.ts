// @fd: architecture-design-phase
// The honesty rules for the architecture baseline (spec: "Honesty check"): is
// there exactly one `architecture` page, is every module boxed once, does every
// part exist and sit inside its module, is every arrow that touches code backed
// by an import, and does every arrow end on something? Pure — the model and the
// code truth in, findings out — so each rule is a unit test; `arch-baseline.ts`
// gathers the inputs.

import { ARCH_PAGE, pairKey, type ArchDoc, type ArchPage, type FileEdge } from './arch-pen.js';

export type ArchFindingKind =
  | 'unreadable'
  | 'missing-module'
  | 'unknown-module'
  | 'duplicate-module'
  | 'unknown-part'
  | 'misplaced-part'
  | 'dangling-edge'
  | 'phantom-edge';

export interface ArchFinding {
  readonly kind: ArchFindingKind;
  /** What it names: a module or part path, an arrow, the page or a file. */
  readonly subject: string;
  readonly message: string;
}

/** Reported, never blocking: a module import no arrow draws. */
export interface ArchAdvisory {
  readonly kind: 'undrawn-edge';
  readonly subject: string;
  readonly message: string;
}

export interface ArchCheckResult {
  readonly findings: readonly ArchFinding[];
  readonly advisories: readonly ArchAdvisory[];
}

/** The code the baseline is held to — everything `arch-baseline.ts` gathers. */
export interface CodeTruth {
  readonly modules: readonly string[];
  /** Module import pairs, `from -> to`. */
  readonly pairs: ReadonlySet<string>;
  readonly edges: readonly FileEdge[];
  /** The part paths the baseline names that exist on disk. */
  readonly parts: ReadonlySet<string>;
}

const KIND_ORDER: readonly ArchFindingKind[] = [
  'unreadable',
  'missing-module',
  'unknown-module',
  'duplicate-module',
  'unknown-part',
  'misplaced-part',
  'dangling-edge',
  'phantom-edge',
];

/** `file` is `path` itself or sits inside it. */
export function isUnder(file: string, path: string): boolean {
  return file === path || file.startsWith(`${path}/`);
}

/** The module `path` is or sits under — the longest one, as `moduleOf` picks — or `null`. */
function moduleOfPath(path: string, modules: readonly string[]): string | null {
  let best: string | null = null;
  for (const mod of modules)
    if (isUnder(path, mod) && (best === null || mod.length > best.length)) best = mod;
  return best;
}

/**
 * Whether a file of the `from` end imports a file of the `to` end. When one
 * end's path is inside the other's, the outer end stands only for its files
 * outside the inner path, so an import inside the inner path backs neither
 * direction (spec: "Honesty check").
 */
export function backed(
  from: readonly string[],
  to: readonly string[],
  edges: readonly FileEdge[],
): boolean {
  return from.some((f) =>
    to.some((t) => {
      if (f === t) return false;
      const fromIsOuter = isUnder(t, f);
      const toIsOuter = isUnder(f, t);
      return edges.some(
        (e) =>
          isUnder(e.from, f) &&
          isUnder(e.to, t) &&
          !(fromIsOuter && isUnder(e.from, t)) &&
          !(toIsOuter && isUnder(e.to, f)),
      );
    }),
  );
}

/**
 * Hold a baseline to the code: one `architecture` page, every arrow end
 * resolving, each module boxed once, each part real and inside its module, and
 * no arrow that touches code without an import behind it. A module import no
 * arrow draws is advisory — a page that had to draw every import would be a
 * hairball.
 */
export function checkArchDoc(doc: ArchDoc, truth: CodeTruth): ArchCheckResult {
  const findings: ArchFinding[] = [];
  const advisories: ArchAdvisory[] = [];
  const pages = doc.pages.filter((page) => page.role === 'baseline');
  const [page] = pages;
  if (pages.length !== 1 || page === undefined) {
    findings.push({
      kind: 'unreadable',
      subject: ARCH_PAGE,
      message:
        pages.length === 0
          ? `the baseline has no \`${ARCH_PAGE}\` page — move the old file aside and draw one with \`pnpm noldor design arch-draw\`, or rename its page \`${ARCH_PAGE}\``
          : `the baseline has ${pages.length} \`${ARCH_PAGE}\` pages — keep one`,
    });
    return { findings, advisories };
  }

  for (const arrow of page.arrows) {
    for (const end of [arrow.from, arrow.to]) {
      if (end.kind !== 'unresolved') continue;
      findings.push({
        kind: 'dangling-edge',
        subject: arrow.name,
        message:
          end.matches === 0
            ? `\`${end.text}\` names nothing on the page`
            : `\`${end.text}\` names ${end.matches} boxes — rename all but one`,
      });
    }
  }
  checkBoxes(page, truth, findings);
  checkArrows(page, truth, findings, advisories);

  findings.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.subject.localeCompare(b.subject, 'en'),
  );
  advisories.sort((a, b) => a.subject.localeCompare(b.subject, 'en'));
  return { findings, advisories };
}

function checkBoxes(page: ArchPage, truth: CodeTruth, findings: ArchFinding[]): void {
  const known = new Set(truth.modules);
  const coveredBy = new Map<string, string[]>();
  for (const box of page.boxes) {
    for (const ref of box.refs) {
      if (known.has(ref)) {
        coveredBy.set(ref, [...(coveredBy.get(ref) ?? []), box.name]);
        continue;
      }
      // A part is one path under a module; a `+` box joins modules only.
      const mod = box.refs.length === 1 ? moduleOfPath(ref, truth.modules) : null;
      if (mod === null) {
        findings.push({
          kind: 'unknown-module',
          subject: ref,
          message: `box \`${box.name}\` names ${ref}, which is not a module`,
        });
        continue;
      }
      if (!truth.parts.has(ref))
        findings.push({
          kind: 'unknown-part',
          subject: ref,
          message: `part ${ref} does not exist`,
        });
      if (!box.within.includes(mod))
        findings.push({
          kind: 'misplaced-part',
          subject: ref,
          message: `part ${ref} is not inside the ${mod} box`,
        });
    }
  }
  for (const mod of truth.modules) {
    const boxes = coveredBy.get(mod) ?? [];
    if (boxes.length === 0)
      findings.push({ kind: 'missing-module', subject: mod, message: `no box covers ${mod}` });
    if (boxes.length > 1)
      findings.push({
        kind: 'duplicate-module',
        subject: mod,
        message: `${mod} is covered by ${boxes.length} boxes: ${boxes.join(', ')}`,
      });
  }
}

function checkArrows(
  page: ArchPage,
  truth: CodeTruth,
  findings: ArchFinding[],
  advisories: ArchAdvisory[],
): void {
  /** Module pairs some arrow draws, for the undrawn-edge advisory. */
  const drawn = new Set<string>();
  for (const arrow of page.arrows) {
    if (arrow.from.kind === 'unresolved' || arrow.to.kind === 'unresolved') continue;
    const from = arrow.from.refs;
    const to = arrow.to.refs;
    // An end that names no code path (an external, container, store or free name) holds the arrow to resolving only.
    if (from.length === 0 || to.length === 0) continue;
    for (const a of from) {
      for (const b of to) {
        const ma = moduleOfPath(a, truth.modules);
        const mb = moduleOfPath(b, truth.modules);
        if (ma !== null && mb !== null && ma !== mb) drawn.add(pairKey(ma, mb));
      }
    }
    if (backed(from, to, truth.edges)) continue;
    findings.push({
      kind: 'phantom-edge',
      subject: arrow.name,
      message: `no import from ${from.join(' + ')} into ${to.join(' + ')}`,
    });
  }

  /** Module → the id of the first box covering it, for the internal-import test. */
  const homeBox = new Map<string, string>();
  for (const box of page.boxes)
    for (const ref of box.refs) if (!homeBox.has(ref)) homeBox.set(ref, box.id);
  for (const pair of truth.pairs) {
    const [a, b] = pair.split(' -> ');
    if (a === undefined || b === undefined) continue;
    const home = homeBox.get(a);
    const away = homeBox.get(b);
    // An uncovered module is already `missing-module`; an import inside one box is not an edge.
    if (home === undefined || away === undefined || home === away) continue;
    if (drawn.has(pair)) continue;
    advisories.push({
      kind: 'undrawn-edge',
      subject: pair,
      message: `${a} imports ${b}, but no arrow shows it`,
    });
  }
}
