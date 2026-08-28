// @tests: unvalidated-slug-path-traversal-across-cli-entry-points
import { describe, expect, it } from 'vitest';

import { parseSlugList, requireFlagValue } from '../slug.js';

describe('parseSlugList', () => {
  it('parses every member, not just the first', () => {
    // The bug a list parser invites: validate entry one, trust the rest. Both
    // members here are path components, so both must be checked.
    expect(() => parseSlugList('good-one,../../../escape')).toThrow(/invalid slug/);
  });

  it('names the offending member in the error', () => {
    expect(() => parseSlugList('a-b, BadSlug')).toThrow(/BadSlug/);
  });

  it('accepts a well-formed list, trimmed, with empties dropped', () => {
    expect(parseSlugList(' a-b , c-d ,')).toEqual(['a-b', 'c-d']);
  });

  it('returns an empty list for an empty string', () => {
    expect(parseSlugList('')).toEqual([]);
  });
});

describe('requireFlagValue', () => {
  it('refuses a missing value rather than coalescing to empty', () => {
    // Coalescing to '' made a trailing `--slugs` read as "no filter requested"
    // instead of a malformed command — a silent change in what runs.
    expect(() => requireFlagValue(undefined, '--slugs')).toThrow(/--slugs requires a value/);
  });

  it('refuses the next flag being consumed as the value', () => {
    expect(() => requireFlagValue('--json', '--slugs')).toThrow(/--slugs requires a value/);
  });

  it('returns a real value', () => {
    expect(requireFlagValue('a-b,c-d', '--slugs')).toBe('a-b,c-d');
  });
});
