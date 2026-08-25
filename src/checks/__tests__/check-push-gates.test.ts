// @tests: gate-flow-rework
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GitOutcome, RunGit } from '../../core/branch-added.js';
import {
  EXCLUDED_JOBS,
  ZERO_SHA,
  buildRefLine,
  exclusionList,
  prePushJobs,
  runPushGates,
  type SpawnLike,
  type SpawnOutcome,
} from '../check-push-gates.js';

const HEAD = 'a'.repeat(40);
const REMOTE = 'b'.repeat(40);

const ok = (stdout: string): GitOutcome => ({ status: 0, stdout, stderr: '' });
const fail = (stderr = 'boom'): GitOutcome => ({ status: 1, stdout: '', stderr });

/** A git seam answering by first argument pair, defaulting to failure. */
function git(answers: Record<string, GitOutcome>): RunGit {
  return (args) => answers[args.join(' ')] ?? fail(`unstubbed: ${args.join(' ')}`);
}

const onBranch = (extra: Record<string, GitOutcome> = {}): RunGit =>
  git({
    'symbolic-ref --quiet --short HEAD': ok('fast/thing\n'),
    'rev-parse HEAD': ok(`${HEAD}\n`),
    ...extra,
  });

const BLOCK = [
  'pre-push:',
  '  jobs:',
  '    - name: noldor-enforce-review-receipt',
  '      run: pnpm noldor hooks enforce-review-receipt',
  '    - name: noldor-clones',
  '      run: pnpm noldor clones check',
  '',
].join('\n');

/** `null` means the framework block is absent from this consumer root. */
function consumer(block: string | null = BLOCK): string {
  const dir = mkdtempSync(join(tmpdir(), 'push-gates-'));
  if (block !== null) {
    mkdirSync(join(dir, 'lefthook'), { recursive: true });
    writeFileSync(join(dir, 'lefthook/noldor.yml'), block);
  }
  return dir;
}

/** Records what the replay was asked to spawn and answers with `outcome`. */
function spy(outcome: SpawnOutcome): {
  spawn: SpawnLike;
  calls: { bin: string; args: readonly string[]; input: string; env: NodeJS.ProcessEnv }[];
} {
  const calls: { bin: string; args: readonly string[]; input: string; env: NodeJS.ProcessEnv }[] =
    [];
  return {
    calls,
    spawn: (bin, args, opts) => {
      calls.push({ bin, args, input: opts.input, env: opts.env });
      return outcome;
    },
  };
}

describe('buildRefLine', () => {
  it('reports the remote-tracking sha when the branch already exists on the remote', () => {
    const r = buildRefLine(
      onBranch({ 'rev-parse --verify --quiet refs/remotes/origin/fast/thing': ok(`${REMOTE}\n`) }),
      'origin',
    );
    expect(r).toEqual({
      ok: true,
      branch: 'fast/thing',
      newRef: false,
      line: `refs/heads/fast/thing ${HEAD} refs/heads/fast/thing ${REMOTE}`,
    });
  });

  it('reports a zero remote sha when the remote has no such branch yet', () => {
    const r = buildRefLine(
      onBranch({ 'rev-parse --verify --quiet refs/remotes/origin/fast/thing': fail('') }),
      'origin',
    );
    expect(r).toEqual({
      ok: true,
      branch: 'fast/thing',
      newRef: true,
      line: `refs/heads/fast/thing ${HEAD} refs/heads/fast/thing ${ZERO_SHA}`,
    });
  });

  it('honours a non-origin remote when resolving the tracking ref', () => {
    const r = buildRefLine(
      onBranch({ 'rev-parse --verify --quiet refs/remotes/fork/fast/thing': ok(`${REMOTE}\n`) }),
      'fork',
    );
    expect(r.ok && r.line.endsWith(REMOTE)).toBe(true);
  });

  it('refuses a detached HEAD rather than inventing a branch name', () => {
    const r = buildRefLine(git({ 'symbolic-ref --quiet --short HEAD': fail('') }), 'origin');
    expect(r).toEqual({ ok: false, reason: 'HEAD is detached, so there is no branch to push' });
  });

  it('refuses when HEAD does not resolve, quoting git', () => {
    const r = buildRefLine(
      git({
        'symbolic-ref --quiet --short HEAD': ok('fast/thing\n'),
        'rev-parse HEAD': fail('bad object'),
      }),
      'origin',
    );
    expect(r).toEqual({ ok: false, reason: 'cannot resolve HEAD (bad object)' });
  });
});

describe('prePushJobs', () => {
  it('lists the block’s pre-push jobs minus the excluded ones', () => {
    expect(prePushJobs(consumer())).toEqual([
      { name: 'noldor-clones', run: 'pnpm noldor clones check' },
    ]);
  });

  it('returns nothing when the block is absent or has no pre-push hook', () => {
    expect(prePushJobs(consumer(null))).toEqual([]);
    expect(prePushJobs(consumer('pre-commit:\n  jobs:\n    - name: fmt\n      run: x\n'))).toEqual(
      [],
    );
  });

  it('skips malformed job entries instead of throwing', () => {
    const block = 'pre-push:\n  jobs:\n    - name: nameless\n    - run: runless\n    - 7\n';
    expect(prePushJobs(consumer(block))).toEqual([]);
  });
});

describe('exclusionList', () => {
  it('adds the framework exclusions', () => {
    expect(exclusionList(undefined)).toBe(EXCLUDED_JOBS.join(','));
  });

  it('preserves an operator’s own exclusions without duplicating ours', () => {
    expect(exclusionList(` readme , ${EXCLUDED_JOBS[0]} `)).toBe(`readme,${EXCLUDED_JOBS[0]}`);
  });
});

describe('runPushGates', () => {
  const base = { cwd: consumer(), remote: 'origin' };

  it('replays lefthook over the synthesized ref line and passes when it exits 0', () => {
    const { spawn, calls } = spy({ status: 0 });
    const code = runPushGates({ ...base, runGit: onBranch(), spawn });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(['run', 'pre-push', 'origin', '--no-auto-install']);
    expect(calls[0]!.input).toBe(
      `refs/heads/fast/thing ${HEAD} refs/heads/fast/thing ${ZERO_SHA}\n`,
    );
    expect(calls[0]!.env.LEFTHOOK_EXCLUDE).toContain(EXCLUDED_JOBS[0]);
  });

  it('exits 1 when a pre-push job refuses the tree', () => {
    const { spawn } = spy({ status: 1 });
    expect(runPushGates({ ...base, runGit: onBranch(), spawn })).toBe(1);
  });

  it('exits 3 — never green — when lefthook cannot be run at all', () => {
    const { spawn, calls } = spy({ status: null, error: new Error('spawn ENOENT') });
    expect(runPushGates({ ...base, runGit: onBranch(), spawn })).toBe(3);
    // Every candidate binary is tried before giving up.
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('exits 3 when lefthook is killed mid-run, since the gates did not finish', () => {
    const { spawn } = spy({ status: null, signal: 'SIGKILL' });
    expect(runPushGates({ ...base, runGit: onBranch(), spawn })).toBe(3);
  });

  it('exits 3 without spawning anything when there is no branch to push', () => {
    const { spawn, calls } = spy({ status: 0 });
    const code = runPushGates({
      ...base,
      runGit: git({ 'symbolic-ref --quiet --short HEAD': fail('') }),
      spawn,
    });
    expect(code).toBe(3);
    expect(calls).toEqual([]);
  });
});
