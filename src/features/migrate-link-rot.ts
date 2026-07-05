// `noldor features migrate-link-rot [--dry-run]` — one-shot link-rot migration
// over docs/features/*.md (deep-analysis 2026-07 next-step 3).
//
// Three rewrites, in order:
//  1. Stale `scripts/…` paths (pre-reorg layout) anywhere in the file → the live
//     `src/…` twin: direct prefix swap when `src/<rest>` exists, else a unique
//     basename match under src/. A path that still exists under scripts/ is live
//     and left alone; a dead path with no (unique) twin is left for the
//     fd-link-rot garden detector to surface.
//  2. Frontmatter `links.spec` / `links.plan` pointing at a missing file whose
//     basename exists under the specs/plans `archive/` dir → re-pointed there.
//  3. Still-missing spec/plan links → the literal sentinel `lost-pre-extraction`
//     (Charuy-era artifacts that never migrated; the detector skips the sentinel).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { LOST_SENTINEL } from '../core/feature-schema.js';

export { LOST_SENTINEL };

const SCRIPTS_PATH_RE = /scripts\/[A-Za-z0-9_\-./]+\.[a-z]+/g;

/** Recursively index src/** files by basename → repo-relative paths. */
export function indexSrcByBasename(repo: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        const list = out.get(entry) ?? [];
        list.push(full.slice(repo.length + 1));
        out.set(entry, list);
      }
    }
  };
  walk(join(repo, 'src'));
  return out;
}

export interface RewriteStats {
  directSwaps: number;
  basenameSwaps: number;
  unresolved: string[];
}

/**
 * Rewrite dead `scripts/…` references in `raw` to their live `src/…` twins.
 * Pure text transform — applies to frontmatter and body alike (the audit found
 * rot in both).
 */
export function rewriteScriptsPaths(
  raw: string,
  repo: string,
  byBasename: Map<string, string[]>,
): { out: string; stats: RewriteStats } {
  const stats: RewriteStats = { directSwaps: 0, basenameSwaps: 0, unresolved: [] };
  const out = raw.replace(SCRIPTS_PATH_RE, (p) => {
    if (existsSync(join(repo, p))) return p; // still-live scripts/ file
    const direct = `src/${p.slice('scripts/'.length)}`;
    if (existsSync(join(repo, direct))) {
      stats.directSwaps++;
      return direct;
    }
    const candidates = byBasename.get(basename(p)) ?? [];
    if (candidates.length === 1) {
      stats.basenameSwaps++;
      return candidates[0];
    }
    if (!stats.unresolved.includes(p)) stats.unresolved.push(p);
    return p;
  });
  return { out, stats };
}

/**
 * Re-point a dead spec/plan link to its `archive/` twin, else the lost
 * sentinel. Text transform (no YAML round-trip) so the migration never
 * reflows untouched frontmatter. Archive repoints apply file-wide (body
 * mentions heal too); the lost sentinel replaces the path ONLY inside the
 * frontmatter block — body prose keeps the historical path.
 */
export function fixArtifactLink(
  raw: string,
  linkPath: string,
  repo: string,
): { out: string; action: 'archive' | 'lost' | 'none' } {
  if (linkPath === LOST_SENTINEL || existsSync(join(repo, linkPath))) {
    return { out: raw, action: 'none' };
  }
  const base = basename(linkPath);
  for (const dir of ['docs/superpowers/specs/archive', 'docs/superpowers/plans/archive']) {
    const cand = `${dir}/${base}`;
    if (existsSync(join(repo, cand))) {
      return { out: raw.split(linkPath).join(cand), action: 'archive' };
    }
  }
  const fmMatch = /^---\n[\s\S]*?\n---\n/.exec(raw);
  if (!fmMatch) return { out: raw, action: 'none' };
  const fixedFm = fmMatch[0].split(linkPath).join(LOST_SENTINEL);
  if (fixedFm === fmMatch[0]) return { out: raw, action: 'none' };
  return { out: fixedFm + raw.slice(fmMatch[0].length), action: 'lost' };
}

/**
 * Extract every spec/plan artifact path from the frontmatter block. A plain
 * token scan (not key-anchored) so plain scalars, `>-` folded scalars, and
 * list items all match; `fixArtifactLink` is existence-guarded, so
 * over-collection is harmless.
 */
export function extractArtifactLinks(raw: string): string[] {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw)?.[1];
  if (!fm) return [];
  return [
    ...new Set([...fm.matchAll(/docs\/superpowers\/(?:specs|plans)\/\S+\.md/g)].map((m) => m[0])),
  ];
}

export interface MigrateResult {
  file: string;
  changed: boolean;
  directSwaps: number;
  basenameSwaps: number;
  archived: number;
  lost: number;
  unresolved: string[];
}

/** Run the full migration over one FD file's raw contents. */
export function migrateOne(
  file: string,
  raw: string,
  repo: string,
  byBasename: Map<string, string[]>,
): { out: string; result: MigrateResult } {
  const { out: swapped, stats } = rewriteScriptsPaths(raw, repo, byBasename);
  let current = swapped;
  let archived = 0;
  let lost = 0;
  for (const link of extractArtifactLinks(current)) {
    const r = fixArtifactLink(current, link, repo);
    current = r.out;
    if (r.action === 'archive') archived++;
    if (r.action === 'lost') lost++;
  }
  return {
    out: current,
    result: {
      file,
      changed: current !== raw,
      directSwaps: stats.directSwaps,
      basenameSwaps: stats.basenameSwaps,
      archived,
      lost,
      unresolved: stats.unresolved,
    },
  };
}

function main(): void {
  const repo = process.cwd();
  const dryRun = process.argv.includes('--dry-run');
  const dir = join(repo, 'docs', 'features');
  const byBasename = indexSrcByBasename(repo);
  const totals = { files: 0, directSwaps: 0, basenameSwaps: 0, archived: 0, lost: 0 };
  const unresolved = new Set<string>();
  for (const entry of readdirSync(dir).toSorted()) {
    if (!entry.endsWith('.md')) continue;
    const path = join(dir, entry);
    const raw = readFileSync(path, 'utf8');
    const { out, result } = migrateOne(entry, raw, repo, byBasename);
    if (!result.changed) continue;
    totals.files++;
    totals.directSwaps += result.directSwaps;
    totals.basenameSwaps += result.basenameSwaps;
    totals.archived += result.archived;
    totals.lost += result.lost;
    for (const u of result.unresolved) unresolved.add(u);
    if (!dryRun) writeFileSync(path, out, 'utf8');
    process.stdout.write(
      `${dryRun ? '[dry-run] ' : ''}${entry}: ${String(result.directSwaps + result.basenameSwaps)} path swap(s), ${String(result.archived)} archive repoint(s), ${String(result.lost)} lost sentinel(s)\n`,
    );
  }
  process.stdout.write(
    `migrate-link-rot: ${String(totals.files)} file(s) rewritten — ${String(totals.directSwaps)} direct + ${String(totals.basenameSwaps)} basename swaps, ${String(totals.archived)} archive repoints, ${String(totals.lost)} lost sentinels\n`,
  );
  if (unresolved.size > 0) {
    process.stdout.write(
      `  unresolved (left in place for the fd-link-rot detector): ${[...unresolved].join(', ')}\n`,
    );
  }
}

const invokedDirect = /[\\/]migrate-link-rot\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
