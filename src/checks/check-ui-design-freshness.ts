// @tests: pendev-ui-design-phase
// CLI wrapper for the UI-design baseline freshness check (spec U7 wiring (a)).
// Advisory or blocking is the CALLER's choice: gate Step 4 ignores the exit
// code (advisory), release preflight blocks on stale. This binary only reports.

import { runIfDirect } from '../core/cli-entry.js';
import { loadConsumerConfig } from '../core/consumer-config.js';
import {
  evaluateUiDesignFreshness,
  type UiFreshnessVerdict,
  type UiSurfaceFreshness,
} from '../release/ui-design-freshness.js';

export function exitCodeFor(overall: UiFreshnessVerdict['overall']): number {
  return overall === 'fresh' || overall === 'skipped' ? 0 : 1;
}

export function renderRows(surfaces: readonly UiSurfaceFreshness[]): string {
  if (surfaces.length === 0) return 'ui-design-freshness: skipped (no uiPaths configured)';
  return surfaces
    .map((s) => `  ${s.surface.padEnd(20)} ${s.status.padEnd(14)} ${s.detail}`)
    .join('\n');
}

export async function main(cwd: string = process.cwd()): Promise<number> {
  // loadConsumerConfig throws on a repo with no .noldor/config.json — the
  // check is inert for non-adopters, never a stack trace.
  let config: ReturnType<typeof loadConsumerConfig>;
  try {
    config = loadConsumerConfig(cwd);
  } catch {
    console.log('ui-design-freshness: skipped (no consumer config)');
    return 0;
  }
  const verdict = await evaluateUiDesignFreshness(cwd, {
    uiPaths: config.uiPaths,
    uiSurfaces: config.uiSurfaces,
  });
  console.log(`ui-design-freshness: ${verdict.overall}`);
  console.log(renderRows(verdict.surfaces));
  return exitCodeFor(verdict.overall);
}

runIfDirect('check-ui-design-freshness', 'checks ui-design-freshness', async () => main());
