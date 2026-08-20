// @tests: ui-design-review-lane
// The one "spawn a lane's agent and decide whether its output is usable" seam.
// Every dispatch lane needs the same three judgments — timed out, non-zero exit,
// otherwise stdout — and each previously re-derived them beside its own error
// type. Returns a result rather than throwing so each lane keeps its own failure
// vocabulary (a plain Error, a typed one) without re-implementing the checks.

import { spawnAgent } from '../core/agent-runner/registry.js';
import { DEFAULT_DISPATCH_TIMEOUT_MS } from '../core/config.js';
import type { AgentRole } from '../core/agent-runner/types.js';

/**
 * Message text for a caught value of unknown type.
 *
 * A rejected promise can carry anything — a string, an object, `undefined` — so
 * `(err as Error).message` yields `undefined` exactly when a lane most needs a
 * diagnostic. Every lane failure path routes its caught value through here.
 */
export function errMessage(err: unknown): string {
  if (err instanceof Error && err.message !== '') return err.message;
  if (typeof err === 'string' && err !== '') return err;
  try {
    return `non-Error throw: ${JSON.stringify(err)}`;
  } catch {
    // A value that cannot even be serialized (circular, BigInt) still has to
    // produce SOME detail rather than throwing inside the error path.
    return `non-Error throw: ${String(err)}`;
  }
}

/** Why a dispatch produced nothing usable. */
export type LaneSpawnFailure = 'timeout' | 'dispatch-failed';

export type LaneSpawnResult =
  | { ok: true; stdout: string }
  | { ok: false; reason: LaneSpawnFailure; exitCode: number; timedOut: boolean };

export interface LaneSpawnOpts {
  role: AgentRole;
  /** Telemetry site tag, e.g. `cr.ui-review-dispatch`. */
  site: string;
  /** Wall-clock cap; {@link DEFAULT_DISPATCH_TIMEOUT_MS} when omitted. */
  timeoutMs?: number;
}

export async function spawnLanePrompt(
  prompt: string,
  opts: LaneSpawnOpts,
): Promise<LaneSpawnResult> {
  const r = await spawnAgent(prompt, {
    role: opts.role,
    timeoutMs: opts.timeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS,
    site: opts.site,
  });
  if (r.timedOut) return { ok: false, reason: 'timeout', exitCode: r.exitCode, timedOut: true };
  if (r.exitCode !== 0)
    return { ok: false, reason: 'dispatch-failed', exitCode: r.exitCode, timedOut: false };
  return { ok: true, stdout: r.stdout };
}

/**
 * A lane's dispatcher seam: the swappable "prompt in, agent prose out" function
 * plus its test-injection point.
 *
 * Every dispatch lane owned a module-level `let dispatcher`, a `setX` for tests,
 * and the same spawn-then-check body differing only in role, telemetry site, and
 * which error type the failure becomes. Only the last of those is real variation,
 * so it is the callback; the rest is this factory.
 */
export function createDispatcherSeam<I extends { timeoutMs?: number }>(
  build: (input: I) => string,
  opts: {
    role: AgentRole;
    site: string;
    /** Turn an unusable dispatch into this lane's own failure. Must throw. */
    onFailure: (failure: Extract<LaneSpawnResult, { ok: false }>) => never;
  },
): {
  dispatch: (input: I) => Promise<string>;
  setDispatcher: (impl: (input: I) => Promise<string>) => void;
} {
  let impl = async (input: I): Promise<string> => {
    const r = await spawnLanePrompt(build(input), {
      role: opts.role,
      site: opts.site,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    });
    if (r.ok) return r.stdout;
    opts.onFailure(r);
  };
  return {
    dispatch: (input) => impl(input),
    setDispatcher: (next) => {
      impl = next;
    },
  };
}
