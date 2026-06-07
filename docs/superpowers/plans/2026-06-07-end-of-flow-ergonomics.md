# End-of-Flow Ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream throttled auto-merge poll status to the operator, and fix the post-merge worktree-cleanup instructions so they actually remove the worktree (no silent leak).

**Architecture:** Part (b) adds two injected seams (`onStatus`, `now`) to `pollAutoMerge` in `src/core/pr-flow.ts`, widens the `gh pr view` field set with `mergeStateStatus`, and emits a status line on the first cycle, on any `state`/`mergeStateStatus` change, or every ≥30s (emit-on-change OR throttle). The CLI wires `onStatus` to stderr. Part (a) is doc/skill-only: replace the `ExitWorktree`-tool cleanup instruction with the non-interactive `git worktree remove` + `git branch -D` sequence (`-D` because the squash-merge leaves the branch's commits non-ancestor of `main`, so `-d` rejects) across `gate/SKILL.md`, `docs/noldor/pr-flow.md`, and `docs/noldor/worktree-discipline.md` (3 refs) — all three kept consistent to avoid Detector 14/15 drift. Plus an FD-metadata reconciliation before the `phase: done` flip: remap the whole stale `scripts/*` `links.code` block to `src/*`, add the untracked `cr-pipeline.md` to `links.docs`, and regenerate the Resources block.

**Tech Stack:** TypeScript, vitest, Node child_process, `gh` CLI.

---

## File Structure

- `src/core/pr-flow.ts` — add `onStatus`/`now` to `pollAutoMerge` opts + `OpenAndAutoMergeInput`; widen `--json`; throttle emit; thread callback through `openAndAutoMerge`.
- `src/core/pr-flow-cli.ts` — pass `onStatus: (line) => process.stderr.write(line + '\n')` into `openAndAutoMerge`.
- `src/core/__tests__/pr-flow.test.ts` — new `describe` block for status streaming (real timers, `intervalMs: 1`, injected settable clock).
- `.claude/skills/gate/SKILL.md` — Step 4 cleanup bullet (`git worktree remove` + `git branch -D`).
- `docs/noldor/pr-flow.md` — flow-diagram line + local-main-sync paragraph.
- `docs/noldor/worktree-discipline.md` — 3× `git branch -d` → `-D` (squash-merge correctness; keep docs consistent).
- `docs/features/noldor.md` — remap all stale `scripts/*` `links.code` entries → `src/*`, add `cr-pipeline.md` to `links.docs` (16→17 pages), regen the generated Resources block, phase → done.

---

## Task 1: Status streaming in `pollAutoMerge` (Part b)

**Files:**
- Modify: `src/core/pr-flow.ts` (`pollAutoMerge` ~line 194; `OpenAndAutoMergeInput` ~line 221; `openAndAutoMerge` poll call ~line 268)
- Test: `src/core/__tests__/pr-flow.test.ts`

- [x] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `src/core/__tests__/pr-flow.test.ts` (NOT inside the existing fake-timers blocks — these use real timers with a tiny interval and a settable clock the `spawn` mock advances):

```ts
describe('pollAutoMerge status streaming', () => {
  // Settable clock: the spawn mock advances `nowMs` per poll cycle, so the
  // test controls elapsed time regardless of how many times now() is read
  // within a cycle (deadline + throttle + elapsed all read it).
  it('emits on first non-merged cycle with state/mergeStateStatus/elapsed', async () => {
    let nowMs = 0;
    const lines: string[] = [];
    let cycle = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      cycle += 1;
      nowMs += 10_000; // 10s per cycle
      if (cycle >= 2) {
        return { stdout: JSON.stringify({ mergedAt: '2026-06-07T00:00:00Z', state: 'MERGED', mergeStateStatus: 'CLEAN' }), exitCode: 0 };
      }
      return { stdout: JSON.stringify({ mergedAt: null, state: 'OPEN', mergeStateStatus: 'BLOCKED' }), exitCode: 0 };
    });
    await pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 1,
      timeoutMs: 600_000,
      onStatus: (l) => lines.push(l),
      now: () => nowMs,
    });
    expect(lines).toEqual(['Auto-merge: state=OPEN, mergeStateStatus=BLOCKED, elapsed=10s']);
  });

  it('throttles: no second emit < 30s, emits at >= 30s', async () => {
    let nowMs = 0;
    const lines: string[] = [];
    let cycle = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      cycle += 1;
      nowMs += 10_000; // cycles at elapsed 10s,20s,30s,40s
      if (cycle >= 5) {
        return { stdout: JSON.stringify({ mergedAt: '2026-06-07T00:00:00Z', state: 'MERGED', mergeStateStatus: 'CLEAN' }), exitCode: 0 };
      }
      return { stdout: JSON.stringify({ mergedAt: null, state: 'OPEN', mergeStateStatus: 'BLOCKED' }), exitCode: 0 };
    });
    await pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 1,
      timeoutMs: 600_000,
      onStatus: (l) => lines.push(l),
      now: () => nowMs,
    });
    // emit at 10s (first), skip 20s (<30s since last), skip 30s (=20s since last),
    // emit at 40s (=30s since last emit at 10s).
    expect(lines).toEqual([
      'Auto-merge: state=OPEN, mergeStateStatus=BLOCKED, elapsed=10s',
      'Auto-merge: state=OPEN, mergeStateStatus=BLOCKED, elapsed=40s',
    ]);
  });

  it('emits immediately on a state/mergeStateStatus transition inside the 30s window', async () => {
    let nowMs = 0;
    const lines: string[] = [];
    let cycle = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      cycle += 1;
      nowMs += 10_000; // cycles at elapsed 10s, 20s, ...
      if (cycle === 1) {
        return { stdout: JSON.stringify({ mergedAt: null, state: 'OPEN', mergeStateStatus: 'BLOCKED' }), exitCode: 0 };
      }
      if (cycle === 2) {
        // transition at elapsed 20s (<30s since first emit) — must emit on change
        return { stdout: JSON.stringify({ mergedAt: null, state: 'BEHIND', mergeStateStatus: 'BEHIND' }), exitCode: 0 };
      }
      return { stdout: JSON.stringify({ mergedAt: '2026-06-07T00:00:00Z', state: 'MERGED', mergeStateStatus: 'CLEAN' }), exitCode: 0 };
    });
    await pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 1,
      timeoutMs: 600_000,
      onStatus: (l) => lines.push(l),
      now: () => nowMs,
    });
    expect(lines).toEqual([
      'Auto-merge: state=OPEN, mergeStateStatus=BLOCKED, elapsed=10s',
      'Auto-merge: state=BEHIND, mergeStateStatus=BEHIND, elapsed=20s',
    ]);
  });

  it('emits nothing on instant merge (first cycle already merged)', async () => {
    let nowMs = 0;
    const lines: string[] = [];
    const spawn: SpawnFn = vi.fn(async () => {
      nowMs += 10_000;
      return { stdout: JSON.stringify({ mergedAt: '2026-06-07T00:00:00Z', state: 'MERGED', mergeStateStatus: 'CLEAN' }), exitCode: 0 };
    });
    const r = await pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 1,
      timeoutMs: 600_000,
      onStatus: (l) => lines.push(l),
      now: () => nowMs,
    });
    expect(r.mergedAt).toBe('2026-06-07T00:00:00Z');
    expect(lines).toEqual([]);
  });

  it('prints UNKNOWN when mergeStateStatus absent', async () => {
    let nowMs = 0;
    const lines: string[] = [];
    let cycle = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      cycle += 1;
      nowMs += 10_000;
      if (cycle >= 2) {
        return { stdout: JSON.stringify({ mergedAt: '2026-06-07T00:00:00Z', state: 'MERGED' }), exitCode: 0 };
      }
      return { stdout: JSON.stringify({ mergedAt: null, state: 'OPEN' }), exitCode: 0 };
    });
    await pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 1,
      timeoutMs: 600_000,
      onStatus: (l) => lines.push(l),
      now: () => nowMs,
    });
    expect(lines).toEqual(['Auto-merge: state=OPEN, mergeStateStatus=UNKNOWN, elapsed=10s']);
  });

  it('does not emit on a failed (non-zero) gh fetch cycle', async () => {
    let nowMs = 0;
    const lines: string[] = [];
    let cycle = 0;
    const spawn: SpawnFn = vi.fn(async () => {
      cycle += 1;
      nowMs += 10_000;
      if (cycle === 1) return { stdout: '', exitCode: 1 }; // failed fetch, no state
      return { stdout: JSON.stringify({ mergedAt: '2026-06-07T00:00:00Z', state: 'MERGED', mergeStateStatus: 'CLEAN' }), exitCode: 0 };
    });
    await pollAutoMerge({
      prUrl: 'https://github.com/x/y/pull/1',
      spawn,
      intervalMs: 1,
      timeoutMs: 600_000,
      onStatus: (l) => lines.push(l),
      now: () => nowMs,
    });
    expect(lines).toEqual([]); // cycle 1 failed (no emit), cycle 2 merged (returns before emit)
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd .worktrees/end-of-flow-ergonomics && pnpm vitest run src/core/__tests__/pr-flow.test.ts -t "status streaming"`
Expected: FAIL — `onStatus`/`now` not in opts type (TS error) or lines empty (no emit logic yet).

- [x] **Step 3: Add the seams + throttle to `pollAutoMerge`**

In `src/core/pr-flow.ts`, replace the `pollAutoMerge` signature opts and body. New signature opts add two optional fields:

```ts
export async function pollAutoMerge(opts: {
  prUrl: string;
  spawn: SpawnFn;
  intervalMs: number;
  timeoutMs: number;
  onStatus?: (line: string) => void;
  now?: () => number;
}): Promise<{ mergedAt: string }> {
  const now = opts.now ?? Date.now;
  const STATUS_THROTTLE_MS = 30_000;
  const start = now();
  let extendedDeadline = opts.timeoutMs;
  let behindObserved = false;
  let lastEmitMs: number | null = null;
  let lastState: string | null = null;
  let lastMss: string | null = null;

  while (now() - start < extendedDeadline) {
    const r = await opts.spawn('gh', [
      'pr',
      'view',
      opts.prUrl,
      '--json',
      'mergedAt,state,mergeStateStatus',
    ]);
    if (r.exitCode === 0) {
      const data = JSON.parse(r.stdout) as {
        mergedAt: string | null;
        state: string;
        mergeStateStatus?: string | null;
      };
      if (data.mergedAt) return { mergedAt: data.mergedAt };
      if (data.state === 'CLOSED') throw new PrClosedWithoutMergeError(opts.prUrl);
      if (data.state === 'BEHIND' && !behindObserved) {
        behindObserved = true;
        // Absolute ceiling from poll start — not from when BEHIND was first seen
        extendedDeadline = BEHIND_TIMEOUT_MS;
      }
      if (opts.onStatus) {
        const mss = data.mergeStateStatus ?? 'UNKNOWN';
        const elapsedMs = now() - start;
        // Emit on first cycle, on any meaningful transition (so OPEN→BEHIND /
        // BLOCKED→CLEAN surface immediately, not after the 30s window), or when
        // the steady-state throttle window has elapsed. No anti-flap guard: if
        // state/mergeStateStatus oscillated every cycle it would emit every
        // cycle, but GH merge states do not flap in practice (monotonic toward
        // CLEAN/MERGED), so the simplicity is worth it.
        const changed = data.state !== lastState || mss !== lastMss;
        if (lastEmitMs === null || changed || elapsedMs - lastEmitMs >= STATUS_THROTTLE_MS) {
          opts.onStatus(
            `Auto-merge: state=${data.state}, mergeStateStatus=${mss}, elapsed=${Math.floor(elapsedMs / 1000)}s`,
          );
          lastEmitMs = elapsedMs;
          lastState = data.state;
          lastMss = mss;
        }
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, opts.intervalMs));
  }
  throw new MergeTimeoutError(opts.prUrl);
}
```

- [x] **Step 4: Thread `onStatus` through `openAndAutoMerge`**

In `src/core/pr-flow.ts`, add `onStatus` to `OpenAndAutoMergeInput`:

```ts
export interface OpenAndAutoMergeInput extends PrFlowInput {
  spawn: SpawnFn;
  intervalMs?: number;
  timeoutMs?: number;
  onStatus?: (line: string) => void;
}
```

And pass it into the `pollAutoMerge` call inside `openAndAutoMerge` (the `if (merge.exitCode === 0)` branch):

```ts
    const polled = await pollAutoMerge({
      prUrl,
      spawn: input.spawn,
      intervalMs: input.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      onStatus: input.onStatus,
    });
```

- [x] **Step 5: Run tests to verify they pass**

Run: `cd .worktrees/end-of-flow-ergonomics && pnpm vitest run src/core/__tests__/pr-flow.test.ts`
Expected: PASS — new `status streaming` block green AND all pre-existing `pollAutoMerge` / `openAndAutoMerge` tests still green (callback + field are optional; existing JSON without `mergeStateStatus` still parses).

- [x] **Step 6: Typecheck**

Run: `cd .worktrees/end-of-flow-ergonomics && pnpm typecheck`
Expected: no errors.

- [x] **Step 7: Commit**

```bash
cd .worktrees/end-of-flow-ergonomics
git add src/core/pr-flow.ts src/core/__tests__/pr-flow.test.ts
git commit -m "feat(noldor): stream auto-merge poll status (emit-on-change + throttle)" -m "Noldor-FD: noldor"
```

---

## Task 2: Wire `onStatus` to stderr in the CLI (Part b)

**Files:**
- Modify: `src/core/pr-flow-cli.ts` (the `openAndAutoMerge({...})` call ~line 176-189)

- [x] **Step 1: Add the `onStatus` wiring**

In `src/core/pr-flow-cli.ts`, add one line to the `openAndAutoMerge` call object (after `spawn: nodeSpawn(),`):

```ts
  const result = await openAndAutoMerge({
    cwd,
    branch,
    base: 'main',
    repoUrl,
    session,
    fd,
    specPath,
    planPath,
    crResults,
    headSha,
    firstCommitSubject,
    spawn: nodeSpawn(),
    onStatus: (line) => process.stderr.write(line + '\n'),
  });
```

Rationale: status lines go to stderr so the machine-readable `PR merged: <url>` line on stdout stays clean.

- [x] **Step 2: Typecheck**

Run: `cd .worktrees/end-of-flow-ergonomics && pnpm typecheck`
Expected: no errors.

- [x] **Step 3: Run the CLI test suite to confirm no regression**

Run: `cd .worktrees/end-of-flow-ergonomics && pnpm vitest run src/core/__tests__/pr-flow-cli.test.ts`
Expected: PASS (no behavioral change to existing assertions).

- [x] **Step 4: Commit**

```bash
cd .worktrees/end-of-flow-ergonomics
git add src/core/pr-flow-cli.ts
git commit -m "feat(noldor): wire auto-merge status to stderr in CLI" -m "Noldor-FD: noldor"
```

---

## Task 3: Fix worktree-cleanup instructions (Part a, doc/skill only)

**Files:**
- Modify: `.claude/skills/gate/SKILL.md` (Step 4 "On merged" → "Worktree-backed paths" bullet)
- Modify: `docs/noldor/pr-flow.md` (flow-diagram cleanup line + local-main-sync paragraph)
- Modify: `docs/noldor/worktree-discipline.md` (3× `git branch -d` → `-D`)

> NOTE: `.claude/skills/**` is a shared-root path blocked from worktree commits by the pre-commit hook. This task's commit needs `NOLDOR_ALLOW_SHARED=1` (see worktree-discipline.md). The edit is intentional and in-scope per the FD.
>
> **Why `-D` not `-d`:** the PR is squash-merged, so the feature branch's commits are not ancestors of `main`. `git branch -d` rejects with "not fully merged" and the branch leaks. Use the force delete `-D`. All three docs must agree on `-D` or Detector 14/15 flags the contradiction.

- [x] **Step 1: Edit `.claude/skills/gate/SKILL.md`**

Find the Step 4 cleanup bullet (search for `**Worktree-backed paths**`). Replace the `ExitWorktree` instruction. The current text:

```
  - **Worktree-backed paths** (`fast-track`, `specs-only-*`, `full-*`): `ExitWorktree` native tool with `action: 'remove'` — removes the worktree directory + deletes the local feature branch. **Then sync local `main` to the merged squash commit: from the main workspace, `git fetch origin main && git checkout main && git merge --ff-only origin/main`.** A PR is not "finished" until local `main` matches `origin/main` — the next session must start from the merged state, not a behind one. If `--ff-only` rejects (local main has commits ahead of origin), stop and surface the divergence; do not force the merge.
```

becomes:

```
  - **Worktree-backed paths** (`fast-track`, `specs-only-*`, `full-*`): from the **main workspace** run `git worktree remove [--force] .worktrees/<name>` then `git branch -D feat/<name>` — removes the worktree directory + deletes the local feature branch. Non-interactive; no native tool. (Do NOT use the `ExitWorktree` native tool here: the framework creates worktrees via `git worktree add .worktrees/<name>`, which `ExitWorktree` did not create, so it is a no-op that silently leaves the worktree + branch on disk.) `git branch -D` (force) is required because the PR is squash-merged — the branch's commits are not ancestors of `main`, so `-d` would reject with "not fully merged" and leak the branch. Use `--force` on `git worktree remove` only if the worktree has uncommitted changes (it should not at this point). **Then sync local `main` to the merged squash commit: `git fetch origin main && git checkout main && git merge --ff-only origin/main`.** A PR is not "finished" until local `main` matches `origin/main` — the next session must start from the merged state, not a behind one. If `--ff-only` rejects (local main has commits ahead of origin), stop and surface the divergence; do not force the merge.
```

- [x] **Step 2: Edit `docs/noldor/pr-flow.md`**

Edit 1 — the flow-diagram cleanup line. Find:

```
  ├─ explicit cleanup: ExitWorktree (worktree paths) OR delete temp branch (micro-chore)
```

Replace with:

```
  ├─ explicit cleanup: git worktree remove + git branch -D (worktree paths) OR delete temp branch (micro-chore)
```

Edit 2 — the "Local main sync is part of PR completion" paragraph. Find the phrase:

```
worktree paths run `git fetch origin main && git checkout main && git merge --ff-only origin/main` in the main workspace after `ExitWorktree`;
```

Replace `after `ExitWorktree`` with `after `git worktree remove`` so it reads:

```
worktree paths run `git fetch origin main && git checkout main && git merge --ff-only origin/main` in the main workspace after `git worktree remove`;
```

- [x] **Step 3: Edit `docs/noldor/worktree-discipline.md` (3× `-d` → `-D`)**

Three `git branch -d feat/<name>` references carry the same squash-merge leak bug. Change each to `git branch -D feat/<name>`:

1. The commands-table row (search `git worktree remove [--force] .worktrees/<name>`): `Pair with `git branch -d feat/<name>`.` → `Pair with `git branch -D feat/<name>` (force: squash-merge leaves the branch's commits non-ancestor of main, so `-d` rejects).`
2. The "Finish sequence" line (search `**Finish sequence`): `→ `git worktree remove` → `git branch -d`.` → `→ `git worktree remove` → `git branch -D`.`
3. The "Finishing a worktree" bullet (search `Finishing a worktree`): `→ `git branch -d feat/<name>`.` → `→ `git branch -D feat/<name>`.`

- [x] **Step 4: Verify no other `ExitWorktree` cleanup references + no `-d` leak remains**

Run:
```bash
cd /Users/davidzoufaly/code/noldor/.worktrees/end-of-flow-ergonomics
grep -rn "ExitWorktree" .claude/skills/gate/SKILL.md docs/noldor/pr-flow.md
grep -rn "branch -d feat" .claude/skills/gate/SKILL.md docs/noldor/pr-flow.md docs/noldor/worktree-discipline.md
```
Expected: the first grep shows only the new explanatory mention in `gate/SKILL.md` ("(Do NOT use the `ExitWorktree` native tool here…)") — no remaining *instruction* to use it for cleanup. (The roadmap-entry text mentioning `ExitWorktree` lives in `docs/roadmap.md`, out of scope.) The second grep returns **nothing** (all `-d feat` are now `-D feat`).

- [x] **Step 5: Commit (shared-files override)**

```bash
cd /Users/davidzoufaly/code/noldor/.worktrees/end-of-flow-ergonomics
git add .claude/skills/gate/SKILL.md docs/noldor/pr-flow.md docs/noldor/worktree-discipline.md
NOLDOR_ALLOW_SHARED=1 git commit -m "docs(noldor): replace ExitWorktree cleanup with git worktree remove + git branch -D" -m "Noldor-FD: noldor"
```

---

## Task 4: Reconcile FD metadata before the `phase: done` flip

The `scripts/** → src/**` migration left the *entire* `links.code` block in `docs/features/noldor.md` pointing at the dead `scripts/` tree, and `cr-pipeline.md` was missing from `links.docs`. A `phase: done` FD must not ship 404 links / stale generated body. Fix all, not just our one file.

**Files:**
- Modify: `docs/features/noldor.md` (`links.code` full remap, `links.docs` add, Resources regen, `17 pages` count)

- [x] **Step 1: Remap every stale `links.code` path `scripts/* → src/*`**

`scripts/noldor/* → src/core/*` (7), `scripts/cr/* → src/cr/*` (6), `scripts/release/* → src/release/*` (1), `scripts/garden/* → src/garden/*` (3), plus the `src/core/pr-flow.ts` entry this FD adds. Verify each target exists on disk before writing.

- [x] **Step 2: Add `docs/noldor/cr-pipeline.md` to `links.docs`** and bump the "16 framework pages" prose to "17" (Summary + User Story).

- [x] **Step 3: Regenerate the Resources block**

Run: `cd /Users/davidzoufaly/code/noldor/.worktrees/end-of-flow-ergonomics && node bin/noldor.mjs sync fd-resources`
Expected: `Synced N feature MD(s), updated M.` — the `<!-- generated: resources -->` Code/Docs lists now mirror the corrected frontmatter.

- [x] **Step 4: Validate**

Run: `cd /Users/davidzoufaly/code/noldor/.worktrees/end-of-flow-ergonomics && node bin/noldor.mjs validate features`
Expected: `Validated N feature MD(s) — all OK.`

- [x] **Step 5: Commit**

```bash
cd /Users/davidzoufaly/code/noldor/.worktrees/end-of-flow-ergonomics
git add docs/features/noldor.md docs/roadmap.md
git commit -m "docs(features:noldor): remap links.code to src/, track cr-pipeline.md, regen resources" -m "Noldor-FD: noldor"
```

---

## Final verification

- [ ] Run full relevant test + typecheck:

```bash
cd /Users/davidzoufaly/code/noldor/.worktrees/end-of-flow-ergonomics
pnpm vitest run src/core/__tests__/pr-flow.test.ts src/core/__tests__/pr-flow-cli.test.ts
pnpm typecheck
node bin/noldor.mjs validate features
```

Expected: all green.

- [ ] Manual acceptance (dogfood): this very `/gate` session's end-of-flow will exercise both — the new `git worktree remove` cleanup sequence (Task 3) and, on a real auto-merge poll, the streamed status lines (Tasks 1-2). Confirm status lines appear on stderr and the worktree is removed without a prompt.
