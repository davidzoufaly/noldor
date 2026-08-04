// @tests: doc-gardening-skill
// The ownership-gate query. The load-bearing case is the merge-base range: a file
// `main` deleted AFTER the branch point must not read as added on this branch —
// which is exactly what flip-time archival does to specs on `main`.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { discoverAddedFiles, repoRoot } from '../branch-added.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * Build a repo where:
 *   - `main` has `docs/design/specs/old.md` at the branch point,
 *   - a branch adds `docs/design/specs/new.md`,
 *   - `main` then MOVES `old.md` into `archive/` (the flip-time archival case).
 * `origin/main` is a local ref pointing at main's tip, so no network is involved.
 */
function repoWithDivergedMain(): string {
  const dir = mkdtempSync(join(tmpdir(), 'branch-added-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  mkdirSync(join(dir, 'docs', 'design', 'specs'), { recursive: true });
  writeFileSync(join(dir, 'docs/design/specs/old.md'), 'old\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const base = git(dir, ['rev-parse', 'HEAD']).trim();

  git(dir, ['checkout', '-qb', 'feat']);
  writeFileSync(join(dir, 'docs/design/specs/new.md'), 'new\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'add new spec']);

  git(dir, ['checkout', '-q', 'main']);
  mkdirSync(join(dir, 'docs/design/specs/archive'), { recursive: true });
  git(dir, ['mv', 'docs/design/specs/old.md', 'docs/design/specs/archive/old.md']);
  git(dir, ['commit', '-qm', 'archive old spec at done-flip']);
  git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);

  git(dir, ['checkout', '-q', 'feat']);
  expect(git(dir, ['merge-base', 'origin/main', 'HEAD']).trim()).toBe(base);
  return dir;
}

describe(discoverAddedFiles, () => {
  it('returns only what this branch added, not what main moved after the branch point', () => {
    const dir = repoWithDivergedMain();
    const added = discoverAddedFiles({ cwd: dir });
    expect(added).toEqual(['docs/design/specs/new.md']);
    // The two-dot range would have reported main's pre-archive path as added here.
    expect(added).not.toContain('docs/design/specs/old.md');
  });

  it('returns repo-relative paths callers can filter themselves', () => {
    const dir = repoWithDivergedMain();
    const added = discoverAddedFiles({ cwd: dir });
    expect(added).toEqual(['docs/design/specs/new.md']);
    expect(added.filter((f) => f.startsWith('src/'))).toEqual([]);
  });

  it('throws when the base ref does not resolve', () => {
    const dir = repoWithDivergedMain();
    expect(() => discoverAddedFiles({ base: 'origin/nope', cwd: dir })).toThrow(/merge-base/);
  });
});

describe(repoRoot, () => {
  it('resolves the same root from a subdirectory', () => {
    const dir = repoWithDivergedMain();
    const fromRoot = repoRoot(dir);
    const fromSub = repoRoot(join(dir, 'docs', 'design', 'specs'));
    expect(fromSub).toBe(fromRoot);
  });
});
