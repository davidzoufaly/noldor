// @tests: dynamic-fd-file-pointers-via-frontmatter

import { describe, expect, it } from 'vitest';

import { buildSlugToCodeMap, diffProjection, extractFdTags } from '../sync-code-links.js';

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

describe('diffProjection', () => {
  it('returns stale FDs where cached links.code != scanned', () => {
    const scanned = new Map<string, string[]>([['foo', ['src/a.ts', 'src/b.ts']]]);
    const cached = new Map<string, string[]>([['foo', ['src/a.ts']]]);
    expect(diffProjection(scanned, cached)).toEqual([
      { slug: 'foo', scanned: ['src/a.ts', 'src/b.ts'], cached: ['src/a.ts'] },
    ]);
  });

  it('ignores directory entries in the cache (kept, not flagged)', () => {
    const scanned = new Map<string, string[]>([['foo', ['src/a.ts']]]);
    const cached = new Map<string, string[]>([['foo', ['src/a.ts', 'packages/sample-scenes']]]);
    expect(diffProjection(scanned, cached)).toEqual([]);
  });

  it('returns [] when every FD matches', () => {
    const m = new Map<string, string[]>([['foo', ['src/a.ts']]]);
    expect(diffProjection(m, new Map(m))).toEqual([]);
  });
});
