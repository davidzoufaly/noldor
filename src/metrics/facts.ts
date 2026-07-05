import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { FeatureFrontmatterSchema } from '../core/feature-schema.js';
import { laneFindingsSchema } from '../cr/findings-schema.js';
import { slugify } from '../utils/slugify.js';
import type { AgentEvent } from '../core/agent-events.js';
import type { EscalationRow } from '../autonomous/escalations.js';
import type { DrainState } from '../autonomous/drain-state.js';
import type { CommitFact, FeatureFact, IntakeFact, ReleaseFact, RepoFacts } from './types.js';

const REC_SEP = '\x1e';
const FIELD_SEP = '\x1f';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Trailer lines come pre-extracted by `%(trailers:unfold)` in the log format —
 * no per-commit `git interpret-trailers` subprocess (parseTrailers spawns one
 * per call, prohibitive over full history). Same `Key: value` line contract.
 */
function parseTrailerLines(block: string): Record<string, string> {
  const trailers: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Z][A-Za-z-]*):\s*(.*)$/);
    if (m) trailers[m[1]] = m[2];
  }
  return trailers;
}

function extractCommits(cwd: string): CommitFact[] {
  const raw = git(cwd, [
    'log',
    `--format=${REC_SEP}%H${FIELD_SEP}%cI${FIELD_SEP}%s${FIELD_SEP}%(trailers:unfold)`,
    '--shortstat',
  ]);
  const commits: CommitFact[] = [];
  for (const rec of raw.split(REC_SEP)) {
    if (!rec.trim()) continue;
    const [sha, date, subject, rest] = rec.split(FIELD_SEP);
    if (!sha || !date) continue;
    const ins = /(\d+) insertions?\(\+\)/.exec(rest ?? '');
    const del = /(\d+) deletions?\(-\)/.exec(rest ?? '');
    commits.push({
      sha: sha.trim(),
      date,
      subject: subject ?? '',
      trailers: parseTrailerLines(rest ?? ''),
      insertions: ins ? Number(ins[1]) : 0,
      deletions: del ? Number(del[1]) : 0,
    });
  }
  return commits;
}

function extractFeatures(cwd: string, warnings: string[]): FeatureFact[] {
  const dir = join(cwd, 'docs', 'features');
  if (!existsSync(dir)) {
    warnings.push('features: docs/features absent');
    return [];
  }
  const out: FeatureFact[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const parsed = FeatureFrontmatterSchema.safeParse(
      matter(readFileSync(join(dir, f), 'utf8')).data,
    );
    if (parsed.success) out.push({ slug: f.replace(/\.md$/, ''), fm: parsed.data });
    else warnings.push(`features: ${f} failed frontmatter parse`);
  }
  return out;
}

/** Recover since/parent/size per promoted entry from the added-lines history of roadmap/backlog. */
function recoverIntake(cwd: string): IntakeFact[] {
  let raw = '';
  try {
    raw = git(cwd, ['log', '--reverse', '-p', '--', 'docs/roadmap.md', 'docs/backlog.md']);
  } catch {
    return [];
  }
  const map = new Map<string, IntakeFact>();
  let current: IntakeFact | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git') || line.startsWith('@@')) {
      current = null;
      continue;
    }
    const h = /^\+#{3,4} (.+)$/.exec(line);
    if (h) {
      const slug = slugify(h[1]);
      current = map.get(slug) ?? { slug };
      map.set(slug, current);
      continue;
    }
    const f = /^\+- (since|parent|size): (.+)$/.exec(line);
    if (f && current) {
      const key = f[1] as 'since' | 'parent' | 'size';
      if (current[key] === undefined) current[key] = f[2].trim();
    }
  }
  return [...map.values()];
}

function readJsonl<T>(path: string, label: string, warnings: string[]): T[] {
  if (!existsSync(path)) return [];
  const rows: T[] = [];
  let skipped = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      skipped += 1;
    }
  }
  if (skipped > 0) warnings.push(`${label}: skipped ${skipped} malformed line(s)`);
  return rows;
}

function readLaneFindings(cwd: string, warnings: string[]): RepoFacts['laneFindings'] {
  const out: RepoFacts['laneFindings'] = [];
  for (const dir of [join(cwd, '.noldor', 'cr'), join(cwd, '.noldor', 'cr', 'archive')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const parsed = laneFindingsSchema.safeParse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
        if (parsed.success) out.push(parsed.data);
        else warnings.push(`cr: ${f} failed LaneFindings parse`);
      } catch {
        warnings.push(`cr: ${f} unreadable`);
      }
    }
  }
  return out;
}

function extractReleases(cwd: string): ReleaseFact[] {
  const raw = git(cwd, [
    'for-each-ref',
    'refs/tags/v*',
    `--format=%(refname:short)${FIELD_SEP}%(creatordate:iso-strict)`,
  ]);
  const out: ReleaseFact[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const [tag, date] = line.split(FIELD_SEP);
    if (tag?.startsWith('v') && date) out.push({ version: tag.slice(1), date });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * One extraction pass over every metrics source. Fail-open PER SOURCE:
 * absent file → empty list + warning; malformed row → skipped + warning.
 * Only a non-git cwd throws.
 */
export async function extractFacts(cwd: string): Promise<RepoFacts> {
  const warnings: string[] = [];
  let drainState: DrainState | null = null;
  try {
    drainState = JSON.parse(
      readFileSync(join(cwd, '.noldor', 'drain-state.json'), 'utf8'),
    ) as DrainState;
  } catch {
    drainState = null;
  }
  return {
    commits: extractCommits(cwd),
    features: extractFeatures(cwd, warnings),
    intake: recoverIntake(cwd),
    laneFindings: readLaneFindings(cwd, warnings),
    agentEvents: readJsonl<AgentEvent>(
      join(cwd, '.noldor', 'agent-events.jsonl'),
      'agent-events',
      warnings,
    ),
    escalations: readJsonl<EscalationRow>(
      join(cwd, '.noldor', 'escalations.jsonl'),
      'escalations',
      warnings,
    ),
    drainState,
    releases: extractReleases(cwd),
    warnings,
  };
}
