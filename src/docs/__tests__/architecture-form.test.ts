// @tests: consumer-architecture-doc-surface
import { describe, expect, it } from 'vitest';

import { SECTION_CUT_TOKEN, assessPageForm, parseSectionCuts } from '../architecture-form.js';

const CONTEXT = { id: 'context', sections: ['Actors', 'Externals', 'Boundary'] } as const;
const FLOWS = { id: 'flows', sections: [] } as const;

describe(assessPageForm, () => {
  it('reports nothing when every section is present', () => {
    const body = '## Actors\n\na\n\n## Externals\n\nb\n\n## Boundary\n\nc\n';
    expect(assessPageForm(CONTEXT, body)).toStrictEqual({ missing: [], flowHeadings: null });
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
