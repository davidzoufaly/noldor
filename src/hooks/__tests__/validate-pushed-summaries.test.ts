// @tests: pr-summary-body-enforcement
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ensureSummaryBodyRolloutSnapshot, snapshotPath } from '../../core/summary-body-rollout.js';
import {
  type GitOutcome,
  type GitRunner,
  createGitRunner,
  loadCommitFiles,
  loadCommitHeader,
  parseRefLines,
  describeNegatives,
  renderViolations,
  validatePushedSummaries,
} from '../validate-pushed-summaries.js';

const ZERO = '0'.repeat(40);

const GOOD = [
  'Why — the gate could not see the stored object and guessed from the index.',
  'How — pre-push now loads the commit object and reads its real path set.',
  'What — src/hooks/validate-pushed-summaries.ts gains the loader plus tests.',
].join('\n');

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-pushed-summaries-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  // Keep the activation snapshot out of the index: `git add -A` would otherwise
  // sweep it into whichever commit a test is building, so every assertion about
  // a commit's path set would carry a bookkeeping path the test never asked for.
  mkdirSync(join(dir, '.git/info'), { recursive: true });
  writeFileSync(join(dir, '.git/info/exclude'), '.noldor/\n');
  return dir;
}

/** Commit `paths` with `message`; returns the new SHA. */
function commit(
  dir: string,
  paths: Record<string, string>,
  message: string,
  extra: string[] = [],
): string {
  for (const [p, content] of Object.entries(paths)) {
    const full = join(dir, p);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--no-verify', '-m', message, ...extra]);
  return git(dir, ['rev-parse', 'HEAD']);
}

function codeCommit(dir: string, name: string, message: string): string {
  return commit(dir, { [`src/${name}.ts`]: `export const ${name} = 1;\n` }, message);
}

/** One ref line as git writes it on pre-push stdin. */
function refLine(localSha: string, remoteSha = ZERO): string {
  return `refs/heads/feature ${localSha} refs/heads/feature ${remoteSha}`;
}

function scan(dir: string, lines: string[], warn: (m: string) => void = () => {}) {
  return validatePushedSummaries({ git: createGitRunner(dir), refLines: lines, cwd: dir, warn });
}

/** Arm the gate, then return the repo so later commits are candidates. */
function armed(): string {
  const dir = repo();
  commit(dir, { 'README.md': 'seed\n' }, 'docs: seed');
  ensureSummaryBodyRolloutSnapshot(dir);
  return dir;
}

describe('parseRefLines', () => {
  it('parses the four documented fields', () => {
    const r = parseRefLines([refLine('a'.repeat(40))]);
    expect(r).toEqual([
      {
        localRef: 'refs/heads/feature',
        localSha: 'a'.repeat(40),
        remoteRef: 'refs/heads/feature',
        remoteSha: ZERO,
      },
    ]);
  });

  it('ignores blank lines but rejects a malformed one', () => {
    expect(parseRefLines(['', '   '])).toEqual([]);
    expect(parseRefLines(['refs/heads/x aaa refs/heads/x'])).toHaveProperty('error');
  });

  it('rejects a pseudo-option in a SHA field instead of feeding it to rev-list', () => {
    // `git rev-list --stdin` accepts pseudo-options: `--no-walk` collapses the
    // walk to the tip alone (reinstating "a valid tip hides an invalid commit"),
    // and `--not` empties the candidate set into a silent pass. Non-option
    // garbage makes rev-list error out and already fails closed; only this class
    // fails open, so it is rejected at the boundary.
    for (const bad of ['--no-walk', '--not', '--all', 'HEAD', 'not-a-sha']) {
      expect(parseRefLines([`refs/heads/x ${bad} refs/heads/x ${ZERO}`])).toHaveProperty('error');
      expect(parseRefLines([`refs/heads/x ${'a'.repeat(40)} refs/heads/x ${bad}`])).toHaveProperty(
        'error',
      );
    }
  });

  it('recognises an all-zero SHA at either length', () => {
    // Shape, not a 40-character constant — a SHA-256 repository writes 64 zeroes.
    const dir = armed();
    for (const zero of ['0'.repeat(40), '0'.repeat(64)]) {
      const result = scan(dir, [`refs/heads/gone ${zero} refs/heads/gone ${'a'.repeat(40)}`]);
      // A deletion contributes no commit, so nothing is walked and nothing fails.
      expect(result.kind).toBe('ok');
    }
  });
});

describe('activation snapshot gating', () => {
  it('is inactive with no snapshot, and says which file is missing', () => {
    const dir = repo();
    commit(dir, { 'README.md': 'seed\n' }, 'docs: seed');
    const r = scan(dir, [refLine(git(dir, ['rev-parse', 'HEAD']))]);
    expect(r.kind).toBe('inactive');
    if (r.kind === 'inactive') expect(r.notice).toContain('summary-body-rollout.json');
  });

  it('fails closed on a corrupt snapshot rather than disabling the gate', () => {
    const dir = armed();
    writeFileSync(snapshotPath(dir), 'corrupt');
    const r = scan(dir, [refLine(codeCommit(dir, 'a', 'feat: no body'))]);
    expect(r.kind).toBe('infra');
  });

  it('grandfathers everything reachable from an activation tip', () => {
    const dir = repo();
    // Pre-activation history, deliberately unexplained.
    commit(dir, { 'src/old.ts': 'export const old = 1;\n' }, 'feat: ancient unexplained commit');
    ensureSummaryBodyRolloutSnapshot(dir);
    expect(scan(dir, [refLine(git(dir, ['rev-parse', 'HEAD']))]).kind).toBe('ok');
  });

  it('enforces a commit added to an old side branch after activation', () => {
    const dir = repo();
    commit(dir, { 'README.md': 'seed\n' }, 'docs: seed');
    git(dir, ['checkout', '-q', '-b', 'side']);
    ensureSummaryBodyRolloutSnapshot(dir);
    // Not an ancestor of any recorded tip — the ancestry-only bypass.
    const sha = codeCommit(dir, 'late', 'feat: added after activation');
    const r = scan(dir, [refLine(sha)]);
    expect(r.kind).toBe('violations');
  });

  it('validates rather than exempts when an activation tip is missing from this clone', () => {
    const dir = armed();
    writeFileSync(
      snapshotPath(dir),
      JSON.stringify({ version: 1, grandfatherTips: ['b'.repeat(40)] }),
    );
    const warnings: string[] = [];
    const sha = codeCommit(dir, 'a', 'feat: no body here');
    const r = scan(dir, [refLine(sha)], (m) => warnings.push(m));
    // Omitting an unresolvable tip can only cause MORE validation.
    expect(r.kind).toBe('violations');
    if (r.kind !== 'violations') return;
    expect(r.negatives.missingTips).toBe(1);
    expect(describeNegatives(r.negatives)).toContain('b'.repeat(40));
    // Reported in the diagnostic, never warned: it needs no operator action and
    // would otherwise fire on every push in every clone but the arming one.
    expect(warnings.join('\n')).not.toContain('b'.repeat(40));
  });

  it('stays silent on a green push even when most snapshot tips are absent', () => {
    const dir = armed();
    // A tracked snapshot records the arming machine's local refs, so every other
    // clone lacks most of them. Warning here would fire on every push, forever,
    // on the same channel that carries rejections — and there is nothing to act
    // on, since an unresolvable tip only ever causes more validation.
    const absent = Array.from({ length: 40 }, (_, i) => i.toString(16).padStart(2, '0').repeat(20));
    writeFileSync(snapshotPath(dir), JSON.stringify({ version: 1, grandfatherTips: absent }));
    const warnings: string[] = [];
    const r = scan(dir, [refLine(codeCommit(dir, 'a', `feat: fine\n\n${GOOD}\n`))], (m) =>
      warnings.push(m),
    );
    expect(r.kind).toBe('ok');
    expect(warnings).toHaveLength(0);
    if (r.kind !== 'ok') return;
    expect(r.negatives.missingTips).toBe(40);
    expect(describeNegatives(r.negatives)).toContain('40 snapshot tip(s)');
  });
});

describe('policy over stored objects', () => {
  it('accepts a code commit that explains itself', () => {
    const dir = armed();
    const sha = codeCommit(dir, 'a', `feat: explain\n\n${GOOD}\n`);
    expect(scan(dir, [refLine(sha)]).kind).toBe('ok');
  });

  it('rejects a code commit that does not, naming its sha and subject', () => {
    const dir = armed();
    const sha = codeCommit(dir, 'a', 'feat: silent change');
    const r = scan(dir, [refLine(sha)]);
    expect(r.kind).toBe('violations');
    if (r.kind !== 'violations') return;
    expect(r.violations[0]!.sha).toBe(sha);
    expect(r.violations[0]!.subject).toBe('feat: silent change');
  });

  it('does not let a valid tip hide an invalid earlier commit', () => {
    const dir = armed();
    codeCommit(dir, 'bad', 'feat: silent change');
    const tip = codeCommit(dir, 'good', `feat: explain\n\n${GOOD}\n`);
    const r = scan(dir, [refLine(tip)]);
    expect(r.kind).toBe('violations');
    if (r.kind === 'violations') expect(r.violations).toHaveLength(1);
  });

  it('aggregates every invalid commit in one result', () => {
    const dir = armed();
    codeCommit(dir, 'one', 'feat: first silent change');
    const tip = codeCommit(dir, 'two', 'feat: second silent change');
    const r = scan(dir, [refLine(tip)]);
    expect(r.kind).toBe('violations');
    if (r.kind === 'violations') expect(r.violations).toHaveLength(2);
  });

  it('deduplicates a commit introduced by two ref updates', () => {
    const dir = armed();
    const sha = codeCommit(dir, 'a', 'feat: silent change');
    const r = scan(dir, [
      `refs/heads/one ${sha} refs/heads/one ${ZERO}`,
      `refs/heads/two ${sha} refs/heads/two ${ZERO}`,
    ]);
    expect(r.kind).toBe('violations');
    if (r.kind === 'violations') expect(r.violations).toHaveLength(1);
  });

  it('exempts a real merge commit by its parent count', () => {
    const dir = armed();
    const base = git(dir, ['rev-parse', 'HEAD']);
    git(dir, ['checkout', '-q', '-b', 'side']);
    codeCommit(dir, 'side', `feat: side\n\n${GOOD}\n`);
    git(dir, ['checkout', '-q', '-']);
    commit(dir, { 'other.txt': 'x\n' }, `docs: other`);
    git(dir, ['merge', '-q', '--no-ff', '--no-verify', '-m', 'Merge branch side', 'side']);
    expect(base).toBeTruthy();
    expect(scan(dir, [refLine(git(dir, ['rev-parse', 'HEAD']))]).kind).toBe('ok');
  });

  it('enforces a cherry-picked commit, with no pseudo-ref consulted', () => {
    const dir = armed();
    git(dir, ['checkout', '-q', '-b', 'side']);
    const picked = codeCommit(dir, 'picked', 'feat: silent on the side branch');
    git(dir, ['checkout', '-q', '-']);
    git(dir, ['cherry-pick', picked]);
    // A durable single-parent commit, whatever produced it.
    expect(scan(dir, [refLine(git(dir, ['rev-parse', 'HEAD']))]).kind).toBe('violations');
  });

  it('exempts a bookkeeping-only commit', () => {
    const dir = armed();
    const sha = commit(dir, { 'docs/roadmap.md': '# roadmap\n' }, 'docs(roadmap): retire an entry');
    expect(scan(dir, [refLine(sha)]).kind).toBe('ok');
  });

  it('reads the amended object, not the index', () => {
    const dir = armed();
    codeCommit(dir, 'a', 'feat: silent change');
    // Amend stages nothing; the parked design saw an empty index here and let the
    // body be emptied. The object still carries src/a.ts.
    git(dir, ['commit', '-q', '--amend', '--no-verify', '-m', 'feat: still silent']);
    expect(scan(dir, [refLine(git(dir, ['rev-parse', 'HEAD']))]).kind).toBe('violations');
  });
});

describe('remote-tracking negatives', () => {
  it('subtracts tips from every remote, not just one', () => {
    const dir = armed();
    const sha = codeCommit(dir, 'a', 'feat: silent change');
    // Pretend some remote already holds it. Scoping to a "destination" remote is
    // deliberately not attempted, so any configured remote's tip suppresses it.
    git(dir, ['remote', 'add', 'elsewhere', 'https://example.invalid/x.git']);
    git(dir, ['update-ref', 'refs/remotes/elsewhere/main', sha]);
    expect(scan(dir, [refLine(sha)]).kind).toBe('ok');
  });

  it('ignores a tracking ref whose remote is not configured', () => {
    const dir = armed();
    const sha = codeCommit(dir, 'a', 'feat: silent change');
    // Without this, `git update-ref refs/remotes/x/y <sha>` exempts an arbitrary
    // commit and its whole ancestry offline, in one command.
    git(dir, ['update-ref', 'refs/remotes/not-a-remote/main', sha]);
    expect(scan(dir, [refLine(sha)]).kind).toBe('violations');
  });

  it('reports zero tracking tips in a repo with no remotes', () => {
    const dir = armed();
    const r = scan(dir, [refLine(codeCommit(dir, 'a', `feat: fine\n\n${GOOD}\n`))]);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.negatives.trackingTips).toBe(0);
  });

  it('drops an unresolvable remote-old SHA instead of failing the push', () => {
    const dir = armed();
    const sha = codeCommit(dir, 'a', `feat: fine\n\n${GOOD}\n`);
    // The routine non-fast-forward shape: the remote moved, this clone has not
    // fetched. Git's own "Updates were rejected" must stay the message.
    const r = scan(dir, [refLine(sha, 'c'.repeat(40))]);
    expect(r.kind).not.toBe('infra');
  });
});

describe('path protocol', () => {
  it('classifies a code path containing spaces, quotes and non-ASCII', () => {
    const dir = armed();
    const sha = commit(dir, { 'src/caf é "x".ts': 'export const x = 1;\n' }, 'feat: odd path');
    // Without -z git renders this as a quoted C string, it matches no glob, and a
    // real source file reads as prose.
    const r = scan(dir, [refLine(sha)]);
    expect(r.kind).toBe('violations');
  });

  it('loadCommitFiles returns the exact stored paths', () => {
    const dir = armed();
    const sha = commit(dir, { 'src/a b.ts': 'export const x = 1;\n' }, 'feat: spaced');
    expect(loadCommitFiles(createGitRunner(dir), sha)).toEqual(['src/a b.ts']);
  });

  it('loadCommitHeader splits parents, message and trailer from one command', () => {
    const dir = armed();
    const sha = codeCommit(dir, 'a', `feat: thing\n\n${GOOD}\n\nNoldor-Path: release-automation\n`);
    const header = loadCommitHeader(createGitRunner(dir), sha);
    if ('error' in header) throw new Error(header.error);
    expect(header.parentCount).toBe(1);
    expect(header.message).toContain('Why —');
    expect(header.noldorPath).toBe('release-automation');
  });

  it('grants no automation exemption when the trailer appears twice', () => {
    const dir = armed();
    const sha = codeCommit(
      dir,
      'a',
      'feat: silent\n\nNoldor-Path: release-automation\nNoldor-Path: fast-track\n',
    );
    const header = loadCommitHeader(createGitRunner(dir), sha);
    if ('error' in header) throw new Error(header.error);
    // Ambiguous is not exempt — otherwise adding a second line forges a bypass.
    expect(header.noldorPath).toBeUndefined();
    expect(scan(dir, [refLine(sha)]).kind).toBe('violations');
  });

  it('exempts release automation carrying exactly one recognised trailer', () => {
    const dir = armed();
    const sha = codeCommit(dir, 'a', 'chore(release): v1\n\nNoldor-Path: release-automation\n');
    expect(scan(dir, [refLine(sha)]).kind).toBe('ok');
  });
});

/** A runner that answers from a table and records what it was asked. */
function fakeGit(handler: (args: readonly string[]) => Partial<GitOutcome<string>>): {
  runner: GitRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: GitRunner = {
    text(args) {
      calls.push([...args]);
      const r = handler(args);
      return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    },
    raw(args) {
      calls.push([...args]);
      const r = handler(args);
      return {
        status: r.status ?? 0,
        stdout: Buffer.from(r.stdout ?? '', 'utf8'),
        stderr: r.stderr ?? '',
      };
    },
  };
  return { runner, calls };
}

describe('failure handling', () => {
  it('degrades — not fails — when for-each-ref cannot list tracking refs', () => {
    const dir = armed();
    const sha = codeCommit(dir, 'a', `feat: fine\n\n${GOOD}\n`);
    const real = createGitRunner(dir);
    const warnings: string[] = [];
    const runner: GitRunner = {
      text: (args, stdin) =>
        args[0] === 'for-each-ref'
          ? { status: 128, stdout: '', stderr: 'boom' }
          : args[0] === 'remote'
            ? { status: 0, stdout: 'origin\n', stderr: '' }
            : real.text(args, stdin),
      raw: (args, stdin) => real.raw(args, stdin),
    };
    const r = validatePushedSummaries({
      git: runner,
      refLines: [refLine(sha)],
      cwd: dir,
      warn: (m) => warnings.push(m),
    });
    // Fewer negatives can only widen the check, so this must never block a push.
    expect(r.kind).toBe('ok');
    expect(warnings.join('\n')).toContain('remote-tracking');
  });

  it('warns and does not blame absent tips when the presence probe fails', () => {
    const dir = armed();
    const sha = codeCommit(dir, 'a', 'feat: silent change');
    const real = createGitRunner(dir);
    const warnings: string[] = [];
    const runner: GitRunner = {
      text: (args, stdin) =>
        args[0] === 'cat-file'
          ? { status: 128, stdout: '', stderr: 'boom' }
          : real.text(args, stdin),
      raw: (args, stdin) => real.raw(args, stdin),
    };
    const r = validatePushedSummaries({
      git: runner,
      refLines: [refLine(sha)],
      cwd: dir,
      warn: (m) => warnings.push(m),
    });
    // Losing the negatives can only widen the check, so the push still proceeds
    // to a real verdict — but the operator must not be told to fetch objects
    // they already have.
    expect(r.kind).toBe('violations');
    if (r.kind !== 'violations') return;
    expect(r.negatives.resolveFailed).toBe(true);
    expect(describeNegatives(r.negatives)).toContain('presence check failed');
    expect(describeNegatives(r.negatives)).not.toContain('not in this clone');
    expect(warnings.join('\n')).toContain('could not check which activation tips');
  });

  it('reports infra — not a pass — when rev-list fails', () => {
    const { runner } = fakeGit((args) =>
      args[0] === 'rev-list' ? { status: 128, stderr: 'bad revision' } : {},
    );
    const dir = armed();
    const r = validatePushedSummaries({
      git: runner,
      refLines: [refLine('a'.repeat(40))],
      cwd: dir,
    });
    expect(r.kind).toBe('infra');
  });

  it('never runs diff-tree for an object already exempt on its header', () => {
    const dir = armed();
    const merge = 'd'.repeat(40);
    const { runner, calls } = fakeGit((args) => {
      if (args[0] === 'remote') return { stdout: '' };
      if (args[0] === 'for-each-ref') return { stdout: '' };
      if (args[0] === 'cat-file') return { stdout: '' };
      if (args[0] === 'rev-list') return { stdout: `${merge}\n` };
      if (args[0] === 'log') {
        return { stdout: `${'e'.repeat(40)} ${'f'.repeat(40)}\0Merge branch x\n\0\n` };
      }
      return {};
    });
    const r = validatePushedSummaries({
      git: runner,
      refLines: [refLine('a'.repeat(40))],
      cwd: dir,
    });
    expect(r.kind).toBe('ok');
    expect(calls.some((c) => c[0] === 'diff-tree')).toBe(false);
  });
});

describe('renderViolations', () => {
  it('escapes control characters so a subject cannot forge another entry', () => {
    const rendered = renderViolations(
      [
        {
          sha: 'a'.repeat(40),
          subject: 'feat: x\n  b'.concat('b'.repeat(7)),
          error: 'missing Why',
        },
      ],
      {
        activationTips: 1,
        trackingTips: 0,
        missingTips: 0,
        missingSample: [],
        resolveFailed: false,
      },
    );
    expect(rendered).toContain('\\x0a');
    expect(rendered).toContain('activation tip');
  });
});
