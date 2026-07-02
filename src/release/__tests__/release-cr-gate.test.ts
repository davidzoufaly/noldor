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

/**
 * Realistic GitHub squash-merge message: PR-branch commit messages inlined as
 * `* subject` bullets with their trailer blocks mid-body, then a divider and
 * a Co-authored-by tail — the only block `git interpret-trailers` would see.
 */
const squashBody = (receiptLine: string) =>
  [
    'feat(core): thing (#42)',
    '',
    '* feat(core): thing',
    '',
    'Noldor-Path: fast-track',
    '',
    '* fix(core): review feedback',
    '',
    'Noldor-Path: fast-track',
    receiptLine,
    '',
    '---------',
    '',
    'Co-authored-by: t <t@t.io>',
  ].join('\n');

describe('checkCrGate', () => {
  it('passes on a legacy Noldor-Reviewed trailer', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'feat: x' + trailers('Noldor-Reviewed: t1'),
        paths: ['src/a.ts'],
      },
    ];
    const r = checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', runGit: makeGitFake(commits) });
    expect(r.ok).toBe(true);
  });

  it('passes on a subagent receipt embedded mid-body in a squash message', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: squashBody('Noldor-Reviewed-Subagent: 8d767d14605b47e331fc2f5abc4f3d90e1506a03'),
        paths: ['src/a.ts'],
      },
    ];
    const r = checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', runGit: makeGitFake(commits) });
    expect(r.ok).toBe(true);
  });

  it('rejects a squash message whose embedded trailers carry no receipt', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: squashBody('Noldor-FD: some-feature'),
        paths: ['src/a.ts'],
      },
    ];
    const r = checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', runGit: makeGitFake(commits) });
    expect(r.ok).toBe(false);
    expect(r.offenders).toEqual([{ sha: 's1', subject: 'feat(core): thing (#42)' }]);
  });

  it('skips doc-only commits (allowlist match)', () => {
    const commits: Commit[] = [
      { sha: 's1', tree: 't1', message: 'docs: x', paths: ['docs/foo.md'] },
    ];
    const r = checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', runGit: makeGitFake(commits) });
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
    const r = checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', runGit: makeGitFake(commits) });
    expect(r.ok).toBe(true);
  });

  it('skips release-sweep commits', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'chore(sweep): pre-release sweep (#9)' + trailers('Noldor-Path: release-sweep'),
        paths: ['graphify-out/graph.json'],
      },
    ];
    const r = checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', runGit: makeGitFake(commits) });
    expect(r.ok).toBe(true);
  });

  it('does NOT exempt a mixed squash where only one embedded path is release-sweep', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message:
          'feat: mixed (#10)' + trailers('Noldor-Path: release-sweep', 'Noldor-Path: fast-track'),
        paths: ['src/a.ts'],
      },
    ];
    const r = checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', runGit: makeGitFake(commits) });
    expect(r.ok).toBe(false);
    expect(r.offenders[0].sha).toBe('s1');
  });

  it('rejects a code-touching commit with no receipt and no override', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'feat: x' + trailers('Noldor-Path: fast-track'),
        paths: ['src/a.ts'],
      },
    ];
    const r = checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', runGit: makeGitFake(commits) });
    expect(r.ok).toBe(false);
    expect(r.offenders).toEqual([{ sha: 's1', subject: 'feat: x' }]);
    expect(r.reason).toContain('no review receipt or override');
  });

  it('accepts override trailers in lieu of reviews', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'fix: emergency' + trailers('Noldor-Path-Override: hotfix'),
        paths: ['src/a.ts'],
      },
    ];
    const r = checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', runGit: makeGitFake(commits) });
    expect(r.ok).toBe(true);
  });

  it('rejects empty-valued receipts and overrides', () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'fix' + trailers('Noldor-Reviewed: ', 'Noldor-CR-Override-Codex: '),
        paths: ['src/a.ts'],
      },
    ];
    const r = checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', runGit: makeGitFake(commits) });
    expect(r.ok).toBe(false);
  });
});

describe('checkCrGate exemptions (release.crGateExemptCommits)', () => {
  const bareCommit: Commit = {
    sha: '19a74a10e8e844e021b08fe616992eae1b56f977',
    tree: 't1',
    message:
      'chore(ci): run pnpm verify on pull requests (#117)' + trailers('Noldor-Path: fast-track'),
    paths: ['.github/workflows/verify.yml'],
  };

  it('skips a commit whose full SHA starts with an exemption prefix and reports it', () => {
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake([bareCommit]),
      exemptions: [{ sha: '19a74a10e8', reason: 'pre-rollout-marker CI chore (#117)' }],
    });
    expect(r.ok).toBe(true);
    expect(r.offenders).toEqual([]);
    expect(r.exempted).toEqual([
      {
        sha: '19a74a10e8e844e021b08fe616992eae1b56f977',
        subject: 'chore(ci): run pnpm verify on pull requests (#117)',
        reason: 'pre-rollout-marker CI chore (#117)',
      },
    ]);
  });

  it('still fails when no exemption matches (gate not weakened)', () => {
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake([bareCommit]),
      exemptions: [{ sha: 'aaaaaaaa', reason: 'unrelated entry' }],
    });
    expect(r.ok).toBe(false);
    expect(r.offenders[0].sha).toBe('19a74a10e8e844e021b08fe616992eae1b56f977');
    expect(r.exempted).toEqual([]);
  });

  it('does not launder other offenders in the same range', () => {
    const other: Commit = {
      sha: 'faceb00cfaceb00cfaceb00cfaceb00cfaceb00c',
      tree: 't2',
      message: 'feat: bare' + trailers('Noldor-Path: fast-track'),
      paths: ['src/a.ts'],
    };
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake([bareCommit, other]),
      exemptions: [{ sha: '19a74a10e8', reason: 'pre-rollout-marker CI chore (#117)' }],
    });
    expect(r.ok).toBe(false);
    expect(r.offenders).toEqual([
      { sha: 'faceb00cfaceb00cfaceb00cfaceb00cfaceb00c', subject: 'feat: bare' },
    ]);
    expect(r.exempted).toHaveLength(1);
  });

  it('returns exempted: [] when no exemptions are configured', () => {
    const r = checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      runGit: makeGitFake([bareCommit]),
    });
    expect(r.ok).toBe(false);
    expect(r.exempted).toEqual([]);
  });
});
