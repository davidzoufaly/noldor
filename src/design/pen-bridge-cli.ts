// @tests: pendev-ui-design-phase
// `noldor design pen-bridge [--pen <path>] [--print-only]` — wake the pencil
// bridge so pencil MCP answers, instead of waiving the UI-design step. Finds a
// `.pen` to open (the session's own file, a baseline, anything tracked), then
// launches the default editor on it. It never claims the bridge is live: only
// pencil MCP can prove that, in-session, by retrying a call.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import { optionalFlag, runIfDirect } from '../core/cli-entry.js';

import {
  BRIDGE_BOOTSTRAP_PATH,
  PENCIL_EXTENSION_ID,
  planPenBridge,
  type PenBridgePlan,
} from './pen-bridge.js';

/**
 * Tracked `.pen` files that are actually on disk, ordering left to the ranking.
 * `git ls-files` reports the INDEX, so a file deleted in the worktree is still
 * listed — handing one to the editor would open an empty buffer the Pencil
 * extension cannot load while this command reported a wake, so the existence
 * filter is what lets an all-deleted set fall through to `bootstrap`.
 */
export function trackedPenFiles(cwd: string): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '--', '*.pen'], { cwd, encoding: 'utf8' });
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && existsSync(join(cwd, l)));
  } catch {
    // Not a repo, or git unavailable: the bootstrap branch still applies.
    return [];
  }
}

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

/**
 * Operator-facing lines for a plan, without side effects. `launch` reports what
 * this run will actually do — under `--print-only` nothing is opened, and
 * saying "opening" there would describe a tab that never appears.
 */
export function renderPlan(plan: PenBridgePlan, launch = true): string {
  if (plan.kind === 'bootstrap') {
    return `pen-bridge: no .pen is tracked in this repo — the editor must author one (Node cannot: .pen is encrypted)\n  → open ${BRIDGE_BOOTSTRAP_PATH} in VS Code with the ${PENCIL_EXTENSION_ID} extension, save it, then retry the pencil MCP call`;
  }
  return launch
    ? `pen-bridge: opening ${plan.path}\n  → retry the failing pencil MCP call in a few seconds; the bridge answers once the tab is up`
    : `pen-bridge: resolved ${plan.path} (not opened — --print-only)\n  → run \`code ${plan.path}\` yourself, then retry the failing pencil MCP call`;
}

export async function main(argv: string[], cwd: string = process.cwd()): Promise<number> {
  // One usage-error exit for every way `--pen` can be wrong: absent value, a
  // value that is not a `.pen` (the bridge only wakes on a design file), or a
  // path that does not exist — opening a missing file wakes nothing, so it must
  // never reach the `open` branch and report a retry.
  const pen = optionalFlag(argv, '--pen', 'pen-bridge');
  const badPen =
    pen.ok && pen.value !== undefined
      ? !pen.value.endsWith('.pen')
        ? `pen-bridge: --pen must name a .pen file (got '${pen.value}')`
        : !existsSync(isAbsolute(pen.value) ? pen.value : join(cwd, pen.value))
          ? `pen-bridge: --pen names no file on disk (got '${pen.value}')`
          : undefined
      : undefined;
  if (!pen.ok || badPen !== undefined) {
    console.error(badPen ?? (pen.ok ? '' : pen.error));
    return 2;
  }
  const preferred = pen.value;
  const printOnly = argv.includes('--print-only');
  const plan = planPenBridge(trackedPenFiles(cwd), preferred);
  console.log(renderPlan(plan, !printOnly));
  // Bootstrap is reported, never attempted: launching the editor on a path that
  // does not exist yet would print "opening" for a file nothing can read.
  if (plan.kind === 'bootstrap') return 1;
  if (printOnly) return 0;
  const opened = openInEditor(plan.path, cwd);
  if (opened.ok) return 0;
  console.error(
    `pen-bridge: could not launch the editor: ${opened.error ?? 'unknown error'}\n` +
      "  → install the VS Code shell command (Command Palette → 'Shell Command: Install code command in PATH'), " +
      `or open ${plan.path} in the pencil desktop app by hand — the app satisfies pencil MCP too, it just cannot be scripted`,
  );
  return 2;
}

runIfDirect('pen-bridge-cli', 'design pen-bridge', async () => main(process.argv.slice(2)));
