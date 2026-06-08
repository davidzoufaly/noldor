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

/**
 * Functional release-notes categories seeded into a fresh consumer. These are
 * a DOMAIN axis, deliberately orthogonal to Conventional-Commit types
 * (`feat`/`fix`/`docs`/…) — those classify a change's KIND and already drive
 * the CHANGELOG grouping + bump level. Categories classify which part of the
 * project a feature belongs to. The set is intentionally minimal; projects
 * grow it via `/triage` + `/promote` (which propose new categories to the
 * operator and append them to `.noldor/config.json` on approval).
 */
export const DEFAULT_CATEGORIES = ['Core', 'Tooling', 'Other'] as const;

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
    /** Release-notes categories. Grows over a project's life (see `/triage`). */
    categories: z
      .array(z.string().min(1))
      .min(1)
      .default([...DEFAULT_CATEGORIES]),
    /** Maps an FD `area` slug to its release-notes category. Unmapped → `Other`. */
    areaCategories: z.record(z.string(), z.string()).default({}),
    /**
     * Maps a short Conventional-Commit scope token to the FD slug(s) it may
     * legitimately front. Lets the team use informal scopes (`feat(cr):`)
     * without tripping the trailer-scope-mismatch detector. Key = scope token
     * (matched against the scope's last `:`-delimited segment); value = FD slugs
     * that token is allowed to represent. Empty by default — the detector's
     * behaviour is unchanged until a consumer declares aliases.
     */
    scopeAliases: z.record(z.string(), z.array(z.string().min(1))).default({}),
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

/**
 * The consumer's release-notes categories, or {@link DEFAULT_CATEGORIES} when
 * no config is present (bootstrap / unit-test cwd). Tolerant by design so
 * category-iterating code (release notes, dashboard, docs index) never throws
 * just because a config hasn't been scaffolded yet.
 */
export function loadCategories(cwd: string = process.cwd()): string[] {
  try {
    return loadConsumerConfig(cwd).categories;
  } catch {
    return [...DEFAULT_CATEGORIES];
  }
}

/** The consumer's `area` → category map (empty when no config). */
export function loadAreaCategories(cwd: string = process.cwd()): Record<string, string> {
  try {
    return loadConsumerConfig(cwd).areaCategories;
  } catch {
    return {};
  }
}

/**
 * The consumer's scope-token → FD-slug(s) alias map (empty when no config).
 * Consumed by the trailer-scope-mismatch detector to accept the team's
 * informal short scopes. Tolerant by design: a missing config yields `{}`,
 * leaving detector behaviour unchanged.
 */
export function loadScopeAliases(cwd: string = process.cwd()): Record<string, string[]> {
  try {
    return loadConsumerConfig(cwd).scopeAliases;
  } catch {
    return {};
  }
}
