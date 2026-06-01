import { z } from 'zod';

/**
 * How-to MD frontmatter schema.
 *
 * Used by `src/docs/docs-howto.ts` to validate hand-written how-to guides
 * under `docs/user/how-to/` before generating the index.
 *
 * `title` enforces the Diátaxis "How to <goal>" naming convention so the
 * index reads as a list of user goals, not feature names.
 *
 * `category` is a free-form string matching the project's release-notes
 * taxonomy; membership in the configured set is enforced where the index is
 * generated, not pinned to a hardcoded enum here.
 */
export const howtoFrontmatterSchema = z
  .object({
    category: z.string().min(1),
    title: z
      .string()
      .min(1)
      .regex(/^How to \S/, 'Expected title to start with "How to "'),
  })
  .strict();

/** Validated how-to MD frontmatter. */
export type HowtoFrontmatter = z.infer<typeof howtoFrontmatterSchema>;
