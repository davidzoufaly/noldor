import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { artifactKindSchema, laneSchema } from './findings-schema.js';

export const crLanesConfigSchema = z.record(artifactKindSchema, z.array(laneSchema).min(1));

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
