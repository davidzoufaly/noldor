import { join } from 'node:path';
import { LANE_ALIASES, LANE_NAMES } from '../core/lanes.js';
import type { ArtifactKind, Lane } from './findings-schema.js';

/**
 * The one place a CR sink path is built: `<root>/.noldor/cr/<slug>-<kind>-<lane>.json`.
 *
 * Every lane computed this inline, which is the shape `inferLaneFromFilename` below has to
 * parse back — so the writer and the reader of the same convention lived apart, in five copies.
 * `lane` is a plain string rather than {@link Lane} because orchestrate also renders legacy
 * pre-0.7.0 names through it when probing for sinks an older run may have written.
 */
export function laneSinkPath(root: string, slug: string, kind: ArtifactKind, lane: string): string {
  return join(root, '.noldor', 'cr', `${slug}-${kind}-${lane}.json`);
}

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
