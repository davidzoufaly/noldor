// scripts/features/migrate-fd-commits-to-prs.ts
// @tests: fd-prs-since-last-release-section

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const FEATURES_DIR = 'docs/features';
const LEGACY_HEADING = '## Commits';
const LEGACY_MARKER_PREFIX = '<!-- @commits-since-last-tag:';
const LEGACY_MARKER_SUFFIX = '-->';
const LEGACY_LINK_PREFIX = '[View commits since last release on GitHub]';
const NEW_MARKER_PREFIX = '<!-- @prs-since-last-release:';

/** Per-FD migration outcome category. */
export type MigrationStatus = 'migrated' | 'already-migrated' | 'no-section';

/** Per-FD migration result; `mismatch` set only when slug-in-marker ≠ filename. */
export interface MigrationResult {
  status: MigrationStatus;
  mismatch?: { filenameStem: string; capturedSlug: string };
}

/**
 * Migrate a single FD body in place. Returns the outcome category and an
 * optional `mismatch` record when the marker carried a stale slug.
 *
 * Algorithm: line-based scan for the canonical 4-line legacy block
 * (heading, blank, marker, blank, link, optional trailing blank).
 * Re-writes the FD with the legacy block replaced by the new
 * `## PRs\n\n<!-- @prs-since-last-release: <filename-stem> -->\n` block.
 * Idempotent: re-running on a migrated FD returns `already-migrated`
 * without writing.
 */
export async function migrateFd(path: string): Promise<MigrationResult> {
  const body = await readFile(path, 'utf8');
  const filenameStem = basename(path, extname(path));

  const hasNewMarker = body.includes(NEW_MARKER_PREFIX);
  const headingIndex = findLineStartingWith(body, LEGACY_HEADING);

  if (headingIndex === -1) {
    return { status: hasNewMarker ? 'already-migrated' : 'no-section' };
  }

  const block = extractLegacyBlock(body, headingIndex);
  if (!block) {
    // Heading found but not the full 4-line legacy block — leave file alone.
    return { status: 'no-section' };
  }

  const newBlock = `## PRs\n\n${NEW_MARKER_PREFIX} ${filenameStem} ${LEGACY_MARKER_SUFFIX}\n`;
  const updated = body.slice(0, block.start) + newBlock + body.slice(block.end);

  await writeFile(path, updated, 'utf8');

  const mismatch =
    block.capturedSlug !== filenameStem
      ? { filenameStem, capturedSlug: block.capturedSlug }
      : undefined;

  return mismatch ? { status: 'migrated', mismatch } : { status: 'migrated' };
}

function findLineStartingWith(body: string, line: string): number {
  let idx = 0;
  while (idx < body.length) {
    const lineEnd = body.indexOf('\n', idx);
    const current = lineEnd === -1 ? body.slice(idx) : body.slice(idx, lineEnd);
    if (current === line) return idx;
    if (lineEnd === -1) return -1;
    idx = lineEnd + 1;
  }
  return -1;
}

interface LegacyBlock {
  start: number;
  end: number;
  capturedSlug: string;
}

function extractLegacyBlock(body: string, headingIndex: number): LegacyBlock | null {
  const headingLineEnd = body.indexOf('\n', headingIndex);
  if (headingLineEnd === -1) return null;
  const blank1End = headingLineEnd + 1;
  if (body[blank1End] !== '\n') return null;
  const markerStart = blank1End + 1;
  const markerEnd = body.indexOf('\n', markerStart);
  if (markerEnd === -1) return null;
  const markerLine = body.slice(markerStart, markerEnd);
  if (!markerLine.startsWith(LEGACY_MARKER_PREFIX) || !markerLine.endsWith(LEGACY_MARKER_SUFFIX)) {
    return null;
  }
  const capturedSlug = markerLine
    .slice(LEGACY_MARKER_PREFIX.length, markerLine.length - LEGACY_MARKER_SUFFIX.length)
    .trim();
  const blank2End = markerEnd + 1;
  if (body[blank2End] !== '\n') return null;
  const linkStart = blank2End + 1;
  const linkEnd = body.indexOf('\n', linkStart);
  if (linkEnd === -1) return null;
  if (!body.slice(linkStart, linkEnd).startsWith(LEGACY_LINK_PREFIX)) return null;
  // Include an optional trailing blank so the new block lines up cleanly.
  let end = linkEnd + 1;
  if (body[end] === '\n') end += 1;
  return { start: headingIndex, end, capturedSlug };
}

/**
 * CLI entry: scan `docs/features/*.md`, migrate each, print a summary, exit
 * non-zero if any slug-mismatch occurred (operator must resolve).
 */
export async function main(): Promise<number> {
  const files = (await readdir(FEATURES_DIR))
    .filter((f) => f.endsWith('.md') && f !== 'template.md')
    .map((f) => join(FEATURES_DIR, f));

  const counts: Record<MigrationStatus, number> = {
    migrated: 0,
    'already-migrated': 0,
    'no-section': 0,
  };
  const mismatches: Array<{ filenameStem: string; capturedSlug: string }> = [];

  for (const path of files) {
    const result = await migrateFd(path);
    counts[result.status] += 1;
    if (result.mismatch) {
      mismatches.push(result.mismatch);
      console.warn(`slug-mismatch ${result.mismatch.filenameStem} ${result.mismatch.capturedSlug}`);
    }
    console.log(`${result.status}\t${path}`);
  }

  console.log('\nSummary:');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  if (mismatches.length > 0) console.log(`  slug-mismatches: ${mismatches.length}`);

  return mismatches.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().then((code) => process.exit(code));
}
