// @fd: gate-skill-loads-only-the-branch-a-session-takes
/**
 * `noldor skill-size <check|baseline>` — a word-count ratchet over every markdown
 * file under `.claude/skills/`, one baseline entry per file.
 *
 *                              check   baseline
 *   every file within baseline   0        0
 *   a file grew, or is new       1        0   (records, prints direction)
 *   baseline absent              3        0
 *   baseline unreadable          3        0   (overwrites)
 *   usage error                  2        2
 */
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { z } from 'zod';

import { runIfDirect } from '../core/cli-entry.js';
import { readCheckedState, writeJsonState } from '../core/state-file.js';
import { collectSkillMd } from '../garden/detectors/skill-code-drift.js';
import { countWords } from '../utils/word-count.js';

export const SKILL_SIZE_BASELINE = '.noldor/skill-size-baseline.json';

/**
 * Bumped when what the ratchet counts changes. A baseline from another version
 * reads as unreadable (exit 3) rather than as a skip: the ratchet runs in this
 * repo only, the bump lands in the same change as its re-record, and a skip
 * would leave the only repo it guards unguarded until someone noticed.
 */
export const SKILL_SIZE_ALGORITHM_VERSION = 1;

export const skillSizeBaselineSchema = z
  .object({
    algorithmVersion: z.number().int(),
    recordedAt: z.string().min(1),
    files: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();
export type SkillSizeBaseline = z.infer<typeof skillSizeBaselineSchema>;

export type BaselineRead =
  | { kind: 'ok'; baseline: SkillSizeBaseline }
  | { kind: 'absent' }
  | { kind: 'unreadable'; reason: string };

export type SkillSizeRow =
  | { path: string; kind: 'grew'; baseline: number; words: number }
  | { path: string; kind: 'unrecorded'; words: number }
  | { path: string; kind: 'fell'; baseline: number; words: number }
  | { path: string; kind: 'same'; words: number }
  | { path: string; kind: 'gone'; baseline: number };

const byPath = (a: string, b: string): number => a.localeCompare(b, 'en');

/**
 * Word count of every `.md` under `.claude/skills/`, keyed by repo-relative POSIX
 * path and sorted by it. Frontmatter and fenced blocks count: an agent loads them.
 */
export function measureSkillSizes(repo: string): Record<string, number> {
  const sizes = collectSkillMd(join(repo, '.claude', 'skills')).map((file): [string, number] => [
    relative(repo, file).split(sep).join('/'),
    countWords(readFileSync(file, 'utf8')),
  ]);
  return Object.fromEntries(sizes.sort(([a], [b]) => byPath(a, b)));
}

/** One row per file in either map, sorted by path. */
export function compareSkillSizes(
  baseline: Record<string, number>,
  current: Record<string, number>,
): SkillSizeRow[] {
  const rows: SkillSizeRow[] = [];
  for (const [path, words] of Object.entries(current)) {
    const recorded = baseline[path];
    if (recorded === undefined) rows.push({ path, kind: 'unrecorded', words });
    else if (words > recorded) rows.push({ path, kind: 'grew', baseline: recorded, words });
    else if (words < recorded) rows.push({ path, kind: 'fell', baseline: recorded, words });
    else rows.push({ path, kind: 'same', words });
  }
  for (const [path, recorded] of Object.entries(baseline)) {
    if (current[path] === undefined) rows.push({ path, kind: 'gone', baseline: recorded });
  }
  return rows.sort((a, b) => byPath(a.path, b.path));
}

/** Read `.noldor/skill-size-baseline.json`; a parse, schema or version failure is `unreadable`, never a throw. */
export function readSkillSizeBaseline(repo: string): BaselineRead {
  const read = readCheckedState(join(repo, SKILL_SIZE_BASELINE), skillSizeBaselineSchema);
  if (read.kind !== 'ok') return read;
  if (read.value.algorithmVersion !== SKILL_SIZE_ALGORITHM_VERSION) {
    return {
      kind: 'unreadable',
      reason: `recorded by algorithm version ${read.value.algorithmVersion}; this is version ${SKILL_SIZE_ALGORITHM_VERSION}`,
    };
  }
  return { kind: 'ok', baseline: read.value };
}

/** Write the baseline for `files`, stamped with the current algorithm version. */
export function writeSkillSizeBaseline(
  repo: string,
  files: Record<string, number>,
  now: Date = new Date(),
): void {
  const baseline: SkillSizeBaseline = {
    algorithmVersion: SKILL_SIZE_ALGORITHM_VERSION,
    recordedAt: now.toISOString(),
    files,
  };
  writeJsonState(join(repo, SKILL_SIZE_BASELINE), baseline);
}

const REMEDY = 'pnpm noldor skill-size baseline';

function describeRow(row: SkillSizeRow): string {
  switch (row.kind) {
    case 'grew':
      return `${row.path} — ${row.words} words, baseline ${row.baseline} (+${row.words - row.baseline})`;
    case 'unrecorded':
      return `${row.path} — ${row.words} words, no baseline entry`;
    case 'fell':
      return `${row.path} — ${row.words} words, baseline ${row.baseline} (${row.words - row.baseline})`;
    case 'same':
      return `${row.path} — ${row.words} words`;
    case 'gone':
      return `${row.path} — recorded at ${row.baseline} words, no longer on disk`;
  }
}

function check(repo: string): number {
  const read = readSkillSizeBaseline(repo);
  if (read.kind !== 'ok') {
    const why =
      read.kind === 'absent'
        ? `no baseline at ${SKILL_SIZE_BASELINE}`
        : `${SKILL_SIZE_BASELINE} is unreadable: ${read.reason}`;
    process.stderr.write(`✗ skill-size: ${why}. Record one: ${REMEDY}\n`);
    return 3;
  }
  const rows = compareSkillSizes(read.baseline.files, measureSkillSizes(repo));
  const over = rows.filter((r) => r.kind === 'grew' || r.kind === 'unrecorded');
  const gone = rows.filter((r) => r.kind === 'gone');
  for (const r of gone)
    process.stdout.write(`skill-size: ${describeRow(r)} (the next baseline drops it)\n`);
  if (over.length === 0) {
    process.stdout.write(
      `skill-size: ${rows.length - gone.length} skill files within their baseline\n`,
    );
    return 0;
  }
  process.stderr.write(`✗ skill-size: ${over.length} skill file(s) over the recorded baseline:\n`);
  for (const r of over) process.stderr.write(`    ${describeRow(r)}\n`);
  process.stderr.write(`  If the growth is deliberate, re-record in the same push: ${REMEDY}\n`);
  return 1;
}

function record(repo: string): number {
  const current = measureSkillSizes(repo);
  const read = readSkillSizeBaseline(repo);
  const previous = read.kind === 'ok' ? read.baseline.files : {};
  writeSkillSizeBaseline(repo, current);
  process.stdout.write(
    `skill-size: recorded ${Object.keys(current).length} skill files to ${SKILL_SIZE_BASELINE}\n`,
  );
  const label = { grew: 'RAISED', fell: 'lowered', unrecorded: 'new', gone: 'dropped' } as const;
  for (const r of compareSkillSizes(previous, current)) {
    if (r.kind !== 'same') process.stdout.write(`  ${label[r.kind]} ${describeRow(r)}\n`);
  }
  return 0;
}

/**
 * CLI entry: `noldor skill-size <check|baseline>`.
 *
 * @param argv - Arguments after the verb.
 * @param repo - Repository root.
 * @returns The exit code in the table at the top of this file.
 */
export async function main(argv: string[], repo: string = process.cwd()): Promise<number> {
  const [sub, ...rest] = argv;
  if ((sub !== 'check' && sub !== 'baseline') || rest.length > 0) {
    process.stderr.write('usage: noldor skill-size <check|baseline>\n');
    return 2;
  }
  return sub === 'check' ? check(repo) : record(repo);
}

runIfDirect('skill-size', 'skill-size', (argv) => main(argv));
