import { readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicWriteFileSync } from './atomic-write.js';

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
    injectedRules: z.array(z.string().min(1)).optional(),
    /** Spec-time UI-design verdict (ui-predicate, spec U2). Written by the design step; audit + ship-time reconciliation input. */
    uiVerdict: z.enum(['required', 'skip']).optional(),
    /** The candidate paths that matched uiPaths when the verdict was computed. */
    uiVerdictPaths: z.array(z.string().min(1)).optional(),
    /** Operator waiver for a required session with no editor (spec U4) — machine-readable, distinguishes waived from missing. */
    uiWaiver: z
      .object({ reason: z.string().min(1), at: z.string().min(1) })
      .strict()
      .optional(),
    markerVersion: z.literal(2).optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (SPECS_ONLY_PATHS.has(m.path) && m.markerVersion !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `Session marker for path '${m.path}' must declare markerVersion: 2. ` +
          `Pre-flip markers without the field have stale semantics — re-pick path via /noldor-gate, ` +
          `or run 'pnpm noldor:bump-session-marker' from the worktree root.`,
        path: ['markerVersion'],
      });
    }
  });
export type SessionMarker = z.infer<typeof SessionMarkerSchema>;

/**
 * Paths whose session marker can go stale. Limited to the paths that own an
 * allowlist branch in `noldor-pre-commit.ts` (`micro-chore`, `release-sweep`):
 * these are the only paths where a session that has outlived its intent
 * *silently* rejects a commit against a cold allowlist, and both live in the
 * main repo with no worktree to clear them. Every other path has no allowlist
 * branch, so a lingering session there never silently blocks — nothing to
 * expire. See the session-marker-auto-expire spec.
 */
const STALE_ELIGIBLE_PATHS: ReadonlySet<Path> = new Set(['micro-chore', 'release-sweep']);

/**
 * True when a stale-eligible session's {@link SessionMarker.startedAt} is older
 * than `ttlHours`. Pure — the caller injects `nowMs` and `ttlHours` (no clock,
 * no config read here). Non-eligible paths are never stale. An unparseable
 * `startedAt` is treated as fresh: a garbage timestamp must never block a
 * commit. Strict `>` so a session exactly at the boundary is still fresh.
 */
export function isSessionStale(session: SessionMarker, nowMs: number, ttlHours: number): boolean {
  if (!STALE_ELIGIBLE_PATHS.has(session.path)) return false;
  const startedMs = Date.parse(session.startedAt);
  if (Number.isNaN(startedMs)) return false;
  return nowMs - startedMs > ttlHours * 3_600_000;
}

const FILE = '.noldor/session.json';

/** Absolute path of the session marker under `cwd`. */
export function sessionMarkerPath(cwd: string): string {
  return join(cwd, FILE);
}

/**
 * True when a session marker file is present under `cwd`. Deliberately does NOT
 * parse it — callers use this to explain a failure ("no marker") without risking
 * a throw on a torn/corrupt marker, which {@link readSession} would raise.
 */
export function sessionMarkerExists(cwd: string): boolean {
  return existsSync(sessionMarkerPath(cwd));
}

export function readSession(cwd: string = process.cwd()): SessionMarker | null {
  const p = sessionMarkerPath(cwd);
  if (!existsSync(p)) return null;
  return SessionMarkerSchema.parse(JSON.parse(readFileSync(p, 'utf8')));
}

export function writeSession(cwd: string, m: SessionMarker): void {
  const dir = join(cwd, '.noldor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteFileSync(join(cwd, FILE), JSON.stringify(m, null, 2) + '\n');
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

/**
 * Rewrites {@link SessionMarker.startedAt} to `nowMs`, preserving every other
 * field. No-op when no marker exists — refresh is best-effort and must never
 * fail a caller that runs on every commit. Pure w.r.t. the clock: the caller
 * injects `nowMs`, mirroring {@link isSessionStale}. Used by the pre-commit
 * hook to make the `release-sweep` TTL measure inactivity rather than total
 * session age, so a long sweep can't go stale mid-run between green commits.
 */
export function touchSession(cwd: string, nowMs: number): void {
  const m = readSession(cwd);
  if (m === null) return;
  writeSession(cwd, { ...m, startedAt: new Date(nowMs).toISOString() });
}

/**
 * Union `ids` into {@link SessionMarker.injectedRules} — the record of which
 * cascade rules an author was actually shown this session.
 *
 * Best-effort by design, following {@link touchSession} rather than
 * {@link setAutonomous}:
 * - **No marker** → no-op. `rules brief` is useful outside a gate session (an
 *   operator reading the rules for a file), and a throw would make it unusable
 *   there.
 * - **Unreadable or invalid marker** → swallowed; the caller is told via
 *   `onError` and its own output still succeeds. `readSession` throws on a torn
 *   file and its `superRefine` throws on a `specs-only-*` marker missing
 *   `markerVersion: 2` — exactly the degraded session where seeing the rules
 *   matters most. This is not the fail-open the state-file hardening targets:
 *   nothing downstream reads `injectedRules` to permit anything, so refusing to
 *   print rules would harm the author and protect nobody.
 *
 * Union, not overwrite — a session briefs once per file and the field should
 * accumulate. The read-union-write is not atomic, so two concurrent briefs can
 * lose an id; accepted because sessions are per-worktree and single-author,
 * `atomicWriteFileSync` still rules out a torn file, and an exposure record that
 * understates is not misleading.
 */
export function stampInjectedRules(
  cwd: string,
  ids: readonly string[],
  onError?: (message: string) => void,
): void {
  if (ids.length === 0) return;
  let m: SessionMarker | null;
  try {
    m = readSession(cwd);
  } catch (e) {
    onError?.(
      `session marker at ${sessionMarkerPath(cwd)} is unstampable (${e instanceof Error ? e.message : String(e)})`,
    );
    return;
  }
  if (m === null) return;
  writeSession(cwd, {
    ...m,
    injectedRules: [...new Set([...(m.injectedRules ?? []), ...ids])].toSorted(),
  });
}

export function setAutonomous(cwd: string = process.cwd()): void {
  const m = readSession(cwd);
  if (m === null) {
    throw new Error(`setAutonomous: no session marker at ${cwd}/${FILE}; run /noldor-gate first.`);
  }
  writeSession(cwd, { ...m, autonomous: true });
}
