import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

// Boundary rules mirror dependency-cruiser's forbidden-rule shape.
// `from.path` / `to.path` are REGEX STRINGS consumed by dep-cruiser,
// not glob patterns. See packages/noldor/src/invariants/boundaries.ts
// FORBIDDEN_RULES for canonical examples.
export const BoundaryRuleSchema = z
  .object({
    name: z.string().min(1),
    severity: z.enum(['error', 'warn', 'info']),
    from: z.object({ path: z.string().min(1) }),
    to: z.object({ path: z.string().min(1) }),
  })
  .strict();

export const ConsumerConfigSchema = z
  .object({
    name: z.string().min(1),
    repoUrl: z.string().url(),
    lockstepPackages: z.array(z.string().min(1)).min(1),
    scanPaths: z.array(z.string().min(1)).default([]),
    boundaries: z.array(BoundaryRuleSchema).default([]),
    deprecatedPackages: z.array(z.string()).default([]),
    e2ePrefix: z.string(),
    samplesPath: z.string(),
    packagePrefix: z.string(),
    pnpmStderrPrefix: z.string(),
    appPathPrefix: z.string(),
  })
  .strict();

export type ConsumerConfig = z.infer<typeof ConsumerConfigSchema>;
export type BoundaryRule = z.infer<typeof BoundaryRuleSchema>;

const CONFIG_FILE = '.noldor/config.json';

/**
 * Reads and validates the noldor consumer configuration for the given working
 * directory. Looks for `<cwd>/.noldor/config.json`, parses its top-level
 * `consumer` block, and validates it against {@link ConsumerConfigSchema}.
 * The schema itself is the authoritative documentation of every required and
 * optional field.
 *
 * Throws with a descriptive message when:
 * - the config file does not exist,
 * - the file contains invalid JSON (includes the file path in the error),
 * - the `consumer` block is absent, or
 * - the `consumer` block fails schema validation (unknown keys are rejected).
 */
export function loadConsumerConfig(cwd: string = process.cwd()): ConsumerConfig {
  const path = join(cwd, CONFIG_FILE);
  if (!existsSync(path)) {
    throw new Error(
      `loadConsumerConfig: missing ${CONFIG_FILE} at ${cwd}. Every noldor consumer must declare a consumer: block.`,
    );
  }
  let raw: { consumer?: unknown };
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as { consumer?: unknown };
  } catch (err) {
    throw new Error(
      `loadConsumerConfig: ${CONFIG_FILE} at ${cwd} contains invalid JSON: ${(err as Error).message}`,
      { cause: err },
    );
  }
  if (raw.consumer === undefined) {
    throw new Error(
      `loadConsumerConfig: ${CONFIG_FILE} has no consumer: block. Check ${CONFIG_FILE} for required fields.`,
    );
  }
  return ConsumerConfigSchema.parse(raw.consumer);
}
