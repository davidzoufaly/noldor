// @tests: noldor
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
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
      join(root, '.noldor', 'cr', 'x-spec-subagent.json'),
    );
    await expect(
      exec(TSX, [CLI, '--slug', 'x', '--kind', 'spec'], { cwd: root }),
    ).rejects.toMatchObject({ code: 1 });
  });
});
