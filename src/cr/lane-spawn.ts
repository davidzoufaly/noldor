// @tests: ui-design-review-lane
// The one "spawn a lane's agent and decide whether its output is usable" seam.
// Every dispatch lane needs the same three judgments — timed out, non-zero exit,
// otherwise stdout — and each previously re-derived them beside its own error
// type. Returns a result rather than throwing so each lane keeps its own failure
// vocabulary (a plain Error, a typed one) without re-implementing the checks.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CAPABILITIES } from '../core/agent-runner/capabilities.js';
import { loadAgentsConfig, resolveRunner, spawnAgent } from '../core/agent-runner/registry.js';
import type { AgentResult, AgentRole, SpawnAgentOpts } from '../core/agent-runner/types.js';
import { DEFAULT_DISPATCH_TIMEOUT_MS } from '../core/config.js';
import { laneAnswerDebugPath, laneAnswerPath } from './filename.js';
import {
  keepRaw,
  readLaneAnswer,
  type AnswerLocation,
  type LaneAnswer,
  type LaneAnswerContract,
  type ReadResult,
  type RepairContext,
} from './lane-answer.js';
import { answerInstruction } from './lanes/prompt-parts.js';

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

/** Why an answer dispatch produced nothing usable, with the detail a non-exit failure carries. */
export interface LaneDispatchFailure {
  reason: LaneSpawnFailure;
  exitCode: number;
  timedOut: boolean;
  /** Set when the failure happened outside the child, e.g. creating the answers directory. */
  detail?: string;
}

type LaneSpawnFn = (prompt: string, opts: SpawnAgentOpts) => Promise<AgentResult>;
const defaultLaneSpawn: LaneSpawnFn = (prompt, opts) => spawnAgent(prompt, opts);
let laneSpawn: LaneSpawnFn = defaultLaneSpawn;

/** Test seam — production code never calls this. `undefined` restores the real spawn. */
export function setLaneSpawn(impl: LaneSpawnFn | undefined): void {
  laneSpawn = impl ?? defaultLaneSpawn;
}

/** A child's answer as a test double hands it back: the answer file's text, or null for none. */
export type ChildAnswer = string | null;

/**
 * Read one dispatch's answer file, then settle it as the lane's latest debug copy, so no
 * per-dispatch file outlives its dispatch. An absent file means the child wrote nothing
 * (`null`). A failed rename is reported and tolerated: the copy is for a human reading a red
 * round, and failing a dispatch over it would trade a verdict for a log line.
 */
async function takeAnswerFile(
  path: string,
  at: AnswerLocation,
  lane: string,
): Promise<ChildAnswer> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const debug = laneAnswerDebugPath(at.repoRoot, at.slug, at.kind, lane);
  if (debug.ok) {
    await rename(path, debug.path).catch((err: unknown) => {
      process.stderr.write(
        `cr: could not keep the ${lane} answer copy: ${(err as Error).message}\n`,
      );
    });
  }
  return text;
}

/**
 * A lane's dispatcher over an answer file (Q-0250): lane input in, validated answer out,
 * after at most one repair round. Nothing the child prints is parsed.
 *
 * The runner is resolved ONCE per dispatch and pinned, runner and model, because both the
 * prompt (who writes the file) and the spawn options (`lastMessagePath` for a `cli-writes`
 * runner) depend on it; letting `spawnAgent` resolve again could disagree with the prompt.
 *
 * `setDispatcher` replaces only the child: an injected impl returns what the child would have
 * written (or `null` for no file) and gets the repair context on its second call, while
 * reading, placeholder normalization, validation and the repair round still run.
 */
export function createAnswerSeam<I extends { timeoutMs?: number }, T>(
  build: (input: I) => string,
  opts: {
    role: AgentRole;
    /** Telemetry site tag, e.g. `cr.verify-dispatch`. */
    site: string;
    contract: LaneAnswerContract<T>;
    /** Turn an unusable dispatch into this lane's own failure. Must throw. */
    onFailure: (failure: LaneDispatchFailure) => never;
  },
): {
  dispatch: (input: I, at: AnswerLocation) => Promise<LaneAnswer<T>>;
  setDispatcher: (
    impl: ((input: I, repair?: RepairContext) => Promise<ChildAnswer>) | undefined,
  ) => void;
} {
  let injected: ((input: I, repair?: RepairContext) => Promise<ChildAnswer>) | undefined;

  const runChild = async (
    input: I,
    repair: RepairContext | undefined,
    at: AnswerLocation,
  ): Promise<{ answerText: ChildAnswer; stdout: string }> => {
    if (injected !== undefined) {
      // One argument on the first call, so a test double's call record matches the lane input.
      const answerText = await (repair === undefined ? injected(input) : injected(input, repair));
      return { answerText, stdout: '' };
    }
    const resolved = resolveRunner(opts.role, loadAgentsConfig(at.repoRoot));
    const channel = CAPABILITIES[resolved.runner].answerFile;
    const built = laneAnswerPath(at.repoRoot, at.slug, at.kind, opts.contract.lane, randomUUID());
    if (!built.ok) {
      // The slug is branded, so only repository tampering inside `.noldor/cr/answers` reaches
      // this arm — the same posture `openLane` takes for a sink path.
      throw new Error(`cannot place the ${opts.contract.lane} answer file: ${built.error.kind}`);
    }
    try {
      await mkdir(dirname(built.path), { recursive: true });
    } catch (err) {
      opts.onFailure({
        reason: 'dispatch-failed',
        exitCode: -1,
        timedOut: false,
        detail: `cannot create ${dirname(built.path)}: ${(err as Error).message}`,
      });
    }
    const body = repair === undefined ? build(input) : opts.contract.repairPrompt(repair);
    const r = await laneSpawn(
      `${body}\n\n${answerInstruction(channel, built.path, opts.contract.shape)}`,
      {
        role: opts.role,
        runner: resolved.runner,
        ...(resolved.model !== undefined ? { model: resolved.model } : {}),
        cwd: at.repoRoot,
        timeoutMs: input.timeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS,
        site: opts.site,
        ...(channel === 'cli-writes' ? { lastMessagePath: built.path } : {}),
      },
    );
    // Settled before the failure checks, so a timed-out or crashed child leaves no orphan.
    const answerText = await takeAnswerFile(built.path, at, opts.contract.lane);
    if (r.timedOut) opts.onFailure({ reason: 'timeout', exitCode: r.exitCode, timedOut: true });
    if (r.exitCode !== 0) {
      opts.onFailure({ reason: 'dispatch-failed', exitCode: r.exitCode, timedOut: false });
    }
    return { answerText, stdout: r.stdout };
  };

  const dispatch = async (input: I, at: AnswerLocation): Promise<LaneAnswer<T>> => {
    const first = await runChild(input, undefined, at);
    const read1 = readLaneAnswer(first.answerText, opts.contract);
    if (read1.ok) return { ok: true, answer: read1.answer, notes: [] };
    if ((first.answerText ?? '').trim() === '' && first.stdout.trim() === '') {
      // The child said nothing at all, so there is nothing to transcribe. A repair round
      // handed only "(none captured)" could manufacture a verdict, such as a verifier's
      // `cannot-verify`, which never blocks. It fails the way an unrepaired answer does.
      return {
        ok: false,
        detail: read1.error,
        notes: ['no repair round — the child produced no answer and no output'],
      };
    }
    const kept = [
      ...(first.answerText !== null && first.answerText.trim() !== ''
        ? [`rejected answer (kept verbatim): ${keepRaw(first.answerText)}`]
        : []),
      ...(first.stdout.trim() !== ''
        ? [`child output (kept verbatim): ${keepRaw(first.stdout)}`]
        : []),
    ];
    let read2: ReadResult<T>;
    try {
      const second = await runChild(
        input,
        { stdout: first.stdout, rejected: first.answerText, error: read1.error },
        at,
      );
      read2 = readLaneAnswer(second.answerText, opts.contract);
    } catch (err) {
      // A failed repair is not a new failure class: the round falls through to the same
      // no-trustworthy-answer outcome an unrepaired one gets, with the reason kept.
      read2 = { ok: false, error: `the repair dispatch failed: ${(err as Error).message}` };
    }
    if (read2.ok) {
      return {
        ok: true,
        answer: read2.answer,
        notes: [
          `answer recovered by a repair round — the first answer was rejected: ${read1.error}`,
        ],
      };
    }
    return {
      ok: false,
      detail: read1.error,
      notes: [`repair round ran — ${read2.error}`, ...kept],
    };
  };

  return {
    dispatch,
    setDispatcher: (impl) => {
      injected = impl;
    },
  };
}
