import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

// Boundary rules mirror dependency-cruiser's forbidden-rule shape.
// `from.path` / `to.path` are REGEX STRINGS consumed by dep-cruiser, not
// globs. `from` may be empty (`{}` = "any module") and `to.circular: true`
// expresses dep-cruiser's canonical no-cycle backstop
// (`{from: {}, to: {circular: true}}`). Each rule must still constrain the
// `to` side — a rule that forbids nothing is a config typo, not a rule.
// See this repo's own `.noldor/config.json` consumer.boundaries for live examples.
export const BoundaryRuleSchema = z
  .object({
    name: z.string().min(1),
    severity: z.enum(['error', 'warn', 'info']),
    from: z.object({ path: z.string().min(1).optional() }),
    to: z.object({
      path: z.string().min(1).optional(),
      circular: z.boolean().optional(),
    }),
  })
  .strict()
  .refine((rule) => rule.to.path !== undefined || rule.to.circular !== undefined, {
    message: 'boundary rule must constrain `to`: set to.path and/or to.circular',
    path: ['to'],
  });

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

/**
 * One bootable run surface for the verify lane / smoke floor. `server`
 * surfaces are booted, probed at `healthPath` until HTTP 200 or
 * `readyTimeoutMs`, then killed; `cli` surfaces run once and must exit 0.
 * `{port}` in `command` is substituted with the per-tree port at run time.
 */
export const VerifySurfaceSchema = z
  .object({
    command: z.string().min(1),
    kind: z.enum(['server', 'cli']),
    healthPath: z.string().default('/'),
    readyTimeoutMs: z.number().int().positive().default(30_000),
  })
  .strict();

export type VerifySurface = z.infer<typeof VerifySurfaceSchema>;

/**
 * One long-running per-task dev surface (web app, internal API). Booted by
 * `noldor worktrees up`, probed at `healthPath`, and left running. `{port}`
 * and `{path}` in `command` are substituted at boot; the port is the tree's
 * stamped base PORT plus `portOffset` (see deriveSurfacePort).
 */
export const DevSurfaceSchema = z
  .object({
    command: z.string().min(1),
    healthPath: z.string().default('/'),
    readyTimeoutMs: z.number().int().positive().default(30_000),
    portOffset: z.number().int().min(0).default(0),
  })
  .strict();
export type DevSurface = z.infer<typeof DevSurfaceSchema>;

/** Per-task dev environment config: optional editor + named dev surfaces. */
export const DevConfigSchema = z
  .object({
    editor: z
      .object({ command: z.string().min(1) })
      .strict()
      .optional(),
    surfaces: z.record(z.string(), DevSurfaceSchema).default({}),
  })
  .strict();
export type DevConfig = z.infer<typeof DevConfigSchema>;

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
    /**
     * @deprecated Dead key — nothing reads it. Tolerated (optional) so
     * existing consumer configs keep parsing under the strict schema; drop it
     * from your config. New scaffolds omit it.
     */
    pnpmStderrPrefix: z.string().optional(),
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
    /**
     * Named run surfaces for the verify lane's smoke floor (see
     * docs/noldor/cr-pipeline.md). Empty by default — smoke is opt-in.
     */
    verifyCommands: z.record(z.string(), VerifySurfaceSchema).default({}),
    /** Per-task dev surfaces booted by `worktrees up`. Absent = nothing booted. */
    dev: DevConfigSchema.optional(),
    /**
     * Framework version this consumer tree was last migrated to. Written by
     * `init` (fresh scaffold = current) and `noldor upgrade` (after a chain).
     * Absent on a tree scaffolded before the upgrade feature; `upgrade --from`
     * bootstraps it.
     */
    frameworkVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+/)
      .optional(),
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

/**
 * The consumer's named verify surfaces (empty when no config). Tolerant by
 * design, mirroring {@link loadScopeAliases}: a missing or invalid config
 * yields `{}` so smoke/verify callers never throw at load time.
 */
export function loadVerifyCommands(cwd: string = process.cwd()): Record<string, VerifySurface> {
  try {
    return loadConsumerConfig(cwd).verifyCommands;
  } catch {
    return {};
  }
}

/** Load the `consumer.dev` block, or null when absent. */
export function loadDevConfig(cwd: string = process.cwd()): DevConfig | null {
  return loadConsumerConfig(cwd).dev ?? null;
}

/** Load the named dev surfaces, or `{}` when `consumer.dev` is absent. */
export function loadDevSurfaces(cwd: string = process.cwd()): Record<string, DevSurface> {
  return loadConsumerConfig(cwd).dev?.surfaces ?? {};
}

/**
 * The framework version this consumer was last migrated to, or `null` when the
 * field (or the whole config) is absent. Tolerant by design — reads the
 * `consumer.frameworkVersion` field straight from `.noldor/config.json` without
 * running the strict {@link ConsumerConfigSchema} validation, so the anchor is
 * still readable on a partial/pre-feature tree whose config is otherwise
 * incomplete (the doctor skew check and `upgrade` must both work there).
 */
export function loadFrameworkVersion(cwd: string = process.cwd()): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(cwd, CONFIG_FILE), 'utf8')) as {
      consumer?: { frameworkVersion?: unknown };
    };
    const v = raw.consumer?.frameworkVersion;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Set `consumer.frameworkVersion` in `<cwd>/.noldor/config.json`, preserving
 * every other key. Round-trips the JSON with 2-space indent + trailing newline.
 * Throws if the config file does not exist (the caller scaffolds it first).
 */
export function writeFrameworkVersion(cwd: string, version: string): void {
  const path = join(cwd, CONFIG_FILE);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { consumer?: Record<string, unknown> };
  raw.consumer ??= {};
  raw.consumer.frameworkVersion = version;
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
}
