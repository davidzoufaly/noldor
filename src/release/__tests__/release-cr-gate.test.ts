// @tests: noldor
import { describe, expect, it, vi } from 'vitest';
import { checkCrGate } from '../release-cr-gate.js';

interface Commit {
  sha: string;
  tree: string;
  message: string;
  paths: string[];
}

function makeGitFake(commits: Commit[]) {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  return vi.fn((args: string[]): string => {
    if (args[0] === 'rev-list')
      return commits
        .map((c) => c.sha)
        .toReversed()
        .join('\n');
    if (args[0] === 'show' && args[1] === '-s' && args[2] === '--format=%B')
      return bySha.get(args[3])!.message;
    if (args[0] === 'show' && args.includes('--name-only'))
      return bySha.get(args[args.length - 1])!.paths.join('\n');
    if (args[0] === 'rev-parse' && args[1].endsWith('^{tree}')) {
      const sha = args[1].replace(/\^\{tree\}$/, '');
      return bySha.get(sha)!.tree;
    }
    throw new Error(`unmocked git args: ${args.join(' ')}`);
  });
}

const trailers = (...lines: string[]) => '\n\n' + lines.join('\n') + '\n';

describe('checkCrGate', () => {
  it('passes when every code-touching commit has both review trailers (tree-matched)', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'feat: x' + trailers('Noldor-Reviewed: t1', 'Noldor-Reviewed-Codex: t1'),
        paths: ['src/a.ts'],
      },
    ];
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake(commits),
    });
    expect(r.ok).toBe(true);
  });

  it('skips doc-only commits (allowlist match)', () => {
    const commits: Commit[] = [
      { sha: 's1', tree: 't1', message: 'docs: x', paths: ['docs/foo.md'] },
    ];
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake(commits),
    });
    expect(r.ok).toBe(true);
  });

  it('skips release-automation commits', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'chore(release): v1' + trailers('Noldor-Path: release-automation'),
        paths: ['package.json'],
      },
    ];
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake(commits),
    });
    expect(r.ok).toBe(true);
  });

  it('rejects code-touching commit missing the codex trailer', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'feat: x' + trailers('Noldor-Reviewed: t1'),
        paths: ['src/a.ts'],
      },
    ];
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake(commits),
    });
    expect(r.ok).toBe(false);
    expect(r.offenders).toEqual([{ sha: 's1', missing: ['codex'] }]);
  });

  it('rejects mismatched tree on the codex trailer', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'feat: x' + trailers('Noldor-Reviewed: t1', 'Noldor-Reviewed-Codex: STALE'),
        paths: ['src/a.ts'],
      },
    ];
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake(commits),
    });
    expect(r.ok).toBe(false);
    expect(r.offenders[0].missing).toContain('codex');
  });

  it('accepts override trailers in lieu of reviews', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message:
          'fix: emergency' +
          trailers('Noldor-Path-Override: hotfix', 'Noldor-CR-Override-Codex: codex offline'),
        paths: ['src/a.ts'],
      },
    ];
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake(commits),
    });
    expect(r.ok).toBe(true);
  });

  it('rejects empty override reason on codex side', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'fix' + trailers('Noldor-Reviewed: t1', 'Noldor-CR-Override-Codex: '),
        paths: ['src/a.ts'],
      },
    ];
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake(commits),
    });
    expect(r.ok).toBe(false);
  });
});
