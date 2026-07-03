// @tests: noldor
import { describe, expect, it } from 'vitest';
import {
  parseTrailers,
  formatTrailers,
  appendToMessage,
  detectDroppedTrailers,
  type Trailers,
} from '../trailers';

describe('trailer parsing', () => {
  it('parses Noldor-Path', () => {
    const msg = 'feat: x\n\nNoldor-Path: fast-track\nNoldor-Reviewed: abc123\n';
    const t = parseTrailers(msg);
    expect(t['Noldor-Path']).toBe('fast-track');
    expect(t['Noldor-Reviewed']).toBe('abc123');
  });
  it('returns empty object when no trailers', () => {
    expect(parseTrailers('plain commit')).toEqual({});
  });
  it('round-trips via formatTrailers', () => {
    const t: Trailers = { 'Noldor-Path': 'full-new', 'Noldor-FD': 'foo' };
    const lines = formatTrailers(t);
    expect(lines).toContain('Noldor-Path: full-new');
    expect(lines).toContain('Noldor-FD: foo');
  });
  it('appendToMessage appends trailers to a plain commit message', () => {
    const result = appendToMessage('feat: hello\n', { 'Noldor-Path': 'fast-track' });
    expect(result).toContain('Noldor-Path: fast-track');
    expect(result).toContain('feat: hello');
  });
  it('round-trips a colon-bearing trailer value without shell escaping bugs', () => {
    // A value with a colon — shell string-concat escaping would break this
    const input = 'fix: something\n';
    const trailers: Trailers = {
      'Noldor-Path-Override': 'hook broken — see issue 42',
    };
    const output = appendToMessage(input, trailers);
    const parsed = parseTrailers(output);
    expect(parsed['Noldor-Path-Override']).toBe('hook broken — see issue 42');
  });
});

describe('detectDroppedTrailers', () => {
  it('flags every Noldor-* key when an unindented continuation line invalidates the block', () => {
    // git interpret-trailers drops the WHOLE trailer block when a value wraps
    // to a continuation line without leading whitespace (v0.4.0 release bug).
    const msg =
      'feat: x\n\nbody text\n\nNoldor-Path: fast-track\nNoldor-Path-Override: long value that\nwraps without indent\nNoldor-FD: foo\n';
    const parsed = parseTrailers(msg);
    expect(parsed).toEqual({}); // precondition: git really drops the block
    expect(detectDroppedTrailers(msg, parsed)).toEqual([
      'Noldor-Path',
      'Noldor-Path-Override',
      'Noldor-FD',
    ]);
  });

  it('returns [] for a well-formed trailer block', () => {
    const msg = 'feat: x\n\nbody\n\nNoldor-Path: fast-track\nNoldor-FD: foo\n';
    expect(detectDroppedTrailers(msg, parseTrailers(msg))).toEqual([]);
  });

  it('returns [] when a multi-line value uses indented continuation (valid folding)', () => {
    const msg = 'feat: x\n\nbody\n\nNoldor-Path-Override: long value that\n  wraps with indent\n';
    expect(detectDroppedTrailers(msg, parseTrailers(msg))).toEqual([]);
  });

  it('ignores Noldor-shaped lines in earlier body paragraphs (no false positive)', () => {
    const msg = 'feat: x\n\nNoldor-FD: foo is discussed here in prose\n\nNoldor-Path: fast-track\n';
    expect(detectDroppedTrailers(msg, parseTrailers(msg))).toEqual([]);
  });

  it('returns [] for a trailer-free message', () => {
    expect(detectDroppedTrailers('plain commit\n', parseTrailers('plain commit\n'))).toEqual([]);
  });

  it('ignores comment lines so an interactive-commit comment block does not mask the trailers', () => {
    const msg =
      'feat: x\n\nNoldor-Path: fast-track\n\n# Please enter the commit message\n# Lines starting with # will be ignored\n';
    expect(detectDroppedTrailers(msg, parseTrailers(msg))).toEqual([]);
  });
});
