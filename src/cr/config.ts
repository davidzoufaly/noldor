import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { artifactKindSchema, laneSchema } from './findings-schema.js';
import type { ArtifactKind, Lane } from './findings-schema.js';

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

export const autonomousConfigSchema = z.object({
  skipLanePicker: z.boolean().default(false),
  onFailure: z.enum(['prompt', 'spawn-deep-review', 'abort']).default('prompt'),
  requireHumanPrApproval: z.boolean().default(false),
});

export const noldorConfigSchema = z.object({
  crLanes: crLanesConfigSchema.optional(),
  autonomous: autonomousConfigSchema.optional(),
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
