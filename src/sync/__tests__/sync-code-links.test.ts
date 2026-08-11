// @tests: dynamic-fd-file-pointers-via-frontmatter

import { describe, expect, it } from 'vitest';

import {
  buildSlugToCodeMap,
  diffProjection,
  extractFdTags,
  projectLinksCode,
  taglessKeptSlugs,
} from '../sync-code-links.js';

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

  it('does not flag an FD the write path would skip (no tags, curated links kept)', () => {
    const cached = new Map<string, string[]>([['foo', ['src/a.ts', 'src/b.ts']]]);
    expect(diffProjection(new Map(), cached)).toEqual([]);
  });

  it('does not flag a tagless FD whose links.code holds only directory entries', () => {
    const cached = new Map<string, string[]>([['foo', ['packages/scenes']]]);
    expect(diffProjection(new Map(), cached)).toEqual([]);
  });
});

describe('taglessKeptSlugs', () => {
  it('names every FD the write path would skip, sorted', () => {
    const cached = new Map<string, string[]>([
      ['zeta', ['src/z.ts']],
      ['alpha', ['src/a.ts', 'packages/scenes']],
      ['tagged', ['src/t.ts']],
      ['dirs-only', ['packages/scenes']],
    ]);
    const scanned = new Map<string, string[]>([['tagged', ['src/t.ts']]]);
    expect(taglessKeptSlugs(scanned, cached)).toEqual(['alpha', 'zeta']);
  });

  it('returns [] when every FD is tag-driven', () => {
    const m = new Map<string, string[]>([['foo', ['src/a.ts']]]);
    expect(taglessKeptSlugs(m, new Map(m))).toEqual([]);
  });
});

describe('projectLinksCode', () => {
  it('merges the scan with preserved directory entries, deduped and sorted', () => {
    expect(
      projectLinksCode(['src/b.ts', 'src/a.ts', 'src/a.ts'], ['src/a.ts', 'packages/scenes']),
    ).toEqual({ skipped: false, next: ['packages/scenes', 'src/a.ts', 'src/b.ts'] });
  });

  it('refuses to wipe a non-empty links.code when the scan matched no tags', () => {
    expect(projectLinksCode([], ['src/a.ts', 'src/b.ts'])).toEqual({ skipped: true });
  });

  it('wipes a tagless FD only under --force, keeping directory entries', () => {
    expect(projectLinksCode([], ['src/a.ts', 'packages/scenes'], true)).toEqual({
      skipped: false,
      next: ['packages/scenes'],
    });
  });

  it('does not skip a tagless FD whose cache holds only directory entries', () => {
    expect(projectLinksCode([], ['packages/scenes'])).toEqual({
      skipped: false,
      next: ['packages/scenes'],
    });
  });

  it('does not skip a tagless FD whose links.code is already empty', () => {
    expect(projectLinksCode([], [])).toEqual({ skipped: false, next: [] });
  });

  it('does not skip a partial drop — only a total wipe is guarded', () => {
    expect(projectLinksCode(['src/a.ts'], ['src/a.ts', 'src/b.ts'])).toEqual({
      skipped: false,
      next: ['src/a.ts'],
    });
  });
});
