// Deep-analysis 2026-07 next-step 3: every prior validator was blind to FD
// link targets — `features validate` is shape-only, and staleSpecs/stalePlans
// scan working dirs, not what FDs point at. This detector stats the targets.
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';

import type { Gap } from '../sdd-report.js';

/** Link values that are deliberately not paths. */
const SENTINELS = new Set(['n/a', 'lost-pre-extraction']);

function isCheckablePath(v: unknown): v is string {
  return (
    typeof v === 'string' && v !== '' && !SENTINELS.has(v) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v)
  );
}

function collectTargets(links: Record<string, unknown>): Array<{ key: string; path: string }> {
  const out: Array<{ key: string; path: string }> = [];
  for (const key of ['code', 'tests', 'docs'] as const) {
    const arr = links[key];
    if (!Array.isArray(arr)) continue;
    for (const v of arr) if (isCheckablePath(v)) out.push({ key, path: v });
  }
  for (const key of ['spec', 'plan'] as const) {
    const v = links[key];
    if (isCheckablePath(v)) out.push({ key, path: v });
    if (Array.isArray(v))
      for (const item of v) if (isCheckablePath(item)) out.push({ key, path: item });
  }
  return out;
}

/**
 * Emit a Gap per FD frontmatter link whose target file does not exist.
 * Sentinels (`n/a`, `lost-pre-extraction`) and URLs are skipped. Advisory —
 * rides the sddGaps channel, never blocks a release.
 */
export async function detectFdLinkRot(repo: string): Promise<Gap[]> {
  const dir = join(repo, 'docs', 'features');
  if (!existsSync(dir)) return [];
  const gaps: Gap[] = [];
  for (const entry of (await readdir(dir)).toSorted()) {
    if (!entry.endsWith('.md')) continue;
    const slug = entry.slice(0, -3);
    let links: Record<string, unknown>;
    try {
      const raw = await readFile(join(dir, entry), 'utf8');
      links = (matter(raw).data as { links?: Record<string, unknown> }).links ?? {};
    } catch {
      continue; // malformed FD is `features validate`'s finding, not ours
    }
    for (const { key, path } of collectTargets(links)) {
      if (existsSync(join(repo, path))) continue;
      gaps.push({
        category: 'fd-link-rot',
        itemId: slug,
        message: `${slug}: links.${key} target missing: ${path}`,
      });
    }
  }
  return gaps;
}
