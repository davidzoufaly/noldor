// packages/noldor/src/release/__tests__/fd-prs-since-tag.test.ts
// @tests: fd-prs-since-last-release-section

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prsSinceLastTag } from '../fd-prs-since-tag.js';

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

const repoUrl = 'https://github.com/example/repo';

describe('prsSinceLastTag', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'fd-prs-since-tag-'));
    await git(cwd, ['init', '--initial-branch=main']);
    await git(cwd, ['config', 'user.email', 'test@example.com']);
    await git(cwd, ['config', 'user.name', 'Test']);
    await commit(cwd, 'README.md', '# init', 'chore: initial commit');
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('returns 3 refs when slug matches 3 PR-bearing feat commits since tag', async () => {
    await git(cwd, ['tag', 'v0.1.0']);
    await commit(cwd, 'a.txt', '1', 'feat(area:foo): first (#1)');
    await commit(cwd, 'b.txt', '2', 'feat(area:foo): second (#2)');
    await commit(cwd, 'c.txt', '3', 'feat(area:foo): third (#3)');
    await commit(cwd, 'd.txt', '4', 'feat(area:foo): non-pr');
    await commit(cwd, 'e.txt', '5', 'chore(area:foo): noise (#99)');

    const refs = await prsSinceLastTag('foo', cwd, repoUrl);

    expect(refs).toHaveLength(3);
    expect(refs.map((r) => r.number)).toEqual([3, 2, 1]); // newest-first
    expect(refs[0]).toEqual({
      number: 3,
      title: 'third',
      url: 'https://github.com/example/repo/pull/3',
    });
  });

  it('walks from repo-start when no semver tag is reachable', async () => {
    await commit(cwd, 'a.txt', '1', 'feat(area:bar): first (#10)');
    await commit(cwd, 'b.txt', '2', 'feat(area:bar): second (#11)');

    const refs = await prsSinceLastTag('bar', cwd, repoUrl);

    expect(refs.map((r) => r.number)).toEqual([11, 10]);
  });

  it('returns empty array when tag is present and no PRs touch slug', async () => {
    await git(cwd, ['tag', 'v0.1.0']);
    await commit(cwd, 'a.txt', '1', 'feat(area:other): unrelated (#1)');

    const refs = await prsSinceLastTag('foo', cwd, repoUrl);

    expect(refs).toEqual([]);
  });

  it('dedupes repeated PR numbers (revert + re-merge case)', async () => {
    await git(cwd, ['tag', 'v0.1.0']);
    await commit(cwd, 'a.txt', '1', 'feat(area:foo): add (#42)');
    await commit(cwd, 'b.txt', '2', 'revert(area:foo): drop (#42)');
    await commit(cwd, 'c.txt', '3', 'feat(area:foo): re-add (#42)');

    const refs = await prsSinceLastTag('foo', cwd, repoUrl);

    expect(refs).toHaveLength(1);
    expect(refs[0].number).toBe(42);
  });
});
