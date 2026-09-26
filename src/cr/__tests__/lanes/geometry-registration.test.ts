// @tests: ui-design-review-lane
import { describe, expect, it } from 'vitest';

import { autonomousConfigSchema } from '../../../core/config.js';
import { LANE_NAMES, laneSchema } from '../../../core/lanes.js';
import { laneReasonCodeSchema } from '../../findings-schema.js';

describe('geometry-compare registration', () => {
  it('adds the mode knob with a fail-soft advisory default', () => {
    expect(autonomousConfigSchema.parse({}).geometryCompareMode).toBe('advisory');
    expect(autonomousConfigSchema.safeParse({ geometryCompareMode: 'blocking' }).success).toBe(
      true,
    );
    expect(autonomousConfigSchema.safeParse({ geometryCompareMode: 'sometimes' }).success).toBe(
      false,
    );
  });

  it('adds one reason code per stage that can decline', () => {
    for (const code of [
      'no-geometry-recipe',
      'geometry-extract-failed',
      'geometry-capture-failed',
      'geometry-unparseable',
      'geometry-empty',
      'viewport-mismatch',
    ]) {
      expect(laneReasonCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it('is a canonical lane', () => {
    expect(LANE_NAMES).toContain('geometry-compare');
    expect(laneSchema.safeParse('geometry-compare').success).toBe(true);
  });
});
