import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { argv, exit, stdout, cwd } from 'node:process';
import { fileURLToPath } from 'node:url';

const FILE = '.noldor/session.json';

/**
 * Hand-fixes a stale `.noldor/session.json` by adding `markerVersion: 2`.
 *
 * Used to migrate a pre-flip session marker (written by an older `/gate`
 * before `specs-only-*` paths gained the `markerVersion` requirement) in
 * a known-state worktree. Idempotent — running twice is a no-op.
 */
export function bumpSessionMarker(workdir: string): { changed: boolean; reason: string } {
  const p = join(workdir, FILE);
  if (!existsSync(p)) return { changed: false, reason: `no marker at ${p}` };
  const m = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  if (m.markerVersion === 2) return { changed: false, reason: 'already markerVersion: 2' };
  m.markerVersion = 2;
  writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8');
  return { changed: true, reason: `bumped markerVersion to 2 at ${p}` };
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  const r = bumpSessionMarker(cwd());
  stdout.write(`${r.reason}\n`);
  exit(0);
}
