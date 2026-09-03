// @fd: auto-open-design-artifacts
// The decision half of `noldor design open` / `noldor hooks open-artifact`:
// is this path a live design artifact, and what path does the operator's editor
// resolve a markdown link against? Both answers are needed by two entry points
// with different output formats and different exit-code rules, so this module
// decides and they print.

import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { loadConfigSync } from '../core/config.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { toPosixRelative } from '../core/repo-paths.js';

import { openInEditor, type OpenResult } from './editor-launch.js';

/**
 * Deadline on each `git rev-parse` probe. Enforced by `execFileSync`'s own
 * `timeout` so the kernel does the interrupting — an untimed wait inside a
 * PostToolUse hook is a hang, and a hang reads to the operator as a broken tool.
 * Not configurable: a knob here would be a second way to produce one.
 *
 * The editor spawn's twin lives beside `openInEditor` in `editor-launch.ts`,
 * where the process is actually started.
 */
export const GIT_TIMEOUT_MS = 2_000;

/** Env var carrying the workspace root, for the hook — which takes no flags. */
export const WORKSPACE_ROOT_ENV = 'NOLDOR_WORKSPACE_ROOT';

/**
 * Is launching an editor opted into for the repo at `checkoutRoot`? Default
 * `false` — see `designConfigSchema.autoOpen` for why the tab, unlike the
 * reported link, cannot be made non-disruptive.
 *
 * `loadConfigSync` inside a `try`/`catch`, which is the house pattern for a hook
 * that must not throw (`src/hooks/noldor-pre-commit.ts` reads its TTL the same
 * way): the caller is a `PostToolUse` hook, so it must stay synchronous — ruling
 * out the async `loadConfig` — and an absent, unreadable or malformed config has
 * to mean "not opted in" rather than an exception. Going through the schema keeps
 * {@link designConfigSchema} the single definition of what the knob means; a
 * hand-rolled `readFileSync` + cast here would be a second one.
 */
export function autoOpenEnabled(checkoutRoot: string): boolean {
  try {
    return loadConfigSync(join(checkoutRoot, '.noldor', 'config.json'))?.design?.autoOpen ?? false;
  } catch {
    // Malformed config, or unreadable for any reason but absence: default stands.
    return false;
  }
}

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
      /**
       * The artifact's own checkout root, already probed to find its doc roots.
       * Handed back so a caller can read that repo's config (notably
       * {@link autoOpenEnabled}) without paying a second git probe.
       */
      readonly checkoutRoot: string;
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

/**
 * True when `path` is an absolute directory that exists. Exported so the CLI can
 * reject a typo in the TYPED `--workspace-root` eagerly, without duplicating the
 * predicate — `resolveArtifact` applies the same rule lazily, where the value may
 * instead be an ambient env var.
 */
export function isExistingDir(path: string | undefined): boolean {
  return existingDir(path) !== undefined;
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

/** Purely lexical containment — the relationship the editor itself sees. */
function under(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Canonicalize a path's DIRECTORY while keeping its leaf lexical.
 *
 * Never `realpath` the leaf: an artifact may itself be a symlink to a file
 * elsewhere — a shape `classify` explicitly supports — and canonicalizing it
 * hands the operator a link to the symlink's TARGET while the editor opens the
 * symlink. That mismatch is worse than the one it would fix.
 */
function canonicalDir(path: string): string {
  return join(canonical(dirname(path)), basename(path));
}

/**
 * True when `child` lives beneath `parent`, lexically or after canonicalizing.
 *
 * Lexical comes FIRST because it is what the editor resolves: VS Code joins its
 * workspace folder to the link text, so a root that lexically holds the artifact
 * is the correct answer even when a symlink sits in the middle of the path (a
 * `repo` symlink nested under a broader workspace folder). The canonical pass is
 * only a bridge for the mismatched case — a realpath root (`--show-toplevel`
 * always returns one) against a lexical artifact path — which left unbridged made
 * a symlinked checkout look outside its own workspace and produced a
 * `../<symlink>/…` hop out of it.
 */
function contains(parent: string, child: string): boolean {
  return under(parent, child) || under(canonical(parent), canonicalDir(child));
}

/**
 * The MAIN checkout of the repo, when `parent` sits in a LINKED worktree —
 * `undefined` when it is the main checkout itself, or when the probe did not say.
 *
 * `--git-common-dir` names the SHARED git dir (the main checkout's) while
 * `--git-dir` names this checkout's own, so the two differ exactly in a linked
 * worktree. Both are resolved against the probe's cwd before comparing, because
 * git returns whichever of relative or absolute is shorter: from a subdirectory
 * of a main checkout that is `../../../.git` for one and an absolute path for the
 * other, and a raw string compare therefore reads the PRIMARY case as a worktree.
 *
 * noldor:cut the standard `<root>/.git` layout — probe `git worktree list
 * --porcelain`, whose first entry is always the main worktree, if a consumer with
 * a relocated git dir (`--separate-git-dir`) appears. Until then that layout is
 * ASSERTED rather than assumed, which is what keeps the cut from being a bug: the
 * common dir must be named `.git`, its parent must exist, and the caller must
 * find the artifact expressible from that parent. Any of the three failing leaves
 * the artifact's own checkout as the reported root.
 */
function linkedWorktreeMain(
  parent: string,
  commonDir: string | undefined,
  gitDir: string | undefined,
): string | undefined {
  if (commonDir === undefined || gitDir === undefined) return undefined;
  const common = canonical(resolve(parent, commonDir));
  if (common === canonical(resolve(parent, gitDir))) return undefined;
  // Only `<root>/.git` puts a main checkout at `<root>`. A BARE repo's worktrees
  // are all linked and it has no main checkout at all, yet `/proj/repo.git`
  // dirnames to `/proj` — an existing directory that does contain the artifact,
  // so containment alone would let the steer print `a/docs/…` against a root no
  // editor is open on. The name check is what makes the layout a precondition.
  if (basename(common) !== '.git') return undefined;
  return existingDir(dirname(common));
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
 *
 * The same probe also asks for `--git-common-dir` and `--git-dir`, whose only
 * consumer is {@link linkedWorktreeMain}. Three flags on the one `rev-parse` keep
 * the documented single-probe bound intact: the worktree question has to be
 * answered for every artifact resolution, and a second `execFileSync` to ask it
 * would be the exact regression the "ONE git probe" note below guards against.
 */
function classify(
  absPath: string,
  git: GitProbe,
):
  | { ok: true; toplevel: string; mainCheckout: string | undefined }
  | { ok: false; reason: RejectReason; message: string } {
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
  // guess. The resolved values are returned rather than re-probed by the caller —
  // repeating it broke the documented single-probe latency bound.
  const probe = git(['rev-parse', '--show-toplevel', '--git-common-dir', '--git-dir'], parent);
  // Line order follows flag order. Only the first line is required: the trailing
  // two feed a REPORTING preference, so a git old or odd enough to answer them
  // differently must degrade to the pre-existing behaviour, never to a rejection.
  const [toplevel, commonDir, gitDir] = probe?.split('\n').map((l) => l.trim()) ?? [];
  if (toplevel === undefined || toplevel.length === 0) {
    return { ok: false, reason: 'no-repo', message: `not inside a git repository: ${absPath}` };
  }

  const roots = loadDocRoots(toplevel);
  const parentReal = canonical(parent);
  const isArtifactDir = [roots.specs, roots.plans].some((r) => canonical(r) === parentReal);
  return isArtifactDir
    ? { ok: true, toplevel, mainCheckout: linkedWorktreeMain(parent, commonDir, gitDir) }
    : {
        ok: false,
        reason: 'not-an-artifact',
        message: `not a direct child of a specs or plans doc root: ${absPath}`,
      };
}

/**
 * Steer an INFERRED root off a linked worktree and onto the main checkout — the
 * folder an editor is actually opened on in a gate session working inside
 * `.worktrees/<slug>/`, which is every `specs-only-*` / `full-*` session.
 *
 * Applies to BOTH inferred rungs and to neither named one. The hook's
 * `payload.cwd` hint is the AGENT's cwd, which in such a session is the worktree
 * — so it contains the artifact and rung 2 answers with the very root the rung-3
 * fallback would have; steering only the fallback would leave the reported link
 * dead whenever a hint arrived, which is whenever the hook is the caller. A root
 * the operator NAMED is never steered: they said which folder is open, and a
 * worktree-rooted window is a real layout (`--workspace-root <tree>`, or
 * {@link WORKSPACE_ROOT_ENV}, is therefore also the manual escape from this).
 *
 * Containment is the guard, so a worktree living OUTSIDE its main checkout keeps
 * the bare path: there the main checkout cannot express the artifact at all, and
 * a `../` hop out of the workspace folder is not a link the editor can open.
 */
function preferMainCheckout(
  inferred: string,
  absPath: string,
  checkout: string,
  mainCheckout: string | undefined,
): string {
  if (mainCheckout === undefined || canonical(inferred) !== canonical(checkout)) return inferred;
  return contains(mainCheckout, absPath) ? mainCheckout : inferred;
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
 * @param mainCheckout - The main checkout when `checkout` is a linked worktree,
 *   from the same probe. See {@link preferMainCheckout} for what it overrides.
 * @returns the root to print against, plus a warning when a NAMED root was
 *   discarded for not containing the artifact.
 */
function resolveRoot(
  absPath: string,
  req: ResolveArtifactRequest,
  checkout: string,
  mainCheckout: string | undefined,
): { root: string; warning?: string } {
  const named = existingDir(req.workspaceRoot);
  if (named !== undefined && contains(named, absPath)) return { root: named };

  const hint = existingDir(req.hintRoot);
  const inferred = hint !== undefined && contains(hint, absPath) ? hint : checkout;
  const fallback = preferMainCheckout(inferred, absPath, checkout, mainCheckout);

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
  const git = req.git ?? probeGit;
  const absPath = resolve(req.cwd, req.path);

  const verdict = classify(absPath, git);
  if (!verdict.ok) return { kind: 'rejected', reason: verdict.reason, message: verdict.message };

  // Named-root validation comes AFTER the predicate, deliberately. Checked
  // eagerly, a stale `NOLDOR_WORKSPACE_ROOT` rejects every path — and the hook
  // reports that rejection, so the misconfiguration notice would land in the
  // model's context on every `Write` to any file. A bad root only matters once
  // there is an artifact whose path it would have been used to report.
  if (req.workspaceRoot !== undefined && existingDir(req.workspaceRoot) === undefined) {
    return {
      kind: 'rejected',
      reason: 'bad-workspace-root',
      message: `workspace root must be an absolute existing directory (got '${req.workspaceRoot}')`,
    };
  }

  const { root, warning } = resolveRoot(absPath, req, verdict.toplevel, verdict.mainCheckout);
  // Mirrors `contains`, and for the same reason: the lexical relationship is the
  // one the editor resolves, so it wins whenever it exists. Only when it does not
  // is the canonical bridge used, and even then the leaf stays lexical
  // (`canonicalDir`) so a symlinked artifact links to itself rather than to its
  // target. `absPath` is always lexical — VS Code opens either form.
  // POSIX separators because the value is a markdown link target, not a shell
  // argument; `toPosixRelative` is the repo's one implementation of that.
  const linkPath = under(root, absPath)
    ? toPosixRelative(root, absPath)
    : toPosixRelative(canonical(root), canonicalDir(absPath));
  const checkoutRoot = verdict.toplevel;
  return warning === undefined
    ? { kind: 'artifact', absPath, linkPath, checkoutRoot }
    : { kind: 'artifact', absPath, linkPath, checkoutRoot, warning };
}

/**
 * Best-effort editor launch that NEVER throws — a launcher that throws or reports
 * failure becomes `not-launched` with an operator-facing warning.
 *
 * The deadline lives in the default launcher rather than here: this function
 * cannot interrupt a synchronous callback, so promising to would be a lie.
 * `openInEditor` passes `EDITOR_TIMEOUT_MS` to whichever child it spawns — the
 * background `open -g` or the `code` fallback — and the kernel enforces it; an
 * injected launcher is the caller's own code.
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
