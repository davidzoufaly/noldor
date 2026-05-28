// @tests: framework-pr-flow-agent-auto-merge

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findFirstPrCommit } from '../release-find-first-pr-commit.js';

const exec = (cmd: string, args: string[], cwd: string) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { cwd }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });

describe('findFirstPrCommit', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'first-pr-'));
    await exec('git', ['init', '-q'], cwd);
    await exec('git', ['config', 'user.email', 't@e'], cwd);
    await exec('git', ['config', 'user.name', 't'], cwd);
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function commit(subject: string) {
    await exec('git', ['commit', '--allow-empty', '-m', subject], cwd);
    // FeatureCommit truncates SHA to 12 chars (release-fd-commits.ts:41);
    // match that convention so equality comparisons work.
    const sha = (await exec('git', ['rev-parse', 'HEAD'], cwd)).trim().slice(0, 12);
    return sha;
  }

  it('returns the oldest slug-matching commit with a PR ref', async () => {
    await commit('feat(pkg:foo): older without PR');
    const expected = await commit('feat(pkg:foo): older with PR (#10)');
    await commit('feat(pkg:foo): newer with PR (#42)');
    const sha = await findFirstPrCommit('foo', cwd);
    expect(sha).toBe(expected);
  });

  it('returns null when no slug-matching commit has a PR ref', async () => {
    await commit('feat(pkg:foo): plain one');
    await commit('feat(pkg:foo): plain two');
    const sha = await findFirstPrCommit('foo', cwd);
    expect(sha).toBeNull();
  });

  it('returns null when no commit matches the slug at all', async () => {
    await commit('chore: unrelated');
    const sha = await findFirstPrCommit('foo', cwd);
    expect(sha).toBeNull();
  });
});
