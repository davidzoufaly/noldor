// @tests: noldor, release-bypass-retirement, test-suites-read-live-repo-state-shifting-full-suite-failures
import { describe, expect, it } from 'vitest';
import { checkCrGate } from '../release-cr-gate.js';
import type { RunCommand } from '../run-command.js';

interface Commit {
  sha: string;
  tree: string;
  message: string;
  paths: string[];
}

/**
 * Scripted git, as a {@link RunCommand} so it plugs into the same seam the
 * `cr-gate` probe hands down — one fake shape for the whole release module
 * rather than a bespoke synchronous one only this file can drive.
 *
 * Unmocked args throw rather than answering an empty string: the gate reads
 * "no commits in range" as a clean pass, so a fake that quietly answered
 * nothing would turn every one of these cases green regardless of its trailers.
 */
function makeGitFake(commits: Commit[], blobs: Record<string, string> = {}): RunCommand {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const answer = (args: string[]): string => {
    // `git show <revspec>` with no flags: file content at a revision, which the
    // waiver check reads. An absent path exits non-zero in real git, and the
    // caller reads that as "no waivers declared" — so throwing is the fixture.
    if (args[0] === 'show' && args.length === 2) {
      const blob = blobs[args[1]];
      if (blob === undefined) throw new Error(`no such path at ${args[1]}`);
      return blob;
    }
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
  };
  return (_cmd, args) => Promise.resolve({ code: 0, stdout: answer(args), stderr: '' });
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
  it('passes on a legacy Noldor-Reviewed trailer', async () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'feat: x' + trailers('Noldor-Reviewed: t1'),
        paths: ['src/a.ts'],
      },
    ];
    const r = await checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', run: makeGitFake(commits) });
    expect(r.ok).toBe(true);
  });

  it('passes on a subagent receipt embedded mid-body in a squash message', async () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: squashBody('Noldor-Reviewed-Subagent: 8d767d14605b47e331fc2f5abc4f3d90e1506a03'),
        paths: ['src/a.ts'],
      },
    ];
    const r = await checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', run: makeGitFake(commits) });
    expect(r.ok).toBe(true);
  });

  it('rejects a squash message whose embedded trailers carry no receipt', async () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: squashBody('Noldor-FD: some-feature'),
        paths: ['src/a.ts'],
      },
    ];
    const r = await checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', run: makeGitFake(commits) });
    expect(r.ok).toBe(false);
    expect(r.offenders).toEqual([{ sha: 's1', subject: 'feat(core): thing (#42)' }]);
  });

  it('skips doc-only commits (allowlist match)', async () => {
    const commits: Commit[] = [
      { sha: 's1', tree: 't1', message: 'docs: x', paths: ['docs/foo.md'] },
    ];
    const r = await checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', run: makeGitFake(commits) });
    expect(r.ok).toBe(true);
  });

  it('skips release-automation commits', async () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'chore(release): v1' + trailers('Noldor-Path: release-automation'),
        paths: ['package.json'],
      },
    ];
    const r = await checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', run: makeGitFake(commits) });
    expect(r.ok).toBe(true);
  });

  it('skips release-sweep commits', async () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'chore(sweep): pre-release sweep (#9)' + trailers('Noldor-Path: release-sweep'),
        paths: ['graphify-out/graph.json'],
      },
    ];
    const r = await checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', run: makeGitFake(commits) });
    expect(r.ok).toBe(true);
  });

  it('does NOT exempt a mixed squash where only one embedded path is release-sweep', async () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message:
          'feat: mixed (#10)' + trailers('Noldor-Path: release-sweep', 'Noldor-Path: fast-track'),
        paths: ['src/a.ts'],
      },
    ];
    const r = await checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', run: makeGitFake(commits) });
    expect(r.ok).toBe(false);
    expect(r.offenders[0].sha).toBe('s1');
  });

  // v1.4.0 release, sweep PR #354: GitHub squashed one micro-chore `ideas.md`
  // commit together with three release-sweep commits. `Noldor-Path` exemption
  // needs EVERY embedded path exempt (micro-chore is not), so the check falls
  // to the file allowlist — where `ideas.md` is micro-chore-only and
  // `graphify-out/**` is sweep-only, so neither lane covers the diff and the
  // gate reddened over a diff carrying zero code.
  it('skips a sweep squash whose diff mixes micro-chore and sweep bookkeeping', async () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message:
          'chore(sweep): pre-release sweep (#354)' +
          trailers('Noldor-Path: micro-chore', 'Noldor-Path: release-sweep'),
        paths: ['ideas.md', 'graphify-out/graph.json', 'docs/sdd-report.md'],
      },
    ];
    const r = await checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', run: makeGitFake(commits) });
    expect(r.ok).toBe(true);
    expect(r.offenders).toEqual([]);
  });

  it('rejects a code-touching commit with no receipt and no override', async () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'feat: x' + trailers('Noldor-Path: fast-track'),
        paths: ['src/a.ts'],
      },
    ];
    const r = await checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', run: makeGitFake(commits) });
    expect(r.ok).toBe(false);
    expect(r.offenders).toEqual([{ sha: 's1', subject: 'feat: x' }]);
    expect(r.reason).toContain('no review receipt or override');
  });

  it('accepts override trailers in lieu of reviews', async () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'fix: emergency' + trailers('Noldor-Path-Override: hotfix'),
        paths: ['src/a.ts'],
      },
    ];
    const r = await checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', run: makeGitFake(commits) });
    expect(r.ok).toBe(true);
  });

  it('rejects empty-valued receipts and overrides', async () => {
    const commits: Commit[] = [
      {
        sha: 's1',
        tree: 't1',
        message: 'fix' + trailers('Noldor-Reviewed: ', 'Noldor-CR-Override-Codex: '),
        paths: ['src/a.ts'],
      },
    ];
    const r = await checkCrGate({ from: 'v0', to: 'HEAD', cwd: '/tmp', run: makeGitFake(commits) });
    expect(r.ok).toBe(false);
  });
});

// The no-review exemption is decided by file list, before any trailer is read,
// so it is granted under every `Noldor-Path` label and with none at all. These
// cases cover both directions of the one file on that list that can waive this
// very gate.
describe('checkCrGate — a no-review lane cannot carry a retroactive waiver', () => {
  const CONFIG = '.noldor/config.json';
  const cfg = (release: Record<string, unknown>) => JSON.stringify({ release });
  const WAIVER = { sha: 'abc1234', reason: 'waved through by hand, no review' };

  const configCommit = (message: string): Commit[] => [
    { sha: 'c1', tree: 't1', message, paths: [CONFIG] },
  ];

  it('exempts a config-only commit that leaves the waiver lists alone', async () => {
    const r = await checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      run: makeGitFake(
        configCommit('chore(noldor): declare uiCapture\n\nNoldor-Path: micro-chore'),
        {
          [`c1^:${CONFIG}`]: cfg({ crGateExemptCommits: [] }),
          [`c1:${CONFIG}`]: cfg({ crGateExemptCommits: [], publish: { enabled: true } }),
        },
      ),
    });
    expect(r.ok).toBe(true);
    expect(r.offenders).toEqual([]);
  });

  it('refuses the exemption when the commit appends a CR-gate waiver', async () => {
    const r = await checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      run: makeGitFake(configCommit('chore(noldor): tweak\n\nNoldor-Path: micro-chore'), {
        [`c1^:${CONFIG}`]: cfg({ crGateExemptCommits: [] }),
        [`c1:${CONFIG}`]: cfg({ crGateExemptCommits: [WAIVER] }),
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.offenders.map((o) => o.sha)).toEqual(['c1']);
    expect(r.reason).toContain('release.crGateExemptCommits');
  });

  // The hooks' guard and the post-hoc detector both key on `micro-chore`; the
  // gate is the only check that sees the same waiver under another label.
  it('refuses it under a fast-track label too', async () => {
    const r = await checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      run: makeGitFake(configCommit('chore(noldor): tweak\n\nNoldor-Path: fast-track'), {
        [`c1^:${CONFIG}`]: cfg({ crGateExemptCommits: [] }),
        [`c1:${CONFIG}`]: cfg({ crGateExemptCommits: [WAIVER] }),
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.offenders.map((o) => o.sha)).toEqual(['c1']);
  });

  it('refuses it with no Noldor-Path trailer at all', async () => {
    const r = await checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      run: makeGitFake(configCommit('chore(noldor): tweak'), {
        [`c1^:${CONFIG}`]: cfg({ crGateExemptCommits: [] }),
        [`c1:${CONFIG}`]: cfg({ crGateExemptCommits: [WAIVER] }),
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.offenders.map((o) => o.sha)).toEqual(['c1']);
  });

  // A review receipt is the sanctioned way to move one, and it is read on the
  // ordinary path below the exemption — the waiver check must not pre-empt it.
  it('still passes a waiver change that carries a review receipt', async () => {
    const r = await checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      run: makeGitFake(
        configCommit('fix(core): record waiver\n\nNoldor-Reviewed-Subagent: deadbee'),
        {
          [`c1^:${CONFIG}`]: cfg({ crGateExemptCommits: [] }),
          [`c1:${CONFIG}`]: cfg({ crGateExemptCommits: [WAIVER] }),
        },
      ),
    });
    expect(r.ok).toBe(true);
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

  it('skips a commit whose full SHA starts with an exemption prefix and reports it', async () => {
    const r = await checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      run: makeGitFake([bareCommit]),
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

  it('still fails when no exemption matches (gate not weakened)', async () => {
    const r = await checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      run: makeGitFake([bareCommit]),
      exemptions: [{ sha: 'aaaaaaaa', reason: 'unrelated entry' }],
    });
    expect(r.ok).toBe(false);
    expect(r.offenders[0].sha).toBe('19a74a10e8e844e021b08fe616992eae1b56f977');
    expect(r.exempted).toEqual([]);
  });

  it('does not launder other offenders in the same range', async () => {
    const other: Commit = {
      sha: 'faceb00cfaceb00cfaceb00cfaceb00cfaceb00c',
      tree: 't2',
      message: 'feat: bare' + trailers('Noldor-Path: fast-track'),
      paths: ['src/a.ts'],
    };
    const r = await checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      run: makeGitFake([bareCommit, other]),
      exemptions: [{ sha: '19a74a10e8', reason: 'pre-rollout-marker CI chore (#117)' }],
    });
    expect(r.ok).toBe(false);
    expect(r.offenders).toEqual([
      { sha: 'faceb00cfaceb00cfaceb00cfaceb00cfaceb00c', subject: 'feat: bare' },
    ]);
    expect(r.exempted).toHaveLength(1);
  });

  it('returns exempted: [] when no exemptions are configured', async () => {
    const r = await checkCrGate({
      from: 'v0',
      to: 'HEAD',
      cwd: '/tmp',
      run: makeGitFake([bareCommit]),
    });
    expect(r.ok).toBe(false);
    expect(r.exempted).toEqual([]);
  });
});
