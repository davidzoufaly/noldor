// @tests: dynamic-fd-file-pointers-via-frontmatter

import { describe, expect, it } from 'vitest';

import { buildSlugToCodeMap, extractFdTags } from '../sync-code-links.js';

describe('extractFdTags', () => {
  it('parses a single slug', () => {
    expect(extractFdTags('// @fd: foo\nimport x;')).toEqual(['foo']);
  });

  it('parses a comma-separated co-owned list, trimming whitespace', () => {
    expect(extractFdTags('// @fd: foo, bar ,baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('returns [] when no tag is present', () => {
    expect(extractFdTags('import x from "y";')).toEqual([]);
  });

  it('matches only a line-leading comment, not a mid-line mention', () => {
    expect(extractFdTags('const s = "@fd: foo";')).toEqual([]);
  });
});

describe('buildSlugToCodeMap', () => {
  it('groups paths by slug, deduped and sorted', () => {
    const map = buildSlugToCodeMap([
      { path: 'src/b.ts', tags: ['foo'] },
      { path: 'src/a.ts', tags: ['foo', 'bar'] },
      { path: 'src/a.ts', tags: ['foo'] },
    ]);
    expect(map.get('foo')).toEqual(['src/a.ts', 'src/b.ts']);
    expect(map.get('bar')).toEqual(['src/a.ts']);
  });
});
