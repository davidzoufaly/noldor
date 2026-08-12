import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { artifactKindSchema, laneSchema } from './findings-schema.js';
import type { ArtifactKind, Lane } from './findings-schema.js';
import { writeJsonAtomic } from './atomic-write.js';

/**
 * The expected-lane record orchestrate persists before dispatch: the lane set
 * it resolved for one (slug, kind) round. `aggregate` reads it back so a lane
 * that never wrote a sink is reported as `unresolved` instead of vanishing —
 * without this record, a lane killed before its first write is
 * indistinguishable from a lane that passed (Q-0100). One file per (slug,
 * kind), overwritten each round; lives in its own subdirectory so the
 * aggregator's `<slug>-<kind>-*.json` sink scan never picks it up as a sink.
 */
export const expectedLanesSchema = z.object({
  slug: z.string().min(1),
  kind: artifactKindSchema,
  lanes: z.array(laneSchema),
});
export type ExpectedLanes = z.infer<typeof expectedLanesSchema>;

const EXPECTED_SUBDIR = join('.noldor', 'cr', 'expected');

export function expectedLanesPath(cwd: string, slug: string, kind: ArtifactKind): string {
  return join(cwd, EXPECTED_SUBDIR, `${slug}-${kind}.json`);
}

export async function writeExpectedLanes(
  cwd: string,
  slug: string,
  kind: ArtifactKind,
  lanes: Lane[],
): Promise<void> {
  const path = expectedLanesPath(cwd, slug, kind);
  await mkdir(dirname(path), { recursive: true });
  await writeJsonAtomic(path, { slug, kind, lanes } satisfies ExpectedLanes);
}

export interface ReadExpectedResult {
  lanes: Lane[];
  /** Files that exist but could not be trusted (unreadable / corrupt / wrong shape). */
  errors: Array<{ file: string; message: string }>;
}

/**
 * Expected lanes for `slug`, one kind or the union across all kinds (matching
 * `aggregate`'s cross-kind mode when `kind` is omitted). An absent file means
 * no expectation was recorded (pre-Q-0100 rounds, manual sinks) — that is not
 * an error. A file that exists but fails to parse IS surfaced via `errors`:
 * silently dropping it would fail open, and the whole point of the record is
 * to close a fail-open hole.
 */
export async function readExpectedLanes(
  cwd: string,
  slug: string,
  kind?: ArtifactKind,
): Promise<ReadExpectedResult> {
  const kinds: ArtifactKind[] = kind ? [kind] : [...artifactKindSchema.options];
  const lanes = new Set<Lane>();
  const errors: ReadExpectedResult['errors'] = [];
  for (const k of kinds) {
    const file = expectedLanesPath(cwd, slug, k);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      continue; // absent — no expectation recorded for this kind
    }
    try {
      const parsed = expectedLanesSchema.parse(JSON.parse(raw));
      for (const l of parsed.lanes) lanes.add(l);
    } catch (err) {
      errors.push({ file, message: `expected-lanes record corrupt: ${(err as Error).message}` });
    }
  }
  return { lanes: [...lanes], errors };
}
