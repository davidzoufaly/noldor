// @tests: noldor
import { describe, expect, it } from 'vitest';

import { sizeSkipsSpec, sizeToPath, sizeToTier } from '../size-routing.js';

describe(sizeSkipsSpec, () => {
  it('returns true for the no-spec sizes XS and S', () => {
    expect(sizeSkipsSpec('XS')).toBe(true);
    expect(sizeSkipsSpec('S')).toBe(true);
  });

  it('returns false for the spec-bearing sizes M, L, XL', () => {
    expect(sizeSkipsSpec('M')).toBe(false);
    expect(sizeSkipsSpec('L')).toBe(false);
    expect(sizeSkipsSpec('XL')).toBe(false);
  });

  it('treats missing or unknown size as spec-bearing (false) — never silently skips review', () => {
    expect(sizeSkipsSpec(undefined)).toBe(false);
    expect(sizeSkipsSpec('')).toBe(false);
    expect(sizeSkipsSpec('Huge')).toBe(false);
  });
});

describe(sizeToTier, () => {
  it('maps L and XL to full', () => {
    expect(sizeToTier('L')).toBe('full');
    expect(sizeToTier('XL')).toBe('full');
  });

  it('maps M to specs-only', () => {
    expect(sizeToTier('M')).toBe('specs-only');
  });

  it('defaults missing or unknown size to specs-only', () => {
    expect(sizeToTier(undefined)).toBe('specs-only');
    expect(sizeToTier('Huge')).toBe('specs-only');
  });
});

describe(sizeToPath, () => {
  it('routes XS/S to fast-track regardless of parent (no FD, no spec)', () => {
    expect(sizeToPath('XS', false)).toBe('fast-track');
    expect(sizeToPath('XS', true)).toBe('fast-track');
    expect(sizeToPath('S', false)).toBe('fast-track');
    expect(sizeToPath('S', true)).toBe('fast-track');
  });

  it('routes M to specs-only, new or attach by parent presence', () => {
    expect(sizeToPath('M', false)).toBe('specs-only-new');
    expect(sizeToPath('M', true)).toBe('specs-only-attach');
  });

  it('routes L/XL to full, new or attach by parent presence', () => {
    expect(sizeToPath('L', false)).toBe('full-new');
    expect(sizeToPath('L', true)).toBe('full-attach');
    expect(sizeToPath('XL', false)).toBe('full-new');
    expect(sizeToPath('XL', true)).toBe('full-attach');
  });

  it('defaults missing/unknown size to specs-only-new (or attach with parent)', () => {
    expect(sizeToPath(undefined, false)).toBe('specs-only-new');
    expect(sizeToPath(undefined, true)).toBe('specs-only-attach');
    expect(sizeToPath('Huge', false)).toBe('specs-only-new');
  });
});
