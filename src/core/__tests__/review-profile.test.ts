// @tests: acceptance-verify-lane
import { describe, expect, it } from 'vitest';
import { ALL_DIMENSIONS, DEFAULT_REVIEW_PROFILES, reviewProfileSchema } from '../review-profile.js';

describe('review-profile', () => {
  it('ships default and fast-track built-in profiles', () => {
    expect(DEFAULT_REVIEW_PROFILES.default).toEqual({ effort: 'med', dimensions: ALL_DIMENSIONS });
    expect(DEFAULT_REVIEW_PROFILES['fast-track']).toEqual({
      effort: 'low',
      dimensions: ['correctness', 'security', 'reuse', 'simplification'],
    });
  });

  it('carries concurrency and effects as reviewable dimensions', () => {
    expect(ALL_DIMENSIONS).toContain('concurrency');
    expect(ALL_DIMENSIONS).toContain('effects');
  });

  it('rejects an empty dimensions list', () => {
    expect(() => reviewProfileSchema.parse({ effort: 'low', dimensions: [] })).toThrow();
  });

  it('rejects an unknown effort', () => {
    expect(() =>
      reviewProfileSchema.parse({ effort: 'turbo', dimensions: ['correctness'] }),
    ).toThrow();
  });
});
