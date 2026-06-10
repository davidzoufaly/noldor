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

This keeps K=1 untouched (the merge-coordinator risk is opt-in at K>1) and makes the fallback (no merge queue) correct. If a GitHub merge queue *is* enabled on `main`, the coordinator's `gh pr merge --squash` enqueues into it — same code path, platform serializes. The only behavioral change to a child is *who issues the merge*, gated entirely by an env var the operator never sets by hand. **This deviation from the "child unchanged" non-goal is deliberate and is the single most important thing for the plan reviewer to accept or reject.**

## File structure

- `src/autonomous/drain-loop.ts` — `runDrain` → `async`; add the build pool + serialized merge coordinator; `decideNext` stays a pure sync function. `DrainDeps.spawnGate` → returns `Promise<number>`; add `mergePr` + `syncMainOnly` deps.
- `src/autonomous/drain-io.ts` — `spawnGate` → async (`spawn`); add `mergePr` (serialized `gh pr merge --squash` + conflict detection) and `syncMainOnly` (fetch + ff-only, no checkout-churn for the coordinator).
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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/davidzoufaly/code/noldor/.worktrees/parallel-drain && pnpm exec vitest run src/autonomous/__tests__/run-drain.test.ts`
Expected: FAIL — `runDrain` is still sync (returns `DrainResult`, not a Promise), `await` yields the object but `spawnGate` signature mismatch surfaces as a type error under `pnpm typecheck`; runtime tests fail on `r.exitCode` of a non-awaited value if sync. (The point is a red baseline before the async refactor.)

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
    res = await runDrain(deps, { ...parsed, cwd });
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

## Task 4: Build pool — K workers, assigned-slug dispatch

**Files:**
- Modify: `src/autonomous/drain-loop.ts`
- Create: `src/autonomous/__tests__/build-pool.test.ts`

The pool replaces the sequential `for (;;)`. It must (a) keep ≤ K spawns in flight, (b) call `decideNext` per slug, (c) assign each child its exact slug via `NOLDOR_DRAIN_SLUG`, (d) keep the success-oracle + retry-then-skip semantics per feature, (e) reduce to the Task-1 sequential behavior at `concurrency: 1`.

Because `source.nextItem(skip)` is the only selector and it returns *one* candidate at a time keyed off the live `skip` set, the pool serializes *selection* (a tiny critical section) but parallelizes *spawning*. A worker: pick next → mark in-flight (add to a transient `dispatched` set so the next worker's `nextItem` doesn't re-pick it) → `await spawnGate` → run the per-feature oracle → record shipped/retry/skip.

- [ ] **Step 1: Write the failing test (K in flight, refill, assigned slug)**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { runDrain, type DrainDeps, type DrainOpts } from '../drain-loop.js';
import type { DrainSource } from '../drain-source.js';

function poolHarness(initial: string[], concurrency: number) {
  let roadmap = [...initial];
  let inFlight = 0;
  let peak = 0;
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
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    roadmap = roadmap.filter((s) => s !== env.NOLDOR_DRAIN_SLUG); // ships
    return 0;
  });
  const deps: DrainDeps = {
    source,
    spawnGate,
    syncMainCleanState: vi.fn(),
    syncMainOnly: vi.fn(),
    mergePr: vi.fn(async () => 'merged' as const),
    openPrExistsFor: vi.fn(() => false),
    writeState: vi.fn(),
    stopRequested: vi.fn(() => false),
  };
  const opts: DrainOpts = {
    maxFeatures: 20, maxRetries: 2, maxSpawns: 40, timeoutMs: 1000,
    dryRun: false, cwd: '/x', concurrency,
  };
  return { deps, opts, get peak() { return peak; }, assignedSlugs };
}

describe('build pool', () => {
  it('keeps at most K spawns in flight and ships all', async () => {
    const h = poolHarness(['a', 'b', 'c', 'd', 'e'], 3);
    const r = await runDrain(h.deps, h.opts);
    expect(r.shipped).toBe(5);
    expect(h.peak).toBeLessThanOrEqual(3);
    expect(h.peak).toBeGreaterThan(1); // genuinely parallel
  });
  it('assigns each child its exact slug via NOLDOR_DRAIN_SLUG', async () => {
    const h = poolHarness(['a', 'b', 'c'], 3);
    await runDrain(h.deps, h.opts);
    expect([...h.assignedSlugs].sort()).toEqual(['a', 'b', 'c']);
  });
  it('concurrency 1 → strictly sequential (peak 1)', async () => {
    const h = poolHarness(['a', 'b', 'c'], 1);
    await runDrain(h.deps, h.opts);
    expect(h.peak).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/autonomous/__tests__/build-pool.test.ts`
Expected: FAIL — `DrainDeps` has no `syncMainOnly`/`mergePr` yet; `runDrain` does not parallelize; `NOLDOR_DRAIN_SLUG` not passed.

- [ ] **Step 3: Implement the pool**

Add `NOLDOR_DRAIN_SLUG` to the spawn env. Replace the sequential `for` with `concurrency` worker loops sharing the `skip`/`retries`/`shipped` state, guarded by a synchronous selection critical section (JS is single-threaded; the only await is the spawn, so reads/writes to the shared sets between awaits are atomic). Extract the per-slug "ship verdict" into a helper so K=1 and K>1 share it.

```typescript
// env now carries the assigned slug:
const env = {
  NOLDOR_DRAIN: '1',
  NOLDOR_DRAIN_SLUG: candidate.slug,
  NOLDOR_DRAIN_SKIP: [...skip].join(','),
  ...(opts.concurrency > 1 ? { NOLDOR_DRAIN_OPEN_ONLY: '1' } : {}),
};
```

Pool skeleton (selection + dispatch; merge handling lands in Task 6 — for this task, after `spawnGate` resolves, run the oracle inline as today):

```typescript
const dispatched = new Set<string>(); // in-flight slugs, excluded from selection
let shipped = 0, spawns = 0, aborted: Error | null = null;

async function worker(): Promise<void> {
  for (;;) {
    if (aborted || deps.stopRequested()) return;
    // ---- selection critical section (synchronous, no await) ----
    const candidate = deps.source.nextItem(new Set([...skip, ...dispatched]));
    if (candidate === null) return; // nothing left for this worker
    const d = decideNext({ candidate, shipped, maxFeatures: opts.maxFeatures, spawns, maxSpawns: opts.maxSpawns });
    if (d.action === 'done') return;
    if (d.action === 'skip-out-of-scope') {
      skip.add(candidate.slug);
      if (candidate.reason !== undefined) skipReasons[candidate.slug] = candidate.reason;
      continue;
    }
    const branch = deps.source.branchFor(candidate.slug);
    if (deps.openPrExistsFor(candidate.slug, branch)) { skip.add(candidate.slug); continue; }
    if (opts.dryRun) { planned.push(candidate.slug); skip.add(candidate.slug); continue; }
    spawns += 1;
    dispatched.add(candidate.slug);
    // ---- end critical section ----
    try {
      await deps.spawnGate(envFor(candidate.slug, skip, opts), opts.timeoutMs, deps.source.gatePrompt(candidate.slug));
      await settleShipVerdict(candidate.slug, branch); // oracle + retry/skip (shared helper)
    } catch (e) {
      if (e instanceof Error && e.message === 'iteration-timeout') {
        recordRetryOrSkip(candidate.slug);
      } else { aborted = e instanceof Error ? e : new Error(String(e)); return; }
    } finally {
      dispatched.delete(candidate.slug);
    }
  }
}

try {
  deps.syncMainCleanState();
  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, () => worker());
  await Promise.all(workers);
  if (aborted) return result(1, aborted.message);
  if (deps.stopRequested()) return result(130);
  return result(0);
} catch (err) {
  return result(1, err instanceof Error ? err.message : String(err));
}
```

`settleShipVerdict` (K=1 inline-merge path uses `syncMainCleanState` exactly like today; K>1 path is wired in Task 6):

```typescript
async function settleShipVerdict(slug: string, branch: string): Promise<void> {
  if (opts.concurrency === 1) deps.syncMainCleanState(); // unchanged sequential authority
  const stillPresent = deps.source.parseAll().includes(slug);
  if (!stillPresent) { shipped += 1; retries.delete(slug); return; }
  if (deps.openPrExistsFor(slug, branch)) { skip.add(slug); return; }
  recordRetryOrSkip(slug);
}
function recordRetryOrSkip(slug: string): void {
  const n = (retries.get(slug) ?? 0) + 1;
  retries.set(slug, n);
  if (n > opts.maxRetries) skip.add(slug);
}
```

Add a `envFor(slug, skip, opts)` helper returning the env object shown above.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/autonomous/__tests__/build-pool.test.ts src/autonomous/__tests__/run-drain.test.ts`
Expected: PASS — pool caps at K, ships all, assigns slugs; the 12 regression cases still pass at concurrency 1 (peak 1, inline merge unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-loop.ts src/autonomous/__tests__/build-pool.test.ts
git commit -m "feat(autonomous): K-bounded build pool with assigned-slug dispatch"
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

## Task 6: Serialized merge coordinator

**Files:**
- Modify: `src/autonomous/drain-io.ts` (add `mergePr`, `syncMainOnly`)
- Modify: `src/autonomous/drain-loop.ts` (wire coordinator at K>1)
- Create: `src/autonomous/__tests__/merge-coordinator.test.ts`

The coordinator is a single async lane fed by a FIFO queue of `{ slug, branch }` that workers push when their child returns at PR-open (K>1). It pops one, `git fetch origin main` (so the merge rebases on the prior), `gh pr merge <branch> --squash`, then runs the per-feature oracle. A merge that exits non-zero with conflict signature → mark `merge-conflict`, leave PR open, skip; continue with the rest.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { runDrain, type DrainDeps, type DrainOpts } from '../drain-loop.js';
import type { DrainSource } from '../drain-source.js';

function coordHarness(initial: string[], conflictOn: string[] = []) {
  let roadmap = [...initial];
  let merging = 0, mergePeak = 0;
  const mergeOrder: string[] = [];
  const source: DrainSource = {
    id: 'roadmap',
    nextItem: (skip) => { const s = roadmap.find((x) => !skip.has(x)); return s ? { slug: s, description: '', eligible: true } : null; },
    parseAll: () => [...roadmap],
    gatePrompt: () => '/gate',
    branchFor: (s) => `fast/${s}`,
  };
  const deps: DrainDeps = {
    source,
    spawnGate: vi.fn(async () => 0), // child opens PR; does not ship
    syncMainCleanState: vi.fn(),
    syncMainOnly: vi.fn(),
    mergePr: vi.fn(async (slug: string) => {
      merging += 1; mergePeak = Math.max(mergePeak, merging);
      await new Promise((r) => setTimeout(r, 3));
      merging -= 1;
      mergeOrder.push(slug);
      if (conflictOn.includes(slug)) return 'merge-conflict' as const;
      roadmap = roadmap.filter((s) => s !== slug); // merge ships it
      return 'merged' as const;
    }),
    openPrExistsFor: vi.fn(() => true), // child opened a PR
    writeState: vi.fn(),
    stopRequested: vi.fn(() => false),
  };
  const opts: DrainOpts = { maxFeatures: 20, maxRetries: 0, maxSpawns: 40, timeoutMs: 1000, dryRun: false, cwd: '/x', concurrency: 3 };
  return { deps, opts, get mergePeak() { return mergePeak; }, mergeOrder };
}

describe('merge coordinator', () => {
  it('serializes merges (peak 1) even with K=3 builders', async () => {
    const h = coordHarness(['a', 'b', 'c']);
    const r = await runDrain(h.deps, h.opts);
    expect(h.mergePeak).toBe(1);   // at most one merge at a time
    expect(r.shipped).toBe(3);
  });
  it('a merge-conflict slug is skipped, others still ship', async () => {
    const h = coordHarness(['a', 'b', 'c'], ['b']);
    const r = await runDrain(h.deps, h.opts);
    expect(r.shipped).toBe(2);
    expect(r.skipped).toContain('b');
    expect(r.skipReasons?.b).toMatch(/conflict/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/autonomous/__tests__/merge-coordinator.test.ts`
Expected: FAIL — no coordinator; `mergePr` never called; merges not serialized.

- [ ] **Step 3: Implement `mergePr` + `syncMainOnly` in drain-io**

```typescript
/** Fetch origin/main + ff-only, WITHOUT the checkout/prune churn of syncMainCleanState.
 *  Used by the merge coordinator between serialized merges so each rebases on the prior. */
export function syncMainOnly(cwd: string): void {
  execFileSync('git', ['fetch', 'origin', 'main'], { cwd, stdio: 'pipe' });
}

export type MergeOutcome = 'merged' | 'merge-conflict';

/** Serialized squash-merge of one open PR. Returns 'merge-conflict' (leave PR open, skip)
 *  on a merge/rebase conflict; throws on a systemic gh failure (caller aborts fail-closed). */
export function mergePr(cwd: string, slug: string, branch: string): MergeOutcome {
  void slug;
  const res = spawnSync('gh', ['pr', 'merge', branch, '--squash'], { cwd, encoding: 'utf8' });
  if (res.status === 0) return 'merged';
  const blob = `${res.stdout ?? ''}${res.stderr ?? ''}`.toLowerCase();
  if (/conflict|not mergeable|merge commit cannot|blocked/.test(blob)) return 'merge-conflict';
  throw new Error(`gh pr merge failed for ${branch}: ${blob.trim() || `exit ${res.status}`}`);
}
```

- [ ] **Step 4: Wire the coordinator into `runDrain` (K>1)**

Add `mergePr: (slug: string, branch: string) => Promise<MergeOutcome>` and `syncMainOnly: () => void` to `DrainDeps`. At `concurrency > 1`, workers push `{ slug, branch }` onto a `readyToMerge` queue after `spawnGate` resolves **and** `openPrExistsFor` confirms a PR; a single coordinator loop (started alongside the workers) pops one at a time:

```typescript
const readyToMerge: Array<{ slug: string; branch: string }> = [];
let buildersDone = false;

async function coordinator(): Promise<void> {
  for (;;) {
    if (aborted) return;
    const next = readyToMerge.shift();
    if (next === undefined) {
      if (buildersDone) return;
      await new Promise((r) => setTimeout(r, 10)); // idle wait for the next ready PR
      continue;
    }
    deps.syncMainOnly(); // rebase-on-prior: fetch latest main before this merge
    try {
      const outcome = await deps.mergePr(next.slug, next.branch);
      if (outcome === 'merge-conflict') {
        skip.add(next.slug);
        skipReasons[next.slug] = 'merge-conflict — PR left open for human resolution';
        continue;
      }
    } catch (e) { aborted = e instanceof Error ? e : new Error(String(e)); return; }
    // success oracle, per feature, after THIS merge:
    const stillPresent = deps.source.parseAll().includes(next.slug);
    if (!stillPresent) { shipped += 1; retries.delete(next.slug); }
    else { recordRetryOrSkip(next.slug); }
  }
}
```

In `worker()` (K>1 branch of `settleShipVerdict`), instead of running the oracle inline, enqueue: `if (opts.concurrency > 1) { if (deps.openPrExistsFor(slug, branch)) readyToMerge.push({ slug, branch }); else recordRetryOrSkip(slug); return; }`. After `Promise.all(workers)` set `buildersDone = true` and `await coordinatorPromise`. Start `const coordinatorPromise = opts.concurrency > 1 ? coordinator() : Promise.resolve();` before the workers.

Wire the deps in `queue-drain.ts`: `mergePr: (slug, branch) => Promise.resolve(mergePr(cwd, slug, branch))`, `syncMainOnly: () => syncMainOnly(cwd)`.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm exec vitest run src/autonomous`
Expected: PASS — coordinator serializes (peak 1), conflict slug skipped with reason, others ship; all prior tests green.

- [ ] **Step 6: Commit**

```bash
git add src/autonomous/drain-io.ts src/autonomous/drain-loop.ts src/autonomous/queue-drain.ts src/autonomous/__tests__/merge-coordinator.test.ts
git commit -m "feat(autonomous): serialized merge coordinator (rebase-between, conflict→skip)"
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
it('stop request stops new scheduling, drains in-flight, exits 130', async () => {
  let stopped = false;
  const h = poolHarness(['a', 'b', 'c', 'd', 'e'], 2);
  h.deps.stopRequested = vi.fn(() => stopped);
  // flip stop after the first spawn resolves:
  const orig = h.deps.spawnGate;
  let n = 0;
  h.deps.spawnGate = vi.fn(async (env) => { const r = await orig(env, 1000, '/gate'); if (++n === 1) stopped = true; return r; });
  const r = await runDrain(h.deps, h.opts);
  expect(r.exitCode).toBe(130);
  // already-in-flight builders finished (no throw); no NEW spawn after stop beyond the in-flight ≤K:
  expect(h.assignedSlugs.length).toBeLessThan(5);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/autonomous/__tests__/build-pool.test.ts`
Expected: FAIL — stop currently only checked at top; exit code not 130 after partial drain.

- [ ] **Step 3: Implement graceful stop**

Worker loop already checks `deps.stopRequested()` at the top of each iteration (stops *new* scheduling). Ensure in-flight `await spawnGate` calls are allowed to finish (they are — no cancellation), then the coordinator drains whatever PRs are already `readyToMerge` before returning. After `Promise.all(workers)`, if `deps.stopRequested()` is true, still `await coordinatorPromise` (drain the merge queue) and `return result(130)` (precedence: 130 over 0 when stop was requested; abort 1 still wins over 130).

```typescript
await Promise.all(workers);
buildersDone = true;
await coordinatorPromise;
if (aborted) return result(1, aborted.message);
if (deps.stopRequested()) return result(130);
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
- One PR per feature, per-FD CR, skip-on-fail isolation → preserved (each child is a full `/gate`); Task 6 skip-on-conflict. ✓
- Serialized merge, rebase-between → Task 6 (`syncMainOnly` fetch between merges). ✓
- `--concurrency 1` byte-for-byte → Tasks 1, 4 (`settleShipVerdict` inline-merge at K=1; peak-1 test). ✓
- Assigned-slug dispatch (`NOLDOR_DRAIN_SLUG`) + gate change → Tasks 4, 5. ✓
- Worktree isolation unchanged; no mid-flight `syncMainCleanState` at K>1 → Task 4 (coordinator uses `syncMainOnly`, no checkout). ✓
- Success oracle per feature → Tasks 4/6. ✓
- Heartbeat `inFlight[]` + `merging` → Task 7. ✓
- Kill switch drains in-flight, exit 130 → Task 8. ✓
- Source-agnostic (no source/branch literal in scheduler) → pool uses `source.nextItem`/`branchFor` only. ✓
- Caps `--max-features` / `--max-spawns` / `--concurrency` → Tasks 2, 4 (`decideNext` caps unchanged). ✓

**2. Placeholder scan:** Task 5 Step 1 elides fixture fields ("use the existing test's input-builder") — acceptable because the executor must match the real fixture shape in that file; all logic-bearing code is concrete.

**3. Type consistency:** `MergeOutcome` ('merged' | 'merge-conflict') used in drain-io + drain-loop + tests. `settleShipVerdict` / `recordRetryOrSkip` / `envFor` names consistent across Tasks 4, 6, 8. `DrainDeps` gains `mergePr` + `syncMainOnly` in Task 6, referenced by Task-4 harness (which stubs them ahead of wiring — intentional, both are `vi.fn()` in the pool harness). `PrFlowResult.mergedAt` widened to `string | null` in Task 5.

**Known risk carried to code review:** the pr-flow `openOnly` deviation from the spec's "child unchanged" non-goal (documented at top). If the reviewer rejects it, the alternative is mandating a GitHub merge queue and making the coordinator a pure monitor — larger ops dependency, no fallback.
