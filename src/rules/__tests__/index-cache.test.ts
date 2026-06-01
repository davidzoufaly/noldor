import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRules, INDEX_FILE } from '../index-cache.js';

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-idx-'));
  const rulesDir = join(dir, '.noldor', 'rules');
  mkdirSync(rulesDir, { recursive: true });
  for (const [n, c] of Object.entries(files)) writeFileSync(join(rulesDir, n), c);
  return dir;
}

const RULE = `---\nid: r1\napplies-to: ["src/**/*.ts"]\n---\nbody\n`;

describe('getRules (cached index)', () => {
  it('builds the index on first call and writes the cache file', () => {
    const dir = repoWith({ 'r1.md': RULE });
    const rules = getRules(dir);
    expect(rules.map((r) => r.id)).toEqual(['r1']);
    expect(existsSync(join(dir, INDEX_FILE))).toBe(true);
  });

  it('rebuilds when a rule file changes mtime', () => {
    const dir = repoWith({ 'r1.md': RULE });
    getRules(dir); // prime cache
    const second = `---\nid: r2\n---\nbody2\n`;
    writeFileSync(join(dir, '.noldor', 'rules', 'r2.md'), second);
    // bump dir mtime deterministically
    const future = new Date(Date.now() + 10_000);
    utimesSync(join(dir, '.noldor', 'rules'), future, future);
    const rules = getRules(dir);
    expect(rules.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });
});
