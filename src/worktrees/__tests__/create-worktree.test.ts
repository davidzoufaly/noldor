import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorktree } from '../create-worktree.js';

import type { InstallRunner } from '../create-worktree.js';

let root: string;

const okInstall: InstallRunner = vi.fn(async () => ({ code: 0, output: '' }));

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cwt-'));
  git(['init', '-b', 'main'], root);
  git(['config', 'user.email', 't@t'], root);
  git(['config', 'user.name', 't'], root);
  git(['commit', '--allow-empty', '-m', 'init'], root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createWorktree', () => {
  it('creates .worktrees/<slug> on feat/<slug> and stamps a port', async () => {
    const res = await createWorktree({ slug: 'my-feature', cwd: root, installRunner: okInstall });
    expect(res.path).toBe(join(root, '.worktrees', 'my-feature'));
    expect(res.branch).toBe('feat/my-feature');
    expect(existsSync(res.path)).toBe(true);
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], res.path).trim()).toBe('feat/my-feature');
    const env = await readFile(join(res.path, '.env.local'), 'utf-8');
    expect(env).toMatch(/^PORT=\d+$/m);
    expect(res.installWarning).toBeNull();
  });

  it('honors --branch override', async () => {
    const res = await createWorktree({
      slug: 'quick-fix',
      branch: 'fast/quick-fix',
      cwd: root,
      installRunner: okInstall,
    });
    expect(res.branch).toBe('fast/quick-fix');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], res.path).trim()).toBe('fast/quick-fix');
  });

  it('rejects a non-kebab slug', async () => {
    await expect(
      createWorktree({ slug: 'Bad_Slug', cwd: root, installRunner: okInstall }),
    ).rejects.toThrow(/kebab-case/);
  });

  it('rejects an existing worktree dir', async () => {
    await createWorktree({ slug: 'dupe', cwd: root, installRunner: okInstall });
    await expect(
      createWorktree({ slug: 'dupe', cwd: root, installRunner: okInstall }),
    ).rejects.toThrow(/already exists/);
  });

  it('rejects an existing branch', async () => {
    git(['branch', 'feat/taken'], root);
    await expect(
      createWorktree({ slug: 'taken', cwd: root, installRunner: okInstall }),
    ).rejects.toThrow(/branch already exists/);
  });

  it('refuses to run from inside a worktree', async () => {
    const first = await createWorktree({ slug: 'outer', cwd: root, installRunner: okInstall });
    await expect(
      createWorktree({ slug: 'inner', cwd: first.path, installRunner: okInstall }),
    ).rejects.toThrow(/main workspace/);
  });

  it('tolerates the lefthook hooksPath postinstall failure when node_modules landed', async () => {
    const lefthookFail: InstallRunner = async (cwd) => {
      await mkdir(join(cwd, 'node_modules', '.bin'), { recursive: true });
      return { code: 1, output: "│  core.hooksPath is set locally to '/x/.git/hooks'" };
    };
    const res = await createWorktree({ slug: 'tolerated', cwd: root, installRunner: lefthookFail });
    expect(res.installWarning).toMatch(/lefthook postinstall failed/);
  });

  it('hard-fails any other install failure', async () => {
    const otherFail: InstallRunner = async () => ({
      code: 1,
      output: 'ERR_PNPM_NO_MATCHING_VERSION',
    });
    await expect(
      createWorktree({ slug: 'broken', cwd: root, installRunner: otherFail }),
    ).rejects.toThrow(/pnpm install failed/);
  });

  it('skips install when install: false', async () => {
    const spy = vi.fn(okInstall);
    const res = await createWorktree({
      slug: 'restore',
      cwd: root,
      install: false,
      installRunner: spy,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(res.installWarning).toBeNull();
  });
});
