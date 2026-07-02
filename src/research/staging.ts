import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResearchManifest } from './types.js';

export interface BatchDir {
  /** Repo-root-relative, e.g. `.noldor/research/2026-07-01-142233`. */
  readonly rel: string;
  readonly abs: string;
}

/** `2026-07-01T14:22:33.456Z` → `2026-07-01-142233`. */
function stampFor(now: Date): string {
  return now.toISOString().slice(0, 19).replace('T', '-').replaceAll(':', '');
}

/**
 * Atomically claim a fresh batch dir. Non-recursive `mkdirSync` + EEXIST retry
 * with a `-2`, `-3`… suffix — no exists-check (check-then-act races for the
 * two-batches-same-second case this exists to solve).
 */
export function createBatchDir(cwd: string, now: Date): BatchDir {
  const root = join(cwd, '.noldor', 'research');
  mkdirSync(root, { recursive: true });
  const stamp = stampFor(now);
  for (let attempt = 1; ; attempt++) {
    const name = attempt === 1 ? stamp : `${stamp}-${attempt}`;
    const abs = join(root, name);
    try {
      mkdirSync(abs);
      return { rel: join('.noldor', 'research', name), abs };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 100) throw err;
    }
  }
}

export function findingsFileName(id: string): string {
  return `${id}.findings.md`;
}

export function writeManifest(batchAbs: string, manifest: ResearchManifest): void {
  writeFileSync(join(batchAbs, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function escapeCell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** Deterministic findings table — the one artifact a driving session must read. */
export function renderIndex(manifest: ResearchManifest): string {
  const okCount = manifest.results.filter((r) => r.ok).length;
  const lines = [
    '# Research Fanout Index',
    '',
    `Started: ${manifest.startedAt} — ${okCount}/${manifest.results.length} ok`,
    '',
    '| id | status | confidence | headline | spawn | findings |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of manifest.results) {
    lines.push(
      `| ${escapeCell(r.id)} | ${r.meta.status} | ${r.meta.confidence} | ${escapeCell(r.meta.headline)} | ${escapeCell(r.spawnStatus)} | [${r.findingsFile}](${r.findingsFile}) |`,
    );
  }
  lines.push(
    '',
    'Exit code 0 = every agent ran and parsed — NOT that questions were answered; read the status column.',
    '',
  );
  return lines.join('\n');
}
