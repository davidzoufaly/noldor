// @tests: review-run-lifecycle-module
import { describe, expect, it } from 'vitest';
import { createBoundedCapture } from '../bounded-capture.js';

/** Astral character (U+1F600) — two UTF-16 code units, four UTF-8 bytes. */
const PAIR = '\u{1F600}';

describe('createBoundedCapture', () => {
  it('returns its input verbatim below the limit', () => {
    const c = createBoundedCapture({ limitChars: 100 });
    c.push('hello ');
    c.push('world');
    expect(c.value()).toBe('hello world');
  });

  it('reports true byte count, not code-unit length', () => {
    const c = createBoundedCapture();
    c.push('é'); // 1 code unit, 2 bytes
    c.push(PAIR); // 2 code units, 4 bytes
    expect(c.totalBytes()).toBe(6);
  });

  it('keeps head and tail and elides the middle above the limit', () => {
    const c = createBoundedCapture({ headChars: 5, tailChars: 5, limitChars: 20 });
    c.push('HEAD_'.padEnd(5, '_') + 'x'.repeat(40) + '_TAIL');
    const v = c.value();
    expect(v.startsWith('HEAD_')).toBe(true);
    expect(v.endsWith('_TAIL')).toBe(true);
    expect(v).toContain('elided');
  });

  it('reports the pre-elision byte count after collapsing, not the elided length', () => {
    const c = createBoundedCapture({ headChars: 4, tailChars: 4, limitChars: 10 });
    const input = 'a'.repeat(500);
    c.push(input);
    expect(c.totalBytes()).toBe(500);
    // The rendered value is far shorter than what the child actually emitted — which is
    // exactly why `formatStderrTail` must read totalBytes() rather than value().length.
    expect(c.value().length).toBeLessThan(500);
  });

  it('keeps accumulating bytes across pushes made after the collapse', () => {
    const c = createBoundedCapture({ headChars: 2, tailChars: 2, limitChars: 4 });
    c.push('abcdefgh');
    c.push('ijkl');
    expect(c.totalBytes()).toBe(12);
    expect(c.value().endsWith('kl')).toBe(true);
  });

  it('never splits a surrogate pair at the head cut', () => {
    // headChars lands mid-pair: 'ab' + high surrogate would be the naive slice(0, 3).
    const c = createBoundedCapture({ headChars: 3, tailChars: 2, limitChars: 5 });
    c.push(`ab${PAIR}${'z'.repeat(40)}yz`);
    const head = c.value().split('\n')[0];
    expect(head).toBe('ab');
    expect(hasLoneSurrogate(head!)).toBe(false);
  });

  it('never splits a surrogate pair at the tail cut', () => {
    // Trailing `<pair>z`: at tailChars 2 the naive slice(-2) starts on the LOW surrogate,
    // stranding it. The nudge moves the cut forward one, dropping the pair whole.
    const c = createBoundedCapture({ headChars: 2, tailChars: 2, limitChars: 5 });
    c.push(`ab${'q'.repeat(40)}${PAIR}z`);
    const lines = c.value().split('\n');
    const tail = lines[lines.length - 1]!;
    expect(tail).toBe('z');
    expect(hasLoneSurrogate(tail)).toBe(false);
  });

  it('keeps a pair whole at the tail when the cut falls cleanly before it', () => {
    // Same input, one more code unit of room: the pair now fits entirely.
    const c = createBoundedCapture({ headChars: 2, tailChars: 3, limitChars: 5 });
    c.push(`ab${'q'.repeat(40)}${PAIR}z`);
    const lines = c.value().split('\n');
    expect(lines[lines.length - 1]).toBe(`${PAIR}z`);
  });

  it('emits no lone surrogate for well-formed input, whatever the cut', () => {
    // Sweep the cut across a pair boundary; every position must round-trip cleanly.
    // No `as never` here on purpose: the cast previously hid a `head:` typo for `headChars:`,
    // so every iteration silently used the 64k default and cut nothing at all.
    for (let headChars = 1; headChars <= 6; headChars++) {
      const c = createBoundedCapture({ headChars, tailChars: 3, limitChars: 8 });
      c.push(`${PAIR}${PAIR}${PAIR}${'q'.repeat(30)}${PAIR}`);
      expect(hasLoneSurrogate(c.value())).toBe(false);
    }
  });
});

/**
 * True when the string contains an unpaired surrogate — the artefact that renders as U+FFFD
 * and the reason the slice helpers nudge off pair boundaries.
 */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    if (isHigh) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
      continue;
    }
    if (isLow) return true;
  }
  return false;
}
