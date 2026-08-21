// @tests: ui-design-review-lane
// Shared reader for the per-lane `blocking | advisory` knobs in
// `autonomous.*Mode`. Both consumers want the same fail-soft posture — an
// unreadable or absent config is `advisory`, never a hard failure of the lane —
// so the read lives here rather than being re-derived per lane.

import { join } from 'node:path';

import { loadConfig } from '../core/config.js';

export type LaneMode = 'blocking' | 'advisory';

/** `key` names the autonomous-config knob this lane owns. */
export async function loadLaneMode(
  repoRoot: string,
  key: 'verifyMode' | 'uiReviewMode' | 'renderCompareMode',
): Promise<LaneMode> {
  const cfg = await loadConfig(join(repoRoot, '.noldor', 'config.json')).catch(() => null);
  return cfg?.autonomous?.[key] ?? 'advisory';
}
