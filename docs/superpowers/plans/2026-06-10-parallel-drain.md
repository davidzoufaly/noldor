# Parallel Drain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the autonomous drain supervisor from strictly sequential (one feature at a time) to K-concurrent — many features build in parallel, each in its own worktree and its own PR, while merges serialize through one lane so `main` never sees an N-way conflict.

**Architecture:** `runDrain` becomes `async`. A bounded **build pool** of `concurrency` workers each pull the next eligible slug from the injected `DrainSource` and `spawnGate` it (now async, `spawn` not `spawnSync`); each child is assigned its exact slug via `NOLDOR_DRAIN_SLUG`. At `--concurrency 1` (default) the single worker merges inline exactly like today (byte-for-byte regression-safe). At `--concurrency K>1`, children **open a PR but do not merge** (pr-flow `openOnly` mode), and a single **serialized merge coordinator** drains opened PRs one at a time — `gh pr merge --squash` with a `git fetch` between each so every merge rebases on the prior; a genuine conflict leaves the PR open + marks the slug `merge-conflict` + skips (never force-merged).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node `child_process.spawn`, Vitest, `git` / `gh` CLIs. No new dependencies.

---

## Key design decision (review focus)

The spec (§1, §6) says "a child's job ends when its PR is open (not merged); the coordinator then merges," while a non-goal says "the child is unchanged except for slug assignment." These conflict: if the child runs the unchanged `pr-flow` (which calls `gh pr merge --auto --squash` + polls), then with **no** platform merge queue, N children auto-merge independently and race `main` — the exact failure the spec rejects.

**Resolution chosen here:** the child's merge step becomes conditional, not its build/review step.

- `--concurrency 1` → child runs `pr-flow` unchanged (auto-merge + poll inline). **Today's behavior, byte-for-byte.**
- `--concurrency K>1` → the supervisor passes `NOLDOR_DRAIN_OPEN_ONLY=1`; `pr-flow.openAndAutoMerge` honors it by returning right after `gh pr create` (push + PR open, **no** `gh pr merge`, **no** poll). The supervisor's serialized merge coordinator then owns every merge.

This keeps K=1 untouched (the merge-coordinator risk is opt-in at K>1) and makes the fallback (no merge queue) correct. The coordinator does **not** invent a new merge mechanism: it reuses the same `gh pr merge --auto --squash` + poll-until-mergeable machinery that the K=1 child already runs today (`pr-flow.ts:300` + `pollAutoMerge` at `:196`), just serially and from the supervisor. The only behavioral change to a child is *who issues the merge*, gated entirely by an env var the operator never sets by hand. **This deviation from the "child unchanged" non-goal is deliberate and is the single most important thing for the plan reviewer to accept or reject.**

## Correctness notes (resolved from plan CR round 1)

Six blockers from the first plan review reshaped the merge coordinator. The corrected invariants:

1. **Oracle authority at K>1 (was HIGH).** A server-side squash merge does **not** advance the supervisor's local working tree, and `source.parseAll()` reads the *local* roadmap/FD set (`drain-source.ts` reads `loadDocRoots(cwd)`). So after each successful merge the coordinator MUST advance local `main` (`git checkout main && git fetch origin main && git merge --ff-only` — exactly `syncMainCleanState`, whose `git worktree prune` is admin-only and never touches a live child worktree) **before** reading the per-feature oracle. A plain `git fetch` (the rejected `syncMainOnly`) is insufficient — the local file never changes, so every merged slug reads as still-present and `shipped` stays 0. `syncMainOnly` is removed.

2. **Mergeability, not immediate squash (was HIGH).** A just-opened PR is usually not yet mergeable (required checks pending, branch protection). `gh pr merge --squash` issued immediately fails with "not mergeable"/"blocked" — which is **not** a conflict. The coordinator therefore uses `gh pr merge <branch> --auto --squash` (enqueue) + polls `gh pr view --json mergedAt,mergeStateStatus,state` until `mergedAt` is set (→ merged) or `mergeStateStatus ∈ {DIRTY, CONFLICTING}` (→ genuine conflict → skip, leave PR open) or a per-PR merge timeout elapses (→ skip with `merge-timeout`, leave PR open). Conflict detection is on the structured `mergeStateStatus` field, never a stderr substring.

3. **Serialization source (was MED).** Conflict-safety comes from (a) merging exactly one PR at a time and (b) advancing local `main` after each merge so the next merge's base — and the next oracle read — are current. A local `git fetch` does not "rebase" the server-side PR; that earlier rationale is dropped.

4. **Shared-`.git` contention across children (was MED).** K children each run `/gate`, which does `git worktree add` / `git fetch` / branch writes against the **shared** `.git`. Simultaneous `git worktree add` can collide on `.git/worktrees` + `index.lock`. v1 mitigation: stagger worker first-spawns by `STARTUP_STAGGER_MS` (default 750ms × worker index) so worktree creations don't land at the same instant, and keep the recommended `--concurrency` small (≤ ~4, per spec D5). This is a *mitigation, not elimination* — documented as a known limitation; a future FD can add a proper child-startup mutex.

5. **`maxFeatures` accounting at K>1 (was MED).** `shipped` only increments after merge (in the coordinator), which lags dispatch. A worker must gate dispatch on `shipped + dispatched.size >= maxFeatures` (in-flight + shipped), not on `shipped` alone, or it over-dispatches while merges lag. `decideNext`'s `shipped >= maxFeatures` check remains a backstop.

6. **TDD red signal in Task 1 (was MED).** Converting `runDrain` to async makes `pnpm typecheck` go red (the `spawnGate` `Promise<number>` vs `number` mismatch); the *vitest* run may still pass under the old sync body. Task 1's red baseline is the **typecheck**, not the test run.

## File structure

- `src/autonomous/drain-loop.ts` — `runDrain` → `async`; add the build pool + serialized merge coordinator; `decideNext` stays a pure sync function. `DrainDeps.spawnGate` → returns `Promise<number>`; add an async `mergePr` dep. The coordinator reuses the existing `syncMainCleanState` dep to advance local `main` after each merge (no new sync dep — `syncMainOnly` was rejected as insufficient).
- `src/autonomous/drain-io.ts` — `spawnGate` → async (`spawn`); add `mergePr` (`gh pr merge --auto --squash` + poll `mergeStateStatus` until merged / conflict / timeout).
- `src/autonomous/queue-drain.ts` — parse `--concurrency` (default 1); thread into `DrainOpts`; `main` → async; wire async `spawnGate` + `mergePr`.
- `src/autonomous/drain-state.ts` — `currentSlug: string | null` → `inFlight: InFlight[]` + `merging: string | null`; keep `currentSlug` as a derived back-compat field.
- `src/core/pr-flow.ts` — `OpenAndAutoMergeInput` gains optional `openOnly?: boolean`; when true, return after `gh pr create` (no merge/poll).
- `src/core/pr-flow-cli.ts` — read `NOLDOR_DRAIN_OPEN_ONLY` env → set `openOnly`.
- `.claude/skills/gate/SKILL.md` — drain Step 0 selects `NOLDOR_DRAIN_SLUG` when set (the one gate-skill change). **Shared file — commit needs `NOLDOR_ALLOW_SHARED=1`.**
- Tests: `src/autonomous/__tests__/run-drain.test.ts` (async + concurrency:1 regression), new `src/autonomous/__tests__/build-pool.test.ts`, `src/autonomous/__tests__/merge-coordinator.test.ts`, `src/core/__tests__/pr-flow.test.ts` (openOnly).

---

## Task 1: Make `runDrain` async; existing behavior unchanged at concurrency 1

**Files:**
- Modify: `src/autonomous/drain-loop.ts`
- Modify: `src/autonomous/__tests__/run-drain.test.ts`

- [ ] **Step 1: Update the existing tests to async + `concurrency: 1`**

In `run-drain.test.ts`, add `concurrency: 1` to the shared `opts` object and make every `runDrain(...)` call awaited. The mock `spawnGate` must return a resolved promise.

```typescript
// opts object — add concurrency:
const opts = {
  maxFeatures: 20,
  maxRetries: 2,
  maxSpawns: 40,
  timeoutMs: 1000,
  dryRun: false,
  cwd: '/x',
  concurrency: 1,
};

// harness spawnGate — return a Promise<number>:
const spawnGate = vi.fn(
  async (_env: Record<string, string>, _timeoutMs: number, _prompt: string) => {
    const code = (opts.spawnImpl ?? (() => 0))();
    if (lastTarget !== null && ships(lastTarget)) roadmap = roadmap.filter((s) => s !== lastTarget);
    return code;
  },
);

// each test body — await:
const r = await runDrain(h.deps, opts);
```

Make every `it(...)` callback `async`. Tests (b), (k), (l), (m) that assert `exitCode` inline become `expect((await runDrain(h.deps, opts)).exitCode).toBe(...)`.

- [ ] **Step 2: Run typecheck to verify it fails (the red signal here is typecheck, not vitest)**

Run: `cd /Users/davidzoufaly/code/noldor/.worktrees/parallel-drain && pnpm typecheck`
Expected: FAIL — the harness `spawnGate` now returns `Promise<number>` but `DrainDeps.spawnGate` is still typed `=> number`, and `runDrain` is still sync. (`pnpm exec vitest run …/run-drain.test.ts` may still *pass* under the old sync body — `await` on a non-promise is legal and the loop ignores `spawnGate`'s return — so typecheck, not the test run, is the red baseline that Step 3 turns green.)

- [ ] **Step 3: Convert `runDrain` to async (concurrency-1 path only for now)**

In `drain-loop.ts`: add `concurrency: number;` to `DrainOpts`. Change `DrainDeps.spawnGate` to `(env, timeoutMs, prompt) => Promise<number>`. Change the signature to `export async function runDrain(deps: DrainDeps, opts: DrainOpts): Promise<DrainResult>`. Inside, `await deps.spawnGate(...)`. The loop body is otherwise **unchanged** for this task — a single sequential pass. (The pool arrives in Task 4; this task only proves the async conversion is behavior-preserving.)

```typescript
export interface DrainOpts {
  maxFeatures: number;
  maxRetries: number;
  maxSpawns: number;
  timeoutMs: number;
  dryRun: boolean;
  cwd: string;
  concurrency: number;
  /** Per-worker first-spawn stagger to avoid simultaneous `git worktree add` on the shared .git.
   *  Production passes 750; tests pass 0 for determinism. Only applies at concurrency > 1. */
  startupStaggerMs: number;
}

// in DrainDeps:
//   spawnGate: (env: Record<string, string>, timeoutMs: number, prompt: string) => Promise<number>;

export async function runDrain(deps: DrainDeps, opts: DrainOpts): Promise<DrainResult> {
  // ... body identical to current, except:
  //   await deps.spawnGate({ NOLDOR_DRAIN: '1', NOLDOR_DRAIN_SKIP: [...skip].join(',') }, opts.timeoutMs, deps.source.gatePrompt(candidate.slug));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/autonomous/__tests__/run-drain.test.ts`
Expected: PASS (all 12 existing cases, now async, concurrency 1).

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-loop.ts src/autonomous/__tests__/run-drain.test.ts
git commit -m "refactor(autonomous): make runDrain async (concurrency-1 behavior unchanged)"
```

---

## Task 2: Parse `--concurrency` (default 1)

**Files:**
- Modify: `src/autonomous/queue-drain.ts`
- Modify: `src/autonomous/__tests__/queue-drain-cli.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `queue-drain-cli.test.ts`:

```typescript
import { parseArgs } from '../queue-drain.js';

describe('parseArgs --concurrency', () => {
  it('defaults concurrency to 1', () => {
    expect(parseArgs([]).concurrency).toBe(1);
  });
  it('parses --concurrency 3', () => {
    expect(parseArgs(['--concurrency', '3']).concurrency).toBe(3);
  });
  it('rejects --concurrency 0', () => {
    expect(() => parseArgs(['--concurrency', '0'])).toThrow(/positive integer/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/autonomous/__tests__/queue-drain-cli.test.ts`
Expected: FAIL — `concurrency` is `undefined` on `ParsedArgs`.

- [ ] **Step 3: Add the flag**

In `queue-drain.ts`, add `concurrency: number;` to `ParsedArgs` and parse it with the existing `intFlag` helper (which already rejects non-positive integers):

```typescript
export interface ParsedArgs {
  maxFeatures: number;
  maxRetries: number;
  maxSpawns: number;
  timeoutMs: number;
  dryRun: boolean;
  json: boolean;
  source: SourceId;
  concurrency: number;
}

// inside parseArgs(...), in the returned object:
  concurrency: intFlag(args, '--concurrency', 1),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/autonomous/__tests__/queue-drain-cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/queue-drain.ts src/autonomous/__tests__/queue-drain-cli.test.ts
git commit -m "feat(autonomous): parse --concurrency flag (default 1)"
```

---

## Task 3: Async `spawnGate` (spawn, not spawnSync) + wire queue-drain `main`

**Files:**
- Modify: `src/autonomous/drain-io.ts`
- Modify: `src/autonomous/queue-drain.ts`

- [ ] **Step 1: Rewrite `spawnGate` async**

Replace the `spawnSync` body with a `spawn`-based promise mirroring `src/prep/spawn.ts:spawnClaude` (timeout via `setTimeout` + `SIGKILL`, `iteration-timeout` on timeout, `spawn-failed: …` on `error`). Keep `stdio: 'inherit'` so live progress still shows.

```typescript
import { spawn } from 'node:child_process';

export function spawnGate(
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  prompt = '/gate',
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['--print', prompt, '--disallowed-tools', 'AskUserQuestion', '--permission-mode', 'bypassPermissions'],
      { cwd, env: { ...process.env, ...env }, stdio: 'inherit' },
    );
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`spawn-failed: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error('iteration-timeout'));
      resolve(code ?? 1);
    });
  });
}
```

Keep `syncMainCleanState` and `openPrExistsFor` as-is (still sync `execFileSync` — they are cheap and called from `await`-able positions).

- [ ] **Step 2: Wire async `spawnGate` in `queue-drain.ts` `main`**

Make `main` async, `await runDrain(...)`, and adapt the `spawnGate` dep to return the promise:

```typescript
async function main(): Promise<void> {
  // ... unchanged setup ...
  const deps: DrainDeps = {
    source,
    spawnGate: (env, timeoutMs, prompt) => spawnGate(cwd, env, timeoutMs, prompt),
    // ... rest unchanged ...
  };
  let res: DrainResult;
  try {
    res = await runDrain(deps, { ...parsed, cwd, startupStaggerMs: 750 });
  } finally {
    releaseLock(cwd);
  }
  // ... unchanged output + process.exit(res.exitCode) ...
}

// entrypoint:
if (invokedDirect) void main();
```

- [ ] **Step 3: Typecheck + run autonomous suite**

Run: `pnpm typecheck && pnpm exec vitest run src/autonomous`
Expected: PASS — async `spawnGate` satisfies the new `DrainDeps` type; all autonomous tests green.

- [ ] **Step 4: Commit**

```bash
git add src/autonomous/drain-io.ts src/autonomous/queue-drain.ts
git commit -m "refactor(autonomous): async spawnGate via spawn; await runDrain in main"
```

---

## Task 4: Build pool + serialized merge coordinator (K>1 path)

**Files:**
- Modify: `src/autonomous/drain-loop.ts`
- Create: `src/autonomous/__tests__/build-pool.test.ts`

The pool replaces the sequential `for (;;)` with `concurrency` workers. **K=1 keeps today's inline path** (the child self-merges via unchanged `pr-flow`; the Task-1 regression suite is that guarantee — build-pool.test.ts does not re-cover K=1). **K>1 splits build from merge:** workers open PRs only (`NOLDOR_DRAIN_OPEN_ONLY=1`, no child merge) and a single serialized **coordinator** merges them one at a time via the injected `mergePr` dep, advancing local `main` (`syncMainCleanState`) after each merge **before** the per-feature oracle (CR round-1 HIGH-1). This task wires the loop with an INJECTED `mergePr` test stub; **Task 6 supplies the real `gh`-backed `mergePr` IO** — so build-pool.test.ts stays green when Task 6 lands.

Selection is a synchronous critical section (JS is single-threaded; the only `await` is the spawn, so reads/writes to `skip`/`dispatched`/`shipped` between awaits are atomic). A `dispatched` set excludes in-flight slugs from re-selection and counts against `maxFeatures`.

- [ ] **Step 1: Write the failing test (builder peak ≤K, refill, assigned slug, serialized merge)**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { runDrain, type DrainDeps, type DrainOpts } from '../drain-loop.js';
import type { DrainSource } from '../drain-source.js';

/** K>1 harness: spawnGate OPENS a PR (no ship); the coordinator's mergePr is what ships
 *  (mutates the fake roadmap). Tracks builder peak and merge peak separately. */
function poolHarness(initial: string[], concurrency: number) {
  let roadmap = [...initial];
  let building = 0, buildPeak = 0;
  let merging = 0, mergePeak = 0;
  const assignedSlugs: string[] = [];
  const source: DrainSource = {
    id: 'roadmap',
    nextItem: (skip) => {
      const slug = roadmap.find((s) => !skip.has(s));
      return slug === undefined ? null : { slug, description: 'x', eligible: true };
    },
    parseAll: () => [...roadmap],
    gatePrompt: () => '/gate',
    branchFor: (s) => `fast/${s}`,
  };
  const spawnGate = vi.fn(async (env: Record<string, string>) => {
    assignedSlugs.push(env.NOLDOR_DRAIN_SLUG!);
    building += 1; buildPeak = Math.max(buildPeak, building);
    await new Promise((r) => setTimeout(r, 5));
    building -= 1;
    return 0; // child opened a PR; did NOT ship (open-only)
  });
  const deps: DrainDeps = {
    source,
    spawnGate,
    syncMainCleanState: vi.fn(), // coordinator calls this after each merge (no-op here; mergePr mutates roadmap)
    mergePr: vi.fn(async (slug: string) => {
      merging += 1; mergePeak = Math.max(mergePeak, merging);
      await new Promise((r) => setTimeout(r, 3));
      merging -= 1;
      roadmap = roadmap.filter((s) => s !== slug); // server-side squash; oracle reads it post-advance
      return 'merged' as const;
    }),
    openPrExistsFor: vi.fn(() => true), // each child opened a PR
    writeState: vi.fn(),
    stopRequested: vi.fn(() => false),
  };
  const opts: DrainOpts = {
    maxFeatures: 20, maxRetries: 2, maxSpawns: 40, timeoutMs: 1000,
    dryRun: false, cwd: '/x', concurrency, startupStaggerMs: 0, // 0 in tests for determinism
  };
  return { deps, opts, get buildPeak() { return buildPeak; }, get mergePeak() { return mergePeak; }, assignedSlugs };
}

describe('build pool + coordinator (K>1)', () => {
  it('keeps at most K builders in flight and ships all', async () => {
    const h = poolHarness(['a', 'b', 'c', 'd', 'e'], 3);
    const r = await runDrain(h.deps, h.opts);
    expect(r.shipped).toBe(5);
    expect(h.buildPeak).toBeLessThanOrEqual(3);
    expect(h.buildPeak).toBeGreaterThan(1); // genuinely parallel builds
  });
  it('assigns each child its exact slug via NOLDOR_DRAIN_SLUG', async () => {
    const h = poolHarness(['a', 'b', 'c'], 3);
    await runDrain(h.deps, h.opts);
    expect([...h.assignedSlugs].sort()).toEqual(['a', 'b', 'c']);
  });
  it('serializes merges (merge peak 1) even with K=3 builders', async () => {
    const h = poolHarness(['a', 'b', 'c'], 3);
    await runDrain(h.deps, h.opts);
    expect(h.mergePeak).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/autonomous/__tests__/build-pool.test.ts`
Expected: FAIL — `DrainDeps` has no `mergePr`; `runDrain` does not parallelize / has no coordinator; `NOLDOR_DRAIN_SLUG` not passed.

- [ ] **Step 3: Implement pool + coordinator**

Add `mergePr: (slug: string, branch: string) => Promise<MergeOutcome>` to `DrainDeps` (and `import type { MergeOutcome } from './drain-io.js'`). Add `NOLDOR_DRAIN_SLUG` (+ `NOLDOR_DRAIN_OPEN_ONLY` at K>1) to the spawn env via an `envFor` helper. Replace the sequential `for` with `concurrency` worker loops plus one coordinator loop; share `skip`/`retries`/`shipped` (atomic between awaits). Helpers:

```typescript
function envFor(slug: string, skip: Set<string>, opts: DrainOpts): Record<string, string> {
  return {
    NOLDOR_DRAIN: '1',
    NOLDOR_DRAIN_SLUG: slug,
    NOLDOR_DRAIN_SKIP: [...skip].join(','),
    ...(opts.concurrency > 1 ? { NOLDOR_DRAIN_OPEN_ONLY: '1' } : {}),
  };
}
function recordRetryOrSkip(slug: string): void {
  const n = (retries.get(slug) ?? 0) + 1;
  retries.set(slug, n);
  if (n > opts.maxRetries) skip.add(slug);
}
```

Pool + coordinator:

```typescript
const dispatched = new Set<string>(); // in-flight slugs: excluded from selection + counted against maxFeatures
const readyToMerge: Array<{ slug: string; branch: string }> = [];
let shipped = 0, spawns = 0, aborted: Error | null = null, buildersDone = false;
let wake: (() => void) | null = null;                 // resolves the coordinator's idle wait
const signalCoordinator = () => { if (wake) { wake(); wake = null; } };
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function settleShipVerdict(slug: string, branch: string): Promise<void> {
  if (opts.concurrency === 1) {
    // Today's inline path: the child self-merged; advance local main + read the oracle here.
    deps.syncMainCleanState();
    const stillPresent = deps.source.parseAll().includes(slug);
    if (!stillPresent) { shipped += 1; retries.delete(slug); return; }
    if (deps.openPrExistsFor(slug, branch)) { skip.add(slug); return; }
    recordRetryOrSkip(slug);
    return;
  }
  // K>1: child opened a PR (open-only). Hand off to the serialized coordinator.
  if (deps.openPrExistsFor(slug, branch)) { readyToMerge.push({ slug, branch }); signalCoordinator(); }
  else recordRetryOrSkip(slug); // no PR → build failed → retry/skip
}

async function worker(index: number): Promise<void> {
  if (opts.concurrency > 1 && opts.startupStaggerMs > 0) await delay(index * opts.startupStaggerMs); // CR MED-4
  for (;;) {
    if (aborted || deps.stopRequested()) return;
    // ---- selection critical section (synchronous, no await) ----
    if (shipped + dispatched.size >= opts.maxFeatures) return; // CR MED-6: count in-flight
    const candidate = deps.source.nextItem(new Set([...skip, ...dispatched]));
    if (candidate === null) return;
    const d = decideNext({ candidate, shipped, maxFeatures: opts.maxFeatures, spawns, maxSpawns: opts.maxSpawns }); // backstop
    if (d.action === 'done') return;
    if (d.action === 'skip-out-of-scope') {
      skip.add(candidate.slug);
      if (candidate.reason !== undefined) skipReasons[candidate.slug] = candidate.reason;
      continue;
    }
    const branch = deps.source.branchFor(candidate.slug);
    if (deps.openPrExistsFor(candidate.slug, branch)) { skip.add(candidate.slug); continue; } // restart-safety
    if (opts.dryRun) { planned.push(candidate.slug); skip.add(candidate.slug); continue; }
    spawns += 1;
    dispatched.add(candidate.slug);
    // ---- end critical section ----
    try {
      await deps.spawnGate(envFor(candidate.slug, skip, opts), opts.timeoutMs, deps.source.gatePrompt(candidate.slug));
      await settleShipVerdict(candidate.slug, branch);
    } catch (e) {
      if (e instanceof Error && e.message === 'iteration-timeout') recordRetryOrSkip(candidate.slug);
      else { aborted = e instanceof Error ? e : new Error(String(e)); return; }
    } finally {
      dispatched.delete(candidate.slug);
    }
  }
}

async function coordinator(): Promise<void> {
  for (;;) {
    if (aborted) return;
    const next = readyToMerge.shift();
    if (next === undefined) {
      if (buildersDone) return;
      await new Promise<void>((r) => { wake = r; }); // woken by a worker push or by buildersDone+signal
      continue;
    }
    let outcome: MergeOutcome;
    try { outcome = await deps.mergePr(next.slug, next.branch); }
    catch (e) { aborted = e instanceof Error ? e : new Error(String(e)); return; }
    if (outcome !== 'merged') {
      skip.add(next.slug);
      skipReasons[next.slug] = `${outcome} — PR left open for human resolution`;
      continue;
    }
    try { deps.syncMainCleanState(); } // CR HIGH-1: advance local main before the oracle
    catch (e) { aborted = e instanceof Error ? e : new Error(String(e)); return; }
    const stillPresent = deps.source.parseAll().includes(next.slug);
    if (!stillPresent) { shipped += 1; retries.delete(next.slug); }
    else recordRetryOrSkip(next.slug);
  }
}

try {
  deps.syncMainCleanState();
  const coordinatorPromise = opts.concurrency > 1 ? coordinator() : Promise.resolve();
  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, (_, i) => worker(i));
  await Promise.all(workers);
  buildersDone = true;
  signalCoordinator();          // unblock a parked coordinator so it sees buildersDone and exits
  await coordinatorPromise;
  if (aborted) return result(1, aborted.message);
  if (deps.stopRequested()) return result(130);
  return result(0);
} catch (err) {
  return result(1, err instanceof Error ? err.message : String(err));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/autonomous/__tests__/build-pool.test.ts src/autonomous/__tests__/run-drain.test.ts`
Expected: PASS — builders cap at K + ship all (via coordinator), slugs assigned, merges serialized (peak 1); the 12 regression cases still pass at concurrency 1 (inline path unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-loop.ts src/autonomous/__tests__/build-pool.test.ts
git commit -m "feat(autonomous): K-bounded build pool + serialized merge coordinator"
```

---

## Task 5: `pr-flow` open-only mode + gate `NOLDOR_DRAIN_SLUG`

**Files:**
- Modify: `src/core/pr-flow.ts`
- Modify: `src/core/pr-flow-cli.ts`
- Modify: `src/core/__tests__/pr-flow.test.ts`
- Modify: `.claude/skills/gate/SKILL.md` (**shared — `NOLDOR_ALLOW_SHARED=1` on commit**)

- [ ] **Step 1: Write the failing test (openOnly skips merge)**

In `pr-flow.test.ts`, add a case asserting that with `openOnly: true`, `openAndAutoMerge` pushes + creates the PR but never calls `gh pr merge`:

```typescript
it('openOnly: opens PR, never merges', async () => {
  const calls: string[][] = [];
  const spawn = vi.fn(async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (args.includes('create')) return { exitCode: 0, stdout: 'https://github.com/x/y/pull/7\n', stderr: '' };
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  const res = await openAndAutoMerge({ /* ...minimal valid input... */ spawn, openOnly: true } as never);
  expect(calls.some((c) => c.includes('merge'))).toBe(false);
  expect(res.prUrl).toContain('/pull/7');
});
```

(Use the existing test's input-builder/fixtures in that file for the elided fields; match its established `spawn` mock shape.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/core/__tests__/pr-flow.test.ts`
Expected: FAIL — `openOnly` not on the input type; merge still called.

- [ ] **Step 3: Implement `openOnly`**

Add `openOnly?: boolean;` to `OpenAndAutoMergeInput`. After the `gh pr create` step resolves `prUrl`, short-circuit when set:

```typescript
// after prUrl is obtained, before `gh pr merge --auto --squash`:
if (input.openOnly === true) {
  return { prUrl, mergedAt: null }; // supervisor's merge coordinator owns the merge
}
```

Widen `PrFlowResult.mergedAt` to `string | null` if not already, and have callers treat `null` as "open, not yet merged." In `pr-flow-cli.ts`, set `openOnly: process.env.NOLDOR_DRAIN_OPEN_ONLY === '1'` on the input.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/core/__tests__/pr-flow.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Gate skill — honor `NOLDOR_DRAIN_SLUG` in drain Step 0**

In `.claude/skills/gate/SKILL.md`, in the drain Step 0 description, add: when `NOLDOR_DRAIN_SLUG` is set, select that exact slug (instead of `topPriority[0]`); when unset, fall back to `topPriority[0]` (sequential/back-compat). `NOLDOR_DRAIN_SKIP` is still honored for defense-in-depth. This is prose only (the gate is a skill doc); keep it to the drain Step 0 paragraph.

- [ ] **Step 6: Commit (shared-file override)**

```bash
NOLDOR_ALLOW_SHARED=1 git add src/core/pr-flow.ts src/core/pr-flow-cli.ts src/core/__tests__/pr-flow.test.ts .claude/skills/gate/SKILL.md
NOLDOR_ALLOW_SHARED=1 git commit -m "feat(core): pr-flow openOnly mode + gate honors NOLDOR_DRAIN_SLUG"
```

---

## Task 6: Real `mergePr` IO (mergeability-aware) + coordinator contract tests

**Files:**
- Modify: `src/autonomous/drain-io.ts` (add `classifyMergeView` + async `mergePr`)
- Modify: `src/autonomous/queue-drain.ts` (wire the `mergePr` dep)
- Create: `src/autonomous/__tests__/merge-classify.test.ts`
- Create: `src/autonomous/__tests__/merge-coordinator.test.ts` (locks the Task-4 coordinator conflict/timeout contract)

The coordinator loop shipped in Task 4 against an injected `mergePr` stub. This task supplies the real `gh`-backed `mergePr` and unit-tests the only branching part — the view classification — as a **pure** function (`classifyMergeView`); the shell wrapper stays an integration-tested IO adapter (per the `drain-io.ts` header). `mergePr` uses `gh pr merge --auto --squash` (enqueue) + polls the STRUCTURED `mergeStateStatus`, never a stderr substring (CR round-1 HIGH-2). `merge-conflict` and `merge-timeout` both mean "leave PR open, skip the slug"; only a systemic `gh`/spawn failure throws (coordinator aborts fail-closed).

- [ ] **Step 1: Write the failing test (pure classifier)**

```typescript
// src/autonomous/__tests__/merge-classify.test.ts
import { describe, expect, it } from 'vitest';
import { classifyMergeView } from '../drain-io.js';

describe('classifyMergeView', () => {
  it('merged when mergedAt set', () => {
    expect(classifyMergeView({ mergedAt: '2026-06-10T00:00:00Z', mergeStateStatus: 'CLEAN', state: 'OPEN' })).toBe('merged');
  });
  it('merged when state MERGED even if mergedAt null', () => {
    expect(classifyMergeView({ mergedAt: null, mergeStateStatus: 'UNKNOWN', state: 'MERGED' })).toBe('merged');
  });
  it('conflict on DIRTY / CONFLICTING', () => {
    expect(classifyMergeView({ mergedAt: null, mergeStateStatus: 'DIRTY', state: 'OPEN' })).toBe('merge-conflict');
    expect(classifyMergeView({ mergedAt: null, mergeStateStatus: 'CONFLICTING', state: 'OPEN' })).toBe('merge-conflict');
  });
  it('pending while checks run (BLOCKED / UNSTABLE / BEHIND) — NOT a conflict', () => {
    for (const s of ['BLOCKED', 'UNSTABLE', 'BEHIND', 'CLEAN']) {
      expect(classifyMergeView({ mergedAt: null, mergeStateStatus: s, state: 'OPEN' })).toBe('pending');
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/autonomous/__tests__/merge-classify.test.ts`
Expected: FAIL — `classifyMergeView` not exported from `drain-io.ts`.

- [ ] **Step 3: Implement `classifyMergeView` + `mergePr`**

```typescript
export type MergeOutcome = 'merged' | 'merge-conflict' | 'merge-timeout';

interface MergeView { mergedAt: string | null; mergeStateStatus: string; state: string; }

/** Pure verdict on one `gh pr view` payload. `pending` means "keep polling" — crucially,
 *  BLOCKED/UNSTABLE/BEHIND (checks running, branch protection, behind base) are NOT conflicts
 *  (CR round-1 HIGH-2); only DIRTY/CONFLICTING are. */
export function classifyMergeView(d: MergeView): 'merged' | 'merge-conflict' | 'pending' {
  if (d.mergedAt !== null || d.state === 'MERGED') return 'merged';
  if (d.mergeStateStatus === 'DIRTY' || d.mergeStateStatus === 'CONFLICTING') return 'merge-conflict';
  return 'pending';
}

/** Serialized squash-merge of one already-open PR, reusing the same --auto + poll machinery
 *  the K=1 child runs today (pr-flow.ts). Throws only on a systemic gh/spawn failure. */
export async function mergePr(
  cwd: string,
  slug: string,
  branch: string,
  pollTimeoutMs = 20 * 60 * 1000,
  pollIntervalMs = 10_000,
): Promise<MergeOutcome> {
  void slug;
  // Enqueue auto-merge. A non-zero exit here is usually "already enabled"/"not yet mergeable" —
  // NOT fatal; the poll below is the source of truth. Only a spawn error (ENOENT) throws.
  const enq = spawnSync('gh', ['pr', 'merge', branch, '--auto', '--squash'], { cwd, encoding: 'utf8' });
  if (enq.error) throw new Error(`gh pr merge spawn failed for ${branch}: ${enq.error.message}`);
  const deadline = Date.now() + pollTimeoutMs; // real wall-clock — fine in the IO adapter (not unit-tested)
  for (;;) {
    const view = spawnSync('gh', ['pr', 'view', branch, '--json', 'mergedAt,mergeStateStatus,state'], { cwd, encoding: 'utf8' });
    if (view.status !== 0) throw new Error(`gh pr view failed for ${branch}: ${(view.stderr ?? '').trim()}`);
    const verdict = classifyMergeView(JSON.parse(view.stdout) as MergeView);
    if (verdict === 'merged') return 'merged';
    if (verdict === 'merge-conflict') return 'merge-conflict';
    if (Date.now() > deadline) return 'merge-timeout';
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}
```

- [ ] **Step 4: Wire the dep + lock the coordinator contract**

In `queue-drain.ts`, import `mergePr` from `drain-io.js` and add to the `deps` object: `mergePr: (slug, branch) => mergePr(cwd, slug, branch)`.

Create `src/autonomous/__tests__/merge-coordinator.test.ts` to lock the conflict/timeout behavior of the Task-4 coordinator (these PASS as soon as Task 4 + the dep wiring are in — they are a contract characterization, not a new red, because the coordinator already handles `outcome !== 'merged'`):

```typescript
import { describe, expect, it, vi } from 'vitest';
import { runDrain, type DrainDeps, type DrainOpts } from '../drain-loop.js';
import type { DrainSource } from '../drain-source.js';

function coordHarness(initial: string[], badOn: Record<string, 'merge-conflict' | 'merge-timeout'> = {}) {
  let roadmap = [...initial];
  const source: DrainSource = {
    id: 'roadmap',
    nextItem: (skip) => { const s = roadmap.find((x) => !skip.has(x)); return s ? { slug: s, description: '', eligible: true } : null; },
    parseAll: () => [...roadmap],
    gatePrompt: () => '/gate',
    branchFor: (s) => `fast/${s}`,
  };
  const deps: DrainDeps = {
    source,
    spawnGate: vi.fn(async () => 0),
    syncMainCleanState: vi.fn(),
    mergePr: vi.fn(async (slug: string) => {
      if (badOn[slug]) return badOn[slug];
      roadmap = roadmap.filter((s) => s !== slug);
      return 'merged' as const;
    }),
    openPrExistsFor: vi.fn(() => true),
    writeState: vi.fn(),
    stopRequested: vi.fn(() => false),
  };
  const opts: DrainOpts = { maxFeatures: 20, maxRetries: 0, maxSpawns: 40, timeoutMs: 1000, dryRun: false, cwd: '/x', concurrency: 3, startupStaggerMs: 0 };
  return { deps, opts };
}

describe('merge coordinator contract', () => {
  it('conflict slug skipped, others ship', async () => {
    const h = coordHarness(['a', 'b', 'c'], { b: 'merge-conflict' });
    const r = await runDrain(h.deps, h.opts);
    expect(r.shipped).toBe(2);
    expect(r.skipped).toContain('b');
    expect(r.skipReasons?.b).toMatch(/conflict/i);
  });
  it('timeout slug skipped with a timeout reason, others ship', async () => {
    const h = coordHarness(['a', 'b', 'c'], { b: 'merge-timeout' });
    const r = await runDrain(h.deps, h.opts);
    expect(r.shipped).toBe(2);
    expect(r.skipReasons?.b).toMatch(/timeout/i);
  });
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm exec vitest run src/autonomous && pnpm typecheck`
Expected: PASS — `classifyMergeView` cases green; coordinator conflict/timeout contract green; all prior tests green; types clean.

- [ ] **Step 6: Commit**

```bash
git add src/autonomous/drain-io.ts src/autonomous/queue-drain.ts src/autonomous/__tests__/merge-classify.test.ts src/autonomous/__tests__/merge-coordinator.test.ts
git commit -m "feat(autonomous): mergeability-aware mergePr IO + coordinator contract tests"
```

---

## Task 7: Heartbeat — `inFlight[]` + `merging`

**Files:**
- Modify: `src/autonomous/drain-state.ts`
- Modify: `src/autonomous/drain-loop.ts` (writeState calls)
- Modify: `src/autonomous/queue-drain.ts` (state assembly)
- Modify: `src/autonomous/__tests__/*` (any drain-state assertion)

- [ ] **Step 1: Write/extend the failing test**

Add to a drain-state test (or build-pool): assert `writeState` receives an `inFlight` array reflecting concurrent builders and a `merging` field during a merge.

```typescript
it('writeState reports inFlight builders under concurrency', async () => {
  const seen: number[] = [];
  const deps = /* poolHarness deps */;
  deps.writeState = vi.fn((s: { inFlight: unknown[] }) => seen.push(s.inFlight.length));
  await runDrain(deps, { /* opts */ concurrency: 3 });
  expect(Math.max(...seen)).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/autonomous`
Expected: FAIL — `writeState` payload has `currentSlug`, not `inFlight`.

- [ ] **Step 3: Update the state shape**

```typescript
export interface InFlight { slug: string; phase: 'building' | 'awaiting-merge'; }
export interface DrainState {
  pid: number;
  startedAt: string;
  phase: 'spawning' | 'awaiting-merge' | 'idle';
  inFlight: InFlight[];
  merging: string | null;
  currentSlug: string | null; // derived: inFlight[0]?.slug ?? null (back-compat for readers)
  shipped: number;
  skip: string[];
  retries: Record<string, number>;
}
```

Update `DrainDeps.writeState`'s param type to carry `inFlight: InFlight[]` + `merging: string | null`. In `runDrain`, maintain an `inFlight` map (slug → phase) updated as workers spawn / enqueue and the coordinator merges; call `writeState` on each transition. In `queue-drain.ts`, assemble `DrainState` with `currentSlug: s.inFlight[0]?.slug ?? null`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/autonomous && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-state.ts src/autonomous/drain-loop.ts src/autonomous/queue-drain.ts src/autonomous/__tests__
git commit -m "feat(autonomous): heartbeat reports inFlight[] + merging"
```

---

## Task 8: Kill-switch drains in-flight, exits 130

**Files:**
- Modify: `src/autonomous/drain-loop.ts`
- Modify: `src/autonomous/__tests__/build-pool.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('stop after first build stops NEW scheduling, drains in-flight, exits 130', async () => {
  let stopped = false;
  const h = poolHarness(['a', 'b', 'c', 'd', 'e'], 2); // 5 queued, K=2
  h.deps.stopRequested = vi.fn(() => stopped);
  // Flip stop the instant the first builder resolves — so at most the 2 already in-flight run.
  const orig = h.deps.spawnGate;
  let n = 0;
  h.deps.spawnGate = vi.fn(async (env: Record<string, string>) => {
    const r = await orig(env, 1000, '/gate');
    if (++n === 1) stopped = true;
    return r;
  });
  const r = await runDrain(h.deps, h.opts);
  expect(r.exitCode).toBe(130);                       // stop wins over the 0 "drained" exit
  expect(h.assignedSlugs.length).toBeLessThanOrEqual(2); // never dispatched past the in-flight K — c/d/e never started
  expect(r.shipped).toBe(h.assignedSlugs.length);     // every in-flight build was drained through the coordinator (none orphaned)
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/autonomous/__tests__/build-pool.test.ts`
Expected: FAIL — without the stop precedence, exit is `0` (loop drained), not `130`; and/or scheduling continues past the in-flight K so `assignedSlugs.length > 2`.

- [ ] **Step 3: Implement graceful stop**

The worker loop already checks `deps.stopRequested()` at the top of each iteration (stops *new* scheduling); in-flight `await spawnGate` calls finish (no cancellation), and the coordinator drains whatever is already in `readyToMerge`. The final block from Task 4 already encodes the precedence — confirm it reads exactly:

```typescript
await Promise.all(workers);
buildersDone = true;
signalCoordinator();          // unblock a parked coordinator so it observes buildersDone
await coordinatorPromise;     // drain the in-flight merge queue
if (aborted) return result(1, aborted.message);   // abort (1) wins over stop
if (deps.stopRequested()) return result(130);     // stop (130) wins over the drained-0
return result(0);
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/autonomous`
Expected: PASS — exit 130, partial ships, no orphaned in-flight.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-loop.ts src/autonomous/__tests__/build-pool.test.ts
git commit -m "feat(autonomous): kill-switch drains in-flight then exits 130"
```

---

## Task 9: Full-suite + typecheck + lint gate

**Files:** none (verification task)

- [ ] **Step 1: Run the whole suite + typecheck + lint**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: PASS — all green. If any pre-existing-unrelated failures appear, note them but do not fix out of scope.

- [ ] **Step 2: Validate features + docs regen**

Run: `pnpm noldor validate features`
Expected: `Validated N feature MD(s) — all OK.`

- [ ] **Step 3: Commit any lint autofix**

```bash
git add -A
git commit -m "chore(autonomous): lint + typecheck clean for parallel-drain" || echo "nothing to commit"
```

---

## Task 10: FD link backfill + pr-flow doc note

**Files:**
- Modify: `docs/features/parallel-drain.md` (frontmatter `links.code` / `links.tests`)
- Modify: `docs/noldor/pr-flow.md` (open-only note)

- [ ] **Step 1: Seed `links.code` + `links.tests`**

Set the FD frontmatter arrays to the files this plan touched:

```yaml
links:
  code:
    - src/autonomous/drain-loop.ts
    - src/autonomous/drain-io.ts
    - src/autonomous/queue-drain.ts
    - src/autonomous/drain-state.ts
    - src/core/pr-flow.ts
    - src/core/pr-flow-cli.ts
    - .claude/skills/gate/SKILL.md
  tests:
    - src/autonomous/__tests__/run-drain.test.ts
    - src/autonomous/__tests__/build-pool.test.ts
    - src/autonomous/__tests__/merge-coordinator.test.ts
    - src/autonomous/__tests__/queue-drain-cli.test.ts
    - src/core/__tests__/pr-flow.test.ts
  spec: docs/superpowers/specs/2026-06-10-parallel-drain-design.md
```

- [ ] **Step 2: Note open-only in pr-flow.md**

Add a short paragraph to `docs/noldor/pr-flow.md`: under parallel drain (`--concurrency K>1`), `NOLDOR_DRAIN_OPEN_ONLY=1` makes `openAndAutoMerge` stop at PR-open; the drain supervisor's serialized merge coordinator owns the merge. K=1 is unchanged.

- [ ] **Step 3: Validate + commit**

```bash
pnpm noldor validate features
git add docs/features/parallel-drain.md docs/noldor/pr-flow.md
git commit -m "docs(features:parallel-drain): seed links + document open-only merge mode"
```

---

## Self-Review

**1. Spec coverage:**
- Build pool size K, refill → Task 4. ✓
- One PR per feature, per-FD CR, skip-on-fail isolation → preserved (each child is a full `/gate`); Task 4 coordinator skip-on-conflict/timeout. ✓
- Serialized merge → Task 4 coordinator (one merge at a time + post-merge local-main advance; NOT a pre-merge fetch — CR R1 MED-3). ✓
- `--concurrency 1` byte-for-byte → Tasks 1, 4 (`settleShipVerdict` K=1 inline path; the 12-case run-drain regression suite is the guarantee). ✓
- Assigned-slug dispatch (`NOLDOR_DRAIN_SLUG`) + gate change → Tasks 4, 5. ✓
- Worktree isolation unchanged → Task 4. The coordinator DOES advance local `main` (`syncMainCleanState`) after each merge — safe because children live in separate worktrees, and `worktree prune` is admin-only (CR R1 HIGH-1). ✓
- Success oracle per feature, post-merge → Task 4 coordinator (advance-then-`parseAll`). ✓
- Mergeability-aware merge (not immediate squash) → Task 6 `classifyMergeView` + `--auto`+poll (CR R1 HIGH-2). ✓
- `git`-lock contention across children → Task 4 launch stagger + documented limit (CR R1 MED-4). ✓
- `maxFeatures` counts in-flight → Task 4 (`shipped + dispatched.size`) (CR R1 MED-6). ✓
- Heartbeat `inFlight[]` + `merging` → Task 7. ✓
- Kill switch drains in-flight, exit 130 → Task 8. ✓
- Source-agnostic (no source/branch literal in scheduler) → pool uses `source.nextItem`/`branchFor` only. ✓
- Caps `--max-features` / `--max-spawns` / `--concurrency` → Tasks 2, 4. ✓

**2. Placeholder scan:** Task 5 Step 1 elides pr-flow fixture fields ("use the existing test's input-builder") and Task 7 Step 1 references "poolHarness deps" — both deliberate: the executor reuses the concrete harness/fixtures defined in Tasks 4/5's files. All logic-bearing code is concrete.

**3. Type consistency:** `MergeOutcome` = `'merged' | 'merge-conflict' | 'merge-timeout'` (drain-io) — the coordinator treats anything `!== 'merged'` as skip; the harness stubs return the same union. `classifyMergeView` returns `'merged' | 'merge-conflict' | 'pending'` (internal to the poll loop, not the dep). `settleShipVerdict` / `recordRetryOrSkip` / `envFor` / `signalCoordinator` names consistent across Tasks 4, 6, 8. `DrainDeps` gains exactly one new field — `mergePr` (added in Task 4, real IO in Task 6); `syncMainOnly` was considered and **rejected** (insufficient for the oracle) — it appears nowhere. `PrFlowResult.mergedAt` widened to `string | null` in Task 5.

**Resolved from CR round 1:** all 6 blockers (oracle authority HIGH-1, mergeability HIGH-2, serialization rationale MED-3, `.git` contention MED-4, `maxFeatures` accounting MED-6, Task-1 red baseline MED-5) — see "Correctness notes" at the top.

**Known risk carried to code review:** the pr-flow `openOnly` deviation from the spec's "child unchanged" non-goal (documented at top). If the reviewer rejects it, the alternative is mandating a GitHub merge queue and making the coordinator a pure monitor — larger ops dependency, no fallback. The `.git`-lock stagger (MED-4) is a *mitigation*, not elimination — flagged for the integration run to stress at K=4.
