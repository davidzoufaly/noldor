# Autonomous Queue-Drain Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an external supervisor that drains the roadmap's fast-track (XS/S) queue autonomously — one fresh `claude --print "/gate"` per entry, one auto-merged PR at a time — without weakening always-clear.

**Architecture:** A pure decision core (`decideNext`, `isDrainEligible`) + a thin IO loop (`runDrain`) with injected git/gh/spawn dependencies, fronted by a CLI entrypoint. `next-priority` gains a `--skip` filter. The gate's *existing* fast-track-from-roadmap retirement (`removeBlock`) consumes entries — no new removal helper. Gate prose gains `NOLDOR_DRAIN=1` branches that suppress all prompts.

**Tech Stack:** TypeScript (ESM, `.ts` imports with `.js` specifiers), vitest, Node `child_process`/`fs`, `gh` + `git` CLIs.

**Spec:** [docs/superpowers/specs/2026-06-10-autonomous-queue-drain-runner-design.md](../specs/2026-06-10-autonomous-queue-drain-runner-design.md). Decisions D1–D9 referenced by id.

**Module layout (all new unless noted):**
- `src/autonomous/drain-eligibility.ts` — `isDrainEligible(description)` (pure).
- `src/autonomous/drain-loop.ts` — `decideNext(...)` (pure) + `runDrain(deps, opts)` (loop).
- `src/autonomous/drain-lock.ts` — `acquireLock` / `releaseLock` (O_EXCL + rename-aside).
- `src/autonomous/drain-state.ts` — `DrainState` type + `writeState` / `readState`.
- `src/autonomous/drain-io.ts` — real `syncMainCleanState` / `openPrExistsFor` / `spawnGate`.
- `src/autonomous/queue-drain.ts` — CLI entrypoint (arg parse, `assertConfig`, exit codes).
- `src/core/next-priority.ts` — MODIFY: `--skip` filter on `getSuggestions` + `main()`.
- `src/cli/manifest.ts` — MODIFY: add `autonomous` group.
- `.gitignore` — MODIFY: add drain state/lock/stop files.
- `.claude/skills/gate/SKILL.md` — MODIFY: `NOLDOR_DRAIN` drain-mode branches.

---

### Task 1: `next-priority --skip` filter

**Files:**
- Modify: `src/core/next-priority.ts` (`getSuggestions` signature + `main()`)
- Test: `src/core/__tests__/next-priority.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `next-priority.test.ts` (reuse the file's existing `ROADMAP_WITH_ENTRIES` or a local fixture with ≥2 entries whose slugs you know):

```ts
describe('getSuggestions skip-set', () => {
  const input = { inProgressFds: [], milestoneGate: '' };

  it('excludes skipped slugs from topPriority', () => {
    const all = getSuggestions(ROADMAP_WITH_ENTRIES, input);
    const firstSlug = all.topPriority[0].slug;
    const filtered = getSuggestions(ROADMAP_WITH_ENTRIES, input, new Set([firstSlug]));
    expect(filtered.topPriority.map((e) => e.slug)).not.toContain(firstSlug);
  });

  it('returns empty topPriority when every entry is skipped', () => {
    const all = getSuggestions(ROADMAP_WITH_ENTRIES, input);
    const everySlug = new Set(parseRoadmap(ROADMAP_WITH_ENTRIES).map((e) => e.slug));
    const filtered = getSuggestions(ROADMAP_WITH_ENTRIES, input, everySlug);
    expect(filtered.topPriority).toHaveLength(0);
  });

  it('defaults to no skipping when the set is omitted', () => {
    const a = getSuggestions(ROADMAP_WITH_ENTRIES, input);
    const b = getSuggestions(ROADMAP_WITH_ENTRIES, input, new Set());
    expect(a.topPriority.map((e) => e.slug)).toEqual(b.topPriority.map((e) => e.slug));
  });
});
```

Import `parseRoadmap` from `../../utils/parse-blocks.js` in the test if not already imported.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/core/__tests__/next-priority.test.ts`
Expected: FAIL — `getSuggestions` takes 2 args, 3rd ignored / type error.

- [ ] **Step 3: Implement skip filtering**

In `src/core/next-priority.ts`, change the `getSuggestions` signature and filter `all` before sorting:

```ts
export function getSuggestions(
  roadmapRaw: string,
  input: SuggestionsInput,
  skip: ReadonlySet<string> = new Set(),
): Suggestions {
  const all = parseRoadmap(roadmapRaw).filter((e) => !skip.has(e.slug));
  const sorted = all.toSorted((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  // ... rest unchanged
```

In `main()`, parse `--skip <csv>` (it is a value flag, so read the token after it from `process.argv`, not the `argv` Set):

```ts
function parseSkip(argvList: readonly string[]): ReadonlySet<string> {
  const i = argvList.indexOf('--skip');
  if (i === -1 || i + 1 >= argvList.length) return new Set();
  return new Set(
    argvList[i + 1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}
```

Then in the `--suggestions` branch of `main()`:

```ts
const skip = parseSkip(process.argv.slice(2));
const suggestions = getSuggestions(roadmapRaw, { inProgressFds, milestoneGate }, skip);
```

(`--skip` only filters roadmap entries; `inProgress` is untouched — D4.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/core/__tests__/next-priority.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/next-priority.ts src/core/__tests__/next-priority.test.ts
git commit -m "feat(core:autonomous-queue-drain-runner): add --skip filter to next-priority suggestions"
```

---

### Task 2: `isDrainEligible` residue guard (D9)

**Files:**
- Create: `src/autonomous/drain-eligibility.ts`
- Test: `src/autonomous/__tests__/drain-eligibility.test.ts`

A roadmap entry is **ineligible** (skip, defer to interactive) when its block carries a `Touches:`
line or more than one top-level scope bullet — the blind `removeBlock` retirement would silently lose
residue (spec D9).

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { isDrainEligible } from '../drain-eligibility.js';

describe('isDrainEligible', () => {
  it('eligible: plain single-scope description', () => {
    expect(isDrainEligible('Fix the off-by-one in the token expiry check.')).toBe(true);
  });

  it('ineligible: contains a Touches: clause', () => {
    expect(isDrainEligible('Do the thing.\n\nTouches: src/a.ts, src/b.ts')).toBe(false);
  });

  it('ineligible: more than one top-level scope bullet', () => {
    expect(isDrainEligible('- first scope item\n- second scope item')).toBe(false);
  });

  it('eligible: a single top-level bullet is fine', () => {
    expect(isDrainEligible('- only one bullet of detail')).toBe(true);
  });

  it('eligible: empty / undefined description', () => {
    expect(isDrainEligible('')).toBe(true);
    expect(isDrainEligible(undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/autonomous/__tests__/drain-eligibility.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * True when a roadmap entry's block is safe to retire via the gate's blind
 * `removeBlock` in an unattended drain — i.e. it has no `Touches:` clause and at
 * most one top-level scope bullet. Multi-scope / Touches-bearing blocks need the
 * residue disposition a human does in `/promote` (spec D9); the drain skips them.
 */
export function isDrainEligible(description: string | undefined): boolean {
  const body = (description ?? '').trim();
  if (body.length === 0) return true;
  if (/^\s*Touches:/im.test(body)) return false;
  const topLevelBullets = body
    .split('\n')
    .filter((line) => /^\s*[-*]\s+/.test(line)).length;
  return topLevelBullets <= 1;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/autonomous/__tests__/drain-eligibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-eligibility.ts src/autonomous/__tests__/drain-eligibility.test.ts
git commit -m "feat(autonomous-queue-drain-runner): add isDrainEligible residue guard"
```

---

### Task 3: `decideNext` pure decision core

**Files:**
- Create: `src/autonomous/drain-loop.ts` (this task adds `decideNext` + the `SuggestedEntry`-shaped input type; Task 7 adds `runDrain` to the same file)
- Test: `src/autonomous/__tests__/decide-next.test.ts`

`decideNext` is retry-agnostic (spec): retry bookkeeping lives in `runDrain`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { decideNext } from '../drain-loop.js';
import type { SuggestedEntry } from '../../core/next-priority.js';

function entry(over: Partial<SuggestedEntry> = {}): SuggestedEntry {
  return {
    name: 'X', slug: 'x', suggestedPath: 'fast-track', description: 'small thing', ...over,
  } as SuggestedEntry;
}
const caps = { shipped: 0, maxFeatures: 20, spawns: 0, maxSpawns: 40 };

describe('decideNext', () => {
  it('spawns an in-scope fast-track entry', () => {
    expect(decideNext({ entry: entry(), ...caps }).action).toBe('spawn');
  });
  it('skips a non-fast-track entry (M/L/XL)', () => {
    expect(decideNext({ entry: entry({ suggestedPath: 'full-attach' }), ...caps }).action)
      .toBe('skip-out-of-scope');
  });
  it('skips a Touches-bearing entry', () => {
    expect(decideNext({ entry: entry({ description: 'do it\nTouches: a.ts' }), ...caps }).action)
      .toBe('skip-out-of-scope');
  });
  it('skips a multi-scope entry', () => {
    expect(decideNext({ entry: entry({ description: '- a\n- b' }), ...caps }).action)
      .toBe('skip-out-of-scope');
  });
  it('done when shipped >= maxFeatures', () => {
    expect(decideNext({ entry: entry(), ...caps, shipped: 20 }).action).toBe('done');
  });
  it('done when spawns >= maxSpawns', () => {
    expect(decideNext({ entry: entry(), ...caps, spawns: 40 }).action).toBe('done');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/autonomous/__tests__/decide-next.test.ts`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement `decideNext`**

Create `src/autonomous/drain-loop.ts` with:

```ts
import type { SuggestedEntry } from '../core/next-priority.js';
import { isDrainEligible } from './drain-eligibility.js';

export type DrainAction = 'spawn' | 'skip-out-of-scope' | 'done';

export interface DecideInput {
  entry: SuggestedEntry;
  shipped: number;
  maxFeatures: number;
  spawns: number;
  maxSpawns: number;
}

/**
 * Pure per-iteration decision. Retry-agnostic — `runDrain` owns retry counting.
 * `done` caps fire first (backstops), then scope checks (suggestedPath + residue),
 * else `spawn`.
 */
export function decideNext(input: DecideInput): { action: DrainAction; slug: string } {
  const { entry, shipped, maxFeatures, spawns, maxSpawns } = input;
  const slug = entry.slug;
  if (shipped >= maxFeatures || spawns >= maxSpawns) return { action: 'done', slug };
  if (entry.suggestedPath !== 'fast-track') return { action: 'skip-out-of-scope', slug };
  if (!isDrainEligible(entry.description)) return { action: 'skip-out-of-scope', slug };
  return { action: 'spawn', slug };
}
```

> If `BacklogEntry` has no `description` field, add it to the parser first (it is present in the
> `next-priority --suggestions --json` output, so the field exists; confirm the property name and
> adjust `isDrainEligible`'s caller accordingly).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/autonomous/__tests__/decide-next.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-loop.ts src/autonomous/__tests__/decide-next.test.ts
git commit -m "feat(autonomous-queue-drain-runner): add decideNext pure decision core"
```

---

### Task 4: Drain lock (TOCTOU-safe)

**Files:**
- Create: `src/autonomous/drain-lock.ts`
- Test: `src/autonomous/__tests__/drain-lock.test.ts`

Acquire via `O_EXCL` create. Reclaim a dead holder by renaming the stale lock **aside** then
`O_EXCL`-creating fresh (spec — rename-aside, not rename-onto).

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, releaseLock } from '../drain-lock.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'drain-lock-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('drain lock', () => {
  it('acquires when no lock exists', () => {
    expect(acquireLock(dir).ok).toBe(true);
    expect(existsSync(join(dir, '.noldor/drain.lock'))).toBe(true);
  });
  it('refuses when held by a live pid', () => {
    acquireLock(dir);
    expect(acquireLock(dir).ok).toBe(false); // current process is alive → contention
  });
  it('reclaims a lock whose holder pid is dead', () => {
    writeFileSync(join(dir, '.noldor/drain.lock'),
      JSON.stringify({ pid: 2147483646, startedAt: 't' })); // pid that cannot exist
    expect(acquireLock(dir).ok).toBe(true);
  });
  it('releaseLock removes the lock', () => {
    acquireLock(dir); releaseLock(dir);
    expect(existsSync(join(dir, '.noldor/drain.lock'))).toBe(false);
  });
});
```

> Note: the "live pid" test relies on the lock recording `process.pid` (alive). Ensure the `.noldor`
> dir is created before writing in the dead-pid test (`mkdirSync(join(dir,'.noldor'),{recursive:true})`).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/autonomous/__tests__/drain-lock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { openSync, closeSync, writeSync, readFileSync, renameSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LOCK_REL = '.noldor/drain.lock';

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function acquireLock(cwd: string, now: string = ''): { ok: boolean; reason?: string } {
  const lockPath = join(cwd, LOCK_REL);
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  const payload = JSON.stringify({ pid: process.pid, startedAt: now });
  try {
    const fd = openSync(lockPath, 'wx'); // O_EXCL
    writeSync(fd, payload); closeSync(fd);
    return { ok: true };
  } catch {
    // Lock exists — inspect holder.
    let holder: { pid: number } | null = null;
    try { holder = JSON.parse(readFileSync(lockPath, 'utf8')); } catch { holder = null; }
    if (holder && isAlive(holder.pid)) return { ok: false, reason: 'held by live pid' };
    // Dead/garbage holder → reclaim by renaming ASIDE, then O_EXCL-create fresh.
    try {
      renameSync(lockPath, `${lockPath}.reclaim.${process.pid}`); // loser's rename throws ENOENT
    } catch {
      return { ok: false, reason: 'lost reclaim race' };
    }
    try { unlinkSync(`${lockPath}.reclaim.${process.pid}`); } catch { /* ignore */ }
    const fd = openSync(lockPath, 'wx');
    writeSync(fd, payload); closeSync(fd);
    return { ok: true };
  }
}

export function releaseLock(cwd: string): void {
  try { unlinkSync(join(cwd, LOCK_REL)); } catch { /* already gone */ }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/autonomous/__tests__/drain-lock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-lock.ts src/autonomous/__tests__/drain-lock.test.ts
git commit -m "feat(autonomous-queue-drain-runner): add TOCTOU-safe drain lock"
```

---

### Task 5: Drain state (observability + heartbeat)

**Files:**
- Create: `src/autonomous/drain-state.ts`
- Test: `src/autonomous/__tests__/drain-state.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeState } from '../drain-state.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'drain-state-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('writeState', () => {
  it('writes a JSON heartbeat under .noldor/', () => {
    writeState(dir, { pid: 1, startedAt: 't', phase: 'spawning', currentSlug: 'x', shipped: 0, skip: [], retries: {} });
    const j = JSON.parse(readFileSync(join(dir, '.noldor/drain-state.json'), 'utf8'));
    expect(j.phase).toBe('spawning');
    expect(j.currentSlug).toBe('x');
  });
  it('never throws on an unwritable path (best-effort)', () => {
    expect(() => writeState('/proc/nonexistent-xyz', { pid: 1, startedAt: 't', phase: 'idle', currentSlug: null, shipped: 0, skip: [], retries: {} })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/autonomous/__tests__/drain-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface DrainState {
  pid: number;
  startedAt: string;
  phase: 'spawning' | 'awaiting-merge' | 'idle';
  currentSlug: string | null;
  shipped: number;
  skip: string[];
  retries: Record<string, number>;
}

/** Best-effort heartbeat write — a failure logs but never crashes the loop (spec Error handling). */
export function writeState(cwd: string, state: DrainState): void {
  try {
    mkdirSync(join(cwd, '.noldor'), { recursive: true });
    writeFileSync(join(cwd, '.noldor/drain-state.json'), JSON.stringify(state, null, 2) + '\n', 'utf8');
  } catch (err) {
    process.stderr.write(`drain-state write failed (non-fatal): ${String(err)}\n`);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/autonomous/__tests__/drain-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-state.ts src/autonomous/__tests__/drain-state.test.ts
git commit -m "feat(autonomous-queue-drain-runner): add drain-state heartbeat writer"
```

---

### Task 6: IO adapters (git/gh/spawn) — real implementations of injected deps

**Files:**
- Create: `src/autonomous/drain-io.ts`
- Test: none at unit level (these shell out — exercised by the Task 11 integration spike). Keep each
  function tiny so there is no logic to unit-test, only a command invocation.

- [ ] **Step 1: Implement the adapters**

```ts
import { execFileSync, spawnSync } from 'node:child_process';

/** Checkout main, fetch, ff-only sync, prune leftover worktrees + fast/* branches, drop stale escalation context.
 *  Throws on ff-only rejection (caller aborts the drain — spec Error handling). */
export function syncMainCleanState(cwd: string): void {
  const git = (args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git(['checkout', 'main']);
  git(['fetch', 'origin', 'main']);
  git(['merge', '--ff-only', 'origin/main']); // throws on divergence → abort
  git(['worktree', 'prune']);
  // Best-effort: remove leftover .worktrees/* and their fast/* branches; rm stale escalation context.
  spawnSync('bash', ['-lc',
    'for d in .worktrees/*; do [ -d "$d" ] && git worktree remove --force "$d" 2>/dev/null || true; done; ' +
    'for b in $(git branch --list "fast/*" --format "%(refname:short)"); do git branch -D "$b" 2>/dev/null || true; done; ' +
    'rm -f .noldor/cr/*-escalation-context.md 2>/dev/null || true',
  ], { cwd, stdio: 'pipe' });
}

/** True when an OPEN PR exists for the deterministic drain branch fast/<slug>. Throws on gh failure
 *  (caller treats as fail-closed abort — spec). */
export function openPrExistsFor(cwd: string, slug: string): boolean {
  const out = execFileSync('gh', ['pr', 'list', '--state', 'open', '--head', `fast/${slug}`, '--json', 'number'],
    { cwd, encoding: 'utf8' });
  return (JSON.parse(out) as unknown[]).length > 0;
}

/** Spawn a headless gate run. Resolves with the child exit code; rejects on timeout (caller kills + treats as failure). */
export function spawnGate(cwd: string, env: Record<string, string>, timeoutMs: number): number {
  const res = spawnSync('claude', ['--print', '/gate', '--disallowedTools', 'AskUserQuestion'], {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });
  if (res.error && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    throw new Error('iteration-timeout');
  }
  return res.status ?? 1;
}
```

> The exact `claude --print` flag that denies AskUserQuestion (`--disallowedTools AskUserQuestion`
> shown above) is the Task 11 spike's job to confirm; adjust here once verified.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit` (or the repo's typecheck script)
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/autonomous/drain-io.ts
git commit -m "feat(autonomous-queue-drain-runner): add git/gh/spawn IO adapters"
```

---

### Task 7: `runDrain` loop (injected deps, mockable)

**Files:**
- Modify: `src/autonomous/drain-loop.ts` (add `runDrain` + `Deps`/`DrainOpts` types beside `decideNext`)
- Test: `src/autonomous/__tests__/run-drain.test.ts`

- [ ] **Step 1: Write failing tests** (drives cases a–k from the spec)

```ts
import { describe, expect, it, vi } from 'vitest';
import { runDrain } from '../drain-loop.js';
import type { SuggestedEntry, Suggestions } from '../../core/next-priority.js';

function sugg(slugs: string[]): Suggestions {
  return {
    inProgress: [],
    topPriority: slugs.map((slug) => ({ name: slug, slug, suggestedPath: 'fast-track', description: 'x' } as SuggestedEntry)),
    smallHighImpact: [], milestoneAligned: null,
  };
}
function baseDeps(over = {}) {
  return {
    nextPriority: vi.fn(),
    spawnGate: vi.fn(() => 0),
    syncMainCleanState: vi.fn(),
    openPrExistsFor: vi.fn(() => false),
    writeState: vi.fn(),
    stopRequested: vi.fn(() => false),
    ...over,
  };
}
const opts = { maxFeatures: 20, maxRetries: 2, maxSpawns: 40, timeoutMs: 1000, dryRun: false, cwd: '/x' };

describe('runDrain', () => {
  it('(a) ships entry 1, skips entry 2 after retries', () => {
    // entry-1 consumed after its spawn; entry-2 never consumed → 2 retries then skip → done.
    const seqs = [sugg(['a','b']), sugg(['b']), sugg(['b']), sugg(['b']), sugg(['b'])];
    let i = 0;
    const deps = baseDeps({ nextPriority: vi.fn(() => seqs[Math.min(i++, seqs.length - 1)]) });
    const r = runDrain(deps, opts);
    expect(r.shipped).toBe(1);
    expect(r.skipped).toContain('b');
    expect(r.exitCode).toBe(0);
  });

  it('(b) aborts exit 1 when nextPriority throws', () => {
    const deps = baseDeps({ nextPriority: vi.fn(() => { throw new Error('parse'); }) });
    expect(runDrain(deps, opts).exitCode).toBe(1);
  });

  it('(c) child timeout → retry then skip', () => {
    const deps = baseDeps({
      nextPriority: vi.fn(() => sugg(['a'])),
      spawnGate: vi.fn(() => { throw new Error('iteration-timeout'); }),
    });
    const r = runDrain(deps, { ...opts, maxRetries: 1 });
    expect(r.skipped).toContain('a');
  });

  it('(d) merged-but-unsynced absorbed by sync → counts shipped, no re-spawn', () => {
    // After sync the slug is gone on the first post-spawn read.
    const seqs = [sugg(['a']), sugg([])];
    let i = 0;
    const spawnGate = vi.fn(() => 0);
    const deps = baseDeps({ nextPriority: vi.fn(() => seqs[Math.min(i++, 1)]), spawnGate });
    const r = runDrain(deps, opts);
    expect(r.shipped).toBe(1);
    expect(spawnGate).toHaveBeenCalledTimes(1);
  });

  it('(e) dry-run never spawns', () => {
    const spawnGate = vi.fn(() => 0);
    const deps = baseDeps({ nextPriority: vi.fn(() => sugg(['a'])), spawnGate });
    runDrain(deps, { ...opts, dryRun: true, maxFeatures: 1 });
    expect(spawnGate).not.toHaveBeenCalled();
  });

  it('(f) stop-signal at iteration top → exit 130', () => {
    const deps = baseDeps({ nextPriority: vi.fn(() => sugg(['a'])), stopRequested: vi.fn(() => true) });
    expect(runDrain(deps, opts).exitCode).toBe(130);
  });

  it('(i) post-spawn open PR → skip, no re-spawn', () => {
    const deps = baseDeps({
      nextPriority: vi.fn(() => sugg(['a'])), // never consumed
      openPrExistsFor: vi.fn(() => true),
    });
    const r = runDrain(deps, opts);
    expect(r.skipped).toContain('a');
  });

  it('(j) pre-spawn open PR (restart) → skip without spawning', () => {
    const spawnGate = vi.fn(() => 0);
    const seqs = [sugg(['a']), sugg([])];
    let i = 0;
    const deps = baseDeps({
      nextPriority: vi.fn(() => seqs[Math.min(i++, 1)]),
      openPrExistsFor: vi.fn(() => true),
      spawnGate,
    });
    runDrain(deps, opts);
    expect(spawnGate).not.toHaveBeenCalled();
  });
});
```

> Decide and document whether `openPrExistsFor` is checked pre-spawn (case j) and post-spawn (case i)
> — the loop below does both. Tune the fixtures so case (a)'s retry math matches your `maxRetries`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/autonomous/__tests__/run-drain.test.ts`
Expected: FAIL — `runDrain` not exported.

- [ ] **Step 3: Implement `runDrain`** (append to `drain-loop.ts`)

```ts
import type { Suggestions } from '../core/next-priority.js';

export interface DrainDeps {
  nextPriority: (skip: ReadonlySet<string>) => Suggestions;            // may throw → abort
  spawnGate: (env: Record<string, string>, timeoutMs: number) => number; // may throw('iteration-timeout')
  syncMainCleanState: () => void;                                       // may throw → abort
  openPrExistsFor: (slug: string) => boolean;                          // may throw → abort (fail-closed)
  writeState: (s: { phase: string; currentSlug: string | null; shipped: number; skip: string[]; retries: Record<string, number> }) => void;
  stopRequested: () => boolean;
}
export interface DrainOpts {
  maxFeatures: number; maxRetries: number; maxSpawns: number;
  timeoutMs: number; dryRun: boolean; cwd: string;
}
export interface DrainResult { shipped: number; skipped: string[]; exitCode: 0 | 1 | 130; }

export function runDrain(deps: DrainDeps, opts: DrainOpts): DrainResult {
  const skip = new Set<string>();
  const retries = new Map<string, number>();
  let shipped = 0, spawns = 0;
  const result = (exitCode: 0 | 1 | 130): DrainResult => ({ shipped, skipped: [...skip], exitCode });

  try {
    deps.syncMainCleanState();
    for (;;) {
      if (deps.stopRequested()) return result(130);
      const sugg = deps.nextPriority(skip);
      if (sugg.topPriority.length === 0) return result(0);          // D4 — done
      const entry = sugg.topPriority[0];
      const d = decideNext({ entry, shipped, maxFeatures: opts.maxFeatures, spawns, maxSpawns: opts.maxSpawns });
      if (d.action === 'done') return result(0);
      if (d.action === 'skip-out-of-scope') { skip.add(entry.slug); continue; }

      if (deps.openPrExistsFor(entry.slug)) { skip.add(entry.slug); continue; } // restart-safety (case j)
      if (opts.dryRun) { skip.add(entry.slug); continue; }                      // (e) plan only, never spawn

      spawns++;
      deps.writeState({ phase: 'spawning', currentSlug: entry.slug, shipped, skip: [...skip], retries: Object.fromEntries(retries) });
      try {
        deps.spawnGate({ NOLDOR_DRAIN: '1', NOLDOR_DRAIN_SKIP: [...skip].join(',') }, opts.timeoutMs);
      } catch { /* timeout / spawn error → treated as failure below */ }
      deps.syncMainCleanState();                                    // D5 — authoritative read
      const after = deps.nextPriority(skip);
      const stillPresent = after.topPriority.some((e) => e.slug === entry.slug);
      if (!stillPresent) { shipped++; retries.delete(entry.slug); continue; } // D2 — shipped
      if (deps.openPrExistsFor(entry.slug)) { skip.add(entry.slug); continue; } // D5b — in-flight
      const n = (retries.get(entry.slug) ?? 0) + 1; retries.set(entry.slug, n);
      if (n > opts.maxRetries) skip.add(entry.slug);
    }
  } catch {
    return result(1); // nextPriority / syncMain / gh failure → abort
  }
}
```

> Note: `stillPresent` uses `after.topPriority`, which is the skip-filtered top-3. For a roadmap
> deeper than 3 entries this is sufficient because a *shipped* slug is removed entirely (absent from
> the full parse, hence from topPriority too); a *failed* slug stays top (not skipped) so it remains in
> topPriority. If you prefer the spec's literal "absent from the full roadmap parse", add a
> `parseAll: () => string[]` dep returning all slugs and check that instead. Either satisfies D2; pick
> one and align the test fixtures.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/autonomous/__tests__/run-drain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/autonomous/drain-loop.ts src/autonomous/__tests__/run-drain.test.ts
git commit -m "feat(autonomous-queue-drain-runner): add runDrain loop with injected deps"
```

---

### Task 8: CLI entrypoint + manifest wiring

**Files:**
- Create: `src/autonomous/queue-drain.ts`
- Modify: `src/cli/manifest.ts`
- Test: `src/autonomous/__tests__/queue-drain-cli.test.ts` (arg parsing + `assertConfig` only)

- [ ] **Step 1: Write failing tests** (pure arg-parse + config-assert helpers)

```ts
import { describe, expect, it } from 'vitest';
import { parseArgs, assertConfig } from '../queue-drain.js';

describe('queue-drain CLI helpers', () => {
  it('parses flags with defaults', () => {
    const a = parseArgs([]);
    expect(a.maxFeatures).toBe(20);
    expect(a.maxRetries).toBe(2);
    expect(a.dryRun).toBe(false);
  });
  it('rejects non-positive --max-features', () => {
    expect(() => parseArgs(['--max-features', '0'])).toThrow();
  });
  it('assertConfig passes the headless precondition set', () => {
    expect(() => assertConfig({ autonomous: { onFailure: 'abort', skipLanePicker: true, requireHumanPrApproval: false } })).not.toThrow();
  });
  it('assertConfig rejects onFailure!=abort naming the key', () => {
    expect(() => assertConfig({ autonomous: { onFailure: 'prompt', skipLanePicker: true, requireHumanPrApproval: false } }))
      .toThrow(/onFailure/);
  });
  it('assertConfig rejects a missing autonomous block', () => {
    expect(() => assertConfig({})).toThrow(/autonomous/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/autonomous/__tests__/queue-drain-cli.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the entrypoint**

```ts
import { loadConfigSync, type NoldorConfig } from '../cr/config.js';
import { getSuggestions, loadInProgressFds, loadMilestoneGate } from '../core/next-priority.js';
import { loadDocRoots } from '../cli/doc-roots.js';
import { readFileSync, existsSync } from 'node:fs';
import { runDrain, type DrainDeps } from './drain-loop.js';
import { acquireLock, releaseLock } from './drain-lock.js';
import { writeState } from './drain-state.js';
import { syncMainCleanState, openPrExistsFor, spawnGate } from './drain-io.js';

export interface ParsedArgs {
  maxFeatures: number; maxRetries: number; maxSpawns: number;
  timeoutMs: number; dryRun: boolean; json: boolean;
}
function intFlag(args: readonly string[], name: string, def: number): number {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = Number(args[i + 1]);
  if (!Number.isInteger(v) || v <= 0) throw new Error(`${name} must be a positive integer`);
  return v;
}
export function parseArgs(args: readonly string[]): ParsedArgs {
  const maxFeatures = intFlag(args, '--max-features', 20);
  const maxRetries = intFlag(args, '--max-retries', 2);
  return {
    maxFeatures, maxRetries,
    maxSpawns: intFlag(args, '--max-spawns', maxFeatures * (maxRetries + 1)),
    timeoutMs: intFlag(args, '--iteration-timeout', 30 * 60 * 1000),
    dryRun: args.includes('--dry-run'),
    json: args.includes('--json'),
  };
}

export function assertConfig(cfg: Partial<NoldorConfig>): void {
  const a = cfg.autonomous;
  if (!a) throw new Error('drain requires an `autonomous` block in .noldor/config.json');
  const bad: string[] = [];
  if (a.onFailure !== 'abort') bad.push('autonomous.onFailure must be "abort"');
  if (a.skipLanePicker !== true) bad.push('autonomous.skipLanePicker must be true');
  if (a.requireHumanPrApproval !== false) bad.push('autonomous.requireHumanPrApproval must be false');
  if (bad.length) throw new Error(`drain config precondition unmet:\n  - ${bad.join('\n  - ')}`);
}

function main(): void {
  const args = process.argv.slice(2);
  let parsed: ParsedArgs;
  try { parsed = parseArgs(args); assertConfig(loadConfigSync() ?? {}); }
  catch (e) { process.stderr.write(`${(e as Error).message}\n`); process.exit(1); }

  const cwd = process.cwd();
  const lock = acquireLock(cwd, new Date().toISOString());
  if (!lock.ok) { process.stderr.write(`drain: ${lock.reason}\n`); process.exit(1); }

  const stopSentinel = '.noldor/drain-stop';
  let stop = false;
  process.on('SIGINT', () => { stop = true; }); // mid-child: spawnSync inherits the signal and dies

  const deps: DrainDeps = {
    nextPriority: (skip) => getSuggestions(
      readFileSync(loadDocRoots(cwd).roadmap, 'utf8'),
      { inProgressFds: loadInProgressFds(cwd), milestoneGate: loadMilestoneGate(cwd) },
      skip,
    ),
    spawnGate: (env, timeoutMs) => spawnGate(cwd, env, timeoutMs),
    syncMainCleanState: () => syncMainCleanState(cwd),
    openPrExistsFor: (slug) => openPrExistsFor(cwd, slug),
    writeState: (s) => writeState(cwd, { pid: process.pid, startedAt: new Date().toISOString(), phase: s.phase as never, currentSlug: s.currentSlug, shipped: s.shipped, skip: s.skip, retries: s.retries }),
    stopRequested: () => stop || existsSync(`${cwd}/${stopSentinel}`),
  };

  let res;
  try {
    res = runDrain(deps, { ...parsed, cwd });
  } finally {
    releaseLock(cwd);
  }
  process.stdout.write(parsed.json
    ? JSON.stringify(res) + '\n'
    : `drain: shipped ${res.shipped}, skipped ${res.skipped.length} [${res.skipped.join(', ')}]\n`);
  process.exit(res.exitCode);
}

const invokedDirect = process.argv[1]?.includes('queue-drain');
if (invokedDirect) main();
```

> Confirm `loadInProgressFds` and `loadMilestoneGate` are exported from `next-priority.ts` (the test
> file imports them, so they are). `loadDocRoots` import path is `../cli/doc-roots.js`.

- [ ] **Step 4: Add the manifest entry**

In `src/cli/manifest.ts`, add a group (place it alphabetically near the top of `MANIFEST`):

```ts
  autonomous: {
    desc: 'Autonomous runners (queue-drain)',
    subs: {
      'queue-drain': { src: 'autonomous/queue-drain.ts', desc: 'Drain the fast-track roadmap queue autonomously' },
    },
  },
```

- [ ] **Step 5: Run tests + smoke the CLI wiring**

Run: `pnpm vitest run src/autonomous/__tests__/queue-drain-cli.test.ts`
Expected: PASS.
Run: `pnpm noldor autonomous queue-drain --dry-run` from the repo root (config must have the autonomous block, else it aborts exit 1 — that itself proves `assertConfig`).
Expected: either a dry-run summary, or a clear config-precondition abort.

- [ ] **Step 6: Commit**

```bash
git add src/autonomous/queue-drain.ts src/cli/manifest.ts src/autonomous/__tests__/queue-drain-cli.test.ts
git commit -m "feat(autonomous-queue-drain-runner): add queue-drain CLI entrypoint + manifest entry"
```

---

### Task 9: `.gitignore` entries

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add the drain files** (next to the existing `.noldor/*` lines)

```
.noldor/drain-state.json
.noldor/drain.lock
.noldor/drain-stop
```

- [ ] **Step 2: Verify ignored**

Run: `git check-ignore .noldor/drain-state.json .noldor/drain.lock .noldor/drain-stop`
Expected: all three echoed back.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore(autonomous-queue-drain-runner): gitignore drain state/lock/stop files"
```

---

### Task 10: Gate drain-mode prose branches

**Files:**
- Modify: `.claude/skills/gate/SKILL.md`

No automated test — this is operator-facing prose. Edits (spec §3), each guarded by "When `NOLDOR_DRAIN=1`:":

- [ ] **Step 1: Step 0 branch** — after the existing bucket logic, add: "When `NOLDOR_DRAIN=1`, skip all `AskUserQuestion`s; auto-select `topPriority[0]` honoring `NOLDOR_DRAIN_SKIP`; if its `suggestedPath !== 'fast-track'`, exit without scaffolding (defensive — the supervisor pre-filters scope)."

- [ ] **Step 2: Steps 1/1.5 branch** — "When `NOLDOR_DRAIN=1`, skip path-pick + confirm; force `fast-track`; name the branch `fast/<slug>` (deterministic — enables the supervisor's `openPrExistsFor`). Before creating it, force-recreate: `git branch -D fast/<slug>` + `git push origin --delete fast/<slug>` (if present)."

- [ ] **Step 3: Step 4 branch** — "When `NOLDOR_DRAIN=1`, run end-of-flow autonomously (`set-autonomous`, code CR via `crLanes.code`, `pr-flow` auto-merge, no prompts); skip the no-FD seams (phase-flip, draft-feature-md). Escalation uses `cr escalate --autonomous` with `onFailure: abort`."

- [ ] **Step 4: Step 5 branch** — "When `NOLDOR_DRAIN=1`, exit clean with no human `/clear`+`/gate` handoff prose."

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/gate/SKILL.md
git commit -m "docs(autonomous-queue-drain-runner): add NOLDOR_DRAIN gate-mode branches"
```

> Note: editing the repo gate `SKILL.md` from a worktree may trip the shared-files guard — if so,
> prefix the commit with `NOLDOR_ALLOW_SHARED=1` per the "Fast-track no-FD ship recipe" memory.

---

### Task 11: Headless `claude --print` spike + integration doc

**Files:**
- Modify: `docs/features/autonomous-queue-drain-runner.md` (append a "Verification" note under Usage)

- [ ] **Step 1: Spike** — from a throwaway shell, confirm: (a) `claude --print "/gate"` resolves the
  `/gate` skill in print mode; (b) the flag that denies `AskUserQuestion` works (adjust `drain-io.ts`
  to match the real flag name/permission-mode); (c) `git`/`gh`/`pnpm`/Edit run without permission
  prompts under the spawn (pass the necessary `--allowedTools` / `--permission-mode`). Record the
  exact working invocation.

- [ ] **Step 2: Seeded integration run** — on a scratch branch, seed `docs/roadmap.md` with one
  standalone XS/S entry, set the `autonomous` config block, run `pnpm noldor autonomous queue-drain
  --max-features 1`, and confirm the entry is retired from `main` via a merged PR (not just a clean
  child exit). Document the result.

- [ ] **Step 3: Update drain-io.ts** if the spike found a different flag, then re-run Task 6 typecheck.

- [ ] **Step 4: Commit**

```bash
git add docs/features/autonomous-queue-drain-runner.md src/autonomous/drain-io.ts
git commit -m "docs(autonomous-queue-drain-runner): record headless gate spike + integration runbook"
```

---

## Self-Review

**Spec coverage:** supervisor loop (T7) · `decideNext`/scope (T3) · residue guard D9 (T2) · `--skip` D3/D4 (T1) · lock + TOCTOU (T4) · state/heartbeat (T5) · IO sync D5 / openPrExistsFor D5b / spawn (T6) · CLI exit-codes + assertConfig D6 + flags (T8) · gitignore (T9) · gate prose + deterministic branch + force-recreate (T10) · headless spike + integration (T11). D1 (reuse `removeBlock`) needs **no task** — it is existing gate behavior, exercised by T10's Step-2 branch + T11 integration.

**Placeholder scan:** the two `>`-quoted "confirm X" notes (description field name; `claude --print` flag) are deliberately deferred to the spike (T11) / a one-line verification, not hidden TODOs — each names the exact thing to check and where to adjust.

**Type consistency:** `SuggestedEntry`/`Suggestions` imported from `next-priority.ts` in T3/T7; `decideNext` input matches its call site in `runDrain`; `DrainDeps` method signatures match the adapters in T6 and the wiring in T8; `NoldorConfig.autonomous` shape in T8 matches `autonomousConfigSchema` (`src/cr/config.ts`).
