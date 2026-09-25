// @tests: self-refreshing-compact-knowledge-graph
import { existsSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { scratchDir } from '../scratch-dir.js';

describe('scratchDir', () => {
  it('makes a fresh directory named by its prefix and removes it, contents and all, at scope end', () => {
    let path = '';
    {
      using dir = scratchDir('noldor-scratch-test-');
      path = dir.path;
      writeFileSync(join(path, 'left-behind.txt'), 'x');
      expect(basename(path).startsWith('noldor-scratch-test-')).toBe(true);
      expect(existsSync(path)).toBe(true);
    }
    expect(existsSync(path)).toBe(false);
  });

  it('removes the directory when the scope throws', () => {
    let path = '';
    expect(() => {
      using dir = scratchDir('noldor-scratch-test-');
      path = dir.path;
      throw new Error('boom');
    }).toThrow('boom');
    expect(path).not.toBe('');
    expect(existsSync(path)).toBe(false);
  });
});
