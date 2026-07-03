// @tests: agent-events-phase-tracking-run-ids-and-agents-dashboard-page
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffPhases, makePhaseTap, type SlugPhase } from '../phase-events.js';
import type { DrainStateSnapshot } from '../drain-state.js';

const snap = (over: Partial<DrainStateSnapshot>): DrainStateSnapshot => ({
  phase: 'spawning',
  inFlight: [],
  merging: null,
  shipped: 0,
  skip: [],
  retries: {},
  agentPgids: [],
  ...over,
});

describe('diffPhases', () => {
  it('emits building → awaiting-merge → merging → merged across snapshots', () => {
    let prev = new Map<string, SlugPhase>();
    const seq: Array<Pick<DrainStateSnapshot, 'inFlight' | 'merging'>> = [
      { inFlight: [{ slug: 'a', phase: 'building' }], merging: null },
      { inFlight: [{ slug: 'a', phase: 'awaiting-merge' }], merging: null },
      { inFlight: [{ slug: 'a', phase: 'awaiting-merge' }], merging: 'a' },
      { inFlight: [], merging: null },
    ];
    const seen: Array<{ slug: string; phase: SlugPhase }> = [];
    for (const s of seq) {
      const d = diffPhases(prev, s);
      seen.push(...d.changes);
      prev = d.next;
    }
    expect(seen).toEqual([
      { slug: 'a', phase: 'building' },
      { slug: 'a', phase: 'awaiting-merge' },
      { slug: 'a', phase: 'merging' },
      { slug: 'a', phase: 'merged' },
    ]);
  });

  it('dedupes unchanged phases and never emits merged for a build-only disappearance', () => {
    const first = diffPhases(new Map(), {
      inFlight: [{ slug: 'a', phase: 'building' }],
      merging: null,
    });
    expect(first.changes).toEqual([{ slug: 'a', phase: 'building' }]);
    const second = diffPhases(first.next, {
      inFlight: [{ slug: 'a', phase: 'building' }],
      merging: null,
    });
    expect(second.changes).toEqual([]);
    // K=1 ship: slug leaves inFlight straight from `building` — no merged row
    // (only disappearance-after-merging means merged, spec Unit 3).
    const third = diffPhases(second.next, { inFlight: [], merging: null });
    expect(third.changes).toEqual([]);
    expect(third.next.size).toBe(0);
  });

  it('tracks independent slugs concurrently (K>1)', () => {
    const d = diffPhases(new Map(), {
      inFlight: [
        { slug: 'a', phase: 'building' },
        { slug: 'b', phase: 'awaiting-merge' },
      ],
      merging: 'b',
    });
    expect(d.changes).toEqual([
      { slug: 'a', phase: 'building' },
      { slug: 'b', phase: 'merging' },
    ]);
  });
});

describe('makePhaseTap', () => {
  it('appends phase rows with runId and delegates every snapshot to next', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-phase-'));
    const next = vi.fn();
    const tap = makePhaseTap(dir, 'run-1', next, () => '2026-07-03T10:00:00.000Z');
    tap(snap({ inFlight: [{ slug: 'a', phase: 'building' }] }));
    tap(snap({ inFlight: [{ slug: 'a', phase: 'building' }] })); // deduped — no new row
    const rows = readFileSync(join(dir, '.noldor', 'agent-events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      event: 'phase',
      ts: '2026-07-03T10:00:00.000Z',
      runner: '-',
      role: 'drain',
      site: 'drain.heartbeat',
      runId: 'run-1',
      slug: 'a',
      phase: 'building',
    });
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('never throws when .noldor is unwritable and still delegates (fail-open)', () => {
    const next = vi.fn();
    const tap = makePhaseTap('/dev/null/nope', 'run-1', next);
    expect(() => tap(snap({ inFlight: [{ slug: 'a', phase: 'building' }] }))).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
