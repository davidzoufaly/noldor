import { z } from 'zod';

export const AGENT_ROLES = [
  'implementer',
  'reviewer',
  'second-opinion',
  'polish',
  'verifier',
  'researcher',
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const RUNNER_NAMES = ['claude', 'codex', 'opencode', 'stub'] as const;
export type RunnerName = (typeof RUNNER_NAMES)[number];

/** Per-runner capability grades; consumed by role-resolution fit checks and doctor. */
export interface RunnerCapabilities {
  structuredOutput: 'schema' | 'events' | 'prose';
  sandbox: 'fine' | 'coarse' | 'none';
  supportsLocalModels: boolean;
  questionSuppression: 'flag' | 'non-interactive' | 'permission-config';
  rulesFile: 'CLAUDE.md' | 'AGENTS.md';
  /** How framework entry prompts are dispatched: 'slash-command' expands a
   *  vendored skill/command; 'prose' must be self-contained instructions. */
  promptDispatch: 'slash-command' | 'prose';
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
   * prompt in and close). stderr is inherited for live progress unless
   * {@link SpawnAgentOpts.stderr} asks for it.
   */
  stdio?: 'pipe' | 'inherit';
  /**
   * `'capture'` accumulates the child's stderr into {@link AgentResult.stderr} instead of
   * letting it through to the terminal. Default `'inherit'` — every existing caller keeps
   * live stderr and an empty `result.stderr`.
   *
   * Exists for the codex CR lane, whose failure attribution reads the child's stderr
   * (`describeCodexFailure` scans it for an auth hint and renders a bounded tail). Rejected
   * together with {@link SpawnAgentOpts.logSink}: tee already owns both streams and forces
   * `stderr` to `''`, so accepting both would silently discard an explicit capture request.
   */
  stderr?: 'inherit' | 'capture';
  /**
   * Spawn the child in the parent's process group instead of its own.
   *
   * The default (`false` → `detached: true`) is right for every unattended caller: it makes the
   * child a group leader so a timeout can group-kill the real agent process rather than a thin
   * wrapper. It is wrong for an interactive one, because it also removes the child from the
   * terminal's foreground group, so the operator's Ctrl-C stops reaching it and the child
   * survives its parent to run to completion.
   *
   * `foreground: true` is the interactive answer: the terminal reaps the whole group for free.
   * It is mutually exclusive with {@link SpawnAgentOpts.timeoutMs} (no group to kill) and with
   * {@link SpawnAgentOpts.onSpawn} (the pid it would hand back is not a process-group id) —
   * both rejected rather than silently ignored.
   */
  foreground?: boolean;
  /** Requires a schema-grade runner (codex); enforced at resolve time. */
  schemaPath?: string;
  /** Drives codex sandbox mode (workspace-write vs read-only). */
  needsWrite?: boolean;
  /** Caller tag for agent-events, e.g. 'drain.spawnGate'. */
  site?: string;
  /** Slug the spawn concerns — stamped on its spawned/exited event rows (drain candidate). */
  slug?: string;
  /**
   * Absolute path of an append-only file receiving a copy of the child's stdout
   * AND stderr (tee). When set, both streams are piped and every chunk is
   * forwarded to the parent's stdout/stderr — terminal behavior matches
   * `stdio: 'inherit'` (minus TTY-ness) — and appended to this file. Tee chunks
   * are NEVER accumulated into `AgentResult.stdout` (stays `''`), so an
   * hours-long child can't buffer its output in memory. A sink write error is
   * non-fatal: one stderr warning, then the sink is dropped for that child.
   */
  logSink?: string;
  /**
   * Called synchronously right after a successful spawn with the child's process-
   * group id (`pgid === child.pid`, since the child is spawned `detached: true`).
   * The drain loop uses this to register the pgid into its live set so a dead
   * run's orphan agent groups can be reaped at the next run's startup. Spawn
   * failures never call it; deregistering the pgid once the child closes is the
   * caller's responsibility.
   */
  onSpawn?: (pgid: number) => void;
}

export interface AgentResult {
  exitCode: number;
  stdout: string; // '' under stdio: 'inherit'
  /** '' unless `stderr: 'capture'` was requested; always '' under tee (logSink). */
  stderr: string;
  timedOut: boolean;
}

export interface ResolvedRunner {
  runner: RunnerName;
  model?: string;
}
