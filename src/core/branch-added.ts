// @tests: doc-gardening-skill
// Which files did THIS branch add? Shared by `pr-flow` (spec/plan discovery for
// the PR body) and `noldor design archive` (ownership gate for flip-time
// archival). One module so the range semantics are decided in exactly one place.

import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';

/** Test seam — mirrors the `spawnSync` shape this module needs. */
export interface RunGit {
  (args: readonly string[]): { status: number | null; stdout: string; stderr: string };
}

/** The production {@link RunGit}: `spawnSync('git', …)` anchored at `cwd`. */
export function defaultRunGit(cwd: string | undefined): RunGit {
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
  /** Base ref to diff against. Default: {@link resolveDefaultBase}. */
  base?: string;
  /** Test seam. */
  runGit?: RunGit;
}

/**
 * The remote's default branch ref, e.g. `origin/main` or `origin/master`.
 *
 * Reads `refs/remotes/origin/HEAD` (written by `git clone` / `git remote set-head`)
 * so a consumer repo whose default branch is not `main` is not permanently
 * fail-closed. Falls back to `origin/main` when that ref is absent — a partial
 * clone or a repo where nobody ever set it.
 */
export function resolveDefaultBase(run: RunGit): string {
  const r = run(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const ref = r.status === 0 ? r.stdout.trim() : '';
  return ref.length > 0 ? ref : 'origin/main';
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
  const { cwd } = options;
  const run = options.runGit ?? defaultRunGit(cwd);
  const base = options.base ?? resolveDefaultBase(run);
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

/**
 * Repo-root-relative form of an absolute path inside the repo.
 *
 * Anchored with `git rev-parse --show-prefix` (how deep `cwd` sits in the repo)
 * rather than `--show-toplevel`: on macOS the latter returns the resolved
 * `/private/var/…` form while `cwd` is the `/var/…` symlink, so relativizing the
 * two yields nonsense. Forward slashes, so the result compares directly against
 * git's own output on every platform.
 */
export function toRepoRelative(absPath: string, cwd: string, runGit?: RunGit): string {
  const run = runGit ?? defaultRunGit(cwd);
  const probe = run(['rev-parse', '--show-prefix']);
  const prefix = probe.status === 0 ? probe.stdout.trim() : '';
  return prefix + relative(cwd, absPath).split('\\').join('/');
}

export interface RenameDestExistsOptions {
  /** Working directory for the git calls. */
  cwd: string;
  /** Repo-relative destination directory, e.g. `docs/design/specs/archive`. */
  destDirRel: string;
  /** Destination basename suffix, e.g. `-my-feature-design.md`. */
  suffix: string;
  /** Base ref for the branch-scoped lookup. Default: {@link resolveDefaultBase}. */
  base?: string;
  /** Test seam. */
  runGit?: RunGit;
}

/**
 * Did THIS BRANCH rename a file matching `suffix` into `destDirRel`?
 *
 * `--diff-filter=R` means renames only: a file simply *added* at the destination
 * does not count, which is what makes this usable as proof that the source
 * existed before the move (the trailer gate relies on exactly that for archived
 * specs). The destination must sit under `destDirRel`, so a same-named rename
 * into some other directory cannot satisfy it.
 *
 * Looks in two places, in order:
 * 1. the index — the commit performing the rename has it staged, not committed;
 * 2. `<base>..HEAD` — later commits on the same branch (a commit after the one
 *    that renamed must not be treated as though the rename never happened).
 *
 * When the range itself cannot be resolved (a remote-less repo has no
 * `origin/main`), falls back to full `HEAD` history rather than reporting
 * "no rename" for what is really a git failure: a real rename is still required,
 * only the branch scoping is lost.
 */
export function renameDestExists(options: RenameDestExistsOptions): boolean {
  const { cwd, destDirRel, suffix } = options;
  const run = options.runGit ?? defaultRunGit(cwd);

  // `core.quotepath=false`: C-quoted non-ASCII paths (`"docs/…/caf\303\251.md"`)
  // would never match a path built from the filesystem.
  const out = (args: readonly string[]): { ok: boolean; text: string } => {
    const r = run(['-c', 'core.quotepath=false', ...args]);
    return { ok: r.status === 0, text: r.stdout };
  };

  const matches = (text: string): boolean =>
    text.split('\n').some((line) => {
      // `R<score>\t<from>\t<to>` — the destination is the third field.
      const to = line.split('\t')[2]?.trim();
      if (to === undefined) return false;
      return to.startsWith(`${destDirRel}/`) && to.endsWith(suffix);
    });

  const RENAME_ARGS = ['--name-status', '--diff-filter=R', '-M'] as const;

  const staged = out(['diff', '--cached', ...RENAME_ARGS]);
  if (staged.ok && matches(staged.text)) return true;

  const base = options.base ?? resolveDefaultBase(run);
  const scoped = out(['log', ...RENAME_ARGS, '--pretty=format:', `${base}..HEAD`]);
  if (scoped.ok) return matches(scoped.text);

  const unscoped = out(['log', ...RENAME_ARGS, '--pretty=format:', 'HEAD']);
  return unscoped.ok && matches(unscoped.text);
}
