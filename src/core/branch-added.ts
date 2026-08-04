// @tests: doc-gardening-skill
// Which files did THIS branch add? Shared by `pr-flow` (spec/plan discovery for
// the PR body) and `noldor design archive` (ownership gate for flip-time
// archival). One module so the range semantics are decided in exactly one place.

import { spawnSync } from 'node:child_process';

/** Test seam — mirrors the `spawnSync` shape this module needs. */
export interface RunGit {
  (args: readonly string[]): { status: number | null; stdout: string; stderr: string };
}

function defaultRunGit(cwd: string | undefined): RunGit {
  return (args) => {
    const r = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
}

function git(run: RunGit, args: readonly string[]): string {
  const r = run(args);
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  }
  return r.stdout;
}

export interface DiscoverAddedFilesOptions {
  /** Working directory for the git calls. Default: `process.cwd()`. */
  cwd?: string;
  /** Base ref to diff against. Default: `origin/main`. */
  base?: string;
  /** Test seam. */
  runGit?: RunGit;
}

/**
 * Repo-relative paths ADDED between `merge-base(base, HEAD)` and `HEAD`.
 *
 * The range is the merge base and deliberately **not** the two-dot
 * `base..HEAD` form: `git diff-tree base..HEAD` compares the two endpoint
 * trees, so any path the base deleted or moved *after* this branch's start
 * shows up as added on HEAD's side. Flip-time archival (`noldor design
 * archive`) moves specs into `archive/` on `main` continuously, which
 * manufactures exactly that case — a stale branch would then see foreign,
 * still-live specs as "added here".
 *
 * Paths come back repo-root-relative (that is what `git diff-tree` emits), so
 * callers comparing against their own resolved paths must anchor at the repo
 * root — see {@link repoRoot}.
 *
 * @throws When git fails: no `base` ref, no merge base, not a repository.
 */
export function discoverAddedFiles(options: DiscoverAddedFilesOptions = {}): string[] {
  // Callers filter the result themselves — one git round-trip serves any number
  // of path prefixes.
  const { cwd, base = 'origin/main' } = options;
  const run = options.runGit ?? defaultRunGit(cwd);
  const mergeBase = git(run, ['merge-base', base, 'HEAD']).trim();
  if (mergeBase.length === 0) {
    throw new Error(`git merge-base ${base} HEAD returned no commit`);
  }
  // `-c core.quotepath=false`: with the default on, git C-quotes non-ASCII paths
  // (`"docs/design/specs/caf\303\251.md"`), which would never match a caller's
  // fs-derived path — the artifact would be silently skipped.
  const out = git(run, [
    '-c',
    'core.quotepath=false',
    'diff-tree',
    '--diff-filter=A',
    '--name-only',
    '-r',
    mergeBase,
    'HEAD',
  ]);
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Absolute path of the repository root containing `cwd`.
 *
 * @throws When `cwd` is not inside a git repository.
 */
export function repoRoot(cwd?: string, runGit?: RunGit): string {
  const run = runGit ?? defaultRunGit(cwd);
  return git(run, ['rev-parse', '--show-toplevel']).trim();
}
