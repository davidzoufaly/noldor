// @fd: architecture-design-phase
// `noldor design arch-progress --milestone <slug>` — how far the as-built
// baseline still is from a milestone's target architecture (spec: "Milestone
// target"). The target's FINAL:architecture: pages are held against the
// baseline's one page, by name: modules and parts by path, other boxes by
// canonical layer name, arrows by canonical `<from> -> <to>`. A target with no
// FINAL: page is "no change planned" and reports nothing. Advisory by design:
// milestones are optional and never block, so the report always exits 0 once
// it can read.

import { optionalFlag, runIfDirect } from '../core/cli-entry.js';
import { ARCH_BASELINE_PATH, milestonePenPath } from '../core/design-artifact-names.js';
import { readRepoText } from '../core/read-text.js';
import { isSlug } from '../core/slug.js';
import {
  arrowEndsOf,
  canonicalName,
  pairKey,
  readArchPen,
  type ArchDoc,
  type ArchPage,
} from './arch-pen.js';

export interface Progress {
  /** In the target, not yet in the baseline. */
  readonly toBuild: readonly string[];
  /** In the baseline, gone from the target. */
  readonly toRemove: readonly string[];
  readonly done: readonly string[];
}

/** What a page is made of, as comparable labels: `box: <path or name>` and `arrow: <from> -> <to>`. */
function itemsOf(page: ArchPage): string[] {
  const items: string[] = [];
  for (const box of page.boxes) {
    const names = box.refs.length > 0 ? box.refs : [box.name];
    for (const name of names) items.push(`box: ${name}`);
  }
  for (const arrow of page.arrows) {
    const ends = arrowEndsOf(arrow.name);
    if (ends !== null)
      items.push(`arrow: ${pairKey(canonicalName(ends.from), canonicalName(ends.to))}`);
  }
  return items;
}

/** The target's FINAL: pages against the baseline page, or `null` when the target plans nothing. */
export function compareToTarget(target: ArchDoc, baseline: ArchDoc): Progress | null {
  const finals = target.pages.filter((page) => page.role === 'final');
  if (finals.length === 0) return null;
  const want = new Set(finals.flatMap(itemsOf));
  const have = new Set(baseline.pages.filter((page) => page.role === 'baseline').flatMap(itemsOf));
  return {
    toBuild: [...want].filter((item) => !have.has(item)).sort(),
    toRemove: [...have].filter((item) => !want.has(item)).sort(),
    done: [...want].filter((item) => have.has(item)).sort(),
  };
}

function readDoc(
  cwd: string,
  rel: string,
): { ok: true; doc: ArchDoc } | { ok: false; error: string } {
  const file = readRepoText(cwd, rel);
  if (!file.ok) return file;
  const read = readArchPen(file.text);
  return read.ok ? read : { ok: false, error: `${rel}: ${read.error}` };
}

/** Exit 0 = report printed, 1 = the target or the baseline cannot be read, 2 = bad arguments. */
export async function main(argv: readonly string[], cwd: string = process.cwd()): Promise<number> {
  const label = 'design arch-progress';
  const flag = optionalFlag(argv, '--milestone', label);
  if (!flag.ok) {
    console.error(flag.error);
    return 2;
  }
  const slug = flag.value;
  if (slug === undefined || !isSlug(slug)) {
    console.error(`${label}: --milestone <slug> is required, and must be a milestone slug`);
    return 2;
  }
  const target = readDoc(cwd, milestonePenPath(slug));
  if (!target.ok) {
    console.error(`${label}: no readable target — ${target.error}`);
    return 1;
  }
  const baseline = readDoc(cwd, ARCH_BASELINE_PATH);
  if (!baseline.ok) {
    console.error(`${label}: no readable baseline — ${baseline.error}`);
    return 1;
  }
  const progress = compareToTarget(target.doc, baseline.doc);
  if (progress === null) {
    console.log(`arch-progress: milestone ${slug} — no FINAL: page, nothing planned`);
    return 0;
  }
  console.log(
    `arch-progress: milestone ${slug} — ${progress.toBuild.length} to build, ${progress.toRemove.length} to remove, ${progress.done.length} done`,
  );
  for (const item of progress.toBuild) console.log(`  to-build   ${item}`);
  for (const item of progress.toRemove) console.log(`  to-remove  ${item}`);
  console.log(`  done       ${progress.done.length} item(s)`);
  return 0;
}

runIfDirect('arch-progress', 'design arch-progress', async (argv) => main(argv));
