// @tests: code-clone-detector
import { describe, expect, it } from 'vitest';
import { invokedDirectly, readValueFlags } from '../cli-entry.js';

describe('invokedDirectly', () => {
  it('matches the module by stem across source and build extensions', () => {
    expect(invokedDirectly('clones-cli', '/repo/src/clones/clones-cli.ts')).toBe(true);
    expect(invokedDirectly('clones-cli', '/repo/dist/clones/clones-cli.js')).toBe(true);
    expect(invokedDirectly('clones-cli', '/repo/dist/clones/clones-cli.mjs')).toBe(true);
    expect(invokedDirectly('clones-cli', 'C:\\repo\\src\\clones\\clones-cli.js')).toBe(true);
  });

  it('does not match another module, a bare prefix, or a missing argv', () => {
    expect(invokedDirectly('clones-cli', '/repo/src/core/wait-cli.ts')).toBe(false);
    // The separator is required, so `my-clones-cli.ts` is a different module.
    expect(invokedDirectly('clones-cli', '/repo/src/my-clones-cli.ts')).toBe(false);
    expect(invokedDirectly('clones-cli', '/repo/src/clones/clones-cli.txt')).toBe(false);
    expect(invokedDirectly('clones-cli', undefined)).toBe(false);
  });
});

describe('readValueFlags', () => {
  it('reads every declared flag and returns the leftovers as positionals', () => {
    const r = readValueFlags(
      ['doc.json', '--side', 'impl', '--surface', 'dashboard'],
      ['--side', '--surface'],
      'demo',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values.get('--side')).toBe('impl');
      expect(r.values.get('--surface')).toBe('dashboard');
      expect(r.positional).toEqual(['doc.json']);
    }
  });

  it('keeps a positional whose text equals a flag value', () => {
    const r = readValueFlags(['impl', '--side', 'impl'], ['--side'], 'demo');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.positional).toEqual(['impl']);
  });

  it('rejects a flag-shaped value rather than swallowing the next flag name', () => {
    const r = readValueFlags(
      ['doc.json', '--surface', '--side', 'impl'],
      ['--side', '--surface'],
      'demo',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('--surface requires a value');
  });

  it('reports an unknown flag left among the positionals', () => {
    const r = readValueFlags(['doc.json', '--zoom'], ['--side'], 'demo');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unknown flag --zoom');
  });

  it('reports a flag given as the last token', () => {
    const r = readValueFlags(['doc.json', '--side'], ['--side'], 'demo');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('--side requires a value');
  });
});
