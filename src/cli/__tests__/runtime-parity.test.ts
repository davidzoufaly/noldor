// @tests: noldor-package-lift

import { execFileSync } from 'node:child_process';
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
  it('ignores generated trees git ignores, and still flags real assets', () => {
    // src/graphify-out/ holds hundreds of gitignored cache files. The scan walks
    // the filesystem, not the index, so without asking git every consumer with
    // graphify output gets a red build — while a genuinely new runtime asset
    // must still fail closed.
    const repo = mkdtempSync(join(tmpdir(), 'asset-scan-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo });
      mkdirSync(join(repo, 'src/graphify-out/cache'), { recursive: true });
      mkdirSync(join(repo, 'src/cr'), { recursive: true });
      writeFileSync(join(repo, '.gitignore'), '*/graphify-out/\n');
      writeFileSync(join(repo, 'src/graphify-out/cache/ast.json'), '{}\n');

      expect(unmanifestedAssets(repo)).toEqual([]);

      writeFileSync(join(repo, 'src/cr/new-asset.json'), '{}\n');
      expect(unmanifestedAssets(repo)).toEqual(['src/cr/new-asset.json']);
    } finally {
      rmSync(repo, { force: true, recursive: true });
    }
  });
});
