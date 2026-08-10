// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import { splitClassTag } from '../finding-class.js';

describe('splitClassTag', () => {
  it('strips a [mechanical] tag', () => {
    expect(splitClassTag('[mechanical] Acceptance criteria section absent')).toEqual({
      class: 'mechanical',
      message: 'Acceptance criteria section absent',
    });
  });

  it('strips a [design] tag', () => {
    expect(splitClassTag('[design] The default inverts the fail-safe posture')).toEqual({
      class: 'design',
      message: 'The default inverts the fail-safe posture',
    });
  });

  it('is case-insensitive and normalizes the class to lower case', () => {
    expect(splitClassTag('[MECHANICAL] missing section').class).toBe('mechanical');
    expect(splitClassTag('[Design] wrong layer').class).toBe('design');
  });

  it('yields no class key when the bullet is untagged', () => {
    const r = splitClassTag('Acceptance criteria section absent');
    expect(r.class).toBeUndefined();
    expect(r.message).toBe('Acceptance criteria section absent');
    expect('class' in r).toBe(false);
  });

  it('leaves an unrecognized bracket prefix in the message', () => {
    expect(splitClassTag('[perf] avoidable O(n^2)')).toEqual({
      message: '[perf] avoidable O(n^2)',
    });
  });

  it('does not eat a bracket that appears later in the message', () => {
    const r = splitClassTag('the array[mechanical] index is wrong');
    expect(r.class).toBeUndefined();
    expect(r.message).toBe('the array[mechanical] index is wrong');
  });

  it('tolerates extra whitespace after the tag', () => {
    expect(splitClassTag('[mechanical]    missing section').message).toBe('missing section');
  });

  it('tolerates no whitespace after the tag', () => {
    expect(splitClassTag('[design]wrong default').message).toBe('wrong default');
  });

  // A tag-only bullet must not strip to `message: ''` — `findingSchema` requires
  // min(1), the lane writes its sink unvalidated, and `aggregate` would then fail
  // the whole file and replace every real blocker in it with one `schema error`.
  it('keeps a tag-only bullet as an untagged message rather than emptying it', () => {
    expect(splitClassTag('[mechanical]')).toEqual({ message: '[mechanical]' });
    expect(splitClassTag('[design]   ')).toEqual({ message: '[design]   ' });
  });
});
