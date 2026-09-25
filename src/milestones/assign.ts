// @fd: milestone-membership-has-no-tagger-and-no-counter

import matter from 'gray-matter';

import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';
import { setBlockField } from '../utils/write-blocks.js';
import type { Milestone } from './lib.js';

/** Where a target lives. */
export type TargetKind = 'roadmap' | 'backlog' | 'feature';

/**
 * What `assign` did, or refused to do, for one target.
 *
 * - `written` — the target had no milestone and now names this one.
 * - `noop` — it already names this milestone.
 * - `conflict` — it names a different milestone and `--replace` was not given.
 * - `not-found` — no roadmap block, backlog block or feature MD matches.
 * - `ambiguous` — more than one of them matches; the operator must pick by ID.
 */
export type TargetOutcome = 'written' | 'noop' | 'conflict' | 'not-found' | 'ambiguous';

export interface TargetLine {
  /** The target exactly as the operator typed it. */
  ref: string;
  outcome: TargetOutcome;
  /** Every place the ref matched, as `<kind>:<slug>`. One entry unless `ambiguous`. */
  matches: string[];
  /** The milestone the target named before, when it named one. */
  previous?: string;
}

/** One file `assign` rewrites, keyed by its repo-relative path. */
export interface FileWrite {
  path: string;
  text: string;
}

export interface AssignInput {
  milestone: Milestone;
  refs: readonly string[];
  replace: boolean;
  roadmapRaw: string;
  backlogRaw: string;
  /** Every feature MD, by filename stem. */
  features: ReadonlyArray<{ slug: string; raw: string }>;
}

export type AssignPlan =
  | { ok: true; lines: TargetLine[]; writes: FileWrite[] }
  | { ok: false; lines: TargetLine[]; error?: string };

const REFUSALS: ReadonlySet<TargetOutcome> = new Set(['conflict', 'not-found', 'ambiguous']);

interface Match {
  kind: TargetKind;
  slug: string;
  current: string | undefined;
}

/**
 * Decide, for every target, whether tagging it with the milestone is a write, a
 * no-op or a refusal, and compute the rewritten files.
 *
 * Pure: the caller reads the files and writes {@link AssignPlan.writes}. Every
 * target is judged before any write exists, so one refusal leaves `writes`
 * empty — the operator fixes the list and re-runs, and a re-run is safe because
 * an already-tagged target reads as `noop`.
 *
 * @param input - The milestone, the targets and the current file contents.
 * @returns Per-target lines, and the files to write when nothing refused.
 */
export function planAssign(input: AssignInput): AssignPlan {
  const { milestone, refs, replace } = input;
  if (milestone.frontmatter.status === 'shipped') {
    // Work filed into a shipped milestone is what
    // `detectMilestoneShippedIncomplete` reports later; refuse it up front.
    return { ok: false, lines: [], error: `milestone "${milestone.slug}" is shipped` };
  }

  let roadmapRaw = input.roadmapRaw;
  let backlogRaw = input.backlogRaw;
  const features = new Map(input.features.map((f) => [f.slug, f.raw]));
  const lines: TargetLine[] = [];

  for (const ref of refs) {
    const matches = findMatches(ref, roadmapRaw, backlogRaw, features);
    const labels = matches.map((m) => `${m.kind}:${m.slug}`);
    if (matches.length !== 1) {
      lines.push({
        ref,
        outcome: matches.length === 0 ? 'not-found' : 'ambiguous',
        matches: labels,
      });
      continue;
    }
    const [match] = matches as [Match];
    const line: TargetLine = { ref, outcome: 'written', matches: labels };
    if (match.current !== undefined) line.previous = match.current;
    lines.push(line);
    if (match.current === milestone.slug) {
      line.outcome = 'noop';
      continue;
    }
    if (match.current !== undefined && !replace) {
      line.outcome = 'conflict';
      continue;
    }

    if (match.kind === 'roadmap') {
      roadmapRaw = setBlockField(roadmapRaw, match.slug, 'milestone', milestone.slug);
    } else if (match.kind === 'backlog') {
      backlogRaw = setBlockField(backlogRaw, match.slug, 'milestone', milestone.slug);
    } else {
      features.set(match.slug, setFeatureMilestone(features.get(match.slug)!, milestone.slug));
    }
  }

  if (lines.some((l) => REFUSALS.has(l.outcome))) return { ok: false, lines };

  const writes: FileWrite[] = [];
  if (roadmapRaw !== input.roadmapRaw) writes.push({ path: 'docs/roadmap.md', text: roadmapRaw });
  if (backlogRaw !== input.backlogRaw) writes.push({ path: 'docs/backlog.md', text: backlogRaw });
  for (const { slug, raw } of input.features) {
    const text = features.get(slug)!;
    if (text !== raw) writes.push({ path: `docs/features/${slug}.md`, text });
  }
  return { ok: true, lines, writes };
}

/** Every roadmap block, backlog block and feature MD that `ref` names, by slug or entry ID. */
function findMatches(
  ref: string,
  roadmapRaw: string,
  backlogRaw: string,
  features: ReadonlyMap<string, string>,
): Match[] {
  const matches: Match[] = [];
  for (const [kind, entries] of [
    ['roadmap', parseRoadmap(roadmapRaw)],
    ['backlog', parseBacklog(backlogRaw)],
  ] as const) {
    for (const e of entries) {
      if (e.slug === ref || e.id === ref)
        matches.push({ kind, slug: e.slug, current: e.milestone });
    }
  }
  for (const [slug, raw] of features) {
    // Options bypass gray-matter's content-keyed cache, whose shared `data`
    // object a later mutation would otherwise leak into.
    const data = matter(raw, {}).data as Record<string, unknown>;
    if (slug === ref || data['entry-id'] === ref) {
      const current = typeof data.milestone === 'string' ? data.milestone : undefined;
      matches.push({ kind: 'feature', slug, current });
    }
  }
  return matches;
}

/** Set `milestone:` in a feature MD's frontmatter, the way `flipPhaseToDone` sets `phase:`. */
function setFeatureMilestone(md: string, milestone: string): string {
  const parsed = matter(md, {});
  const data = parsed.data as Record<string, unknown>;
  data.milestone = milestone;
  return matter.stringify(parsed.content.replace(/^\n/, ''), data);
}
