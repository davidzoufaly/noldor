// @tests: consumer-architecture-doc-surface
import { describe, expect, it } from 'vitest';

import {
  ARCH_PAGE_PROSE_WORD_THRESHOLD,
  ARCH_PARAGRAPH_WORD_THRESHOLD,
  SECTION_CUT_TOKEN,
  assessPageBloat,
  assessPageForm,
  parseSectionCuts,
  proseParagraphs,
} from '../architecture-form.js';

const CONTEXT = { id: 'context', sections: ['Actors', 'Externals', 'Boundary'] } as const;
const FLOWS = { id: 'flows', sections: [] } as const;

describe(assessPageForm, () => {
  it('reports nothing when every section is present', () => {
    const body = '## Actors\n\na\n\n## Externals\n\nb\n\n## Boundary\n\nc\n';
    expect(assessPageForm(CONTEXT, body)).toStrictEqual({
      missing: [],
      unknownCuts: [],
      flowHeadings: null,
    });
  });

  it('ignores section order and extra headings', () => {
    const body = '## Boundary\n\nc\n\n## Mine\n\nx\n\n## Actors\n\na\n\n## Externals\n\nb\n';
    expect(assessPageForm(CONTEXT, body).missing).toStrictEqual([]);
  });

  it('matches a heading case-insensitively', () => {
    const body = '## actors\n## EXTERNALS\n## Boundary\n';
    expect(assessPageForm(CONTEXT, body).missing).toStrictEqual([]);
  });

  it('names a missing section, in registry order', () => {
    expect(assessPageForm(CONTEXT, '## Externals\n\nb\n').missing).toStrictEqual([
      'Actors',
      'Boundary',
    ]);
  });

  it('does not see a heading inside a tilde fence', () => {
    const body = '## Actors\n\n## Externals\n\n~~~markdown\n## Boundary\n~~~\n';
    expect(assessPageForm(CONTEXT, body).missing).toStrictEqual(['Boundary']);
  });

  it('does not see an H3 as a section', () => {
    const body = '## Actors\n## Externals\n### Boundary\n';
    expect(assessPageForm(CONTEXT, body).missing).toStrictEqual(['Boundary']);
  });

  it('counts headings instead of names on an empty-sections page', () => {
    expect(assessPageForm(FLOWS, '## The gate flow\n\n## The release flow\n').flowHeadings).toBe(2);
    expect(assessPageForm(FLOWS, '## Only one\n').flowHeadings).toBe(1);
    expect(assessPageForm(FLOWS, 'no headings at all\n').flowHeadings).toBe(0);
  });

  it('never reports a missing section on an empty-sections page', () => {
    expect(assessPageForm(FLOWS, 'nothing here\n').missing).toStrictEqual([]);
  });
});

describe(parseSectionCuts, () => {
  it('reads a well-formed marker', () => {
    const body = '<!-- noldor:cut-section Topology — single npm package, nothing to draw -->';
    expect(parseSectionCuts(body)).toStrictEqual([
      { name: 'Topology', reason: 'single npm package, nothing to draw', wellFormed: true },
    ]);
  });

  it('tolerates a "## " prefix on the name', () => {
    expect(parseSectionCuts('<!-- noldor:cut-section ## topology — none -->')[0]).toStrictEqual({
      name: 'topology',
      reason: 'none',
      wellFormed: true,
    });
  });

  it('treats a later em dash as part of the reason', () => {
    const body = '<!-- noldor:cut-section Topology — one unit — nothing to draw -->';
    expect(parseSectionCuts(body)[0]!.reason).toBe('one unit — nothing to draw');
  });

  it('marks a marker with no em dash as malformed', () => {
    expect(parseSectionCuts('<!-- noldor:cut-section Topology -->')[0]).toStrictEqual({
      name: 'Topology',
      reason: '',
      wellFormed: false,
    });
  });

  it('marks an empty reason as malformed', () => {
    expect(parseSectionCuts('<!-- noldor:cut-section Topology —    -->')[0]!.wellFormed).toBe(
      false,
    );
  });

  it('ignores a marker inside a fenced block', () => {
    const body = ['```markdown', '<!-- noldor:cut-section Topology — an example -->', '```'].join(
      '\n',
    );
    expect(parseSectionCuts(body)).toStrictEqual([]);
  });

  it('ignores a marker inside an inline code span', () => {
    const body = 'write `<!-- noldor:cut-section Topology — like this -->` on the page';
    expect(parseSectionCuts(body)).toStrictEqual([]);
  });

  it('ignores an ordinary noldor:cut ladder marker', () => {
    const body = '<!-- noldor:cut one diagram — split when the container count passes 12 -->';
    expect(parseSectionCuts(body)).toStrictEqual([]);
  });

  it('finds every marker in document order', () => {
    const body = [
      '<!-- noldor:cut-section Topology — a -->',
      'prose',
      '<!-- noldor:cut-section Boundary — b -->',
    ].join('\n');
    expect(parseSectionCuts(body).map((c) => c.name)).toStrictEqual(['Topology', 'Boundary']);
  });

  it('exports the token it parses', () => {
    expect(SECTION_CUT_TOKEN).toBe('noldor:cut-section');
  });
});

describe('assessPageForm declines', () => {
  it('a well-formed cut suppresses its section', () => {
    const body = '## Actors\n## Externals\n<!-- noldor:cut-section Boundary — nothing to say -->';
    const got = assessPageForm(CONTEXT, body);
    expect(got.missing).toStrictEqual([]);
    expect(got.unknownCuts).toStrictEqual([]);
  });

  it('matches the declined name case-insensitively', () => {
    const body = '## Actors\n## Externals\n<!-- noldor:cut-section boundary — none -->';
    expect(assessPageForm(CONTEXT, body).missing).toStrictEqual([]);
  });

  it('a malformed cut does not suppress, and is reported', () => {
    const body = '## Actors\n## Externals\n<!-- noldor:cut-section Boundary -->';
    const got = assessPageForm(CONTEXT, body);
    expect(got.missing).toStrictEqual(['Boundary']);
    expect(got.unknownCuts).toStrictEqual([{ name: 'Boundary', ordinal: 0 }]);
  });

  it('a cut naming a non-section is reported, with an ordinal per occurrence', () => {
    const body =
      '## Actors\n## Externals\n## Boundary\n' +
      '<!-- noldor:cut-section Nope — a -->\n<!-- noldor:cut-section Nope — b -->';
    expect(assessPageForm(CONTEXT, body).unknownCuts).toStrictEqual([
      { name: 'Nope', ordinal: 0 },
      { name: 'Nope', ordinal: 1 },
    ]);
  });

  it('a cut for a section that is also present is not an unknown cut', () => {
    const body = '## Actors\n## Externals\n## Boundary\n<!-- noldor:cut-section Boundary — x -->';
    expect(assessPageForm(CONTEXT, body).unknownCuts).toStrictEqual([]);
  });

  it('never reports an unknown cut on an empty-sections page', () => {
    const body = '## A flow\n<!-- noldor:cut-section Anything — no set to check against -->';
    expect(assessPageForm(FLOWS, body).unknownCuts).toStrictEqual([]);
  });
});

describe(proseParagraphs, () => {
  it('splits on blank lines', () => {
    expect(proseParagraphs('one two\n\nthree four five')).toStrictEqual([
      'one two',
      'three four five',
    ]);
  });

  it('drops headings', () => {
    expect(proseParagraphs('## Actors\n\nreal prose')).toStrictEqual(['real prose']);
  });

  it('drops fenced blocks and does not merge the prose around them', () => {
    const body = 'before\n\n```mermaid\nflowchart LR\n  a --> b\n```\n\nafter';
    expect(proseParagraphs(body)).toStrictEqual(['before', 'after']);
  });

  it('drops tilde fences too', () => {
    expect(proseParagraphs('before\n\n~~~js\nconst a = 1;\n~~~\n\nafter')).toStrictEqual([
      'before',
      'after',
    ]);
  });

  it('drops table rows', () => {
    const body = 'before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter';
    expect(proseParagraphs(body)).toStrictEqual(['before', 'after']);
  });

  it('drops HTML comments', () => {
    const body = 'before\n\n<!-- what belongs here: a prompt nobody reads -->\n\nafter';
    expect(proseParagraphs(body)).toStrictEqual(['before', 'after']);
  });

  it('drops a multi-line HTML comment', () => {
    const body = 'before\n\n<!-- one\ntwo\nthree -->\n\nafter';
    expect(proseParagraphs(body)).toStrictEqual(['before', 'after']);
  });

  it('does not end a long fence on a shorter inner run', () => {
    // CommonMark: a ``` line inside a ```` block is fence content, not a close.
    // A blind open/close toggle ends the fence early and counts the inner code as
    // prose — an OVER-report that can fire a bogus bloat advisory.
    const body = [
      'real prose here',
      '',
      '````markdown',
      '```',
      'inner code that is NOT prose',
      '```',
      '````',
      '',
      'trailing prose',
    ].join('\n');
    expect(proseParagraphs(body)).toStrictEqual(['real prose here', 'trailing prose']);
  });

  it('does not end a backtick fence on a tilde line', () => {
    const body = ['before', '', '```js', '~~~', 'still code', '```', '', 'after'].join('\n');
    expect(proseParagraphs(body)).toStrictEqual(['before', 'after']);
  });

  it('keeps a paragraph that merely contains inline code', () => {
    expect(proseParagraphs('the `src/core` module owns it')).toStrictEqual([
      'the `src/core` module owns it',
    ]);
  });
});

const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe(assessPageBloat, () => {
  it('reports nothing at the thresholds', () => {
    expect(assessPageBloat(`${words(ARCH_PARAGRAPH_WORD_THRESHOLD)}\n`)).toStrictEqual({
      longParagraphs: [],
      pageWords: null,
    });
  });

  it('reports a paragraph one word over', () => {
    const body = `${words(ARCH_PARAGRAPH_WORD_THRESHOLD + 1)}\n`;
    expect(assessPageBloat(body).longParagraphs).toStrictEqual([
      { index: 0, words: ARCH_PARAGRAPH_WORD_THRESHOLD + 1 },
    ]);
  });

  it('indexes paragraphs by position among prose paragraphs', () => {
    const body = `short\n\n${words(ARCH_PARAGRAPH_WORD_THRESHOLD + 5)}\n`;
    expect(assessPageBloat(body).longParagraphs).toStrictEqual([
      { index: 1, words: ARCH_PARAGRAPH_WORD_THRESHOLD + 5 },
    ]);
  });

  it('reports the page total only when it is over', () => {
    const under = Array.from({ length: 6 }, () => words(50)).join('\n\n');
    expect(assessPageBloat(under).pageWords).toBeNull();

    const over = Array.from({ length: 7 }, () => words(90)).join('\n\n');
    expect(assessPageBloat(over).pageWords).toBe(630);
  });

  it('does not count fenced or tabular content toward either budget', () => {
    const fence = [
      '```mermaid',
      ...Array.from({ length: 400 }, (_, i) => `  n${i} --> m${i}`),
      '```',
    ];
    const body = `short prose\n\n${fence.join('\n')}\n`;
    expect(assessPageBloat(body)).toStrictEqual({ longParagraphs: [], pageWords: null });
  });

  it('has thresholds set above this repo\u2019s real pages', () => {
    expect(ARCH_PARAGRAPH_WORD_THRESHOLD).toBe(100);
    expect(ARCH_PAGE_PROSE_WORD_THRESHOLD).toBe(600);
  });
});
