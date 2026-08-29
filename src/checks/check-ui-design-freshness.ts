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
 */
export function exitCodeFor(overall: UiFreshnessVerdict['overall']): number {
  return overall === 'fresh' || overall === 'skipped' || overall === 'unverified' ? 0 : 1;
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
