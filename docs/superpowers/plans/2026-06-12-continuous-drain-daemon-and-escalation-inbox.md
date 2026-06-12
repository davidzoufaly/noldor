# Continuous Drain Daemon and Escalation Inbox Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Make autonomy continuous: `noldor autonomous watch` wraps the existing `runDrain` loop in a scheduler (daemon or `--once` cron mode), auto-salvages stale `fast/<slug>` bases before spawn, parks item-scoped terminal failures into a CLI-readable escalation inbox (`.noldor/escalations.jsonl` + `.noldor/drain-park.json`), notifies via a consumer shell hook, and trips loudly on rails (daily cap, consecutive-failure trip, pause file).

**Architecture:** Pure decision cores + thin IO shells, mirroring `decideNext`/`runDrain`: `mapCycle` (escalation verdicts) and `applyCycleToState` (rails) are pure functions; `watch.ts` and `queue-drain.ts` wire them with injected deps. The loop (`drain-loop.ts`) gains only reason-recording and one optional dep (`salvageStaleBase`) — zero behavior change for existing callers. Park enforcement is a `DrainSource` decorator; no `runDrain` signature change.

**Tech Stack:** TypeScript (ESM, NodeNext), zod (config schema), vitest, `execFileSync`/`spawnSync` for git/gh (matching `drain-io.ts`).

---

## File Structure

- `src/core/agent-events.ts` — modify: optional `kind?`/`slug?` fields on `AgentEvent` (additive; `salvaged` event rides it)
- `src/autonomous/drain-loop.ts` — modify: optional `salvageStaleBase` dep; record `retries-exhausted` + `pr-open-unmerged` skip reasons (3 sites)
- `src/autonomous/salvage.ts` — create: stale-base detect + repair + `makeSalvage` production factory
- `src/autonomous/escalations.ts` — create: reason types, `mapCycle` pure core, park-map + JSONL IO shell, `parkAwareSource` decorator, inbox row join
- `src/autonomous/watch-state.ts` — create: `WatchState` load/save + `applyCycleToState` pure rails (trip rule, day rollover, pendingPr grace carry, run-abort dedup memory)
- `src/autonomous/notify.ts` — create: fail-open shell notify hook
- `src/autonomous/watch.ts` — create: `noldor autonomous watch` CLI entry (flags, lock, cycle loop, 130 disambiguation, sleep)
- `src/autonomous/inbox-cli.ts` — create: `noldor autonomous inbox [--json]`
- `src/autonomous/unpark-cli.ts` — create: `noldor autonomous unpark <slug> [--source <id>]`
- `src/autonomous/queue-drain.ts` — modify: wire `parkAwareSource` + `salvageStaleBase` + post-run `mapCycle` (`mode: 'run'`)
- `src/cr/config.ts` — modify: `watch` sub-schema on `autonomousConfigSchema`
- `src/cli/manifest.ts` — modify: `autonomous.watch` / `autonomous.inbox` / `autonomous.unpark` entries
- `docs/noldor/autonomy.md` — create: watch lifecycle, rails table, pause/trip runbook, salvage + notify contracts
- `docs/noldor/cr-pipeline.md` — modify: pointer to autonomy.md
- `docs/noldor/script-catalog.md` — modify: Autonomous commands table
- `docs/features/continuous-drain-daemon-and-escalation-inbox.md` — modify: `links` correction (real touched paths) + plan link
- `src/core/__tests__/agent-events.test.ts` — modify: optional-fields case
- `src/autonomous/__tests__/run-drain.test.ts` — modify: salvage-dep + skip-reason cases
- `src/autonomous/__tests__/salvage.test.ts` — create
- `src/autonomous/__tests__/escalations.test.ts` — create
- `src/autonomous/__tests__/watch-state.test.ts` — create
- `src/autonomous/__tests__/notify.test.ts` — create
- `src/autonomous/__tests__/watch-args.test.ts` — create

---

## Task 1: `AgentEvent` optional `kind`/`slug` fields

**Files:**
Modify: `src/core/agent-events.ts`
Test: `src/core/__tests__/agent-events.test.ts`

- [ ] **Step 1: Write the failing test** — append to the existing `describe` in `src/core/__tests__/agent-events.test.ts`:

```ts
  it('serializes optional kind and slug when present', () => {
    appendAgentEvent(dir, {
      ts: '2026-06-12T00:00:00.000Z',
      runner: 'drain',
      role: 'watch',
      kind: 'salvaged',
      slug: 'foo-bar',
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
    });
    const line = readFileSync(join(dir, '.noldor/agent-events.jsonl'), 'utf8').trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.kind).toBe('salvaged');
    expect(parsed.slug).toBe('foo-bar');
  });
```

(The file already imports `readFileSync`, `join`, and manages a temp `dir` — match its existing setup; if it names the temp variable differently, use that name.)

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/core/__tests__/agent-events.test.ts
```

Expected output: 1 failing test — TypeScript object-literal error or property assertion failure mentioning `kind`.

- [ ] **Step 3: Implement** — in `src/core/agent-events.ts`, extend the interface:

```ts
export interface AgentEvent {
  ts: string;
  runner: string;
  role: string;
  site?: string;
  /** Optional event vocabulary (e.g. 'salvaged'). The /agents roadmap entry formalizes it. */
  kind?: string;
  /** Slug the event concerns, when item-scoped. */
  slug?: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/core/__tests__/agent-events.test.ts
```

Expected output: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/agent-events.ts src/core/__tests__/agent-events.test.ts
git commit -m "feat(autonomous): additive kind/slug fields on AgentEvent for salvaged events" -m "Noldor-FD: continuous-drain-daemon-and-escalation-inbox"
```

---

## Task 2: drain-loop reason-recording + optional salvage dep

**Files:**
Modify: `src/autonomous/drain-loop.ts`
Test: `src/autonomous/__tests__/run-drain.test.ts`

- [ ] **Step 1: Write the failing tests** — append a new `describe` block at the end of `src/autonomous/__tests__/run-drain.test.ts`, reusing the file's `harness` and `optsOf` helpers (read the file first; `optsOf` is the existing options builder — if it's named differently, e.g. inline literals, mirror the file's existing call style for `runDrain(deps, {...})`):

```ts
describe('reason recording + salvage dep', () => {
  it('records retries-exhausted when a slug crosses maxRetries into skip', async () => {
    const h = harness(['a'], { ships: () => false });
    const res = await runDrain(h.deps, {
      maxFeatures: 5,
      maxRetries: 1,
      maxSpawns: 10,
      timeoutMs: 1000,
      dryRun: false,
      cwd: '/tmp',
      concurrency: 1,
      startupStaggerMs: 0,
    });
    expect(res.skipped).toEqual(['a']);
    expect(res.skipReasons).toEqual({ a: 'retries-exhausted' });
  });

  it('records pr-open-unmerged on the K=1 verdict branch (PR opened, oracle still sees slug)', async () => {
    let spawned = false;
    const h = harness(['a'], {
      ships: () => false,
      openPr: () => spawned, // no PR pre-spawn; PR exists at verdict time
    });
    const spawnGate = h.deps.spawnGate;
    h.deps.spawnGate = async (env, t, p) => {
      const code = await spawnGate(env, t, p);
      spawned = true;
      return code;
    };
    const res = await runDrain(h.deps, {
      maxFeatures: 5,
      maxRetries: 2,
      maxSpawns: 10,
      timeoutMs: 1000,
      dryRun: false,
      cwd: '/tmp',
      concurrency: 1,
      startupStaggerMs: 0,
    });
    expect(res.skipped).toEqual(['a']);
    expect(res.skipReasons).toEqual({ a: 'pr-open-unmerged' });
  });

  it('records pr-open-unmerged on the restart-safety guard (open PR at pickup)', async () => {
    const h = harness(['a'], { openPr: () => true });
    const res = await runDrain(h.deps, {
      maxFeatures: 5,
      maxRetries: 2,
      maxSpawns: 10,
      timeoutMs: 1000,
      dryRun: false,
      cwd: '/tmp',
      concurrency: 1,
      startupStaggerMs: 0,
    });
    expect(h.deps.spawnGate).not.toHaveBeenCalled();
    expect(res.skipReasons).toEqual({ a: 'pr-open-unmerged' });
  });

  it('calls salvageStaleBase before each spawn and aborts the drain when it throws', async () => {
    const calls: string[] = [];
    const h1 = harness(['a']);
    h1.deps.salvageStaleBase = (slug: string, branch: string) => {
      calls.push(`${slug}|${branch}`);
      return 'salvaged' as const;
    };
    const res1 = await runDrain(h1.deps, {
      maxFeatures: 5,
      maxRetries: 2,
      maxSpawns: 10,
      timeoutMs: 1000,
      dryRun: false,
      cwd: '/tmp',
      concurrency: 1,
      startupStaggerMs: 0,
    });
    expect(res1.shipped).toBe(1);
    expect(calls).toEqual(['a|fast/a']);

    const h2 = harness(['b']);
    h2.deps.salvageStaleBase = () => {
      throw new Error('gh exploded');
    };
    const res2 = await runDrain(h2.deps, {
      maxFeatures: 5,
      maxRetries: 2,
      maxSpawns: 10,
      timeoutMs: 1000,
      dryRun: false,
      cwd: '/tmp',
      concurrency: 1,
      startupStaggerMs: 0,
    });
    expect(res2.exitCode).toBe(1);
    expect(res2.error).toBe('gh exploded');
  });

  it('does NOT call salvageStaleBase in dry-run', async () => {
    const salvage = vi.fn(() => 'clean' as const);
    const h = harness(['a']);
    h.deps.salvageStaleBase = salvage;
    await runDrain(h.deps, {
      maxFeatures: 5,
      maxRetries: 2,
      maxSpawns: 10,
      timeoutMs: 1000,
      dryRun: true,
      cwd: '/tmp',
      concurrency: 1,
      startupStaggerMs: 0,
    });
    expect(salvage).not.toHaveBeenCalled();
  });
});
```

(If `harness` returns `deps` as a frozen/typed literal that rejects assigning `salvageStaleBase`, widen the local variable: `const deps: DrainDeps = { ...h.deps, salvageStaleBase: ... }` and pass `deps`.)

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/autonomous/__tests__/run-drain.test.ts
```

Expected output: the new describe fails — `skipReasons` undefined / unknown property `salvageStaleBase`.

- [ ] **Step 3: Implement** — in `src/autonomous/drain-loop.ts`:

3a. Add the optional dep to `DrainDeps` (after `openPrExistsFor`):

```ts
  /** Optional pre-spawn clean-room: detect + repair a stale `fast/<slug>` base (leftover local/remote
   *  branch or closed-unmerged PR) before the gate child spawns. Throws → systemic abort (fail-closed,
   *  like the other git/gh deps). Absent → no salvage (existing behavior). */
  salvageStaleBase?: (slug: string, branch: string) => 'clean' | 'salvaged';
```

3b. `recordRetryOrSkip` records the reason at the skip transition:

```ts
  const recordRetryOrSkip = (slug: string): void => {
    const n = (retries.get(slug) ?? 0) + 1;
    retries.set(slug, n);
    if (n > opts.maxRetries) {
      skip.add(slug);
      skipReasons[slug] = 'retries-exhausted';
    }
  };
```

3c. K=1 verdict branch in `settleShipVerdict` — replace the two lines of the `openPrExistsFor` arm:

```ts
      if (deps.openPrExistsFor(slug, branch)) {
        skip.add(slug); // PR landed in-flight; never re-spawn a duplicate
        skipReasons[slug] = 'pr-open-unmerged';
        return false;
      }
```

3d. Worker restart-safety guard — replace the body of the `if (deps.openPrExistsFor(candidate.slug, branch))` block:

```ts
      if (deps.openPrExistsFor(candidate.slug, branch)) {
        skip.add(candidate.slug); // restart-safety: a prior run's PR is in-flight
        skipReasons[candidate.slug] = 'pr-open-unmerged';
        continue;
      }
```

3e. Salvage call — inside the worker's existing `try`, immediately before `deps.spawnGate(...)`:

```ts
      let handedToCoordinator = false;
      try {
        deps.salvageStaleBase?.(candidate.slug, branch);
        const code = await deps.spawnGate(
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/autonomous/__tests__/run-drain.test.ts
```

Expected output: all tests pass (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-loop.ts src/autonomous/__tests__/run-drain.test.ts
git commit -m "feat(autonomous): record terminal skip reasons + optional pre-spawn salvage dep in drain loop" -m "Noldor-FD: continuous-drain-daemon-and-escalation-inbox"
```

---

## Task 3: `salvage.ts` — detect + repair + factory

**Files:**
Create: `src/autonomous/salvage.ts`
Test: `src/autonomous/__tests__/salvage.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/autonomous/__tests__/salvage.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { detectStale, repair, type GitRunner } from '../salvage.js';

/** Scripted runner: maps "cmd arg arg" prefixes to results. Unmatched → ok:true, ''. */
function runner(script: Record<string, { ok: boolean; stdout: string }>): GitRunner {
  return (cmd, args) => {
    const key = [cmd, ...args].join(' ');
    for (const [prefix, res] of Object.entries(script)) {
      if (key.startsWith(prefix)) return res;
    }
    return { ok: true, stdout: '' };
  };
}

describe('detectStale', () => {
  it('flags a local branch whose base is behind origin/main', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: true, stdout: 'abc\n' },
      'git merge-base --is-ancestor origin/main fast/x': { ok: false, stdout: '' },
      'gh pr list': { ok: true, stdout: '[]' },
      'git ls-remote --heads origin fast/x': { ok: true, stdout: '' },
    });
    expect(detectStale(run, 'fast/x')).toEqual(['local-branch-behind-main']);
  });

  it('flags a closed-unmerged PR', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: false, stdout: '' },
      'gh pr list': { ok: true, stdout: '[{"mergedAt":null}]' },
      'git ls-remote --heads origin fast/x': { ok: true, stdout: '' },
    });
    expect(detectStale(run, 'fast/x')).toEqual(['closed-unmerged-pr']);
  });

  it('ignores a closed PR that was merged', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: false, stdout: '' },
      'gh pr list': { ok: true, stdout: '[{"mergedAt":"2026-06-11T00:00:00Z"}]' },
      'git ls-remote --heads origin fast/x': { ok: true, stdout: '' },
    });
    expect(detectStale(run, 'fast/x')).toEqual([]);
  });

  it('flags an orphan remote branch', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: false, stdout: '' },
      'gh pr list': { ok: true, stdout: '[]' },
      'git ls-remote --heads origin fast/x': { ok: true, stdout: 'def refs/heads/fast/x\n' },
    });
    expect(detectStale(run, 'fast/x')).toEqual(['orphan-remote-branch']);
  });

  it('reports a current-base local branch with no PR as clean (child force-recreate owns it)', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: true, stdout: 'abc\n' },
      'git merge-base --is-ancestor origin/main fast/x': { ok: true, stdout: '' },
      'gh pr list': { ok: true, stdout: '[]' },
      'git ls-remote --heads origin fast/x': { ok: true, stdout: '' },
    });
    expect(detectStale(run, 'fast/x')).toEqual([]);
  });

  it('throws when gh output is not parseable JSON (fail-closed)', () => {
    const run = runner({
      'git rev-parse --verify fast/x': { ok: false, stdout: '' },
      'gh pr list': { ok: true, stdout: 'not json' },
    });
    expect(() => detectStale(run, 'fast/x')).toThrow();
  });
});

describe('repair', () => {
  it('removes worktree, local branch, and remote branch (best-effort each)', () => {
    const calls: string[] = [];
    const run: GitRunner = (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { ok: false, stdout: '' }; // every step failing must not throw
    };
    repair(run, 'foo');
    expect(calls).toEqual([
      'git worktree remove --force .worktrees/foo',
      'git branch -D fast/foo',
      'git push origin --delete fast/foo',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/autonomous/__tests__/salvage.test.ts
```

Expected output: module not found `../salvage.js`.

- [ ] **Step 3: Implement** — create `src/autonomous/salvage.ts`:

```ts
import { spawnSync } from 'node:child_process';

import { appendAgentEvent } from '../core/agent-events.js';

/** Injected process runner: ok=false on nonzero exit. Production uses spawnSync; tests script it. */
export type GitRunner = (cmd: string, args: string[]) => { ok: boolean; stdout: string };

export type StaleReason = 'local-branch-behind-main' | 'closed-unmerged-pr' | 'orphan-remote-branch';

/**
 * Classify provably-wedging leftover state for the drain's own branch (spec Unit 2).
 * Called after the worker's open-PR guard, so "no open PR" is already guaranteed.
 * A current-base local branch with no PR is NOT stale — the gate child's
 * force-recreate owns that case. gh JSON parse failure throws (fail-closed:
 * guessing "clean" could re-wedge the very case salvage exists to fix).
 */
export function detectStale(run: GitRunner, branch: string): StaleReason[] {
  const reasons: StaleReason[] = [];
  const local = run('git', ['rev-parse', '--verify', branch]);
  if (local.ok) {
    const ancestor = run('git', ['merge-base', '--is-ancestor', 'origin/main', branch]);
    if (!ancestor.ok) reasons.push('local-branch-behind-main');
  }
  const prs = run('gh', [
    'pr',
    'list',
    '--state',
    'closed',
    '--head',
    branch,
    '--json',
    'mergedAt',
  ]);
  const rows = JSON.parse(prs.stdout || '[]') as Array<{ mergedAt: string | null }>;
  if (rows.some((r) => r.mergedAt === null)) reasons.push('closed-unmerged-pr');
  const remote = run('git', ['ls-remote', '--heads', 'origin', branch]);
  if (remote.stdout.trim() !== '') reasons.push('orphan-remote-branch');
  return reasons;
}

/**
 * Clean room for one slug: worktree dir, local branch, remote branch — each
 * best-effort (already-gone is fine). Closed PRs are left as history.
 * Branch is always the drain's own `fast/<slug>` namespace (see autonomy.md
 * for the namespace-collision caveat).
 */
export function repair(run: GitRunner, slug: string): void {
  run('git', ['worktree', 'remove', '--force', `.worktrees/${slug}`]);
  run('git', ['branch', '-D', `fast/${slug}`]);
  run('git', ['push', 'origin', '--delete', `fast/${slug}`]);
}

/** Production runner bound to cwd. */
function spawnRunner(cwd: string): GitRunner {
  return (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: r.status === 0, stdout: r.stdout ?? '' };
  };
}

/**
 * Production `DrainDeps.salvageStaleBase`. Detects, repairs, and appends a
 * `salvaged` agent-event (fail-open by appendAgentEvent's contract). Detection
 * errors propagate — the loop treats a thrown dep as a systemic abort.
 */
export function makeSalvage(cwd: string): (slug: string, branch: string) => 'clean' | 'salvaged' {
  const run = spawnRunner(cwd);
  return (slug, branch) => {
    const started = Date.now();
    const reasons = detectStale(run, branch);
    if (reasons.length === 0) return 'clean';
    repair(run, slug);
    appendAgentEvent(cwd, {
      ts: new Date().toISOString(),
      runner: 'drain',
      role: 'watch',
      kind: 'salvaged',
      slug,
      site: reasons.join(','),
      exitCode: 0,
      durationMs: Date.now() - started,
      timedOut: false,
    });
    return 'salvaged';
  };
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/autonomous/__tests__/salvage.test.ts
```

Expected output: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/salvage.ts src/autonomous/__tests__/salvage.test.ts
git commit -m "feat(autonomous): stale-base salvage module (detect, repair, salvaged event)" -m "Noldor-FD: continuous-drain-daemon-and-escalation-inbox"
```

---

## Task 4: `escalations.ts` — pure `mapCycle` core

**Files:**
Create: `src/autonomous/escalations.ts`
Test: `src/autonomous/__tests__/escalations.test.ts`

- [ ] **Step 1: Write the failing tests** — create `src/autonomous/__tests__/escalations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapCycle, parkKey, type ParkMap } from '../escalations.js';
import type { DrainResult } from '../drain-loop.js';

const NOW = '2026-06-12T10:00:00.000Z';

function result(over: Partial<DrainResult> = {}): DrainResult {
  return { shipped: 0, skipped: [], exitCode: 0, ...over };
}

function input(over: Partial<Parameters<typeof mapCycle>[0]> = {}): Parameters<typeof mapCycle>[0] {
  return {
    result: result(),
    mode: 'watch',
    source: 'roadmap',
    parked: {} as ParkMap,
    pendingPr: [],
    queueUniverse: [],
    now: NOW,
    ...over,
  };
}

describe('mapCycle', () => {
  it('parks retries-exhausted immediately with an escalation row', () => {
    const v = mapCycle(
      input({
        result: result({ skipped: ['a'], skipReasons: { a: 'retries-exhausted' } }),
        queueUniverse: ['a'],
      }),
    );
    expect(v.toPark).toEqual([{ slug: 'a', reason: 'retries-exhausted' }]);
    expect(v.escalations).toHaveLength(1);
    expect(v.escalations[0]).toMatchObject({
      ts: NOW,
      slug: 'a',
      source: 'roadmap',
      reason: 'retries-exhausted',
    });
  });

  it('maps both coordinator outcome strings to their reasons', () => {
    const v = mapCycle(
      input({
        result: result({
          skipped: ['a', 'b'],
          skipReasons: {
            a: 'merge-conflict — PR left open for human resolution',
            b: 'merge-timeout — PR left open for human resolution',
          },
        }),
        queueUniverse: ['a', 'b'],
      }),
    );
    expect(v.toPark).toEqual([
      { slug: 'a', reason: 'merge-conflict' },
      { slug: 'b', reason: 'merge-timeout' },
    ]);
  });

  it('gives pr-open-unmerged a one-cycle grace in watch mode', () => {
    const first = mapCycle(
      input({
        result: result({ skipped: ['a'], skipReasons: { a: 'pr-open-unmerged' } }),
        queueUniverse: ['a'],
      }),
    );
    expect(first.toPark).toEqual([]);
    expect(first.escalations).toEqual([]);
    expect(first.nextPendingPr).toEqual(['a']);

    const second = mapCycle(
      input({
        result: result({ skipped: ['a'], skipReasons: { a: 'pr-open-unmerged' } }),
        pendingPr: ['a'],
        queueUniverse: ['a'],
      }),
    );
    expect(second.toPark).toEqual([{ slug: 'a', reason: 'pr-open-unmerged' }]);
    expect(second.nextPendingPr).toEqual([]);
  });

  it('drops a pendingPr slug that stops reporting (self-clean)', () => {
    const v = mapCycle(input({ pendingPr: ['gone'], queueUniverse: ['gone'] }));
    expect(v.nextPendingPr).toEqual([]);
  });

  it('never parks pr-open-unmerged in run mode', () => {
    const v = mapCycle(
      input({
        mode: 'run',
        result: result({ skipped: ['a'], skipReasons: { a: 'pr-open-unmerged' } }),
        queueUniverse: ['a'],
      }),
    );
    expect(v.toPark).toEqual([]);
    expect(v.escalations).toEqual([]);
    expect(v.nextPendingPr).toEqual([]);
  });

  it('emits run-aborted without parking; dedupes identical error streaks in watch mode', () => {
    const aborted = result({ exitCode: 1, error: 'ff-only rejected' });
    const first = mapCycle(input({ result: aborted }));
    expect(first.escalations).toHaveLength(1);
    expect(first.escalations[0]!.reason).toBe('run-aborted');
    expect(first.toPark).toEqual([]);
    expect(first.nextRunAbortError).toBe('ff-only rejected');

    const second = mapCycle(input({ result: aborted, prevRunAbortError: 'ff-only rejected' }));
    expect(second.escalations).toEqual([]);

    const runMode = mapCycle(
      input({ mode: 'run', result: aborted, prevRunAbortError: 'ff-only rejected' }),
    );
    expect(runMode.escalations).toHaveLength(1); // one-shot run always appends
  });

  it('never re-escalates an already-parked composite key, but a different source does', () => {
    const parked: ParkMap = { [parkKey('roadmap', 'a')]: { reason: 'retries-exhausted', ts: 't' } };
    const sameSource = mapCycle(
      input({
        parked,
        result: result({ skipped: ['a'], skipReasons: { a: 'retries-exhausted' } }),
        queueUniverse: ['a'],
      }),
    );
    expect(sameSource.toPark).toEqual([]);
    expect(sameSource.escalations).toEqual([]);

    const otherSource = mapCycle(
      input({
        source: 'plans',
        parked,
        result: result({ skipped: ['a'], skipReasons: { a: 'retries-exhausted' } }),
        queueUniverse: ['a'],
      }),
    );
    expect(otherSource.toPark).toEqual([{ slug: 'a', reason: 'retries-exhausted' }]);
  });

  it('auto-resolves parked entries absent from the matching source universe only', () => {
    const parked: ParkMap = {
      [parkKey('roadmap', 'merged')]: { reason: 'retries-exhausted', ts: 't' },
      [parkKey('roadmap', 'alive')]: { reason: 'merge-conflict', ts: 't' },
      [parkKey('plans', 'other')]: { reason: 'retries-exhausted', ts: 't' },
    };
    const v = mapCycle(input({ parked, queueUniverse: ['alive'] }));
    expect(v.toUnpark).toEqual([parkKey('roadmap', 'merged')]);
  });

  it('ignores ineligible-skip reasons entirely', () => {
    const v = mapCycle(
      input({
        result: result({
          skipped: ['a'],
          skipReasons: { a: 'not a fast-track XS/S entry (roadmap source ships fast-track only)' },
        }),
        queueUniverse: ['a'],
      }),
    );
    expect(v.toPark).toEqual([]);
    expect(v.escalations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/autonomous/__tests__/escalations.test.ts
```

Expected output: module not found `../escalations.js`.

- [ ] **Step 3: Implement the pure core** — create `src/autonomous/escalations.ts`:

```ts
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
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
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/autonomous/__tests__/escalations.test.ts
```

Expected output: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/escalations.ts src/autonomous/__tests__/escalations.test.ts
git commit -m "feat(autonomous): pure mapCycle escalation core (park, grace, auto-resolve, dedup)" -m "Noldor-FD: continuous-drain-daemon-and-escalation-inbox"
```

---

## Task 5: escalations IO shell + `parkAwareSource` + inbox join

**Files:**
Modify: `src/autonomous/escalations.ts`
Test: `src/autonomous/__tests__/escalations.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `src/autonomous/__tests__/escalations.test.ts` (extend the import line to include the new symbols):

```ts
import { mkdtempSync, rmSync, readFileSync as readFs, mkdirSync as mkDir, writeFileSync as writeFs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import {
  applyCycleVerdict,
  loadPark,
  parkAwareSource,
  readInboxRows,
  unparkSlug,
} from '../escalations.js';
import type { DrainSource } from '../drain-source.js';

describe('IO shell', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(joinPath(tmpdir(), 'esc-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('applyCycleVerdict appends rows, parks, and auto-unparks with resolution lines', () => {
    mkDir(joinPath(dir, '.noldor'), { recursive: true });
    writeFs(
      joinPath(dir, '.noldor/drain-park.json'),
      JSON.stringify({ 'roadmap:old': { reason: 'retries-exhausted', ts: 't0' } }),
      'utf8',
    );
    applyCycleVerdict(dir, 'roadmap', {
      escalations: [
        {
          ts: 't1',
          slug: 'a',
          source: 'roadmap',
          reason: 'retries-exhausted',
          evidence: 'e',
          stateSnapshot: { shipped: 0, skipped: ['a'] },
          suggestedAction: 's',
        },
      ],
      toPark: [{ slug: 'a', reason: 'retries-exhausted' }],
      toUnpark: ['roadmap:old'],
      nextPendingPr: [],
    });
    const park = loadPark(dir);
    expect(park['roadmap:a']).toMatchObject({ reason: 'retries-exhausted' });
    expect(park['roadmap:old']).toBeUndefined();
    const lines = readFs(joinPath(dir, '.noldor/escalations.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ slug: 'a', reason: 'retries-exhausted' });
    expect(lines[1]).toMatchObject({ slug: 'old', source: 'roadmap', resolved: true, auto: true });
  });

  it('loadPark returns {} on missing or corrupt file (fail-open)', () => {
    expect(loadPark(dir)).toEqual({});
    mkDir(joinPath(dir, '.noldor'), { recursive: true });
    writeFs(joinPath(dir, '.noldor/drain-park.json'), 'garbage', 'utf8');
    expect(loadPark(dir)).toEqual({});
  });

  it('readInboxRows joins each parked entry to its earliest unresolved escalation line', () => {
    mkDir(joinPath(dir, '.noldor'), { recursive: true });
    writeFs(
      joinPath(dir, '.noldor/drain-park.json'),
      JSON.stringify({ 'roadmap:a': { reason: 'retries-exhausted', ts: 't2' } }),
      'utf8',
    );
    const mk = (ts: string, evidence: string): string =>
      JSON.stringify({
        ts,
        slug: 'a',
        source: 'roadmap',
        reason: 'retries-exhausted',
        evidence,
        stateSnapshot: { shipped: 0, skipped: [] },
        suggestedAction: 's',
      });
    writeFs(
      joinPath(dir, '.noldor/escalations.jsonl'),
      `${mk('t1', 'first')}\n${mk('t2', 'second')}\n`,
      'utf8',
    );
    const rows = readInboxRows(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: 'a', source: 'roadmap', evidence: 'first' });
  });

  it('unparkSlug resolves unique slug, demands --source on ambiguity, is idempotent', () => {
    mkDir(joinPath(dir, '.noldor'), { recursive: true });
    writeFs(
      joinPath(dir, '.noldor/drain-park.json'),
      JSON.stringify({
        'roadmap:a': { reason: 'retries-exhausted', ts: 't' },
        'plans:a': { reason: 'retries-exhausted', ts: 't' },
        'roadmap:b': { reason: 'merge-conflict', ts: 't' },
      }),
      'utf8',
    );
    expect(unparkSlug(dir, 'a').status).toBe('ambiguous');
    expect(unparkSlug(dir, 'a', 'plans').status).toBe('resolved');
    expect(loadPark(dir)['plans:a']).toBeUndefined();
    expect(unparkSlug(dir, 'b').status).toBe('resolved');
    expect(unparkSlug(dir, 'missing').status).toBe('not-parked');
    const lines = readFs(joinPath(dir, '.noldor/escalations.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2); // two resolution lines, none for the no-op
  });
});

describe('parkAwareSource', () => {
  it('adds matching-source parked slugs to the exclude set; parseAll untouched', () => {
    let seen: ReadonlySet<string> = new Set();
    const inner: DrainSource = {
      id: 'roadmap',
      nextItem(skip) {
        seen = skip;
        return null;
      },
      parseAll: () => ['a', 'b'],
      gatePrompt: () => '/gate',
      branchFor: (s) => `fast/${s}`,
    };
    const parked: ParkMap = {
      'roadmap:a': { reason: 'retries-exhausted', ts: 't' },
      'plans:b': { reason: 'retries-exhausted', ts: 't' },
    };
    const src = parkAwareSource(inner, () => parked);
    src.nextItem(new Set(['z']));
    expect([...seen].toSorted()).toEqual(['a', 'z']);
    expect(src.parseAll()).toEqual(['a', 'b']);
    expect(src.id).toBe('roadmap');
    expect(src.branchFor('a')).toBe('fast/a');
  });
});
```

Also extend the vitest import at the top of the file to `import { describe, expect, it, beforeEach, afterEach } from 'vitest';`.

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/autonomous/__tests__/escalations.test.ts
```

Expected output: import errors — `applyCycleVerdict` etc. not exported.

- [ ] **Step 3: Implement the shell** — append to `src/autonomous/escalations.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/autonomous/__tests__/escalations.test.ts
```

Expected output: all tests pass (9 pure + 6 shell/decorator).

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/escalations.ts src/autonomous/__tests__/escalations.test.ts
git commit -m "feat(autonomous): escalation IO shell, park-aware source decorator, inbox join, unpark" -m "Noldor-FD: continuous-drain-daemon-and-escalation-inbox"
```

---

## Task 6: `watch-state.ts` — rails state + trip rule

**Files:**
Create: `src/autonomous/watch-state.ts`
Test: `src/autonomous/__tests__/watch-state.test.ts`

- [ ] **Step 1: Write the failing tests** — create `src/autonomous/__tests__/watch-state.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCycleToState, loadWatchState, saveWatchState, type WatchState } from '../watch-state.js';
import type { DrainResult } from '../drain-loop.js';

const RAILS = { maxFeaturesPerDay: 10, maxConsecutiveFailures: 3 };

function state(over: Partial<WatchState> = {}): WatchState {
  return {
    dayKey: '2026-06-12',
    shippedToday: 0,
    consecutiveFailures: 0,
    lastCycleAt: '',
    pendingPr: [],
    ...over,
  };
}

function res(over: Partial<DrainResult> = {}): DrainResult {
  return { shipped: 0, skipped: [], exitCode: 0, ...over };
}

describe('applyCycleToState', () => {
  it('increments consecutiveFailures on abort and on 0-ship cycles with new escalations', () => {
    const a = applyCycleToState(state(), res({ exitCode: 1 }), 0, RAILS, '2026-06-12T01:00:00Z');
    expect(a.state.consecutiveFailures).toBe(1);
    const b = applyCycleToState(state(), res(), 2, RAILS, '2026-06-12T01:00:00Z');
    expect(b.state.consecutiveFailures).toBe(1);
  });

  it('resets on a shipping cycle and on a clean zero-failure cycle', () => {
    const shipped = applyCycleToState(
      state({ consecutiveFailures: 2 }),
      res({ shipped: 1 }),
      0,
      RAILS,
      '2026-06-12T01:00:00Z',
    );
    expect(shipped.state.consecutiveFailures).toBe(0);
    const clean = applyCycleToState(
      state({ consecutiveFailures: 2 }),
      res(),
      0,
      RAILS,
      '2026-06-12T01:00:00Z',
    );
    expect(clean.state.consecutiveFailures).toBe(0);
  });

  it('exit-130 is neutral unless it shipped', () => {
    const neutral = applyCycleToState(
      state({ consecutiveFailures: 2 }),
      res({ exitCode: 130 }),
      0,
      RAILS,
      '2026-06-12T01:00:00Z',
    );
    expect(neutral.state.consecutiveFailures).toBe(2);
    const shipped = applyCycleToState(
      state({ consecutiveFailures: 2 }),
      res({ exitCode: 130, shipped: 1 }),
      0,
      RAILS,
      '2026-06-12T01:00:00Z',
    );
    expect(shipped.state.consecutiveFailures).toBe(0);
  });

  it('trips at maxConsecutiveFailures and caps at maxFeaturesPerDay', () => {
    const tripped = applyCycleToState(
      state({ consecutiveFailures: 2 }),
      res({ exitCode: 1 }),
      0,
      RAILS,
      '2026-06-12T01:00:00Z',
    );
    expect(tripped.tripped).toBe(true);
    const capped = applyCycleToState(
      state({ shippedToday: 9 }),
      res({ shipped: 1 }),
      0,
      RAILS,
      '2026-06-12T01:00:00Z',
    );
    expect(capped.capped).toBe(true);
    expect(capped.state.shippedToday).toBe(10);
  });
});

describe('loadWatchState / saveWatchState', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'watch-state-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults on missing file and rolls shippedToday over on a new day', () => {
    const fresh = loadWatchState(dir, '2026-06-12');
    expect(fresh).toEqual({
      dayKey: '2026-06-12',
      shippedToday: 0,
      consecutiveFailures: 0,
      lastCycleAt: '',
      pendingPr: [],
    });
    saveWatchState(dir, { ...fresh, shippedToday: 7, consecutiveFailures: 1 });
    const sameDay = loadWatchState(dir, '2026-06-12');
    expect(sameDay.shippedToday).toBe(7);
    const nextDay = loadWatchState(dir, '2026-06-13');
    expect(nextDay.dayKey).toBe('2026-06-13');
    expect(nextDay.shippedToday).toBe(0);
    expect(nextDay.consecutiveFailures).toBe(1); // only the daily counter rolls
  });

  it('fail-open on corrupt file', () => {
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    writeFileSync(join(dir, '.noldor/watch-state.json'), '!!!', 'utf8');
    expect(loadWatchState(dir, '2026-06-12').shippedToday).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/autonomous/__tests__/watch-state.test.ts
```

Expected output: module not found `../watch-state.js`.

- [ ] **Step 3: Implement** — create `src/autonomous/watch-state.ts`:

```ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { DrainResult } from './drain-loop.js';

export interface WatchState {
  dayKey: string;
  shippedToday: number;
  consecutiveFailures: number;
  lastCycleAt: string;
  /** pr-open-unmerged grace carry-over (spec Unit 3). */
  pendingPr: string[];
  /** run-aborted streak dedup memory (spec Unit 3). */
  lastRunAbortError?: string;
  pausedReason?: string;
}

export interface WatchRails {
  maxFeaturesPerDay: number;
  maxConsecutiveFailures: number;
}

const STATE_REL = '.noldor/watch-state.json';

/** Load watch state, defaulting on missing/corrupt file; roll the daily counter on a new dayKey. */
export function loadWatchState(cwd: string, todayKey: string): WatchState {
  let s: WatchState = {
    dayKey: todayKey,
    shippedToday: 0,
    consecutiveFailures: 0,
    lastCycleAt: '',
    pendingPr: [],
  };
  try {
    const raw = JSON.parse(readFileSync(join(cwd, STATE_REL), 'utf8')) as Partial<WatchState>;
    s = {
      dayKey: raw.dayKey ?? todayKey,
      shippedToday: raw.shippedToday ?? 0,
      consecutiveFailures: raw.consecutiveFailures ?? 0,
      lastCycleAt: raw.lastCycleAt ?? '',
      pendingPr: raw.pendingPr ?? [],
      ...(raw.lastRunAbortError !== undefined ? { lastRunAbortError: raw.lastRunAbortError } : {}),
      ...(raw.pausedReason !== undefined ? { pausedReason: raw.pausedReason } : {}),
    };
  } catch {
    /* fail-open: rails reset, never crash */
  }
  if (s.dayKey !== todayKey) {
    s = { ...s, dayKey: todayKey, shippedToday: 0 };
  }
  return s;
}

/** Best-effort write, mirroring drain-state.ts. */
export function saveWatchState(cwd: string, state: WatchState): void {
  try {
    mkdirSync(join(cwd, '.noldor'), { recursive: true });
    writeFileSync(join(cwd, STATE_REL), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch (err) {
    process.stderr.write(`watch-state write failed (non-fatal): ${String(err)}\n`);
  }
}

/**
 * Pure rails arithmetic for one finished cycle (spec Unit 5 trip rule, in order):
 * exit 130 → unchanged unless it shipped (then reset); exit 1 or 0-ships-with-new-escalations
 * → increment; otherwise reset. Daily counter always accumulates.
 */
export function applyCycleToState(
  state: WatchState,
  result: DrainResult,
  newEscalations: number,
  rails: WatchRails,
  now: string,
): { state: WatchState; tripped: boolean; capped: boolean } {
  let consecutiveFailures = state.consecutiveFailures;
  if (result.exitCode === 130) {
    if (result.shipped > 0) consecutiveFailures = 0;
  } else if (result.exitCode === 1 || (result.shipped === 0 && newEscalations > 0)) {
    consecutiveFailures += 1;
  } else {
    consecutiveFailures = 0;
  }
  const shippedToday = state.shippedToday + result.shipped;
  const next: WatchState = { ...state, consecutiveFailures, shippedToday, lastCycleAt: now };
  return {
    state: next,
    tripped: consecutiveFailures >= rails.maxConsecutiveFailures,
    capped: shippedToday >= rails.maxFeaturesPerDay,
  };
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/autonomous/__tests__/watch-state.test.ts
```

Expected output: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/watch-state.ts src/autonomous/__tests__/watch-state.test.ts
git commit -m "feat(autonomous): watch state with day rollover and pure trip/cap rails" -m "Noldor-FD: continuous-drain-daemon-and-escalation-inbox"
```

---

## Task 7: `notify.ts` — fail-open shell hook

**Files:**
Create: `src/autonomous/notify.ts`
Test: `src/autonomous/__tests__/notify.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/autonomous/__tests__/notify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notify } from '../notify.js';

describe('notify', () => {
  it('no-ops when command is undefined', () => {
    expect(() => notify(undefined, 'cycle-summary', { shipped: 1 }, '/tmp')).not.toThrow();
  });

  it('runs the command with NOLDOR_NOTIFY_KIND and NOLDOR_NOTIFY_JSON env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'notify-'));
    try {
      notify(
        `printf '%s|%s' "$NOLDOR_NOTIFY_KIND" "$NOLDOR_NOTIFY_JSON" > ${dir}/out.txt`,
        'escalation',
        { slug: 'a' },
        dir,
      );
      const out = readFileSync(join(dir, 'out.txt'), 'utf8');
      expect(out).toBe('escalation|{"slug":"a"}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('swallows a failing command (fail-open)', () => {
    expect(() => notify('exit 7', 'watcher-tripped', {}, '/tmp')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/autonomous/__tests__/notify.test.ts
```

Expected output: module not found `../notify.js`.

- [ ] **Step 3: Implement** — create `src/autonomous/notify.ts`:

```ts
import { spawnSync } from 'node:child_process';

export type NotifyKind = 'escalation' | 'cycle-summary' | 'watcher-tripped';

/**
 * Pluggable consumer notification hook (spec Unit 4). POSIX-only by
 * construction (bash -c), consistent with syncMainCleanState. Fail-open:
 * 10s timeout, every failure logged to stderr and swallowed — notification
 * must never block or kill the loop (appendAgentEvent's contract).
 */
export function notify(
  command: string | undefined,
  kind: NotifyKind,
  payload: unknown,
  cwd: string,
): void {
  if (command === undefined || command === '') return;
  try {
    const r = spawnSync('bash', ['-c', command], {
      cwd,
      timeout: 10_000,
      stdio: 'pipe',
      env: {
        ...process.env,
        NOLDOR_NOTIFY_KIND: kind,
        NOLDOR_NOTIFY_JSON: JSON.stringify(payload),
      },
    });
    if (r.status !== 0) {
      process.stderr.write(`notify hook exited ${String(r.status)} (non-fatal)\n`);
    }
  } catch (err) {
    process.stderr.write(`notify hook failed (non-fatal): ${String(err)}\n`);
  }
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/autonomous/__tests__/notify.test.ts
```

Expected output: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/notify.ts src/autonomous/__tests__/notify.test.ts
git commit -m "feat(autonomous): fail-open notify shell hook (escalation, cycle-summary, watcher-tripped)" -m "Noldor-FD: continuous-drain-daemon-and-escalation-inbox"
```

---

## Task 8: config schema — `autonomous.watch` rails

**Files:**
Modify: `src/cr/config.ts`
Test: `src/cr/__tests__/config.test.ts` (extend if present; if the file does not exist, create it with just this describe)

- [ ] **Step 1: Write the failing test** — locate the existing config test (`ls src/cr/__tests__/ | grep -i config`). Append (or create the file with imports `import { describe, expect, it } from 'vitest'; import { autonomousConfigSchema } from '../config.js';`):

```ts
describe('autonomous.watch rails schema', () => {
  it('defaults interval/caps and accepts notifyCommand', () => {
    const parsed = autonomousConfigSchema.parse({ watch: {} });
    expect(parsed.watch).toEqual({
      intervalMinutes: 30,
      maxFeaturesPerDay: 10,
      maxConsecutiveFailures: 3,
    });
    const withCmd = autonomousConfigSchema.parse({ watch: { notifyCommand: 'true' } });
    expect(withCmd.watch?.notifyCommand).toBe('true');
  });

  it('keeps watch optional and rejects non-positive rails', () => {
    expect(autonomousConfigSchema.parse({}).watch).toBeUndefined();
    expect(() => autonomousConfigSchema.parse({ watch: { intervalMinutes: 0 } })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/cr/__tests__/
```

Expected output: failures — `watch` unknown key (zod strips/undefined) or shape mismatch.

- [ ] **Step 3: Implement** — in `src/cr/config.ts`, extend `autonomousConfigSchema`:

```ts
export const watchConfigSchema = z.object({
  intervalMinutes: z.number().int().positive().default(30),
  maxFeaturesPerDay: z.number().int().positive().default(10),
  maxConsecutiveFailures: z.number().int().positive().default(3),
  notifyCommand: z.string().optional(),
});

export const autonomousConfigSchema = z.object({
  skipLanePicker: z.boolean().default(false),
  onFailure: z.enum(['prompt', 'spawn-deep-review', 'abort']).default('prompt'),
  requireHumanPrApproval: z.boolean().default(false),
  // Wall-clock cap per item is the existing --iteration-timeout flag (30 min default), not a
  // duplicate rail here. Token-budget rail deliberately omitted: no token accounting exists yet.
  watch: watchConfigSchema.optional(),
});
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/cr/__tests__/
```

Expected output: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/cr/config.ts src/cr/__tests__/
git commit -m "feat(autonomous): watch rails sub-schema (interval, daily cap, trip threshold, notifyCommand)" -m "Noldor-FD: continuous-drain-daemon-and-escalation-inbox"
```

---

## Task 9: `watch.ts` CLI + arg parsing

**Files:**
Create: `src/autonomous/watch.ts`
Test: `src/autonomous/__tests__/watch-args.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/autonomous/__tests__/watch-args.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseWatchArgs, resolve130 } from '../watch.js';

describe('parseWatchArgs', () => {
  it('defaults: interval from config fallback, max-features 1, daemon mode', () => {
    const a = parseWatchArgs([], 30);
    expect(a).toEqual({
      intervalMinutes: 30,
      maxFeatures: 1,
      maxRetries: 2,
      timeoutMs: 30 * 60 * 1000,
      once: false,
      json: false,
      dryRun: false,
    });
  });

  it('parses flags and prefers --interval over config', () => {
    const a = parseWatchArgs(
      ['--interval', '5', '--max-features', '2', '--once', '--json', '--dry-run', '--max-retries', '1', '--iteration-timeout', '60000'],
      30,
    );
    expect(a).toEqual({
      intervalMinutes: 5,
      maxFeatures: 2,
      maxRetries: 1,
      timeoutMs: 60000,
      once: true,
      json: true,
      dryRun: true,
    });
  });

  it('throws on a non-positive integer flag', () => {
    expect(() => parseWatchArgs(['--interval', '0'], 30)).toThrow('--interval');
  });
});

describe('resolve130', () => {
  it('sigint wins, then pause, then stop', () => {
    expect(resolve130({ sigint: true, pauseExists: true })).toBe('sigint');
    expect(resolve130({ sigint: false, pauseExists: true })).toBe('paused');
    expect(resolve130({ sigint: false, pauseExists: false })).toBe('stopped');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/autonomous/__tests__/watch-args.test.ts
```

Expected output: module not found `../watch.js`.

- [ ] **Step 3: Implement** — create `src/autonomous/watch.ts`:

```ts
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadConfigSync } from '../cr/config.js';
import { runDrain, type DrainDeps, type DrainResult } from './drain-loop.js';
import { roadmapSource } from './drain-source.js';
import { acquireLock, releaseLock } from './drain-lock.js';
import { writeState, type DrainState } from './drain-state.js';
import { syncMainCleanState, openPrExistsFor, spawnGate, mergePr } from './drain-io.js';
import { assertConfig } from './queue-drain.js';
import { makeSalvage } from './salvage.js';
import { applyCycleVerdict, loadPark, mapCycle, parkAwareSource } from './escalations.js';
import { applyCycleToState, loadWatchState, saveWatchState, type WatchRails } from './watch-state.js';
import { notify } from './notify.js';

export interface WatchArgs {
  intervalMinutes: number;
  maxFeatures: number;
  maxRetries: number;
  timeoutMs: number;
  once: boolean;
  json: boolean;
  dryRun: boolean;
}

function intFlag(args: readonly string[], name: string, def: number): number {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = Number(args[i + 1]);
  if (!Number.isInteger(v) || v <= 0) throw new Error(`${name} must be a positive integer`);
  return v;
}

/** Parse watch flags. `configInterval` is the resolved `autonomous.watch.intervalMinutes`. */
export function parseWatchArgs(args: readonly string[], configInterval: number): WatchArgs {
  return {
    intervalMinutes: intFlag(args, '--interval', configInterval),
    maxFeatures: intFlag(args, '--max-features', 1),
    maxRetries: intFlag(args, '--max-retries', 2),
    timeoutMs: intFlag(args, '--iteration-timeout', 30 * 60 * 1000),
    once: args.includes('--once'),
    json: args.includes('--json'),
    dryRun: args.includes('--dry-run'),
  };
}

/**
 * Disambiguate a 130 cycle (spec Unit 1 step 4): pause, drain-stop, and SIGINT
 * all flow through the same stopRequested seam, so the watcher inspects its own
 * state afterwards. SIGINT wins (operator at the keyboard), then pause (hold /
 * exit-0), else a freshly written drain-stop (one-shot stop → exit 130).
 */
export function resolve130(s: { sigint: boolean; pauseExists: boolean }): 'sigint' | 'paused' | 'stopped' {
  if (s.sigint) return 'sigint';
  if (s.pauseExists) return 'paused';
  return 'stopped';
}

const PAUSE_REL = '.noldor/drain.pause';
const STOP_REL = '.noldor/drain-stop';

function dayKeyOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function interruptibleSleep(ms: number, interrupted: () => boolean): Promise<void> {
  const step = 1000;
  for (let waited = 0; waited < ms; waited += step) {
    if (interrupted()) return;
    await sleep(Math.min(step, ms - waited));
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cwd = process.cwd();
  const cfg = loadConfigSync() ?? {};
  let parsed: WatchArgs;
  try {
    assertConfig(cfg);
    const watchCfg = cfg.autonomous?.watch;
    parsed = parseWatchArgs(args, watchCfg?.intervalMinutes ?? 30);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
  const rails: WatchRails = {
    maxFeaturesPerDay: cfg.autonomous?.watch?.maxFeaturesPerDay ?? 10,
    maxConsecutiveFailures: cfg.autonomous?.watch?.maxConsecutiveFailures ?? 3,
  };
  const notifyCommand = cfg.autonomous?.watch?.notifyCommand;

  const startedAt = new Date().toISOString();
  const lock = acquireLock(cwd, startedAt);
  if (!lock.ok) {
    process.stderr.write(`watch: ${lock.reason}\n`);
    process.exit(1);
  }

  // Startup-only stale-sentinel clear (spec Unit 1 step 2): a sentinel written DURING
  // this run — including between cycles — is live operator intent, never cleared.
  try {
    unlinkSync(join(cwd, STOP_REL));
  } catch {
    /* not present — fine */
  }

  let sigint = false;
  process.on('SIGINT', () => {
    sigint = true;
  });
  const pauseExists = (): boolean => existsSync(join(cwd, PAUSE_REL));

  const out = (line: string): void => {
    if (!parsed.json) process.stdout.write(`${line}\n`);
  };
  const emitJson = (obj: unknown): void => {
    if (parsed.json) process.stdout.write(`${JSON.stringify(obj)}\n`);
  };

  let exitCode = 0;
  try {
    for (;;) {
      if (sigint) {
        exitCode = 130;
        break;
      }
      if (pauseExists()) {
        out('watch: paused (.noldor/drain.pause present)');
        emitJson({ cycle: 'paused' });
        if (parsed.once) break;
        await interruptibleSleep(parsed.intervalMinutes * 60_000, () => sigint);
        continue;
      }
      let state = loadWatchState(cwd, dayKeyOf(new Date()));
      if (state.shippedToday >= rails.maxFeaturesPerDay) {
        out(`watch: daily cap reached (${String(state.shippedToday)}/${String(rails.maxFeaturesPerDay)})`);
        emitJson({ cycle: 'capped', shippedToday: state.shippedToday });
        if (parsed.once) break;
        await interruptibleSleep(parsed.intervalMinutes * 60_000, () => sigint);
        continue;
      }

      const source = parkAwareSource(roadmapSource(cwd), () => loadPark(cwd));
      const deps: DrainDeps = {
        source,
        spawnGate: (env, timeoutMs, prompt) => spawnGate(cwd, env, timeoutMs, prompt),
        syncMainCleanState: () => syncMainCleanState(cwd),
        mergePr: (slug, branch) => mergePr(cwd, slug, branch),
        openPrExistsFor: (slug, branch) => openPrExistsFor(cwd, slug, branch),
        salvageStaleBase: makeSalvage(cwd),
        writeState: (s) => {
          const ds: DrainState = {
            pid: process.pid,
            startedAt,
            phase: s.phase,
            inFlight: s.inFlight,
            merging: s.merging,
            currentSlug: s.inFlight[0]?.slug ?? null,
            shipped: s.shipped,
            skip: s.skip,
            retries: s.retries,
          };
          writeState(cwd, ds);
        },
        stopRequested: () => sigint || existsSync(join(cwd, STOP_REL)) || pauseExists(),
      };

      const res: DrainResult = await runDrain(deps, {
        maxFeatures: parsed.maxFeatures,
        maxRetries: parsed.maxRetries,
        maxSpawns: parsed.maxFeatures * (parsed.maxRetries + 1),
        timeoutMs: parsed.timeoutMs,
        dryRun: parsed.dryRun,
        cwd,
        concurrency: 1,
        startupStaggerMs: 750,
      });

      const now = new Date().toISOString();
      const verdict = mapCycle({
        result: res,
        mode: 'watch',
        source: source.id,
        parked: loadPark(cwd),
        pendingPr: state.pendingPr,
        ...(state.lastRunAbortError !== undefined
          ? { prevRunAbortError: state.lastRunAbortError }
          : {}),
        queueUniverse: source.parseAll(),
        now,
      });
      applyCycleVerdict(cwd, source.id, verdict);
      for (const rowItem of verdict.escalations) notify(notifyCommand, 'escalation', rowItem, cwd);

      const applied = applyCycleToState(state, res, verdict.escalations.length, rails, now);
      state = {
        ...applied.state,
        pendingPr: verdict.nextPendingPr,
        ...(verdict.nextRunAbortError !== undefined
          ? { lastRunAbortError: verdict.nextRunAbortError }
          : {}),
      };
      saveWatchState(cwd, state);

      const summary = {
        cycle: 'done',
        shipped: res.shipped,
        skipped: res.skipped.length,
        parked: verdict.toPark.length,
        unparked: verdict.toUnpark.length,
        exitCode: res.exitCode,
        consecutiveFailures: state.consecutiveFailures,
      };
      notify(notifyCommand, 'cycle-summary', summary, cwd);
      out(
        `watch cycle: shipped ${String(res.shipped)}, parked ${String(verdict.toPark.length)}, failures ${String(state.consecutiveFailures)}/${String(rails.maxConsecutiveFailures)}`,
      );
      emitJson(summary);

      if (res.exitCode === 130) {
        const why = resolve130({ sigint, pauseExists: pauseExists() });
        if (why === 'sigint' || why === 'stopped') {
          exitCode = 130;
          break;
        }
        // paused: daemon holds (pause check at top of loop), --once exits 0 below.
      }

      if (applied.tripped) {
        // Loud trip (spec Unit 5): pause file so even cron --once respects it, escalation row, notify, exit 1.
        try {
          writeFileSync(join(cwd, PAUSE_REL), `tripped ${now}\n`, 'utf8');
        } catch {
          /* best-effort */
        }
        applyCycleVerdict(cwd, source.id, {
          escalations: [
            {
              ts: now,
              slug: '-',
              source: source.id,
              reason: 'watcher-tripped',
              evidence: `consecutiveFailures=${String(state.consecutiveFailures)}`,
              stateSnapshot: { shipped: res.shipped, skipped: [...res.skipped] },
              suggestedAction:
                'inspect recent escalations, clear the root cause, then `rm .noldor/drain.pause`',
            },
          ],
          toPark: [],
          toUnpark: [],
          nextPendingPr: state.pendingPr,
        });
        notify(notifyCommand, 'watcher-tripped', { consecutiveFailures: state.consecutiveFailures }, cwd);
        out('watch: TRIPPED — .noldor/drain.pause written; inbox has the evidence');
        exitCode = 1;
        break;
      }

      if (parsed.once) break;
      await interruptibleSleep(parsed.intervalMinutes * 60_000, () => sigint || pauseExists());
    }
  } finally {
    releaseLock(cwd);
  }
  process.exit(exitCode);
}

// Match the entrypoint exactly (watch.ts/.js/.mjs) — NOT watch-args.test.ts.
const invokedDirect = /[\\/]watch\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  void main().catch((e: unknown) => {
    process.stderr.write(`watch crashed: ${e instanceof Error ? e.message : String(e)}\n`);
    releaseLock(process.cwd());
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/autonomous/__tests__/watch-args.test.ts
```

Expected output: 4 tests pass.

- [ ] **Step 5: Verify no import cycle / type breakage**

```bash
pnpm typecheck
```

Expected output: clean exit 0. (`watch.ts` imports `assertConfig` from `queue-drain.ts`; queue-drain's `main()` only runs when invoked directly, so the import is side-effect-free.)

- [ ] **Step 6: Commit**

```bash
git add src/autonomous/watch.ts src/autonomous/__tests__/watch-args.test.ts
git commit -m "feat(autonomous): noldor autonomous watch scheduler (cycles, rails, trip, 130 disambiguation)" -m "Noldor-FD: continuous-drain-daemon-and-escalation-inbox"
```

---

## Task 10: inbox + unpark CLIs, queue-drain wiring, manifest

**Files:**
Create: `src/autonomous/inbox-cli.ts`, `src/autonomous/unpark-cli.ts`
Modify: `src/autonomous/queue-drain.ts`, `src/cli/manifest.ts`

- [ ] **Step 1: Create `src/autonomous/inbox-cli.ts`:**

```ts
import { readInboxRows } from './escalations.js';

function main(): void {
  const rows = readInboxRows(process.cwd());
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(rows)}\n`);
    return;
  }
  if (rows.length === 0) {
    process.stdout.write('inbox: no open escalations\n');
    return;
  }
  for (const r of rows) {
    process.stdout.write(
      `${r.source}:${r.slug} | ${r.reason} | ${r.ts}\n  evidence: ${r.evidence || '(none)'}\n  action:   ${r.suggestedAction}\n`,
    );
  }
}

const invokedDirect = /[\\/]inbox-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
```

- [ ] **Step 2: Create `src/autonomous/unpark-cli.ts`:**

```ts
import { unparkSlug } from './escalations.js';

function main(): void {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const slug = args[0];
  const si = process.argv.indexOf('--source');
  const source = si === -1 ? undefined : process.argv[si + 1];
  if (slug === undefined) {
    process.stderr.write('usage: noldor autonomous unpark <slug> [--source <id>]\n');
    process.exit(1);
  }
  const r = unparkSlug(process.cwd(), slug, source);
  if (r.status === 'resolved') {
    process.stdout.write(`unparked ${r.key} — re-eligible next cycle\n`);
    return;
  }
  if (r.status === 'not-parked') {
    process.stdout.write(`${slug}: not parked — nothing to do\n`);
    return;
  }
  process.stderr.write(
    `${slug} is parked under multiple sources — pass --source. Candidates: ${r.candidates.join(', ')}\n`,
  );
  process.exit(1);
}

const invokedDirect = /[\\/]unpark-cli\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
```

- [ ] **Step 3: Wire `queue-drain.ts`** (run-side symmetry, spec Unit 3 / D3). In `main()`:

3a. Extend imports:

```ts
import { makeSalvage } from './salvage.js';
import { applyCycleVerdict, loadPark, mapCycle, parkAwareSource } from './escalations.js';
```

3b. Wrap the source and add the salvage dep — after `source = buildSource(parsed.source, cwd);` succeeds, where `deps` is built, change:

```ts
  const drainSource = parkAwareSource(source, () => loadPark(cwd));
  const deps: DrainDeps = {
    source: drainSource,
    spawnGate: (env, timeoutMs, prompt) => spawnGate(cwd, env, timeoutMs, prompt),
    syncMainCleanState: () => syncMainCleanState(cwd),
    mergePr: (slug, branch) => mergePr(cwd, slug, branch),
    openPrExistsFor: (slug, branch) => openPrExistsFor(cwd, slug, branch),
    salvageStaleBase: makeSalvage(cwd),
    writeState: (s) => {
```

(keep the existing `writeState` body and `stopRequested` unchanged).

3c. After `runDrain` resolves (the `try`/`finally` with `releaseLock`), before the stdout summary, map and apply run-mode escalations:

```ts
  const verdict = mapCycle({
    result: res,
    mode: 'run',
    source: parsed.source,
    parked: loadPark(cwd),
    pendingPr: [],
    queueUniverse: drainSource.parseAll(),
    now: new Date().toISOString(),
  });
  applyCycleVerdict(cwd, parsed.source, verdict);
```

(No notify on the run path — operator-fired runs report to their own terminal.)

- [ ] **Step 4: Manifest entries** — in `src/cli/manifest.ts`, extend the `autonomous` group's `subs`:

```ts
      watch: {
        src: 'autonomous/watch.ts',
        desc: 'Continuous drain daemon (--interval <min>, --once for cron, --max-features per cycle)',
      },
      inbox: {
        src: 'autonomous/inbox-cli.ts',
        desc: 'List open escalations (parked slugs) with evidence + suggested action',
      },
      unpark: {
        src: 'autonomous/unpark-cli.ts',
        desc: 'Resolve an escalation: unpark <slug> [--source <id>]',
      },
```

- [ ] **Step 5: Run to verify**

```bash
pnpm typecheck && pnpm vitest run src/autonomous/
```

Expected output: typecheck clean; all autonomous suites pass (including the untouched `queue-drain-cli.test.ts` — if it asserts on the exact deps shape, update its expectations to include the new wiring).

```bash
pnpm noldor autonomous inbox
```

Expected output: `inbox: no open escalations`

```bash
pnpm noldor autonomous unpark nothing-parked
```

Expected output: `nothing-parked: not parked — nothing to do`

- [ ] **Step 6: Commit**

```bash
git add src/autonomous/inbox-cli.ts src/autonomous/unpark-cli.ts src/autonomous/queue-drain.ts src/cli/manifest.ts
git commit -m "feat(autonomous): inbox/unpark CLIs + run-side park, salvage, and escalation wiring" -m "Noldor-FD: continuous-drain-daemon-and-escalation-inbox"
```

---

## Task 11: docs — autonomy.md, cr-pipeline pointer, script catalog, FD links

**Files:**
Create: `docs/noldor/autonomy.md`
Modify: `docs/noldor/cr-pipeline.md`, `docs/noldor/script-catalog.md`, `docs/features/continuous-drain-daemon-and-escalation-inbox.md`

- [ ] **Step 1: Create `docs/noldor/autonomy.md`:**

```markdown
# Continuous Autonomy — watch, salvage, escalations

`noldor autonomous watch` makes the one-shot drain continuous: a long-lived (or cron-fired)
scheduler that keeps draining the roadmap queue in bounded cycles, repairs known failure modes,
and escalates the rest to a structured inbox instead of dying or blocking.

## Lifecycle

1. Acquire `.noldor/drain.lock` for the watcher's lifetime — a second watcher or a concurrent
   `autonomous run` refuses to start.
2. Clear a stale `.noldor/drain-stop` sentinel **once at startup** (a sentinel written during the
   run — including between cycles — is live operator intent and is honored, never cleared).
3. Cycle: pause check → daily-cap check → bounded `runDrain` (`--max-features` per cycle,
   K=1) → escalation mapping → rails update → notify → sleep `--interval` minutes.
4. `--once` runs a single cycle and exits — cron mode is the same code.

## Rails (`.noldor/config.json` → `autonomous.watch`)

| Rail                     | Default | Behavior                                                                  |
| ------------------------ | ------- | ------------------------------------------------------------------------- |
| `intervalMinutes`        | 30      | Sleep between cycles (CLI `--interval` overrides).                        |
| `maxFeaturesPerDay`      | 10      | Pre-cycle check; a cycle with `--max-features N > 1` may overshoot ≤ N−1. |
| `maxConsecutiveFailures` | 3       | Trip → write `drain.pause`, escalate `watcher-tripped`, notify, exit 1.   |
| `notifyCommand`          | unset   | POSIX shell one-liner; gets `NOLDOR_NOTIFY_KIND` + `NOLDOR_NOTIFY_JSON`.  |

Wall-clock cap per item is the existing `--iteration-timeout` (default 30 min). There is no
token-budget rail: no token accounting exists yet (the metrics roadmap entry owns it).

A cycle counts as failed when the drain aborts (exit 1) or ships nothing while producing new
escalations. Exit-130 cycles (pause/stop/SIGINT) are neutral. A fully-parked queue reads as
clean — parked items are operator-owned.

## Pause / resume / stop

- `touch .noldor/drain.pause` — honored mid-cycle (between iterations) and at cycle start.
  The daemon holds and re-checks each interval; `--once` exits 0.
- `rm .noldor/drain.pause` — resume. A **tripped** watcher writes this file itself: triage the
  inbox first, then remove the file.
- `touch .noldor/drain-stop` — one-shot stop (exit 130), exactly as for `autonomous run`.
- The watcher and an operator share `main` via `syncMainCleanState` — when working in the same
  repo, pause the watcher first. `drain.pause` is the "I'm working here" switch.

## Salvage (stale-base clean room)

Before each spawn, the drain classifies leftover state for the slug's own `fast/<slug>` branch:

- local branch based behind `origin/main`, or
- a closed-unmerged PR for the head, or
- an orphan remote branch (no open PR — the open-PR guard already ran).

Any hit → remove worktree dir + local branch + remote branch (each best-effort), emit a
`salvaged` event (`kind: 'salvaged'` in `.noldor/agent-events.jsonl`), and spawn from fresh
main — the recipe's "re-apply, don't cherry-pick": the stale tip is discarded, never merged.
A current-base branch with no PR is left to the gate child's force-recreate. Caveat: a human
branch named exactly `fast/<queued-slug>` is indistinguishable from drain leftovers — the
namespace is the drain's by convention.

## Escalation inbox

Item-scoped terminal failures park the slug and the loop continues (park-and-continue):

| Reason              | Trigger                                                                   | Parks |
| ------------------- | ------------------------------------------------------------------------- | ----- |
| `retries-exhausted` | slug crossed `--max-retries`                                              | yes   |
| `pr-open-unmerged`  | opened PR still unmerged across **2 consecutive cycles** (grace = 1)      | yes   |
| `merge-conflict`    | coordinator merge outcome                                                  | yes   |
| `merge-timeout`     | coordinator merge outcome                                                  | yes   |
| `run-aborted`       | repo-level abort (ff-only reject, gh failure) — bumps the trip rail       | no    |
| `watcher-tripped`   | `maxConsecutiveFailures` reached                                          | no    |

Storage: `.noldor/escalations.jsonl` (append-only audit; rows carry `source`) +
`.noldor/drain-park.json` (open set, keyed `"<source>:<slug>"`). Parks auto-resolve when the
slug leaves its source's queue universe (e.g. the PR merged later). Plain `autonomous run`
writes the same records (minus the pr-open-unmerged park — a one-shot can't observe
persistence) but never notifies.

Triage:

```bash
pnpm noldor autonomous inbox            # open escalations
pnpm noldor autonomous unpark <slug>    # resolve; --source <id> when parked under several
```

## CI-cron placement

Out of scope for now: run the watcher on the operator's machine (daemon or local cron with
`--once`). A CI-cron variant waits for consumer-contract CI (secrets + checkout strategy).
```

- [ ] **Step 2: Pointer in `docs/noldor/cr-pipeline.md`** — locate the drain/autonomous section heading (`grep -n "drain" docs/noldor/cr-pipeline.md | head`) and append one line under it:

```markdown
Continuous mode (watch daemon, salvage, escalation inbox, rails): see [`autonomy.md`](autonomy.md).
```

- [ ] **Step 3: Script catalog** — in `docs/noldor/script-catalog.md`, insert a new `## Autonomous` section directly before `## Utilities`:

```markdown
## Autonomous

| Command                          | Source                                                                   | Purpose                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `pnpm noldor autonomous run`     | [`src/autonomous/queue-drain.ts`](../../src/autonomous/queue-drain.ts)    | One-shot queue drain (`--source roadmap\|plans`, `--max-features`, `--dry-run`).          |
| `pnpm noldor autonomous watch`   | [`src/autonomous/watch.ts`](../../src/autonomous/watch.ts)                | Continuous drain daemon; `--once` = cron mode. See [`autonomy.md`](autonomy.md).          |
| `pnpm noldor autonomous inbox`   | [`src/autonomous/inbox-cli.ts`](../../src/autonomous/inbox-cli.ts)        | List open escalations (parked slugs) with evidence + suggested action.                    |
| `pnpm noldor autonomous unpark`  | [`src/autonomous/unpark-cli.ts`](../../src/autonomous/unpark-cli.ts)      | Resolve an escalation: `unpark <slug> [--source <id>]`.                                   |
```

- [ ] **Step 4: FD links correction** — in `docs/features/continuous-drain-daemon-and-escalation-inbox.md` frontmatter, replace the `links` block (the roadmap entry's pointers were partly stale — no dashboard surface ships in this slice; the autonomous config block lives in `src/cr/config.ts`):

```yaml
links:
  code:
    - src/autonomous/watch.ts
    - src/autonomous/salvage.ts
    - src/autonomous/escalations.ts
    - src/autonomous/watch-state.ts
    - src/autonomous/notify.ts
    - src/autonomous/inbox-cli.ts
    - src/autonomous/unpark-cli.ts
    - src/autonomous/drain-loop.ts
    - src/autonomous/queue-drain.ts
    - src/core/agent-events.ts
    - src/cr/config.ts
    - src/cli/manifest.ts
    - docs/noldor/autonomy.md
  tests:
    - src/autonomous/__tests__/salvage.test.ts
    - src/autonomous/__tests__/escalations.test.ts
    - src/autonomous/__tests__/watch-state.test.ts
    - src/autonomous/__tests__/notify.test.ts
    - src/autonomous/__tests__/watch-args.test.ts
    - src/autonomous/__tests__/run-drain.test.ts
  spec: docs/superpowers/specs/2026-06-12-continuous-drain-daemon-and-escalation-inbox-design.md
  plan: docs/superpowers/plans/2026-06-12-continuous-drain-daemon-and-escalation-inbox.md
```

- [ ] **Step 5: Validate + commit**

```bash
pnpm noldor validate features
```

Expected output: `Validated 38 feature MD(s) — all OK.`

```bash
git add docs/noldor/autonomy.md docs/noldor/cr-pipeline.md docs/noldor/script-catalog.md docs/features/continuous-drain-daemon-and-escalation-inbox.md
git commit -m "docs(autonomous): autonomy.md runbook, script-catalog rows, cr-pipeline pointer, FD links" -m "Noldor-FD: continuous-drain-daemon-and-escalation-inbox"
```

---

## Task 12: full verification + smoke

**Files:**
Modify: none (verification only)

- [ ] **Step 1: Full suite**

```bash
pnpm verify
```

Expected output: oxlint clean, oxfmt clean, tsc clean, vitest all green. Fix anything red before proceeding (formatting: `pnpm fmt`).

- [ ] **Step 2: Dry-run smoke of the watch cycle** (no spawns, no mutations):

```bash
pnpm noldor autonomous watch --once --dry-run --max-features 1
```

Expected output: one cycle line, e.g. `watch cycle: shipped 0, parked 0, failures 0/3`, exit 0. (Dry-run marks candidates planned/skipped without spawning; with no eligible fast-track XS/S entry it reports shipped 0.)

- [ ] **Step 3: Pause-switch smoke**

```bash
touch .noldor/drain.pause && pnpm noldor autonomous watch --once; echo "exit=$?"; rm .noldor/drain.pause
```

Expected output: `watch: paused (.noldor/drain.pause present)` and `exit=0`.

- [ ] **Step 4: Notify smoke**

```bash
NOTIFY_OUT=$(mktemp); pnpm exec tsx -e "
import {notify} from './src/autonomous/notify.ts';
notify('printf %s \"\$NOLDOR_NOTIFY_KIND\" > $NOTIFY_OUT', 'cycle-summary', {ok:true}, process.cwd());
"; cat "$NOTIFY_OUT"; rm -f "$NOTIFY_OUT"
```

Expected output: `cycle-summary`

- [ ] **Step 5: Commit any straggler formatting**

```bash
git status --porcelain
```

Expected output: empty (everything committed). If `pnpm fmt` touched files, commit them:

```bash
git add -u && git commit -m "chore(autonomous): formatting" -m "Noldor-FD: continuous-drain-daemon-and-escalation-inbox"
```
