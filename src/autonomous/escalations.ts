import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { DrainResult } from './drain-loop.js';
import type { DrainSource, SourceId } from './drain-source.js';

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

const PARK_REL = '.noldor/drain-park.json';
const ESC_REL = '.noldor/escalations.jsonl';

/** Read the park map. Fail-open: missing or corrupt file → {} (rails degrade, never crash). */
export function loadPark(cwd: string): ParkMap {
  try {
    return JSON.parse(readFileSync(join(cwd, PARK_REL), 'utf8')) as ParkMap;
  } catch {
    return {};
  }
}

function savePark(cwd: string, map: ParkMap): void {
  try {
    mkdirSync(join(cwd, '.noldor'), { recursive: true });
    writeFileSync(join(cwd, PARK_REL), `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  } catch (err) {
    process.stderr.write(`drain-park write failed (non-fatal): ${String(err)}\n`);
  }
}

function appendJsonl(cwd: string, obj: unknown): void {
  try {
    mkdirSync(join(cwd, '.noldor'), { recursive: true });
    appendFileSync(join(cwd, ESC_REL), `${JSON.stringify(obj)}\n`, 'utf8');
  } catch (err) {
    process.stderr.write(`escalations append failed (non-fatal): ${String(err)}\n`);
  }
}

/**
 * Apply a {@link CycleVerdict}: append escalation rows, park, auto-unpark (with
 * `{ resolved: true, auto: true }` audit lines). All writes fail-open —
 * observability must never kill the drain. Notify is NOT here: the watch loop
 * owns it (plain `run` writes the same records but never notifies).
 */
export function applyCycleVerdict(cwd: string, source: SourceId, v: CycleVerdict): void {
  for (const row of v.escalations) appendJsonl(cwd, row);
  const park = loadPark(cwd);
  for (const key of v.toUnpark) {
    const slug = key.split(':').slice(1).join(':');
    delete park[key];
    appendJsonl(cwd, { ts: new Date().toISOString(), slug, source, resolved: true, auto: true });
  }
  for (const p of v.toPark) {
    park[parkKey(source, p.slug)] = { reason: p.reason, ts: new Date().toISOString() };
  }
  savePark(cwd, park);
}

export interface InboxRow {
  slug: string;
  source: string;
  reason: EscalationReason;
  ts: string;
  evidence: string;
  suggestedAction: string;
}

/** Join each parked entry to its EARLIEST unresolved escalation line (first observation = authoritative evidence). */
export function readInboxRows(cwd: string): InboxRow[] {
  const park = loadPark(cwd);
  let lines: Array<Record<string, unknown>> = [];
  try {
    lines = readFileSync(join(cwd, ESC_REL), 'utf8')
      .trim()
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    lines = [];
  }
  return Object.entries(park).map(([key, entry]) => {
    const [source, ...rest] = key.split(':');
    const slug = rest.join(':');
    const first = lines.find(
      (l) => l.slug === slug && l.source === source && l.resolved === undefined,
    );
    return {
      slug,
      source: source ?? '',
      reason: entry.reason,
      ts: (first?.ts as string | undefined) ?? entry.ts,
      evidence: (first?.evidence as string | undefined) ?? '',
      suggestedAction:
        (first?.suggestedAction as string | undefined) ?? SUGGESTED_ACTIONS[entry.reason],
    };
  });
}

export type UnparkStatus =
  | { status: 'resolved'; key: string }
  | { status: 'not-parked' }
  | { status: 'ambiguous'; candidates: string[] };

/**
 * Resolve one parked slug. Ambiguous (parked under several sources, no
 * `source` given) → caller must pass `--source`. Idempotent: missing slug is
 * a no-op note, not an error.
 */
export function unparkSlug(cwd: string, slug: string, source?: string): UnparkStatus {
  const park = loadPark(cwd);
  const matches = Object.keys(park).filter((k) =>
    source !== undefined ? k === `${source}:${slug}` : k.split(':').slice(1).join(':') === slug,
  );
  if (matches.length === 0) return { status: 'not-parked' };
  if (matches.length > 1) return { status: 'ambiguous', candidates: matches };
  const key = matches[0]!;
  const src = key.split(':')[0]!;
  delete park[key];
  savePark(cwd, park);
  appendJsonl(cwd, { ts: new Date().toISOString(), slug, source: src, resolved: true });
  return { status: 'resolved', key };
}

/**
 * Decorate a {@link DrainSource} so parked slugs of the matching source are
 * excluded from selection. `parseAll` passes through untouched — the
 * absence-oracle must stay pristine (spec Unit 3). `getParked` is a getter so
 * each pickup sees the freshest park map.
 */
export function parkAwareSource(inner: DrainSource, getParked: () => ParkMap): DrainSource {
  return {
    id: inner.id,
    nextItem(skip) {
      const parkedSlugs = Object.keys(getParked())
        .filter((k) => k.startsWith(`${inner.id}:`))
        .map((k) => k.split(':').slice(1).join(':'));
      return inner.nextItem(new Set([...skip, ...parkedSlugs]));
    },
    parseAll: () => inner.parseAll(),
    gatePrompt: (slug) => inner.gatePrompt(slug),
    branchFor: (slug) => inner.branchFor(slug),
  };
}
