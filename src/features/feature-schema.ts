import { z } from 'zod';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const semver = z.string().regex(SEMVER_RE, 'Expected semver (major.minor.patch)');

/**
 * User-facing release-notes category. Coarser than the internal `area`
 * taxonomy; used to group features in `docs/release-notes.md`.
 */
export const CATEGORIES = [
  'Modeling',
  'Editor',
  'Agents',
  'Distribution',
  'Docs',
  'Tooling',
  'Other',
] as const;

/** One of the user-facing release-notes categories. */
export type Category = (typeof CATEGORIES)[number];

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
    category: z.enum(CATEGORIES),
    deps: z.array(z.string().min(1)).default([]),
    introduced: semver.optional(),
    links: LinksSchema,
    name: z.string().min(1),
    packages: z.array(z.string().min(1)).min(1),
    phase: z.enum(['done', 'in-progress']),
    'noldor-tier': z.enum(['specs-only', 'full']),
    updated: semver.optional(),
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
