// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorktree } from '../create-worktree.js';

import type { CreateResult, InstallRunner } from '../create-worktree.js';

/** Unwrap a successful create, failing loudly on a refusal — the refusal cases
 *  assert the error arm directly instead. */
function unwrap(
  r: { ok: true; result: CreateResult } | { ok: false; error: unknown },
): CreateResult {
  if (!r.ok) throw new Error(`expected success, got refusal: ${JSON.stringify(r.error)}`);
  return r.result;
}

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
    const res = unwrap(
      await createWorktree({ slug: 'my-feature', cwd: root, installRunner: okInstall }),
    );
    expect(res.path).toBe(join(root, '.worktrees', 'my-feature'));
    expect(res.branch).toBe('feat/my-feature');
    expect(existsSync(res.path)).toBe(true);
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], res.path).trim()).toBe('feat/my-feature');
    const env = await readFile(join(res.path, '.env.local'), 'utf-8');
    expect(env).toMatch(/^PORT=\d+$/m);
    expect(res.installWarning).toBeNull();
  });

  it('honors --branch override', async () => {
    const res = unwrap(
      await createWorktree({
        slug: 'quick-fix',
        branch: 'fast/quick-fix',
        cwd: root,
        installRunner: okInstall,
      }),
    );
    expect(res.branch).toBe('fast/quick-fix');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], res.path).trim()).toBe('fast/quick-fix');
  });

  it('refuses a non-kebab slug without touching git', async () => {
    const r = await createWorktree({ slug: 'Bad_Slug', cwd: root, installRunner: okInstall });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('invalid-slug');
    expect(existsSync(join(root, '.worktrees'))).toBe(false);
  });

  it('refuses an existing worktree dir', async () => {
    await createWorktree({ slug: 'dupe', cwd: root, installRunner: okInstall });
    const r = await createWorktree({ slug: 'dupe', cwd: root, installRunner: okInstall });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('worktree-exists');
  });

  it('rejects an existing branch', async () => {
    git(['branch', 'feat/taken'], root);
    await expect(
      createWorktree({ slug: 'taken', cwd: root, installRunner: okInstall }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'branch-exists' } });
  });

  it('refuses to run from inside a worktree', async () => {
    const first = unwrap(
      await createWorktree({ slug: 'outer', cwd: root, installRunner: okInstall }),
    );
    await expect(
      createWorktree({ slug: 'inner', cwd: first.path, installRunner: okInstall }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'not-main-workspace' } });
  });

  it('tolerates the lefthook hooksPath postinstall failure when node_modules landed', async () => {
    const lefthookFail: InstallRunner = async (cwd) => {
      await mkdir(join(cwd, 'node_modules', '.bin'), { recursive: true });
      return { code: 1, output: "│  core.hooksPath is set locally to '/x/.git/hooks'" };
    };
    const res = unwrap(
      await createWorktree({ slug: 'tolerated', cwd: root, installRunner: lefthookFail }),
    );
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

  describe('base commit', () => {
    let origin: string;
    let other: string;

    /** Wire `root` to a bare `origin`, then land `count` commits on origin/main
     *  from a second clone — the state a merged PR leaves behind. */
    async function originAhead(count: number): Promise<string> {
      origin = await mkdtemp(join(tmpdir(), 'cwt-origin-'));
      git(['init', '--bare', '-b', 'main'], origin);
      git(['remote', 'add', 'origin', origin], root);
      git(['push', '-q', 'origin', 'main'], root);
      other = await mkdtemp(join(tmpdir(), 'cwt-other-'));
      git(['clone', '-q', origin, other], other);
      git(['config', 'user.email', 't@t'], other);
      git(['config', 'user.name', 't'], other);
      for (let i = 0; i < count; i++) git(['commit', '--allow-empty', '-m', `merged ${i}`], other);
      git(['push', '-q', 'origin', 'main'], other);
      return git(['rev-parse', 'HEAD'], other).trim();
    }

    afterEach(async () => {
      if (origin) await rm(origin, { recursive: true, force: true });
      if (other) await rm(other, { recursive: true, force: true });
    });

    it('fetches and branches from origin/main when local main is behind', async () => {
      const merged = await originAhead(2);
      const res = unwrap(
        await createWorktree({ slug: 'fresh', cwd: root, installRunner: okInstall }),
      );
      expect(git(['rev-parse', 'HEAD'], res.path).trim()).toBe(merged);
    });

    it('keeps local HEAD when it carries commits origin/main lacks', async () => {
      await originAhead(1);
      git(['commit', '--allow-empty', '-m', 'local only'], root);
      const local = git(['rev-parse', 'HEAD'], root).trim();
      const log = vi.fn();
      const res = unwrap(
        await createWorktree({ slug: 'ahead', cwd: root, installRunner: okInstall, log }),
      );
      expect(git(['rev-parse', 'HEAD'], res.path).trim()).toBe(local);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/not on origin\/main/));
    });

    it('falls back to local HEAD when the fetch fails', async () => {
      git(['remote', 'add', 'origin', join(root, 'no-such-remote')], root);
      const local = git(['rev-parse', 'HEAD'], root).trim();
      const log = vi.fn();
      const res = unwrap(
        await createWorktree({ slug: 'offline', cwd: root, installRunner: okInstall, log }),
      );
      expect(git(['rev-parse', 'HEAD'], res.path).trim()).toBe(local);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/could not fetch origin main/));
    });
  });

  it('skips install when install: false', async () => {
    const spy = vi.fn(okInstall);
    const res = unwrap(
      await createWorktree({
        slug: 'restore',
        cwd: root,
        install: false,
        installRunner: spy,
      }),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(res.installWarning).toBeNull();
  });
});
