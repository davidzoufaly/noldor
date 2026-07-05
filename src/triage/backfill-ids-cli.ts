// @fd: stable-entry-ids-for-roadmap-backlog

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { COUNTER_PATH_DEFAULT, mintEntryIds, stampMissingIds } from './entry-id.js';

const ROADMAP = 'docs/roadmap.md';
const BACKLOG = 'docs/backlog.md';

/**
 * Mint IDs for every id-less entry across roadmap then backlog (deterministic
 * order), stamping `- id:` as each block's first bullet. Idempotent: entries
 * that already carry an id are skipped, so a second run changes nothing. IDs are
 * minted lazily (one at a time) so no gap is burned when a file has no missing
 * entries. Returns the per-file minted counts.
 *
 * @param cwd - Repo root (roadmap/backlog resolved relative to it).
 */
export function backfillIds(cwd: string = process.cwd()): { roadmap: number; backlog: number } {
  const counterPath = `${cwd}/${COUNTER_PATH_DEFAULT}`;
  // Lazy minter: pull exactly one ID per id-less block, in file order.
  const mint = (): string => mintEntryIds(1, counterPath)[0]!;

  const roadmapPath = `${cwd}/${ROADMAP}`;
  const roadmapRaw = readFileSync(roadmapPath, 'utf8');
  const roadmapOut = stampMissingIds(roadmapRaw, mint);
  if (roadmapOut.minted > 0) writeFileSync(roadmapPath, roadmapOut.text, 'utf8');

  const backlogPath = `${cwd}/${BACKLOG}`;
  const backlogRaw = readFileSync(backlogPath, 'utf8');
  const backlogOut = stampMissingIds(backlogRaw, mint);
  if (backlogOut.minted > 0) writeFileSync(backlogPath, backlogOut.text, 'utf8');

  return { roadmap: roadmapOut.minted, backlog: backlogOut.minted };
}

function main(): number {
  const result = backfillIds(process.cwd());
  const total = result.roadmap + result.backlog;
  if (total === 0) {
    process.stdout.write('backfill-ids: no id-less entries — nothing to do.\n');
  } else {
    process.stdout.write(
      `backfill-ids: minted ${total} id(s) (${result.roadmap} roadmap, ${result.backlog} backlog).\n`,
    );
  }
  return 0;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  process.exit(main());
}
