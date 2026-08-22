// @tests: ui-design-review-lane
// Shared reader for the per-lane `blocking | advisory` knobs in
// `autonomous.*Mode`. Every consumer wants the same fail-soft posture — an
// unreadable or absent config is `advisory`, never a hard failure of the lane —
// so the read lives here rather than being re-derived per lane.
//
// The fail-soft read is DELIBERATE, not an oversight (reviewed at Q-0145 and
// again at Q-0146): the mode knob only shapes how a lane REPORTS, while the
// lanes read their operative config strictly on their own — render-compare
// and ui-reviewer both turn a malformed consumer config into an explicit
// `cannot-review` (`config-unreadable`) sink rather than reviewing anything.
// A consumer that needs "typo'd config must red" gets it from `pnpm noldor
// validate noldor-config` in CI, which rejects the same parse this read
// swallows; making this read throw would instead take down every lane of the
// round at once, replacing three honest sinks with zero.

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
