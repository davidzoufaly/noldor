// @fd: auto-open-design-artifacts
// The decision half of `noldor design open` / `noldor hooks open-artifact`:
// is this path a live design artifact, and what path does the operator's editor
// resolve a markdown link against? Both answers are needed by two entry points
// with different output formats and different exit-code rules, so this module
// decides and they print.

import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { loadDocRoots } from '../core/doc-roots.js';
import { toPosixRelative } from '../core/repo-paths.js';

import { openInEditor, type OpenResult } from './pen-bridge-cli.js';

/**
 * Deadline on each `git rev-parse` probe. Enforced by `execFileSync`'s own
 * `timeout` so the kernel does the interrupting — an untimed wait inside a
 * PostToolUse hook is a hang, and a hang reads to the operator as a broken tool.
 * Not configurable: a knob here would be a second way to produce one.
 *
 * The editor spawn's twin lives beside `openInEditor` in `pen-bridge-cli.ts`,
 * where the process is actually started.
 */
export const GIT_TIMEOUT_MS = 2_000;

/** Env var carrying the workspace root, for the hook — which takes no flags. */
export const WORKSPACE_ROOT_ENV = 'NOLDOR_WORKSPACE_ROOT';

/** Runs a git subcommand for its stdout, or `undefined` if it cannot answer. */
export type GitProbe = (args: readonly string[], cwd: string) => string | undefined;

export interface ResolveArtifactRequest {
  readonly path: string | undefined;
  readonly cwd: string;
  /**
   * The workspace root an operator NAMED (`--workspace-root`, or
   * {@link WORKSPACE_ROOT_ENV}). A malformed value is `bad-workspace-root`, never
   * a silent fallthrough: substituting a different root would print a path they
   * did not ask for.
   */
  readonly workspaceRoot?: string | undefined;
  /**
   * An INFERRED workspace root — the hook's `payload.cwd`. Kept separate from
   * {@link workspaceRoot} because it fails differently: a value that is not an
   * existing directory means this rung did not answer, so resolution continues.
   * Routing it through the hard field would report no path at all.
   */
  readonly hintRoot?: string | undefined;
  /** Injected in tests; defaults to a real, bounded `git rev-parse`. */
  readonly git?: GitProbe;
}

export type RejectReason =
  | 'no-path'
  | 'not-a-file'
  | 'not-an-artifact'
  | 'no-repo'
  | 'bad-workspace-root';

export type ResolveArtifactResult =
  | {
      readonly kind: 'artifact';
      readonly absPath: string;
      readonly linkPath: string;
      /** Set when a NAMED root was discarded for not containing the artifact. */
      readonly warning?: string;
    }
  | { readonly kind: 'rejected'; readonly reason: RejectReason; readonly message: string };

export type LaunchOutcome =
  | { readonly kind: 'launched' }
  | { readonly kind: 'not-launched'; readonly warning: string };

/** Bounded, failure-tolerant `git rev-parse`. `undefined` = could not answer. */
function probeGit(args: readonly string[], cwd: string): string | undefined {
  try {
    const out = execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: GIT_TIMEOUT_MS,
    }).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    // Not a repo, git absent, or the probe outran GIT_TIMEOUT_MS. Which of the
    // three it was does not change any caller's behaviour.
    return undefined;
  }
}

/** An existing directory, or `undefined`. Never throws on a bad path. */
function existingDir(path: string | undefined): string | undefined {
  if (path === undefined || path.length === 0 || !isAbsolute(path)) return undefined;
  try {
    return statSync(path).isDirectory() ? path : undefined;
  } catch {
    return undefined;
  }
}

/** `realpath`, falling back to the lexical path when it cannot be canonicalized. */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * True when `child` lives beneath `parent`, comparing CANONICAL paths.
 *
 * Canonicalizing both sides is required, not tidy: a root may arrive as a
 * realpath (`git rev-parse --show-toplevel` always returns one) while the
 * artifact path stays lexical, and mixing the two makes a symlinked checkout
 * look outside its own workspace. Left lexical, this returned false for a repo
 * reached through a symlink and `relative` then produced a `../<symlink>/…` hop
 * out of the very workspace the link is supposed to resolve against.
 */
function contains(parent: string, child: string): boolean {
  const rel = relative(canonical(parent), canonical(child));
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Is `absPath` a LIVE design artifact — a `.md` regular file sitting directly in
 * its own checkout's specs or plans doc root?
 *
 * Three details carry the design. The checkout comes from `--show-toplevel`, not
 * `--git-common-dir`: the latter names the MAIN checkout even when run inside a
 * worktree, so every `specs-only-*` / `full-*` artifact would be rejected — the
 * primary case. Both sides of the doc-root comparison are canonicalized, because
 * `--show-toplevel` returns a realpath while the caller's path may have traversed
 * a symlink (`os.tmpdir()` on macOS is one, so an uncanonicalized comparison
 * fails every temp-dir test). And only DIRECT children qualify, which is what
 * excludes `archive/` — an archived artifact is history, not a review surface.
 */
function classify(
  absPath: string,
  git: GitProbe,
): { ok: true; toplevel: string } | { ok: false; reason: RejectReason; message: string } {
  let stat;
  try {
    stat = lstatSync(absPath);
    if (stat.isSymbolicLink()) stat = statSync(absPath);
  } catch {
    return { ok: false, reason: 'not-a-file', message: `no such file: ${absPath}` };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: 'not-a-file', message: `not a regular file: ${absPath}` };
  }
  if (!absPath.endsWith('.md')) {
    return { ok: false, reason: 'not-an-artifact', message: `not a .md file: ${absPath}` };
  }

  const parent = dirname(absPath);
  // The ONE git probe. Mandatory, unlike the ladder's rungs: without a checkout
  // root there is no doc root to compare against, so this cannot degrade to a
  // guess. The resolved value is returned rather than re-probed by the caller —
  // repeating it broke the documented single-probe latency bound.
  const toplevel = git(['rev-parse', '--show-toplevel'], parent);
  if (toplevel === undefined) {
    return { ok: false, reason: 'no-repo', message: `not inside a git repository: ${absPath}` };
  }

  const roots = loadDocRoots(toplevel);
  const parentReal = canonical(parent);
  const isArtifactDir = [roots.specs, roots.plans].some((r) => canonical(r) === parentReal);
  return isArtifactDir
    ? { ok: true, toplevel }
    : {
        ok: false,
        reason: 'not-an-artifact',
        message: `not a direct child of a specs or plans doc root: ${absPath}`,
      };
}

/**
 * The workspace-root ladder (spec U0). Nothing reachable from here can PROVE
 * which folder the editor opened, so the root is a supplied value with a
 * fallback chain rather than a derivation — `VSCODE_CWD` is deliberately absent
 * from it, being the cwd the VS Code *app* launched from (`/` on a real machine,
 * which every containment check accepts and every printed path is then wrong
 * against).
 *
 * @param absPath - The resolved artifact path.
 * @param req - The caller's request, read for the two supplied rungs.
 * @param checkout - The artifact's own checkout root, already probed by
 *   {@link classify}. Passed in rather than re-derived: this is rung 3, and a
 *   second probe would buy nothing but latency inside a hook.
 * @returns the root to print against, plus a warning when a NAMED root was
 *   discarded for not containing the artifact.
 */
function resolveRoot(
  absPath: string,
  req: ResolveArtifactRequest,
  checkout: string,
): { root: string; warning?: string } {
  const named = existingDir(req.workspaceRoot);
  if (named !== undefined && contains(named, absPath)) return { root: named };

  const hint = existingDir(req.hintRoot);
  const fallback = hint !== undefined && contains(hint, absPath) ? hint : checkout;

  // A named root that is well-formed but cannot express this path gets both: the
  // path still falls back, and the discard is reported. Refusing to print
  // anything would withhold the deliverable over a recoverable mistake.
  //
  // "workspace root", not "--workspace-root": the same named value also arrives
  // from NOLDOR_WORKSPACE_ROOT, and naming the flag tells an operator with a
  // stale env var to fix something they never typed.
  return named === undefined
    ? { root: fallback }
    : {
        root: fallback,
        warning: `workspace root ${named} does not contain ${absPath} — printed relative to ${fallback}`,
      };
}

/**
 * Decide whether `path` is a live design artifact and what path to report for it.
 *
 * Decision-only by design: no editor is spawned, nothing is printed, no exit code
 * is chosen and no environment is read. That is what lets `design open` print
 * before launching while the hook launches before emitting its single JSON line.
 */
export function resolveArtifact(req: ResolveArtifactRequest): ResolveArtifactResult {
  if (req.path === undefined || req.path.trim().length === 0) {
    return { kind: 'rejected', reason: 'no-path', message: 'no file path given' };
  }
  if (req.workspaceRoot !== undefined && existingDir(req.workspaceRoot) === undefined) {
    return {
      kind: 'rejected',
      reason: 'bad-workspace-root',
      message: `workspace root must be an absolute existing directory (got '${req.workspaceRoot}')`,
    };
  }

  const git = req.git ?? probeGit;
  const absPath = resolve(req.cwd, req.path);

  const verdict = classify(absPath, git);
  if (!verdict.ok) return { kind: 'rejected', reason: verdict.reason, message: verdict.message };

  const { root, warning } = resolveRoot(absPath, req, verdict.toplevel);
  // Canonical on both sides, matching `contains`: a realpath root against a
  // lexical artifact path yields a `../` hop out of the workspace. `absPath`
  // stays lexical for the launch — VS Code opens either form.
  // POSIX separators because the value is a markdown link target, not a shell
  // argument; `toPosixRelative` is the repo's one implementation of that.
  const linkPath = toPosixRelative(canonical(root), canonical(absPath));
  return warning === undefined
    ? { kind: 'artifact', absPath, linkPath }
    : { kind: 'artifact', absPath, linkPath, warning };
}

/**
 * Best-effort editor launch that NEVER throws — a launcher that throws or reports
 * failure becomes `not-launched` with an operator-facing warning.
 *
 * The deadline lives in the default launcher rather than here: this function
 * cannot interrupt a synchronous callback, so promising to would be a lie.
 * `openInEditor` passes `EDITOR_TIMEOUT_MS` to `execFileSync` and the kernel
 * enforces it; an injected launcher is the caller's own code.
 */
export function launchArtifact(
  absPath: string,
  cwd: string,
  launch: (absPath: string, cwd: string) => OpenResult = openInEditor,
): LaunchOutcome {
  let result: OpenResult;
  try {
    result = launch(absPath, cwd);
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return result.ok
    ? { kind: 'launched' }
    : {
        kind: 'not-launched',
        warning:
          `could not launch the editor: ${result.error ?? 'unknown error'}\n` +
          "  → install the VS Code shell command (Command Palette → 'Shell Command: Install code command in PATH'), " +
          `or open ${absPath} by hand — the path above is still correct`,
      };
}

/**
 * A ready-to-paste markdown link for a workspace-root-relative path.
 *
 * Exists so no agent composes one. The input is a RAW filesystem path, so it
 * holds no pre-encoded sequences and every literal `%` is encoded: a file named
 * `a%20b.md` must become `a%2520b.md`, because a target reading `a%20b.md` is
 * decoded back to `a b.md` — a file that does not exist. One pass, so ordering
 * cannot matter.
 */
export function buildArtifactLink(linkPath: string): string {
  const destination = linkPath.replace(/[%#()<>?\s]/g, (c) =>
    c === ' ' ? '%20' : `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
  const label = basename(linkPath).replace(/[[\]]/g, (c) => `\\${c}`);
  return `[${label}](${destination})`;
}
