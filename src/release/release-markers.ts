import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import matter from 'gray-matter';

/** Inputs to {@link fillMarkers}. */
export interface FillOptions {
  newVersion: string;
  hasChangelogBlock: boolean;
}

/**
 * Fill release markers on a feature MD's frontmatter:
 *
 * - `phase=done` && no `introduced` → set `introduced = newVersion` (first-done)
 * - `phase=in-progress` && `introduced` set && `hasChangelogBlock` → flip
 *   `phase=done` + set `updated = newVersion` (enhancement-cycle auto-restore;
 *   completes the asymmetric phase-revert state machine where `/gate` writes
 *   the revert commit on the worktree branch and `fillMarkers` writes the
 *   restore at release time)
 * - `phase=done` && `introduced` set && `introduced !== newVersion` &&
 *   `hasChangelogBlock` → set `updated = newVersion` (maintenance update; no
 *   attach revert preceded). The `introduced !== newVersion` guard prevents
 *   release-replay from writing `updated` when `introduced` already equals
 *   `newVersion`.
 * - Otherwise no-op (fresh in-progress, done without block, release replay,
 *   proposed).
 *
 * Pure function. Caller decides which files received a changelog block.
 * Branches are mutually exclusive over (phase, introduced) × hasChangelogBlock.
 *
 * @param md - Raw feature MD file contents
 * @param opts - Release context (new version + changelog-block flag)
 * @returns The (possibly updated) MD contents
 */
export function fillMarkers(md: string, opts: FillOptions): string {
  const parsed = matter(md);
  const data = parsed.data as Record<string, unknown>;
  let changed = false;

  if (data.phase === 'done' && data.introduced === undefined) {
    // First-done. Set introduced. No phase flip (already done).
    data.introduced = opts.newVersion;
    changed = true;
  } else if (
    data.phase === 'in-progress' &&
    data.introduced !== undefined &&
    opts.hasChangelogBlock
  ) {
    // Enhancement cycle on a previously-shipped FD. Auto-restore to done +
    // set updated. The `### <X> (in-progress)` block was already rendered by
    // step 3 — its heading suffix is frozen as the historical signal.
    data.phase = 'done';
    data.updated = opts.newVersion;
    changed = true;
  } else if (
    data.phase === 'done' &&
    data.introduced !== undefined &&
    data.introduced !== opts.newVersion &&
    opts.hasChangelogBlock
  ) {
    // Maintenance update on done FD that wasn't reverted (direct edit without
    // attach session). Set updated; phase already done.
    data.updated = opts.newVersion;
    changed = true;
  }
  // else: phase=in-progress + introduced=undefined → fresh in-progress FD,
  //       OR done FD without changelog block,
  //       OR release replay (introduced === newVersion) → no markers set.

  if (!changed) return md;
  return matter.stringify(parsed.content.replace(/^\n/, ''), data);
}

/**
 * Walk `docs/features/`, fill markers per the rules in {@link fillMarkers},
 * and write modified files back in place.
 *
 * @param newVersion - Version being released (without the `v` prefix)
 * @param changelogSlugs - Set of feature slugs that received a `### v<x.y.z>` block
 * @returns Paths of feature MDs that were rewritten
 */
export async function fillAllMarkers(
  newVersion: string,
  changelogSlugs: Set<string>,
): Promise<string[]> {
  const dir = 'docs/features';
  const entries = await readdir(dir, { withFileTypes: true });
  const touched: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    const slug = entry.name.replace(/\.md$/, '');
    const path = join(dir, entry.name);
    const raw = await readFile(path, 'utf8');
    const out = fillMarkers(raw, {
      hasChangelogBlock: changelogSlugs.has(slug),
      newVersion,
    });
    if (out !== raw) {
      await writeFile(path, out, 'utf8');
      touched.push(path);
    }
  }

  return touched;
}

async function main(): Promise<void> {
  const newVersion = process.env.NEW_VERSION;
  const changelogSlugsEnv = process.env.CHANGELOG_SLUGS;
  if (!newVersion) {
    console.error('NEW_VERSION env var required.');
    process.exitCode = 1;
    return;
  }
  const changelogSlugs = new Set(
    changelogSlugsEnv
      ? changelogSlugsEnv
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  );
  const touched = await fillAllMarkers(newVersion, changelogSlugs);
  console.log(`Filled markers on ${touched.length} feature MD(s).`);
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('release-markers');
if (invokedDirect) {
  void main();
}
