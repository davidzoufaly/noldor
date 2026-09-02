// @tests: pendev-ui-design-phase
// Launching an EDITOR on a plain file, without taking focus where the platform
// allows it.
//
// Extracted from `pen-bridge-cli.ts` when `.pen` files moved to the pen.dev
// desktop app: the sole consumer of everything here is now
// `open-artifact.ts`, which opens spec and plan `.md` artifacts in VS Code, and
// a module hosting a launcher it does not itself call reads as dead code to
// everyone who opens it. `EDITOR_TIMEOUT_MS` stays shared — it is the deadline
// on any editor spawn, and the `.pen` launcher applies the same one.

import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
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
  // `spawnSync`, not `execFileSync`: the latter RETURNS stdout, and the signal
  // that matters here is stderr on a ZERO exit — which `execFileSync` only
  // surfaces on a throw that never comes.
  const run = spawnSync('open', ['-g', '-a', app, path], {
    cwd,
    encoding: 'utf8',
    timeout: EDITOR_TIMEOUT_MS,
  });
  if (run.error !== undefined || run.status !== 0) return undefined;
  // Exit 0 proves nothing here — see above. Anything on stderr is a failure.
  return (run.stderr ?? '').trim().length === 0 ? { ok: true } : undefined;
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
