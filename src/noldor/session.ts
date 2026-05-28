import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const PATHS = [
  'micro-chore',
  'fast-track',
  'specs-only-new',
  'specs-only-attach',
  'full-new',
  'full-attach',
  'release-sweep',
  'release-automation',
] as const;
export type Path = (typeof PATHS)[number];

const SPECS_ONLY_PATHS: ReadonlySet<Path> = new Set(['specs-only-new', 'specs-only-attach']);

export const SessionMarkerSchema = z
  .object({
    path: z.enum(PATHS),
    slug: z.string().min(1).optional(),
    parent: z.string().min(1).optional(),
    enhancement: z.string().min(1).optional(),
    startedAt: z.string().min(1),
    autonomous: z.boolean().optional(),
    markerVersion: z.literal(2).optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (SPECS_ONLY_PATHS.has(m.path) && m.markerVersion !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `Session marker for path '${m.path}' must declare markerVersion: 2. ` +
          `Pre-flip markers without the field have stale semantics — re-pick path via /gate, ` +
          `or run 'pnpm noldor:bump-session-marker' from the worktree root.`,
        path: ['markerVersion'],
      });
    }
  });
export type SessionMarker = z.infer<typeof SessionMarkerSchema>;

const FILE = '.noldor/session.json';

export function readSession(cwd: string = process.cwd()): SessionMarker | null {
  const p = join(cwd, FILE);
  if (!existsSync(p)) return null;
  return SessionMarkerSchema.parse(JSON.parse(readFileSync(p, 'utf8')));
}

export function writeSession(cwd: string, m: SessionMarker): void {
  const dir = join(cwd, '.noldor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, FILE), JSON.stringify(m, null, 2) + '\n', 'utf8');
}

/**
 * Deletes the session marker file so subsequent calls to {@link readSession}
 * return null. Preferred over truncating to empty string because `existsSync`
 * then returns false, which is unambiguous.
 */
export function clearSession(cwd: string = process.cwd()): void {
  const p = join(cwd, FILE);
  if (existsSync(p)) {
    unlinkSync(p);
  }
}

export function setAutonomous(cwd: string = process.cwd()): void {
  const m = readSession(cwd);
  if (m === null) {
    throw new Error(`setAutonomous: no session marker at ${cwd}/${FILE}; run /gate first.`);
  }
  writeSession(cwd, { ...m, autonomous: true });
}
