// @tests: consumer-architecture-doc-surface
import { describe, expect, it } from 'vitest';

import { assessPageForm } from '../architecture-form.js';

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
