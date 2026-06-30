import { z } from 'zod';

export const AGENT_ROLES = [
  'implementer',
  'reviewer',
  'second-opinion',
  'polish',
  'verifier',
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
  timedOut: boolean;
}

export interface ResolvedRunner {
  runner: RunnerName;
  model?: string;
}
