// @tests: autonomous-plan-to-pr-merge, parallel-drain, release-script-self-provisions-its-own-session-marker, release-sweep-process-hardening
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  pickMostRecentByDatePrefix,
  parseCrTrailersFromLog,
  normalizeRepoUrl,
  shouldPromptForPrApproval,
  clearMicroChoreSession,
  loadVerifyEvidence,
  parseCommitFileLists,
  pickSummarySha,
} from '../pr-flow-cli.js';
import { writeSession } from '../session.js';
import { stripTrailers } from '../trailers.js';

describe('shouldPromptForPrApproval', () => {
  it('returns false when config flag is unset (default)', () => {
    expect(
      shouldPromptForPrApproval({
        config: {
          autonomous: { skipLanePicker: false, onFailure: 'prompt', requireHumanPrApproval: false },
        },
        session: { path: 'specs-only-new', slug: 'x', startedAt: 't' },
      }),
    ).toBe(false);
  });
  it('returns true when config flag set AND session not autonomous', () => {
    expect(
      shouldPromptForPrApproval({
        config: {
          autonomous: { skipLanePicker: false, onFailure: 'prompt', requireHumanPrApproval: true },
        },
        session: { path: 'specs-only-new', slug: 'x', startedAt: 't' },
      }),
    ).toBe(true);
  });
  it('returns false when config flag set BUT session.autonomous true (session overrides)', () => {
    expect(
      shouldPromptForPrApproval({
        config: {
          autonomous: { skipLanePicker: false, onFailure: 'prompt', requireHumanPrApproval: true },
        },
        session: { path: 'specs-only-new', slug: 'x', startedAt: 't', autonomous: true },
      }),
    ).toBe(false);
  });
  it('returns false when config is null (no .noldor/config.json)', () => {
    expect(
      shouldPromptForPrApproval({
        config: null,
        session: { path: 'specs-only-new', slug: 'x', startedAt: 't' },
      }),
    ).toBe(false);
  });
});

describe('pickMostRecentByDatePrefix', () => {
  it('returns the newest filename when multiple share a directory', () => {
    const paths = [
      'docs/design/plans/2026-05-14-a.md',
      'docs/design/plans/2026-05-16-c.md',
      'docs/design/plans/2026-05-15-b.md',
    ];
    expect(pickMostRecentByDatePrefix(paths)).toBe('docs/design/plans/2026-05-16-c.md');
  });

  it('returns null on empty input', () => {
    expect(pickMostRecentByDatePrefix([])).toBeNull();
  });

  it('falls back to lexical order when no date prefix present', () => {
    const paths = ['docs/design/plans/zeta.md', 'docs/design/plans/alpha.md'];
    expect(pickMostRecentByDatePrefix(paths)).toBe('docs/design/plans/zeta.md');
  });
});

describe('parseCrTrailersFromLog', () => {
  it('extracts one pass per Noldor-Reviewed trailer (claude)', () => {
    const log = [
      'commit aaa',
      '',
      '    feat(scripts): x',
      '',
      '    Noldor-Reviewed: tree1',
      '',
    ].join('\n');
    expect(parseCrTrailersFromLog(log)).toEqual({
      passes: [{ reviewer: 'claude', tipSha: 'tree1', findings: 0, status: 'clean' }],
      status: 'clean',
    });
  });

  it('extracts codex passes via Noldor-Reviewed-Codex trailer', () => {
    const log = [
      'commit aaa',
      '',
      '    feat(scripts): x',
      '',
      '    Noldor-Reviewed: t1',
      '    Noldor-Reviewed-Codex: t1',
      '',
    ].join('\n');
    expect(parseCrTrailersFromLog(log)).toEqual({
      passes: [
        { reviewer: 'claude', tipSha: 't1', findings: 0, status: 'clean' },
        { reviewer: 'codex', tipSha: 't1', findings: 0, status: 'clean' },
      ],
      status: 'clean',
    });
  });

  it('returns empty passes for log with no review trailers', () => {
    expect(parseCrTrailersFromLog('commit aaa\n\n    no trailers here\n')).toEqual({
      passes: [],
      status: 'clean',
    });
  });

  it('extracts trailers at column 0 (real git log --format=%b output)', () => {
    // `git log --format=%H%n%s%n%n%b` emits trailers with NO leading whitespace.
    // The default-medium log format indents the body by 4 spaces, but `%b` does not.
    // Both forms must parse.
    const log = [
      '158be93b70b015b68a089749592a6de88ca294c3',
      'fix(noldor:framework-pr-flow): seatbelt',
      '',
      'Body paragraph.',
      '',
      'Noldor-FD: framework-pr-flow-agent-auto-merge',
      'Noldor-Reviewed: tree_at_col0',
      'Noldor-Reviewed-Codex: tree_at_col0',
      '',
    ].join('\n');
    expect(parseCrTrailersFromLog(log)).toEqual({
      passes: [
        { reviewer: 'claude', tipSha: 'tree_at_col0', findings: 0, status: 'clean' },
        { reviewer: 'codex', tipSha: 'tree_at_col0', findings: 0, status: 'clean' },
      ],
      status: 'clean',
    });
  });
});

describe('clearMicroChoreSession', () => {
  const setup = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'prf-'));
    mkdirSync(join(dir, '.noldor'));
    return dir;
  };
  const sessionFile = (dir: string): string => join(dir, '.noldor', 'session.json');

  it('clears the session when path is micro-chore', () => {
    const dir = setup();
    writeSession(dir, { path: 'micro-chore', startedAt: '2026-06-07T00:00:00.000Z' });
    expect(existsSync(sessionFile(dir))).toBe(true);
    clearMicroChoreSession(dir, { path: 'micro-chore', startedAt: '2026-06-07T00:00:00.000Z' });
    expect(existsSync(sessionFile(dir))).toBe(false);
  });

  it('leaves the session untouched for a non-micro-chore path', () => {
    const dir = setup();
    const marker = {
      path: 'specs-only-attach' as const,
      parent: 'noldor',
      startedAt: '2026-06-07T00:00:00.000Z',
      markerVersion: 2 as const,
    };
    writeSession(dir, marker);
    clearMicroChoreSession(dir, marker);
    expect(existsSync(sessionFile(dir))).toBe(true);
  });
});

describe('loadVerifyEvidence', () => {
  const setup = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'prf-'));
    mkdirSync(join(dir, '.noldor', 'cr'), { recursive: true });
    return dir;
  };
  const sink = (dir: string, slug: string, payload: unknown): void => {
    writeFileSync(
      join(dir, '.noldor', 'cr', `${slug}-code-verifier.json`),
      JSON.stringify(payload),
    );
  };

  it('lifts verdict + evidence pairs from the code-verify sink', () => {
    const dir = setup();
    sink(dir, 'my-feature', {
      lane: 'verifier',
      verdict: 'pass',
      evidence: [{ command: 'pnpm noldor --help', observed: 'exit 0' }],
    });
    expect(loadVerifyEvidence(dir, 'my-feature')).toEqual({
      verdict: 'pass',
      evidence: [{ command: 'pnpm noldor --help', observed: 'exit 0' }],
    });
  });

  it('returns null when the sink file is absent (verify lane not configured)', () => {
    expect(loadVerifyEvidence(setup(), 'my-feature')).toBeNull();
  });

  it('returns null on unparseable JSON', () => {
    const dir = setup();
    writeFileSync(join(dir, '.noldor', 'cr', 'my-feature-code-verifier.json'), '{nope');
    expect(loadVerifyEvidence(dir, 'my-feature')).toBeNull();
  });

  it('returns null when the sink has no string verdict (non-verify lane shape)', () => {
    const dir = setup();
    sink(dir, 'my-feature', { lane: 'reviewer', blockers: [] });
    expect(loadVerifyEvidence(dir, 'my-feature')).toBeNull();
  });

  it('drops malformed evidence entries but keeps well-formed ones', () => {
    const dir = setup();
    sink(dir, 'my-feature', {
      verdict: 'fail',
      evidence: [{ command: 'curl /', observed: '500' }, { command: 42 }, 'garbage', null],
    });
    expect(loadVerifyEvidence(dir, 'my-feature')).toEqual({
      verdict: 'fail',
      evidence: [{ command: 'curl /', observed: '500' }],
    });
  });

  it('defaults evidence to [] when the sink omits the array (cannot-verify verdicts)', () => {
    const dir = setup();
    sink(dir, 'my-feature', { verdict: 'cannot-verify' });
    expect(loadVerifyEvidence(dir, 'my-feature')).toEqual({
      verdict: 'cannot-verify',
      evidence: [],
    });
  });
});

describe('normalizeRepoUrl', () => {
  it('strips .git from https URL', () => {
    expect(normalizeRepoUrl('https://github.com/davidzoufaly/acme.git')).toBe(
      'https://github.com/davidzoufaly/acme',
    );
  });

  it('converts SSH form to HTTPS', () => {
    expect(normalizeRepoUrl('git@github.com:davidzoufaly/acme.git')).toBe(
      'https://github.com/davidzoufaly/acme',
    );
  });

  it('returns https URL unchanged when no .git suffix', () => {
    expect(normalizeRepoUrl('https://github.com/davidzoufaly/acme')).toBe(
      'https://github.com/davidzoufaly/acme',
    );
  });
});

describe('parseCommitFileLists', () => {
  it('parses one record per commit with its touched paths', () => {
    const out =
      '\x1eaaa111\ndocs/roadmap.md\n\x1ebbb222\nsrc/dashboard/layout.ts\nsrc/dashboard/__tests__/brand.test.ts\n';
    expect(parseCommitFileLists(out)).toEqual([
      { sha: 'aaa111', files: ['docs/roadmap.md'] },
      {
        sha: 'bbb222',
        files: ['src/dashboard/layout.ts', 'src/dashboard/__tests__/brand.test.ts'],
      },
    ]);
  });

  it('returns an empty list for an empty range', () => {
    expect(parseCommitFileLists('')).toEqual([]);
  });

  it('keeps a commit that changed no files (empty commit) with an empty path list', () => {
    expect(parseCommitFileLists('\x1eccc333\n')).toEqual([{ sha: 'ccc333', files: [] }]);
  });
});

describe('pickSummarySha', () => {
  it('skips a regenerated-graph commit in favour of the feature commit', () => {
    // `design graph-context` makes a session regenerate a stale graph before it
    // writes anything, so this commit ordering is the norm on a feature branch.
    // Composing the Summary from it would explain graph regeneration.
    const sha = pickSummarySha([
      { sha: 'aaa', files: ['docs/roadmap.md'] },
      { sha: 'bbb', files: ['graphify-out/graph.json', 'graphify-out/GRAPH_REPORT.md'] },
      { sha: 'ccc', files: ['src/release/ui-design-freshness.ts'] },
    ]);
    expect(sha).toBe('ccc');
  });

  it('skips a roadmap-retirement commit and picks the substantive one', () => {
    // The gate retires the roadmap block BEFORE implementing, so the oldest
    // commit on a drained fast-track branch is bookkeeping.
    const sha = pickSummarySha([
      { sha: 'retire1', files: ['docs/roadmap.md'] },
      { sha: 'impl2', files: ['src/dashboard/layout.ts'] },
    ]);
    expect(sha).toBe('impl2');
  });

  it('picks a commit that touches the roadmap alongside real files', () => {
    const sha = pickSummarySha([{ sha: 'mixed1', files: ['docs/roadmap.md', 'src/core/x.ts'] }]);
    expect(sha).toBe('mixed1');
  });

  it('falls back to the first commit when the branch is retirement-only', () => {
    const sha = pickSummarySha([
      { sha: 'retire1', files: ['docs/roadmap.md'] },
      { sha: 'retire2', files: ['docs/roadmap.md'] },
    ]);
    expect(sha).toBe('retire1');
  });

  it('returns undefined when no commits are ahead of the base', () => {
    expect(pickSummarySha([])).toBeUndefined();
  });

  // Since Q-0107, `remove-block` records the retired ID beside the removal, so
  // a roadmap-only skip lands on the retirement commit and describes the PR by
  // its bookkeeping again.
  it('skips a retirement commit that co-stages the retired-ID map', () => {
    const sha = pickSummarySha([
      { sha: 'retire1', files: ['docs/roadmap.md', '.noldor/retired-entry-ids.json'] },
      { sha: 'impl2', files: ['src/core/framework-skew.ts'] },
    ]);
    expect(sha).toBe('impl2');
  });

  it('skips the spec and plan commits on a full-* branch', () => {
    const sha = pickSummarySha([
      { sha: 'spec1', files: ['docs/design/specs/2026-08-13-x-design.md'] },
      { sha: 'plan2', files: ['docs/design/plans/2026-08-13-x.md'] },
      { sha: 'impl3', files: ['src/core/x.ts'] },
    ]);
    expect(sha).toBe('impl3');
  });

  // `git log --name-only` prints no paths for a merge, and isBookkeepingOnly([])
  // is false — without the length guard the merge wins and the PR is titled
  // `Merge branch 'main'` with an empty body.
  it('never picks a merge commit over a code commit', () => {
    const sha = pickSummarySha([
      { sha: 'impl1', files: ['src/core/x.ts'] },
      { sha: 'merge2', files: [] },
    ]);
    expect(sha).toBe('impl1');
  });

  it('falls back to the first commit on a merge-only branch', () => {
    expect(pickSummarySha([{ sha: 'merge1', files: [] }])).toBe('merge1');
  });
});

describe('pickSummarySha over real git output', () => {
  it('picks the implementation commit on a drain-shaped branch', () => {
    // Guards the format string and the parser against each other: a `--format`
    // typo would still parse cleanly from a hand-written fixture.
    const repo = mkdtempSync(join(tmpdir(), 'noldor-prflow-git-'));
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');

    writeFileSync(join(repo, 'seed.txt'), 'seed\n');
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'chore: seed');
    const base = git('rev-parse', 'HEAD').trim();

    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'roadmap.md'), '# roadmap\n');
    git('add', '-A');
    git(
      'commit',
      '-q',
      '--no-verify',
      '-m',
      'docs(roadmap): retire thing — shipped via fast-track',
    );

    writeFileSync(join(repo, 'impl.ts'), 'export const x = 1;\n');
    git('add', '-A');
    git('commit', '-q', '--no-verify', '-m', 'fix(core): the change that actually shipped');
    const implSha = git('rev-parse', 'HEAD').trim();

    const out = git('log', '--reverse', '--format=\x1e%H', '--name-only', `${base}..HEAD`);
    expect(pickSummarySha(parseCommitFileLists(out))).toBe(implSha);
  });
});

describe('stripTrailers', () => {
  it('drops Noldor and co-author trailers, keeping the prose', () => {
    const body = [
      'The overview route crashed without a scripts/ tree.',
      '',
      'ENOENT now reads as an empty tree.',
      '',
      'Noldor-Path: fast-track',
      'Noldor-FD: dashboard-overview-crash',
      'Noldor-Reviewed-Subagent: deadbeef',
      'Co-authored-by: t <t@t.io>',
    ].join('\n');
    expect(stripTrailers(body)).toBe(
      'The overview route crashed without a scripts/ tree.\n\nENOENT now reads as an empty tree.',
    );
  });

  it('drops trailers whatever their casing (git trailers are case-insensitive)', () => {
    // `git` writes `Co-authored-by`; the Claude harness writes `Co-Authored-By`.
    const body = [
      'Real prose stays.',
      '',
      'Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>',
      'NOLDOR-PATH: fast-track',
      'signed-off-by: someone <s@example.com>',
    ].join('\n');
    expect(stripTrailers(body)).toBe('Real prose stays.');
  });

  it('returns an empty string for a body that is only trailers', () => {
    expect(stripTrailers('Noldor-Path: fast-track\nNoldor-FD: x\n')).toBe('');
  });

  it('keeps prose that merely mentions a trailer-like word mid-line', () => {
    expect(stripTrailers('Adds the Noldor-Path: trailer to commits.')).toBe(
      'Adds the Noldor-Path: trailer to commits.',
    );
  });
});
