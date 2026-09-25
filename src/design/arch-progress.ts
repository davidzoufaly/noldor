// @fd: architecture-design-phase
// `noldor design arch-progress --milestone <slug>` — how far the as-built
// baseline still is from a milestone's target architecture (spec: "Milestone
// target"). The target's FINAL:<view>: pages are held against the baseline's
// pages for the same views, by name: modules by path, other boxes by layer
// name, arrows by canonical `<from> -> <to>`. A view with no FINAL: page is
// "no change planned" and reports nothing. Advisory by design: milestones are
// optional and never block, so the report always exits 0 once it can read.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { optionalFlag, runIfDirect } from '../core/cli-entry.js';
import { ARCH_BASELINE_PATH, milestonePenPath } from '../core/design-artifact-names.js';
import { errMessage } from '../core/err-message.js';
import { isSlug } from '../core/slug.js';
import type { ArchitecturePageId } from '../docs/architecture-schema.js';
import {
  ARCH_VIEWS,
  arrowEndsOf,
  pairKey,
  readArchPen,
  type ArchDoc,
  type ArchPage,
} from './arch-pen.js';

export interface ViewProgress {
  readonly view: ArchitecturePageId;
  /** In the target, not yet in the baseline. */
  readonly toBuild: readonly string[];
  /** In the baseline, gone from the target's page for this view. */
  readonly toRemove: readonly string[];
  readonly done: readonly string[];
}

/** An arrow end in canonical spelling, so `group:Work` and `group: Work` compare equal. */
function canonicalEnd(end: string): string {
  return end.startsWith('group:') ? `group: ${end.slice('group:'.length).trim()}` : end;
}

/** What a page is made of, as comparable labels: `box: <module or name>` and `arrow: <from> -> <to>`. */
function itemsOf(page: ArchPage): string[] {
  const items: string[] = [];
  for (const box of page.boxes) {
    const names = page.view === 'modules' && box.refs.length > 0 ? box.refs : [box.name];
    for (const name of names) items.push(`box: ${name}`);
  }
  for (const arrow of page.arrows) {
    const ends = arrowEndsOf(arrow.name);
    if (ends !== null)
      items.push(`arrow: ${pairKey(canonicalEnd(ends.from), canonicalEnd(ends.to))}`);
  }
  return items;
}

/** The target's covered views against the baseline, in registry view order. */
export function compareToTarget(target: ArchDoc, baseline: ArchDoc): ViewProgress[] {
  const progress: ViewProgress[] = [];
  for (const view of ARCH_VIEWS) {
    const finals = target.pages.filter((page) => page.role === 'final' && page.view === view);
    if (finals.length === 0) continue;
    const want = new Set(finals.flatMap(itemsOf));
    const have = new Set(
      baseline.pages
        .filter((page) => page.role === 'baseline' && page.view === view)
        .flatMap(itemsOf),
    );
    progress.push({
      view,
      toBuild: [...want].filter((item) => !have.has(item)).sort(),
      toRemove: [...have].filter((item) => !want.has(item)).sort(),
      done: [...want].filter((item) => have.has(item)).sort(),
    });
  }
  return progress;
}

function readDoc(
  cwd: string,
  rel: string,
): { ok: true; doc: ArchDoc } | { ok: false; error: string } {
  let text: string;
  try {
    text = readFileSync(join(cwd, rel), 'utf8');
  } catch (err) {
    return { ok: false, error: `${rel}: ${errMessage(err)}` };
  }
  const read = readArchPen(text);
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
  if (progress.length === 0) {
    console.log(`arch-progress: milestone ${slug} — no view has a FINAL: page, nothing planned`);
    return 0;
  }
  const count = (key: 'toBuild' | 'toRemove' | 'done'): number =>
    progress.reduce((n, v) => n + v[key].length, 0);
  console.log(
    `arch-progress: milestone ${slug} — ${count('toBuild')} to build, ${count('toRemove')} to remove, ${count('done')} done`,
  );
  for (const view of progress) {
    for (const item of view.toBuild) console.log(`  ${view.view.padEnd(11)} to-build   ${item}`);
    for (const item of view.toRemove) console.log(`  ${view.view.padEnd(11)} to-remove  ${item}`);
    console.log(`  ${view.view.padEnd(11)} done       ${view.done.length} item(s)`);
  }
  return 0;
}

runIfDirect('arch-progress', 'design arch-progress', async (argv) => main(argv));
