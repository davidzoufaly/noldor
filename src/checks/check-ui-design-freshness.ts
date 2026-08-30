// @tests: pendev-ui-design-phase
// CLI wrapper for the UI-design baseline freshness check (spec U7 wiring (a)).
// Advisory or blocking is the CALLER's choice: gate Step 4 ignores the exit
// code (advisory), release preflight blocks on stale. This binary only reports.

import { runIfDirect } from '../core/cli-entry.js';
import { loadUiConfig } from '../core/consumer-config.js';
import {
  evaluateUiDesignFreshness,
  type UiFreshnessVerdict,
  type UiSurfaceFreshness,
} from '../release/ui-design-freshness.js';

/**
 * `unverified` exits 0 alongside `fresh` and `skipped`: it means a baseline
 * exists but no capture has vouched for it, which is adoption debt rather than
 * drift, and a framework upgrade must not start failing this check for every
 * consumer that has not wired up `design capture` yet.
 *
 * `indeterminate` exits 0 for the stricter reason that a git failure may never
 * mint a red — the check could not run, and "could not check" is not evidence
 * of drift. It is still visible: it outranks `fresh`, so its row can no longer
 * be reduced away by a healthy surface, and the printed `overall` says so.
 */
export function exitCodeFor(overall: UiFreshnessVerdict['overall']): number {
  switch (overall) {
    case 'fresh':
    case 'skipped':
    case 'unverified':
    case 'indeterminate':
      return 0;
    case 'stale':
    case 'uninitialized':
      return 1;
    default: {
      // Exhaustive by construction: a new status becomes a typecheck error
      // here rather than silently inheriting a non-zero exit.
      const never: never = overall;
      return never;
    }
  }
}

export function renderRows(surfaces: readonly UiSurfaceFreshness[]): string {
  if (surfaces.length === 0) return 'ui-design-freshness: skipped (no uiPaths configured)';
  return surfaces
    .map((s) => `  ${s.surface.padEnd(20)} ${s.status.padEnd(14)} ${s.detail}`)
    .join('\n');
}

export async function main(cwd: string = process.cwd()): Promise<number> {
  const ui = loadUiConfig(cwd);
  if (ui === null) {
    console.log('ui-design-freshness: skipped (no consumer config)');
    return 0;
  }
  const verdict = await evaluateUiDesignFreshness(cwd, ui);
  console.log(`ui-design-freshness: ${verdict.overall}`);
  console.log(renderRows(verdict.surfaces));
  return exitCodeFor(verdict.overall);
}

runIfDirect('check-ui-design-freshness', 'checks ui-design-freshness', async () => main());
