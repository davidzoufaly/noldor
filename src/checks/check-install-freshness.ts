// Lockfile-vs-installed-modules freshness for `noldor doctor`.
//
// A `git pull` that lands a dependency change rewrites `pnpm-lock.yaml` but
// installs nothing, so `node_modules` silently describes the PREVIOUS lockfile
// until someone runs `pnpm install`. Every downstream symptom then reads as a
// code defect: the pre-1.5.0 sweep hit three `TS2307 Cannot find module
// 'pngjs' / 'pixelmatch'` errors on a clean `main` and they looked like a bug
// in the render-compare lane, not like a missing install.
//
// The signal is a CONTENT comparison, never mtimes: pnpm copies the lockfile it
// installed from to `node_modules/.pnpm/lock.yaml`, so a byte difference is
// positive proof the tree was built from a different lockfile. Checkout order
// and touch-only writes move mtimes around freely, and this check carries an
// exit code — a heuristic that can cry stale on a healthy repo has no place
// behind one. When the marker is absent the check reports `unverified` and
// warns rather than guessing.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The consumer lockfile this check compares against the installed tree. */
export const LOCKFILE = 'pnpm-lock.yaml';

/** pnpm's copy of the lockfile it last installed from. */
export const INSTALL_MARKER = join('node_modules', '.pnpm', 'lock.yaml');

/** The one-line repair, quoted verbatim in every failure detail. */
export const REPAIR = 'pnpm install --frozen-lockfile';

/**
 * Why the installed tree is (or is not) known to match the lockfile. `ok` and
 * `no-lockfile` pass; the rest are distinct sentences a caller must be able to
 * write separately — "never installed" and "installed from an older lockfile"
 * are different repairs from "I could not look".
 */
export type InstallFreshnessStatus =
  | 'ok'
  | 'no-lockfile'
  | 'not-installed'
  | 'stale'
  | 'unverified';

export interface InstallFreshnessResult {
  readonly status: InstallFreshnessStatus;
  /**
   * True when the finding is a *limitation of this check* rather than a defect
   * in the repo — an installed tree carrying no marker this check can read.
   * Callers must warn on these and MUST NOT fail: refusing to verify is not
   * evidence of staleness, and a hard exit on one would go red on a repo whose
   * install is perfectly current.
   */
  readonly advisory: boolean;
  /** Operator-facing sentence: what is stale, and the one-line repair. */
  readonly detail: string;
}

/**
 * Verify `node_modules` was installed from the lockfile currently on disk.
 *
 * Read-only by contract: a caller acting on a non-`ok` result prints and exits
 * non-zero, and never installs on the operator's behalf.
 *
 * @param cwd - Consumer repo root.
 */
export function checkInstallFreshness(cwd: string): InstallFreshnessResult {
  const lockPath = join(cwd, LOCKFILE);
  if (!existsSync(lockPath)) {
    // No pnpm lockfile means nothing to be stale against (a fresh scaffold, or
    // a consumer on another package manager). Silence, not a finding.
    return { status: 'no-lockfile', advisory: true, detail: `no ${LOCKFILE} — nothing to check` };
  }

  if (!existsSync(join(cwd, 'node_modules'))) {
    return {
      status: 'not-installed',
      advisory: false,
      detail: `${LOCKFILE} exists but node_modules does not — dependencies were never installed. Run '${REPAIR}'.`,
    };
  }

  const markerPath = join(cwd, INSTALL_MARKER);
  if (!existsSync(markerPath)) {
    // noldor:cut pnpm's default node-linker only — read the marker a hoisted /
    // npm / yarn tree writes here if consumers adopt one.
    return {
      status: 'unverified',
      advisory: true,
      detail: `node_modules carries no ${INSTALL_MARKER}, so its lockfile provenance is unverified — confirm by hand that '${REPAIR}' has run since the last ${LOCKFILE} change.`,
    };
  }

  let lock: string;
  let installed: string;
  try {
    lock = readFileSync(lockPath, 'utf8');
    installed = readFileSync(markerPath, 'utf8');
  } catch (e) {
    // An unreadable file is this check failing to look, not proof of staleness.
    return {
      status: 'unverified',
      advisory: true,
      detail: `could not read ${LOCKFILE} or ${INSTALL_MARKER} (${e instanceof Error ? e.message : String(e)}), so install freshness is unverified — run '${REPAIR}' if in doubt.`,
    };
  }

  if (lock !== installed) {
    return {
      status: 'stale',
      advisory: false,
      detail: `node_modules was installed from a different ${LOCKFILE} — the lockfile has changed since (typically a 'git pull' with no install). Typecheck and test failures here describe the stale tree, not your code. Run '${REPAIR}'.`,
    };
  }

  return { status: 'ok', advisory: false, detail: `node_modules matches ${LOCKFILE}` };
}
