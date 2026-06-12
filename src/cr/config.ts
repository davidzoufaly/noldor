import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { artifactKindSchema, laneSchema } from './findings-schema.js';
import type { ArtifactKind, Lane } from './findings-schema.js';
import { agentsConfigSchema } from '../core/agent-runner/types.js';

/**
 * Default session-marker time-to-live, in hours. A stale-eligible session
 * (`micro-chore` / `release-sweep`) older than this reads as stale at
 * pre-commit. Lives here, beside {@link resolveSessionTtlHours}, rather than in
 * `core/session.ts` so `session.ts` keeps no `core → cr` import edge.
 */
export const DEFAULT_SESSION_TTL_HOURS = 24;

export const crLanesConfigSchema = z.record(artifactKindSchema, z.array(laneSchema).min(1));

/**
 * Built-in autonomous-safe lane defaults, used when no `crLanes` block is
 * configured. `subagent` is the only lane that runs fully unattended: in-process
 * (no external CLI auth like codex), no human stdin (unlike manual), no GUI
 * terminal (unlike standalone). So every artifact kind defaults to it. A
 * configured `crLanes.<kind>` always overrides this (see `resolveLanes`).
 *
 * The `crLanes` schema field stays `.optional()` (no `.default(...)`) on purpose:
 * we don't want `loadConfig` to synthesize a `crLanes` block onto configs that
 * never declared one. The default applies only at lane-resolution time.
 */
export const DEFAULT_CR_LANES: Record<ArtifactKind, Lane[]> = {
  spec: ['subagent'],
  plan: ['subagent'],
  code: ['subagent'],
};

export const watchConfigSchema = z.object({
  intervalMinutes: z.number().int().positive().default(30),
  maxFeaturesPerDay: z.number().int().positive().default(10),
  maxConsecutiveFailures: z.number().int().positive().default(3),
  notifyCommand: z.string().optional(),
});

export const autonomousConfigSchema = z.object({
  skipLanePicker: z.boolean().default(false),
  onFailure: z.enum(['prompt', 'spawn-deep-review', 'abort']).default('prompt'),
  requireHumanPrApproval: z.boolean().default(false),
  // Wall-clock cap per item is the existing --iteration-timeout flag (30 min default), not a
  // duplicate rail here. Token-budget rail deliberately omitted: no token accounting exists yet.
  watch: watchConfigSchema.optional(),
});

export const gateConfigSchema = z.object({
  sessionTtlHours: z.number().positive(),
});

export const noldorConfigSchema = z.object({
  crLanes: crLanesConfigSchema.optional(),
  autonomous: autonomousConfigSchema.optional(),
  gate: gateConfigSchema.optional(),
  agents: agentsConfigSchema.optional(),
});
export type NoldorConfig = z.infer<typeof noldorConfigSchema>;

const DEFAULT_PATH = '.noldor/config.json';

export async function loadConfig(path: string = DEFAULT_PATH): Promise<NoldorConfig | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return noldorConfigSchema.parse(JSON.parse(raw));
}

/**
 * Synchronous sibling of {@link loadConfig}, needed by the pre-commit hook
 * entrypoint (which cannot `await`). Mirrors `loadConfig` exactly: `null` on a
 * missing file, and a thrown parse error on malformed content. Module-level
 * strictness is preserved on purpose — fail-open is applied at the hook call
 * site, not here, so non-hook callers still get strict validation.
 */
export function loadConfigSync(path: string = DEFAULT_PATH): NoldorConfig | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return noldorConfigSchema.parse(JSON.parse(raw));
}

/**
 * Resolves the effective session TTL in hours: the configured
 * `gate.sessionTtlHours`, or {@link DEFAULT_SESSION_TTL_HOURS} when absent
 * (including a `null` config).
 */
export function resolveSessionTtlHours(config: NoldorConfig | null): number {
  return config?.gate?.sessionTtlHours ?? DEFAULT_SESSION_TTL_HOURS;
}
