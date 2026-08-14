import { fileURLToPath } from 'node:url';
import { spawnAgent } from '../core/agent-runner/registry.js';

/**
 * Contract for running one codex review.
 *
 * `stdin` is the only input: the argv is owned by the agent registry's codex runner, not by
 * this caller. That is deliberate — the previous shape took `{ cmd, args, stdin }`, which let
 * the version probe borrow it for a `--version` call and would have let a registry-backed
 * adapter silently ignore `args` and spawn a full review instead.
 *
 * `stderr` is REQUIRED, not optional. The bug the original module existed to fix was a stream
 * nobody read; an optional field would let a stub omit it and leave failure attribution
 * vacuously green. `timedOut` is required for the same reason one level up: without it a cap
 * expiry is indistinguishable from an OOM or an operator kill, since both arrive as a
 * non-zero exit with a signal note.
 */
export type Spawn = (args: {
  stdin: string;
}) => Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }>;

/** Output schema handed to codex; resolved here because `Spawn` no longer carries argv. */
export const CR_RECORD_SCHEMA_PATH = fileURLToPath(
  new URL('./cr-record.schema.json', import.meta.url),
);

export interface CodexSpawnOpts {
  /** Wall-clock cap. Omitted on the interactive path, where the operator's Ctrl-C supervises. */
  timeoutMs?: number;
  /**
   * Interactive callers spawn in the parent's process group so Ctrl-C reaches codex. The
   * unattended lane leaves this false and gets `detached` plus the registry's group-kill.
   */
  foreground?: boolean;
  cwd?: string;
}

/**
 * Back the codex review spawn with the shared agent registry.
 *
 * The registry already builds this exact argv (`buildCodexArgv` with `needsWrite`/`schemaPath`),
 * already spawns detached, and already group-kills on timeout — the three things a hand-rolled
 * spawn here would have to reimplement. `runner: 'codex'` is pinned rather than resolved from
 * the role map so a consumer that remapped `reviewer` to another runner cannot redirect the
 * codex lane; `role` is carried only for agent-events attribution.
 */
export function makeCodexSpawn(opts: CodexSpawnOpts = {}): Spawn {
  return async ({ stdin }) => {
    const r = await spawnAgent(stdin, {
      role: 'reviewer',
      runner: 'codex',
      schemaPath: CR_RECORD_SCHEMA_PATH,
      needsWrite: false, // review spawns never write: read-only sandbox
      stderr: 'capture',
      site: 'cr.codex',
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts.foreground ? { foreground: true } : {}),
      ...(opts.timeoutMs !== undefined && !opts.foreground ? { timeoutMs: opts.timeoutMs } : {}),
    });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, timedOut: r.timedOut };
  };
}
