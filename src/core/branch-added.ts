// @tests: doc-gardening-skill
// Which files did THIS branch add? Shared by `pr-flow` (spec/plan discovery for
// the PR body) and `noldor design archive` (ownership gate for flip-time
// archival). One module so the range semantics are decided in exactly one place.

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname, join, posix, relative } from 'node:path';

/** What a git invocation reports back. */
export interface GitOutcome {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Per-call knobs. Both default to `spawnSync`'s own behaviour. */
export interface RunGitOptions {
  /** Fed to the command's stdin — e.g. revisions for `rev-list --stdin`. */
  stdin?: string;
  /** Raise when output can exceed the 1 MiB default (a large `rev-list`). */
  maxBuffer?: number;
}

/** Test seam — mirrors the `spawnSync` shape this module needs. */
export interface RunGit {
  (args: readonly string[], opts?: RunGitOptions): GitOutcome;
}

/**
 * The production {@link RunGit}: `spawnSync('git', …)` anchored at `cwd`.
 *
 * Shared rather than re-implemented per caller: the `r.error` handling below is
 * subtle enough that a second copy drifts on the next fix, and the pre-push
 * summary validator needs exactly this plus stdin and a larger buffer.
 */
export function defaultRunGit(cwd: string | undefined): RunGit {
  return (args, opts) => {
    const r = spawnSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      ...(opts?.maxBuffer === undefined ? {} : { maxBuffer: opts.maxBuffer }),
      ...(opts?.stdin === undefined ? {} : { input: opts.stdin }),
    });
    // A spawn-level failure (git not on PATH, EACCES, cwd gone, maxBuffer
    // overrun) leaves `status` null and `stderr` empty, so every error message
    // downstream would render a blank reason. Surface `r.error` instead.
    if (r.error !== undefined) return { status: null, stdout: '', stderr: r.error.message };
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
 * Run a path-listing git command and split its output into clean paths.
 *
 * `-c core.quotepath=false`: with the default on, git C-quotes non-ASCII paths
 * (`"docs/design/specs/caf\303\251.md"`), which would never match a caller's
 * fs-derived path — the file would be silently skipped.
 */
function namesFrom(run: RunGit, args: readonly string[]): string[] {
  return git(run, ['-c', 'core.quotepath=false', ...args])
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export interface DiscoverChangedFilesOptions extends DiscoverAddedFilesOptions {
  /** Right side of the range. Default: `HEAD`. */
  head?: string;
}

/** The two things every range query resolves first: a runner and a base ref. */
function runnerAndBase(options: DiscoverAddedFilesOptions): { run: RunGit; base: string } {
  const run = options.runGit ?? defaultRunGit(options.cwd);
  return { run, base: options.base ?? resolveDefaultBase(run) };
}

/**
 * Repo-relative paths CHANGED between `base` and `head`, deletions excluded.
 *
 * Unlike {@link discoverAddedFiles} this compares the two endpoint trees
 * directly rather than going through the merge base — and that is correct here
 * rather than inconsistent: callers pass the exact range a reviewer was told to
 * review (`baseSha..headSha`), so "changed" must mean "differs between these two
 * trees", which is the question the reviewer is answering.
 *
 * `--diff-filter=d` (lowercase: *exclude* deletions) because callers resolve
 * per-file rules against the result — a path deleted by the range does not exist
 * at `head`, so briefing anyone on it is meaningless. `-M` so a rename reports
 * only its destination.
 *
 * @throws When git fails: bad ref, not a repository.
 */
export function discoverChangedFiles(options: DiscoverChangedFilesOptions = {}): string[] {
  const { run, base } = runnerAndBase(options);
  const head = options.head ?? 'HEAD';
  return namesFrom(run, ['diff', '--diff-filter=d', '--name-only', '-M', base, head]);
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
  const { run, base } = runnerAndBase(options);
  const mergeBase = git(run, ['merge-base', base, 'HEAD']).trim();
  if (mergeBase.length === 0) {
    throw new Error(`git merge-base ${base} HEAD returned no commit`);
  }
  // `-M`: with rename detection off (diff-tree's default) a file this branch
  // merely MOVED reports as added at its new path. "Added by this branch" must
  // mean introduced here, not relocated here — flip-time archival moves specs, so
  // without this an archived path would read as a fresh addition.
  // The quotepath guard lives in `namesFrom`.
  return namesFrom(run, [
    'diff-tree',
    '--diff-filter=A',
    '--name-only',
    '-M',
    '-r',
    mergeBase,
    'HEAD',
  ]);
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
 * Symlink-resolved form of `p`, resolving as much of it as exists on disk.
 *
 * Exported for `src/design/artifact-locate.ts`, which needs the same two
 * properties on both sides of a containment compare: throw-free (a typo'd
 * `--spec` must be a rejection, not a crash) and symlink-resolved (an unresolved
 * `join(cwd, …)` root rejects every legal path under a `/var` cwd).
 *
 * Both sides of a `relative()` call must be in the same symlink form or the
 * result escapes: on macOS a caller may hold `/private/var/…` while `cwd` is the
 * `/var/…` symlink. Plain `realpathSync` cannot do it alone — it throws on a path
 * that does not exist yet (an `archive/` dir created later, a spec not yet
 * written), which would leave that side unresolved and reintroduce the mismatch.
 * So resolve the deepest existing ancestor and re-append the rest.
 */
export function resolveExisting(p: string): string {
  const tail: string[] = [];
  let cur = p;
  for (;;) {
    try {
      return join(realpathSync(cur), ...tail);
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return p; // hit the filesystem root: nothing resolvable
      tail.unshift(basename(cur));
      cur = parent;
    }
  }
}

/**
 * Repo-root-relative form of an absolute path inside the repo.
 *
 * Anchored with `git rev-parse --show-prefix` (how deep `cwd` sits in the repo)
 * rather than `--show-toplevel`: on macOS the latter returns the resolved
 * `/private/var/…` form while `cwd` is the `/var/…` symlink, so relativizing the
 * two yields nonsense. Forward slashes, and `..` segments collapsed, so the
 * result compares directly against git's own output on every platform — an
 * unnormalized `sub/../docs/x` would match nothing.
 *
 * @throws When git cannot report the prefix (not a repository, git missing), or
 *   when `absPath` resolves outside the repository. Deliberately loud on both: a
 *   silent `''` prefix or an escaping `../outside` result would quietly produce
 *   paths that match nothing, which reads as "not found" rather than "could not
 *   look" / "not ours to look at".
 */
export function toRepoRelative(absPath: string, cwd: string, runGit?: RunGit): string {
  const run = runGit ?? defaultRunGit(cwd);
  const prefix = git(run, ['rev-parse', '--show-prefix']).trim();
  const rel = relative(resolveExisting(cwd), resolveExisting(absPath)).split('\\').join('/');
  // Check `rel` BEFORE prepending the prefix: `relative()` across Windows drives
  // returns an absolute `D:/other`, and concatenating a `sub/` prefix first would
  // yield `sub/D:/other`, which no longer looks absolute and would sail past the
  // guard below.
  if (posix.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) {
    throw new Error(`path is outside the repository: ${absPath}`);
  }
  // `normalize('')` is `'.'`, and a stray `'.'`/trailing slash would break the
  // `startsWith(`${dir}/`)` comparisons callers build from this.
  const out = posix.normalize(`${prefix}${rel}`).replace(/\/+$/, '').replace(/^\.$/, '');
  // `..` survived normalization — the target is above the repo root.
  if (out === '..' || out.startsWith('../')) {
    throw new Error(`path is outside the repository: ${absPath}`);
  }
  return out;
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
 * When the branch range cannot be resolved (a remote-less repo has no
 * `origin/main`), falls back to full `HEAD` history: a real rename is still
 * required, only the branch scoping is lost. That is the ONLY tolerated git
 * failure — every other one throws, because `false` means "no such rename" and
 * must not double as "could not look".
 *
 * @throws When `git diff --cached` fails, or when neither history lookup runs.
 */
export function renameDestExists(options: RenameDestExistsOptions): boolean {
  const { cwd, destDirRel, suffix } = options;
  const run = options.runGit ?? defaultRunGit(cwd);

  // `core.quotepath=false`: C-quoted non-ASCII paths (`"docs/…/caf\303\251.md"`)
  // would never match a path built from the filesystem.
  // `diff.relative=false`: `diff`/`log` are porcelain and honour that config, so a
  // repo or user setting it would emit paths relative to `cwd` instead of the repo
  // root — silently breaking every `destDirRel` comparison below.
  const out = (args: readonly string[]): { ok: boolean; text: string; stderr: string } => {
    const r = run(['-c', 'core.quotepath=false', '-c', 'diff.relative=false', ...args]);
    return { ok: r.status === 0, stderr: r.stderr, text: r.stdout };
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
  if (!staged.ok) {
    throw new Error(`git diff --cached failed: ${staged.stderr.trim()}`);
  }
  if (matches(staged.text)) return true;

  const base = options.base ?? resolveDefaultBase(run);
  const scoped = out(['log', ...RENAME_ARGS, '--pretty=format:', `${base}..HEAD`]);
  if (scoped.ok) return matches(scoped.text);

  const unscoped = out(['log', ...RENAME_ARGS, '--pretty=format:', 'HEAD']);
  if (!unscoped.ok) {
    throw new Error(
      `git log failed for both ${base}..HEAD and HEAD: ${unscoped.stderr.trim() || scoped.stderr.trim()}`,
    );
  }
  return matches(unscoped.text);
}
