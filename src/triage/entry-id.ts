// @fd: stable-entry-ids-for-roadmap-backlog

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import matter from 'gray-matter';

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

/**
 * Mint `count` sequential entry IDs and persist the bumped counter. Synchronous
 * FS, mirroring `resolveIsShipped`'s style in `score.ts`. Concurrency is handled
 * out-of-band: `.noldor/id-counter.json` is a real merge conflict under parallel
 * branches and `duplicate-entry-id` is the pre-commit backstop (see the spec's
 * Risks section) — no file lock here.
 */
export function mintEntryIds(count: number, counterPath: string = COUNTER_PATH_DEFAULT): string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`mintEntryIds: count must be a positive integer, got ${count}`);
  }
  const next = readNext(counterPath);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(formatEntryId(next + i));
  writeFileSync(counterPath, `${JSON.stringify({ next: next + count }, null, 2)}\n`, 'utf8');
  return ids;
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

  if (existsSync(paths.featuresDir)) {
    for (const file of readdirSync(paths.featuresDir)) {
      if (!file.endsWith('.md')) continue;
      const parsed = matter(readFileSync(join(paths.featuresDir, file), 'utf8'));
      if ((parsed.data as { 'entry-id'?: unknown })['entry-id'] === ref) {
        return file.slice(0, -3);
      }
    }
  }

  return ref;
}

/**
 * A `### ` (level 3) or `#### ` (level 4) markdown heading — the shape of a
 * roadmap/backlog entry heading.
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
