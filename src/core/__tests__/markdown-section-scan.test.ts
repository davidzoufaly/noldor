// @tests: consumer-architecture-doc-surface
import { describe, expect, it } from 'vitest';

import {
  blankComments,
  cutReasons,
  docsRelativeDir,
  locateSection,
} from '../markdown-section-scan.js';

describe('cutReasons', () => {
  it('distinguishes an absent marker from a bare one', () => {
    // `[]` and `['']` mean different things — no decline at all, versus a
    // decline with no reason — and a caller that collapsed them would let a
    // bare marker suppress a section.
    expect(cutReasons('just prose here')).toEqual([]);
    expect(cutReasons('noldor:cut')).toEqual(['']);
  });

  it('returns the reason after the marker, and ignores a marker inside a longer word', () => {
    expect(cutReasons('noldor:cut a pure function — the signature is the shape')).toEqual([
      'a pure function — the signature is the shape',
    ]);
    expect(cutReasons('noldor:cutlery is not a marker')).toEqual([]);
  });

  it('returns every marker in order, so a bare one cannot mask a well-formed one', () => {
    expect(cutReasons('noldor:cut\nnoldor:cut second reason')).toEqual(['', 'second reason']);
  });
});

describe('blankComments', () => {
  it('blanks comment contents while preserving line count and offsets', () => {
    const out = blankComments('a\n<!-- hidden -->\nb');
    expect(out.split('\n')).toHaveLength(3);
    expect(out).not.toContain('hidden');
    expect(out.split('\n')[2]).toBe('b');
    expect(out.split('\n')[1]).toHaveLength('<!-- hidden -->'.length);
  });

  it('blanks the remainder when a comment is never closed', () => {
    expect(blankComments('a\n<!-- forever\nb').trim()).toBe('a');
  });

  it('leaves a comment marker inside a code fence alone', () => {
    // Example text, not a comment. Treating it as one let an unterminated `<!--`
    // in a fenced sample blank the rest of the document.
    const doc = ['```markdown', '<!-- TODO: never closed', '```', '', '## Real', '', 'body'].join(
      '\n',
    );
    const out = blankComments(doc);
    expect(out).toContain('<!-- TODO: never closed');
    expect(out).toContain('## Real');
    expect(out).toContain('body');
  });

  it('still blanks to the end when a comment opens outside a fence and never closes', () => {
    const doc = ['before', '<!-- open forever', '```', 'x', '```', '## Real'].join('\n');
    const out = blankComments(doc);
    expect(out).toContain('before');
    expect(out).not.toContain('## Real');
  });

  it('closes at the first --> exactly as HTML does, so a mermaid arrow ends it', () => {
    // Load-bearing for feature-MD diagrams: `<!--` around a flowchart does not
    // hide it, because the first edge closes the comment.
    expect(blankComments('<!--\nflowchart LR\n  a --> b\n-->\nafter')).toContain('b');
    expect(blankComments('<!--\nflowchart LR\n  a --> b\n-->\nafter')).not.toContain('flowchart');
  });
});

describe('docsRelativeDir', () => {
  it('trims to the docs-rooted suffix', () => {
    expect(docsRelativeDir('/home/me/repo/docs/features')).toBe('docs/features');
    expect(docsRelativeDir('C:\\repo\\docs\\design\\specs')).toBe('docs/design/specs');
  });

  it('returns the whole POSIX path when no docs segment exists', () => {
    expect(docsRelativeDir('/home/me/elsewhere')).toBe('/home/me/elsewhere');
  });
});

describe('locateSection', () => {
  it('ends a section at the next same-or-shallower heading, not at a deeper one', () => {
    const body = ['## A', '', 'alpha', '', '### A2', '', 'nested', '', '## B', '', 'beta'].join(
      '\n',
    );
    expect(locateSection(body, 2, 'A', null)?.raw.trim()).toBe(
      ['alpha', '', '### A2', '', 'nested'].join('\n'),
    );
  });

  it('does not let a four-backtick fence be closed by a three-backtick line inside it', () => {
    const body = [
      '## A',
      '',
      '````md',
      '```',
      '## B',
      '```',
      '````',
      '',
      'still in A',
      '',
      '## B',
      '',
      'beta',
    ].join('\n');
    const a = locateSection(body, 2, 'A', null);
    expect(a?.scanned).toContain('still in A');
    expect(a?.scanned).not.toContain('beta');
    expect(locateSection(body, 2, 'B', null)?.raw.trim()).toBe('beta');
  });

  it('honours requireAncestor, so the same heading under a different parent does not match', () => {
    const body = [
      '## Design',
      '',
      '### Unit',
      '',
      'right',
      '',
      '## Other',
      '',
      '### Unit',
      '',
      'wrong',
    ].join('\n');
    expect(locateSection(body, 3, 'Unit', '## Design')?.raw.trim()).toBe('right');
    expect(locateSection(body, 3, 'Unit', '## Nowhere')).toBeNull();
  });
});
