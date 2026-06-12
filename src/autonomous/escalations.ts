import type { DrainResult } from './drain-loop.js';
import type { SourceId } from './drain-source.js';

export type EscalationReason =
  | 'retries-exhausted'
  | 'pr-open-unmerged'
  | 'merge-conflict'
  | 'merge-timeout'
  | 'run-aborted'
  | 'watcher-tripped';

export interface EscalationRow {
  ts: string;
  slug: string;
  source: SourceId;
  reason: EscalationReason;
  evidence: string;
  stateSnapshot: { shipped: number; skipped: string[] };
  suggestedAction: string;
}

/** Open-incident set, keyed `"<source>:<slug>"` so cross-source slugs never collide. */
export type ParkMap = Record<string, { reason: EscalationReason; ts: string }>;

export function parkKey(source: SourceId, slug: string): string {
  return `${source}:${slug}`;
}

export const SUGGESTED_ACTIONS: Record<EscalationReason, string> = {
  'retries-exhausted':
    'inspect .noldor/cr/<slug>-* sinks and the entry premise; fix, then `noldor autonomous unpark <slug>`',
  'pr-open-unmerged':
    'PR open but unmerged across cycles — check auto-merge/CI, merge or close the PR, then unpark',
  'merge-conflict': 'resolve the PR conflict by hand, merge or close it, then unpark',
  'merge-timeout': 'merge timed out — check gh/CI status, merge or close the PR, then unpark',
  'run-aborted': 'repo-level failure — fix the repo state (see evidence), then re-run',
  'watcher-tripped':
    'inspect recent escalations, clear the root cause, then `rm .noldor/drain.pause`',
};

export interface CycleVerdict {
  escalations: EscalationRow[];
  toPark: Array<{ slug: string; reason: EscalationReason }>;
  toUnpark: string[]; // composite keys
  nextPendingPr: string[];
  nextRunAbortError?: string;
}

const COORDINATOR_REASONS: ReadonlyArray<readonly [prefix: string, reason: EscalationReason]> = [
  ['merge-conflict', 'merge-conflict'],
  ['merge-timeout', 'merge-timeout'],
];

/**
 * Pure escalation decision for one drain cycle (spec Unit 3). IO-free: the
 * shell (applyCycleVerdict) appends/writes. `run` mode never parks
 * pr-open-unmerged (a one-shot can't observe persistence) and never dedupes
 * run-aborted (no cycle history).
 */
export function mapCycle(input: {
  result: DrainResult;
  mode: 'watch' | 'run';
  source: SourceId;
  parked: ParkMap;
  pendingPr: readonly string[];
  prevRunAbortError?: string;
  queueUniverse: readonly string[];
  now: string;
}): CycleVerdict {
  const { result, mode, source, parked, pendingPr, prevRunAbortError, queueUniverse, now } = input;
  const escalations: EscalationRow[] = [];
  const toPark: Array<{ slug: string; reason: EscalationReason }> = [];
  const nextPendingPr: string[] = [];
  const snapshot = { shipped: result.shipped, skipped: [...result.skipped] };

  const row = (slug: string, reason: EscalationReason, evidence: string): EscalationRow => ({
    ts: now,
    slug,
    source,
    reason,
    evidence,
    stateSnapshot: snapshot,
    suggestedAction: SUGGESTED_ACTIONS[reason],
  });

  // Auto-resolve: matching-source parks whose slug left the universe (PR merged / entry gone).
  const toUnpark = Object.keys(parked).filter((key) => {
    const [src, ...rest] = key.split(':');
    return src === source && !queueUniverse.includes(rest.join(':'));
  });

  for (const [slug, skipReason] of Object.entries(result.skipReasons ?? {})) {
    if (parked[parkKey(source, slug)] !== undefined) continue; // one row per open incident
    if (skipReason === 'retries-exhausted') {
      escalations.push(row(slug, 'retries-exhausted', `skip reason: ${skipReason}`));
      toPark.push({ slug, reason: 'retries-exhausted' });
      continue;
    }
    const coord = COORDINATOR_REASONS.find(([prefix]) => skipReason.startsWith(prefix));
    if (coord !== undefined) {
      escalations.push(row(slug, coord[1], `skip reason: ${skipReason}`));
      toPark.push({ slug, reason: coord[1] });
      continue;
    }
    if (skipReason === 'pr-open-unmerged') {
      if (mode !== 'watch') continue; // run mode: reported in drain stdout only
      if (pendingPr.includes(slug)) {
        escalations.push(row(slug, 'pr-open-unmerged', 'open unmerged PR across 2 cycles'));
        toPark.push({ slug, reason: 'pr-open-unmerged' });
      } else {
        nextPendingPr.push(slug); // first observation: grace
      }
      continue;
    }
    // ineligible-skip reasons: queue hygiene, never escalated
  }

  let nextRunAbortError: string | undefined;
  if (result.error !== undefined) {
    nextRunAbortError = result.error;
    const dedupe = mode === 'watch' && prevRunAbortError === result.error;
    if (!dedupe) {
      escalations.push(row('-', 'run-aborted', result.error));
    }
  }

  return {
    escalations,
    toPark,
    toUnpark,
    nextPendingPr,
    ...(nextRunAbortError !== undefined ? { nextRunAbortError } : {}),
  };
}
