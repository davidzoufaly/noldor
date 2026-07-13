import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { artifactKindSchema, laneSchema } from './lanes.js';
import type { ArtifactKind, Lane } from './lanes.js';
import { agentsConfigSchema } from './agent-runner/types.js';
import { DEFAULT_REVIEW_PROFILES, reviewProfileSchema } from './review-profile.js';
import type { ReviewProfile } from './review-profile.js';

/**
 * Default session-marker time-to-live, in hours. A stale-eligible session
 * (`micro-chore` / `release-sweep`) older than this reads as stale at
 * pre-commit. Lives beside {@link resolveSessionTtlHours} in the core config
 * loader, naturally next to its `core/session.ts` consumers.
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
  // Governs ONLY the verify lane's agent judgment; the smoke floor blocks in
  // both modes (stop-the-line). Advisory default = one bake-in release.
  verifyMode: z.enum(['blocking', 'advisory']).default('advisory'),
  // Wall-clock cap per item is the existing --iteration-timeout flag (30 min default), not a
  // duplicate rail here. Token-budget rail deliberately omitted: no token accounting exists yet.
  watch: watchConfigSchema.optional(),
});

export const gateConfigSchema = z.object({
  sessionTtlHours: z.number().positive(),
});

export const crReviewConfigSchema = z.object({
  profiles: z.record(z.string(), reviewProfileSchema).optional(),
});

/**
 * One acknowledged release-CR-gate offender: a commit that shipped without a
 * review receipt (e.g. pre-rollout-marker history) which `checkCrGate` should
 * wave through per-SHA instead of the whole-check `RELEASE_SKIP_CR_GATE=1`
 * skip. `sha` is a hex prefix of the full commit SHA — min 7 chars so a typo
 * cannot blanket-match — and `reason` is required: the committed config diff
 * is the audit trail.
 */
export const crGateExemptionSchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{7,40}$/),
  reason: z.string().min(1),
});

/**
 * Registry-publish verification block. `enabled` defaults FALSE so every
 * consumer running the vendored release pipeline (Charuy, the contract
 * fixture) keeps byte-identical behaviour with no config change; only the
 * framework repo opts in. The tag-triggered publish.yml workflow is the
 * publish EXECUTOR (GitHub Packages, authed with the built-in `GITHUB_TOKEN`);
 * the values here drive the local pipeline's registry poll target and log
 * lines (`distTag` is echoed; the workflow hard-codes `latest` pre-1.0).
 */
export const releasePublishConfigSchema = z.object({
  enabled: z.boolean().default(false),
  registry: z.string().url().default('https://npm.pkg.github.com'),
  distTag: z.string().default('latest'),
});

/** Parsed `release.publish` block. */
export type ReleasePublishConfig = z.infer<typeof releasePublishConfigSchema>;

/** Release-enforcement tuning — the `release:` block of `.noldor/config.json`. */
export const releaseConfigSchema = z.object({
  crGateExemptCommits: z.array(crGateExemptionSchema).default([]),
  publish: releasePublishConfigSchema.optional(),
});

/** One parsed {@link crGateExemptionSchema} entry. */
export type CrGateExemption = z.infer<typeof crGateExemptionSchema>;
/** Parsed `release:` block. */
export type ReleaseConfig = z.infer<typeof releaseConfigSchema>;

/**
 * One expected-override declaration for the override-audit detector. Matches
 * collected `Noldor-Path-Override` commits by SHA prefix and/or reason
 * substring; when BOTH fields are set, both must match (narrower is safer — a
 * broad `reasonIncludes` must not silently absorb unrelated overrides). At
 * least one matching field is required. `note` documents why the noise is
 * expected; the committed config diff is the audit trail.
 */
export const expectedOverrideSchema = z
  .object({
    shaPrefix: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/)
      .optional(),
    reasonIncludes: z.string().min(1).optional(),
    note: z.string().min(1),
  })
  .refine(
    (e) => e.shaPrefix !== undefined || e.reasonIncludes !== undefined,
    'need shaPrefix or reasonIncludes',
  );

/** Garden-detector tuning — the `garden:` block of `.noldor/config.json`. */
export const gardenConfigSchema = z.object({
  overrideAudit: z
    .object({
      threshold: z.number().int().positive().optional(),
      expected: z.array(expectedOverrideSchema).default([]),
    })
    .optional(),
});

/** One parsed {@link expectedOverrideSchema} rule. */
export type ExpectedOverride = z.infer<typeof expectedOverrideSchema>;
/** Parsed `garden:` block. */
export type GardenConfig = z.infer<typeof gardenConfigSchema>;

/**
 * Clone-detector knobs — the `clones:` block of `.noldor/config.json`.
 * Every field (and the block itself, at the `noldorConfigSchema` key) degrades
 * to unset on malformed input via `.catch(undefined)` so a config typo cannot
 * throw out of every `loadConfig` caller — `clones check` treats an unset
 * threshold as green.
 */
export const clonesConfigSchema = z.object({
  minTokens: z.number().int().positive().optional().catch(undefined),
  minLines: z.number().int().positive().optional().catch(undefined),
  gapTokens: z.number().int().positive().optional().catch(undefined),
  thresholdPct: z.number().positive().optional().catch(undefined),
});

/** Parsed `clones:` block. */
export type ClonesConfig = z.infer<typeof clonesConfigSchema>;

export const noldorConfigSchema = z.object({
  crLanes: crLanesConfigSchema.optional(),
  crReview: crReviewConfigSchema.optional(),
  autonomous: autonomousConfigSchema.optional(),
  gate: gateConfigSchema.optional(),
  agents: agentsConfigSchema.optional(),
  release: releaseConfigSchema.optional(),
  garden: gardenConfigSchema.optional(),
  clones: clonesConfigSchema.optional().catch(undefined),
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

/**
 * Resolves the effective review profile for `name` (default `'default'`):
 * a configured `crReview.profiles[name]`, else the built-in
 * {@link DEFAULT_REVIEW_PROFILES}[name], else the `default` built-in. Never
 * throws on an unknown name — falls back to the richer default (fails safe:
 * more review, not less). Mirrors {@link resolveSessionTtlHours}.
 */
export function resolveReviewProfile(config: NoldorConfig | null, name = 'default'): ReviewProfile {
  return (
    config?.crReview?.profiles?.[name] ??
    DEFAULT_REVIEW_PROFILES[name] ??
    DEFAULT_REVIEW_PROFILES.default
  );
}
