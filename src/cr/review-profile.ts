import { z } from 'zod';

export const reviewEffortSchema = z.enum(['low', 'med', 'high', 'max']);
export type ReviewEffort = z.infer<typeof reviewEffortSchema>;

export const reviewDimensionSchema = z.enum([
  'correctness',
  'security',
  'reuse',
  'simplification',
  'efficiency',
  'altitude',
]);
export type ReviewDimension = z.infer<typeof reviewDimensionSchema>;

export const reviewProfileSchema = z.object({
  effort: reviewEffortSchema,
  dimensions: z.array(reviewDimensionSchema).min(1),
});
export type ReviewProfile = z.infer<typeof reviewProfileSchema>;

export const ALL_DIMENSIONS: ReviewDimension[] = [
  'correctness',
  'security',
  'reuse',
  'simplification',
  'efficiency',
  'altitude',
];

/**
 * Built-in profiles, used when `crReview.profiles.<name>` is absent.
 * `default` = a full med-effort sweep across every dimension. `fast-track`
 * = a scoped low-effort correctness+security pass for XS/S no-FD changes.
 */
export const DEFAULT_REVIEW_PROFILES: Record<string, ReviewProfile> = {
  default: { effort: 'med', dimensions: ALL_DIMENSIONS },
  'fast-track': { effort: 'low', dimensions: ['correctness', 'security'] },
};
