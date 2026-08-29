import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ROUTE_CHARSET_RE, sanitizationIssues, screenshotTemplateIssues } from './ui-boot.js';
import { IMPLICIT_SURFACE } from './ui-predicate.js';

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
 * grow it via `/noldor-triage` + `/noldor-promote` (which propose new categories to the
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

/**
 * A repo-relative POSIX glob for UI-surface config. The accepted language is
 * the intersection the predicate (minimatch) and the freshness engine (git
 * wildmatch + brace pre-expansion) both implement: plain globs + braces.
 * Negation and extglobs (`@()`, `!()`, `+()`, `?()`, `*()`) are rejected —
 * they would match in one engine and silently not in the other, and the
 * schema, not the matcher, is where that contract is enforced.
 */
const UiGlobSchema = z
  .string()
  .min(1)
  .refine((g) => !g.startsWith('!'), {
    message: 'negation globs are not supported in uiPaths/uiSurfaces',
  })
  .refine((g) => !/[@!+?*]\(/.test(g), {
    message: 'extglob patterns are not supported in uiPaths/uiSurfaces (plain globs + braces only)',
  })
  .refine((g) => !g.startsWith('/') && !/^[A-Za-z]:/.test(g) && !g.includes('\\'), {
    message: 'uiPaths/uiSurfaces globs must be repo-relative POSIX paths',
  })
  .refine((g) => !g.split('/').includes('..'), {
    message: 'uiPaths/uiSurfaces globs must not contain .. segments',
  });

/** Baseline surface names become `docs/design/ui/baseline/<name>.pen` — keep them slug-shaped. */
const SURFACE_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * One render-compare boot recipe (spec R2), keyed by surface name in
 * `consumer.uiBoot`. `verifyCommand` references a `consumer.verifyCommands`
 * entry of `kind: "server"` (boot/health are not respecified); `route` is the
 * path that renders the surface; `page` selects among several
 * `FINAL:<surface>: <name>` design pages; `screenshotCommand` is the
 * consumer-owned capture template — the lane substitutes every placeholder as
 * a single-quoted shell token.
 */
export const UiBootRecipeSchema = z
  .object({
    verifyCommand: z.string().min(1),
    route: z
      .string()
      .refine((r) => r.startsWith('/'), { message: 'route must start with /' })
      .refine((r) => ROUTE_CHARSET_RE.test(r), {
        message:
          'route may only contain [A-Za-z0-9-._~/?=&%] — shell metacharacters are unrepresentable by design',
      }),
    // Backtick and newline are excluded because the selector is interpolated
    // into the exporter prompt inside a backtick span; matching itself is
    // exact string equality, so the restriction costs no expressiveness.
    page: z
      .string()
      .min(1)
      .refine((p) => !/[`\n\r]/.test(p), {
        message: 'page selector may not contain backticks or newlines',
      })
      .optional(),
    screenshotCommand: z
      .string()
      .min(1)
      .superRefine((tpl, ctx) => {
        for (const issue of screenshotTemplateIssues(tpl)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
        }
      }),
    maxDiffRatio: z.number().finite().min(0).max(1).default(0.25),
    // Rejected at validate when out of contract, never clamped (spec R2).
    captureTimeoutMs: z.number().int().min(1).max(120_000).default(60_000),
  })
  .strict();

export type UiBootRecipe = z.infer<typeof UiBootRecipeSchema>;

/**
 * How one surface's UI baseline is regenerated. `command` is a consumer-owned
 * shell string run by `noldor design capture`; the receipt at
 * `.noldor/ui-capture/<surface>.json` advances only when it exits 0.
 *
 * Deliberately NOT a `verifyCommands` reference the way `uiBoot.verifyCommand`
 * is: every `verifyCommands` surface is booted by the smoke floor
 * (`src/verify/smoke.ts`), so declaring a capture there would make `noldor
 * verify` run it — a slow, app-dependent side effect on an unrelated command.
 */
export const uiCaptureRecipeSchema = z
  .object({
    // Non-blank, not merely non-empty: `/bin/sh -c '   '` exits 0, so a
    // whitespace-only command would advance the receipt without any capture
    // having run — the exact false-fresh this feature exists to remove.
    command: z.string().refine((c) => c.trim().length > 0, {
      message: 'uiCapture command must not be blank',
    }),
    // Rejected at validate when out of contract, never clamped — same posture
    // as `UiBootRecipeSchema.captureTimeoutMs`.
    timeoutMs: z.number().int().min(1).max(600_000).default(300_000),
  })
  .strict();

export type UiCaptureRecipe = z.infer<typeof uiCaptureRecipeSchema>;

/**
 * A declined toolchain-floor requirement. `id` is the floor check's id (see
 * `src/invariants/toolchain-floor.ts`); `reason` is why this repo does not meet
 * it. A waiver does not silence the finding — it downgrades it to a `warn` that
 * quotes the reason, so a deliberate exception stays visible in every run
 * instead of vanishing. Same idiom as `release.crGateExemptCommits`.
 */
export const ToolchainWaiverSchema = z
  .object({
    id: z.string().min(1),
    reason: z.string().min(20),
  })
  .strict();

export type ToolchainWaiver = z.infer<typeof ToolchainWaiverSchema>;

/** Per-consumer toolchain-floor config. Absent ⇒ nothing waived. */
export const ToolchainFloorSchema = z
  .object({
    waivers: z.array(ToolchainWaiverSchema).default([]),
  })
  .strict();

export type ToolchainFloor = z.infer<typeof ToolchainFloorSchema>;

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
    /** Release-notes categories. Grows over a project's life (see `/noldor-triage`). */
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
     * Globs naming this consumer's UI source (e.g. `src/dashboard/app/**`).
     * Drives the UI-design-stage predicate (`src/core/ui-predicate.ts`).
     * Absent or empty ⇒ the design stage never fires for this consumer.
     */
    uiPaths: z.array(UiGlobSchema).optional(),
    /**
     * Surface name → glob subset, mapping UI code to baseline files
     * `docs/design/ui/baseline/<surface>.pen`. Absent with `uiPaths` present ⇒
     * one implicit surface `app` covering all of `uiPaths`.
     */
    uiSurfaces: z
      .record(z.string().regex(SURFACE_NAME_RE), z.array(UiGlobSchema).min(1))
      .optional(),
    /**
     * Per-surface boot recipes for the render-compare CR lane (spec R2). Keys
     * must be declared in `uiSurfaces`; cross-checks live in the schema-level
     * superRefine below so `validate noldor-config` rejects a drifted block.
     */
    uiBoot: z.record(z.string().regex(SURFACE_NAME_RE), UiBootRecipeSchema).optional(),
    /**
     * Per-surface capture commands for `noldor design capture`. Unlike
     * `uiBoot`, a key may also be the IMPLICIT `app` surface that exists when
     * `uiPaths` is set and `uiSurfaces` is not — the cross-check below allows
     * it, because requiring a `uiSurfaces` declaration would lock out the only
     * shape a `uiPaths`-only consumer can express.
     */
    uiCapture: z.record(z.string().regex(SURFACE_NAME_RE), uiCaptureRecipeSchema).optional(),
    /**
     * Floor requirements this repo deliberately does not meet, each with a
     * reason. Read by the `toolchain-floor` invariant. Absent ⇒ the full floor
     * applies.
     */
    toolchainFloor: ToolchainFloorSchema.optional(),
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
  .strict()
  // Cross-field checks for `uiBoot` (spec R2/AC3): a recipe key must be a
  // declared surface, its `verifyCommand` must resolve to a `kind: "server"`
  // entry, and the surface-name set must survive artifact-name sanitization
  // without collisions. Schema-level so every loadConsumerConfig caller —
  // `validate noldor-config` included — rejects a drifted block at parse time.
  .superRefine((cfg, ctx) => {
    const surfaceNames = [
      ...new Set([
        ...Object.keys(cfg.uiSurfaces ?? {}),
        ...Object.keys(cfg.uiBoot ?? {}),
        ...Object.keys(cfg.uiCapture ?? {}),
      ]),
    ];
    for (const issue of sanitizationIssues(surfaceNames)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['uiSurfaces'], message: issue });
    }
    // `uiCapture` keys: a declared `uiSurfaces` surface, or the implicit `app`
    // surface when `uiSurfaces` is absent. Anything else is an orphan whose
    // capture could never be reached by a verdict, so it is rejected rather
    // than silently ignored.
    if (cfg.uiCapture !== undefined) {
      // Nothing is UI-bearing without `uiPaths`, so `design capture` would
      // refuse every surface and the declared commands could never run. A
      // config that validates while being permanently unreachable is worse than
      // one that fails to parse.
      if ((cfg.uiPaths ?? []).length === 0 && Object.keys(cfg.uiCapture).length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['uiCapture'],
          message:
            'uiCapture is declared but uiPaths is absent or empty — nothing is UI-bearing, so no capture could ever run',
        });
      }
      for (const surface of Object.keys(cfg.uiCapture)) {
        const declared = Object.hasOwn(cfg.uiSurfaces ?? {}, surface);
        const implicitApp = cfg.uiSurfaces === undefined && surface === IMPLICIT_SURFACE;
        if (!declared && !implicitApp) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['uiCapture', surface],
            message:
              cfg.uiSurfaces === undefined
                ? `uiCapture surface '${surface}' is not '${IMPLICIT_SURFACE}'; with no uiSurfaces block the only surface is the implicit '${IMPLICIT_SURFACE}'`
                : `uiCapture surface '${surface}' is not declared in uiSurfaces`,
          });
        }
      }
    }

    if (cfg.uiBoot === undefined) return;
    for (const [surface, recipe] of Object.entries(cfg.uiBoot)) {
      if (!Object.hasOwn(cfg.uiSurfaces ?? {}, surface)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['uiBoot', surface],
          message: `uiBoot surface '${surface}' is not declared in uiSurfaces`,
        });
      }
      const target = Object.hasOwn(cfg.verifyCommands, recipe.verifyCommand)
        ? cfg.verifyCommands[recipe.verifyCommand]
        : undefined;
      if (target === undefined || target.kind !== 'server') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['uiBoot', surface, 'verifyCommand'],
          message:
            target === undefined
              ? `uiBoot.${surface}.verifyCommand '${recipe.verifyCommand}' matches no consumer.verifyCommands entry`
              : `uiBoot.${surface}.verifyCommand '${recipe.verifyCommand}' must reference a kind: "server" entry (found kind: "${target.kind}")`,
        });
      }
    }
  });

export type ConsumerConfig = z.infer<typeof ConsumerConfigSchema>;
export type BoundaryRule = z.infer<typeof BoundaryRuleSchema>;

/**
 * The consumer's UI-design config slice (`uiPaths`/`uiSurfaces`), or `null`
 * when no consumer config file exists — the one boundary where every UI-design
 * caller (freshness CLI, ui-sync, doctor, release preflight) must treat a
 * MISSING config as "feature not adopted". A config that exists but fails to
 * parse still throws: swallowing it would silently disable the blocking
 * release check for a repo that did adopt the feature.
 */
export function loadUiConfig(cwd: string): {
  uiPaths?: string[];
  uiSurfaces?: Record<string, string[]>;
  uiCapture?: Record<string, UiCaptureRecipe>;
} | null {
  if (!existsSync(join(cwd, CONFIG_FILE))) return null;
  const consumer = loadConsumerConfig(cwd);
  return {
    uiPaths: consumer.uiPaths,
    uiSurfaces: consumer.uiSurfaces,
    uiCapture: consumer.uiCapture,
  };
}

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
