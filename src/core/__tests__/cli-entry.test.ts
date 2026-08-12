// @tests: code-clone-detector
import { describe, expect, it } from 'vitest';
import { invokedDirectly } from '../cli-entry';

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
