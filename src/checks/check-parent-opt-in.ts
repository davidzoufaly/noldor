// Is the feature a queued entry extends switched on anywhere?
//
// An entry that declares `- parent: <slug>` extends a shipped feature. When
// that feature is opt-in and no known repo has opted in, the extension would
// serve nobody: Q-0180 (a third UI-design review lane) was carved back to the
// roadmap only because someone remembered to check that neither of the two
// shipped lanes had a single install. This check makes that remembered step a
// reported one, before anyone sizes the work.
//
// Inputs, all already on disk: the entry's `- parent:`, the parent FD's
// `opt-in:` frontmatter (the config keys that switch it on), this repo's
// `.noldor/config.json`, and every repo named in `consumer.knownConsumers`.
// Foreign configs are read raw, never through the schema — a consumer on an
// older or newer framework version must not read as "unreadable" for a key the
// schema happens to reject.
//
// Advisory by contract: doctor prints the rows and never fails on them. An
// unset opt-in is a sizing question for a human, not a defect in the repo.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import matter from 'gray-matter';
import { featurePath, readQueueFile } from '../core/doc-roots.js';
import { isSlug } from '../core/slug.js';
import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';

const CONFIG_FILE = '.noldor/config.json';

/**
 * One parent feature that queued entries extend and that no readable known
 * repo has switched on.
 */
export interface ParentOptInRow {
  /** The parent FD slug. */
  readonly parent: string;
  /** The FD's `opt-in:` keys, any one of which switches the feature on. */
  readonly keys: readonly string[];
  /** Roadmap/backlog entry slugs whose `- parent:` names this FD. */
  readonly entries: readonly string[];
  /** Repo roots whose config was read and has none of `keys` set. */
  readonly checked: readonly string[];
  /** Repo roots whose config could not be read, with the reason. */
  readonly unreadable: readonly { readonly root: string; readonly reason: string }[];
}

/**
 * Whether one `opt-in:` key is satisfied by a parsed config document.
 *
 * `a.b.c` is satisfied when the value at that path is present and non-empty
 * (not `undefined`/`null`/`false`/`''`/`[]`/`{}`). `a.b.c=v` additionally
 * requires the value to be `v`, or an array containing `v` — the form a lane
 * list needs (`crLanes.code=render-compare`), since a non-empty `crLanes.code`
 * says nothing about which lanes are in it.
 */
export function isOptInSet(config: unknown, key: string): boolean {
  const eq = key.indexOf('=');
  const path = eq === -1 ? key : key.slice(0, eq);
  let value: unknown = config;
  for (const segment of path.split('.')) {
    if (value === null || typeof value !== 'object') return false;
    value = (value as Record<string, unknown>)[segment];
  }
  if (eq !== -1) {
    const want = key.slice(eq + 1);
    return Array.isArray(value) ? value.includes(want) : value === want;
  }
  if (value === undefined || value === null || value === false || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

type ConfigRead = { ok: true; doc: unknown } | { ok: false; reason: string };

function readConfig(root: string): ConfigRead {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return { ok: false, reason: `no ${CONFIG_FILE}` };
  try {
    return { ok: true, doc: JSON.parse(readFileSync(path, 'utf8')) as unknown };
  } catch (err) {
    return { ok: false, reason: `cannot read ${CONFIG_FILE}: ${(err as Error).message}` };
  }
}

/**
 * This repo plus every `consumer.knownConsumers` entry, resolved against
 * `root` and de-duplicated. The list comes from the raw config so a repo whose
 * config fails the schema still gets the check.
 */
export function knownConsumerRoots(root: string, own: ConfigRead = readConfig(root)): string[] {
  const roots = [resolve(root)];
  if (!own.ok) return roots;
  const listed = (own.doc as { consumer?: { knownConsumers?: unknown } } | null)?.consumer
    ?.knownConsumers;
  if (!Array.isArray(listed)) return roots;
  for (const entry of listed) {
    if (typeof entry !== 'string' || entry === '') continue;
    const abs = isAbsolute(entry) ? resolve(entry) : resolve(root, entry);
    if (!roots.includes(abs)) roots.push(abs);
  }
  return roots;
}

/** The parent FD's `opt-in:` list, or `[]` when the FD is absent or declares none. */
function optInKeys(root: string, parent: string): string[] {
  if (!isSlug(parent)) return [];
  const built = featurePath(root, parent);
  if (!built.ok || !existsSync(built.path)) return [];
  const raw = (matter(readFileSync(built.path, 'utf8')).data as Record<string, unknown>)['opt-in'];
  return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [];
}

/**
 * Every parent feature that a roadmap or backlog entry extends, whose FD
 * declares `opt-in:`, and whose opt-in is unset in every known repo that could
 * be read. A parent is not reported when no known repo could be read at all:
 * "could not look anywhere" is not evidence that nobody opted in.
 *
 * @param root - Repository root holding the queue and the FDs.
 */
export async function checkParentOptIn(root: string): Promise<ParentOptInRow[]> {
  const [roadmap, backlog] = await Promise.all([
    readQueueFile(join(root, 'docs/roadmap.md')),
    readQueueFile(join(root, 'docs/backlog.md')),
  ]);
  const byParent = new Map<string, string[]>();
  for (const entry of [...parseRoadmap(roadmap), ...parseBacklog(backlog)]) {
    if (entry.parent === undefined || entry.parent === '') continue;
    byParent.set(entry.parent, [...(byParent.get(entry.parent) ?? []), entry.slug]);
  }
  if (byParent.size === 0) return [];

  const own = readConfig(root);
  const configs = knownConsumerRoots(root, own).map((r, i) => ({
    root: r,
    read: i === 0 ? own : readConfig(r),
  }));

  const rows: ParentOptInRow[] = [];
  for (const [parent, entries] of byParent) {
    const keys = optInKeys(root, parent);
    if (keys.length === 0) continue;
    const checked: string[] = [];
    const unreadable: { root: string; reason: string }[] = [];
    let enabled = false;
    for (const { root: r, read } of configs) {
      if (!read.ok) {
        unreadable.push({ root: r, reason: read.reason });
        continue;
      }
      if (keys.some((k) => isOptInSet(read.doc, k))) {
        enabled = true;
        break;
      }
      checked.push(r);
    }
    if (enabled || checked.length === 0) continue;
    rows.push({ parent, keys, entries, checked, unreadable });
  }
  return rows;
}

/** One doctor line for a row, without the level column. */
export function renderParentOptInRow(row: ParentOptInRow): string {
  const skipped =
    row.unreadable.length > 0
      ? `; could not read ${row.unreadable.map((u) => `${u.root} (${u.reason})`).join(', ')}`
      : '';
  return (
    `parent-opt-in: ${row.parent} is switched on in none of ${row.checked.length} known repo(s) ` +
    `(opt-in: ${row.keys.join(' | ')}) yet ${row.entries.join(', ')} extend(s) it — ` +
    `check whether the extension has a user before sizing it${skipped}`
  );
}
