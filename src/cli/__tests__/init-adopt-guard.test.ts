// @tests: single-static-binary-distribution
import { afterEach, describe, expect, it } from 'vitest';
import { assertAdoptAllowed } from '../commands/init-adopt-guard.js';

describe('adopt on the binary channel', () => {
  afterEach(() => {
    delete process.env.NOLDOR_BINARY;
  });

  it('throws with the npm-channel pointer when NOLDOR_BINARY=1', () => {
    process.env.NOLDOR_BINARY = '1';
    expect(() => assertAdoptAllowed()).toThrow(/npm channel/);
  });

  it('allows adopt on the npm channel', () => {
    delete process.env.NOLDOR_BINARY;
    expect(() => assertAdoptAllowed()).not.toThrow();
  });
});
