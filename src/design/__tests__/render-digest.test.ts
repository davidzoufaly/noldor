// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
// Unit 4 of the decision-context-depth spec: the digest renderer. `render.test.ts`
// keeps the pre-digest guarantees (ordering, no-forgery, unparsed surfacing).
import { describe, expect, it } from 'vitest';

import { emptyLedger, type LedgerState } from '../ledger.js';
import { collapse, renderContext, type RenderHeading, type RenderOpts } from '../render.js';

const HEADINGS: RenderHeading[] = [
  { name: 'Problem', depth: 2, digest: 'aaaaaaaa' },
  { name: 'Design', depth: 2, digest: 'bbbbbbbb' },
  { name: 'Unit 1', depth: 3, digest: 'cccccccc' },
];

const state: LedgerState = {
  entry: null,
  scope: 'Short scope. And a second sentence that the digest should hide.',
  decided: [
    { id: 'D1', text: 'Bound to Design.', section: 'Design', why: 'because', insteadOf: 'other' },
    { id: 'D2', text: 'Bound elsewhere.', section: 'Problem', why: 'reasons' },
    { id: 'D3', text: 'Untagged. With a tail sentence.' },
  ],
  open: [{ id: 'O1', text: 'A question. With more.', resolvedBy: null }],
  support: ['src/foo.ts:1 — does X'],
  confirmed: [{ name: 'Problem', digest: 'aaaaaaaa' }],
  unparsed: [],
};

const base: RenderOpts = {
  slug: 'parent-enh',
  kind: 'spec',
  scope: state.scope!,
  headings: HEADINGS,
};

describe('collapse', () => {
  it('returns the first sentence and counts the rest', () => {
    expect(collapse({ text: 'One. Two. Three.' })).toBe('One. (+2 more)');
  });

  it('counts a terminatorless trailing fragment as a sentence', () => {
    expect(collapse({ text: 'One. Two' })).toBe('One. (+1 more)');
  });

  it('returns the whole text with no marker when there is no boundary', () => {
    expect(collapse({ text: 'no boundary here at all' })).toBe('no boundary here at all');
  });

  it('does not split on a lowercase continuation', () => {
    expect(collapse({ text: 'e.g. this stays one sentence' })).toBe('e.g. this stays one sentence');
  });

  it('splits before a digit', () => {
    expect(collapse({ text: 'First. 2 is next.' })).toBe('First. (+1 more)');
  });

  it('appends field markers in canonical order', () => {
    expect(collapse({ text: 'A. B.', why: 'w', insteadOf: 'i' })).toBe(
      'A. (+1 more) (+why) (+alt)',
    );
    expect(collapse({ text: 'Only.', insteadOf: 'i' })).toBe('Only. (+alt)');
  });

  it('handles question and exclamation boundaries', () => {
    expect(collapse({ text: 'Really? Yes.' })).toBe('Really? (+1 more)');
    expect(collapse({ text: 'Wow! Indeed.' })).toBe('Wow! (+1 more)');
  });
});

describe('focus heading', () => {
  const opts = { ...base, section: 'Design', sectionProse: 'first para\n\nsecond para' };

  it('renders the prose and expands only the decisions bound to it', () => {
    const out = renderContext(state, opts);
    expect(out).toContain('Design — current draft');
    expect(out).toContain('    first para');
    expect(out).toContain('  - D1 Bound to Design.');
    expect(out).toContain('      why: because');
    expect(out).toContain('      instead-of: other');
    // D1 is shown above, so the bucket lists the other two and says so.
    expect(out).toContain('Decided elsewhere (2 of 3)');
    expect(out).not.toContain('- D1 Bound to Design. (+why)');
  });

  it('collapses the decisions it did not expand', () => {
    const out = renderContext(state, opts);
    expect(out).toContain('- D2 Bound elsewhere. (+why)');
    expect(out).toContain('- D3 Untagged. (+1 more)');
  });

  it('reports a heading whose body is not written yet', () => {
    const out = renderContext(state, { ...base, section: 'Unit 1' });
    expect(out).toContain('(this heading has no body yet)');
  });

  it('numbers the heading position in the status line', () => {
    expect(renderContext(state, opts)).toContain('heading 2/3');
  });

  it('keeps the elsewhere label when the focus heading has no bound decisions', () => {
    // "Decided (3)" under an active focus reads as though nothing was withheld.
    const out = renderContext(state, { ...base, section: 'Unit 1' });
    expect(out).toContain('Decided elsewhere (3 of 3)');
  });
});

describe('unknown --section', () => {
  it('warns with the legal names, renders the checklist, and no prose', () => {
    const out = renderContext(state, { ...base, section: 'Desgin', sectionProse: 'x' });
    expect(out).toContain(
      "⚠ --section 'Desgin' matches no heading — legal: Problem, Design, Unit 1",
    );
    expect(out).toContain('Headings');
    expect(out).not.toContain('current draft');
    expect(out).not.toContain('    x');
  });

  it('does not claim a heading position it could not find', () => {
    const out = renderContext(state, { ...base, section: 'Desgin' });
    expect(out).toContain('3 headings');
    expect(out).not.toMatch(/heading \d+\/3/);
  });
});

describe('no --section', () => {
  it('renders header, checklist and collapsed buckets with no focus block', () => {
    const out = renderContext(state, base);
    expect(out).toContain('Headings');
    expect(out).toContain('Decided (3)');
    expect(out).not.toContain('current draft');
    expect(out).toContain('- D1 Bound to Design. (+why) (+alt)');
    expect(out).toContain('- Short scope. (+1 more)');
  });
});

describe('checklist markers', () => {
  it('marks current, confirmed, stale and unconfirmed', () => {
    const stale: LedgerState = {
      ...state,
      confirmed: [
        { name: 'Problem', digest: 'aaaaaaaa' },
        { name: 'Unit 1', digest: 'ffffffff' },
      ],
    };
    const out = renderContext(stale, { ...base, section: 'Design' });
    expect(out).toContain('  ✓ Problem');
    expect(out).toContain('  ▸ Design');
    expect(out).toContain('  ✎   Unit 1');
    expect(out).toContain('1 confirmed · 1 stale');
  });

  it('current outranks confirmation state', () => {
    const out = renderContext(state, { ...base, section: 'Problem' });
    expect(out).toContain('  ▸ Problem');
    expect(out).not.toContain('  ✓ Problem');
  });

  it('marks only the first occurrence of a duplicated name', () => {
    const dup: RenderHeading[] = [
      { name: 'Design', depth: 2, digest: 'bbbbbbbb' },
      { name: 'Design', depth: 2, digest: 'bbbbbbbb' },
    ];
    const out = renderContext(state, { ...base, headings: dup, section: 'Design' });
    expect(out.match(/ {2}▸ Design/g)).toHaveLength(1);
    expect(out).toContain('  · Design');
  });

  it('indents an H3 under its H2', () => {
    const out = renderContext(state, base);
    expect(out).toContain('  ·   Unit 1');
    expect(out).toContain('  · Design');
  });
});

describe('warnings', () => {
  it('reports stale tags, stale confirmations and duplicate headings', () => {
    const messy: LedgerState = {
      ...state,
      decided: [{ id: 'D9', text: 'x', section: 'Gone' }],
      open: [{ id: 'O9', text: 'y', resolvedBy: null, section: 'AlsoGone' }],
      confirmed: [
        { name: 'Problem', digest: 'stale000' },
        { name: 'Vanished', digest: 'aaaaaaaa' },
      ],
    };
    const out = renderContext(messy, {
      ...base,
      headings: [...HEADINGS, { name: 'Design', depth: 2, digest: 'bbbbbbbb' }],
    });
    expect(out).toContain("⚠ D9 section 'Gone' matches no heading");
    expect(out).toContain("⚠ O9 section 'AlsoGone' matches no heading");
    expect(out).toContain("⚠ confirmed heading 'Problem' has changed since it was confirmed");
    expect(out).toContain("⚠ confirmed heading 'Vanished' matches no heading");
    expect(out).toContain("⚠ heading 'Design' appears 2 times — using the first");
  });

  it('suppresses every heading warning when no artifact was located', () => {
    const messy: LedgerState = { ...state, decided: [{ id: 'D9', text: 'x', section: 'Gone' }] };
    const out = renderContext(messy, { slug: 's', kind: 'spec', scope: 'sc' });
    expect(out).not.toContain('Warnings');
    expect(out).not.toContain('Headings');
  });

  it('still surfaces unparsed ledger sections alongside warnings', () => {
    const out = renderContext(
      { ...state, unparsed: ['Decided'], confirmed: [{ name: 'Gone', digest: 'aaaaaaaa' }] },
      base,
    );
    expect(out).toContain("⚠ confirmed heading 'Gone' matches no heading");
    expect(out).toContain('⚠ ledger section unparsed: Decided');
  });
});

describe('warning containment', () => {
  it('collapses a line terminator in --section before printing it', () => {
    const out = renderContext(state, { ...base, section: 'evil\n```\n## Forged' });
    for (const line of out.split('\n')) {
      expect(line.startsWith('```')).toBe(false);
      expect(line.startsWith('#')).toBe(false);
    }
    expect(out).toContain("⚠ --section 'evil ``` ## Forged' matches no heading");
  });
});

describe('--full', () => {
  it('expands every value and every field, header and checklist included', () => {
    const out = renderContext(state, { ...base, full: true });
    expect(out).toContain('Headings');
    expect(out).toContain('- Short scope. And a second sentence that the digest should hide.');
    expect(out).toContain('- D3 Untagged. With a tail sentence.');
    expect(out).toContain('    why: because');
    expect(out).toContain('    instead-of: other');
    expect(out).not.toContain('(+why)');
    expect(out).not.toContain('(+1 more)');
  });
});

describe('prose containment', () => {
  it('indents prose four spaces so a fence or heading line is inert', () => {
    const out = renderContext(state, {
      ...base,
      section: 'Design',
      sectionProse: ['## Forged', '```', 'code', '```', '~~~', 'x'].join('\n'),
    });
    for (const line of out.split('\n')) {
      expect(line.startsWith('#')).toBe(false);
      expect(line.startsWith('```')).toBe(false);
      expect(line.startsWith('~~~')).toBe(false);
    }
    expect(out).toContain('    ## Forged');
    expect(out).toContain('    ```');
  });

  it('keeps interior blank lines blank rather than indented whitespace', () => {
    const out = renderContext(state, {
      ...base,
      section: 'Design',
      sectionProse: 'a\n\nb',
    });
    expect(out).toContain('    a\n\n    b');
  });
});

describe('absent artifact', () => {
  it('reports the note and renders the buckets', () => {
    const out = renderContext(emptyLedger(), {
      slug: 's',
      kind: 'spec',
      scope: '(scope not recorded)',
      artifactNote: '(no spec on disk yet)',
    });
    expect(out).toContain('- (no spec on disk yet)');
    expect(out).toContain('- (no decisions recorded yet)');
  });
});
