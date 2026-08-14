// @tests: pr-summary-body-enforcement
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FILE,
  ensureSummaryBodyRolloutSnapshot,
  readSummaryBodyRolloutSnapshot,
  snapshotPath,
} from '../summary-body-rollout.js';

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function emptyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-summary-rollout-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 't']);
  return dir;
}

function commit(dir: string, name: string): string {
  writeFileSync(join(dir, name), `${name}\n`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--no-verify', '-m', `add ${name}`]);
  return git(dir, ['rev-parse', 'HEAD']);
}

function write(dir: string, content: string): void {
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(snapshotPath(dir), content);
}

describe('readSummaryBodyRolloutSnapshot — absent and invalid never collapse', () => {
  it('reports absent when there is no file', () => {
    expect(readSummaryBodyRolloutSnapshot(emptyRepo()).kind).toBe('absent');
  });

  it('reports invalid — not absent — for a zero-byte file', () => {
    // The torn-write shape. Reading it as `absent` would silently drop the repo
    // to advisory-only, which is the failure mode the discriminated result and
    // the atomic write both exist to prevent.
    const dir = emptyRepo();
    write(dir, '');
    expect(readSummaryBodyRolloutSnapshot(dir).kind).toBe('invalid');
  });

  it('reports invalid for malformed JSON, a bad version, and a non-array tip list', () => {
    for (const content of [
      'not json at all',
      JSON.stringify({ version: 2, grandfatherTips: ['a'.repeat(40)] }),
      JSON.stringify({ version: 1, grandfatherTips: 'a'.repeat(40) }),
      JSON.stringify(['a'.repeat(40)]),
    ]) {
      const dir = emptyRepo();
      write(dir, content);
      expect(readSummaryBodyRolloutSnapshot(dir).kind).toBe('invalid');
    }
  });

  it('reports invalid for an empty tip set', () => {
    const dir = emptyRepo();
    write(dir, JSON.stringify({ version: 1, grandfatherTips: [] }));
    expect(readSummaryBodyRolloutSnapshot(dir).kind).toBe('invalid');
  });

  it('reports invalid for a duplicate tip', () => {
    const dir = emptyRepo();
    const sha = 'a'.repeat(40);
    write(dir, JSON.stringify({ version: 1, grandfatherTips: [sha, sha] }));
    const read = readSummaryBodyRolloutSnapshot(dir);
    expect(read.kind).toBe('invalid');
    if (read.kind === 'invalid') expect(read.reason).toContain('duplicate');
  });

  it('reports invalid for a syntactically impossible object ID', () => {
    for (const bad of ['nope', 'A'.repeat(40), 'a'.repeat(39), 42]) {
      const dir = emptyRepo();
      write(dir, JSON.stringify({ version: 1, grandfatherTips: [bad] }));
      expect(readSummaryBodyRolloutSnapshot(dir).kind).toBe('invalid');
    }
  });

  it('accepts both SHA-1 and SHA-256 object IDs', () => {
    const dir = emptyRepo();
    write(dir, JSON.stringify({ version: 1, grandfatherTips: ['a'.repeat(40), 'b'.repeat(64)] }));
    expect(readSummaryBodyRolloutSnapshot(dir).kind).toBe('ok');
  });
});

describe('ensureSummaryBodyRolloutSnapshot', () => {
  it('skips a repository with no commits and writes nothing', () => {
    const dir = emptyRepo();
    expect(ensureSummaryBodyRolloutSnapshot(dir)).toBe('skipped-no-git');
    // An empty on-disk snapshot is reserved for corruption, so bootstrapping too
    // early must leave no file rather than an empty one.
    expect(readSummaryBodyRolloutSnapshot(dir).kind).toBe('absent');
  });

  it('records HEAD, local branches and tags, deduplicated', () => {
    const dir = emptyRepo();
    const first = commit(dir, 'a.txt');
    git(dir, ['branch', 'side']);
    git(dir, ['tag', 'v1']);

    expect(ensureSummaryBodyRolloutSnapshot(dir)).toBe('created');
    const read = readSummaryBodyRolloutSnapshot(dir);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    // HEAD, refs/heads/main, refs/heads/side and refs/tags/v1 all point at the
    // same commit here — one tip, not four.
    expect(read.snapshot.grandfatherTips).toEqual([first]);
  });

  it('peels an annotated tag to the commit it targets', () => {
    const dir = emptyRepo();
    const sha = commit(dir, 'a.txt');
    git(dir, ['tag', '-a', 'v1', '-m', 'release one']);
    ensureSummaryBodyRolloutSnapshot(dir);
    const read = readSummaryBodyRolloutSnapshot(dir);
    if (read.kind !== 'ok') throw new Error('expected ok');
    // The tag OBJECT id must not leak in — it is not a commit, so rev-list would
    // reject it as a negative revision.
    expect(read.snapshot.grandfatherTips).toEqual([sha]);
  });

  it('records a side branch tip distinctly from the mainline tip', () => {
    const dir = emptyRepo();
    commit(dir, 'a.txt');
    git(dir, ['checkout', '-q', '-b', 'side']);
    const sideTip = commit(dir, 'b.txt');
    git(dir, ['checkout', '-q', '-']);
    const mainTip = commit(dir, 'c.txt');

    ensureSummaryBodyRolloutSnapshot(dir);
    const read = readSummaryBodyRolloutSnapshot(dir);
    if (read.kind !== 'ok') throw new Error('expected ok');
    expect(new Set(read.snapshot.grandfatherTips)).toEqual(new Set([mainTip, sideTip]));
  });

  it('is idempotent and never advances existing tips', () => {
    const dir = emptyRepo();
    const first = commit(dir, 'a.txt');
    ensureSummaryBodyRolloutSnapshot(dir);
    const before = readFileSync(snapshotPath(dir), 'utf8');

    commit(dir, 'b.txt');
    expect(ensureSummaryBodyRolloutSnapshot(dir)).toBe('exists');

    // Advancing the tips on a re-run would grandfather every commit made since
    // activation — turning `init --update` into a way to launder history.
    expect(readFileSync(snapshotPath(dir), 'utf8')).toBe(before);
    const read = readSummaryBodyRolloutSnapshot(dir);
    if (read.kind !== 'ok') throw new Error('expected ok');
    expect(read.snapshot.grandfatherTips).toEqual([first]);
  });

  it('leaves a corrupt snapshot alone rather than repairing it silently', () => {
    const dir = emptyRepo();
    commit(dir, 'a.txt');
    write(dir, 'corrupt');
    expect(ensureSummaryBodyRolloutSnapshot(dir)).toBe('exists');
    expect(readSummaryBodyRolloutSnapshot(dir).kind).toBe('invalid');
  });

  it('writes to the documented path', () => {
    const dir = emptyRepo();
    commit(dir, 'a.txt');
    ensureSummaryBodyRolloutSnapshot(dir);
    expect(snapshotPath(dir)).toBe(join(dir, FILE));
  });
});
