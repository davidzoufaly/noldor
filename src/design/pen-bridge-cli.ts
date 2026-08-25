// @tests: pendev-ui-design-phase
// `noldor design pen-bridge [--pen <path>] [--print-only]` — wake the pencil
// bridge so pencil MCP answers, instead of waiving the UI-design step. Finds a
// `.pen` to open (the session's own file, a baseline, anything tracked), then
// launches the default editor on it. It never claims the bridge is live: only
// pencil MCP can prove that, in-session, by retrying a call.

import { execFileSync } from 'node:child_process';

import { optionalFlag, runIfDirect } from '../core/cli-entry.js';

import {
  BRIDGE_BOOTSTRAP_PATH,
  PENCIL_EXTENSION_ID,
  planPenBridge,
  type PenBridgePlan,
} from './pen-bridge.js';

/** Tracked `.pen` files, newest-listed-first order left to the ranking. */
export function trackedPenFiles(cwd: string): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '--', '*.pen'], { cwd, encoding: 'utf8' });
    return out.split('\n').filter((l) => l.trim().length > 0);
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
  // One usage-error exit for both ways `--pen` can be wrong: absent value, or
  // a value that is not a `.pen` (the bridge only wakes on a design file).
  const pen = optionalFlag(argv, '--pen', 'pen-bridge');
  const wrongExt = pen.ok && pen.value !== undefined && !pen.value.endsWith('.pen');
  if (!pen.ok || wrongExt) {
    console.error(
      pen.ok ? `pen-bridge: --pen must name a .pen file (got '${pen.value ?? ''}')` : pen.error,
    );
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
