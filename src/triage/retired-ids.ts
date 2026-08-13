// @fd: stable-entry-ids-for-roadmap-backlog

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { ENTRY_ID_RE } from './entry-id.js';

/** Default location of the retired-ID map, beside the mint counter. */
export const RETIRED_IDS_PATH_DEFAULT = '.noldor/retired-entry-ids.json';

/**
 * Forwarding record for a retired queue entry. Promotion carries an entry's
 * `- id:` into the FD's `entry-id:` frontmatter, but the two no-FD retirement
 * paths — attach sessions and fast-track — remove the queue block and drop the
 * ID, so every `blocked-by:` reference to it dangles permanently. This map is
 * the durable record for those paths: `roadmap remove-block` appends to it and
 * `validate:triage` unions its keys into the known-ref set.
 */
export interface RetiredIdRecord {
  /** Slug of the retired queue entry (heading-derived, human-readable alias). */
  slug: string;
  /** FD slug that absorbed the entry (attach paths). Absent on no-FD paths. */
  retiredInto?: string;
  /** ISO date (yyyy-mm-dd) the entry was retired. */
  retiredAt?: string;
}

/**
 * Read the retired-ID map. Missing file ⇒ empty map (a repo that never retired
 * an ID-carrying entry has nothing to forward). A present-but-corrupt map
 * throws — silently ignoring it would resurface every forwarded ref as a
 * dangling-ref advisory, the exact failure the map exists to prevent.
 */
export function loadRetiredIds(path: string): Record<string, RetiredIdRecord> {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`retired-ids: corrupt map at ${path}: expected an object of Q-NNNN keys`);
  }
  for (const [id, record] of Object.entries(parsed)) {
    if (!ENTRY_ID_RE.test(id)) {
      throw new Error(`retired-ids: corrupt map at ${path}: key '${id}' is not a Q-NNNN entry ID`);
    }
    const slug = (record as { slug?: unknown } | null)?.slug;
    if (typeof slug !== 'string' || slug.length === 0) {
      throw new Error(`retired-ids: corrupt map at ${path}: entry '${id}' is missing a slug`);
    }
  }
  return parsed as Record<string, RetiredIdRecord>;
}

/**
 * Append one retired ID to the map, creating the file on first use. Idempotent:
 * an already-recorded ID is left untouched (first record wins — the original
 * retirement context beats a re-run's) and reported via the return value.
 * A malformed `id` throws before any write: the block parser accepts any
 * string for `- id:`, and one bad key would make every later `loadRetiredIds`
 * throw until the file is hand-edited.
 */
export function recordRetiredId(id: string, record: RetiredIdRecord, path: string): boolean {
  if (!ENTRY_ID_RE.test(id)) {
    throw new Error(`retired-ids: refusing to record malformed entry ID '${id}' (expected Q-NNNN)`);
  }
  const map = loadRetiredIds(path);
  if (id in map) return false;
  map[id] = record;
  writeFileSync(path, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  return true;
}
