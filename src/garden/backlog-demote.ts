import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { loadDocRoots } from '../core/doc-roots.js';
import { parseBacklog } from '../utils/parse-blocks.js';
import { slugify } from '../utils/slugify.js';

/**
 * Age threshold (in days) past which a backlog entry counts as stale.
 * Shared with `detectUnusedBacklog` in garden-detect.ts so the detector
 * and the auto-demotion act on the same notion of "stale".
 */
export const STALE_BACKLOG_DAYS_DEFAULT = 180;

/** One entry demoted by {@link demoteStaleBacklog}. */
export interface DemotedEntry {
  readonly slug: string;
  readonly name: string;
  /** The entry's `since` date that tripped the threshold. */
  readonly since: string;
}

/** Result of a {@link demoteStaleBacklog} pass. */
export interface DemoteResult {
  readonly newRaw: string;
  readonly demoted: readonly DemotedEntry[];
}

export interface DemoteOptions {
  /** Age threshold in days. Defaults to {@link STALE_BACKLOG_DAYS_DEFAULT}. */
  staleDays?: number;
  /** Clock injection for tests. Defaults to `Date.now()`. */
  nowMs?: number;
}

/**
 * Auto-demote stale backlog entries.
 *
 * An entry is stale when its `since` date is older than `staleDays` and it
 * has not already been demoted (`- phase: later` absent). Each stale block
 * gets two edits:
 *
 * 1. `- phase: later` written into the block — an existing `- phase: X`
 *    bullet is rewritten in place, otherwise the bullet is appended to the
 *    block's field run — so parsers see the demotion.
 * 2. A dated marker line appended to the block body documenting when and
 *    why the demotion happened — mirroring the `- triage YYYY-MM-DD: ...`
 *    marker convention.
 *
 * Idempotent: a second pass over the output is a no-op (the `phase: later`
 * field excludes already-demoted entries). Entries with malformed `since`
 * are skipped, matching `detectUnusedBacklog`. Blocks are matched by
 * heading name; duplicate-named stale blocks are all demoted.
 *
 * Pure on the raw string — file IO lives in the CLI wrapper below.
 *
 * @param raw - Raw `docs/backlog.md` contents.
 * @param opts - Threshold + clock overrides.
 * @returns New raw contents plus the list of demoted entries.
 */
export function demoteStaleBacklog(raw: string, opts: DemoteOptions = {}): DemoteResult {
  const staleDays = opts.staleDays ?? STALE_BACKLOG_DAYS_DEFAULT;
  const nowMs = opts.nowMs ?? Date.now();
  const ageCutoffMs = nowMs - staleDays * 24 * 60 * 60 * 1000;
  const today = new Date(nowMs).toISOString().slice(0, 10);

  const staleByName = new Map<string, DemotedEntry>();
  for (const entry of parseBacklog(raw)) {
    if (entry.phase === 'later' || !entry.since) continue;
    const sinceMs = Date.parse(`${entry.since}T00:00:00Z`);
    if (!Number.isFinite(sinceMs)) continue;
    if (sinceMs < ageCutoffMs) {
      staleByName.set(entry.name, {
        name: entry.name,
        since: entry.since,
        slug: slugify(entry.name),
      });
    }
  }
  if (staleByName.size === 0) return { demoted: [], newRaw: raw };

  const lines = raw.split('\n');
  const out: string[] = [];
  const demoted: DemotedEntry[] = [];
  let inCodeFence = false;
  // True from a stale block's heading until the next heading / EOF — phase
  // bullets are rewritten anywhere in this span, not just in the field run.
  let inStaleBlock = false;
  // True while the block's leading field run is still open.
  let fieldRunOpen = false;
  // Index in `out` of the last field bullet seen in the current stale block
  // (falls back to the heading index when the block has no field bullets).
  let lastFieldIdx = -1;
  // True once a `- phase: X` bullet was rewritten in place — no separate
  // insert needed then.
  let phaseDone = false;
  let pendingMarker: string | null = null;

  // Runs at the next heading / EOF: insert `- phase: later` only when no
  // existing phase bullet was rewritten anywhere in the block, then append
  // the dated marker. Deferring the insert to the block boundary is what
  // keeps a phase bullet sitting after body text from surviving alongside
  // the inserted one (last-assignment-wins would un-demote the entry).
  const flushBlock = (): void => {
    if (inStaleBlock && !phaseDone) {
      out.splice(lastFieldIdx + 1, 0, '- phase: later');
    }
    if (pendingMarker !== null) {
      // Drop trailing blank lines so the marker sits flush at the block end;
      // the trailing '' keeps a blank line before the next heading and the
      // file's trailing newline at EOF.
      while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
      out.push('', pendingMarker, '');
      pendingMarker = null;
    }
    inStaleBlock = false;
    fieldRunOpen = false;
    phaseDone = false;
    lastFieldIdx = -1;
  };

  for (const line of lines) {
    if (line.startsWith('```')) inCodeFence = !inCodeFence;
    const heading = !inCodeFence && /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flushBlock();
      const entry = staleByName.get(heading[1]);
      if (entry) {
        demoted.push(entry);
        pendingMarker = `- demoted ${today}: stale (since ${entry.since}, >${staleDays} days) — phase auto-demoted to later`;
        inStaleBlock = true;
        fieldRunOpen = true;
        lastFieldIdx = out.length; // heading index; advances over the field run below
      }
      out.push(line);
      continue;
    }
    if (inStaleBlock && !inCodeFence && line.startsWith('- phase: ')) {
      out.push('- phase: later'); // rewrite in place, wherever it sits
      phaseDone = true;
      continue;
    }
    if (fieldRunOpen && !inCodeFence && /^- \w+: /.test(line)) {
      out.push(line);
      lastFieldIdx = out.length - 1;
      continue;
    }
    out.push(line);
    // First non-field, non-blank line closes the field run.
    if (fieldRunOpen && line.trim() !== '' && !/^- \w+: /.test(line)) {
      fieldRunOpen = false;
    }
  }
  flushBlock();

  return { demoted, newRaw: out.join('\n') };
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('backlog-demote');
if (invokedDirect) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const json = argv.includes('--json');
  const daysIdx = argv.indexOf('--days');
  const rawDays = daysIdx >= 0 ? argv[daysIdx + 1] : undefined;
  const staleDays = daysIdx >= 0 ? Number(rawDays) : STALE_BACKLOG_DAYS_DEFAULT;
  if (!Number.isFinite(staleDays) || staleDays <= 0) {
    console.error(
      rawDays === undefined
        ? 'backlog-demote: --days requires a value'
        : `backlog-demote: invalid --days value '${rawDays}'`,
    );
    process.exit(1);
  }

  const backlogPath = loadDocRoots(process.cwd()).backlog;
  let raw: string;
  try {
    raw = readFileSync(backlogPath, 'utf8');
  } catch {
    if (json) process.stdout.write(`${JSON.stringify({ demoted: [], dryRun })}\n`);
    else console.log('backlog-demote: no docs/backlog.md — nothing to demote.');
    process.exit(0);
  }

  const { newRaw, demoted } = demoteStaleBacklog(raw, { staleDays });
  if (demoted.length > 0 && !dryRun) {
    writeFileSync(backlogPath, newRaw, 'utf8');
  }
  if (json) {
    process.stdout.write(`${JSON.stringify({ demoted, dryRun })}\n`);
  } else if (demoted.length === 0) {
    console.log(`backlog-demote: no entries past ${staleDays} days — nothing to demote.`);
  } else {
    const verb = dryRun ? 'would demote' : 'demoted';
    for (const d of demoted) {
      console.log(`backlog-demote: ${verb} '${d.slug}' (since ${d.since}) → phase: later`);
    }
  }
}
