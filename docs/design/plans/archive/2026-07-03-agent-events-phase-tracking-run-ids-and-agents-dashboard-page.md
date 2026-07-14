# Agent-Events Phase Tracking, Run IDs and `/agents` Dashboard Page Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Every agent-event and escalation row minted during a drain run carries that run's id; the event log gains `spawned` rows (with pid, paired to `exited` rows by a per-spawn `spawnId`) and coarse `phase` rows (building / awaiting-merge / merging / merged) from a heartbeat tap — making live state and per-run timelines derivable from `.noldor/agent-events.jsonl` alone. A new `/agents` dashboard page renders the live board, per-run timeline, and the escalation inbox, polling `GET /api/agents` every ~2s, with a shared `.noldor/watch.log` tail at `/agents/log`. All writes stay fail-open (the `appendAgentEvent` contract); all readers stay back-compat (`event` absent ⇒ `exited`, `runId` absent ⇒ a "(no run id)" bucket).

**Architecture:** Six spec units. (1) `AgentEvent` vocabulary extension in `src/core/agent-events.ts` (`event?`/`runId?`/`spawnId?`/`pid?`/`phase?`; `exitCode`/`durationMs`/`timedOut` become optional) + `spawnAgent` (`src/core/agent-runner/registry.ts`) mints `spawnId = randomUUID()` per call, appends a `spawned` row in the existing `child.pid` guard and stamps `event:'exited'` + `spawnId` + `runId` on the close-handler row; `runId` resolves `opts.env?.NOLDOR_RUN_ID ?? process.env.NOLDOR_RUN_ID` (passive telemetry correlation — NOT a PR #33 directive; documented in-code so nobody "fixes" it onto the prompt). (2) `queue-drain.ts` mints `runId = \`${startedAt}.${pid}\`` at drain start, `watch.ts` mints one **per cycle** (D7); both export it into their own `process.env` (salvage + ambient fallback) and merge it into the gate child's env via the `spawnGate` wrapper; nested CR-lane spawns inherit it with zero call-site changes. `EscalationRow` gains `runId?`, `mapCycle` threads it; both `salvage.ts` append sites add it explicitly; `drain-reliability.ts` drops the run-id blind spot and keys `samples` with `runId`. (3) New `src/autonomous/phase-events.ts` — pure `diffPhases` + `makePhaseTap(cwd, runId, next)` wrapping the shells' existing `deps.writeState` composition (no `runDrain` change); disappearance-after-`merging` ⇒ `merged`. (4) `loadAgentActivity(cwd)` in `src/dashboard/data.ts` (line-tolerant JSONL, pid-liveness via `process.kill(pid, 0)`, `readInboxRows` reused verbatim) + `GET /api/agents` returning `{ live, runs, inbox }` via the existing `jsonResult` fast path. (5) `/agents` page (`handleAgents` → `renderAgents`, `handleWorktrees` pattern), nav entry next to Worktrees, `static/agents.ts → dist/agents.js` poller compiled like `drag.ts`, `/agents/log` tail of `WATCH_LOG_REL`. (6) Reader back-compat pins + FD links + full verify.

**Tech Stack:** TypeScript ESM (`.js` import suffixes, `verbatimModuleSyntax`, oxfmt printWidth 100, oxlint `--deny-warnings`), Node built-ins only (`node:crypto` randomUUID, `node:http` dashboard), vitest (`pnpm vitest run <path>`; `pnpm test` = all; fake spawn via `spawnImpl` seam, mkdtemp fixtures), `tsc -p src/dashboard/static/tsconfig.json` for the browser module (explicit `pnpm fmt` on `dist/` output — the PR #88 gotcha).

Spec: [docs/design/specs/2026-07-03-agent-events-phase-tracking-run-ids-and-agents-dashboard-page-design.md](../specs/2026-07-03-agent-events-phase-tracking-run-ids-and-agents-dashboard-page-design.md)

---

## File Structure

- `src/core/agent-events.ts` — modify; `AgentEvent` vocabulary extension + per-event field contract doc + rotation-comment repoint (D5)
- `src/core/agent-runner/types.ts` — modify; `SpawnAgentOpts.slug?` for event stamping
- `src/core/agent-runner/registry.ts` — modify; `spawnId` mint, `spawned` row in the pid guard, `exited` row fields, `runId` env resolution + telemetry-not-directive doc
- `src/core/__tests__/agent-events.test.ts` — modify; phase-row serialization pin (optional exit fields)
- `src/core/agent-runner/__tests__/registry.test.ts` — modify; spawned/exited pairing + runId resolution tests
- `src/metrics/collect/drain-reliability.ts` — modify; durations filter to exited rows (Task 1); blind-spot removal + runId-keyed samples (Task 2)
- `src/metrics/__tests__/drain-and-tokens.test.ts` — modify; mean-duration ignores spawned/phase rows; samples carry runId
- `ideas.md` — modify; seed the deferred log-rotation follow-up (D5)
- `src/autonomous/drain-loop.ts` — modify; `DrainDeps.spawnGate` gains a trailing `slug` param, worker passes `candidate.slug`
- `src/autonomous/drain-io.ts` — modify; `spawnGate` forwards `slug` into `spawnAgent` opts
- `src/autonomous/queue-drain.ts` — modify; runId mint + env export + spawnGate env merge + phase tap + mapCycle runId
- `src/autonomous/watch.ts` — modify; per-cycle runId mint + same wiring
- `src/autonomous/escalations.ts` — modify; `EscalationRow.runId?`, `mapCycle` input + `row()` stamping
- `src/autonomous/salvage.ts` — modify; both `appendAgentEvent` sites add `runId` from `process.env`
- `src/autonomous/__tests__/escalations.test.ts` — modify; mapCycle runId tests
- `src/autonomous/__tests__/run-drain.test.ts` — modify; harness mock gains slug param + slug-threading test
- `src/autonomous/phase-events.ts` — create; `diffPhases` (pure) + `makePhaseTap` (fail-open appender wrapper)
- `src/autonomous/__tests__/phase-events.test.ts` — create; phase sequence, dedupe, merged-on-disappearance, fail-open
- `src/dashboard/data.ts` — modify; `loadAgentActivity` (live/runs derivation, injectable pid-liveness + clock), `loadWatchLogTail`, exported types
- `src/dashboard/server.ts` — modify; `GET /api/agents` (Task 4), `GET /agents` + `GET /agents/log` routes + handlers (Task 5)
- `src/dashboard/views.ts` — modify; `renderAgents` (3 sections), `renderAgentsLog`, `formatAgentDuration`
- `src/dashboard/layout.ts` — modify; `Agents` nav entry, timeline-bar/outcome CSS, `agents.js` script tag
- `src/dashboard/static/agents.ts` — create; ~2s poller patching live board + inbox in place (DOM-guarded like `drag.ts`)
- `src/dashboard/static/tsconfig.json` — modify; add `agents.ts` to `include`
- `src/dashboard/static/dist/agents.js` — generated; compiled poller served by `/static/agents.js`
- `src/dashboard/__tests__/dashboard-agents.test.ts` — create; loader pairing/liveness/buckets, renders, routes, log empty state, formatRuntime
- `docs/features/agent-events-phase-tracking-run-ids-and-agents-dashboard-page.md` — modify; fill `links.code` / `links.tests`

---

## Task 1: `AgentEvent` vocabulary + `spawned`/`exited` rows + `spawnId` in the registry

**Files:**

- Modify: `src/core/agent-events.ts`, `src/core/agent-runner/types.ts`, `src/core/agent-runner/registry.ts`, `src/metrics/collect/drain-reliability.ts`, `ideas.md`
- Test: `src/core/agent-runner/__tests__/registry.test.ts`, `src/core/__tests__/agent-events.test.ts`, `src/metrics/__tests__/drain-and-tokens.test.ts`

- [ ] **Step 1: Write the failing registry pairing tests**

In `src/core/agent-runner/__tests__/registry.test.ts`, append `agent-events-phase-tracking-run-ids-and-agents-dashboard-page` to the `// @tests:` header list (comma-separated, keep sorted), then append at the end of the file:

```ts
describe('agent-event vocabulary (spawned/exited pairing + runId)', () => {
  function pidChild(pid: number): FakeChild {
    const child = new FakeChild();
    (child as unknown as { pid: number }).pid = pid;
    return child;
  }
  function readRows(dir: string): Array<Record<string, unknown>> {
    return readFileSync(join(dir, '.noldor', 'agent-events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  it('writes a spawned and an exited row sharing one spawnId, with pid and slug', async () => {
    const dir = tmpConfig();
    const child = pidChild(7777);
    const impl = vi.fn(() => child as never);
    const p = spawnAgent(
      'hello',
      { role: 'implementer', cwd: dir, site: 'drain.spawnGate', slug: 'my-slug' },
      { spawnImpl: impl as never },
    );
    child.emit('close', 0);
    await p;
    const rows = readRows(dir);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      event: 'spawned',
      runner: 'claude',
      role: 'implementer',
      site: 'drain.spawnGate',
      slug: 'my-slug',
      pid: 7777,
    });
    expect(rows[1]).toMatchObject({ event: 'exited', exitCode: 0, slug: 'my-slug' });
    expect(typeof rows[0]!.spawnId).toBe('string');
    expect(rows[1]!.spawnId).toBe(rows[0]!.spawnId);
    expect(rows[0]!.exitCode).toBeUndefined();
    expect(rows[0]!.durationMs).toBeUndefined();
  });

  it('stamps runId from opts.env.NOLDOR_RUN_ID on both rows', async () => {
    const dir = tmpConfig();
    const child = pidChild(4001);
    const impl = vi.fn(() => child as never);
    const p = spawnAgent(
      'x',
      { role: 'implementer', cwd: dir, env: { NOLDOR_RUN_ID: 'opts-run' } },
      { spawnImpl: impl as never },
    );
    child.emit('close', 0);
    await p;
    const rows = readRows(dir);
    expect(rows[0]).toMatchObject({ event: 'spawned', runId: 'opts-run' });
    expect(rows[1]).toMatchObject({ event: 'exited', runId: 'opts-run' });
  });

  it('falls back to process.env.NOLDOR_RUN_ID (nested-spawn transport, spec D1)', async () => {
    vi.stubEnv('NOLDOR_RUN_ID', 'ambient-run');
    try {
      const dir = tmpConfig();
      const child = pidChild(4002);
      const impl = vi.fn(() => child as never);
      const p = spawnAgent('x', { role: 'implementer', cwd: dir }, { spawnImpl: impl as never });
      child.emit('close', 0);
      await p;
      const rows = readRows(dir);
      expect(rows[0]).toMatchObject({ event: 'spawned', runId: 'ambient-run' });
      expect(rows[1]).toMatchObject({ event: 'exited', runId: 'ambient-run' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('mints a fresh spawnId per call (no cross-spawn pairing)', async () => {
    const dir = tmpConfig();
    const a = pidChild(5001);
    const b = pidChild(5002);
    const children = [a, b];
    const impl = vi.fn(() => children.shift() as never);
    const pa = spawnAgent('a', { role: 'implementer', cwd: dir }, { spawnImpl: impl as never });
    a.emit('close', 0);
    await pa;
    const pb = spawnAgent('b', { role: 'implementer', cwd: dir }, { spawnImpl: impl as never });
    b.emit('close', 0);
    await pb;
    const rows = readRows(dir);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.spawnId).toBe(rows[1]!.spawnId);
    expect(rows[2]!.spawnId).toBe(rows[3]!.spawnId);
    expect(rows[0]!.spawnId).not.toBe(rows[2]!.spawnId);
  });
});
```

- [ ] **Step 2: Write the failing metrics duration-filter test**

In `src/metrics/__tests__/drain-and-tokens.test.ts`, append `agent-events-phase-tracking-run-ids-and-agents-dashboard-page` to the `// @tests:` header list, then add inside `describe('collectDrainReliability', …)` after the existing two tests:

```ts
  it('mean duration ignores spawned/phase rows; event-absent rows count as exited', () => {
    const facts = emptyFacts({
      agentEvents: [
        EV({}), // legacy row, no `event` field → exited, 60_000
        EV({ event: 'exited', durationMs: 120_000 }),
        { ts: 't', runner: 'claude', role: 'implementer', event: 'spawned', spawnId: 's', pid: 1 },
        { ts: 't', runner: '-', role: 'drain', event: 'phase', slug: 'a', phase: 'building' },
      ],
    });
    const v = collectDrainReliability(facts).value as {
      history: { meanDurationMs: number };
    };
    expect(v.history.meanDurationMs).toBe(90_000);
  });
```

- [ ] **Step 3: Run to verify FAIL**

```bash
pnpm vitest run src/core/agent-runner/__tests__/registry.test.ts src/metrics/__tests__/drain-and-tokens.test.ts
```

Expected output: `2 failed` test files. Registry: all 4 new vocabulary tests fail (only ONE row per spawn today — `expect(rows).toHaveLength(2)` gets 1; no `event`/`spawnId`/`runId` fields). Metrics: `meanDurationMs` is `NaN` (blind map over a duration-less spawned row) instead of `90000`. Pre-existing tests stay green.

- [ ] **Step 4: Extend the `AgentEvent` interface and repoint the rotation comment**

Replace the entire contents of `src/core/agent-events.ts` with:

```ts
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One line of `.noldor/agent-events.jsonl`.
 *
 * Per-event field contract (`event` absent ⇒ `'exited'` — every historical row
 * was written by the registry's close handler, so readers MUST treat a missing
 * `event` as a completed-spawn record):
 * - `spawned` — spawn started: carries `pid` (+ `spawnId`, `runId`, `slug`);
 *   never carries `exitCode`/`durationMs`/`timedOut`.
 * - `exited`  — spawn completed: carries `exitCode`/`durationMs`/`timedOut`
 *   (+ `spawnId` pairing it to its `spawned` row, `tokens` when known).
 * - `phase`   — coarse drain phase transition from the heartbeat tap: carries
 *   `slug` + `phase` (building | awaiting-merge | merging | merged).
 */
export interface AgentEvent {
  ts: string;
  runner: string;
  role: string;
  site?: string;
  /** Row vocabulary. Absent ⇒ 'exited' (pre-vocabulary rows; readers honor this). */
  event?: 'spawned' | 'exited' | 'phase';
  /** Optional writer-specific kind (e.g. 'salvaged', 'resolved'). */
  kind?: string;
  /** Slug the event concerns, when item-scoped. */
  slug?: string;
  /** Drain-run correlation id (`<startedAt ISO>.<pid>`); absent on pre-run-id rows. */
  runId?: string;
  /** Pairs one spawn's spawned/exited rows (randomUUID); pid is unsafe for pairing (reuse). */
  spawnId?: string;
  /** Child pid at spawn time — liveness probes only, never pairing. */
  pid?: number;
  /** Coarse drain phase — only on event:'phase' rows. */
  phase?: string;
  /** Only meaningful on exited rows (event absent or 'exited'). */
  exitCode?: number;
  /** Only meaningful on exited rows. */
  durationMs?: number;
  /** Only meaningful on exited rows. */
  timedOut?: boolean;
  /**
   * Raw token usage, read VERBATIM from the runner's native usage records
   * (never estimated, never derived from text length). Absent when the
   * runner exposed no trustworthy usage data. NEVER converted to cost.
   */
  tokens?: { input: number; output: number; total: number; source: string };
}

/**
 * Append one event line to `.noldor/agent-events.jsonl`. FAIL-OPEN: an
 * events-write failure must never break a spawn, so every fs error is
 * swallowed. Rotation/retention is deliberately deferred — see the
 * "agent-events log rotation" follow-up seeded in ideas.md (spec D5).
 */
export function appendAgentEvent(cwd: string, event: AgentEvent): void {
  try {
    const dir = join(cwd, '.noldor');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'agent-events.jsonl'), JSON.stringify(event) + '\n', 'utf8');
  } catch {
    // fail-open by contract
  }
}
```

- [ ] **Step 5: Add `slug` to `SpawnAgentOpts`**

In `src/core/agent-runner/types.ts`, inside `SpawnAgentOpts`, insert after the `site?: string;` member (keep its JSDoc):

```ts
  /** Slug the spawn concerns — stamped on its spawned/exited event rows (drain candidate). */
  slug?: string;
```

- [ ] **Step 6: Mint `spawnId`, resolve `runId`, write both rows in the registry**

In `src/core/agent-runner/registry.ts`:

(a) Add to the `node:child_process`/`node:fs` import block at the top:

```ts
import { randomUUID } from 'node:crypto';
```

(b) Replace:

```ts
  const plan = planSpawn(resolved, prompt, opts);
  const spawnImpl = deps.spawnImpl ?? nodeSpawn;
  const started = Date.now();
```

with:

```ts
  const plan = planSpawn(resolved, prompt, opts);
  const spawnImpl = deps.spawnImpl ?? nodeSpawn;
  const started = Date.now();
  // Pairing id for this spawn's `spawned`/`exited` event rows — pid alone is
  // unsafe (reuse). Minted per call, stamped on both rows.
  const spawnId = randomUUID();
  // Passive telemetry correlation, NOT a directive: directives ride the prompt
  // (PR #33 rule) — runId rides env DELIBERATELY so nested registry spawns
  // inside a gate child (CR lanes, prep) inherit the same id with zero
  // call-site changes. Do not "fix" this onto the prompt.
  const runId = opts.env?.NOLDOR_RUN_ID ?? process.env.NOLDOR_RUN_ID;
```

(c) Replace the pid guard:

```ts
    if (child.pid !== undefined) opts.onSpawn?.(child.pid);
```

with:

```ts
    if (child.pid !== undefined) {
      appendAgentEvent(cwd, {
        event: 'spawned',
        ts: new Date().toISOString(),
        runner: resolved.runner,
        role: opts.role,
        site: opts.site,
        ...(opts.slug !== undefined ? { slug: opts.slug } : {}),
        ...(runId !== undefined ? { runId } : {}),
        spawnId,
        pid: child.pid,
      });
      opts.onSpawn?.(child.pid);
    }
```

(d) Replace the close-handler append:

```ts
      appendAgentEvent(cwd, {
        ts: new Date().toISOString(),
        runner: resolved.runner,
        role: opts.role,
        site: opts.site,
        exitCode,
        durationMs: Date.now() - started,
        timedOut,
        ...(usage ? { tokens: usage } : {}),
      });
```

with:

```ts
      appendAgentEvent(cwd, {
        event: 'exited',
        ts: new Date().toISOString(),
        runner: resolved.runner,
        role: opts.role,
        site: opts.site,
        ...(opts.slug !== undefined ? { slug: opts.slug } : {}),
        ...(runId !== undefined ? { runId } : {}),
        spawnId,
        exitCode,
        durationMs: Date.now() - started,
        timedOut,
        ...(usage ? { tokens: usage } : {}),
      });
```

(e) Update the `spawnAgent` JSDoc line "appends one agent-event per completed spawn (fail-open)" to:

```
 * and appends paired `spawned`/`exited` agent-events (fail-open; shared spawnId).
```

- [ ] **Step 7: Filter drain-reliability durations to exited rows**

In `src/metrics/collect/drain-reliability.ts`, replace:

```ts
  const durations = facts.agentEvents.map((e) => e.durationMs);
```

with:

```ts
  // `event` absent ⇒ exited (pre-vocabulary rows): only completed spawns carry
  // a duration — a `spawned`/`phase` row has none and must not drag the mean to 0.
  const durations = facts.agentEvents
    .filter((e) => e.event === 'exited' || e.event === undefined)
    .map((e) => e.durationMs ?? 0);
```

- [ ] **Step 8: Pin the phase-row shape in the agent-events test + seed the rotation follow-up**

In `src/core/__tests__/agent-events.test.ts`, append `agent-events-phase-tracking-run-ids-and-agents-dashboard-page` to the `// @tests:` header list and add inside `describe('appendAgentEvent', …)`:

```ts
  it('serializes a phase row without exit fields (vocabulary extension)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-events-'));
    appendAgentEvent(dir, {
      event: 'phase',
      ts: '2026-07-03T00:00:00.000Z',
      runner: '-',
      role: 'drain',
      site: 'drain.heartbeat',
      runId: '2026-07-03T00:00:00.000Z.123',
      slug: 'foo',
      phase: 'building',
    });
    const parsed = JSON.parse(
      readFileSync(join(dir, '.noldor/agent-events.jsonl'), 'utf8').trim(),
    ) as Record<string, unknown>;
    expect(parsed).toMatchObject({ event: 'phase', phase: 'building', slug: 'foo' });
    expect(parsed.exitCode).toBeUndefined();
    expect(parsed.timedOut).toBeUndefined();
  });
```

In `ideas.md`, under the `## Not groomed` heading, append this bullet after the existing ones:

```md
- Agent-events log rotation/retention — deferred from the /agents entry (spec D5): `.noldor/agent-events.jsonl` grows without bound (phase rows add ~4 lines per slug per run). Rotation adds file-swap complexity to a fail-open writer; design size-or-age-based rotation (keep last N runs readable for the /agents timeline) as its own entry. Touches: `src/core/agent-events.ts`, `src/dashboard/data.ts` readers.
```

- [ ] **Step 9: Run to verify PASS**

```bash
pnpm vitest run src/core/agent-runner/__tests__/registry.test.ts src/core/__tests__/agent-events.test.ts src/metrics/__tests__/drain-and-tokens.test.ts
```

Expected output: `Test Files  3 passed (3)` — the 4 pairing/runId tests, the phase-row pin, and the mean-duration filter all green; every pre-existing test in those files still green.

- [ ] **Step 10: Format, lint, typecheck**

```bash
pnpm fmt && pnpm lint && pnpm typecheck
```

Expected output: oxfmt rewrites at most the touched files; oxlint clean; `tsc --noEmit` exits 0 (the optional-fields change compiles everywhere — the only consumer of `durationMs` as required was fixed in Step 7).

- [ ] **Step 11: Commit**

```bash
git add src/core/agent-events.ts src/core/agent-runner/types.ts src/core/agent-runner/registry.ts src/metrics/collect/drain-reliability.ts src/core/agent-runner/__tests__/registry.test.ts src/core/__tests__/agent-events.test.ts src/metrics/__tests__/drain-and-tokens.test.ts ideas.md
git commit -m "feat(core): agent-event vocabulary — paired spawned/exited rows with spawnId" -m "Noldor-FD: agent-events-phase-tracking-run-ids-and-agents-dashboard-page"
```

---

## Task 2: Run-id mint + thread (shells, spawnGate slug, escalations, salvage, metrics blind spot)

**Files:**

- Modify: `src/autonomous/queue-drain.ts`, `src/autonomous/watch.ts`, `src/autonomous/drain-loop.ts`, `src/autonomous/drain-io.ts`, `src/autonomous/escalations.ts`, `src/autonomous/salvage.ts`, `src/metrics/collect/drain-reliability.ts`
- Test: `src/autonomous/__tests__/escalations.test.ts`, `src/autonomous/__tests__/run-drain.test.ts`, `src/metrics/__tests__/drain-and-tokens.test.ts`

- [ ] **Step 1: Write the failing mapCycle runId tests**

In `src/autonomous/__tests__/escalations.test.ts`, append `agent-events-phase-tracking-run-ids-and-agents-dashboard-page` to the `// @tests:` header list, then add inside `describe('mapCycle', …)` after the last test:

```ts
  it('stamps the cycle runId on escalation rows when provided', () => {
    const v = mapCycle(
      input({
        result: result({ skipped: ['a'], skipReasons: { a: 'retries-exhausted' } }),
        queueUniverse: ['a'],
        runId: '2026-07-03T10:00:00.000Z.42',
      }),
    );
    expect(v.escalations[0]).toMatchObject({ runId: '2026-07-03T10:00:00.000Z.42' });
  });

  it('omits runId entirely when not provided (back-compat rows)', () => {
    const v = mapCycle(input({ result: result({ error: 'boom' }) }));
    expect(v.escalations).toHaveLength(1);
    expect('runId' in v.escalations[0]!).toBe(false);
  });
```

- [ ] **Step 2: Write the failing slug-threading test**

In `src/autonomous/__tests__/run-drain.test.ts`, append `agent-events-phase-tracking-run-ids-and-agents-dashboard-page` to the `// @tests:` header list. Replace the harness `spawnGate` mock:

```ts
  const spawnGate = vi.fn(
    async (_env: Record<string, string>, _timeoutMs: number, _prompt: string) => {
      const code = (opts.spawnImpl ?? (() => 0))(); // may throw (timeout) → no removal
      if (lastTarget !== null && ships(lastTarget))
        roadmap = roadmap.filter((s) => s !== lastTarget);
      return code;
    },
  );
```

with:

```ts
  const spawnGate = vi.fn(
    async (
      _env: Record<string, string>,
      _timeoutMs: number,
      _prompt: string,
      _onSpawn?: (pgid: number) => void,
      _slug?: string,
    ) => {
      const code = (opts.spawnImpl ?? (() => 0))(); // may throw (timeout) → no removal
      if (lastTarget !== null && ships(lastTarget))
        roadmap = roadmap.filter((s) => s !== lastTarget);
      return code;
    },
  );
```

Then add inside `describe('runDrain', …)` after the last test:

```ts
  it('passes the candidate slug to spawnGate (agent-event slug stamping)', async () => {
    const h = harness(['a']);
    await runDrain(h.deps, opts);
    expect(h.spawnGate).toHaveBeenCalledTimes(1);
    expect(h.spawnGate.mock.calls[0]![4]).toBe('a');
  });
```

- [ ] **Step 3: Write the failing blind-spot/samples test**

In `src/metrics/__tests__/drain-and-tokens.test.ts`, add after the `EV` helper:

```ts
import type { EscalationRow } from '../../autonomous/escalations';

const ESC = (over: Partial<EscalationRow>): EscalationRow => ({
  ts: '2026-07-03T01:00:00Z',
  slug: 'c',
  source: 'roadmap',
  reason: 'retries-exhausted',
  evidence: 'e',
  stateSnapshot: { shipped: 0, skipped: [] },
  suggestedAction: 'x',
  ...over,
});
```

(Move the `import type` line up into the file's import block — imports live at the top.) Then add inside `describe('collectDrainReliability', …)`:

```ts
  it('keys samples with runId and no longer lists the run-id blind spot', () => {
    const facts = emptyFacts({ escalations: [ESC({ runId: 'r-1' }), ESC({ slug: 'd' })] });
    const r = collectDrainReliability(facts);
    expect(r.blindSpots.join(' ')).not.toMatch(/no run identifier|out of v1 scope/i);
    expect(r.samples[0]).toMatchObject({ slug: 'c', runId: 'r-1' });
    expect('runId' in (r.samples[1] as Record<string, unknown>)).toBe(false);
  });
```

- [ ] **Step 4: Run to verify FAIL**

```bash
pnpm vitest run src/autonomous/__tests__/escalations.test.ts src/autonomous/__tests__/run-drain.test.ts src/metrics/__tests__/drain-and-tokens.test.ts
```

Expected output: `3 failed` test files — mapCycle rows carry no `runId` (toMatchObject fails), `spawnGate.mock.calls[0]![4]` is `undefined` (loop passes 4 args today), blind-spot regex still matches `"run-id is out of v1 scope"` and samples lack `runId`.

- [ ] **Step 5: Add `runId` to `EscalationRow` and `mapCycle`**

In `src/autonomous/escalations.ts`:

(a) In `EscalationRow`, add after `suggestedAction: string;`:

```ts
  /** Drain-run correlation id (mirrors agent-event rows); absent on pre-run-id rows. */
  runId?: string;
```

(b) In the `mapCycle` input type, add after `now: string;`:

```ts
  /** The shell's run/cycle id — stamped on every row of this verdict. */
  runId?: string;
```

(c) Replace the destructure line:

```ts
  const { result, mode, source, parked, pendingPr, prevRunAbortError, queueUniverse, now } = input;
```

with:

```ts
  const { result, mode, source, parked, pendingPr, prevRunAbortError, queueUniverse, now, runId } =
    input;
```

(d) Replace the `row` helper:

```ts
  const row = (slug: string, reason: EscalationReason, evidence: string): EscalationRow => ({
    ts: now,
    slug,
    source,
    reason,
    evidence,
    stateSnapshot: snapshot,
    suggestedAction: SUGGESTED_ACTIONS[reason],
  });
```

with:

```ts
  const row = (slug: string, reason: EscalationReason, evidence: string): EscalationRow => ({
    ts: now,
    slug,
    source,
    reason,
    evidence,
    stateSnapshot: snapshot,
    suggestedAction: SUGGESTED_ACTIONS[reason],
    ...(runId !== undefined ? { runId } : {}),
  });
```

- [ ] **Step 6: Thread `slug` through `DrainDeps.spawnGate` and `drain-io`**

In `src/autonomous/drain-loop.ts`:

(a) Replace the `spawnGate` member of `DrainDeps` (keep its JSDoc, extend the last sentence):

```ts
  spawnGate: (
    env: Record<string, string>,
    timeoutMs: number,
    prompt: string,
    onSpawn?: (pgid: number) => void,
  ) => Promise<number>;
```

with:

```ts
  spawnGate: (
    env: Record<string, string>,
    timeoutMs: number,
    prompt: string,
    onSpawn?: (pgid: number) => void,
    slug?: string,
  ) => Promise<number>;
```

and append to that member's JSDoc (before the closing `*/`): `` `slug` is the candidate being built — stamped on the spawn's agent-event rows (K=1 has no `NOLDOR_DRAIN_SLUG`, so the loop passes it explicitly). ``

(b) In the worker, replace the spawn call:

```ts
        const code = await deps.spawnGate(
          envFor(candidate.slug),
          opts.timeoutMs,
          deps.source.gatePrompt(candidate.slug),
          (pgid) => {
            childPgid = pgid;
            livePgids.add(pgid);
            emitState(); // heartbeat now carries the live pgid for the next run's reap
          },
        );
```

with:

```ts
        const code = await deps.spawnGate(
          envFor(candidate.slug),
          opts.timeoutMs,
          deps.source.gatePrompt(candidate.slug),
          (pgid) => {
            childPgid = pgid;
            livePgids.add(pgid);
            emitState(); // heartbeat now carries the live pgid for the next run's reap
          },
          candidate.slug,
        );
```

In `src/autonomous/drain-io.ts`, replace the `spawnGate` signature and `spawnAgent` call:

```ts
export async function spawnGate(
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  prompt = '/gate',
  onSpawn?: (pgid: number) => void,
): Promise<number> {
  const r = await spawnAgent(prompt, {
    role: 'implementer',
    cwd,
    env,
    timeoutMs,
    stdio: 'inherit',
    needsWrite: true,
    site: 'drain.spawnGate',
    onSpawn,
  });
```

with:

```ts
export async function spawnGate(
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  prompt = '/gate',
  onSpawn?: (pgid: number) => void,
  slug?: string,
): Promise<number> {
  const r = await spawnAgent(prompt, {
    role: 'implementer',
    cwd,
    env,
    timeoutMs,
    stdio: 'inherit',
    needsWrite: true,
    site: 'drain.spawnGate',
    onSpawn,
    slug,
  });
```

- [ ] **Step 7: Mint the runId in both shells and merge it into the gate env**

In `src/autonomous/queue-drain.ts`:

(a) Replace:

```ts
  const startedAt = new Date().toISOString();
```

with:

```ts
  const startedAt = new Date().toISOString();
  // Run correlation id (spec Unit 1): sortable, collision-free, human-legible.
  // Exported into our own env so direct appendAgentEvent writers in this
  // process (salvage) and the registry's ambient fallback resolve the same id.
  const runId = `${startedAt}.${String(process.pid)}`;
  process.env.NOLDOR_RUN_ID = runId;
```

(b) In the `const deps: DrainDeps = { … }` block, replace the `spawnGate` line:

```ts
    spawnGate: (env, timeoutMs, prompt, onSpawn) => spawnGate(cwd, env, timeoutMs, prompt, onSpawn),
```

with:

```ts
    spawnGate: (env, timeoutMs, prompt, onSpawn, slug) =>
      spawnGate(cwd, { ...env, NOLDOR_RUN_ID: runId }, timeoutMs, prompt, onSpawn, slug),
```

(c) In the `mapCycle({ … })` call at the bottom of `main()`, add `runId,` after `now: runNow,`.

In `src/autonomous/watch.ts`:

(d) Replace:

```ts
      const source = parkAwareSource(baseSource, () => loadPark(cwd));
```

with:

```ts
      const source = parkAwareSource(baseSource, () => loadPark(cwd));
      // Per-CYCLE run id (spec D7): each cycle is one runDrain with its own
      // outcome totals. The ambient env copy feeds salvage + nested spawns.
      const runId = `${new Date().toISOString()}.${String(process.pid)}`;
      process.env.NOLDOR_RUN_ID = runId;
```

(e) In the cycle's `const deps: DrainDeps = { … }` block, replace:

```ts
        spawnGate: (env, timeoutMs, prompt, onSpawn) =>
          spawnGate(cwd, env, timeoutMs, prompt, onSpawn),
```

with:

```ts
        spawnGate: (env, timeoutMs, prompt, onSpawn, slug) =>
          spawnGate(cwd, { ...env, NOLDOR_RUN_ID: runId }, timeoutMs, prompt, onSpawn, slug),
```

(f) In the cycle's `mapCycle({ … })` call, add `runId,` after `now,`.

- [ ] **Step 8: Stamp `runId` on the two salvage append sites**

In `src/autonomous/salvage.ts`, in `makeSalvage`, replace:

```ts
    appendAgentEvent(cwd, {
      ts: new Date().toISOString(),
      runner: 'drain',
      role,
      kind: 'salvaged',
      slug,
      site: reasons.join(','),
      exitCode: 0,
      durationMs: Date.now() - started,
      timedOut: false,
    });
```

with:

```ts
    appendAgentEvent(cwd, {
      ts: new Date().toISOString(),
      runner: 'drain',
      role,
      kind: 'salvaged',
      slug,
      site: reasons.join(','),
      ...(process.env.NOLDOR_RUN_ID !== undefined ? { runId: process.env.NOLDOR_RUN_ID } : {}),
      exitCode: 0,
      durationMs: Date.now() - started,
      timedOut: false,
    });
```

and in `makeRoadmapConflictResolver`, replace:

```ts
      appendAgentEvent(cwd, {
        ts: new Date().toISOString(),
        runner: 'drain',
        role,
        kind: 'resolved',
        slug,
        exitCode: 0,
        durationMs: Date.now() - started,
        timedOut: false,
      });
```

with:

```ts
      appendAgentEvent(cwd, {
        ts: new Date().toISOString(),
        runner: 'drain',
        role,
        kind: 'resolved',
        slug,
        ...(process.env.NOLDOR_RUN_ID !== undefined ? { runId: process.env.NOLDOR_RUN_ID } : {}),
        exitCode: 0,
        durationMs: Date.now() - started,
        timedOut: false,
      });
```

(Both writers run inside the shell process, which exported `NOLDOR_RUN_ID` in Step 7 — no unit test shells out here; coverage is the Step 1/3 tests plus typecheck, matching this file's existing pure-parts-only test posture.)

- [ ] **Step 9: Remove the blind spot and key samples with runId**

In `src/metrics/collect/drain-reliability.ts`:

(a) Replace the `formula` string:

```ts
    formula:
      'lastRun: shipped/skip/retries from .noldor/drain-state.json (live snapshot, overwritten per run). history: salvaged = agent-events kind=salvaged; escalated = escalations.jsonl counts (total/per-slug — rows carry no run id); mean duration over all agent-events.',
```

with:

```ts
    formula:
      'lastRun: shipped/skip/retries from .noldor/drain-state.json (live snapshot, overwritten per run). history: salvaged = agent-events kind=salvaged; escalated = escalations.jsonl counts (total/per-slug); mean duration over exited agent-events (spawned/phase rows excluded).',
```

(b) Replace the blind-spots entry:

```ts
      'EscalationRow has no run identifier — per-run escalation grouping is not derivable (run-id is out of v1 scope).',
```

with:

```ts
      'Rows written before run ids shipped carry no runId — they group under "(no run id)".',
```

(c) Replace the samples line:

```ts
    samples: facts.escalations.map((e) => ({ slug: e.slug, reason: e.reason, ts: e.ts })),
```

with:

```ts
    samples: facts.escalations.map((e) => ({
      slug: e.slug,
      reason: e.reason,
      ts: e.ts,
      ...(e.runId !== undefined ? { runId: e.runId } : {}),
    })),
```

- [ ] **Step 10: Run to verify PASS**

```bash
pnpm vitest run src/autonomous/__tests__/escalations.test.ts src/autonomous/__tests__/run-drain.test.ts src/metrics/__tests__/drain-and-tokens.test.ts src/autonomous/__tests__/build-pool.test.ts src/autonomous/__tests__/merge-coordinator.test.ts
```

Expected output: `Test Files  5 passed (5)` — the new runId/slug tests green; build-pool and merge-coordinator (own 3-param spawnGate mocks, structurally assignable to the widened 5-param type) untouched and green.

- [ ] **Step 11: Format, lint, typecheck**

```bash
pnpm fmt && pnpm lint && pnpm typecheck
```

Expected output: all clean, exit 0.

- [ ] **Step 12: Commit**

```bash
git add src/autonomous/queue-drain.ts src/autonomous/watch.ts src/autonomous/drain-loop.ts src/autonomous/drain-io.ts src/autonomous/escalations.ts src/autonomous/salvage.ts src/metrics/collect/drain-reliability.ts src/autonomous/__tests__/escalations.test.ts src/autonomous/__tests__/run-drain.test.ts src/metrics/__tests__/drain-and-tokens.test.ts
git commit -m "feat(autonomous): mint drain run ids and thread them through events, escalations, salvage" -m "Noldor-FD: agent-events-phase-tracking-run-ids-and-agents-dashboard-page"
```

---

## Task 3: Phase-diff tap on the heartbeat

**Files:**

- Create: `src/autonomous/phase-events.ts`
- Modify: `src/autonomous/queue-drain.ts`, `src/autonomous/watch.ts`
- Test: `src/autonomous/__tests__/phase-events.test.ts`

- [ ] **Step 1: Write the failing phase-tap tests**

Create `src/autonomous/__tests__/phase-events.test.ts` with exactly:

```ts
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
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/autonomous/__tests__/phase-events.test.ts
```

Expected output: `Test Files  1 failed (1)` — `Cannot find module '../phase-events.js'` (module does not exist yet).

- [ ] **Step 3: Implement `phase-events.ts`**

Create `src/autonomous/phase-events.ts` with exactly:

```ts
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
```

- [ ] **Step 4: Wire the tap into both shells**

In `src/autonomous/queue-drain.ts`:

(a) Add to the imports (after the `drain-state.js` import line):

```ts
import { makePhaseTap } from './phase-events.js';
```

(b) In the `const deps: DrainDeps = { … }` block, replace:

```ts
    writeState: (s) => writeState(cwd, projectDrainState(process.pid, startedAt, s)),
```

with:

```ts
    writeState: makePhaseTap(cwd, runId, (s) =>
      writeState(cwd, projectDrainState(process.pid, startedAt, s)),
    ),
```

In `src/autonomous/watch.ts`:

(c) Add to the imports (after the `drain-state.js` import line):

```ts
import { makePhaseTap } from './phase-events.js';
```

(d) In the cycle's `const deps: DrainDeps = { … }` block, replace:

```ts
        writeState: (s) => writeState(cwd, projectDrainState(process.pid, startedAt, s)),
```

with:

```ts
        writeState: makePhaseTap(cwd, runId, (s) =>
          writeState(cwd, projectDrainState(process.pid, startedAt, s)),
        ),
```

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/autonomous/__tests__/phase-events.test.ts src/autonomous/__tests__/run-drain.test.ts
```

Expected output: `Test Files  2 passed (2)` — all 5 phase tests green; run-drain untouched (the tap is shell-level, `runDrain` unchanged).

- [ ] **Step 6: Format, lint, typecheck**

```bash
pnpm fmt && pnpm lint && pnpm typecheck
```

Expected output: all clean, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/autonomous/phase-events.ts src/autonomous/__tests__/phase-events.test.ts src/autonomous/queue-drain.ts src/autonomous/watch.ts
git commit -m "feat(autonomous): phase-event tap on the drain heartbeat (building/awaiting-merge/merging/merged)" -m "Noldor-FD: agent-events-phase-tracking-run-ids-and-agents-dashboard-page"
```

---

## Task 4: `loadAgentActivity` loader + `GET /api/agents`

**Files:**

- Modify: `src/dashboard/data.ts`, `src/dashboard/server.ts`
- Test: `src/dashboard/__tests__/dashboard-agents.test.ts` (create)

- [ ] **Step 1: Write the failing loader tests**

Create `src/dashboard/__tests__/dashboard-agents.test.ts` with exactly:

```ts
// @tests: agent-events-phase-tracking-run-ids-and-agents-dashboard-page

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAgentActivity, loadWatchLogTail, NO_RUN_ID } from '../data.js';
import { startServer } from '../server.js';

import type { Server } from 'node:http';

const T0 = '2026-07-03T10:00:00.000Z';

function eventsFixture(lines: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-agents-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor', 'agent-events.jsonl'),
    lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n',
    'utf8',
  );
  return dir;
}

describe('loadAgentActivity', () => {
  it('derives the live board: unpaired spawned rows, pid-liveness filtered, phase + retries joined', async () => {
    const dir = eventsFixture([
      {
        ts: T0,
        runner: 'claude',
        role: 'implementer',
        site: 'drain.spawnGate',
        event: 'spawned',
        spawnId: 'live-1',
        pid: 111,
        runId: 'r-1',
        slug: 'feat-a',
      },
      {
        ts: T0,
        runner: 'claude',
        role: 'reviewer',
        site: 'cr.subagent-dispatch',
        event: 'spawned',
        spawnId: 'dead-1',
        pid: 222,
        runId: 'r-1',
      },
      {
        ts: T0,
        runner: 'claude',
        role: 'implementer',
        site: 'drain.spawnGate',
        event: 'spawned',
        spawnId: 'done-1',
        pid: 333,
        runId: 'r-1',
        slug: 'feat-b',
      },
      {
        ts: T0,
        runner: 'claude',
        role: 'implementer',
        site: 'drain.spawnGate',
        event: 'exited',
        spawnId: 'done-1',
        runId: 'r-1',
        slug: 'feat-b',
        exitCode: 0,
        durationMs: 60_000,
        timedOut: false,
      },
      {
        ts: T0,
        runner: '-',
        role: 'drain',
        site: 'drain.heartbeat',
        event: 'phase',
        runId: 'r-1',
        slug: 'feat-a',
        phase: 'building',
      },
    ]);
    writeFileSync(
      join(dir, '.noldor', 'drain-state.json'),
      JSON.stringify({
        pid: 1,
        startedAt: T0,
        phase: 'spawning',
        inFlight: [],
        merging: null,
        currentSlug: null,
        shipped: 0,
        skip: [],
        retries: { 'feat-a': 1 },
      }),
    );
    const activity = await loadAgentActivity(dir, {
      isPidAlive: (pid) => pid !== 222, // dead-1's pid is gone
      nowMs: () => Date.parse(T0) + 90_000,
    });
    expect(activity.live).toHaveLength(1);
    expect(activity.live[0]).toMatchObject({
      spawnId: 'live-1',
      kind: 'implementer',
      slug: 'feat-a',
      lane: 'drain.spawnGate',
      phase: 'building',
      retries: 1,
      stale: false,
      runId: 'r-1',
      pid: 111,
    });
    expect(activity.live[0]!.runtimeMs).toBe(90_000);
  });

  it('flags a live row past the staleness ceiling as stale (pid-reuse mitigation)', async () => {
    const dir = eventsFixture([
      {
        ts: T0,
        runner: 'claude',
        role: 'implementer',
        event: 'spawned',
        spawnId: 's',
        pid: 1,
      },
    ]);
    const activity = await loadAgentActivity(dir, {
      isPidAlive: () => true,
      nowMs: () => Date.parse(T0) + 3 * 60 * 60 * 1000, // 3h later
    });
    expect(activity.live).toHaveLength(1);
    expect(activity.live[0]!.stale).toBe(true);
  });

  it('groups runs newest-first with the legacy (no run id) bucket last, event-absent rows as exited', async () => {
    const dir = eventsFixture([
      // pre-vocabulary row: no event, no runId → exited bar in the legacy bucket
      {
        ts: '2026-06-01T00:00:00.000Z',
        runner: 'claude',
        role: 'implementer',
        exitCode: 0,
        durationMs: 1000,
        timedOut: false,
      },
      {
        ts: '2026-07-03T10:00:00.000Z',
        runner: 'claude',
        role: 'implementer',
        event: 'spawned',
        spawnId: 's1',
        pid: 1,
        runId: 'r-old',
      },
      {
        ts: '2026-07-03T10:01:00.000Z',
        runner: 'claude',
        role: 'implementer',
        event: 'exited',
        spawnId: 's1',
        runId: 'r-old',
        exitCode: 1,
        durationMs: 60_000,
        timedOut: false,
      },
      {
        ts: '2026-07-03T11:00:00.000Z',
        runner: 'claude',
        role: 'implementer',
        event: 'spawned',
        spawnId: 's2',
        pid: 2,
        runId: 'r-new',
        slug: 'feat-a',
      },
      {
        ts: '2026-07-03T11:05:00.000Z',
        runner: 'claude',
        role: 'implementer',
        event: 'exited',
        spawnId: 's2',
        runId: 'r-new',
        slug: 'feat-a',
        exitCode: 0,
        durationMs: 300_000,
        timedOut: false,
      },
      {
        ts: '2026-07-03T11:06:00.000Z',
        runner: '-',
        role: 'drain',
        event: 'phase',
        runId: 'r-new',
        slug: 'feat-a',
        phase: 'merged',
      },
    ]);
    const activity = await loadAgentActivity(dir, { isPidAlive: () => false });
    expect(activity.runs.map((r) => r.runId)).toEqual(['r-new', 'r-old', NO_RUN_ID]);
    expect(activity.runs[0]!.totals).toEqual({ shipped: 1, unfinished: 0, escalated: 0 });
    expect(activity.runs[0]!.bars[0]).toMatchObject({
      outcome: 'ok',
      durationMs: 300_000,
      slug: 'feat-a',
    });
    expect(activity.runs[0]!.bars[0]!.startMs).toBe(Date.parse('2026-07-03T11:00:00.000Z'));
    expect(activity.runs[1]!.bars[0]).toMatchObject({ outcome: 'failed' });
    expect(activity.runs[2]!.bars).toHaveLength(1); // legacy row renders as an exited bar
  });

  it('classifies timeout and salvaged outcomes and counts runId-matching escalations', async () => {
    const dir = eventsFixture([
      {
        ts: T0,
        runner: 'claude',
        role: 'implementer',
        event: 'exited',
        spawnId: 't1',
        runId: 'r-1',
        exitCode: -1,
        durationMs: 5000,
        timedOut: true,
      },
      {
        ts: T0,
        runner: 'drain',
        role: 'run',
        kind: 'salvaged',
        slug: 'feat-x',
        runId: 'r-1',
        exitCode: 0,
        durationMs: 100,
        timedOut: false,
      },
    ]);
    writeFileSync(
      join(dir, '.noldor', 'escalations.jsonl'),
      `${JSON.stringify({ ts: T0, slug: 'feat-x', source: 'roadmap', reason: 'retries-exhausted', evidence: 'e', stateSnapshot: { shipped: 0, skipped: [] }, suggestedAction: 'x', runId: 'r-1' })}\n`,
      'utf8',
    );
    const activity = await loadAgentActivity(dir, { isPidAlive: () => false });
    expect(activity.runs).toHaveLength(1);
    const outcomes = activity.runs[0]!.bars.map((b) => b.outcome).toSorted();
    expect(outcomes).toEqual(['salvaged', 'timeout']);
    expect(activity.runs[0]!.totals.escalated).toBe(1);
  });

  it('skips corrupt lines and tolerates absent files entirely', async () => {
    const dir = eventsFixture([
      '{not json',
      { ts: T0, runner: 'claude', role: 'implementer', event: 'spawned', spawnId: 'x', pid: 9 },
    ]);
    const activity = await loadAgentActivity(dir, { isPidAlive: () => true });
    expect(activity.runs).toHaveLength(1);
    expect(activity.live).toHaveLength(1);
    const empty = await loadAgentActivity(mkdtempSync(join(tmpdir(), 'noldor-agents-empty-')));
    expect(empty).toEqual({ live: [], runs: [], inbox: [] });
  });
});

describe('loadWatchLogTail', () => {
  it('returns null when the watch log is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-agents-log-'));
    expect(await loadWatchLogTail(dir)).toBeNull();
  });

  it('returns only the last N lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-agents-log-'));
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    const lines = Array.from({ length: 300 }, (_, i) => `line-${i}`);
    writeFileSync(join(dir, '.noldor', 'watch.log'), lines.join('\n'), 'utf8');
    const tail = await loadWatchLogTail(dir, 200);
    expect(tail).not.toBeNull();
    expect(tail).not.toContain('line-99\n');
    expect(tail!.startsWith('line-100')).toBe(true);
    expect(tail!.trimEnd().endsWith('line-299')).toBe(true);
  });
});

describe('GET /api/agents', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns application/json with live, runs, and inbox keys', async () => {
    const res = await fetch(`${baseUrl}/api/agents`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.live)).toBe(true);
    expect(Array.isArray(body.runs)).toBe(true);
    expect(Array.isArray(body.inbox)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/dashboard/__tests__/dashboard-agents.test.ts
```

Expected output: `Test Files  1 failed (1)` — `data.js` has no export named `loadAgentActivity` (import error fails the whole file).

- [ ] **Step 3: Implement the loader in `data.ts`**

In `src/dashboard/data.ts`:

(a) Add to the import block (after the `worktree-status.js` import):

```ts
import { readInboxRows, type InboxRow } from '../autonomous/escalations.js';
import { WATCH_LOG_REL } from '../autonomous/watch-detach.js';
```

and to the type-import block at the bottom of the imports (next to the other `import type` lines):

```ts
import type { AgentEvent } from '../core/agent-events.js';
import type { DrainState } from '../autonomous/drain-state.js';
```

(b) Append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Agent activity (/agents page + /api/agents)

/** Timeline bucket for event rows written before run ids existed (spec D6). */
export const NO_RUN_ID = '(no run id)';

/**
 * Live rows spawned longer ago than this are flagged stale, not live —
 * pid-liveness can false-positive on a recycled pid (spec risk #2). Generous
 * vs the 30-min default iteration timeout to tolerate raised timeouts.
 */
export const LIVE_STALE_CEILING_MS = 2 * 60 * 60 * 1000;

export type { InboxRow };

export interface LiveAgentRow {
  spawnId: string;
  runId: string | null;
  /** Agent role — the board's "kind" column. */
  kind: string;
  slug: string | null;
  /** Spawn site (e.g. drain.spawnGate, cr.verify-dispatch) — the "lane" column. */
  lane: string | null;
  /** Latest phase row for the slug, when any. */
  phase: string | null;
  pid: number;
  startedTs: string;
  runtimeMs: number;
  retries: number;
  stale: boolean;
}

export interface AgentRunBar {
  kind: string;
  slug: string | null;
  lane: string | null;
  /** Epoch ms of the paired spawned row (fallback: exited ts − duration). */
  startMs: number | null;
  durationMs: number;
  outcome: 'ok' | 'failed' | 'timeout' | 'salvaged';
}

export interface AgentRunGroup {
  runId: string;
  startTs: string;
  endTs: string;
  bars: AgentRunBar[];
  totals: { shipped: number; unfinished: number; escalated: number };
}

export interface AgentActivity {
  live: LiveAgentRow[];
  runs: AgentRunGroup[];
  inbox: InboxRow[];
}

export interface AgentActivityDeps {
  /** Liveness probe; default = signal-0. Injectable so tests exercise dead pids. */
  isPidAlive?: (pid: number) => boolean;
  /** Clock (epoch ms); injectable for runtime/staleness tests. */
  nowMs?: () => number;
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Line-tolerant JSONL read (same posture as the metrics facts reader): corrupt lines skipped. */
async function readJsonlRows<T>(path: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const rows: T[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      // skip corrupt line — the writer is fail-open, the reader is line-tolerant
    }
  }
  return rows;
}

/**
 * Derive the `/agents` payload from `.noldor/agent-events.jsonl` (+ drain-state
 * retries + the escalation inbox via {@link readInboxRows}, reused verbatim —
 * no logic duplication). Back-compat by contract: `event` absent ⇒ 'exited',
 * `runId` absent ⇒ the {@link NO_RUN_ID} bucket at the bottom of the timeline.
 */
export async function loadAgentActivity(
  cwd: string = getDocRoot(),
  deps: AgentActivityDeps = {},
): Promise<AgentActivity> {
  const isPidAlive = deps.isPidAlive ?? defaultPidAlive;
  const nowMs = deps.nowMs ?? Date.now;
  const events = await readJsonlRows<AgentEvent>(join(cwd, '.noldor', 'agent-events.jsonl'));
  const escalations = await readJsonlRows<{ runId?: string; resolved?: boolean }>(
    join(cwd, '.noldor', 'escalations.jsonl'),
  );
  let retries: Record<string, number> = {};
  try {
    const state = JSON.parse(
      await readFile(join(cwd, '.noldor', 'drain-state.json'), 'utf8'),
    ) as DrainState;
    retries = state.retries ?? {};
  } catch {
    retries = {};
  }

  const eventOf = (e: AgentEvent): 'spawned' | 'exited' | 'phase' => e.event ?? 'exited';

  const exitedSpawnIds = new Set(
    events
      .filter((e) => eventOf(e) === 'exited' && e.spawnId !== undefined)
      .map((e) => e.spawnId),
  );
  const latestPhase = new Map<string, string>();
  for (const e of events) {
    if (eventOf(e) === 'phase' && e.slug !== undefined && e.phase !== undefined) {
      latestPhase.set(e.slug, e.phase);
    }
  }

  const live: LiveAgentRow[] = [];
  for (const e of events) {
    if (eventOf(e) !== 'spawned' || e.spawnId === undefined || e.pid === undefined) continue;
    if (exitedSpawnIds.has(e.spawnId)) continue; // paired — completed
    if (!isPidAlive(e.pid)) continue; // dead process — not live
    const runtimeMs = Math.max(0, nowMs() - Date.parse(e.ts));
    live.push({
      spawnId: e.spawnId,
      runId: e.runId ?? null,
      kind: e.role,
      slug: e.slug ?? null,
      lane: e.site ?? null,
      phase: (e.slug !== undefined ? latestPhase.get(e.slug) : undefined) ?? null,
      pid: e.pid,
      startedTs: e.ts,
      runtimeMs,
      retries: (e.slug !== undefined ? retries[e.slug] : undefined) ?? 0,
      stale: runtimeMs > LIVE_STALE_CEILING_MS,
    });
  }

  const spawnedById = new Map<string, AgentEvent>();
  for (const e of events) {
    if (eventOf(e) === 'spawned' && e.spawnId !== undefined) spawnedById.set(e.spawnId, e);
  }
  const groups = new Map<string, AgentEvent[]>();
  for (const e of events) {
    const key = e.runId ?? NO_RUN_ID;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  const runs: AgentRunGroup[] = [...groups.entries()].map(([runId, rows]) => {
    const bars: AgentRunBar[] = rows
      .filter((e) => eventOf(e) === 'exited')
      .map((e) => {
        const spawned = e.spawnId !== undefined ? spawnedById.get(e.spawnId) : undefined;
        const durationMs = e.durationMs ?? 0;
        const startMs =
          spawned !== undefined ? Date.parse(spawned.ts) : Date.parse(e.ts) - durationMs;
        return {
          kind: e.kind ?? e.role,
          slug: e.slug ?? null,
          lane: e.site ?? null,
          startMs: Number.isNaN(startMs) ? null : startMs,
          durationMs,
          outcome:
            e.kind === 'salvaged'
              ? ('salvaged' as const)
              : e.timedOut === true
                ? ('timeout' as const)
                : (e.exitCode ?? 0) === 0
                  ? ('ok' as const)
                  : ('failed' as const),
        };
      });
    const finalPhase = new Map<string, string>();
    for (const e of rows) {
      if (eventOf(e) === 'phase' && e.slug !== undefined && e.phase !== undefined) {
        finalPhase.set(e.slug, e.phase);
      }
    }
    let shipped = 0;
    let unfinished = 0;
    for (const phase of finalPhase.values()) {
      if (phase === 'merged') shipped += 1;
      else unfinished += 1;
    }
    const escalated = escalations.filter(
      (r) => r.resolved === undefined && (r.runId ?? NO_RUN_ID) === runId,
    ).length;
    const tss = rows.map((r) => r.ts).toSorted();
    return {
      runId,
      startTs: tss[0] ?? '',
      endTs: tss[tss.length - 1] ?? '',
      bars,
      totals: { shipped, unfinished, escalated },
    };
  });
  // Newest first; the legacy bucket always sinks to the bottom (spec D6).
  runs.sort((a, b) => {
    if (a.runId === NO_RUN_ID) return 1;
    if (b.runId === NO_RUN_ID) return -1;
    return b.startTs.localeCompare(a.startTs);
  });

  return { live, runs, inbox: readInboxRows(cwd) };
}

/**
 * Last `maxLines` lines of the SHARED watch log (`.noldor/watch.log`,
 * {@link WATCH_LOG_REL}) — agents run `stdio: 'inherit'`, so there is no
 * per-agent file (spec D3); rows interleave at K>1 and the UI labels it as
 * shared. Absent file → null (route renders a friendly empty state).
 */
export async function loadWatchLogTail(
  cwd: string = getDocRoot(),
  maxLines = 200,
): Promise<string | null> {
  try {
    const raw = await readFile(join(cwd, WATCH_LOG_REL), 'utf8');
    const lines = raw.split('\n');
    return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Register `GET /api/agents`**

In `src/dashboard/server.ts`:

(a) Add `loadAgentActivity,` to the `./data.js` import list (alphabetically, after `loadActiveMilestone`).

(b) In `matchRoute`, after the `/worktrees` line:

```ts
    if (pathname === '/worktrees') return { handler: handleWorktrees, pathParams: {} };
```

add (GET section — the `/api/roadmap/*` block below is POST-only, this API is read-only JSON):

```ts
    if (pathname === '/api/agents') return { handler: handleApiAgents, pathParams: {} };
```

(c) Add the handler after `handleWorktrees`:

```ts
/** Read-only JSON for the /agents poller — no CSRF/atomic concerns (mutations only). */
async function handleApiAgents(): Promise<RouteResult> {
  return jsonResult(200, await loadAgentActivity());
}
```

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/dashboard/__tests__/dashboard-agents.test.ts
```

Expected output: `Test Files  1 passed (1)` — 8 tests green (5 loader, 2 log-tail, 1 API).

- [ ] **Step 6: Format, lint, typecheck**

```bash
pnpm fmt && pnpm lint && pnpm typecheck
```

Expected output: all clean, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/data.ts src/dashboard/server.ts src/dashboard/__tests__/dashboard-agents.test.ts
git commit -m "feat(dashboard): loadAgentActivity loader + GET /api/agents endpoint" -m "Noldor-FD: agent-events-phase-tracking-run-ids-and-agents-dashboard-page"
```

---

## Task 5: `/agents` page — views, nav, poller module, `/agents/log`

**Files:**

- Create: `src/dashboard/static/agents.ts` (compiled to `src/dashboard/static/dist/agents.js`)
- Modify: `src/dashboard/views.ts`, `src/dashboard/layout.ts`, `src/dashboard/server.ts`, `src/dashboard/static/tsconfig.json`
- Test: `src/dashboard/__tests__/dashboard-agents.test.ts`

- [ ] **Step 1: Write the failing render + route tests**

Append to `src/dashboard/__tests__/dashboard-agents.test.ts`:

(a) Extend the imports — add to the `../data.js` import: `type AgentActivity`; add a new import line after it:

```ts
import { renderAgents, renderAgentsLog } from '../views.js';
import { formatRuntime } from '../static/agents.js';
```

(b) Append at the end of the file:

```ts
const sampleActivity: AgentActivity = {
  live: [
    {
      spawnId: 'live-1',
      runId: 'r-1',
      kind: 'implementer',
      slug: 'feat-a',
      lane: 'drain.spawnGate',
      phase: 'building',
      pid: 111,
      startedTs: T0,
      runtimeMs: 272_000,
      retries: 1,
      stale: false,
    },
  ],
  runs: [
    {
      runId: 'r-1',
      startTs: T0,
      endTs: '2026-07-03T10:10:00.000Z',
      bars: [
        {
          kind: 'implementer',
          slug: 'feat-b',
          lane: 'drain.spawnGate',
          startMs: Date.parse(T0),
          durationMs: 300_000,
          outcome: 'ok',
        },
        {
          kind: 'reviewer',
          slug: null,
          lane: 'cr.subagent-dispatch',
          startMs: Date.parse(T0) + 60_000,
          durationMs: 120_000,
          outcome: 'failed',
        },
      ],
      totals: { shipped: 1, unfinished: 0, escalated: 2 },
    },
  ],
  inbox: [
    {
      slug: 'feat-c',
      source: 'roadmap',
      reason: 'retries-exhausted',
      ts: T0,
      evidence: 'skip reason: retries-exhausted',
      suggestedAction: 'inspect sinks, then unpark',
    },
  ],
};

describe('renderAgents', () => {
  it('renders the three sections with poller anchor ids', () => {
    const html = renderAgents(sampleActivity);
    expect(html).toContain('<h1>Agents</h1>');
    expect(html).toContain('Live board');
    expect(html).toContain('Run timeline');
    expect(html).toContain('Escalation inbox');
    expect(html).toContain('id="agents-live-body"');
    expect(html).toContain('id="agents-inbox-body"');
    expect(html).toContain('id="agents-live-count"');
    expect(html).toContain('id="agents-inbox-count"');
  });

  it('renders live rows with slug link, lane, phase, runtime, retries and a log link', () => {
    const html = renderAgents(sampleActivity);
    expect(html).toContain('href="/features/feat-a"');
    expect(html).toContain('drain.spawnGate');
    expect(html).toContain('building');
    expect(html).toContain('4m 32s');
    expect(html).toContain('href="/agents/log"');
  });

  it('renders timeline bars with outcome classes and a totals line', () => {
    const html = renderAgents(sampleActivity);
    expect(html).toContain('agents-bar--ok');
    expect(html).toContain('agents-bar--failed');
    expect(html).toContain('<code>r-1</code>');
    expect(html).toContain('1 shipped · 0 unfinished · 2 escalated');
  });

  it('renders inbox rows mirroring the CLI columns', () => {
    const html = renderAgents(sampleActivity);
    expect(html).toContain('roadmap');
    expect(html).toContain('feat-c');
    expect(html).toContain('retries-exhausted');
    expect(html).toContain('inspect sinks, then unpark');
  });

  it('renders empty states for no live agents, no runs, and an empty inbox', () => {
    const html = renderAgents({ live: [], runs: [], inbox: [] });
    expect(html).toContain('no agents running');
    expect(html).toContain('no recorded runs');
    expect(html).toContain('inbox empty');
  });

  it('escapes HTML in event-sourced strings', () => {
    const evil: AgentActivity = {
      live: [
        {
          ...sampleActivity.live[0]!,
          slug: null,
          lane: '<script>alert(1)</script>',
          phase: null,
        },
      ],
      runs: [],
      inbox: [],
    };
    const html = renderAgents(evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderAgentsLog', () => {
  it('renders the friendly empty state when the log is absent', () => {
    const html = renderAgentsLog(null);
    expect(html).toContain('no watch log — drain running attached?');
    expect(html).not.toContain('<pre>');
  });

  it('renders the tail inside a pre, escaped', () => {
    const html = renderAgentsLog('cycle done <ok>');
    expect(html).toContain('<pre>');
    expect(html).toContain('cycle done &lt;ok&gt;');
    expect(html).toContain('shared');
  });
});

describe('formatRuntime (poller module, DOM-guarded import)', () => {
  it('formats seconds, minutes, and hours', () => {
    expect(formatRuntime(12_000)).toBe('12s');
    expect(formatRuntime(272_000)).toBe('4m 32s');
    expect(formatRuntime(3_840_000)).toBe('1h 04m');
  });
});

describe('GET /agents + /agents/log', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves the page with the Agents nav marked current', async () => {
    const res = await fetch(`${baseUrl}/agents`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<h1>Agents</h1>');
    expect(body).toMatch(/<a href="\/agents" aria-current="page">/);
    expect(body).toContain('/static/agents.js');
  });

  it('serves the log tail page', async () => {
    const res = await fetch(`${baseUrl}/agents/log`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Watch log');
  });

  it('GET /static/agents.js returns the compiled poller', async () => {
    const res = await fetch(`${baseUrl}/static/agents.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/javascript');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/dashboard/__tests__/dashboard-agents.test.ts
```

Expected output: `Test Files  1 failed (1)` — `views.js` has no export named `renderAgents` (import error fails the file; Task 4's tests were green before this edit).

- [ ] **Step 3: Implement `renderAgents` + `renderAgentsLog` in `views.ts`**

In `src/dashboard/views.ts`:

(a) Add `AgentActivity, AgentRunGroup, LiveAgentRow,` to the `import type { … } from './data.js';` list (alphabetical — before `DashboardCounts`).

(b) Append after `renderWorktrees` (before `renderWipAge`):

```ts
/** Human-compact duration for agent runtimes: "12s", "4m 32s", "1h 04m". */
export function formatAgentDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

const LIVE_EMPTY_ROW = '<tr><td colspan="7" class="empty">no agents running</td></tr>';
const INBOX_EMPTY_ROW = '<tr><td colspan="5" class="empty">inbox empty — nothing needs you</td></tr>';

function renderLiveRows(live: LiveAgentRow[]): string {
  if (live.length === 0) return LIVE_EMPTY_ROW;
  return live
    .map((r) => {
      const slugCell =
        r.slug === null
          ? '—'
          : `<a href="/features/${escapeHtml(r.slug)}">${escapeHtml(r.slug)}</a>`;
      const staleBadge = r.stale ? ' <span class="badge stale">stale</span>' : '';
      return `<tr${r.stale ? ' class="row-stale"' : ''}>
        <td>${escapeHtml(r.kind)}</td>
        <td>${slugCell}</td>
        <td>${r.lane === null ? '—' : `<code>${escapeHtml(r.lane)}</code>`}</td>
        <td>${r.phase === null ? '—' : escapeHtml(r.phase)}</td>
        <td>${escapeHtml(formatAgentDuration(r.runtimeMs))}${staleBadge}</td>
        <td>${r.retries}</td>
        <td><a href="/agents/log">log</a></td>
      </tr>`;
    })
    .join('');
}

function renderRunGroup(g: AgentRunGroup): string {
  const starts = g.bars.map((b) => b.startMs).filter((v): v is number => v !== null);
  const fallbackStart = Date.parse(g.startTs);
  const runStart = starts.length > 0 ? Math.min(...starts) : fallbackStart;
  const runEnd = Math.max(
    runStart + 1,
    ...g.bars.map((b) => (b.startMs ?? runStart) + b.durationMs),
  );
  const span = runEnd - runStart;
  const rows = g.bars
    .map((b) => {
      const left = (((b.startMs ?? runStart) - runStart) / span) * 100;
      const width = Math.min(100, Math.max(2, (b.durationMs / span) * 100));
      const label = [b.kind, b.slug, b.lane].filter((v): v is string => v !== null).join(' · ');
      return `<tr>
        <td>${escapeHtml(label)}</td>
        <td style="width:55%"><div class="agents-bar-track"><div class="agents-bar agents-bar--${b.outcome}" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%" title="${escapeHtml(formatAgentDuration(b.durationMs))}"></div></div></td>
        <td>${escapeHtml(formatAgentDuration(b.durationMs))}</td>
        <td><span class="badge outcome-${b.outcome}">${b.outcome}</span></td>
      </tr>`;
    })
    .join('');
  const totals = `${g.totals.shipped} shipped · ${g.totals.unfinished} unfinished · ${g.totals.escalated} escalated`;
  const barsTable =
    g.bars.length === 0
      ? '<p class="empty">no completed spawns in this run</p>'
      : `<table><thead><tr><th>Agent</th><th>Timeline</th><th>Duration</th><th>Outcome</th></tr></thead><tbody>${rows}</tbody></table>`;
  return `<div class="milestone-group">
    <div class="status">${escapeHtml(g.startTs)}${g.endTs !== g.startTs ? ` → ${escapeHtml(g.endTs)}` : ''}</div>
    <h3><code>${escapeHtml(g.runId)}</code></h3>
    <p class="muted">${escapeHtml(totals)}</p>
    ${barsTable}
  </div>`;
}

function renderInboxRows(inbox: AgentActivity['inbox']): string {
  if (inbox.length === 0) return INBOX_EMPTY_ROW;
  return inbox
    .map(
      (r) => `<tr>
      <td><code>${escapeHtml(r.source)}:${escapeHtml(r.slug)}</code></td>
      <td>${escapeHtml(r.reason)}</td>
      <td><time>${escapeHtml(r.ts)}</time></td>
      <td>${escapeHtml(r.evidence || '(none)')}</td>
      <td>${escapeHtml(r.suggestedAction)}</td>
    </tr>`,
    )
    .join('');
}

/**
 * Render the /agents page: live board (running agents), per-run timeline
 * (spawned→exited bars, outcome-colored), and the escalation inbox (same rows
 * as `noldor autonomous inbox`). The static poller (`/static/agents.js`)
 * patches `#agents-live-body`, `#agents-inbox-body` and both counters in
 * place every ~2s; first paint is fully server-side (no-JS safe).
 */
export function renderAgents(activity: AgentActivity): string {
  const counterStrip = `<div class="counter-strip">
    <div class="counter"><div class="v" id="agents-live-count">${activity.live.length}</div><div class="l">running</div></div>
    <div class="counter"><div class="v">${activity.runs.length}</div><div class="l">runs</div></div>
    <div class="counter"><div class="v" id="agents-inbox-count">${activity.inbox.length}</div><div class="l">open escalations</div></div>
  </div>`;
  const liveTable = `<table>
    <thead><tr><th>Kind</th><th>Slug</th><th>Lane</th><th>Phase</th><th>Runtime</th><th>Retries</th><th>Log</th></tr></thead>
    <tbody id="agents-live-body">${renderLiveRows(activity.live)}</tbody>
  </table>`;
  const timeline =
    activity.runs.length === 0
      ? '<p class="empty">no recorded runs</p>'
      : activity.runs.map(renderRunGroup).join('');
  const inboxTable = `<table>
    <thead><tr><th>Entry</th><th>Reason</th><th>Since</th><th>Evidence</th><th>Suggested action</th></tr></thead>
    <tbody id="agents-inbox-body">${renderInboxRows(activity.inbox)}</tbody>
  </table>`;
  return `<h1>Agents</h1>
  ${counterStrip}
  <h2>Live board</h2>
  <p class="muted">Self-refreshes every ~2s via <code>/api/agents</code>. Log links tail the shared <code>.noldor/watch.log</code>.</p>
  ${liveTable}
  <h2>Run timeline</h2>
  ${timeline}
  <h2>Escalation inbox</h2>
  ${inboxTable}`;
}

/**
 * Render the /agents/log tail. The log is SHARED across agents (children run
 * stdio-inherit — spec D3): rows interleave at K>1, labelled as such.
 */
export function renderAgentsLog(tail: string | null): string {
  const back = `<p><a href="/agents">← back to agents</a> · <code>.noldor/watch.log</code> <span class="muted">(shared across agents — rows interleave at K&gt;1)</span></p>`;
  if (tail === null) {
    return `<h1>Watch log</h1>${back}<p class="empty">no watch log — drain running attached?</p>`;
  }
  return `<h1>Watch log</h1>${back}<pre>${escapeHtml(tail)}</pre>`;
}
```

- [ ] **Step 4: Nav entry, timeline CSS, and script tag in `layout.ts`**

In `src/dashboard/layout.ts`:

(a) In `NAV_LINKS`, replace:

```ts
  { href: '/worktrees', label: 'Worktrees' },
```

with:

```ts
  { href: '/worktrees', label: 'Worktrees' },
  { href: '/agents', label: 'Agents' },
```

(b) In the `STYLE` template literal, insert before the final `` ` `` (after the closing `}` of the last `@media (prefers-color-scheme: dark)` hljs block):

```
  /* --- /agents page: run-timeline bars + outcome badges --- */
  .agents-bar-track { position: relative; background: var(--line); border-radius: 3px; height: 10px; min-width: 8rem; }
  .agents-bar { position: absolute; top: 0; height: 100%; border-radius: 3px; }
  .agents-bar--ok { background: #16a34a; }
  .agents-bar--failed { background: #dc2626; }
  .agents-bar--timeout { background: #d97706; }
  .agents-bar--salvaged { background: #7c3aed; }
  .badge.outcome-ok { background: rgba(22,163,74,0.15); color: #15803d; }
  .badge.outcome-failed { background: rgba(220,38,38,0.18); color: #b91c1c; }
  .badge.outcome-timeout { background: rgba(217,119,6,0.18); color: #b45309; }
  .badge.outcome-salvaged { background: rgba(124,58,237,0.18); color: #6d28d9; }
  @media (prefers-color-scheme: dark) {
    .badge.outcome-ok { color: #4ade80; }
    .badge.outcome-failed { color: #f87171; }
    .badge.outcome-timeout { color: #fbbf24; }
    .badge.outcome-salvaged { color: #c4b5fd; }
  }
```

(c) In `renderLayout`, replace:

```ts
<script src="/static/drag.js" type="module"></script></body></html>`;
```

with:

```ts
<script src="/static/drag.js" type="module"></script><script src="/static/agents.js" type="module"></script></body></html>`;
```

- [ ] **Step 5: Add the `/agents` and `/agents/log` routes**

In `src/dashboard/server.ts`:

(a) Add `loadWatchLogTail,` to the `./data.js` import list and `renderAgents, renderAgentsLog,` to the `./views.js` import list (alphabetical order).

(b) In `matchRoute`, after the `/api/agents` line added in Task 4, add:

```ts
    if (pathname === '/agents') return { handler: handleAgents, pathParams: {} };
    if (pathname === '/agents/log') return { handler: handleAgentsLog, pathParams: {} };
```

(c) After `handleApiAgents`, add:

```ts
async function handleAgents(): Promise<RouteResult> {
  const activity = await loadAgentActivity();
  return {
    status: 200,
    body: renderAgents(activity),
    title: 'Agents',
    activeNav: '/agents',
  };
}

async function handleAgentsLog(): Promise<RouteResult> {
  const tail = await loadWatchLogTail();
  return {
    status: 200,
    body: renderAgentsLog(tail),
    title: 'Watch log',
    activeNav: '/agents',
  };
}
```

- [ ] **Step 6: Write the poller module**

Create `src/dashboard/static/agents.ts` with exactly:

```ts
// Vanilla TS /agents poller — compiled to dist/agents.js and served by
// /static/<file>. Fetches /api/agents every ~2s and patches the live board
// and escalation inbox in place (spec D4: client fetch, not meta refresh —
// a full reload would reset scroll every 2s). First paint is server-side;
// this module no-ops on every other page.

interface LiveRowPayload {
  kind: string;
  slug: string | null;
  lane: string | null;
  phase: string | null;
  runtimeMs: number;
  retries: number;
  stale: boolean;
}

interface InboxRowPayload {
  slug: string;
  source: string;
  reason: string;
  ts: string;
  evidence: string;
  suggestedAction: string;
}

interface AgentsPayload {
  live: LiveRowPayload[];
  inbox: InboxRowPayload[];
}

/** Mirror of the server-side formatAgentDuration — exported for unit tests. */
export function formatRuntime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

function emptyRow(body: HTMLTableSectionElement, colSpan: number, text: string): void {
  const tr = body.insertRow();
  const c = tr.insertCell();
  c.colSpan = colSpan;
  c.className = 'empty';
  c.textContent = text;
}

function renderLive(body: HTMLTableSectionElement, rows: LiveRowPayload[]): void {
  body.textContent = '';
  if (rows.length === 0) {
    emptyRow(body, 7, 'no agents running');
    return;
  }
  for (const r of rows) {
    const tr = body.insertRow();
    if (r.stale) tr.className = 'row-stale';
    tr.insertCell().textContent = r.kind;
    const slugCell = tr.insertCell();
    if (r.slug === null) {
      slugCell.textContent = '—';
    } else {
      const a = document.createElement('a');
      a.href = `/features/${encodeURIComponent(r.slug)}`;
      a.textContent = r.slug;
      slugCell.appendChild(a);
    }
    const laneCell = tr.insertCell();
    if (r.lane === null) {
      laneCell.textContent = '—';
    } else {
      const code = document.createElement('code');
      code.textContent = r.lane;
      laneCell.appendChild(code);
    }
    tr.insertCell().textContent = r.phase ?? '—';
    tr.insertCell().textContent = formatRuntime(r.runtimeMs) + (r.stale ? ' (stale)' : '');
    tr.insertCell().textContent = String(r.retries);
    const logCell = tr.insertCell();
    const log = document.createElement('a');
    log.href = '/agents/log';
    log.textContent = 'log';
    logCell.appendChild(log);
  }
}

function renderInbox(body: HTMLTableSectionElement, rows: InboxRowPayload[]): void {
  body.textContent = '';
  if (rows.length === 0) {
    emptyRow(body, 5, 'inbox empty — nothing needs you');
    return;
  }
  for (const r of rows) {
    const tr = body.insertRow();
    const key = tr.insertCell();
    const code = document.createElement('code');
    code.textContent = `${r.source}:${r.slug}`;
    key.appendChild(code);
    tr.insertCell().textContent = r.reason;
    tr.insertCell().textContent = r.ts;
    tr.insertCell().textContent = r.evidence || '(none)';
    tr.insertCell().textContent = r.suggestedAction;
  }
}

function setCount(id: string, n: number): void {
  const el = document.getElementById(id);
  if (el !== null) el.textContent = String(n);
}

async function poll(): Promise<void> {
  const liveBody = document.getElementById('agents-live-body');
  const inboxBody = document.getElementById('agents-inbox-body');
  if (!(liveBody instanceof HTMLTableSectionElement)) return;
  try {
    const res = await fetch('/api/agents');
    if (!res.ok) return; // transient server hiccup — keep the last-good DOM
    const data = (await res.json()) as AgentsPayload;
    renderLive(liveBody, data.live);
    setCount('agents-live-count', data.live.length);
    if (inboxBody instanceof HTMLTableSectionElement) {
      renderInbox(inboxBody, data.inbox);
      setCount('agents-inbox-count', data.inbox.length);
    }
  } catch {
    // network error — leave the last-good DOM, the next tick retries
  }
}

function init(): void {
  if (document.getElementById('agents-live-body') === null) return; // not the /agents page
  setInterval(() => {
    void poll();
  }, 2000);
}

// Guard the auto-init so this module can be imported from non-DOM contexts
// (vitest unit-tests formatRuntime). The compiled dist/agents.js runs in the
// browser where `document` is always defined. Same pattern as drag.ts.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
```

- [ ] **Step 7: Compile the poller to `static/dist`**

In `src/dashboard/static/tsconfig.json`, replace:

```json
  "include": ["drag.ts"]
```

with:

```json
  "include": ["drag.ts", "agents.ts"]
```

Then compile and format the dist output (the PR #88 gotcha — `dist/` needs an explicit fmt pass or `fmt:check` fails later):

```bash
pnpm exec tsc -p src/dashboard/static/tsconfig.json
pnpm fmt
git status --short src/dashboard/static/dist/
```

Expected output: tsc exits 0; `?? src/dashboard/static/dist/agents.js` appears (plus possibly `M …/dist/drag.js` if the compiler re-emits it — both are generated artifacts that ship in the package; commit whatever appears).

- [ ] **Step 8: Run to verify PASS**

```bash
pnpm vitest run src/dashboard/__tests__/dashboard-agents.test.ts src/dashboard/__tests__/dashboard-layout-style-polish.test.ts src/dashboard/__tests__/dashboard-server.test.ts
```

Expected output: `Test Files  3 passed (3)` — all renderAgents/renderAgentsLog/formatRuntime/route tests green; the existing layout (drag.js script-tag pin) and server suites unaffected.

- [ ] **Step 9: Format, lint, typecheck**

```bash
pnpm fmt && pnpm lint && pnpm typecheck
```

Expected output: all clean, exit 0 (root tsconfig also typechecks `static/agents.ts` — DOM lib is enabled).

- [ ] **Step 10: Commit**

```bash
git add src/dashboard/views.ts src/dashboard/layout.ts src/dashboard/server.ts src/dashboard/static/agents.ts src/dashboard/static/tsconfig.json src/dashboard/static/dist/ src/dashboard/__tests__/dashboard-agents.test.ts
git commit -m "feat(dashboard): /agents page — live board, run timeline, inbox panel, 2s poller, log tail" -m "Noldor-FD: agent-events-phase-tracking-run-ids-and-agents-dashboard-page"
```

---

## Task 6: FD links, full verify, acceptance mapping

**Files:**

- Modify: `docs/features/agent-events-phase-tracking-run-ids-and-agents-dashboard-page.md`

- [ ] **Step 1: Fill the FD links**

In `docs/features/agent-events-phase-tracking-run-ids-and-agents-dashboard-page.md`, replace the frontmatter `links:` block:

```yaml
links:
  code: []
  docs: []
  tests: []
  spec: >-
    docs/design/specs/2026-07-03-agent-events-phase-tracking-run-ids-and-agents-dashboard-page-design.md
```

with:

```yaml
links:
  code:
    - src/core/agent-events.ts
    - src/core/agent-runner/registry.ts
    - src/core/agent-runner/types.ts
    - src/autonomous/phase-events.ts
    - src/autonomous/queue-drain.ts
    - src/autonomous/watch.ts
    - src/autonomous/drain-io.ts
    - src/autonomous/drain-loop.ts
    - src/autonomous/escalations.ts
    - src/autonomous/salvage.ts
    - src/metrics/collect/drain-reliability.ts
    - src/dashboard/data.ts
    - src/dashboard/server.ts
    - src/dashboard/views.ts
    - src/dashboard/layout.ts
    - src/dashboard/static/agents.ts
  docs: []
  tests:
    - src/core/agent-runner/__tests__/registry.test.ts
    - src/core/__tests__/agent-events.test.ts
    - src/autonomous/__tests__/phase-events.test.ts
    - src/autonomous/__tests__/escalations.test.ts
    - src/autonomous/__tests__/run-drain.test.ts
    - src/metrics/__tests__/drain-and-tokens.test.ts
    - src/dashboard/__tests__/dashboard-agents.test.ts
  spec: >-
    docs/design/specs/2026-07-03-agent-events-phase-tracking-run-ids-and-agents-dashboard-page-design.md
```

- [ ] **Step 2: Full verification**

```bash
pnpm verify
```

Expected output: `oxlint` clean (`--deny-warnings`), `oxfmt --check` clean (including `static/dist/`), `tsc --noEmit` exit 0, `vitest run` all test files passed — including the two new suites and the five extended ones.

- [ ] **Step 3: Acceptance-criteria spot-check (mapping, no code)**

Confirm each spec acceptance criterion is covered; if any line does not hold, fix before committing:

1. Live board + one-runId grouping under `--concurrency 2` — automated analogue: `dashboard-agents.test.ts` live-board + newest-first grouping tests; full-drain manual check documented in the FD Usage (operator, post-merge: `noldor autonomous run --concurrency 2 --max-features 2` then open `/agents`).
2. `spawned`+`exited` pair with shared `spawnId`/`runId` for every agent incl. CR lanes — `registry.test.ts` pairing tests + ambient `process.env` fallback test (the CR-lane transport IS the ambient fallback; the lane call sites were verified unchanged: `src/cr/lanes/verify-dispatch.ts`, `src/cr/lanes/subagent-dispatch.ts`).
3. `phase` rows building → awaiting-merge → merging → merged with runId — `phase-events.test.ts` sequence test + tap row-shape test.
4. Escalation rows carry `runId`; `noldor autonomous inbox` output unchanged — `escalations.test.ts` runId tests; `readInboxRows`/`inbox-cli` untouched by the diff (`git diff main --stat -- src/autonomous/inbox-cli.ts` is empty); same rows render via the `/agents` inbox panel test.
5. Metrics blind spot gone, mean unchanged by non-exited rows — `drain-and-tokens.test.ts` filter + blind-spot tests.
6. Pre-existing rows parse; "(no run id)" bucket — loader back-compat test (`event`-absent row becomes an exited bar in the `NO_RUN_ID` bucket, listed last).
7. Fail-open writes — `phase-events.test.ts` unwritable-dir test + untouched `appendAgentEvent` contract test in `agent-events.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add docs/features/agent-events-phase-tracking-run-ids-and-agents-dashboard-page.md
git commit -m "docs(features): fill agent-events /agents FD code+test links" -m "Noldor-FD: agent-events-phase-tracking-run-ids-and-agents-dashboard-page"
```
