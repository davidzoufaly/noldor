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

import { listVsCodeExtensions, openInEditor, type OpenResult } from './editor-launch.js';

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

/**
 * What asking VS Code to open a `.pen` produced.
 *
 * `dispatched` is deliberately not `opened`. A launch from a context with no
 * window-server connection — every agent tool shell — can exit 0 and raise
 * nothing, so nothing reachable from here can prove a canvas came up. Only
 * pencil MCP can, by answering a retried call. Naming the success `opened` would
 * report a wake that never happened, which is the failure this whole module
 * exists to avoid.
 *
 * `not-installed` is about the pen.dev EXTENSION, not the editor. Without it
 * VS Code opens the file in its text editor and shows the document's raw JSON —
 * a launch that looks like a success, leaves the bridge dead, and gives the
 * operator a wall of coordinates instead of a canvas. It is checked before the
 * launch precisely so that outcome is named rather than dispatched.
 */
export type PenLaunch =
  | { kind: 'dispatched' }
  | { kind: 'not-installed' }
  | { kind: 'failed'; error: string };

/**
 * Injectable seams.
 *
 * `listExtensions` returns `undefined` when the list could not be read at all
 * (no `code` on PATH, a non-zero exit, an expired deadline) — distinct from an
 * empty list, which is a real answer meaning nothing is installed. The
 * difference decides the launch: see {@link openPenFile}.
 */
export interface PenLaunchDeps {
  readonly listExtensions: (cwd: string) => readonly string[] | undefined;
  readonly open: (absPath: string, cwd: string) => OpenResult;
}

/**
 * Ask VS Code to open `absPath`, preferring a launch that does not steal focus.
 *
 * `absPath` must already be absolute — {@link main} resolves it, so the editor
 * never receives a path whose meaning depends on the child's working directory.
 *
 * An unreadable extension list **does not block the launch**. Refusing on a
 * probe that merely failed to answer would turn a missing `code` on PATH into a
 * reported missing extension, and would withhold the one action that might still
 * work; the operator learns the real state from `checks pen-bridge`, which
 * reports that same unreadable list as indeterminate rather than as a finding.
 */
export function openPenFile(
  absPath: string,
  cwd: string,
  deps: Partial<PenLaunchDeps> = {},
): PenLaunch {
  const installed = (deps.listExtensions ?? listVsCodeExtensions)(cwd);
  if (installed !== undefined && !installed.includes(PENCIL_EXTENSION_ID)) {
    return { kind: 'not-installed' };
  }
  const opened = (deps.open ?? openInEditor)(absPath, cwd);
  return opened.ok
    ? { kind: 'dispatched' }
    : { kind: 'failed', error: opened.error ?? 'the editor launch failed without a message' };
}

/**
 * Operator-facing lines for a plan, without side effects. `launch` reports what
 * this run will actually do — under `--print-only` nothing is opened, and
 * saying "opening" there would describe a tab that never appears.
 */
export function renderPlan(plan: PenBridgePlan, launch = true): string {
  if (plan.kind === 'bootstrap') {
    // "Save", not "write": a `.pen` is plain JSON, so Node could technically
    // produce bytes here — but a document assembled outside the editor is not a
    // design, and the format is the editor's to version, not this framework's.
    return `pen-bridge: no .pen is tracked in this repo — the editor must author one\n  → in VS Code, create a pen.dev design and save it to ${BRIDGE_BOOTSTRAP_PATH} INSIDE this repo, then retry the pencil MCP call`;
  }
  return launch
    ? `pen-bridge: open requested for ${plan.path}\n  → retry the failing pencil MCP call in a few seconds; a request is not a confirmed open, and if it still fails, open the file in VS Code yourself`
    : `pen-bridge: resolved ${plan.path} (nothing launched — --print-only)\n  → open ${plan.path} in VS Code yourself, then retry the failing pencil MCP call`;
}

/**
 * Exit code per launch outcome. `2` is the launch-failure code and also a bad
 * `--pen`; `3` is separate because "install the pen.dev extension" and "you
 * typed a bad path" are different remedies, and collapsing them leaves a script
 * unable to tell them apart.
 *
 * Exit `4` retired with the desktop app: it meant "no scriptable open on this
 * platform", and `openInEditor` has a `code` fallback that works on every one.
 */
export const LAUNCH_EXIT: Record<PenLaunch['kind'], number> = {
  dispatched: 0,
  failed: 2,
  'not-installed': 3,
};

/** Operator-facing remedy for a launch that did not dispatch. */
export function renderLaunchFailure(outcome: PenLaunch, absPath: string): string {
  if (outcome.kind === 'not-installed') {
    return `pen-bridge: the pen.dev VS Code extension (${PENCIL_EXTENSION_ID}) is not installed\n  → install it, then re-run this command. Without it VS Code opens ${absPath} in the text editor and shows the design's raw JSON, which wakes no bridge`;
  }
  return `pen-bridge: could not ask VS Code to open ${absPath}: ${outcome.kind === 'failed' ? outcome.error : ''}\n  → open it in VS Code by hand — the path above is still correct`;
}

export async function main(
  argv: string[],
  cwd: string = process.cwd(),
  // The launcher's OWN boundary seam, forwarded. Stubbing `openPenFile` here
  // instead would mock an internal collaborator of this module — the ordering
  // test would then prove only that the stub's value was routed, never that a
  // real `open` result maps to the outcome the ordering depends on.
  deps: Partial<PenLaunchDeps> = {},
): Promise<number> {
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

  // Bootstrap is reported, never attempted: launching on a path that does not
  // exist yet would describe a file nothing can read.
  if (plan.kind === 'bootstrap') {
    console.log(renderPlan(plan));
    return 1;
  }
  if (printOnly) {
    console.log(renderPlan(plan, false));
    return 0;
  }

  // Resolve AFTER planPenBridge has chosen. `rankPenCandidates` ranks on the
  // repo-relative `docs/design/ui/` prefix, so absolutising the candidate list
  // going in would score every entry at the worst rank and collapse the order.
  const absPath = isAbsolute(plan.path) ? plan.path : join(cwd, plan.path);
  const outcome = openPenFile(absPath, cwd, deps);
  // The launch line comes AFTER the outcome, and only for `dispatched`. Printed
  // first — as it was — stdout announced a request and told the reader to retry
  // the MCP call even on a platform that spawned nothing, with stderr then
  // contradicting it. That is precisely the false wake `PenLaunch` exists to
  // prevent, and the ordering is the only thing enforcing it.
  if (outcome.kind === 'dispatched') {
    console.log(renderPlan(plan));
    return 0;
  }
  console.error(renderLaunchFailure(outcome, absPath));
  return LAUNCH_EXIT[outcome.kind];
}

runIfDirect('pen-bridge-cli', 'design pen-bridge', async () => main(process.argv.slice(2)));
