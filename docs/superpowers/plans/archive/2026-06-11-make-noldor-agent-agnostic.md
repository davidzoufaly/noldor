# Make Noldor Agent-Agnostic Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Role-based agent-runner registry (claude / codex / opencode) replacing five hard-coded Claude spawn sites + the welded codex argv; `agents:` config block; agent-events JSONL writer; doctor runner checks; `init --agents` shim sets; `docs/noldor/agent-runtimes.md`.

**Architecture:** New `src/core/agent-runner/` owns runner identity (binary names, argv builders, capabilities, role resolution, spawn). All call sites consume `spawnAgent()` or the argv builders; nothing outside the registry (plus `src/cr/deep-review-spawn.ts`'s single-sourced binary reference) names an agent CLI. Spec: `docs/superpowers/specs/2026-06-11-make-noldor-agent-agnostic-design.md`.

**Tech Stack:** TypeScript ESM, zod, vitest, node:child_process.

---

## File Structure

- `src/core/agent-runner/types.ts` — roles, runner names, capabilities type, `agentsConfigSchema`, spawn opts/result types
- `src/core/agent-runner/capabilities.ts` — `CAPABILITIES` matrix as code
- `src/core/agent-runner/runners/claude.ts` — `CLAUDE_BIN` + `buildClaudeArgv`
- `src/core/agent-runner/runners/codex.ts` — `CODEX_BIN` + `buildCodexArgv`
- `src/core/agent-runner/runners/opencode.ts` — `OPENCODE_BIN` + `buildOpencodeArgv`
- `src/core/agent-runner/registry.ts` — `loadAgentsConfig`, `resolveRunner`, `spawnAgent`
- `src/core/agent-runner/doctor-runners.ts` — `compareDotted`, `referencedRunners`, `checkRunners`
- `src/core/agent-events.ts` — fail-open JSONL appender
- `src/templates/agent-filter.ts` — `filterTemplatesByAgents`
- `src/cr/config.ts` — add `agents` to `noldorConfigSchema`
- `src/autonomous/drain-io.ts` — `spawnGate` via registry
- `src/prep/spawn.ts` — `spawnClaude` via registry
- `src/cr/lanes/subagent-dispatch.ts` — default dispatcher via registry
- `src/release/llm-polish-summary.ts` — polish runner via registry
- `src/cr/run-codex.ts` — argv from `buildCodexArgv`, bin from `CODEX_BIN`
- `src/cr/deep-review-spawn.ts` — moved from `src/cr/lanes/standalone.ts` (escalate-only)
- `src/cr/orchestrate.ts` — standalone no longer runnable
- `src/cr/escalate.ts` — import from new path
- `src/cli/commands/doctor.ts` — runner-check phase
- `src/cli/commands/init.ts` — `--agents` flag + subtree filter
- `src/cli/manifest.ts` — desc updates
- `templates/AGENTS.md`, `templates/opencode.json`, `templates/.opencode/command/gate.md`, `templates/.opencode/command/noldor.md` — shim template sources
- `templates/docs/noldor/agent-runtimes.md` + `docs/noldor/agent-runtimes.md` — matrix doc (template twin pair)
- Tests: `src/core/agent-runner/__tests__/{types,runners,registry,doctor-runners,no-stray-spawns}.test.ts`, `src/core/__tests__/agent-events.test.ts`, `src/templates/__tests__/agent-filter.test.ts`, `src/cr/__tests__/deep-review-spawn.test.ts` (moved), orchestrate test additions

---

## Task 1: Types + agents config schema

**Files:**
- Create: `src/core/agent-runner/types.ts`
- Test: `src/core/agent-runner/__tests__/types.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// @tests: make-noldor-agent-agnostic
import { describe, expect, it } from 'vitest';
import { agentsConfigSchema } from '../types';

describe('agentsConfigSchema', () => {
  it('fills defaults on empty object', () => {
    const cfg = agentsConfigSchema.parse({});
    expect(cfg.default).toBe('claude');
    expect(cfg.roles).toEqual({});
    expect(cfg.versionFloors).toEqual({});
    expect(cfg.targets).toEqual(['claude']);
  });

  it('parses a full block', () => {
    const cfg = agentsConfigSchema.parse({
      default: 'claude',
      roles: {
        reviewer: { runner: 'codex' },
        polish: { runner: 'opencode', model: 'ollama/llama3.2' },
      },
      versionFloors: { opencode: '0.6.0' },
      targets: ['claude', 'codex', 'opencode'],
    });
    expect(cfg.roles.polish?.model).toBe('ollama/llama3.2');
  });

  it('rejects unknown runners and unknown keys', () => {
    expect(() => agentsConfigSchema.parse({ default: 'gemini' })).toThrow();
    expect(() => agentsConfigSchema.parse({ rolez: {} })).toThrow();
    expect(() => agentsConfigSchema.parse({ roles: { reviewer: { runner: 'codex', extra: 1 } } })).toThrow();
  });
});
```

- [x] **Step 2: Run to verify FAIL**

`pnpm vitest run src/core/agent-runner/__tests__/types.test.ts` — Expected: `Cannot find module '../types'` (or equivalent resolve error).

- [x] **Step 3: Implement `types.ts`**

```ts
import { z } from 'zod';

export const AGENT_ROLES = ['implementer', 'reviewer', 'second-opinion', 'polish'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const RUNNER_NAMES = ['claude', 'codex', 'opencode'] as const;
export type RunnerName = (typeof RUNNER_NAMES)[number];

/** Per-runner capability grades; consumed by role-resolution fit checks and doctor. */
export interface RunnerCapabilities {
  structuredOutput: 'schema' | 'events' | 'prose';
  sandbox: 'fine' | 'coarse' | 'none';
  supportsLocalModels: boolean;
  questionSuppression: 'flag' | 'non-interactive' | 'permission-config';
  rulesFile: 'CLAUDE.md' | 'AGENTS.md';
}

export const roleConfigSchema = z
  .object({
    runner: z.enum(RUNNER_NAMES),
    model: z.string().min(1).optional(),
  })
  .strict();

/**
 * Optional top-level `agents:` block of `.noldor/config.json`. Absent block ≡
 * `{}` ≡ claude everywhere — the framework's pre-registry behavior. Mirrors the
 * `crLanes` posture: never synthesized onto configs that didn't declare it.
 */
export const agentsConfigSchema = z
  .object({
    default: z.enum(RUNNER_NAMES).default('claude'),
    roles: z.record(z.enum(AGENT_ROLES), roleConfigSchema).default({}),
    versionFloors: z.record(z.enum(RUNNER_NAMES), z.string().min(1)).default({}),
    targets: z.array(z.enum(RUNNER_NAMES)).min(1).default(['claude']),
  })
  .strict();

export type AgentsConfig = z.infer<typeof agentsConfigSchema>;
export type RoleConfig = z.infer<typeof roleConfigSchema>;

export interface SpawnAgentOpts {
  role: AgentRole;
  /** Pin a runner, bypassing role resolution (e.g. the codex CR lane is codex by name). */
  runner?: RunnerName;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /**
   * OUTPUT handling only (stdout). stdin is always owned by the runner's
   * prompt-delivery channel (argv-runners ignore stdin; stdin-runners pipe the
   * prompt in and close). stderr is always inherited for live progress.
   */
  stdio?: 'pipe' | 'inherit';
  /** Requires a schema-grade runner (codex); enforced at resolve time. */
  schemaPath?: string;
  /** Drives codex sandbox mode (workspace-write vs read-only). */
  needsWrite?: boolean;
  /** Caller tag for agent-events, e.g. 'drain.spawnGate'. */
  site?: string;
}

export interface AgentResult {
  exitCode: number;
  stdout: string; // '' under stdio: 'inherit'
  timedOut: boolean;
}

export interface ResolvedRunner {
  runner: RunnerName;
  model?: string;
}
```

- [x] **Step 4: Run to verify PASS**

`pnpm vitest run src/core/agent-runner/__tests__/types.test.ts` — Expected: `3 passed`.

- [x] **Step 5: Commit**

```bash
git add src/core/agent-runner/types.ts src/core/agent-runner/__tests__/types.test.ts
git commit -m "feat(agent-runner): add role/runner types and agents config schema" -m "Noldor-FD: make-noldor-agent-agnostic"
```

## Task 2: Capability matrix + argv builders

**Files:**
- Create: `src/core/agent-runner/capabilities.ts`, `src/core/agent-runner/runners/claude.ts`, `src/core/agent-runner/runners/codex.ts`, `src/core/agent-runner/runners/opencode.ts`
- Test: `src/core/agent-runner/__tests__/runners.test.ts`

- [x] **Step 1: Write the failing test (golden argv; canonical claude shape; codex sandbox flip; model pass-through)**

```ts
// @tests: make-noldor-agent-agnostic
import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '../capabilities';
import { CLAUDE_BIN, buildClaudeArgv } from '../runners/claude';
import { CODEX_BIN, buildCodexArgv } from '../runners/codex';
import { OPENCODE_BIN, buildOpencodeArgv } from '../runners/opencode';

describe('capability matrix', () => {
  it('encodes the spec table', () => {
    expect(CAPABILITIES.claude.structuredOutput).toBe('prose');
    expect(CAPABILITIES.codex.structuredOutput).toBe('schema');
    expect(CAPABILITIES.opencode.structuredOutput).toBe('events');
    expect(CAPABILITIES.opencode.supportsLocalModels).toBe(true);
    expect(CAPABILITIES.claude.supportsLocalModels).toBe(false);
    expect(CAPABILITIES.codex.rulesFile).toBe('AGENTS.md');
  });
});

describe('claude argv (canonical shape — byte-identical to drain/prep pre-refit)', () => {
  it('builds the canonical headless argv', () => {
    expect(buildClaudeArgv('do x', {})).toEqual([
      '--print',
      'do x',
      '--disallowed-tools',
      'AskUserQuestion',
      '--permission-mode',
      'bypassPermissions',
    ]);
    expect(CLAUDE_BIN).toBe('claude');
  });
  it('appends --model when set', () => {
    expect(buildClaudeArgv('p', { model: 'opus' }).slice(-2)).toEqual(['--model', 'opus']);
  });
});

describe('codex argv (extracted from run-codex.ts)', () => {
  it('read-only sandbox by default, with output schema', () => {
    expect(buildCodexArgv({ schemaPath: '/s.json' })).toEqual([
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--output-schema',
      '/s.json',
    ]);
    expect(CODEX_BIN).toBe('codex');
  });
  it('flips to workspace-write on needsWrite', () => {
    expect(buildCodexArgv({ needsWrite: true })).toEqual([
      'exec',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
    ]);
  });
});

describe('opencode argv', () => {
  it('builds run argv with permissions skip', () => {
    expect(buildOpencodeArgv('p', {})).toEqual(['run', 'p', '--dangerously-skip-permissions']);
    expect(OPENCODE_BIN).toBe('opencode');
  });
  it('appends provider/model', () => {
    expect(buildOpencodeArgv('p', { model: 'ollama/llama3.2' }).slice(-2)).toEqual([
      '--model',
      'ollama/llama3.2',
    ]);
  });
});
```

- [x] **Step 2: Run to verify FAIL**

`pnpm vitest run src/core/agent-runner/__tests__/runners.test.ts` — Expected: module-resolve failures.

- [x] **Step 3: Implement the four modules**

`capabilities.ts`:

```ts
import type { RunnerCapabilities, RunnerName } from './types.js';

/** Spec §Unit 2 table. Doc twin: docs/noldor/agent-runtimes.md. */
export const CAPABILITIES: Record<RunnerName, RunnerCapabilities> = {
  claude: {
    structuredOutput: 'prose',
    sandbox: 'none',
    supportsLocalModels: false,
    questionSuppression: 'flag',
    rulesFile: 'CLAUDE.md',
  },
  codex: {
    structuredOutput: 'schema',
    sandbox: 'coarse',
    supportsLocalModels: false,
    questionSuppression: 'non-interactive',
    rulesFile: 'AGENTS.md',
  },
  opencode: {
    structuredOutput: 'events',
    sandbox: 'fine',
    supportsLocalModels: true,
    questionSuppression: 'permission-config',
    rulesFile: 'AGENTS.md',
  },
};
```

`runners/claude.ts`:

```ts
export const CLAUDE_BIN = 'claude';

/** Prompt rides argv (`--print <prompt>`); stdin is ignored. */
export const CLAUDE_PROMPT_VIA = 'argv' as const;

/**
 * Canonical headless claude shape (PR #28/#33): bypassPermissions so
 * Edit/Bash run unattended, AskUserQuestion kill-switch so a forgotten
 * prompt fails fast instead of hanging.
 */
export function buildClaudeArgv(prompt: string, opts: { model?: string }): string[] {
  const argv = [
    '--print',
    prompt,
    '--disallowed-tools',
    'AskUserQuestion',
    '--permission-mode',
    'bypassPermissions',
  ];
  if (opts.model) argv.push('--model', opts.model);
  return argv;
}
```

`runners/codex.ts`:

```ts
export const CODEX_BIN = 'codex';

/** Prompt rides stdin (`codex exec` reads it); proven by src/cr/run-codex.ts. */
export const CODEX_PROMPT_VIA = 'stdin' as const;

/** Argv shape extracted from src/cr/run-codex.ts (the CR lane now consumes this). */
export function buildCodexArgv(opts: {
  needsWrite?: boolean;
  schemaPath?: string;
  model?: string;
}): string[] {
  const argv = [
    'exec',
    '--sandbox',
    opts.needsWrite ? 'workspace-write' : 'read-only',
    '--skip-git-repo-check',
  ];
  if (opts.schemaPath) argv.push('--output-schema', opts.schemaPath);
  if (opts.model) argv.push('--model', opts.model);
  return argv;
}
```

`runners/opencode.ts`:

```ts
export const OPENCODE_BIN = 'opencode';

/** Prompt rides argv (`opencode run <prompt>`). */
export const OPENCODE_PROMPT_VIA = 'argv' as const;

/**
 * `--dangerously-skip-permissions` still respects explicit `deny` rules in
 * opencode.json (verified against opencode.ai docs 2026-06-11), so the
 * generated permission template keeps guarding shared files.
 */
export function buildOpencodeArgv(prompt: string, opts: { model?: string }): string[] {
  const argv = ['run', prompt, '--dangerously-skip-permissions'];
  if (opts.model) argv.push('--model', opts.model);
  return argv;
}
```

- [x] **Step 4: Run to verify PASS**

`pnpm vitest run src/core/agent-runner/__tests__/runners.test.ts` — Expected: `7 passed`.

- [x] **Step 5: Commit**

```bash
git add src/core/agent-runner/capabilities.ts src/core/agent-runner/runners src/core/agent-runner/__tests__/runners.test.ts
git commit -m "feat(agent-runner): capability matrix and per-runner argv builders" -m "Noldor-FD: make-noldor-agent-agnostic"
```

## Task 3: Agent-events writer

**Files:**
- Create: `src/core/agent-events.ts`
- Test: `src/core/__tests__/agent-events.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// @tests: make-noldor-agent-agnostic
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendAgentEvent, type AgentEvent } from '../agent-events';

const EVENT: AgentEvent = {
  ts: '2026-06-11T00:00:00.000Z',
  runner: 'claude',
  role: 'implementer',
  site: 'drain.spawnGate',
  exitCode: 0,
  durationMs: 1234,
  timedOut: false,
};

describe('appendAgentEvent', () => {
  it('creates .noldor and appends one JSON line per call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-events-'));
    appendAgentEvent(dir, EVENT);
    appendAgentEvent(dir, { ...EVENT, exitCode: 1 });
    const lines = readFileSync(join(dir, '.noldor', 'agent-events.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual(EVENT);
    expect(JSON.parse(lines[1]!).exitCode).toBe(1);
  });

  it('fails open on unwritable target', () => {
    expect(() => appendAgentEvent('/dev/null/nope', EVENT)).not.toThrow();
  });
});
```

- [x] **Step 2: Run to verify FAIL**

`pnpm vitest run src/core/__tests__/agent-events.test.ts` — Expected: module-resolve failure.

- [x] **Step 3: Implement**

```ts
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentEvent {
  ts: string;
  runner: string;
  role: string;
  site?: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Append one event line to `.noldor/agent-events.jsonl`. FAIL-OPEN: an
 * events-write failure must never break a spawn, so every fs error is
 * swallowed. Rotation/retention is the agent-events roadmap entry's concern.
 */
export function appendAgentEvent(cwd: string, event: AgentEvent): void {
  try {
    const dir = join(cwd, '.noldor');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'agent-events.jsonl'), JSON.stringify(event) + '\n', 'utf8');
  } catch {
    // fail-open by contract
  }
}
```

- [x] **Step 4: Run to verify PASS**

`pnpm vitest run src/core/__tests__/agent-events.test.ts` — Expected: `2 passed`.

- [x] **Step 5: Commit**

```bash
git add src/core/agent-events.ts src/core/__tests__/agent-events.test.ts
git commit -m "feat(agent-runner): fail-open agent-events JSONL writer" -m "Noldor-FD: make-noldor-agent-agnostic"
```

## Task 4: Registry — config load, resolution, spawnAgent

**Files:**
- Create: `src/core/agent-runner/registry.ts`
- Test: `src/core/agent-runner/__tests__/registry.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// @tests: make-noldor-agent-agnostic
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentsConfigSchema } from '../types';
import { loadAgentsConfig, resolveRunner, spawnAgent } from '../registry';

function tmpConfig(agents?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-registry-'));
  mkdirSync(join(dir, '.noldor'));
  const body = agents === undefined ? {} : { agents };
  writeFileSync(join(dir, '.noldor', 'config.json'), JSON.stringify(body), 'utf8');
  return dir;
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stdin = { ended: '', on: vi.fn(), end(this: { ended: string }, s?: string) { (this as { ended: string }).ended = s ?? ''; } };
  killed: string | null = null;
  kill(sig: string) {
    this.killed = sig;
    this.emit('close', null);
  }
}

function fakeSpawn() {
  const calls: Array<{ bin: string; argv: string[]; opts: Record<string, unknown> }> = [];
  let child: FakeChild;
  const impl = vi.fn((bin: string, argv: string[], opts: Record<string, unknown>) => {
    calls.push({ bin, argv, opts });
    child = new FakeChild();
    return child as never;
  });
  return { impl, calls, child: () => child! };
}

describe('loadAgentsConfig', () => {
  it('defaults when file or block missing', () => {
    expect(loadAgentsConfig(mkdtempSync(join(tmpdir(), 'noldor-empty-')))).toEqual(
      agentsConfigSchema.parse({}),
    );
    expect(loadAgentsConfig(tmpConfig())).toEqual(agentsConfigSchema.parse({}));
  });
  it('throws loudly on a malformed agents block', () => {
    expect(() => loadAgentsConfig(tmpConfig({ default: 'gemini' }))).toThrow();
  });
});

describe('resolveRunner', () => {
  const cfg = agentsConfigSchema.parse({
    default: 'claude',
    roles: { polish: { runner: 'opencode', model: 'ollama/x' } },
  });
  it('uses role config when present', () => {
    expect(resolveRunner('polish', cfg)).toEqual({ runner: 'opencode', model: 'ollama/x' });
  });
  it('falls back to default', () => {
    expect(resolveRunner('reviewer', cfg)).toEqual({ runner: 'claude' });
  });
});

describe('spawnAgent', () => {
  it('claude default: canonical argv, prompt on argv, stdin ignored, event written', async () => {
    const dir = tmpConfig();
    const f = fakeSpawn();
    const p = spawnAgent('hello', { role: 'implementer', cwd: dir, site: 't' }, { spawnImpl: f.impl as never });
    f.child().stdout.emit('data', Buffer.from('out'));
    f.child().emit('close', 0);
    const r = await p;
    expect(r).toEqual({ exitCode: 0, stdout: 'out', timedOut: false });
    expect(f.calls[0]!.bin).toBe('claude');
    expect(f.calls[0]!.argv).toEqual([
      '--print', 'hello', '--disallowed-tools', 'AskUserQuestion', '--permission-mode', 'bypassPermissions',
    ]);
    expect((f.calls[0]!.opts.stdio as string[])[0]).toBe('ignore');
    const line = readFileSync(join(dir, '.noldor', 'agent-events.jsonl'), 'utf8').trim();
    expect(JSON.parse(line)).toMatchObject({ runner: 'claude', role: 'implementer', site: 't', exitCode: 0 });
  });

  it('runner pin wins over role config; codex prompt goes to stdin', async () => {
    const dir = tmpConfig({ roles: { 'second-opinion': { runner: 'opencode' } } });
    const f = fakeSpawn();
    const p = spawnAgent('judge', { role: 'second-opinion', runner: 'codex', schemaPath: '/s.json', cwd: dir }, { spawnImpl: f.impl as never });
    f.child().emit('close', 0);
    await p;
    expect(f.calls[0]!.bin).toBe('codex');
    expect(f.calls[0]!.argv).toContain('--output-schema');
    expect((f.calls[0]!.opts.stdio as string[])[0]).toBe('pipe');
    expect(f.child().stdin.ended).toBe('judge');
  });

  it('capability mismatch: schemaPath on a non-schema runner throws before spawning', async () => {
    const dir = tmpConfig({ roles: { 'second-opinion': { runner: 'opencode' } } });
    const f = fakeSpawn();
    await expect(
      spawnAgent('x', { role: 'second-opinion', schemaPath: '/s.json', cwd: dir }, { spawnImpl: f.impl as never }),
    ).rejects.toThrow(/capability-mismatch.*opencode/);
    expect(f.impl).not.toHaveBeenCalled();
  });

  it('timeout SIGKILLs and resolves timedOut', async () => {
    vi.useFakeTimers();
    const dir = tmpConfig();
    const f = fakeSpawn();
    const p = spawnAgent('slow', { role: 'implementer', cwd: dir, timeoutMs: 50 }, { spawnImpl: f.impl as never });
    vi.advanceTimersByTime(60);
    const r = await p;
    expect(r.timedOut).toBe(true);
    expect(f.child().killed).toBe('SIGKILL');
    vi.useRealTimers();
  });

  it('spawn error rejects with spawn-failed', async () => {
    const dir = tmpConfig();
    const f = fakeSpawn();
    const p = spawnAgent('x', { role: 'implementer', cwd: dir }, { spawnImpl: f.impl as never });
    f.child().emit('error', new Error('ENOENT'));
    await expect(p).rejects.toThrow(/spawn-failed: ENOENT/);
  });

  it('opencode role with model builds --model argv', async () => {
    const dir = tmpConfig({ roles: { polish: { runner: 'opencode', model: 'ollama/x' } } });
    const f = fakeSpawn();
    const p = spawnAgent('p', { role: 'polish', cwd: dir }, { spawnImpl: f.impl as never });
    f.child().emit('close', 0);
    await p;
    expect(f.calls[0]!.bin).toBe('opencode');
    expect(f.calls[0]!.argv).toEqual(['run', 'p', '--dangerously-skip-permissions', '--model', 'ollama/x']);
    expect(existsSync(join(dir, '.noldor', 'agent-events.jsonl'))).toBe(true);
  });
});
```

- [x] **Step 2: Run to verify FAIL**

`pnpm vitest run src/core/agent-runner/__tests__/registry.test.ts` — Expected: module-resolve failure.

- [x] **Step 3: Implement `registry.ts`**

```ts
import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendAgentEvent } from '../agent-events.js';
import { CAPABILITIES } from './capabilities.js';
import { CLAUDE_BIN, buildClaudeArgv } from './runners/claude.js';
import { CODEX_BIN, buildCodexArgv } from './runners/codex.js';
import { OPENCODE_BIN, buildOpencodeArgv } from './runners/opencode.js';
import {
  agentsConfigSchema,
  type AgentResult,
  type AgentsConfig,
  type AgentRole,
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
      return { bin: CLAUDE_BIN, argv: buildClaudeArgv(prompt, { model: resolved.model }), promptVia: 'argv' };
    case 'codex':
      return {
        bin: CODEX_BIN,
        argv: buildCodexArgv({ needsWrite: opts.needsWrite, schemaPath: opts.schemaPath, model: resolved.model }),
        promptVia: 'stdin',
      };
    case 'opencode':
      return { bin: OPENCODE_BIN, argv: buildOpencodeArgv(prompt, { model: resolved.model }), promptVia: 'argv' };
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
  const resolved: ResolvedRunner = opts.runner ? { runner: opts.runner } : resolveRunner(opts.role, cfg);
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
      appendAgentEvent(cwd, {
        ts: new Date().toISOString(),
        runner: resolved.runner,
        role: opts.role,
        site: opts.site,
        exitCode,
        durationMs: Date.now() - started,
        timedOut,
      });
      resolve({ exitCode, stdout, timedOut });
    });
  });
}
```

- [x] **Step 4: Run to verify PASS**

`pnpm vitest run src/core/agent-runner/__tests__/registry.test.ts` — Expected: `9 passed`.

- [x] **Step 5: Commit**

```bash
git add src/core/agent-runner/registry.ts src/core/agent-runner/__tests__/registry.test.ts
git commit -m "feat(agent-runner): spawnAgent registry with role resolution, runner pin, capability fit" -m "Noldor-FD: make-noldor-agent-agnostic"
```

## Task 5: Wire `agents` into `noldorConfigSchema`

**Files:**
- Modify: `src/cr/config.ts`
- Test: extend `src/cr/__tests__/config.test.ts` (existing file; add one describe)

- [x] **Step 1: Add the failing test** (append to the existing config test file)

```ts
describe('agents block', () => {
  it('parses an agents block and leaves it optional', () => {
    const parsed = noldorConfigSchema.parse({
      agents: { default: 'claude', roles: { reviewer: { runner: 'codex' } } },
    });
    expect(parsed.agents?.roles.reviewer?.runner).toBe('codex');
    expect(noldorConfigSchema.parse({}).agents).toBeUndefined();
  });
});
```

(Import `noldorConfigSchema` if the file doesn't already.)

- [x] **Step 2: Run to verify FAIL**

`pnpm vitest run src/cr/__tests__/config.test.ts` — Expected: zod unknown-key strictness is NOT the failure (schema isn't `.strict()` at top level — verify); the failure is `parsed.agents` undefined / type error. If `noldorConfigSchema` rejects unknown keys, the parse throws — either way red.

- [x] **Step 3: Implement** — in `src/cr/config.ts` add the import and field:

```ts
import { agentsConfigSchema } from '../core/agent-runner/types.js';
```

and in `noldorConfigSchema`:

```ts
export const noldorConfigSchema = z.object({
  crLanes: crLanesConfigSchema.optional(),
  autonomous: autonomousConfigSchema.optional(),
  gate: gateConfigSchema.optional(),
  agents: agentsConfigSchema.optional(),
});
```

- [x] **Step 4: Run to verify PASS**

`pnpm vitest run src/cr/__tests__/config.test.ts` — Expected: all passing incl. new describe.

- [x] **Step 5: Commit**

```bash
git add src/cr/config.ts src/cr/__tests__/config.test.ts
git commit -m "feat(cr): accept optional agents block in noldor config schema" -m "Noldor-FD: make-noldor-agent-agnostic"
```

## Task 6: Refit `prep/spawn.ts` and `drain-io.ts`

**Files:**
- Modify: `src/prep/spawn.ts`, `src/autonomous/drain-io.ts`

No new unit tests: both are IO adapters (drain-io documents this; prep tests inject `spawnClaude`). Registry tests already cover argv/timeout/error. Verification = typecheck + full suite green.

- [x] **Step 1: Refit `src/prep/spawn.ts`** — replace the body of `spawnClaude` (keep exported name, types, and `runWithConcurrency` untouched; delete the `node:child_process` import):

```ts
import { spawnAgent } from '../core/agent-runner/registry.js';

export interface ClaudeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly timedOut: boolean;
}

export interface SpawnClaudeOpts {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
}

/**
 * Spawn one headless implementer-role agent child (claude unless the consumer's
 * agents config says otherwise). stdout is captured; stderr is inherited for
 * live progress. Kept under its historical name — call sites and tests inject it.
 */
export function spawnClaude(prompt: string, opts: SpawnClaudeOpts = {}): Promise<ClaudeResult> {
  return spawnAgent(prompt, {
    role: 'implementer',
    cwd: opts.cwd,
    env: opts.env,
    timeoutMs: opts.timeoutMs,
    stdio: 'pipe',
    needsWrite: true,
    site: 'prep.spawn',
  });
}
```

- [x] **Step 2: Refit `spawnGate` in `src/autonomous/drain-io.ts`** — replace the function (keep its JSDoc, adjust the last sentence to mention the registry); drop `spawn` from the `node:child_process` import (keep `execFileSync`, `spawnSync`):

```ts
import { spawnAgent } from '../core/agent-runner/registry.js';

export async function spawnGate(
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  prompt = '/gate',
): Promise<number> {
  const r = await spawnAgent(prompt, {
    role: 'implementer',
    cwd,
    env,
    timeoutMs,
    stdio: 'inherit',
    needsWrite: true,
    site: 'drain.spawnGate',
  });
  if (r.timedOut) throw new Error('iteration-timeout'); // per-entry failure → retry/skip
  return r.exitCode;
}
```

(`spawn-failed: …` rejections pass through unchanged — same abort-the-drain contract.)

- [x] **Step 3: Run to verify PASS**

`pnpm typecheck && pnpm vitest run src/prep src/autonomous` — Expected: green.

- [x] **Step 4: Commit**

```bash
git add src/prep/spawn.ts src/autonomous/drain-io.ts
git commit -m "refactor(agent-runner): route prep and drain gate spawns through the registry" -m "Noldor-FD: make-noldor-agent-agnostic"
```

## Task 7: Refit subagent dispatch + polish summary

**Files:**
- Modify: `src/cr/lanes/subagent-dispatch.ts`, `src/release/llm-polish-summary.ts`

- [x] **Step 1: Refit `subagent-dispatch.ts`** — replace the default dispatcher and the `node:child_process` import:

```ts
import { spawnAgent } from '../../core/agent-runner/registry.js';
```

```ts
let dispatcher: Dispatcher = async (input) => {
  const r = await spawnAgent(buildPrompt(input), {
    role: 'reviewer',
    timeoutMs: 600_000,
    site: 'cr.subagent-dispatch',
  });
  if (r.timedOut || r.exitCode !== 0) {
    throw new Error(`subagent dispatch failed: exit ${r.exitCode}${r.timedOut ? ' (timeout)' : ''}`);
  }
  return r.stdout;
};
```

(Markdown contract + `setDispatcher` seam unchanged. The pre-refit `-p`/`--dangerously-skip-permissions` shape is normalized onto the canonical claude argv — spec Unit 1 normalization note.)

- [x] **Step 2: Refit `llm-polish-summary.ts`** — replace `runClaudePolish` (and the `execFile`/`promisify` imports) with:

```ts
import { spawnAgent } from '../core/agent-runner/registry.js';
```

```ts
async function runAgentPolish(commits: FeatureCommit[]): Promise<string> {
  const prompt = buildPrompt(commits);
  const r = await spawnAgent(prompt, { role: 'polish', timeoutMs: LLM_TIMEOUT_MS, site: 'release.polish-summary' });
  if (r.timedOut || r.exitCode !== 0) {
    throw new Error(`polish runner failed: exit ${r.exitCode}${r.timedOut ? ' (timeout)' : ''}`);
  }
  const out = r.stdout.trim();
  if (out.length === 0) {
    throw new Error('polish runner returned empty output');
  }
  return out;
}
```

Update the one reference: `const runner = options.runner ?? runAgentPolish;` and the doc comment line `default → invoke the runner (defaults to \`claude -p\`)` → `default → invoke the runner (the agent-runner registry's polish role)`.

- [x] **Step 3: Run to verify PASS**

`pnpm typecheck && pnpm vitest run src/cr/lanes src/release` — Expected: green (existing tests inject dispatcher/runner; behavior contracts unchanged).

- [x] **Step 4: Commit**

```bash
git add src/cr/lanes/subagent-dispatch.ts src/release/llm-polish-summary.ts
git commit -m "refactor(agent-runner): route subagent dispatch and release polish through the registry" -m "Noldor-FD: make-noldor-agent-agnostic"
```

## Task 8: Extract codex argv from `run-codex.ts`

**Files:**
- Modify: `src/cr/run-codex.ts`

- [x] **Step 1: Replace the inline argv + bin literal** — in `runCodex`, change:

```ts
import { CODEX_BIN, buildCodexArgv } from '../core/agent-runner/runners/codex.js';
```

```ts
const cmd = input.cmd ?? CODEX_BIN;
```

and the spawn call:

```ts
const r = await input.spawn({
  cmd,
  args: buildCodexArgv({ needsWrite: false, schemaPath }),
  stdin,
});
```

with `const schemaPath = fileURLToPath(new URL('./cr-record.schema.json', import.meta.url));` kept as-is above. (The `Spawn` injection seam and `CrRecord` parsing are untouched; argv ownership moves to the runner module — the CR lane is now a registry consumer per spec D11.)

- [x] **Step 2: Run to verify PASS**

`pnpm vitest run src/cr` — Expected: green (run-codex tests assert behavior through the injected `Spawn`; argv equality tests, if any, still match because the builder reproduces the exact shape).

- [x] **Step 3: Commit**

```bash
git add src/cr/run-codex.ts
git commit -m "refactor(cr): source codex argv and binary name from the codex runner module" -m "Noldor-FD: make-noldor-agent-agnostic"
```

## Task 9: Standalone lane → escalate-only deep-review spawn

**Files:**
- Create: `src/cr/deep-review-spawn.ts` (moved content)
- Delete: `src/cr/lanes/standalone.ts`
- Modify: `src/cr/orchestrate.ts`, `src/cr/escalate.ts`, test files importing the old path
- Test: move `standalone` lane tests to `src/cr/__tests__/deep-review-spawn.test.ts`; add orchestrate rejection test

- [x] **Step 1: `git mv src/cr/lanes/standalone.ts src/cr/deep-review-spawn.ts`**, then fix its relative imports (one directory shallower): `'../atomic-write.js'` → `'./atomic-write.js'`, `'../findings-schema.js'` → `'./findings-schema.js'`, `'../lane-types.js'` → `'./lane-types.js'`. Replace the hard-coded `claude` in the iTerm command string with the single-sourced binary name:

```ts
import { CLAUDE_BIN } from '../core/agent-runner/runners/claude.js';
```

```ts
const command =
  `cd ${input.repoRoot} && ${CLAUDE_BIN} --dangerously-skip-permissions${maxThinkingFlag} ` +
```

and in `claudeSupportsMaxThinking`, `execAsync('claude', …)` → `execAsync(CLAUDE_BIN, …)`. Update `PROMPT_TEMPLATE_PATH` if it references the old module dir (it points at `src/cr/lanes/standalone-prompt.md`; `git mv src/cr/lanes/standalone-prompt.md src/cr/standalone-prompt.md` and set the constant to `'src/cr/standalone-prompt.md'`). The deep-review window stays Claude-only + macOS/iTerm-only by design (operator-facing escalation seam; documented in agent-runtimes.md).

- [x] **Step 2: Update `src/cr/escalate.ts`** — `import { runStandalone } from './lanes/standalone.js'` → `import { runStandalone } from './deep-review-spawn.js'`.

- [x] **Step 3: Update `src/cr/orchestrate.ts`** — full teardown enumeration (line refs are pre-edit):

1. **L13** delete `import { multiterminalDepDone, runStandalone } from './lanes/standalone.js';` — nothing else in the file may import from `deep-review-spawn.js`.
2. **L35-40** lane table loses standalone and narrows its key type:

```ts
const LANES: Record<Exclude<Lane, 'standalone'>, (input: LaneInput) => Promise<LaneResult>> = {
  manual: runManual,
  codex: runCodex,
  subagent: runSubagent,
};
```

2b. **L306-311 allSettled dispatch**: after the table narrows, `LANES[l]` with `l: Lane` is a typecheck error — the rejection in item 3 guarantees standalone can't reach here, so cast at the index site:

```ts
const settled = await Promise.allSettled(
  effective.map((l) => {
    if (l === 'codex') return runCodex(input, { supportsBaseSha: codexBaseShaSupport });
    return LANES[l as Exclude<Lane, 'standalone'>](input);
  }),
);
```

3. **In `run()`, immediately after `const requested = resolveLanes(...)` (L218)** add the rejection:

```ts
if (requested.includes('standalone')) {
  throw new Error(
    "lane 'standalone' is no longer an orchestrate lane — deep review spawns via 'noldor cr escalate' (spawn-deep-review)",
  );
}
```

4. **L128-132** in `guardLaneOverwrite`: delete the `if (lane === 'standalone' && finishedAtUnset) { keep.push(lane); continue; }` pass-through (unreachable after the rejection; `finishedAtUnset` becomes unused — delete the variable and its assignment too).
5. **L155-195** delete `guardStandaloneInProgress` and the `StandaloneGuardOutcome` export entirely — its only consumer was the standalone spawn path.
6. **L254-260** delete the pre-dep probe block (`if (effective.includes('standalone')) { const depDone = await multiterminalDepDone(...) ... }`). `lanesSkippedPreDep` stays (it's in `RunResult`) but is now always empty — keep the field for CLI/report shape stability.
7. Delete the two standalone blocks **L280-292** (`if (effective.includes('standalone')) { const outcome = await guardStandaloneInProgress(…) … }`) and **L293-301** (`if (effective.includes('standalone')) { try { await runStandalone(input) … }`), plus the L278 comment line `// Standalone first (fire-and-continue) — only when not short-circuited above`. **L279 `const lanesRun: Lane[] = [...syntheticOks];` MUST survive** — it is used at L314/L330 and returned at L339.
8. **L262-264 + L317** comment touch-ups: the delta short-circuit comment drops "including standalone (Decision §4). Spawning iTerm2 + --max-thinking…" (now just "synthetic OK for EVERY lane"); the exit-code comment drops "Standalone async => doesn't affect."
9. In `deep-review-spawn.ts`, delete `multiterminalDepDone` + `MultiterminalProbeOpts` (orchestrate was the only consumer; YAGNI) and delete its tests when moving the test file in Step 4. `PROMPT_TEMPLATE_PATH` and `templateSha` stay — `runStandalone` uses them.

(`src/cr/aggregate.ts` is intentionally untouched — it still polls escalate-spawned and legacy `*-standalone.json` sinks; `laneSchema` keeps the `'standalone'` value so those sinks parse. `writeSyntheticOk`'s lane loop is unaffected: standalone can no longer appear in `effective`.)

- [x] **Step 4: Move/adjust tests** — `git mv` the standalone lane test file (find via `ls src/cr/lanes/__tests__/ | grep standalone` or `grep -rl "lanes/standalone" src`) to `src/cr/__tests__/deep-review-spawn.test.ts` and fix its import paths; delete its `multiterminalDepDone` describes. In the orchestrate test file, delete the `guardStandaloneInProgress` describes and any standalone-lane run-path cases (pre-dep skip, in-progress guard, fire-and-continue), and the standalone case inside `guardLaneOverwrite` tests. Add to the orchestrate test file:

```ts
it('rejects standalone as a runnable lane with an escalate pointer', async () => {
  await expect(
    orchestrate({ slug: 's', kind: 'spec', artifact: 'a.md', lanes: ['standalone'] } as never),
  ).rejects.toThrow(/no longer an orchestrate lane.*escalate/);
});
```

(Match the existing orchestrate test harness's call shape — adapt the input literal to however the suite invokes orchestrate.)

- [x] **Step 5: Run to verify PASS**

`pnpm typecheck && pnpm vitest run src/cr` — Expected: green incl. moved tests + new rejection test.

- [x] **Step 6: Commit**

```bash
git add -A src/cr
git commit -m "refactor(cr): retire standalone orchestrate lane; deep-review spawn becomes escalate-only" -m "Noldor-FD: make-noldor-agent-agnostic"
```

## Task 10: No-stray-spawns invariant test

**Files:**
- Test: `src/core/agent-runner/__tests__/no-stray-spawns.test.ts`

- [x] **Step 1: Write the test (it should PASS immediately — it verifies Tasks 6–9 left no stray binary literals)**

```ts
// @tests: make-noldor-agent-agnostic
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(process.cwd(), 'src');
const ALLOWED = [join('core', 'agent-runner') + sep, join('cr', 'deep-review-spawn.ts')];

// Multiline-tolerant: catches `spawn(\n  'claude'` shapes a line-based grep misses.
const STRAY = /\b(?:spawn|spawnSync|execFile|execFileSync|execFileP|exec)\s*\(\s*['"](?:claude|codex|opencode)['"]/m;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('agent-CLI spawn containment', () => {
  it('no file outside the registry spawns an agent CLI by literal name', () => {
    const offenders = walk(SRC)
      .filter((f) => {
        const rel = relative(SRC, f);
        return !ALLOWED.some((a) => rel.startsWith(a));
      })
      .filter((f) => STRAY.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
```

- [x] **Step 2: Run to verify PASS**

`pnpm vitest run src/core/agent-runner/__tests__/no-stray-spawns.test.ts` — Expected: `1 passed`. If it lists offenders, those are real misses from Tasks 6–9 — fix them, do not loosen the regex.

- [x] **Step 3: Commit**

```bash
git add src/core/agent-runner/__tests__/no-stray-spawns.test.ts
git commit -m "test(agent-runner): invariant — agent CLI spawns contained to the registry" -m "Noldor-FD: make-noldor-agent-agnostic"
```

## Task 11: Doctor runner checks

**Files:**
- Create: `src/core/agent-runner/doctor-runners.ts`
- Modify: `src/cli/commands/doctor.ts`, `src/cli/manifest.ts` (doctor desc)
- Test: `src/core/agent-runner/__tests__/doctor-runners.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// @tests: make-noldor-agent-agnostic
import { describe, expect, it } from 'vitest';
import { agentsConfigSchema } from '../types';
import { checkRunners, compareDotted, referencedRunners } from '../doctor-runners';

describe('compareDotted', () => {
  it('compares numerically per segment', () => {
    expect(compareDotted('0.10.0', '0.6.0')).toBeGreaterThan(0);
    expect(compareDotted('1.0', '1.0.0')).toBe(0);
    expect(compareDotted('0.5.9', '0.6.0')).toBeLessThan(0);
  });
});

describe('referencedRunners', () => {
  it('collects default + role runners, deduped', () => {
    const cfg = agentsConfigSchema.parse({
      default: 'claude',
      roles: { reviewer: { runner: 'codex' }, polish: { runner: 'codex' } },
    });
    expect(referencedRunners(cfg).toSorted()).toEqual(['claude', 'codex']);
  });
  it('defaults to claude only', () => {
    expect(referencedRunners(agentsConfigSchema.parse({}))).toEqual(['claude']);
  });
});

describe('checkRunners', () => {
  const cfg = agentsConfigSchema.parse({
    default: 'claude',
    roles: { reviewer: { runner: 'opencode' } },
    versionFloors: { opencode: '0.6.0' },
  });
  it('ok / missing / below-floor', () => {
    const probe = (bin: string) => (bin === 'claude' ? '2.1.0' : bin === 'opencode' ? '0.5.0' : null);
    const checks = checkRunners(cfg, probe);
    expect(checks).toEqual([
      { runner: 'claude', status: 'ok', detail: '2.1.0' },
      { runner: 'opencode', status: 'below-floor', detail: '0.5.0 < floor 0.6.0' },
    ]);
  });
  it('missing CLI reported', () => {
    const checks = checkRunners(cfg, () => null);
    expect(checks.every((c) => c.status === 'missing')).toBe(true);
  });
});
```

- [x] **Step 2: Run to verify FAIL**

`pnpm vitest run src/core/agent-runner/__tests__/doctor-runners.test.ts` — Expected: module-resolve failure.

- [x] **Step 3: Implement `doctor-runners.ts`**

```ts
import { execFileSync } from 'node:child_process';
import { CLAUDE_BIN } from './runners/claude.js';
import { CODEX_BIN } from './runners/codex.js';
import { OPENCODE_BIN } from './runners/opencode.js';
import type { AgentsConfig, RunnerName } from './types.js';

const BINS: Record<RunnerName, string> = { claude: CLAUDE_BIN, codex: CODEX_BIN, opencode: OPENCODE_BIN };

export interface RunnerCheck {
  runner: RunnerName;
  status: 'ok' | 'missing' | 'below-floor';
  detail: string;
}

/** Numeric per-segment dotted-version compare (`0.10.0 > 0.6.0`); no range syntax. */
export function compareDotted(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Every runner the config actually references: the default + each role's runner. */
export function referencedRunners(cfg: AgentsConfig): RunnerName[] {
  const set = new Set<RunnerName>([cfg.default]);
  for (const rc of Object.values(cfg.roles)) {
    if (rc) set.add(rc.runner);
  }
  return [...set];
}

export type VersionProbe = (bin: string) => string | null;

function defaultProbe(bin: string): string | null {
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 });
    const m = out.match(/\d+(\.\d+)+/);
    return m ? m[0] : out.trim() || '0';
  } catch {
    return null;
  }
}

/**
 * Presence + version-floor check for every *configured* runner only — a
 * consumer who never opted into opencode is not flagged for missing it.
 * Below-floor is an error, not a warning: a floor exists because something is
 * known-broken below it (spec D4).
 */
export function checkRunners(cfg: AgentsConfig, probe: VersionProbe = defaultProbe): RunnerCheck[] {
  return referencedRunners(cfg).map((runner) => {
    const version = probe(BINS[runner]);
    if (version === null) {
      return { runner, status: 'missing' as const, detail: `'${BINS[runner]}' not found on PATH` };
    }
    const floor = cfg.versionFloors[runner];
    if (floor && compareDotted(version, floor) < 0) {
      return { runner, status: 'below-floor' as const, detail: `${version} < floor ${floor}` };
    }
    return { runner, status: 'ok' as const, detail: version };
  });
}
```

- [x] **Step 4: Run to verify PASS**

`pnpm vitest run src/core/agent-runner/__tests__/doctor-runners.test.ts` — Expected: `5 passed`.

- [x] **Step 5: Wire into `src/cli/commands/doctor.ts`** — after the template-drift loop and before the exit decision, restructure the tail of the script to:

```ts
import { loadAgentsConfig } from '../../core/agent-runner/registry.js';
import { checkRunners } from '../../core/agent-runner/doctor-runners.js';
```

```ts
let runnerBad = 0;
const checks = checkRunners(loadAgentsConfig(process.cwd()));
for (const c of checks) {
  if (c.status === 'ok') continue;
  runnerBad++;
  console.log(`${c.status.padEnd(12)} runner ${c.runner}: ${c.detail}`);
}

if (bad === 0 && runnerBad === 0) {
  console.log(`OK — ${files.length} template files in sync, ${checks.length} runner(s) healthy`);
  process.exit(0);
}

if (bad > 0) {
  console.error(
    `\n${bad} drift entries. Run 'noldor init --update' to sync consumer paths, or 'noldor init --adopt' if the pkg should adopt consumer state.`,
  );
}
if (runnerBad > 0) {
  console.error(`${runnerBad} runner problem(s). Install the missing CLI or fix agents.versionFloors.`);
}
process.exit(1);
```

In `src/cli/manifest.ts` update the doctor desc: `'Run drift check'` → `'Run drift check + configured-runner presence/version check'`.

- [x] **Step 6: Run to verify PASS**

`pnpm typecheck && pnpm noldor doctor` — Expected on this repo: `OK — <n> template files in sync, 1 runner(s) healthy` exit 0 (default config → claude only, installed).

- [x] **Step 7: Commit**

```bash
git add src/core/agent-runner/doctor-runners.ts src/core/agent-runner/__tests__/doctor-runners.test.ts src/cli/commands/doctor.ts src/cli/manifest.ts
git commit -m "feat(doctor): presence and version-floor checks for configured agent runners" -m "Noldor-FD: make-noldor-agent-agnostic"
```

## Task 12: Template agent filter + `init --agents` + shim templates

**Files:**
- Create: `src/templates/agent-filter.ts`, `templates/AGENTS.md`, `templates/opencode.json`, `templates/.opencode/command/gate.md`, `templates/.opencode/command/noldor.md`
- Modify: `src/cli/commands/init.ts`, `src/cli/manifest.ts` (init desc), `src/cli/commands/doctor.ts` (filter drift by targets)
- Test: `src/templates/__tests__/agent-filter.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// @tests: make-noldor-agent-agnostic
import { describe, expect, it } from 'vitest';
import { filterTemplatesByAgents } from '../agent-filter';

const FILES = [
  '.claude/skills/gate/SKILL.md',
  '.claude/noldor.md',
  '.opencode/command/gate.md',
  'opencode.json',
  'AGENTS.md',
  'docs/noldor/workflow.md',
  'lefthook/noldor.yml',
];

describe('filterTemplatesByAgents', () => {
  it('claude-only drops opencode + AGENTS.md subtrees', () => {
    expect(filterTemplatesByAgents(FILES, ['claude'])).toEqual([
      '.claude/skills/gate/SKILL.md',
      '.claude/noldor.md',
      'docs/noldor/workflow.md',
      'lefthook/noldor.yml',
    ]);
  });
  it('codex adds AGENTS.md but not .opencode', () => {
    expect(filterTemplatesByAgents(FILES, ['claude', 'codex'])).toContain('AGENTS.md');
    expect(filterTemplatesByAgents(FILES, ['claude', 'codex'])).not.toContain('opencode.json');
  });
  it('opencode adds its subtree and AGENTS.md; dropping claude drops .claude', () => {
    const out = filterTemplatesByAgents(FILES, ['opencode']);
    expect(out).toEqual(['.opencode/command/gate.md', 'opencode.json', 'AGENTS.md', 'docs/noldor/workflow.md', 'lefthook/noldor.yml']);
  });
});
```

- [x] **Step 2: Run to verify FAIL**

`pnpm vitest run src/templates/__tests__/agent-filter.test.ts` — Expected: module-resolve failure.

- [x] **Step 3: Implement `src/templates/agent-filter.ts`**

```ts
import type { RunnerName } from '../core/agent-runner/types.js';

/**
 * Filter the template manifest to the consumer's chosen agent targets.
 * Driver-neutral files (docs, lefthook, …) always pass. `AGENTS.md` serves
 * both codex and opencode (both read it natively).
 */
export function filterTemplatesByAgents(files: string[], targets: RunnerName[]): string[] {
  return files.filter((f) => {
    if (f.startsWith('.claude/')) return targets.includes('claude');
    if (f.startsWith('.opencode/') || f === 'opencode.json') return targets.includes('opencode');
    if (f === 'AGENTS.md') return targets.includes('codex') || targets.includes('opencode');
    return true;
  });
}
```

- [x] **Step 4: Run to verify PASS**

`pnpm vitest run src/templates/__tests__/agent-filter.test.ts` — Expected: `3 passed`.

- [x] **Step 5: Create the template files.**

`templates/AGENTS.md`:

```markdown
# Agent Rules — Noldor Consumer

This repo runs the Noldor discipline framework. Codex and opencode agents read
this file natively; Claude Code reads `.claude/` instead. Same rules, one gate.

## Hard rules

- Every code change enters through the gate: run `pnpm noldor next-priority`
  to pick work; follow `docs/noldor/workflow.md` for the path (micro-chore /
  fast-track / specs-only / full).
- Never edit `docs/roadmap.md`, `docs/backlog.md`, or `docs/release-notes.md`
  outside triage/promote flows — they are queue state, not docs.
- Commits carry `Noldor-FD: <slug>` (and `Noldor-Path:` when a session is
  active); lefthook injects/validates trailers — do not bypass hooks.
- Specs live at `docs/superpowers/specs/`, plans at `docs/superpowers/plans/`;
  formats: `pnpm noldor prep format spec|plan`.
- Feature docs (`docs/features/<slug>.md`) are the single source of truth —
  update User Story / Usage before flipping `phase: done`.

## Command catalog

`pnpm noldor <group> <cmd>` — discover with `pnpm noldor --help`. Key entries:
`next-priority`, `validate features`, `cr orchestrate|aggregate|escalate`,
`prep fanout|promote|format`, `autonomous run|status`, `worktrees create`,
`init`, `doctor`. Full catalog: `docs/noldor/script-catalog.md`.
```

`templates/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "question": "deny",
    "edit": {
      "docs/roadmap.md": "deny",
      "docs/backlog.md": "deny",
      "docs/release-notes.md": "deny"
    }
  }
}
```

`templates/.opencode/command/gate.md`:

```markdown
---
description: Noldor gate — single mandatory entry for any code change
---

Run the Noldor gate flow for this repo. Read `docs/noldor/workflow.md` and
`docs/noldor/complexity-gating.md`, then:

1. `pnpm noldor next-priority --suggestions --json` — pick the top entry.
2. Follow the suggested path. Worktree paths: `pnpm noldor worktrees create <slug>`.
3. Specs/plans per `pnpm noldor prep format spec|plan`.
4. CR: `pnpm noldor cr orchestrate --slug <slug> --artifact <path> --kind <kind> --autonomous`.
5. Ship via `pnpm noldor pr-flow`.

Commit messages need a `Noldor-FD: <slug>` trailer (lefthook injects it when a
session marker exists).
```

`templates/.opencode/command/noldor.md`:

```markdown
---
description: Noldor command catalog pointer
---

This repo uses the Noldor framework. Start at `docs/noldor/README.md`;
workflow: `docs/noldor/workflow.md`; commands: `docs/noldor/script-catalog.md`
(`pnpm noldor --help` lists every group). Agent-runtime matrix:
`docs/noldor/agent-runtimes.md`.
```

- [x] **Step 6: Wire `--agents` into `src/cli/commands/init.ts`** — replace the arg parsing + file selection:

```ts
import { TEMPLATES_ROOT, templateFiles } from '../../templates/manifest.js';
import { copyTemplate, adoptTemplate } from '../../templates/copy.js';
import { filterTemplatesByAgents } from '../../templates/agent-filter.js';
import { loadAgentsConfig } from '../../core/agent-runner/registry.js';
import { RUNNER_NAMES, type RunnerName } from '../../core/agent-runner/types.js';

const argv = process.argv.slice(2);
const args = new Set(argv);
const update = args.has('--update');
const adopt = args.has('--adopt');
const consumer = process.cwd();

function parseAgents(): RunnerName[] {
  const i = argv.indexOf('--agents');
  const inline = argv.find((a) => a.startsWith('--agents='));
  const rawList = inline ? inline.slice('--agents='.length) : i >= 0 ? argv[i + 1] : undefined;
  if (rawList === undefined) return loadAgentsConfig(consumer).targets;
  const list = rawList.split(',').map((s) => s.trim()).filter(Boolean);
  for (const name of list) {
    if (!(RUNNER_NAMES as readonly string[]).includes(name)) {
      console.error(`init failed: unknown agent '${name}' (valid: ${RUNNER_NAMES.join(', ')})`);
      process.exit(1);
    }
  }
  if (list.length === 0) {
    console.error('init failed: --agents requires a non-empty comma-separated list');
    process.exit(1);
  }
  return list as RunnerName[];
}

const files = filterTemplatesByAgents(templateFiles(), parseAgents());
```

(The `adopt` branch keeps using the unfiltered `templateFiles()` — snapshotting pkg templates must see everything: change its call to `adoptTemplate(TEMPLATES_ROOT, consumer, templateFiles())`.) Update the flag doc comment at the top of the file: add `--agents claude,codex,opencode   select which driver shim sets to write (default: agents.targets from config, else claude)`.

In `src/cli/manifest.ts` update the init desc: `'Run init (--update / --adopt flags)'` → `'Run init (--update / --adopt / --agents flags)'`.

- [x] **Step 7: Filter doctor drift by targets too** — in `src/cli/commands/doctor.ts` change the file list line:

```ts
import { filterTemplatesByAgents } from '../../templates/agent-filter.js';
```

```ts
const agentsCfg = loadAgentsConfig(process.cwd());
const files = filterTemplatesByAgents(templateFiles(), agentsCfg.targets);
const drift = computeDrift(TEMPLATES_ROOT, process.cwd(), files);
```

(reuse `agentsCfg` for `checkRunners(agentsCfg)` from Task 11 — single load).

- [x] **Step 8: Run to verify PASS**

`pnpm typecheck && pnpm noldor doctor` — Expected: `OK — <n> template files in sync, 1 runner(s) healthy` (targets default `['claude']` filters the new opencode/AGENTS templates out of the drift set — repo root stays clean). Then smoke `init --agents` in a scratch dir:

```bash
cd "$(mktemp -d)" && mkdir -p .noldor && echo '{"consumer":{"name":"x","repoUrl":"https://example.com","lockstepPackages":["package.json"],"e2ePrefix":"e2e/","samplesPath":"samples","packagePrefix":"@x/","pnpmStderrPrefix":"x","appPathPrefix":"src"}}' > .noldor/config.json && node /Users/davidzoufaly/code/noldor/.worktrees/make-noldor-agent-agnostic/bin/noldor.mjs init --agents claude,codex,opencode | tail -3 && ls AGENTS.md opencode.json .opencode/command/ && cd -
```

Expected: copy summary; `AGENTS.md opencode.json` listed and `gate.md noldor.md` in `.opencode/command/`.

- [x] **Step 9: Commit**

```bash
git add src/templates/agent-filter.ts src/templates/__tests__/agent-filter.test.ts templates/AGENTS.md templates/opencode.json templates/.opencode src/cli/commands/init.ts src/cli/commands/doctor.ts src/cli/manifest.ts
git commit -m "feat(init): --agents driver selection writing codex/opencode shim sets from templates" -m "Noldor-FD: make-noldor-agent-agnostic"
```

## Task 13: `docs/noldor/agent-runtimes.md` (+ template twin)

**Files:**
- Create: `docs/noldor/agent-runtimes.md`, `templates/docs/noldor/agent-runtimes.md` (identical content)

- [x] **Step 1: Write the doc** (same bytes to both paths — doctor diffs them):

```markdown
# Agent Runtimes

Noldor supports three agent runtimes as simultaneous first-class peers:
**Claude Code, Codex, opencode**. Every framework spawn resolves through the
runner registry (`src/core/agent-runner/registry.ts`): a call site declares a
*role*, the consumer's `agents:` config maps roles to runners, and the
registry builds the runner-specific argv. Absent config ≡ claude everywhere.

## Flag mapping

| Noldor need | Claude Code | Codex | opencode |
| --- | --- | --- | --- |
| headless spawn | `claude --print "<prompt>"` | `codex exec` (prompt via stdin) | `opencode run "<prompt>"` |
| auto-permissions | `--permission-mode bypassPermissions` | `--sandbox workspace-write` (read-only for review roles) | `--dangerously-skip-permissions` (respects explicit `deny`) |
| no-questions kill-switch | `--disallowed-tools AskUserQuestion` | non-interactive by design | `permission.question: "deny"` in `opencode.json` |
| model / role selection | `--model` | `--model` / `config.toml` | `--model <provider/model>` |
| structured output | parse stdout prose | `--output-schema <json-schema>` | `--format json` (reserved; treated as prose v1) |
| rules file | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| guards | `.claude` hooks + `src/hooks/` | sandbox modes (coarse) | `opencode.json` glob permission rules |
| local models | no | no | yes (ollama et al.) |

Capability matrix as code: `src/core/agent-runner/capabilities.ts`.

## Config

```jsonc
// .noldor/config.json — all fields optional
"agents": {
  "default": "claude",
  "roles": {
    "implementer":    { "runner": "claude" },
    "reviewer":       { "runner": "codex" },
    "second-opinion": { "runner": "opencode", "model": "ollama/qwen3" },
    "polish":         { "runner": "opencode", "model": "ollama/llama3.2" }
  },
  "versionFloors": { "opencode": "0.6.0" },
  "targets": ["claude", "codex", "opencode"]
}
```

Roles: `implementer` (drain gate runs, prep fanout), `reviewer` (CR subagent
lane), `second-opinion` (codex CR lane — pinned to the codex runner by name;
role config cannot re-route it), `polish` (release-notes summary). `targets`
selects which driver shim sets `noldor init --agents` writes and which
template subtrees `noldor doctor` checks.

## Rollout guidance (mixed fleet)

Adopt by risk tier: `polish` first (pure text, no tools — cheapest local-model
win), CR lanes second, `implementer` last — and only per-runner once outcome
telemetry shows ship/retry/revert parity. v1 shims are thin command pointers
(fat CLI, thin skills); a non-Claude implementer cannot drive the full `/gate`
skill flow yet.

## Events and doctor

Every spawn appends one line to `.noldor/agent-events.jsonl`
(`runner` / `role` / `site` / `exitCode` / `durationMs` / `timedOut`).
`noldor doctor` verifies presence + version floor for every *configured*
runner. The interactive deep-review window (`noldor cr escalate` →
spawn-deep-review) stays Claude + macOS/iTerm only by design — it is the
operator-facing escalation seam, not a headless lane.
```

- [x] **Step 2: Run to verify PASS**

`pnpm noldor doctor` — Expected: still `OK` (twin files identical; the docs/ copy is driver-neutral so it stays in the filtered set).

- [x] **Step 3: Commit** (shared-files guard may require the allow env for the `docs/noldor/` + `templates/` pair):

```bash
git add docs/noldor/agent-runtimes.md templates/docs/noldor/agent-runtimes.md
NOLDOR_ALLOW_SHARED=1 git commit -m "docs(noldor): agent-runtimes matrix — flag mapping, roles config, rollout guidance" -m "Noldor-FD: make-noldor-agent-agnostic"
```

## Task 14: Full verification sweep

**Files:** none (verification only)

- [x] **Step 1:** `pnpm typecheck` — Expected: clean.
- [x] **Step 2:** `pnpm test` — Expected: all suites green (pre-existing 174 files + new agent-runner/agent-events/agent-filter/doctor-runners suites).
- [x] **Step 3:** `pnpm noldor validate features` — Expected: `all OK`.
- [x] **Step 4:** `pnpm noldor doctor` — Expected: exit 0, runners healthy.
- [x] **Step 5:** Fix anything red, then commit any stragglers:

```bash
git add -A
git commit -m "test(agent-runner): verification sweep fixes" -m "Noldor-FD: make-noldor-agent-agnostic"
```

(Skip the commit if the tree is clean.)
