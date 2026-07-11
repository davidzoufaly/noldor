// @tests: noldor-native-wait-primitive
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const CLI = resolve(__dirname, '..', 'wait-cli.ts');
const BIN = resolve(__dirname, '..', '..', '..', 'bin', 'noldor.mjs');
// Repo-local tsx binary — `pnpm exec tsx` errors from a cwd outside the workspace.
const TSX = resolve(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');

let root: string;
let state: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wait-cli-'));
  state = join(root, 'state.json');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const write = (obj: unknown) => writeFile(state, JSON.stringify(obj), 'utf8');
const runWait = (args: string[]) => exec(TSX, [CLI, ...args], { cwd: root });

describe('noldor wait CLI', () => {
  it('exits 0 and emits a value when --until is already satisfied', async () => {
    await write({ phase: 'idle', shipped: 3 });
    const r = await runWait([
      state,
      '--until',
      'phase==idle',
      '--emit',
      'shipped',
      '--timeout-ms',
      '1000',
      '--interval-ms',
      '50',
    ]);
    expect(r.stdout.trim()).toBe('3');
  });

  it('emits an object/array as JSON', async () => {
    await write({ phase: 'idle', inFlight: [{ slug: 'x' }] });
    const r = await runWait([state, '--until', 'phase==idle', '--emit', 'inFlight', '--quiet']);
    expect(JSON.parse(r.stdout)).toEqual([{ slug: 'x' }]);
  });

  it('exits 1 when --fail-if matches (and wins over --until)', async () => {
    await write({ finishedAt: '2026-01-01', blockers: [{ m: 'bug' }] });
    await expect(
      runWait([
        state,
        '--until',
        'finishedAt?',
        '--fail-if',
        'blockers.0?',
        '--timeout-ms',
        '1000',
        '--interval-ms',
        '50',
      ]),
    ).rejects.toMatchObject({ code: 1 });
  });

  it('exits 2 on timeout when a readable file never matches', async () => {
    await write({ phase: 'spawning' });
    await expect(
      runWait([state, '--until', 'phase==idle', '--timeout-ms', '200', '--interval-ms', '50']),
    ).rejects.toMatchObject({ code: 2 });
  });

  it('exits 2 on timeout when the state file never appears', async () => {
    // no write() — file is absent for the whole run
    const err = await runWait([
      state,
      '--until',
      'phase==idle',
      '--timeout-ms',
      '200',
      '--interval-ms',
      '50',
    ]).catch((e: unknown) => e as { code: number; stderr: string });
    expect(err.code).toBe(2);
    expect(err.stderr).toMatch(/never|readable|not.*read/i);
  });

  it('exits 3 on a malformed --until predicate', async () => {
    await write({ phase: 'idle' });
    await expect(runWait([state, '--until', 'phase=idle'])).rejects.toMatchObject({ code: 3 });
  });

  it('exits 3 on a non-numeric --timeout-ms', async () => {
    await write({ phase: 'idle' });
    await expect(
      runWait([state, '--until', 'phase==idle', '--timeout-ms', 'garbage']),
    ).rejects.toMatchObject({
      code: 3,
    });
  });

  it('exits 3 when --until is missing', async () => {
    await write({ phase: 'idle' });
    await expect(runWait([state])).rejects.toMatchObject({ code: 3 });
  });

  it('exits 3 when the state-file positional is missing', async () => {
    await expect(runWait(['--until', 'phase==idle'])).rejects.toMatchObject({ code: 3 });
  });

  it('prints progress to stderr and keeps stdout clean; --quiet silences it', async () => {
    await write({ phase: 'idle', shipped: 7 });
    const loud = await runWait([state, '--until', 'phase==idle', '--emit', 'shipped']);
    expect(loud.stdout.trim()).toBe('7');
    expect(loud.stderr).toContain('wait:');

    const quiet = await runWait([state, '--until', 'phase==idle', '--emit', 'shipped', '--quiet']);
    expect(quiet.stdout.trim()).toBe('7');
    expect(quiet.stderr).not.toContain('wait:');
  });

  it('is listed in `noldor --help`', async () => {
    const r = await exec('node', [BIN, '--help']);
    expect(r.stdout).toContain('wait');
  });
});
