import { z } from 'zod';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const semver = z.string().regex(SEMVER_RE, 'Expected semver (major.minor.patch)');

/**
 * User-facing release-notes category — a free-form string validated against
 * the consumer's configured set (`.noldor/config.json` → `categories`) by
 * `validate-features`, NOT pinned to a hardcoded enum here. This keeps the
 * taxonomy consumer-owned and growable (see `/triage`, `/promote`). Coarser
 * than the internal `area`; used to group features in `docs/release-notes.md`.
 */
export type Category = string;

/**
 * Sentinel value for `links.spec` / `links.plan` marking a Charuy-era design
 * artifact that never migrated into this repo (written by
 * `features migrate-link-rot`). Renderers show it as plain text and the
 * fd-link-rot detector skips it — it is deliberately not a path.
 */
export const LOST_SENTINEL = 'lost-pre-extraction';

const LinksSchema = z
  .object({
    code: z.array(z.string()).default([]),
    docs: z.array(z.string()).default([]),
    plan: z.union([z.string(), z.array(z.string())]).optional(),
    spec: z.string().optional(),
    tests: z.array(z.string()).default([]),
  })
  .strict();

/**
 * Feature-MD frontmatter schema.
 *
 * `introduced` is always optional:
 * - phase=in-progress + introduced absent → typical pre-ship state
 * - phase=in-progress + introduced present → attach-revert lifecycle;
 *   release-markers will restore phase=done on the next release
 * - phase=done + introduced absent → code-complete, awaiting next release
 *   cut. `pnpm release` fills introduced on its next run.
 * - phase=done + introduced present → shipped; `updated` may optionally
 *   track post-ship modifications.
 */
export const FeatureFrontmatterSchema = z
  .object({
    area: z.string().min(1),
    category: z.string().min(1),
    deps: z.array(z.string().min(1)).default([]),
    introduced: semver.optional(),
    links: LinksSchema,
    name: z.string().min(1),
    packages: z.array(z.string().min(1)).min(1),
    phase: z.enum(['done', 'in-progress']),
    /** Roadmap intake date (ISO yyyy-mm-dd), copied from the source block's `- since:` by /promote. Optional — historical FDs recover intake from roadmap git history (metrics `intake[]`). YAML parses unquoted dates as Date objects, so coerce before validating. */
    since: z
      .preprocess(
        (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
        z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, 'Expected ISO date (yyyy-mm-dd)')
          .transform((s) => s.slice(0, 10)),
      )
      .optional(),
    'noldor-tier': z.enum(['specs-only', 'full']),
    updated: semver.optional(),
    /** Optional milestone membership — the slug of a docs/milestones/<slug>.md
     *  file (filename stem == milestone frontmatter `name`). Absent by default;
     *  the framework never requires a milestone. Cross-checked against the
     *  milestones dir by validate-features (dangling reference = error). */
    milestone: z.string().min(1).optional(),
    /** Optional: the feature introduces a release-time gate its own commits
     *  cannot satisfy (the enforcement code didn't exist when they were authored).
     *  Value is a gate-registry key (src/cr/gate-registry.ts), e.g. `codex-cr`.
     *  Drives `/gate` Step 4 bootstrap-immunity (auto-stamps the matching override
     *  on the branch's commits). Absent by default. */
    'introduces-gate': z.string().min(1).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.updated !== undefined && data.introduced === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['updated'],
        message:
          "'updated' present without 'introduced' — a feature can't be updated before it shipped.",
      });
    }
  });

/** Validated feature MD frontmatter (z.infer of FeatureFrontmatterSchema). */
export type FeatureFrontmatter = z.infer<typeof FeatureFrontmatterSchema>;
