import { LANE_ALIASES, LANE_NAMES } from '../core/lanes.js';
import type { Lane } from './findings-schema.js';

/**
 * Infer a lane from a `.noldor/cr/<slug>-<kind>-<lane>.json` sink filename.
 * Recognizes canonical names AND legacy pre-0.7.0 names (`-subagent.json` /
 * `-verify.json`), mapping the latter to their canonical role-ref — so a sink
 * written before the crLanes→role migration still resolves.
 */
export function inferLaneFromFilename(file: string): Lane | null {
  for (const l of LANE_NAMES) {
    if (file.endsWith(`-${l}.json`)) return l as Lane;
  }
  for (const [legacy, canonical] of Object.entries(LANE_ALIASES)) {
    if (file.endsWith(`-${legacy}.json`)) return canonical as Lane;
  }
  return null;
}
