// @fd: stable-entry-ids-for-roadmap-backlog

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import matter from 'gray-matter';

import { atomicWriteFileSync } from '../core/atomic-write.js';
import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';

/**
 * Stable entry-ID format. Single `Q-` namespace (roadmap and backlog share it
 * so cross-file moves never force a rewrite), zero-padded to 4 digits. The
 * `\d{4,}` lower bound keeps `Q-0001`..`Q-9999` fixed-width while letting the
 * width grow past `Q-9999` without a format break.
 */
export const ENTRY_ID_RE = /^Q-\d{4,}$/;

/** Default location of the persisted counter, relative to the repo root. */
export const COUNTER_PATH_DEFAULT = '.noldor/id-counter.json';

/** Render a 1-based sequence number as a zero-padded entry ID (`42` → `Q-0042`). */
export function formatEntryId(n: number): string {
  return `Q-${String(n).padStart(4, '0')}`;
}

/**
 * Read the persisted `next` counter. Missing file ⇒ 1 (a fresh repo starts at
 * `Q-0001`). A present-but-corrupt counter throws — a garbage counter must fail
 * loudly rather than silently reset the sequence and re-mint used IDs.
 */
function readNext(counterPath: string): number {
  if (!existsSync(counterPath)) return 1;
  const parsed = JSON.parse(readFileSync(counterPath, 'utf8')) as { next?: unknown };
  const next = parsed.next;
  if (typeof next !== 'number' || !Number.isInteger(next) || next < 1) {
    throw new Error(
      `entry-id: corrupt counter at ${counterPath}: 'next' must be a positive integer, got ${JSON.stringify(next)}`,
    );
  }
  return next;
}

export interface MintEntryIdsOptions {
  /** Where the persisted counter lives. Defaults to {@link COUNTER_PATH_DEFAULT}. */
  counterPath?: string;
  /**
   * Highest sequence number already taken in the live corpus — the floor the
   * counter is raised to when it has drifted behind. Required rather than
   * defaulted: a caller that cannot say what is already taken is the exact
   * caller that mints a collision, so the type system asks. Compute it with
   * `liveMaxEntryId(repoRoot)` from `live-max-entry-id.ts`; pass 0 only when
   * there is provably no corpus (tests over a bare tmpdir).
   */
  liveMax: number;
}

/**
 * Mint `count` sequential entry IDs and persist the bumped counter. Synchronous
 * FS, mirroring `resolveIsShipped`'s style in `score.ts`. Concurrency is handled
 * out-of-band: `.noldor/id-counter.json` is a real merge conflict under parallel
 * branches and `duplicate-entry-id` is the pre-commit backstop (see the spec's
 * Risks section) — no file lock here. The write goes through
 * {@link atomicWriteFileSync} so an interrupted mint cannot leave a torn
 * counter that the next `readNext` rejects as corrupt.
 *
 * The sequence starts at `max(counter, liveMax + 1)`: nothing reads the corpus
 * when the counter is bumped, so it drifts behind and its first number collides
 * with a live entry (Q-0160 — `mint-id --count 4` re-emitted `Q-0153`). Taking
 * the floor from the corpus makes the drift self-healing: the bumped counter is
 * persisted past the corpus, so the repair holds for later mints too. A counter
 * that runs *ahead* is left alone — gaps are legal and burning one is harmless.
 */
export function mintEntryIds(count: number, opts: MintEntryIdsOptions): string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`mintEntryIds: count must be a positive integer, got ${count}`);
  }
  if (!Number.isInteger(opts.liveMax) || opts.liveMax < 0) {
    throw new Error(
      `mintEntryIds: liveMax must be a non-negative integer, got ${opts.liveMax} — ` +
        `a bad floor mints IDs that are already taken`,
    );
  }
  const counterPath = opts.counterPath ?? COUNTER_PATH_DEFAULT;
  const next = Math.max(readNext(counterPath), opts.liveMax + 1);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(formatEntryId(next + i));
  atomicWriteFileSync(counterPath, `${JSON.stringify({ next: next + count }, null, 2)}\n`);
  return ids;
}

/**
 * Every feature MD's `entry-id:` frontmatter value, paired with its slug (the
 * file stem). A missing directory yields nothing — an adopting repo may have no
 * `docs/features/` yet. `id` stays `unknown`: frontmatter is untrusted text, so
 * each caller decides what a non-conforming value means (a ref lookup misses,
 * a max scan contributes 0).
 *
 * Shared by {@link resolveEntryRef} and `liveMaxEntryId` — both ask "which IDs
 * have already come to rest in an FD?", and a scan that drifts between them
 * would make an ID resolvable but not counted as taken, or the reverse.
 */
export function* featureEntryIds(featuresDir: string): Generator<{ slug: string; id: unknown }> {
  if (!existsSync(featuresDir)) return;
  for (const file of readdirSync(featuresDir)) {
    if (!file.endsWith('.md')) continue;
    const data = matter(readFileSync(join(featuresDir, file), 'utf8')).data as {
      'entry-id'?: unknown;
    };
    yield { slug: file.slice(0, -3), id: data['entry-id'] };
  }
}

export interface ResolveEntryRefPaths {
  roadmapRaw: string;
  backlogRaw: string;
  /** Directory of feature MDs (`docs/features`). Scanned for `entry-id` frontmatter. */
  featuresDir: string;
}

/**
 * Resolve an entry reference to a slug. If `ref` is not an entry ID (i.e. it is
 * already a slug), return it unchanged. If it is an ID, scan the parsed roadmap
 * and backlog for a matching `id`, then feature MDs for a matching `entry-id`
 * frontmatter field, and return that entry's slug. An unknown ID resolves to
 * itself — downstream treats it as an unshipped/unknown slug, the same failure
 * mode as a typo'd slug today.
 */
export function resolveEntryRef(ref: string, paths: ResolveEntryRefPaths): string {
  if (!ENTRY_ID_RE.test(ref)) return ref;

  for (const raw of [paths.roadmapRaw, paths.backlogRaw]) {
    const entries = raw === paths.roadmapRaw ? parseRoadmap(raw) : parseBacklog(raw);
    const hit = entries.find((e) => e.id === ref);
    if (hit) return hit.slug;
  }

  for (const fd of featureEntryIds(paths.featuresDir)) {
    if (fd.id === ref) return fd.slug;
  }

  return ref;
}

/**
 * A `### ` (level 3) or `#### ` (level 4) markdown heading — the shape of a
 * roadmap/backlog entry heading.
 *
 * Both depths stay accepted on **read** even though the file format is frozen at
 * `### <Entry Name>` and no writer mints `#### ` entries any more (see
 * `docs/noldor/triage.md` → File format is frozen). A consumer repo that
 * adopted Noldor before the freeze may still carry legacy `#### ` entries under
 * an `### <Category>` container; narrowing this to `^###\s` would silently skip
 * them and let `stampMissingIds` leave them without an `- id:`, which
 * `validate:triage` then errors on as `missing-entry-id`. Keep `{3,4}` until the
 * migration window closes.
 */
const HEADING_RE = /^#{3,4}\s+\S/;

interface BlockScan {
  hasArea: boolean;
  hasId: boolean;
  /** Index (into the block's body lines) of the first `- ` bullet, or -1. */
  firstBulletIdx: number;
}

/**
 * Inspect a block's body lines (everything after its heading, up to the next
 * heading) for an `- area:` bullet, an existing `- id:` bullet, and the position
 * of the first bullet. Fenced code inside the block is skipped so a `- id:`
 * example inside a code block is not mistaken for a real field.
 */
function scanBlock(body: string[]): BlockScan {
  let hasArea = false;
  let hasId = false;
  let firstBulletIdx = -1;
  let inFence = false;
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^-\s+area:/.test(line)) hasArea = true;
    else if (/^-\s+id:/.test(line)) hasId = true;
    if (firstBulletIdx === -1 && /^-\s+/.test(line)) firstBulletIdx = i;
  }
  return { hasArea, hasId, firstBulletIdx };
}

/**
 * Stamp `- id:` bullets into every entry block that lacks one, minting IDs on
 * demand via `mint`. Entries are stamped in source order (caller runs roadmap
 * before backlog for a deterministic sequence). Category-only headings (no
 * `- area:` bullet) and blocks that already carry an `- id:` are left untouched,
 * making a re-run a no-op. The new bullet is inserted immediately before the
 * first existing bullet so it reads as the block's first field.
 */
export function stampMissingIds(raw: string, mint: () => string): { text: string; minted: number } {
  const lines = raw.split('\n');
  const out: string[] = [];
  let inFence = false;
  let minted = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence || !HEADING_RE.test(line)) {
      out.push(line);
      continue;
    }

    // Heading: collect the block body up to (but not including) the next heading.
    const body: string[] = [];
    let j = i + 1;
    let bodyFence = false;
    for (; j < lines.length; j++) {
      const bl = lines[j];
      if (bl.startsWith('```')) bodyFence = !bodyFence;
      else if (!bodyFence && HEADING_RE.test(bl)) break;
      body.push(bl);
    }

    const scan = scanBlock(body);
    out.push(line);
    if (scan.hasArea && !scan.hasId && scan.firstBulletIdx !== -1) {
      // Emit body with the id bullet spliced in before the first bullet.
      for (let k = 0; k < body.length; k++) {
        if (k === scan.firstBulletIdx) {
          out.push(`- id: ${mint()}`);
          minted++;
        }
        out.push(body[k]);
      }
    } else {
      out.push(...body);
    }
    i = j - 1; // continue after the consumed body
  }

  return { text: out.join('\n'), minted };
}
