import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendAgentEvent } from '../agent-events.js';
import { CAPABILITIES } from './capabilities.js';
import { USAGE_ADAPTERS } from './usage/index.js';
import { CLAUDE_BIN, buildClaudeArgv } from './runners/claude.js';
import { CODEX_BIN, buildCodexArgv } from './runners/codex.js';
import { OPENCODE_BIN, buildOpencodeArgv } from './runners/opencode.js';
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
        argv: buildOpencodeArgv(prompt, { model: resolved.model }),
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
 * and appends one agent-event per completed spawn (fail-open). Directives ride
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
  const plan = planSpawn(resolved, prompt, opts);
  const spawnImpl = deps.spawnImpl ?? nodeSpawn;
  const started = Date.now();
  return new Promise<AgentResult>((resolve, reject) => {
    const outMode = opts.stdio === 'inherit' ? 'inherit' : 'pipe';
    const child = spawnImpl(plan.bin, plan.argv, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      // stdin owned by prompt delivery; stdout per opts.stdio; stderr always live.
      stdio: [plan.promptVia === 'stdin' ? 'pipe' : 'ignore', outMode, 'inherit'],
    });
    if (plan.promptVia === 'stdin') {
      child.stdin?.on('error', () => {});
      child.stdin?.end(prompt);
    }
    let stdout = '';
    let timedOut = false;
    const timer =
      opts.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, opts.timeoutMs)
        : null;
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`spawn-failed: ${err.message}`));
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const exitCode = code ?? -1;
      const usage = USAGE_ADAPTERS[resolved.runner]({ cwd, startedAtMs: started });
      appendAgentEvent(cwd, {
        ts: new Date().toISOString(),
        runner: resolved.runner,
        role: opts.role,
        site: opts.site,
        exitCode,
        durationMs: Date.now() - started,
        timedOut,
        ...(usage ? { tokens: usage } : {}),
      });
      resolve({ exitCode, stdout, timedOut });
    });
  });
}
