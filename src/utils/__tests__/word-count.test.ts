// @tests: consumer-architecture-doc-surface
import { describe, expect, it } from 'vitest';

import { countWords } from '../word-count.js';

describe(countWords, () => {
  it('counts whitespace-separated tokens', () => {
    expect(countWords('one two three')).toBe(3);
  });

  it('is empty-safe', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n  ')).toBe(0);
  });

  it('collapses runs of whitespace, including newlines', () => {
    expect(countWords('one   two\n\nthree\t four')).toBe(4);
  });
});
