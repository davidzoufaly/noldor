/**
 * `noldor commit [git-commit-args...]` — run `git commit` and report the truth.
 *
 * Forwards its arguments to `git commit` with inherited stdio (hook output
 * stays live), then observes HEAD and the index and prints a
 * {@link VERDICT_PREFIX}-marked verdict as the LAST stdout lines. Exits with
 * git's own status.
 *
 * One argument does not reach git: the CLI router treats a bare `--help`/`-h`
 * in any slot as a help request and prints usage instead of dispatching
 * (`src/cli/index.ts`), so `noldor commit -m -h` is a no-op.
 *
 * The verdict placement is the point: `noldor commit -m '…' | tail` still loses
 * `$?` to the pipe, but the tail now ends in `noldor commit: FAILED …` instead
 * of looking clean. See `docs/noldor/git-and-commits.md` → "Piped commits mask
 * hook failures".
 */
import { spawnSync } from 'node:child_process';

import { defaultRunGit } from './branch-added.js';
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

const runGit = defaultRunGit(undefined);

/**
 * Raw stdout of a read-only git probe, or `null` on any failure — probes never
 * throw. A failed probe degrades the verdict's detail (an unnamed sha, an empty
 * staged list); it must never take down the run that reports the commit.
 */
function probe(args: readonly string[]): string | null {
  const r = runGit(args);
  return r.status === 0 && r.stdout !== '' ? r.stdout : null;
}

export const defaultGit: CommitGit = {
  head: () => probe(['rev-parse', 'HEAD'])?.trim() || null,
  subject: (sha) => probe(['log', '-1', '--format=%s', sha])?.trim() || null,
  // `-z` + NUL-split: without it git C-quotes paths with non-ASCII or special
  // characters, so the verdict would name something the operator cannot copy.
  stagedFiles: () =>
    (probe(['diff', '--cached', '--name-only', '-z']) ?? '').split('\0').filter(Boolean),
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
  // `process.exitCode`, never `process.exit()`: a piped stdout is async on
  // POSIX, so exiting immediately after the write can truncate the very verdict
  // lines this command exists to deliver. git already ran to completion under
  // inherited stdio, so letting the process end naturally is safe.
  process.exitCode = main(process.argv.slice(2));
}
