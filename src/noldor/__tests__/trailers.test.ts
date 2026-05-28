import { describe, expect, it } from 'vitest';
import { parseTrailers, formatTrailers, appendToMessage, type Trailers } from '../trailers';

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
