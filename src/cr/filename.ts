import { slugPath, type PathError } from '../core/slug-paths.js';
import type { Slug } from '../core/slug.js';
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
export function laneSinkPath(
  root: string,
  slug: Slug,
  kind: ArtifactKind,
  lane: string,
): { ok: true; path: string } | { ok: false; error: PathError } {
  return slugPath(root, ['.noldor', 'cr'], slug, { suffix: `-${kind}-${lane}.json` });
}

/**
 * Open a lane run: where its sink goes and when it started.
 *
 * Every lane began with these same two statements, which is both duplication and an easy
 * place to forget the `startedAt` a sink schema requires. Taking them together makes "start a
 * lane" one call instead of a convention each lane re-implements.
 */
export function openLane(
  input: { repoRoot: string; slug: Slug; kind: ArtifactKind },
  lane: string,
): { sinkPath: string; startedAt: string } {
  const built = laneSinkPath(input.repoRoot, input.slug, input.kind, lane);
  // A refusal here is not external input going wrong — the slug is already
  // branded, so the only reachable arm is a symlink or a relocated root inside
  // `.noldor/cr`, which is repository tampering rather than a bad argument.
  // Opening a lane has no result channel to report it on, so it throws.
  if (!built.ok) throw new Error(`cannot open lane '${lane}': ${built.error.kind}`);
  return { sinkPath: built.path, startedAt: new Date().toISOString() };
}

/**
 * Infer a lane from a `.noldor/cr/<slug>-<kind>-<lane>.json` sink filename.
 * Recognizes canonical names AND legacy pre-0.7.0 names (`-subagent.json` /
 * `-verify.json`), mapping the latter to their canonical role-ref — so a sink
 * written before the crLanes→role migration still resolves.
 */
export function inferLaneFromFilename(file: string): Lane | null {
  // Longest name first, canonical and legacy alike: `-ui-reviewer.json` also ends
  // with `-reviewer.json`, so a declaration-order scan would attribute a UI sink
  // to the mandatory `reviewer` lane. Sorting by length makes any future
  // overlapping name safe without a per-name special case.
  const candidates: Array<[suffix: string, lane: string]> = [
    ...LANE_NAMES.map((l): [string, string] => [l, l]),
    ...Object.entries(LANE_ALIASES).map(([legacy, canonical]): [string, string] => [
      legacy,
      canonical,
    ]),
  ].sort(([a], [b]) => b.length - a.length);
  for (const [suffix, lane] of candidates) {
    if (file.endsWith(`-${suffix}.json`)) return lane as Lane;
  }
  return null;
}
