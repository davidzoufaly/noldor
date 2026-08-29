// @tests: consumer-architecture-doc-surface
import { describe, expect, it } from 'vitest';

import { cutReason, docsRelativeDir, locateSection } from '../markdown-section-scan.js';

describe('cutReason', () => {
  it('distinguishes an absent marker from a bare one', () => {
    // `null` and `''` mean different things — no decline at all, versus a
    // decline with no reason — and a caller that collapsed them would let a
    // bare marker suppress a section.
    expect(cutReason('just prose here')).toBeNull();
    expect(cutReason('noldor:cut')).toBe('');
  });

  it('returns the reason after the marker, and ignores a marker inside a longer word', () => {
    expect(cutReason('noldor:cut a pure function — the signature is the shape')).toBe(
      'a pure function — the signature is the shape',
    );
    expect(cutReason('noldor:cutlery is not a marker')).toBeNull();
  });

  it('takes the first marker when a section carries several', () => {
    expect(cutReason('noldor:cut first reason\nnoldor:cut second reason')).toBe('first reason');
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
