import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Resume token for an interrupted `pnpm release`. Written by `main()` the
 * moment the run commits to mutating files (right after the dry-run early
 * return), removed after `gh release create` succeeds. A run that dies
 * anywhere in between leaves it behind; `pnpm release --resume` drives the
 * finish ladder from these values alone — the version is never re-derived.
 */
export const ReleaseStateSchema = z
  .object({
    version: z.string().min(1),
    previousTag: z.string().min(1),
    date: z.string().min(1),
    startedAt: z.string().min(1),
  })
  .strict();
export type ReleaseState = z.infer<typeof ReleaseStateSchema>;

const FILE = '.noldor/release-state.json';

export function readReleaseState(cwd: string = process.cwd()): ReleaseState | null {
  const p = join(cwd, FILE);
  if (!existsSync(p)) return null;
  return ReleaseStateSchema.parse(JSON.parse(readFileSync(p, 'utf8')));
}

export function writeReleaseState(cwd: string, state: ReleaseState): void {
  const dir = join(cwd, '.noldor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, FILE), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/** Unlink the state file; tolerate absence (clear-after-clear is a no-op). */
export function clearReleaseState(cwd: string = process.cwd()): void {
  const p = join(cwd, FILE);
  if (existsSync(p)) {
    unlinkSync(p);
  }
}
