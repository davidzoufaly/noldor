// @tests: doc-gardening-skill
// The ownership-gate query. The load-bearing case is the merge-base range: a file
// `main` deleted AFTER the branch point must not read as added on this branch —
// which is exactly what flip-time archival does to specs on `main`.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RunGit } from '../branch-added.js';
import {
  discoverAddedFiles,
  renameDestExists,
  repoRoot,
  resolveDefaultBase,
  toRepoRelative,
} from '../branch-added.js';

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

  it('follows the remote default branch when it is not main', () => {
    const dir = repoWithDivergedMain();
    // Rename the default branch to `master` and point origin/HEAD at it, as a
    // consumer repo cloned from a master-default remote would be.
    git(dir, ['update-ref', 'refs/remotes/origin/master', 'refs/remotes/origin/main']);
    git(dir, ['update-ref', '-d', 'refs/remotes/origin/main']);
    git(dir, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master']);
    // Would throw "no origin/main" before the default-base resolution.
    expect(discoverAddedFiles({ cwd: dir })).toEqual(['docs/design/specs/new.md']);
  });
});

describe(renameDestExists, () => {
  const SUFFIX = '-parent-my-enh-design.md';
  const DEST = 'docs/design/specs/archive';

  /** Repo with a live, committed spec; `origin/main` marks the branch base. */
  function repoWithLiveSpec(): string {
    const dir = mkdtempSync(join(tmpdir(), 'rename-dest-'));
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['config', 'user.email', 't@example.com']);
    git(dir, ['config', 'user.name', 'T']);
    mkdirSync(join(dir, 'docs', 'design', 'specs'), { recursive: true });
    writeFileSync(join(dir, `docs/design/specs/2026-05-25${SUFFIX}`), 'spec\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'add spec']);
    git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    return dir;
  }

  function archive(dir: string): void {
    mkdirSync(join(dir, DEST), { recursive: true });
    git(dir, ['mv', `docs/design/specs/2026-05-25${SUFFIX}`, `${DEST}/2026-05-25${SUFFIX}`]);
  }

  it('sees the rename while it is only staged', () => {
    const dir = repoWithLiveSpec();
    archive(dir);
    expect(renameDestExists({ cwd: dir, destDirRel: DEST, suffix: SUFFIX })).toBe(true);
  });

  it('sees a rename committed earlier on the branch', () => {
    const dir = repoWithLiveSpec();
    archive(dir);
    git(dir, ['commit', '-qm', 'archive']);
    expect(renameDestExists({ cwd: dir, destDirRel: DEST, suffix: SUFFIX })).toBe(true);
  });

  it('rejects a file merely added at the destination', () => {
    const dir = repoWithLiveSpec();
    mkdirSync(join(dir, DEST), { recursive: true });
    writeFileSync(join(dir, `${DEST}/2026-05-25${SUFFIX}`), 'copy\n');
    git(dir, ['add', '-A']);
    expect(renameDestExists({ cwd: dir, destDirRel: DEST, suffix: SUFFIX })).toBe(false);
  });

  it('rejects a rename into a different directory', () => {
    const dir = repoWithLiveSpec();
    mkdirSync(join(dir, 'docs/design/plans/archive'), { recursive: true });
    git(dir, [
      'mv',
      `docs/design/specs/2026-05-25${SUFFIX}`,
      `docs/design/plans/archive/2026-05-25${SUFFIX}`,
    ]);
    expect(renameDestExists({ cwd: dir, destDirRel: DEST, suffix: SUFFIX })).toBe(false);
  });

  it('falls back to full history when the base ref cannot be resolved', () => {
    const dir = repoWithLiveSpec();
    archive(dir);
    git(dir, ['commit', '-qm', 'archive']);
    git(dir, ['update-ref', '-d', 'refs/remotes/origin/main']);
    expect(renameDestExists({ cwd: dir, destDirRel: DEST, suffix: SUFFIX })).toBe(true);
  });

  it('throws when the staged probe itself fails (never reads as "no rename")', () => {
    const failing: RunGit = (args) =>
      args.includes('diff')
        ? { status: 128, stdout: '', stderr: 'fatal: not a git repository' }
        : { status: 0, stdout: '', stderr: '' };
    expect(() =>
      renameDestExists({ cwd: '/repo', destDirRel: DEST, runGit: failing, suffix: SUFFIX }),
    ).toThrow(/git diff --cached failed/);
  });

  it('throws when both history lookups fail', () => {
    const failing: RunGit = (args) =>
      args.includes('log')
        ? { status: 128, stdout: '', stderr: 'fatal: bad revision' }
        : { status: 0, stdout: '', stderr: '' };
    expect(() =>
      renameDestExists({ cwd: '/repo', destDirRel: DEST, runGit: failing, suffix: SUFFIX }),
    ).toThrow(/git log failed/);
  });

  it('does not count a rename made before the branch base', () => {
    const dir = repoWithLiveSpec();
    archive(dir);
    git(dir, ['commit', '-qm', 'archive']);
    // Base moves forward past the archival: from here it is history, not ours.
    git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    writeFileSync(join(dir, 'later.txt'), 'x\n');
    git(dir, ['add', '-A']);
    expect(renameDestExists({ cwd: dir, destDirRel: DEST, suffix: SUFFIX })).toBe(false);
  });
});

describe(toRepoRelative, () => {
  it('returns the repo-relative path from the root and from a subdirectory', () => {
    const dir = repoWithDivergedMain();
    const specs = join(dir, 'docs', 'design', 'specs');
    expect(toRepoRelative(specs, dir)).toBe('docs/design/specs');
    expect(toRepoRelative(specs, join(dir, 'docs'))).toBe('docs/design/specs');
  });

  it('collapses .. segments when the path is not under cwd', () => {
    const dir = repoWithDivergedMain();
    // cwd two levels deep, target back up at the root: the raw
    // `docs/design/` + `../../src` form would match nothing in git output.
    expect(toRepoRelative(join(dir, 'src'), join(dir, 'docs', 'design'))).toBe('src');
  });

  it('throws when the path lies outside the repository', () => {
    const dir = repoWithDivergedMain();
    expect(() => toRepoRelative(join(dir, '..', 'elsewhere'), dir)).toThrow(
      /outside the repository/,
    );
  });

  it('throws instead of degrading when git cannot report the prefix', () => {
    const failing: RunGit = () => ({
      status: 1,
      stdout: '',
      stderr: 'fatal: not a git repository',
    });
    expect(() => toRepoRelative('/repo/docs', '/repo', failing)).toThrow(/show-prefix/);
  });
});

describe(resolveDefaultBase, () => {
  it('falls back to origin/main when refs/remotes/origin/HEAD is absent', () => {
    const dir = repoWithDivergedMain();
    const run = (args: readonly string[]) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    expect(resolveDefaultBase(run)).toBe('origin/main');
  });

  it('returns the ref origin/HEAD points at', () => {
    const dir = repoWithDivergedMain();
    git(dir, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    const run = (args: readonly string[]) => {
      const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    expect(resolveDefaultBase(run)).toBe('origin/main');
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
