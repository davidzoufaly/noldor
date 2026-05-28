import { z } from 'zod';

import { CATEGORIES } from '../features/feature-schema.js';

/**
 * How-to MD frontmatter schema.
 *
 * Used by `scripts/docs-howto.ts` to validate hand-written how-to guides
 * under `docs/user/how-to/` before generating the index.
 *
 * `title` enforces the Diátaxis "How to <goal>" naming convention so the
 * index reads as a list of user goals, not feature names.
 *
 * `category` reuses the user-facing release-notes enum so how-to grouping
 * matches the rest of the project taxonomy.
 */
export const howtoFrontmatterSchema = z
  .object({
    category: z.enum(CATEGORIES),
    title: z
      .string()
      .min(1)
      .regex(/^How to \S/, 'Expected title to start with "How to "'),
  })
  .strict();

/** Validated how-to MD frontmatter. */
export type HowtoFrontmatter = z.infer<typeof howtoFrontmatterSchema>;
