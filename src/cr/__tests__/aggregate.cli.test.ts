// @tests: noldor
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const CLI = resolve(__dirname, '..', 'aggregate-cli.ts');
const FIX = resolve(__dirname, 'fixtures');
// Use repo-local tsx binary directly. `pnpm exec tsx` errors when invoked from
// a cwd outside the pnpm workspace (the test tmp dir).
const TSX = resolve(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agg-cli-'));
  await mkdir(join(root, '.noldor', 'cr'), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('aggregate CLI', () => {
  it('exits 0 when clean', async () => {
    await copyFile(
      join(FIX, 'findings-clean.json'),
      join(root, '.noldor', 'cr', 'x-spec-manual.json'),
    );
    const r = await exec(TSX, [CLI, '--slug', 'x', '--kind', 'spec'], {
      cwd: root,
    });
    expect(r.stdout).toMatch(/manual.*operator approved/);
  });
  it('exits 1 when blockers', async () => {
    await copyFile(
      join(FIX, 'findings-blockers.json'),
      join(root, '.noldor', 'cr', 'x-spec-reviewer.json'),
    );
    await expect(
      exec(TSX, [CLI, '--slug', 'x', '--kind', 'spec'], { cwd: root }),
    ).rejects.toMatchObject({ code: 1 });
  });

  // The gate's kind-less "wait for in-flight lanes" step asks whether a lane is
  // still writing, not whether its verdict was green. A spec sink left red by a
  // fix-and-proceed at the re-round cap used to re-red that step and force a
  // manual override on every such session.
  describe('--unresolved-only (Q-0154)', () => {
    it('exits 0 on a finished-but-red sink, still printing the finding', async () => {
      await copyFile(
        join(FIX, 'findings-blockers.json'),
        join(root, '.noldor', 'cr', 'x-spec-reviewer.json'),
      );
      const r = await exec(TSX, [CLI, '--slug', 'x', '--unresolved-only'], { cwd: root });
      expect(r.stdout).toMatch(/missing type/);
      expect(r.stdout).toMatch(/ok=true/);
      expect(r.stdout).toMatch(/1 lane finding\(s\) above do NOT gate/);
    });
    it('exits 1 while a lane is still unresolved', async () => {
      await copyFile(
        join(FIX, 'findings-in-progress.json'),
        join(root, '.noldor', 'cr', 'x-spec-standalone.json'),
      );
      await expect(
        exec(TSX, [CLI, '--slug', 'x', '--unresolved-only'], { cwd: root }),
      ).rejects.toMatchObject({ code: 1 });
    });
    it('exits 1 on an untrustworthy sink — integrity is never muted', async () => {
      await writeFile(join(root, '.noldor', 'cr', 'x-spec-manual.json'), '{not json', 'utf8');
      await expect(
        exec(TSX, [CLI, '--slug', 'x', '--unresolved-only'], { cwd: root }),
      ).rejects.toMatchObject({ code: 1 });
    });
    it('exits 1 on a corrupt expected-lanes record — the Q-0100 hole stays closed', async () => {
      const dir = join(root, '.noldor', 'cr', 'expected');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'x-spec.json'), '{not json', 'utf8');
      await expect(
        exec(TSX, [CLI, '--slug', 'x', '--unresolved-only'], { cwd: root }),
      ).rejects.toMatchObject({ code: 1 });
    });
  });
});
