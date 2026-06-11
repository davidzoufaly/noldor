import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactKind, Finding, Lane } from './findings-schema.js';
import { laneFindingsSchema } from './findings-schema.js';
import { inferLaneFromFilename } from './filename.js';
import { PROMPT_TEMPLATE_PATH } from './deep-review-spawn.js';

export interface AggregateResult {
  ok: boolean;
  blockers: Array<Finding & { lane: Lane }>;
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

  const blockers: Array<Finding & { lane: Lane }> = [];
  const unresolved: Lane[] = [];
  const summaries: Partial<Record<Lane, string>> = {};
  const notes: Partial<Record<Lane, string[]>> = {};

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
