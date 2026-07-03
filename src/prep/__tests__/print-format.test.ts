// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
import { describe, expect, it } from 'vitest';

import { PLAN_FORMAT, SPEC_FORMAT } from '../formats.js';
import { formatForKind } from '../print-format.js';

describe('formatForKind', () => {
  it('returns SPEC_FORMAT for spec', () => {
    expect(formatForKind('spec')).toBe(SPEC_FORMAT);
  });

  it('returns PLAN_FORMAT for plan', () => {
    expect(formatForKind('plan')).toBe(PLAN_FORMAT);
  });

  it('returns null for unknown kinds', () => {
    expect(formatForKind('bogus')).toBeNull();
    expect(formatForKind('')).toBeNull();
  });
});
