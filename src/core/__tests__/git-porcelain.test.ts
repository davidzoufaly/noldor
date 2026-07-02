import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitStatusPorcelain } from '../git-porcelain';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'git-porcelain-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('gitStatusPorcelain', () => {
  it('fails open to empty string outside a git repo', () => {
    expect(gitStatusPorcelain(dir)).toBe('');
  });
});
