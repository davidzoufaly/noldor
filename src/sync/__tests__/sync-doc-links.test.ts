import { buildSlugToDocsMap, extractFeatureTags } from '../sync-doc-links.js';

describe(extractFeatureTags, () => {
  it('parses a single-slug @feature comment', () => {
    const md = '<!-- @feature: undo-redo -->\n# Title\n';
    expect(extractFeatureTags(md)).toStrictEqual(['undo-redo']);
  });

  it('parses a multi-slug @feature comment', () => {
    const md = '<!-- @feature: undo-redo, keyboard-shortcuts -->\n# Title\n';
    expect(extractFeatureTags(md)).toStrictEqual(['undo-redo', 'keyboard-shortcuts']);
  });

  it('returns empty array when no tag', () => {
    const md = '# Title\n\nNo tag.\n';
    expect(extractFeatureTags(md)).toStrictEqual([]);
  });

  it('only reads the first @feature comment', () => {
    const md = '<!-- @feature: first -->\n<!-- @feature: second -->\n';
    expect(extractFeatureTags(md)).toStrictEqual(['first']);
  });
});

describe(buildSlugToDocsMap, () => {
  it('groups doc paths by tagged slugs', () => {
    const map = buildSlugToDocsMap([
      { path: 'a.md', tags: ['undo-redo', 'keyboard-shortcuts'] },
      { path: 'b.md', tags: ['undo-redo'] },
    ]);
    expect(map.get('undo-redo')).toStrictEqual(['a.md', 'b.md']);
    expect(map.get('keyboard-shortcuts')).toStrictEqual(['a.md']);
  });

  it('omits untagged docs entirely', () => {
    const map = buildSlugToDocsMap([
      { path: 'a.md', tags: [] },
      { path: 'b.md', tags: ['x'] },
    ]);
    expect(map.size).toBe(1);
  });
});
