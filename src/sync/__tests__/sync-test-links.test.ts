import { buildSlugToTestsMap, extractTags } from '../sync-test-links.js';

describe(extractTags, () => {
  it('parses a single-slug tag comment', () => {
    const content = '// @tests: undo-redo\nimport { describe } from "vitest";\n';
    expect(extractTags(content)).toStrictEqual(['undo-redo']);
  });

  it('parses a multi-slug tag comment', () => {
    const content = '// @tests: undo-redo, state-management\n// other\n';
    expect(extractTags(content)).toStrictEqual(['undo-redo', 'state-management']);
  });

  it('trims whitespace around slugs', () => {
    const content = '// @tests:   undo-redo ,  state-management  \n';
    expect(extractTags(content)).toStrictEqual(['undo-redo', 'state-management']);
  });

  it('returns empty array when no tag present', () => {
    const content = 'import { describe } from "vitest";\n// regular comment\n';
    expect(extractTags(content)).toStrictEqual([]);
  });

  it('only reads the first @tests comment (ignores subsequent mentions)', () => {
    const content = '// @tests: first-slug\n// @tests: second-slug\n';
    expect(extractTags(content)).toStrictEqual(['first-slug']);
  });
});

describe(buildSlugToTestsMap, () => {
  it('groups test paths by their tagged slugs', () => {
    const input = [
      { path: 'a.test.ts', tags: ['undo-redo', 'state-management'] },
      { path: 'b.test.ts', tags: ['state-management'] },
      { path: 'c.test.ts', tags: ['undo-redo'] },
    ];
    const map = buildSlugToTestsMap(input);
    expect(map.get('undo-redo')).toStrictEqual(['a.test.ts', 'c.test.ts']);
    expect(map.get('state-management')).toStrictEqual(['a.test.ts', 'b.test.ts']);
  });

  it('omits untagged test paths entirely', () => {
    const input = [
      { path: 'a.test.ts', tags: [] },
      { path: 'b.test.ts', tags: ['undo-redo'] },
    ];
    const map = buildSlugToTestsMap(input);
    expect(map.size).toBe(1);
    expect(map.get('undo-redo')).toStrictEqual(['b.test.ts']);
  });

  it('deduplicates repeated paths under the same slug', () => {
    const input = [{ path: 'a.test.ts', tags: ['x', 'x'] }];
    const map = buildSlugToTestsMap(input);
    expect(map.get('x')).toStrictEqual(['a.test.ts']);
  });
});
