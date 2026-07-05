// src/release/__tests__/release-fd-commits.test.ts
// @tests: dynamic-fd-changelog, feature-md-links-overhaul

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { commitsForFeature, parseCommitLine } from '../release-fd-commits.js';

const execFileP = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd });
  return stdout.trim();
}

async function commit(cwd: string, file: string, content: string, message: string): Promise<void> {
  await writeFile(join(cwd, file), content, 'utf8');
  await git(cwd, ['add', file]);
  await git(cwd, ['commit', '-m', message]);
}

describe('parseCommitLine', () => {
  it('extracts sha, type, subject, date from tab-separated line', () => {
    const line = 'abc123def456\tfeat(engine:boolean-operations): add subtract\t2026-05-08';
    expect(parseCommitLine(line)).toEqual({
      sha: 'abc123def456',
      type: 'feat',
      subject: 'add subtract',
      date: '2026-05-08',
    });
  });

  it('preserves the `!` breaking marker on type', () => {
    const line = 'def456abc789\tfeat!(engine:boolean-operations): drop legacy api\t2026-05-08';
    expect(parseCommitLine(line)?.type).toBe('feat!');
  });

  it('returns null on unparseable input', () => {
    expect(parseCommitLine('not a commit line')).toBeNull();
  });
});

describe('commitsForFeature', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'cff-'));
    await git(repo, ['init', '-q']);
    await git(repo, ['config', 'user.email', 'test@test']);
    await git(repo, ['config', 'user.name', 'Test']);
    await git(repo, ['config', 'commit.gpgsign', 'false']);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('returns commits whose scope matches `<pkg>:<slug>`', async () => {
    await commit(repo, 'a.txt', '1', 'feat(engine:boolean-operations): add subtract op');
    await commit(repo, 'b.txt', '2', 'fix(engine:csg-primitives): cone radius default');
    const result = await commitsForFeature('boolean-operations', '', 'HEAD', repo);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe('add subtract op');
  });

  it('ignores commits without a slug', async () => {
    await commit(repo, 'a.txt', '1', 'feat(engine): refactor internal helper');
    await commit(repo, 'b.txt', '2', 'feat(engine:boolean-operations): add subtract');
    const result = await commitsForFeature('boolean-operations', '', 'HEAD', repo);
    expect(result).toHaveLength(1);
  });

  it('ignores commits with a different slug', async () => {
    await commit(repo, 'a.txt', '1', 'feat(engine:csg-primitives): add torus');
    const result = await commitsForFeature('boolean-operations', '', 'HEAD', repo);
    expect(result).toEqual([]);
  });

  it('respects `from..to` range', async () => {
    await commit(repo, 'a.txt', '1', 'feat(engine:boolean-operations): pre-tag');
    await git(repo, ['tag', 'v0.1.0']);
    await commit(repo, 'b.txt', '2', 'feat(engine:boolean-operations): post-tag');
    const result = await commitsForFeature('boolean-operations', 'v0.1.0', 'HEAD', repo);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe('post-tag');
  });

  it('captures the breaking-change `!` marker', async () => {
    await commit(repo, 'a.txt', '1', 'feat!(engine:boolean-operations): drop legacy api');
    const result = await commitsForFeature('boolean-operations', '', 'HEAD', repo);
    expect(result[0].type).toBe('feat!');
  });

  it('throws when fromRef === toRef (footgun: silently logs all of HEAD)', async () => {
    await commit(repo, 'a.txt', '1', 'feat(engine:boolean-operations): first');
    await expect(commitsForFeature('boolean-operations', 'HEAD', 'HEAD', repo)).rejects.toThrow(
      /equal refs/i,
    );
  });

  it("treats fromRef === '' as repo-start: returns commits reachable from toRef only", async () => {
    await commit(repo, 'a.txt', '1', 'feat(engine:boolean-operations): pre-tag');
    await git(repo, ['tag', 'v0.1.0']);
    // Commits AFTER the first tag must NOT appear in the v0.1.0 bucket.
    await commit(repo, 'b.txt', '2', 'feat(engine:boolean-operations): post-tag');
    const result = await commitsForFeature('boolean-operations', '', 'v0.1.0', repo);
    expect(result.map((c) => c.subject)).toEqual(['pre-tag']);
  });

  it("with '' fromRef and HEAD: returns every matching commit reachable from HEAD", async () => {
    await commit(repo, 'a.txt', '1', 'feat(engine:boolean-operations): first');
    await commit(repo, 'b.txt', '2', 'feat(engine:boolean-operations): second');
    await commit(repo, 'c.txt', '3', 'feat(engine:csg-primitives): unrelated');
    const result = await commitsForFeature('boolean-operations', '', 'HEAD', repo);
    expect(result.map((c) => c.subject)).toEqual(['second', 'first']);
  });

  it('returns commits matched by Noldor-FD trailer (no scope match)', async () => {
    await writeFile(join(repo, 'a.txt'), '1', 'utf8');
    await git(repo, ['add', 'a.txt']);
    await git(repo, [
      'commit',
      '-m',
      'feat(engine): unrelated',
      '-m',
      'Noldor-FD: boolean-operations',
    ]);
    const result = await commitsForFeature('boolean-operations', '', 'HEAD', repo);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe('unrelated');
  });

  it('deduplicates when scope and trailer both match the same slug', async () => {
    await writeFile(join(repo, 'a.txt'), '1', 'utf8');
    await git(repo, ['add', 'a.txt']);
    await git(repo, [
      'commit',
      '-m',
      'feat(engine:boolean-operations): double match',
      '-m',
      'Noldor-FD: boolean-operations',
    ]);
    const result = await commitsForFeature('boolean-operations', '', 'HEAD', repo);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe('double match');
  });
});
