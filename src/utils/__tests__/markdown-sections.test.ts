// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
import { describe, expect, it } from 'vitest';

import { extractSection, listHeadings } from '../markdown-sections.js';

describe('listHeadings', () => {
  it('returns H2 and H3 names with depth in document order', () => {
    const md = ['# Title', '## Alpha', 'body', '### Unit 1', 'more', '## Beta', ''].join('\n');
    expect(listHeadings(md)).toEqual([
      { name: 'Alpha', depth: 2 },
      { name: 'Unit 1', depth: 3 },
      { name: 'Beta', depth: 2 },
    ]);
  });

  it('ignores H1 and H4', () => {
    expect(listHeadings(['# One', '#### Four', '## Two'].join('\n'))).toEqual([
      { name: 'Two', depth: 2 },
    ]);
  });

  it('tolerates up-to-three-space indentation and strips closing hashes', () => {
    const md = ['   ## Indented ###', '    ## FourSpaces'].join('\n');
    expect(listHeadings(md)).toEqual([{ name: 'Indented', depth: 2 }]);
  });

  it('ignores headings inside backtick and tilde fences', () => {
    const md = ['## Real', '```', '## Fenced', '```', '~~~', '## Tilded', '~~~', '## Also'].join(
      '\n',
    );
    expect(listHeadings(md).map((h) => h.name)).toEqual(['Real', 'Also']);
  });

  it('ignores headings inside fences longer than three characters', () => {
    const md = ['````md', '## Inside', '````', '## Outside'].join('\n');
    expect(listHeadings(md).map((h) => h.name)).toEqual(['Outside']);
  });

  it('does not let a shorter run close a longer fence', () => {
    const md = ['````', '```', '## StillInside', '````', '## Outside'].join('\n');
    expect(listHeadings(md).map((h) => h.name)).toEqual(['Outside']);
  });

  it('ignores headings inside a fence indented up to three spaces', () => {
    const md = ['   ```', '## Inside', '   ```', '## Outside'].join('\n');
    expect(listHeadings(md).map((h) => h.name)).toEqual(['Outside']);
  });

  it('does not close on a mismatched marker character', () => {
    const md = ['```', '~~~', '## StillInside', '```', '## Outside'].join('\n');
    expect(listHeadings(md).map((h) => h.name)).toEqual(['Outside']);
  });

  it('does not close when the run is followed by non-whitespace', () => {
    const md = ['```', '``` trailing text', '## StillInside', '```', '## Outside'].join('\n');
    expect(listHeadings(md).map((h) => h.name)).toEqual(['Outside']);
  });

  it('swallows everything after an unclosed fence', () => {
    const md = ['## Before', '```', '## After'].join('\n');
    expect(listHeadings(md).map((h) => h.name)).toEqual(['Before']);
  });

  it('rejects a backtick opening whose info string contains a backtick', () => {
    // Not a fence open, so the heading below stays visible.
    const md = ['``` js`x', '## Visible'].join('\n');
    expect(listHeadings(md).map((h) => h.name)).toEqual(['Visible']);
  });

  it('allows a tilde opening whose info string contains a backtick', () => {
    const md = ['~~~ js`x', '## Hidden', '~~~', '## Visible'].join('\n');
    expect(listHeadings(md).map((h) => h.name)).toEqual(['Visible']);
  });

  it('returns a repeated name once per occurrence', () => {
    const md = ['## Dup', 'a', '## Dup', 'b'].join('\n');
    expect(listHeadings(md)).toEqual([
      { name: 'Dup', depth: 2 },
      { name: 'Dup', depth: 2 },
    ]);
  });

  it('requires a space after the hashes', () => {
    expect(listHeadings('##NoSpace')).toEqual([]);
  });
});

describe('extractSection', () => {
  const md = [
    '## Alpha',
    '',
    'first para',
    '',
    'second para',
    '',
    '### Unit 1',
    'unit body',
    '## Beta',
    'beta body',
  ].join('\n');

  it('returns the body with interior blank lines intact and outer blanks trimmed', () => {
    expect(extractSection(md, 'Beta')).toBe('beta body');
    expect(extractSection(md, 'Unit 1')).toBe('unit body');
  });

  it('includes descendant headings under an H2', () => {
    expect(extractSection(md, 'Alpha')).toBe(
      ['first para', '', 'second para', '', '### Unit 1', 'unit body'].join('\n'),
    );
  });

  it('stops at the next heading of equal or shallower depth', () => {
    const deep = ['### A', 'a body', '### B', 'b body'].join('\n');
    expect(extractSection(deep, 'A')).toBe('a body');
  });

  it('returns null for a name that is not a heading', () => {
    expect(extractSection(md, 'Gamma')).toBeNull();
  });

  it('matches case-sensitively', () => {
    expect(extractSection(md, 'alpha')).toBeNull();
  });

  it('returns the first occurrence of a repeated name', () => {
    const dup = ['## Dup', 'one', '## Dup', 'two'].join('\n');
    expect(extractSection(dup, 'Dup')).toBe('one');
  });

  it('returns an empty string for a heading with no body', () => {
    expect(extractSection(['## Empty', '## Next', 'x'].join('\n'), 'Empty')).toBe('');
  });

  it('does not treat a fenced heading as a boundary', () => {
    const fenced = ['## Alpha', 'a', '```', '## NotABoundary', '```', 'b', '## Beta'].join('\n');
    expect(extractSection(fenced, 'Alpha')).toBe(
      ['a', '```', '## NotABoundary', '```', 'b'].join('\n'),
    );
  });

  it('normalizes CRLF line endings', () => {
    expect(extractSection('## A\r\nbody\r\n## B\r\n', 'A')).toBe('body');
  });
});
