// packages/noldor/src/release/__tests__/release-noise-types.test.ts
// @tests: fd-prs-since-last-release-section

import { describe, expect, it } from 'vitest';

import { NOISE_TYPES, stripBang } from '../release-noise-types.js';

describe('NOISE_TYPES', () => {
  it('contains chore, docs, test, style, ci, build', () => {
    expect(NOISE_TYPES).toEqual(new Set(['chore', 'docs', 'test', 'style', 'ci', 'build']));
  });
});

describe('stripBang', () => {
  it('strips trailing breaking marker', () => {
    expect(stripBang('feat!')).toBe('feat');
  });

  it('returns input unchanged when no bang', () => {
    expect(stripBang('feat')).toBe('feat');
  });
});
