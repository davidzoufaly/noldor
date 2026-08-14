import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendAgentEvent } from '../agent-events.js';
import { createBoundedCapture } from './bounded-capture.js';
import { CAPABILITIES } from './capabilities.js';
import { USAGE_ADAPTERS } from './usage/index.js';
import { CLAUDE_BIN, buildClaudeArgv } from './runners/claude.js';
import { CODEX_BIN, buildCodexArgv } from './runners/codex.js';
import { OPENCODE_BIN, buildOpencodeArgv } from './runners/opencode.js';
import { parseOpencodeEvents } from './opencode-events.js';
import { STUB_BIN, buildStubArgv } from './runners/stub.js';
import {
  agentsConfigSchema,
  type AgentResult,
  type AgentRole,
  type AgentsConfig,
  type ResolvedRunner,
  type SpawnAgentOpts,
} from './types.js';

/**
 * Read the optional top-level `agents:` block of `.noldor/config.json`.
 * Missing file or absent block → schema defaults (claude everywhere).
 * A *malformed* block throws — a typo'd runner must be loud, not silently
 * fall back to claude.
 */
export function loadAgentsConfig(cwd: string = process.cwd()): AgentsConfig {
  let raw: string;
  try {
    raw = readFileSync(join(cwd, '.noldor', 'config.json'), 'utf8');
  } catch {
    return agentsConfigSchema.parse({});
  }
  const parsed = JSON.parse(raw) as { agents?: unknown };
  return agentsConfigSchema.parse(parsed.agents ?? {});
}

/** Role → runner+model. Pinning happens above this (spawnAgent): `opts.runner ?? resolveRunner(...)`. */
export function resolveRunner(role: AgentRole, cfg: AgentsConfig): ResolvedRunner {
  const rc = cfg.roles[role];
  if (rc) return rc.model ? { runner: rc.runner, model: rc.model } : { runner: rc.runner };
  return { runner: cfg.default };
}

interface SpawnPlan {
  bin: string;
  argv: string[];
  promptVia: 'argv' | 'stdin';
}

/**
 * True when this opencode spawn's stdout will be accumulated + read
 * programmatically — i.e. NOT tee/logSink (chunks forwarded for display) and
 * NOT stdio:'inherit' (streamed to the terminal). Only these spawns opt into
 * `--format json` and get NDJSON→prose parsing at the return boundary; every
 * other opencode spawn keeps default formatted output (no display regression).
 */
function opencodeWantsJson(resolved: ResolvedRunner, opts: SpawnAgentOpts): boolean {
  return resolved.runner === 'opencode' && opts.logSink === undefined && opts.stdio !== 'inherit';
}

function planSpawn(resolved: ResolvedRunner, prompt: string, opts: SpawnAgentOpts): SpawnPlan {
  switch (resolved.runner) {
    case 'claude':
      return {
        bin: CLAUDE_BIN,
        argv: buildClaudeArgv(prompt, { model: resolved.model }),
        promptVia: 'argv',
      };
    case 'codex':
      return {
        bin: CODEX_BIN,
        argv: buildCodexArgv({
          needsWrite: opts.needsWrite,
          schemaPath: opts.schemaPath,
          model: resolved.model,
        }),
        promptVia: 'stdin',
      };
    case 'opencode':
      return {
        bin: OPENCODE_BIN,
        argv: buildOpencodeArgv(prompt, {
          model: resolved.model,
          jsonEvents: opencodeWantsJson(resolved, opts),
        }),
        promptVia: 'argv',
      };
    case 'stub':
      return {
        bin: STUB_BIN,
        argv: buildStubArgv(prompt, { model: resolved.model }),
        promptVia: 'argv',
      };
  }
}

export interface SpawnAgentDeps {
  spawnImpl?: typeof nodeSpawn;
}

/**
 * The one spawn seam for agent CLIs. Resolves `opts.runner ?? resolveRunner(role, config)`
 * (pin wins), enforces capability fit, spawns with the timeout-SIGKILL pattern,
 * and appends paired `spawned`/`exited` agent-events (fail-open; shared spawnId). Directives ride
 * the prompt, never env/flags (PR #33 rule, all runners).
 */
export function spawnAgent(
  prompt: string,
  opts: SpawnAgentOpts,
  deps: SpawnAgentDeps = {},
): Promise<AgentResult> {
  const cwd = opts.cwd ?? process.cwd();
  const cfg = loadAgentsConfig(cwd);
  const resolved: ResolvedRunner = opts.runner
    ? { runner: opts.runner }
    : resolveRunner(opts.role, cfg);
  const caps = CAPABILITIES[resolved.runner];
  if (opts.schemaPath && caps.structuredOutput !== 'schema') {
    return Promise.reject(
      new Error(
        `capability-mismatch: role '${opts.role}' resolved to runner '${resolved.runner}' ` +
          `(structuredOutput: ${caps.structuredOutput}) but schemaPath requires 'schema'. ` +
          `Fix agents.roles['${opts.role}'].runner in .noldor/config.json or pin a schema-grade runner.`,
      ),
    );
  }
  // Incoherent option pairs are rejected at the boundary, never silently degraded: each one
  // would otherwise hand the caller something that looks like the thing they asked for and
  // is not (an unenforceable cap, a pid that is not a pgid, a capture request tee discards).
  if (opts.foreground && opts.timeoutMs !== undefined) {
    return Promise.reject(
      new Error(
        `invalid-options: foreground spawns have no process group to kill, so timeoutMs ` +
          `cannot be enforced. Drop the cap (the operator's Ctrl-C is the supervision) or drop foreground.`,
      ),
    );
  }
  if (opts.foreground && opts.onSpawn) {
    return Promise.reject(
      new Error(
        `invalid-options: onSpawn receives a process-group id, which exists only under ` +
          `detached spawning. A foreground child's pid is not a pgid and kill(-pid) on it would ` +
          `not reach the group the caller means.`,
      ),
    );
  }
  if (opts.stderr === 'capture' && opts.logSink !== undefined) {
    return Promise.reject(
      new Error(
        `invalid-options: logSink (tee) already owns stderr and forces AgentResult.stderr to '', ` +
          `so it would silently discard the requested capture. Pick one.`,
      ),
    );
  }
  const plan = planSpawn(resolved, prompt, opts);
  const spawnImpl = deps.spawnImpl ?? nodeSpawn;
  const started = Date.now();
  // Pairing id for this spawn's `spawned`/`exited` event rows — pid alone is
  // unsafe (reuse). Minted per call, stamped on both rows.
  const spawnId = randomUUID();
  // Passive telemetry correlation, NOT a directive: directives ride the prompt
  // (PR #33 rule) — runId rides env DELIBERATELY so nested registry spawns
  // inside a gate child (CR lanes, prep) inherit the same id with zero
  // call-site changes. Do not "fix" this onto the prompt.
  const runId = opts.env?.NOLDOR_RUN_ID ?? process.env.NOLDOR_RUN_ID;
  return new Promise<AgentResult>((resolve, reject) => {
    // Tee mode (logSink): both output streams piped, chunks forwarded to the
    // parent's stdio AND appended to the sink file — never accumulated into
    // `result.stdout` (the `'' under inherit` contract holds for tee callers).
    const tee = opts.logSink !== undefined;
    const capture = opts.stderr === 'capture';
    const outMode = !tee && opts.stdio === 'inherit' ? 'inherit' : 'pipe';
    const errMode = tee || capture ? 'pipe' : 'inherit';
    const child = spawnImpl(plan.bin, plan.argv, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      // `detached: true` makes the child its own process-group leader (pgid === child.pid),
      // so a group-kill (`process.kill(-pgid)`) reaches the real agent process the CLI spawns
      // — not just the thin wrapper. Without it, a runner SIGKILL orphans the grandchild.
      //
      // `foreground` inverts this for interactive callers: detaching also removes the child
      // from the terminal's foreground process group, so Ctrl-C stops reaching it. An
      // unattended caller wants the group-kill; an operator at a terminal wants their SIGINT.
      detached: !opts.foreground,
      // stdin owned by prompt delivery; stdout per opts.stdio (tee forces pipe);
      // stderr live unless tee needs a copy of it too.
      stdio: [plan.promptVia === 'stdin' ? 'pipe' : 'ignore', outMode, errMode],
    });
    let sink = tee ? createWriteStream(opts.logSink!, { flags: 'a' }) : null;
    if (sink) {
      sink.on('error', (err: Error) => {
        process.stderr.write(`agent-runner: logSink write failed (dropped): ${err.message}\n`);
        sink = null;
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        process.stdout.write(chunk);
        sink?.write(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        process.stderr.write(chunk);
        sink?.write(chunk);
      });
    }
    // pgid === child.pid under `detached: true`. Surface it so the drain loop can record
    // it for the next run's orphan-reap (spec Unit 2 carrier). Guard: a spawn that never got
    // a pid (immediate ENOENT, surfaced via 'error') has `child.pid === undefined`.
    if (child.pid !== undefined) {
      appendAgentEvent(cwd, {
        event: 'spawned',
        ts: new Date().toISOString(),
        runner: resolved.runner,
        role: opts.role,
        site: opts.site,
        ...(opts.slug !== undefined ? { slug: opts.slug } : {}),
        ...(runId !== undefined ? { runId } : {}),
        spawnId,
        pid: child.pid,
      });
      opts.onSpawn?.(child.pid);
    }
    if (plan.promptVia === 'stdin') {
      child.stdin?.on('error', () => {});
      child.stdin?.end(prompt);
    }
    // noldor:cut stdout accumulates unbounded — capping it would guarantee a parse failure
    // instead of preventing one, since stdout carries the RESULT (a schema-bounded CR record,
    // measured 12 bytes; opencode NDJSON; claude prose) rather than diagnostics. Truncating a
    // return value is strictly worse than a large allocation. Upgrade path: if a runner ever
    // streams unbounded stdout, give it a logSink (tee already never accumulates) rather than
    // truncating here. The bounded capture below applies to stderr, which is diagnostic and
    // therefore safe to elide.
    let stdout = '';
    let timedOut = false;
    const stderrCapture = createBoundedCapture();
    // Group-kill the whole process group on timeout (negative pid = pgid) so the agent
    // grandchild dies with the wrapper. Falls back to a direct `child.kill` if the group
    // kill throws (reused/permission edge) or the pid is unknown. POSIX-only (darwin/Linux);
    // the carrier records a real group only because of `detached: true` above.
    const killTree = (): void => {
      const pid = child.pid;
      if (pid !== undefined) {
        try {
          process.kill(-pid, 'SIGKILL');
          return;
        } catch {
          /* group gone / not permitted — fall through to direct kill */
        }
      }
      child.kill('SIGKILL');
    };
    const timer =
      opts.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            killTree();
          }, opts.timeoutMs)
        : null;
    if (!tee) {
      // `setEncoding`, not a per-chunk `chunk.toString('utf8')`: the stream's StringDecoder
      // holds partial UTF-8 sequences across chunk boundaries. Decoding each chunk
      // independently corrupts any multi-byte character that straddles one into U+FFFD —
      // realistic wherever an agent echoes reviewed source containing em dashes or non-ASCII.
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
    }
    if (capture) {
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => stderrCapture.push(chunk));
    }
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      sink?.end();
      reject(new Error(`spawn-failed: ${err.message}`));
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      sink?.end();
      const exitCode = code ?? -1;
      const usage = USAGE_ADAPTERS[resolved.runner]({ cwd, startedAtMs: started });
      appendAgentEvent(cwd, {
        event: 'exited',
        ts: new Date().toISOString(),
        runner: resolved.runner,
        role: opts.role,
        site: opts.site,
        ...(opts.slug !== undefined ? { slug: opts.slug } : {}),
        ...(runId !== undefined ? { runId } : {}),
        spawnId,
        exitCode,
        durationMs: Date.now() - started,
        timedOut,
        ...(usage ? { tokens: usage } : {}),
      });
      const outText =
        exitCode === 0 && opencodeWantsJson(resolved, opts) ? parseOpencodeEvents(stdout) : stdout;
      // Signal death already reports a non-zero exit via `code ?? -1`, but the bare number says
      // nothing about WHY. Under capture, append the reason so a sink blocker can distinguish a
      // group-kill from an OOM kill without the reader guessing from `-1`.
      if (capture && code === null) {
        stderrCapture.push(`\n[spawnAgent] child terminated by signal (exit reported as -1)\n`);
      }
      resolve({
        exitCode,
        stdout: outText,
        stderr: capture ? stderrCapture.value() : '',
        stderrBytes: capture ? stderrCapture.totalBytes() : 0,
        timedOut,
      });
    });
  });
}
