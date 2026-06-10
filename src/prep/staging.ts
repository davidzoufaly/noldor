import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StagingManifest } from './types.js';

/** Repo-root-relative staging dir for a batch. */
export function batchDirFor(today: string): string {
  return join('.noldor', 'prep-batch', today);
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function manifestPath(batchDir: string): string {
  return join(batchDir, 'manifest.json');
}

export function indexPath(batchDir: string): string {
  return join(batchDir, 'INDEX.md');
}

export function writeManifest(batchDir: string, m: StagingManifest): void {
  writeFileSync(manifestPath(batchDir), `${JSON.stringify(m, null, 2)}\n`, 'utf8');
}

export function readManifest(batchDir: string): StagingManifest {
  return JSON.parse(readFileSync(manifestPath(batchDir), 'utf8')) as StagingManifest;
}

/** Newest `.noldor/prep-batch/<date>` dir (lexicographic = chronological for ISO dates), or null. */
export function newestBatchDir(cwd: string): string | null {
  const root = join(cwd, '.noldor', 'prep-batch');
  if (!existsSync(root)) return null;
  const dates = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
    .sort();
  const last = dates.at(-1);
  return last ? join('.noldor', 'prep-batch', last) : null;
}

/**
 * Slugs the operator approved in INDEX.md. Convention: each feature has a `## <slug>`
 * section containing a GitHub task line `- [x] approve` (ticked). Untouched `- [ ] approve`
 * and `- [x] skip` are ignored.
 */
export function readApprovedSlugs(indexMd: string): string[] {
  const out: string[] = [];
  let current: string | null = null;
  for (const rawLine of indexMd.split('\n')) {
    const line = rawLine.trim();
    const heading = /^##\s+`?([a-z0-9-]+)`?\s*$/.exec(line);
    if (heading) {
      current = heading[1]!;
      continue;
    }
    if (current && /^- \[x\]\s+approve\b/i.test(line)) {
      out.push(current);
      current = null;
    }
  }
  return out;
}
