import { appendAgentEvent } from '../core/agent-events.js';
import type { DrainStateSnapshot } from './drain-state.js';

/** Coarse per-slug drain phase (spec Unit 3 vocabulary). CR lanes need no phase
 *  rows of their own — they are real spawns whose `site: cr.*` is the lane. */
export type SlugPhase = 'building' | 'awaiting-merge' | 'merging' | 'merged';

export interface PhaseChange {
  slug: string;
  phase: SlugPhase;
}

/**
 * Pure phase diff between the last-seen per-slug phase map and one heartbeat
 * snapshot. The slug the coordinator is merging reads as `merging` (its
 * inFlight projection still says awaiting-merge); a slug that DISAPPEARS from
 * the snapshot while last seen `merging` reads as `merged` (spec: treat
 * disappearance-after-merge as merged). A slug disappearing from any other
 * phase (K=1 inline ship, build failure) emits nothing — coarse v1 vocabulary.
 */
export function diffPhases(
  prev: ReadonlyMap<string, SlugPhase>,
  s: Pick<DrainStateSnapshot, 'inFlight' | 'merging'>,
): { changes: PhaseChange[]; next: Map<string, SlugPhase> } {
  const next = new Map<string, SlugPhase>();
  for (const f of s.inFlight) next.set(f.slug, f.slug === s.merging ? 'merging' : f.phase);
  if (s.merging !== null && !next.has(s.merging)) next.set(s.merging, 'merging');
  const changes: PhaseChange[] = [];
  for (const [slug, phase] of next) {
    if (prev.get(slug) !== phase) changes.push({ slug, phase });
  }
  for (const [slug, phase] of prev) {
    if (!next.has(slug) && phase === 'merging') changes.push({ slug, phase: 'merged' });
  }
  return { changes, next };
}

/**
 * Wrap a shell's `DrainDeps.writeState` composition with a phase-diff tap:
 * every phase transition appends one `event:'phase'` row (fail-open by
 * `appendAgentEvent`'s contract), then the snapshot is delegated unchanged.
 * No `runDrain` change — the tap lives where the shells already wrap
 * `writeState` (queue-drain / watch). One tap per run/cycle: the closure's
 * map is the run's phase memory.
 */
export function makePhaseTap(
  cwd: string,
  runId: string,
  next: (s: DrainStateSnapshot) => void,
  now: () => string = () => new Date().toISOString(),
): (s: DrainStateSnapshot) => void {
  let prev = new Map<string, SlugPhase>();
  return (s) => {
    const d = diffPhases(prev, s);
    prev = d.next;
    for (const c of d.changes) {
      appendAgentEvent(cwd, {
        event: 'phase',
        ts: now(),
        runner: '-',
        role: 'drain',
        site: 'drain.heartbeat',
        runId,
        slug: c.slug,
        phase: c.phase,
      });
    }
    next(s);
  };
}
