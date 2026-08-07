/**
 * `noldor commit [git-commit-args...]` — run `git commit` and report the truth.
 *
 * Forwards every argument verbatim to `git commit` with inherited stdio (hook
 * output stays live), then observes HEAD and the index and prints a
 * {@link VERDICT_PREFIX}-marked verdict as the LAST stdout lines. Exits with
 * git's own status.
 *
 * The verdict placement is the point: `noldor commit -m '…' | tail` still loses
 * `$?` to the pipe, but the tail now ends in `noldor commit: FAILED …` instead
 * of looking clean. See `docs/noldor/git-and-commits.md` → "Piped commits mask
 * hook failures".
 */
import { spawnSync } from 'node:child_process';

import { decideCommitVerdict, type CommitObservation } from './commit-wrapper.js';

/** Git probes the CLI needs; injectable so tests never touch a real repo. */
export interface CommitGit {
  /** Current HEAD sha, or `null` when unborn / unresolvable. */
  readonly head: () => string | null;
  /** Subject line of a commit, or `null` when unresolvable. */
  readonly subject: (sha: string) => string | null;
  /** Paths currently in the index. */
  readonly stagedFiles: () => readonly string[];
  /** Run `git commit` with `args`; returns its exit status (`null` = no clean exit). */
  readonly runCommit: (args: readonly string[]) => number | null;
}

/** Trimmed stdout of a git probe, or `null` on any failure — probes never throw. */
function probe(args: readonly string[]): string | null {
  const r = spawnSync('git', [...args], { encoding: 'utf8' });
  if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null;
  const out = r.stdout.trim();
  return out === '' ? null : out;
}

export const defaultGit: CommitGit = {
  head: () => probe(['rev-parse', 'HEAD']),
  subject: (sha) => probe(['log', '-1', '--format=%s', sha]),
  stagedFiles: () => (probe(['diff', '--cached', '--name-only']) ?? '').split('\n').filter(Boolean),
  runCommit: (args) => {
    const r = spawnSync('git', ['commit', ...args], { stdio: 'inherit' });
    // A spawn error or a signal death both leave `status` null — the verdict
    // reports that as a failure rather than guessing an exit code.
    return r.error ? null : r.status;
  },
};

export function main(argv: readonly string[], git: CommitGit = defaultGit): number {
  const headBefore = git.head();
  const status = git.runCommit(argv);
  const headAfter = git.head();

  const obs: CommitObservation = {
    status,
    headBefore,
    headAfter,
    subjectAfter: headAfter === null ? null : git.subject(headAfter),
    stagedAfter: git.stagedFiles(),
    dryRun: argv.includes('--dry-run'),
  };

  const verdict = decideCommitVerdict(obs);
  // stdout, and last — a `| tail` reader sees the verdict even though the pipe
  // ate the exit code.
  for (const line of verdict.lines) process.stdout.write(`${line}\n`);
  return verdict.code;
}

const invokedDirect = /[\\/]commit-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  process.exit(main(process.argv.slice(2)));
}
