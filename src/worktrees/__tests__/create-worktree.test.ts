// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows, parallel-worktree-workflow
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorktree, runWithDeadline } from '../create-worktree.js';

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

  describe('local env files', () => {
    it('copies each listed file the main workspace has, nested paths included', async () => {
      await writeFile(join(root, '.env'), 'DATABASE_URL=postgres://local\n');
      await mkdir(join(root, 'apps', 'api'), { recursive: true });
      await writeFile(join(root, 'apps', 'api', '.env'), 'API_KEY=k\n');
      const res = unwrap(
        await createWorktree({
          slug: 'with-env',
          cwd: root,
          installRunner: okInstall,
          envFiles: ['.env', 'apps/api/.env', '.env.missing'],
        }),
      );
      expect(res.envFilesCopied).toEqual(['.env', 'apps/api/.env']);
      expect(await readFile(join(res.path, '.env'), 'utf-8')).toBe(
        'DATABASE_URL=postgres://local\n',
      );
      expect(await readFile(join(res.path, 'apps', 'api', '.env'), 'utf-8')).toBe('API_KEY=k\n');
      expect(existsSync(join(res.path, '.env.missing'))).toBe(false);
    });

    it('skips an entry it cannot copy, names it, and still finishes the tree', async () => {
      await mkdir(join(root, 'secrets.env'), { recursive: true });
      await writeFile(join(root, '.env'), 'X=1\n');
      const lines: string[] = [];
      const res = unwrap(
        await createWorktree({
          slug: 'dir-env',
          cwd: root,
          installRunner: okInstall,
          envFiles: ['secrets.env', '.env'],
          log: (line) => lines.push(line),
        }),
      );
      expect(res.envFilesCopied).toEqual(['.env']);
      // copyfile on a directory is EISDIR on Linux, ENOTSUP on macOS.
      expect(lines).toContainEqual(
        expect.stringMatching(/^env file skipped: secrets\.env \((EISDIR|ENOTSUP):/),
      );
      expect(existsSync(join(res.path, 'secrets.env'))).toBe(false);
      expect(await readFile(join(res.path, '.env.local'), 'utf-8')).toMatch(/^PORT=\d+$/m);
    });

    it('never overwrites a file the branch already tracks', async () => {
      await writeFile(join(root, 'config.env'), 'TRACKED=1\n');
      git(['add', 'config.env'], root);
      git(['commit', '-q', '-m', 'track config.env'], root);
      await writeFile(join(root, 'config.env'), 'LOCAL_EDIT=1\n');
      const res = unwrap(
        await createWorktree({
          slug: 'tracked-env',
          cwd: root,
          installRunner: okInstall,
          envFiles: ['config.env'],
        }),
      );
      expect(res.envFilesCopied).toEqual([]);
      expect(await readFile(join(res.path, 'config.env'), 'utf-8')).toBe('TRACKED=1\n');
    });

    it('reads the list from consumer.worktreeEnvFiles when none is passed', async () => {
      await mkdir(join(root, '.noldor'), { recursive: true });
      await writeFile(
        join(root, '.noldor', 'config.json'),
        JSON.stringify({
          consumer: {
            name: 'c',
            repoUrl: 'https://example.com/c',
            lockstepPackages: ['package.json'],
            e2ePrefix: 'e2e/',
            samplesPath: 'samples',
            packagePrefix: '@c/',
            appPathPrefix: 'src',
            worktreeEnvFiles: ['.env'],
          },
        }),
      );
      await writeFile(join(root, '.env'), 'FROM_CONFIG=1\n');
      const res = unwrap(
        await createWorktree({ slug: 'cfg-env', cwd: root, installRunner: okInstall }),
      );
      expect(res.envFilesCopied).toEqual(['.env']);
      expect(await readFile(join(res.path, '.env'), 'utf-8')).toBe('FROM_CONFIG=1\n');
    });

    describe('keys only the tracked example defines', () => {
      async function trackExample(name: string, body: string): Promise<void> {
        await writeFile(join(root, name), body);
        git(['add', name], root);
        git(['commit', '-q', '-m', `track ${name}`], root);
      }

      it('appends each missing key to the copy, leaving the main workspace file alone', async () => {
        await trackExample(
          '.env.example',
          '# local db\nDATABASE_URL=postgres://example\nexport DB_SMOKE_URL=postgres://smoke\n\nAPI_KEY=\n',
        );
        await writeFile(join(root, '.env'), 'DATABASE_URL=postgres://local');
        const res = unwrap(
          await createWorktree({
            slug: 'fill-keys',
            cwd: root,
            installRunner: okInstall,
            envFiles: ['.env'],
          }),
        );
        expect(res.envKeysFilled).toEqual([
          { file: '.env', from: '.env.example', keys: ['DB_SMOKE_URL', 'API_KEY'] },
        ]);
        expect(await readFile(join(res.path, '.env'), 'utf-8')).toBe(
          'DATABASE_URL=postgres://local\n' +
            '\n# filled from .env.example by noldor worktrees create\n' +
            'export DB_SMOKE_URL=postgres://smoke\nAPI_KEY=\n',
        );
        expect(await readFile(join(root, '.env'), 'utf-8')).toBe('DATABASE_URL=postgres://local');
      });

      it('fills nothing when the copy already defines every example key', async () => {
        await trackExample('.env.example', 'DATABASE_URL=postgres://example\n');
        await writeFile(join(root, '.env'), '# mine\nexport DATABASE_URL=postgres://local\n');
        const res = unwrap(
          await createWorktree({
            slug: 'all-keys',
            cwd: root,
            installRunner: okInstall,
            envFiles: ['.env'],
          }),
        );
        expect(res.envKeysFilled).toEqual([]);
        expect(await readFile(join(res.path, '.env'), 'utf-8')).toBe(
          '# mine\nexport DATABASE_URL=postgres://local\n',
        );
      });

      it('fills nothing when no example sits beside the copied file', async () => {
        await trackExample('.env.sample', 'DB_SMOKE_URL=postgres://smoke\n');
        await writeFile(join(root, '.env'), 'DATABASE_URL=postgres://local\n');
        const res = unwrap(
          await createWorktree({
            slug: 'no-example',
            cwd: root,
            installRunner: okInstall,
            envFiles: ['.env'],
          }),
        );
        expect(res.envKeysFilled).toEqual([]);
        expect(await readFile(join(res.path, '.env'), 'utf-8')).toBe(
          'DATABASE_URL=postgres://local\n',
        );
      });

      it('never fills a file the branch tracks', async () => {
        await trackExample('config.env.example', 'DB_SMOKE_URL=postgres://smoke\n');
        await trackExample('config.env', 'TRACKED=1\n');
        const res = unwrap(
          await createWorktree({
            slug: 'tracked-fill',
            cwd: root,
            installRunner: okInstall,
            envFiles: ['config.env'],
          }),
        );
        expect(res.envKeysFilled).toEqual([]);
        expect(await readFile(join(res.path, 'config.env'), 'utf-8')).toBe('TRACKED=1\n');
      });
    });

    it('copies nothing when the repo has no config', async () => {
      await writeFile(join(root, '.env'), 'X=1\n');
      const res = unwrap(
        await createWorktree({ slug: 'no-cfg', cwd: root, installRunner: okInstall }),
      );
      expect(res.envFilesCopied).toEqual([]);
      expect(existsSync(join(res.path, '.env'))).toBe(false);
    });
  });

  describe('bootstrap command', () => {
    it('runs the command inside the new tree after the install', async () => {
      const res = unwrap(
        await createWorktree({
          slug: 'boot',
          cwd: root,
          installRunner: okInstall,
          bootstrap: 'mkdir -p dist && echo built > dist/marker',
        }),
      );
      expect(res.bootstrapRan).toBe('mkdir -p dist && echo built > dist/marker');
      expect(await readFile(join(res.path, 'dist', 'marker'), 'utf-8')).toBe('built\n');
      expect(existsSync(join(root, 'dist'))).toBe(false);
    });

    it('reads the command from consumer.worktreeBootstrap when none is passed', async () => {
      await mkdir(join(root, '.noldor'), { recursive: true });
      await writeFile(
        join(root, '.noldor', 'config.json'),
        JSON.stringify({
          consumer: {
            name: 'c',
            repoUrl: 'https://example.com/c',
            lockstepPackages: ['package.json'],
            e2ePrefix: 'e2e/',
            samplesPath: 'samples',
            packagePrefix: '@c/',
            appPathPrefix: 'src',
            worktreeBootstrap: 'touch bootstrapped',
          },
        }),
      );
      const res = unwrap(
        await createWorktree({ slug: 'cfg-boot', cwd: root, installRunner: okInstall }),
      );
      expect(res.bootstrapRan).toBe('touch bootstrapped');
      expect(existsSync(join(res.path, 'bootstrapped'))).toBe(true);
    });

    it('runs nothing when the repo has no config', async () => {
      const res = unwrap(
        await createWorktree({ slug: 'no-boot', cwd: root, installRunner: okInstall }),
      );
      expect(res.bootstrapRan).toBeNull();
    });

    it('throws with the command output when the command fails', async () => {
      await expect(
        createWorktree({
          slug: 'boot-fail',
          cwd: root,
          installRunner: okInstall,
          bootstrap: 'echo cannot resolve @c/core >&2; exit 3',
        }),
      ).rejects.toThrow(/worktree bootstrap failed[\s\S]*cannot resolve @c\/core/);
    });

    it('throws once the command passes its deadline', async () => {
      const started = Date.now();
      await expect(
        createWorktree({
          slug: 'boot-hang',
          cwd: root,
          installRunner: okInstall,
          bootstrap: 'echo building; sleep 30',
          deadlineMs: 300,
        }),
      ).rejects.toThrow(/worktree bootstrap failed[\s\S]*building[\s\S]*timed out after 300 ms/);
      expect(Date.now() - started).toBeLessThan(10_000);
    });

    it('skips the command when install: false', async () => {
      const res = unwrap(
        await createWorktree({
          slug: 'boot-restore',
          cwd: root,
          install: false,
          installRunner: okInstall,
          bootstrap: 'touch bootstrapped',
        }),
      );
      expect(res.bootstrapRan).toBeNull();
      expect(existsSync(join(res.path, 'bootstrapped'))).toBe(false);
    });
  });

  it('hard-fails a timed-out install even when its output looks tolerable', async () => {
    const timedOut: InstallRunner = async (cwd) => {
      await mkdir(join(cwd, 'node_modules', '.bin'), { recursive: true });
      return { code: 1, output: 'core.hooksPath is set locally', timedOut: true };
    };
    await expect(
      createWorktree({ slug: 'install-hang', cwd: root, installRunner: timedOut }),
    ).rejects.toThrow(/pnpm install failed/);
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

describe('runWithDeadline', () => {
  it('returns the exit code and combined output of a finished run', async () => {
    const res = await runWithDeadline('sh', ['-c', 'echo out; echo err >&2; exit 3'], root, 5_000);
    expect(res).toMatchObject({ code: 3, timedOut: false });
    expect(res.output).toMatch(/out[\s\S]*err|err[\s\S]*out/);
  });

  it('settles at the deadline even when a grandchild holds the output pipe', async () => {
    const started = Date.now();
    const res = await runWithDeadline('sh', ['-c', 'sleep 30 & wait'], root, 300);
    expect(res.timedOut).toBe(true);
    expect(res.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('resolves a spawn error instead of rejecting', async () => {
    const res = await runWithDeadline('no-such-binary-noldor', [], root, 5_000);
    expect(res).toMatchObject({ code: 1, timedOut: false });
  });
});
