// @tests: drain-startup-reconciliation-of-a-prior-dead-run
import { describe, expect, it, vi } from 'vitest';

import {
  parseWorktrees,
  reapOrphanAgents,
  reconcileOpenPrs,
  pruneShippedWorktrees,
  reconcileDeadRun,
  reportIsEmpty,
  type ReconcileDeps,
  type OpenPrView,
} from '../drain-reconcile.js';
import { assertQueueSourceSynced } from '../drain-io.js';
import type { DrainSource } from '../drain-source.js';
import type { DrainState } from '../drain-state.js';
import type { GitRunner } from '../salvage.js';

function deps(over: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    readDrainState: () => null,
    isAlive: () => false,
    killPgid: vi.fn(),
    syncMain: vi.fn(),
    assertSynced: vi.fn(),
    listOpenPrs: () => [],
    mergePr: vi.fn(async () => 'merged' as const),
    closePr: vi.fn(),
    listWorktrees: () => [],
    removeWorktree: vi.fn(),
    ...over,
  };
}

function source(prefix: 'fast/' | 'feat/', universe: string[]): DrainSource {
  return {
    id: prefix === 'fast/' ? 'roadmap' : 'plans',
    nextItem: () => null,
    parseAll: () => universe,
    gatePrompt: (s) => s,
    branchFor: (s) => `${prefix}${s}`,
  };
}

function state(over: Partial<DrainState>): DrainState {
  return {
    pid: 999,
    startedAt: '',
    phase: 'idle',
    inFlight: [],
    merging: null,
    currentSlug: null,
    shipped: 0,
    skip: [],
    retries: {},
    ...over,
  };
}

function pr(over: Partial<OpenPrView>): OpenPrView {
  return {
    number: 1,
    headRefName: 'fast/x',
    mergeStateStatus: 'CLEAN',
    mergedAt: null,
    state: 'OPEN',
    ...over,
  };
}

describe('parseWorktrees', () => {
  it('parses porcelain blocks, strips refs/heads/, handles detached entries', () => {
    const out = [
      'worktree /repo',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree /repo/.worktrees/foo',
      'HEAD def',
      'branch refs/heads/fast/foo',
      '',
      'worktree /repo/.worktrees/detached',
      'HEAD 123',
      'detached',
      '',
    ].join('\n');
    expect(parseWorktrees(out)).toEqual([
      { path: '/repo', branch: 'main' },
      { path: '/repo/.worktrees/foo', branch: 'fast/foo' },
      { path: '/repo/.worktrees/detached', branch: '' },
    ]);
  });
});

describe('reapOrphanAgents', () => {
  it('group-kills each pgid when the prior pid is dead', () => {
    const killPgid = vi.fn();
    const reaped = reapOrphanAgents(
      deps({
        readDrainState: () => state({ pid: 123, agentPgids: [777, 888] }),
        isAlive: (pid) => pid !== 123,
        killPgid,
      }),
    );
    expect(killPgid.mock.calls).toEqual([[777], [888]]);
    expect(reaped).toEqual([777, 888]);
  });

  it('does NOT kill when the prior pid is still alive', () => {
    const killPgid = vi.fn();
    const reaped = reapOrphanAgents(
      deps({
        readDrainState: () => state({ pid: 123, agentPgids: [777] }),
        isAlive: () => true,
        killPgid,
      }),
    );
    expect(killPgid).not.toHaveBeenCalled();
    expect(reaped).toEqual([]);
  });

  it('no prior state → no-op', () => {
    const killPgid = vi.fn();
    expect(reapOrphanAgents(deps({ readDrainState: () => null, killPgid }))).toEqual([]);
    expect(killPgid).not.toHaveBeenCalled();
  });

  it('dead pid but no recorded pgids → no kill', () => {
    const killPgid = vi.fn();
    reapOrphanAgents(
      deps({
        readDrainState: () => state({ pid: 1, agentPgids: undefined }),
        isAlive: () => false,
        killPgid,
      }),
    );
    expect(killPgid).not.toHaveBeenCalled();
  });

  it('dry-run reports would-reap without killing', () => {
    const killPgid = vi.fn();
    const reaped = reapOrphanAgents(
      deps({
        readDrainState: () => state({ pid: 1, agentPgids: [5] }),
        isAlive: () => false,
        killPgid,
      }),
      true,
    );
    expect(reaped).toEqual([5]);
    expect(killPgid).not.toHaveBeenCalled();
  });
});

describe('reconcileOpenPrs', () => {
  it('merges a CLEAN in-namespace PR and reports it under merged', async () => {
    const mergePr = vi.fn(async () => 'merged' as const);
    const r = await reconcileOpenPrs(
      deps({
        listOpenPrs: () => [pr({ headRefName: 'fast/foo', mergeStateStatus: 'CLEAN' })],
        mergePr,
      }),
      source('fast/', ['foo']),
    );
    expect(mergePr).toHaveBeenCalledWith('foo', 'fast/foo');
    expect(r).toEqual({ merged: ['foo'], closedDirty: [] });
  });

  it('closes a DIRTY PR and reports it under closedDirty (branch left for rebuild)', async () => {
    const closePr = vi.fn();
    const mergePr = vi.fn(async () => 'merged' as const);
    const r = await reconcileOpenPrs(
      deps({
        listOpenPrs: () => [pr({ headRefName: 'fast/bar', mergeStateStatus: 'DIRTY' })],
        closePr,
        mergePr,
      }),
      source('fast/', ['bar']),
    );
    expect(closePr).toHaveBeenCalledWith('fast/bar');
    expect(mergePr).not.toHaveBeenCalled();
    expect(r).toEqual({ merged: [], closedDirty: ['bar'] });
  });

  it('ignores PRs outside the source branch namespace', async () => {
    const mergePr = vi.fn(async () => 'merged' as const);
    const closePr = vi.fn();
    const r = await reconcileOpenPrs(
      deps({
        listOpenPrs: () => [
          pr({ headRefName: 'feat/other', mergeStateStatus: 'CLEAN' }), // plans-namespace, not ours
          pr({ headRefName: 'random-human-branch', mergeStateStatus: 'DIRTY' }),
        ],
        mergePr,
        closePr,
      }),
      source('fast/', []),
    );
    expect(mergePr).not.toHaveBeenCalled();
    expect(closePr).not.toHaveBeenCalled();
    expect(r).toEqual({ merged: [], closedDirty: [] });
  });

  it('never merges/closes an in-namespace PR whose slug is NOT in the universe (human fast-track)', async () => {
    const mergePr = vi.fn(async () => 'merged' as const);
    const closePr = vi.fn();
    const r = await reconcileOpenPrs(
      deps({
        listOpenPrs: () => [
          pr({ headRefName: 'fast/human-fix', mergeStateStatus: 'CLEAN' }), // fast/* but not a roadmap slug
          pr({ headRefName: 'fast/human-dirty', mergeStateStatus: 'DIRTY' }),
        ],
        mergePr,
        closePr,
      }),
      source('fast/', ['some-other-roadmap-slug']), // neither head's slug is in-universe
    );
    expect(mergePr).not.toHaveBeenCalled();
    expect(closePr).not.toHaveBeenCalled();
    expect(r).toEqual({ merged: [], closedDirty: [] });
  });

  it('is source-agnostic: feat/ namespace for plans source', async () => {
    const mergePr = vi.fn(async () => 'merged' as const);
    const r = await reconcileOpenPrs(
      deps({
        listOpenPrs: () => [pr({ headRefName: 'feat/plan-x', mergeStateStatus: 'CLEAN' })],
        mergePr,
      }),
      source('feat/', ['plan-x']),
    );
    expect(mergePr).toHaveBeenCalledWith('plan-x', 'feat/plan-x');
    expect(r.merged).toEqual(['plan-x']);
  });

  it('leaves a pending PR open when the bounded merge does not complete', async () => {
    const r = await reconcileOpenPrs(
      deps({
        listOpenPrs: () => [pr({ headRefName: 'fast/slow', mergeStateStatus: 'BLOCKED' })],
        mergePr: vi.fn(async () => 'merge-timeout' as const),
      }),
      source('fast/', ['slow']),
    );
    expect(r).toEqual({ merged: [], closedDirty: [] });
  });
});

describe('pruneShippedWorktrees', () => {
  it('removes a fast/<slug> worktree whose slug is absent from the universe', () => {
    const removeWorktree = vi.fn();
    const pruned = pruneShippedWorktrees(
      deps({
        listWorktrees: () => [{ path: '/repo/.worktrees/shipped', branch: 'fast/shipped' }],
        removeWorktree,
      }),
      source('fast/', []), // shipped → absent from universe
    );
    expect(removeWorktree).toHaveBeenCalledWith('shipped', 'fast/shipped');
    expect(pruned).toEqual(['shipped']);
  });

  it('keeps a still-in-universe slug', () => {
    const removeWorktree = vi.fn();
    const pruned = pruneShippedWorktrees(
      deps({
        listWorktrees: () => [{ path: '/repo/.worktrees/live', branch: 'fast/live' }],
        removeWorktree,
      }),
      source('fast/', ['live']),
    );
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(pruned).toEqual([]);
  });

  it('never touches a non-drain branch or a non-.worktrees path', () => {
    const removeWorktree = vi.fn();
    const pruned = pruneShippedWorktrees(
      deps({
        listWorktrees: () => [
          { path: '/repo', branch: 'main' },
          { path: '/repo/.claude/worktrees/human', branch: 'fast/human' }, // human worktree on same prefix
          { path: '/elsewhere/feat-thing', branch: 'feat/thing' }, // not our namespace
        ],
        removeWorktree,
      }),
      source('fast/', []),
    );
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(pruned).toEqual([]);
  });
});

describe('reconcileDeadRun', () => {
  it('clean startup: all-empty report, zero kill/merge/close/remove calls', async () => {
    const d = deps();
    const report = await reconcileDeadRun(d, source('fast/', []));
    expect(reportIsEmpty(report)).toBe(true);
    expect(report).toEqual({ reapedPgids: [], merged: [], closedDirty: [], prunedWorktrees: [] });
    expect(d.killPgid).not.toHaveBeenCalled();
    expect(d.mergePr).not.toHaveBeenCalled();
    expect(d.closePr).not.toHaveBeenCalled();
    expect(d.removeWorktree).not.toHaveBeenCalled();
    // sync + divergence pre-flight always run (non-dry).
    expect(d.syncMain).toHaveBeenCalledOnce();
    expect(d.assertSynced).toHaveBeenCalledOnce();
  });

  it('propagates an assertSynced throw (local-ahead → caller exits 1)', async () => {
    await expect(
      reconcileDeadRun(
        deps({
          assertSynced: () => {
            throw new Error('drain: local main is ahead');
          },
        }),
        source('fast/', []),
      ),
    ).rejects.toThrow(/ahead/);
  });

  it('dry-run never mutates and never syncs/asserts', async () => {
    const d = deps({
      readDrainState: () => state({ pid: 1, agentPgids: [9] }),
      isAlive: () => false,
      listOpenPrs: () => [pr({ headRefName: 'fast/dirty', mergeStateStatus: 'DIRTY' })],
      listWorktrees: () => [{ path: '/repo/.worktrees/gone', branch: 'fast/gone' }],
    });
    // 'dirty' is in-universe (open PR → close); 'gone' is out-of-universe (shipped worktree → prune).
    const report = await reconcileDeadRun(d, source('fast/', ['dirty']), true);
    expect(report.reapedPgids).toEqual([9]);
    expect(report.closedDirty).toEqual(['dirty']);
    expect(report.prunedWorktrees).toEqual(['gone']);
    expect(d.killPgid).not.toHaveBeenCalled();
    expect(d.closePr).not.toHaveBeenCalled();
    expect(d.removeWorktree).not.toHaveBeenCalled();
    expect(d.syncMain).not.toHaveBeenCalled();
    expect(d.assertSynced).not.toHaveBeenCalled();
  });
});

describe('assertQueueSourceSynced', () => {
  const runner =
    (count: string, log = ''): GitRunner =>
    (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      if (key.startsWith('git rev-list --count')) return { ok: true, stdout: count };
      if (key.startsWith('git log --oneline')) return { ok: true, stdout: log };
      return { ok: true, stdout: '' };
    };

  it('throws naming the commits when local main is ahead', () => {
    expect(() => assertQueueSourceSynced(runner('2\n', 'abc fix\ndef chore'))).toThrow(
      /ahead of origin\/main by 2 commit\(s\)/,
    );
  });

  it('passes silently when in sync (count 0)', () => {
    expect(() => assertQueueSourceSynced(runner('0\n'))).not.toThrow();
  });
});
