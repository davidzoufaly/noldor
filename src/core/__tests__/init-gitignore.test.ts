// @tests: noldor
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GITIGNORE_SENTINEL, ensureGitignoreBlock } from '../init-gitignore';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'noldor-gitignore-'));
}

describe('ensureGitignoreBlock', () => {
  it('creates .gitignore with the transient block when absent', () => {
    const dir = tmp();
    expect(ensureGitignoreBlock(dir)).toBe('created');
    const body = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(body).toContain(GITIGNORE_SENTINEL);
    expect(body).toContain('.noldor/session.json');
    expect(body).toContain('.noldor/agent-events.jsonl');
    expect(body).toContain('.noldor/cr/');
  });

  it('appends to an existing .gitignore, preserving prior content', () => {
    const dir = tmp();
    writeFileSync(join(dir, '.gitignore'), 'node_modules\ndist\n');
    expect(ensureGitignoreBlock(dir)).toBe('appended');
    const body = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(body.startsWith('node_modules\ndist\n')).toBe(true);
    expect(body).toContain('.noldor/session.json');
  });

  it('is idempotent — sentinel present means untouched', () => {
    const dir = tmp();
    ensureGitignoreBlock(dir);
    const before = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(ensureGitignoreBlock(dir)).toBe('unchanged');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe(before);
  });
});
