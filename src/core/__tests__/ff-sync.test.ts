// @tests: memory-intake-lessons-learned-pipeline
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ffSyncMain } from '../ff-sync.js';

let root: string;
let upstream: string;
let local: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function commitUpstream(ideas: string, msg: string): void {
  writeFileSync(join(upstream, 'ideas.md'), ideas);
  git(upstream, 'commit', '-qam', msg);
}

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'ff-sync-')));
  upstream = join(root, 'up');
  local = join(root, 'local');
  git(root, 'init', '-q', '-b', 'main', upstream);
  for (const [k, v] of [
    ['user.email', 't@example.com'],
    ['user.name', 't'],
  ])
    git(upstream, 'config', k!, v!);
  writeFileSync(join(upstream, 'ideas.md'), 'a\n\nb\n\nc\n');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-qm', 'root');
  git(root, 'clone', '-q', upstream, local);
  for (const [k, v] of [
    ['user.email', 't@example.com'],
    ['user.name', 't'],
  ])
    git(local, 'config', k!, v!);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe(ffSyncMain, () => {
  it('fast-forwards past a commit that touches a file holding uncommitted edits, keeping them', () => {
    commitUpstream('a\n\nb\n\nc\nd\n', 'upstream edit');
    writeFileSync(join(local, 'ideas.md'), 'a\nRETRO\n\nb\n\nc\n');

    ffSyncMain(local);

    expect(git(local, 'rev-parse', 'HEAD')).toBe(git(upstream, 'rev-parse', 'HEAD'));
    expect(readFileSync(join(local, 'ideas.md'), 'utf8')).toBe('a\nRETRO\n\nb\n\nc\nd\n');
  });

  it('fast-forwards with uncommitted edits the incoming commits do not touch', () => {
    writeFileSync(join(upstream, 'other.md'), 'x\n');
    git(upstream, 'add', 'other.md');
    git(upstream, 'commit', '-qm', 'other');
    writeFileSync(join(local, 'ideas.md'), 'a\nRETRO\n\nb\n\nc\n');

    ffSyncMain(local);

    expect(git(local, 'rev-parse', 'HEAD')).toBe(git(upstream, 'rev-parse', 'HEAD'));
    expect(readFileSync(join(local, 'ideas.md'), 'utf8')).toContain('RETRO');
  });

  it('throws naming the stash SHA when re-applying the edits conflicts', () => {
    commitUpstream('a\nUPSTREAM\n\nb\n\nc\n', 'conflicting edit');
    writeFileSync(join(local, 'ideas.md'), 'a\nRETRO\n\nb\n\nc\n');

    expect(() => ffSyncMain(local)).toThrow(/stash [0-9a-f]{40}/);
    const sha = git(local, 'stash', 'list', '--format=%H');
    expect(git(local, 'show', `${sha}:ideas.md`)).toContain('RETRO');
  });

  it('throws when local main has diverged', () => {
    commitUpstream('a\n\nb\n\nc\nd\n', 'upstream edit');
    writeFileSync(join(local, 'other.md'), 'local\n');
    git(local, 'add', 'other.md');
    git(local, 'commit', '-qm', 'local only');

    expect(() => ffSyncMain(local)).toThrow();
  });
});
