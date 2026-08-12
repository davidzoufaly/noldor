import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactKind, Finding, Lane } from './findings-schema.js';
import { laneFindingsSchema } from './findings-schema.js';
import { inferLaneFromFilename } from './filename.js';
import { readExpectedLanes } from './expected-lanes.js';
import { PROMPT_TEMPLATE_PATH } from './deep-review-spawn.js';

/**
 * A blocker as this module surfaces it — a {@link Finding} plus the lane that
 * filed it. Declared HERE, next to the only producer, and imported by consumers
 * (`cr autofix`): a second copy of the shape elsewhere needs a cast to bridge the
 * two, and that cast is exactly what would swallow a later change to this type.
 */
export type LaneBlocker = Finding & { lane: Lane };

export interface AggregateResult {
  ok: boolean;
  blockers: LaneBlocker[];
  unresolved: Lane[];
  summaries: Partial<Record<Lane, string>>;
  notes: Partial<Record<Lane, string[]>>;
}

export interface AggregateOpts {
  cwd?: string;
}

const CR_SUBDIR = '.noldor/cr';

export async function aggregate(
  slug: string,
  kind?: ArtifactKind,
  opts: AggregateOpts = {},
): Promise<AggregateResult> {
  const dir = join(opts.cwd ?? process.cwd(), CR_SUBDIR);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const prefix = kind ? `${slug}-${kind}-` : `${slug}-`;
  const files = entries
    .filter((e) => e.isFile() && e.name.startsWith(prefix) && e.name.endsWith('.json'))
    .map((e) => join(dir, e.name));

  const blockers: LaneBlocker[] = [];
  const unresolved: Lane[] = [];
  const summaries: Partial<Record<Lane, string>> = {};
  const notes: Partial<Record<Lane, string[]>> = {};
  const seen = new Set<Lane>();

  for (const file of files) {
    const filenameLane = inferLaneFromFilename(file);
    if (filenameLane === null) {
      blockers.push({
        severity: 'high',
        file,
        message: `non-conforming filename: ${file}`,
        lane: 'manual',
      });
      continue;
    }
    seen.add(filenameLane);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (err) {
      blockers.push({
        severity: 'high',
        file,
        message: `read error: ${(err as Error).message}`,
        lane: filenameLane,
      });
      summaries[filenameLane] = 'read error';
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      blockers.push({
        severity: 'high',
        file,
        message: `JSON parse error: ${(err as Error).message}`,
        lane: filenameLane,
      });
      summaries[filenameLane] = 'parse error';
      continue;
    }
    const parsed = laneFindingsSchema.safeParse(json);
    if (!parsed.success) {
      blockers.push({
        severity: 'high',
        file,
        message: `schema error: ${parsed.error.message}`,
        lane: filenameLane,
      });
      summaries[filenameLane] = 'schema error';
      continue;
    }
    if (parsed.data.lane !== filenameLane) {
      blockers.push({
        severity: 'high',
        file,
        message: `lane mismatch: payload lane ${parsed.data.lane} ≠ filename lane ${filenameLane}`,
        lane: filenameLane,
      });
      summaries[filenameLane] = 'lane mismatch';
      continue;
    }
    summaries[filenameLane] = parsed.data.summary;
    if (parsed.data.notes) notes[filenameLane] = [...parsed.data.notes];
    if (!parsed.data.finishedAt) unresolved.push(filenameLane);
    blockers.push(...parsed.data.blockers.map((b) => ({ ...b, lane: filenameLane })));

    // templateSha drift detection. Standalone lane only.
    if (filenameLane === 'standalone' && parsed.data.templateSha) {
      const currentSha = await templateShaFor(
        join(opts.cwd ?? process.cwd(), PROMPT_TEMPLATE_PATH),
      );
      if (currentSha && currentSha !== parsed.data.templateSha) {
        notes[filenameLane] = notes[filenameLane] ?? [];
        notes[filenameLane]!.push(
          `standalone template SHA drifted: stub=${parsed.data.templateSha} current=${currentSha}`,
        );
      }
    }
  }

  // A lane orchestrate resolved but that never wrote a sink is `unresolved`,
  // not invisible — a lane killed before its first write must not read as a
  // pass (Q-0100). An absent expected-lanes record (pre-Q-0100 rounds) yields
  // an empty set, preserving the old discovery-only behavior; a corrupt record
  // is a blocker, since dropping it silently would re-open the fail-open hole.
  const expected = await readExpectedLanes(opts.cwd ?? process.cwd(), slug, kind);
  for (const e of expected.errors) {
    blockers.push({ severity: 'high', file: e.file, message: e.message, lane: 'manual' });
  }
  for (const lane of expected.lanes) {
    if (!seen.has(lane) && !unresolved.includes(lane)) unresolved.push(lane);
  }

  return {
    ok: blockers.length === 0 && unresolved.length === 0,
    blockers,
    unresolved,
    summaries,
    notes,
  };
}

async function templateShaFor(path: string): Promise<string | null> {
  try {
    const { createHash } = await import('node:crypto');
    const raw = await readFile(path, 'utf8');
    return createHash('sha1').update(raw).digest('hex');
  } catch {
    return null;
  }
}
