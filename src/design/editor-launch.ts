// @tests: pendev-ui-design-phase
// Launching an EDITOR on a plain file, without taking focus where the platform
// allows it.
//
// Every editor spawn in the framework goes through here, and there is exactly
// one editor: `open-artifact.ts` opens spec and plan `.md` artifacts,
// `pen-bridge-cli.ts` opens `.pen` designs, and both land on `openInEditor`.
// That was briefly untrue — `.pen` had its own macOS bundle launcher while the
// designs lived in the pen.dev desktop app — and one route is what makes the
// shared `EDITOR_TIMEOUT_MS` deadline and the shared no-focus behaviour facts
// rather than coincidences.
//
// `listVsCodeExtensions` lives here for the same reason: the `code` CLI is one
// boundary, and a second module shelling out to it would make the claim below
// about subprocesses false. `probeVsCodeWindows` too: it asks the process table
// about the same editor.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';

export interface OpenResult {
  ok: boolean;
  /** Present when the editor could not be launched. */
  error?: string;
}

/**
 * Deadline on the `code` spawn, enforced by `execFileSync` so the kernel does the
 * interrupting. It lives here rather than at the call site because this is the
 * only place a subprocess is actually started — a caller cannot interrupt a
 * synchronous callback, so a timeout promised anywhere else would be a lie. An
 * untimed spawn inside a PostToolUse hook is a hang, and a hang reads to the
 * operator as a broken tool.
 */
export const EDITOR_TIMEOUT_MS = 5_000;

/**
 * The `.app` bundle directory enclosing `binPath`, or `undefined` when the path
 * is not inside one.
 *
 * Pure, and exported for its own tests: `code` on macOS is a shim buried in the
 * bundle (…/Visual Studio Code.app/Contents/Resources/app/bin/code), so the
 * bundle is found by walking ancestors. Deriving it beats hardcoding
 * `com.microsoft.VSCode` — the background launch then follows whatever editor
 * the operator installed (Insiders, a fork, a non-standard location) off the same
 * "`code` on PATH" contract the foreground path already relies on, instead of
 * silently reverting them all to a focus-stealing launch. A Linux `/usr/bin/code`
 * is correctly `undefined`: there is no bundle, and no `open` either.
 */
export function appBundleFor(binPath: string): string | undefined {
  let dir = binPath;
  while (dir.length > 1) {
    if (dir.endsWith('.app')) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/** The `.app` enclosing the `code` on PATH, resolved through symlinks. */
function enclosingAppBundle(cwd: string): string | undefined {
  try {
    const bin = execFileSync('which', ['code'], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: EDITOR_TIMEOUT_MS,
    }).trim();
    return bin.length === 0 ? undefined : appBundleFor(realpathSync(bin));
  } catch {
    // No `code` on PATH, or `which` unavailable: the foreground fallback owns it.
    return undefined;
  }
}

/**
 * Open `path` in the editor WITHOUT taking focus, via macOS `open -g`.
 *
 * `undefined` means this route is unavailable and the caller must fall back.
 *
 * Two things make this the only workable no-focus route. The `code` CLI has no
 * background flag at all, so it always raises the window — which interrupts
 * whatever the operator was doing, on every artifact. And `open` cannot be
 * trusted by exit code: an absent app prints `Unable to find application …` to
 * stderr and still exits **0**, so stderr content is the real failure signal and
 * an empty stderr is the only success.
 *
 * Window routing is unchanged and deliberately left to the editor: `open` hands
 * the file to the running app, which places it in the window whose workspace
 * contains it, exactly as `code` does. That is why this needs no window logic of
 * its own.
 */
function openInBackground(path: string, cwd: string): OpenResult | undefined {
  if (process.platform !== 'darwin') return undefined;
  const app = enclosingAppBundle(cwd);
  if (app === undefined) return undefined;
  const run = ranCleanly('open', ['-g', '-a', app, path], cwd);
  if (run === undefined) return undefined;
  // Exit 0 proves nothing here — see above. Anything on stderr is a failure.
  return (run.stderr ?? '').trim().length === 0 ? { ok: true } : undefined;
}

/**
 * A bounded spawn whose non-answers all collapse to `undefined`: a spawn error
 * (no such binary, an expired {@link EDITOR_TIMEOUT_MS}) or a non-zero exit.
 * Callers that need more — stderr on a ZERO exit, or stdout — read it off the
 * returned run.
 *
 * `spawnSync`, not `execFileSync`: the latter RETURNS stdout and surfaces stderr
 * only on a throw, which never comes for the zero-exit-with-stderr case
 * {@link openInBackground} depends on.
 */
function ranCleanly(
  cmd: string,
  args: readonly string[],
  cwd: string,
): { stdout?: string; stderr?: string } | undefined {
  const run = spawnSync(cmd, [...args], { cwd, encoding: 'utf8', timeout: EDITOR_TIMEOUT_MS });
  return run.error === undefined && run.status === 0 ? run : undefined;
}

/**
 * Extension ids VS Code reports as installed, or `undefined` when it could not
 * be asked (no `code` on PATH, a non-zero exit, an expired deadline).
 *
 * `undefined` and `[]` are different answers and every caller must keep them
 * apart: the empty list says nothing is installed, while `undefined` says the
 * question went unanswered — and treating the second as the first turns a
 * missing `code` into a confident report about extensions.
 *
 * This lives beside {@link openInEditor} because it is the same boundary — the
 * `code` CLI — and the module comment's claim that subprocesses start only here
 * has to keep being true.
 */
export function listVsCodeExtensions(cwd: string): readonly string[] | undefined {
  const run = ranCleanly('code', ['--list-extensions'], cwd);
  if (run === undefined) return undefined;
  return (run.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** What the process table says about running VS Code windows and a pencil socket. */
export interface VsCodeWindows {
  /** Renderer processes carrying `vscode-window-config` — one per open window. */
  readonly windows: number;
  /** Distinct pids with `socketPath` open, ascending. */
  readonly socketPids: readonly number[];
}

/**
 * How many VS Code windows are open, and which processes hold `socketPath`, or
 * `undefined` when either question went unanswered.
 *
 * `pgrep` exits 1 for "no match", which is an answer (zero windows) rather than
 * a failure, so {@link ranCleanly} — which folds every non-zero exit into
 * `undefined` — is the wrong reader for it. Only status 0 and 1 count; anything
 * else, or a spawn error, is unanswered.
 */
export function probeVsCodeWindows(socketPath: string): VsCodeWindows | undefined {
  const pgrep = spawnSync('pgrep', ['-f', 'vscode-window-config'], {
    encoding: 'utf8',
    timeout: EDITOR_TIMEOUT_MS,
  });
  if (pgrep.error !== undefined || (pgrep.status !== 0 && pgrep.status !== 1)) return undefined;
  const windows = (pgrep.stdout ?? '').split('\n').filter((l) => l.trim().length > 0).length;
  // No socket file means no window has activated the extension: nobody owns it.
  // lsof would report that as a stat error, indistinguishable from a real one.
  if (!existsSync(socketPath)) return { windows, socketPids: [] };
  // `-F p`: one `p<pid>` line per process that has the socket open, instead of
  // the column layout, whose COMMAND field can itself contain spaces.
  const lsof = spawnSync('lsof', ['-U', '-a', '-F', 'p', '--', socketPath], {
    encoding: 'utf8',
    timeout: EDITOR_TIMEOUT_MS,
  });
  // lsof exits 1 both when nothing has the file open and on a partial failure,
  // so status alone cannot tell them apart; stderr can.
  if (lsof.error !== undefined || (lsof.stderr ?? '').trim().length > 0) return undefined;
  const pids = (lsof.stdout ?? '')
    .split('\n')
    .filter((l) => /^p\d+$/.test(l))
    .map((l) => Number(l.slice(1)));
  return { windows, socketPids: [...new Set(pids)].sort((a, b) => a - b) };
}

/**
 * Open `path` in the editor, preferring a launch that does not steal focus.
 *
 * Background first (macOS `open -g`), then the `code` CLI. The fallback is not a
 * degraded mode to be avoided: it is the only route on Linux and Windows, and it
 * still opens the file — it just raises the window. Failure of BOTH is expected
 * (no `code` on PATH at all) and an expired {@link EDITOR_TIMEOUT_MS} arrives
 * here as one more failed launch.
 */
export function openInEditor(path: string, cwd: string): OpenResult {
  const background = openInBackground(path, cwd);
  if (background !== undefined) return background;
  try {
    execFileSync('code', [path], { cwd, stdio: 'pipe', timeout: EDITOR_TIMEOUT_MS });
    return { ok: true };
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr?.toString() ?? String(err);
    return { ok: false, error: stderr.trim() };
  }
}
