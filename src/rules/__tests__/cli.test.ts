import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runResolve, runValidate } from '../cli-cores.js';

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-rules-cli-'));
  const rd = join(dir, '.noldor', 'rules');
  mkdirSync(rd, { recursive: true });
  for (const [n, c] of Object.entries(files)) writeFileSync(join(rd, n), c);
  return dir;
}

const RULE = `---\nid: ts-rule\napplies-to: ["src/**/*.ts"]\nstage: [code]\n---\nNamed exports only.\n`;

describe('rules CLI cores', () => {
  it('runResolve returns matching rules for a file+stage', () => {
    const dir = repo({ 'ts-rule.md': RULE });
    try {
      const out = runResolve(dir, { file: 'src/x.ts', stage: 'code' });
      expect(out.injected.map((r) => r.id)).toEqual(['ts-rule']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runValidate returns ok for a clean store', () => {
    const dir = repo({ 'ts-rule.md': RULE });
    try {
      const res = runValidate(dir);
      expect(res.ok).toBe(true);
      expect(res.errors).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runValidate flags a malformed store', () => {
    const dir = repo({ 'bad.md': `---\nid: Bad\n---\nx\n` });
    try {
      const res = runValidate(dir);
      expect(res.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
