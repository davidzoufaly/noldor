// @tests: noldor-package-lift

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain .mjs sibling, no type declarations by design
import { unmanifestedAssets } from '../../../bin/build-manifest.mjs';
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

describe('the runtime-asset scan', () => {
  it('ignores generated trees, and still flags a real new asset beside them', () => {
    // src/graphify-out/ is a cache directory holding hundreds of files in any
    // workspace that has run graphify. It is excluded statically rather than by
    // asking git: `prepare` runs the build with the package root inside a
    // consumer's node_modules/, which git reports as ignored wholesale, so a git
    // query would switch this fail-closed scan off precisely there.
    const repo = mkdtempSync(join(tmpdir(), 'asset-scan-'));
    try {
      mkdirSync(join(repo, 'src/graphify-out/cache/ast'), { recursive: true });
      mkdirSync(join(repo, 'src/cr'), { recursive: true });
      writeFileSync(join(repo, 'src/graphify-out/cache/ast/abc.json'), '{}\n');

      expect(unmanifestedAssets(repo)).toEqual([]);

      writeFileSync(join(repo, 'src/cr/new-asset.json'), '{}\n');
      expect(unmanifestedAssets(repo)).toEqual(['src/cr/new-asset.json']);
    } finally {
      rmSync(repo, { force: true, recursive: true });
    }
  });
});
