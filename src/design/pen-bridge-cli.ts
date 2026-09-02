// @tests: pendev-ui-design-phase
// `noldor design pen-bridge [--pen <path>] [--print-only]` — wake the pencil
// bridge so pencil MCP answers, instead of waiving the UI-design step. Finds a
// `.pen` to open (the session's own file, a baseline, anything tracked), then
// launches the default editor on it. It never claims the bridge is live: only
// pencil MCP can prove that, in-session, by retrying a call.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { optionalFlag, runIfDirect } from '../core/cli-entry.js';

import { EDITOR_TIMEOUT_MS } from './editor-launch.js';

import {
  BRIDGE_BOOTSTRAP_PATH,
  PENCIL_BUNDLE_ID,
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
 * What asking macOS to open a `.pen` produced.
 *
 * `dispatched` is deliberately not `opened`. A launch from a context with no
 * window-server connection — every agent tool shell — exits 0 with empty stderr
 * and starts nothing, so nothing reachable from here can prove a canvas came up.
 * Only pencil MCP can, by answering a retried call. Naming the success `opened`
 * would report a wake that never happened, which is the failure this whole
 * module exists to avoid.
 */
export type PenLaunch =
  | { kind: 'dispatched' }
  | { kind: 'not-installed'; error: string }
  | { kind: 'failed'; error: string }
  | { kind: 'unsupported-platform'; platform: string };

/** Injectable seams. Defaults are `process.platform` and a bounded `spawnSync`. */
export interface PenLaunchDeps {
  readonly platform: string;
  readonly run: (
    cmd: string,
    args: readonly string[],
    cwd: string,
  ) => { status: number | null; stderr: string; error?: Error };
}

/**
 * The marker macOS prints when a bundle id resolves to nothing. It is the whole
 * mechanism behind the not-installed / failed split — there is no second probe.
 * Measured 2026-09-02: `open -g -b <unregistered> <file>` exits 1 with it.
 */
export const BUNDLE_UNRESOLVED_MARKER = 'LSCopyApplicationURLsForBundleIdentifier';

/**
 * Ask macOS to open `absPath` in the pen.dev desktop app, without taking focus.
 *
 * `absPath` must already be absolute — {@link main} resolves it, so `open` never
 * receives a path whose meaning depends on the child's working directory.
 *
 * Off darwin this spawns nothing: there is no `open`, no bundle id, and (unlike
 * the `.md` path, which keeps `openInEditor`) no `code` fallback to degrade to.
 * Guessing at a launcher there would be the silent no-op this type exists to
 * prevent, so the caller renders the path and the operator opens it by hand.
 */
export function openPenFile(
  absPath: string,
  cwd: string,
  deps: Partial<PenLaunchDeps> = {},
): PenLaunch {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'darwin') return { kind: 'unsupported-platform', platform };

  const run = deps.run ?? defaultRun;
  const out = run('open', ['-g', '-b', PENCIL_BUNDLE_ID, absPath], cwd);
  const stderr = (out.stderr ?? '').trim();
  // Belt and braces. For `-b` a bad bundle id already exits non-zero, unlike the
  // `-a` behaviour `editor-launch.ts` documents — but stderr on a zero exit is
  // still the cheaper signal to keep than to re-derive.
  if (out.error === undefined && out.status === 0 && stderr.length === 0) {
    return { kind: 'dispatched' };
  }
  const error = out.error?.message ?? (stderr.length > 0 ? stderr : `exit ${String(out.status)}`);
  return stderr.includes(BUNDLE_UNRESOLVED_MARKER)
    ? { kind: 'not-installed', error }
    : { kind: 'failed', error };
}

/** `spawnSync`, bounded, reduced to the three fields {@link openPenFile} reads. */
function defaultRun(
  cmd: string,
  args: readonly string[],
  cwd: string,
): { status: number | null; stderr: string; error?: Error } {
  const run = spawnSync(cmd, [...args], { cwd, encoding: 'utf8', timeout: EDITOR_TIMEOUT_MS });
  return run.error === undefined
    ? { status: run.status, stderr: run.stderr ?? '' }
    : { status: run.status, stderr: run.stderr ?? '', error: run.error };
}

/**
 * Operator-facing lines for a plan, without side effects. `launch` reports what
 * this run will actually do — under `--print-only` nothing is opened, and
 * saying "opening" there would describe a tab that never appears.
 */
export function renderPlan(plan: PenBridgePlan, launch = true): string {
  if (plan.kind === 'bootstrap') {
    // "Save As", not "save": a document the app authors for itself lands under
    // ~/.pencil/documents/<uuid>/, where nothing in this repo will ever commit
    // it — so an instruction that stops at "create one" loses the design.
    return `pen-bridge: no .pen is tracked in this repo — the app must author one (Node cannot: .pen is encrypted)\n  → open the pen.dev desktop app, create a document, then Save As to ${BRIDGE_BOOTSTRAP_PATH} INSIDE this repo (a document the app saves for itself lands in ~/.pencil/documents/ and is never committed), then retry the pencil MCP call`;
  }
  return launch
    ? `pen-bridge: open requested for ${plan.path}\n  → retry the failing pencil MCP call in a few seconds; a request is not a confirmed open, and if it still fails the app is not running — start it yourself`
    : `pen-bridge: resolved ${plan.path} (nothing launched — --print-only)\n  → open ${plan.path} in the pen.dev desktop app yourself, then retry the failing pencil MCP call`;
}

/**
 * Exit code per launch outcome. `2` is the existing launch-failure code and also
 * a bad `--pen`; `3` and `4` are new because "install the app", "open it by hand
 * on this platform" and "you typed a bad path" are three different remedies, and
 * collapsing them leaves a script unable to tell them apart.
 */
export const LAUNCH_EXIT: Record<PenLaunch['kind'], number> = {
  dispatched: 0,
  failed: 2,
  'not-installed': 3,
  'unsupported-platform': 4,
};

/** Operator-facing remedy for a launch that did not dispatch. */
export function renderLaunchFailure(outcome: PenLaunch, absPath: string): string {
  if (outcome.kind === 'unsupported-platform') {
    return `pen-bridge: no scriptable open on ${outcome.platform} — the pen.dev desktop app is macOS-only\n  → open ${absPath} by hand, then retry the failing pencil MCP call`;
  }
  if (outcome.kind === 'not-installed') {
    return `pen-bridge: no application is registered for bundle id ${PENCIL_BUNDLE_ID}\n  → install the pen.dev desktop app, then re-run this command`;
  }
  return `pen-bridge: could not ask macOS to open ${absPath}: ${outcome.kind === 'failed' ? outcome.error : ''}\n  → open it in the pen.dev desktop app by hand — the path above is still correct`;
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
