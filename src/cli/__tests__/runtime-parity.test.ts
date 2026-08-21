// @tests: noldor-package-lift

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MANIFEST } from '../manifest.js';

const REPO_ROOT = join(import.meta.dirname, '../../..');

function manifestSources(): string[] {
  const out: string[] = [];
  for (const group of Object.values(MANIFEST)) {
    for (const sub of Object.values(group.subs)) out.push(sub.src);
  }
  return [...new Set(out)];
}

describe('manifest entrypoints under both runtimes', () => {
  it('names a real source file for every subcommand', () => {
    const missing = manifestSources().filter((rel) => !existsSync(join(REPO_ROOT, 'src', rel)));
    expect(missing).toEqual([]);
  });

  it('never guards direct invocation on a hardcoded .ts extension', () => {
    // A guard testing only `.ts` loads silently and does nothing when the
    // router runs from dist — the command exits 0 having performed no work,
    // which no resolution check can catch. `invokedDirectly()` matches
    // ts|js|mjs; `basename().startsWith()` and an `import.meta.url` comparison
    // are extension-agnostic and equally fine.
    const offenders: string[] = [];
    for (const rel of manifestSources()) {
      const text = readFileSync(join(REPO_ROOT, 'src', rel), 'utf8');
      const guards = text.match(/process\.argv\[1\][^\n]*endsWith\([^)]*\)/g) ?? [];
      for (const guard of guards) {
        if (guard.includes(".ts'") && !guard.includes(".js'")) offenders.push(`${rel}: ${guard}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
