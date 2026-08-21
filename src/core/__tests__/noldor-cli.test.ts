// @tests: single-static-binary-distribution
import { afterEach, describe, expect, it } from 'vitest';
import { NOLDOR_BIN, noldorCliCommand } from '../noldor-cli.js';

describe('noldorCliCommand channel branch', () => {
  afterEach(() => {
    delete process.env.NOLDOR_BINARY;
  });

  it('spawns through bin/noldor.mjs on the npm channel', () => {
    delete process.env.NOLDOR_BINARY;
    expect(noldorCliCommand(['garden', 'detect'])).toEqual([
      process.execPath,
      [NOLDOR_BIN, 'garden', 'detect'],
    ]);
  });

  it('re-execs the binary directly when NOLDOR_BINARY=1', () => {
    process.env.NOLDOR_BINARY = '1';
    expect(noldorCliCommand(['garden', 'detect'])).toEqual([
      process.execPath,
      ['garden', 'detect'],
    ]);
  });

  it("ignores values other than '1'", () => {
    process.env.NOLDOR_BINARY = 'true';
    expect(noldorCliCommand(['x'])).toEqual([process.execPath, [NOLDOR_BIN, 'x']]);
  });
});
