// @tests: pendev-ui-design-phase
// `noldor design pen-bridge [--pen <path>] [--print-only]` — wake the pencil
// bridge so pencil MCP answers, instead of waiving the UI-design step. Finds a
// `.pen` to open (the session's own file, a baseline, anything tracked), then
// launches the default editor on it. It never claims the bridge is live: only
// pencil MCP can prove that, in-session, by retrying a call.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

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

/** Launch the VS Code CLI on `path`. Failure is expected (no `code` on PATH). */
export function openInEditor(path: string, cwd: string): OpenResult {
  try {
    execFileSync('code', [path], { cwd, stdio: 'pipe' });
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
