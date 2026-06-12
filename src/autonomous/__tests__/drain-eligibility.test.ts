import { describe, expect, it } from 'vitest';
import { isDrainEligible } from '../drain-eligibility.js';

describe('isDrainEligible', () => {
  it('eligible: plain single-scope description', () => {
    expect(isDrainEligible('Fix the off-by-one in the token expiry check.')).toBe(true);
  });

  it('ineligible: contains a Touches: clause', () => {
    expect(isDrainEligible('Do the thing.\n\nTouches: src/a.ts, src/b.ts')).toBe(false);
  });

  it('ineligible: Touches: appears mid-paragraph (not at line start)', () => {
    expect(
      isDrainEligible('Make it ineligible upfront and match Touches: src/a.ts anywhere.'),
    ).toBe(false);
  });

  it('eligible: lowercase "touches:" prose is not the scope marker (case-sensitive)', () => {
    expect(isDrainEligible('This change barely touches: nothing of note.')).toBe(true);
  });

  it('ineligible: more than one top-level scope bullet', () => {
    expect(isDrainEligible('- first scope item\n- second scope item')).toBe(false);
  });

  it('eligible: a single top-level bullet is fine', () => {
    expect(isDrainEligible('- only one bullet of detail')).toBe(true);
  });

  it('eligible: empty / undefined description', () => {
    expect(isDrainEligible('')).toBe(true);
    expect(isDrainEligible(undefined)).toBe(true);
  });
});
