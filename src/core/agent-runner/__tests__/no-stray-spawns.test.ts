// @tests: make-noldor-agent-agnostic
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(process.cwd(), 'src');
const ALLOWED = [join('core', 'agent-runner') + sep, join('cr', 'deep-review-spawn.ts')];

// Multiline-tolerant: catches `spawn(\n  'claude'` shapes a line-based grep misses.
const STRAY =
  /\b(?:spawn|spawnSync|execFile|execFileSync|execFileP|exec)\s*\(\s*['"](?:claude|codex|opencode)['"]/m;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('agent-CLI spawn containment', () => {
  it('no file outside the registry spawns an agent CLI by literal name', () => {
    const offenders = walk(SRC)
      .filter((f) => {
        const rel = relative(SRC, f);
        return !ALLOWED.some((a) => rel.startsWith(a));
      })
      .filter((f) => STRAY.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
