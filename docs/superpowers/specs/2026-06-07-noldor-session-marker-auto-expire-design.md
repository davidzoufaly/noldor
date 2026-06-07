# Session Marker Auto-Expire — Design

- **FD:** noldor (attach; enhancement `session-marker-auto-expire`)
- **Date:** 2026-06-07
- **Area:** tooling
- **Tier:** specs-only

## Problem

`.noldor/session.json` persists indefinitely between gate flows. A `micro-chore`
session created one day lingered into the next day's code-editing work and
**silently** blocked at the pre-commit allowlist check — recovery required either
a manual session rewrite or a fresh `/gate` invocation. The failure mode is
opaque: the operator sees an allowlist rejection for files they expect to be
allowed, with no hint that a stale session from a prior intent is the cause.

Two root causes:

1. **No expiry semantics.** `startedAt` already lands in the marker
   (`src/core/session.ts`) but nothing reads it. A session of any age enforces
   its path's rules with equal authority.
2. **Micro-chore sessions never get cleared.** Worktree-backed paths
   (`fast-track`, `specs-only-*`, `full-*`) clear their session for free —
   `ExitWorktree` removes the worktree directory and its `.noldor/session.json`
   with it. `micro-chore` has no worktree; its marker lives in the main repo and
   the Step 4 end-of-flow cleanup (`git branch -D` + rebase) never removes it.

## Goals

- A stale short-lived session stops **silently** enforcing a cold intent and
  instead surfaces a clear, actionable message: re-run `/gate`.
- A shipped micro-chore session clears itself, so it cannot linger into the next
  day at all.
- No regression for legitimate multi-day feature work.

## Non-Goals

- Expiry for paths **without an allowlist branch** in `noldor-pre-commit.ts`
  (`fast-track`, `specs-only-*`, `full-*`, `release-automation`). The silent
  failure this feature fixes is specific to the allowlist branches: a stale
  session there *enforces a cold allowlist* and rejects a commit opaquely. Paths
  with no allowlist branch fall through to `return { ok: true }` (or the
  post-rollout hard-wall, which already names "Run /gate") — a lingering session
  there never silently blocks, so it has nothing to expire. Adding them would be
  scope creep with no failure mode behind it. (`fast-track` / `specs-only-*` /
  `full-*` are additionally worktree-backed and self-clear via `ExitWorktree`;
  `release-automation` has no allowlist enforcement at all.)
- A git `post-commit` hook for the auto-clear. The micro-chore PR flow
  (`pr-flow-cli`) reads the session **after** the commit; clearing at
  post-commit time would break it.

## Design

### Part 1 — Staleness expiry (primary)

Staleness applies to exactly the paths that **own an allowlist branch** in
`noldor-pre-commit.ts`: `micro-chore` and `release-sweep`. These are the only
paths where a stale session causes the reported failure — they enforce a
per-path allowlist on the staged diff, so a session that has outlived its intent
silently rejects a commit. Both also live in the main repo with no worktree to
clear them, so they linger across days. Every other path (`fast-track`,
`specs-only-*`, `full-*`, `release-automation`) has no allowlist branch and
returns `ok:true` (or hits the existing post-rollout hard-wall, which already
names `/gate`) — there is no silent-block to expire (see Non-Goals).

**`src/core/session.ts`**

- `const STALE_ELIGIBLE_PATHS: ReadonlySet<Path> = new Set(['micro-chore', 'release-sweep'])`
- `export function isSessionStale(session: SessionMarker, nowMs: number, ttlHours: number): boolean`
  - Returns `false` immediately when `session.path ∉ STALE_ELIGIBLE_PATHS`.
  - Parses `startedAt` via `Date.parse`. If `NaN` (unparseable) → returns
    `false` — never block a commit on a garbage timestamp.
  - Returns `nowMs - parsedMs > ttlHours * 3_600_000`. Strict `>`: a session
    exactly at the boundary is still fresh.

Pure function — no clock, no filesystem, **no cr import**. The caller injects
`nowMs` and `ttlHours`, keeping it fully unit-testable. The default-hours
constant lives in `cr/config.ts` (below), not here, so `session.ts` keeps its
existing `node:fs` / `node:path` / `zod`-only footprint and there is no
`core → cr` edge.

**`src/cr/config.ts`** (the canonical `.noldor/config.json` schema — already home
to the non-cr `autonomous` block)

- `export const DEFAULT_SESSION_TTL_HOURS = 24`
- Extend `noldorConfigSchema` with an optional block:
  `gate: z.object({ sessionTtlHours: z.number().positive() }).optional()`
- `export function resolveSessionTtlHours(config: NoldorConfig | null): number`
  — returns `config?.gate?.sessionTtlHours ?? DEFAULT_SESSION_TTL_HOURS`.
- `export function loadConfigSync(path?: string): NoldorConfig | null` — a
  synchronous sibling of the async `loadConfig`. Reads with `readFileSync`,
  returns `null` on `ENOENT`, parses against `noldorConfigSchema` (mirrors
  `loadConfig` exactly, including rethrowing a malformed-config parse error).
  This module-level strictness is preserved; **fail-open is applied at the hook
  call site**, not here, so non-hook callers still get strict validation.

**`src/hooks/noldor-pre-commit.ts`**

- `runPreCommit` opts gain **required** `nowMs: number` and `ttlHours: number`.
  Required — not optional-with-defaults — so there is a **single source of
  truth**: defaults are applied once at the entrypoint boundary, and the
  function itself stays pure (no `Date.now()`, no `DEFAULT_SESSION_TTL_HOURS`
  fallback hiding a missed wiring).
  - **Test-call-site churn (required, not optional):** all 15 existing
    `runPreCommit({ cwd })` calls in `noldor-pre-commit.test.ts` must add
    `nowMs` + `ttlHours`. This is deliberate, not avoidable by defaulting: the
    three `release-sweep` fixtures (lines ~100/114/193) use
    `startedAt: '2026-05-17T08:00:00.000Z'`, which is >24h before any real
    `Date.now()` — a `Date.now()` default would make them read **stale** and
    flip their expected `ok:true` / allowlist-reason assertions to the stale
    reason, silently breaking the suite. Each existing call injects a fixed
    `nowMs` within `ttlHours` of its fixture's `startedAt` (e.g.
    `Date.parse('2026-05-17T09:00:00.000Z')` for the release-sweep cases) and a
    `ttlHours` of 24, preserving today's pass/fail expectations. (Micro-chore
    fixtures use `startedAt: 'x'` → `NaN`-guarded → any `nowMs` is safe.)
- The staleness check is placed **inside** the `micro-chore` and `release-sweep`
  branches, as the first line of each, before the allowlist call — so it
  pre-empts the silent allowlist rejection and inherits each branch's existing
  pre-rollout-hard position (no behavior change for any other path, and no new
  pre-rollout regression — both branches already return before the rollout gate):
  ```
  if (session?.path === 'micro-chore') {
    if (isSessionStale(session, opts.nowMs, opts.ttlHours)) return staleResult(session, opts.ttlHours);
    if (!isMicroChoreAllowed(staged)) return { ok: false, reason: `micro-chore diff ...` };
    return { ok: true };
  }
  if (session?.path === 'release-sweep') {
    if (isSessionStale(session, opts.nowMs, opts.ttlHours)) return staleResult(session, opts.ttlHours);
    if (!isReleaseSweepAllowed(staged)) return { ok: false, reason: `release-sweep diff ...` };
    return { ok: true };
  }
  ```
  where `staleResult` returns `{ ok: false, reason: "session stale: '<path>'
  started <startedAt> (older than <ttlHours>h). Run /gate again to refresh." }`.
- The existing `NOLDOR_PATH_OVERRIDE` check already short-circuits at the top of
  `runPreCommit`, so an override bypasses staleness for free — consistent with
  override semantics at every other layer.
- The `import.meta.url` entrypoint resolves the inputs **fail-open** (a thrown
  config error must never block a commit) and passes them explicitly into
  `runPreCommit`. `loadConfigSync` is given an explicit path built from
  `process.cwd()`, matching how `pr-flow-cli` calls `loadConfig` (rather than
  relying on the module-level relative `DEFAULT_PATH`):
  ```
  const cwd = process.cwd();
  let ttlHours = DEFAULT_SESSION_TTL_HOURS;
  try { ttlHours = resolveSessionTtlHours(loadConfigSync(join(cwd, '.noldor', 'config.json'))); }
  catch { /* fail-open: malformed config must not block commits */ }
  const r = runPreCommit({
    cwd,
    pathOverride: process.env.NOLDOR_PATH_OVERRIDE,
    nowMs: Date.now(),
    ttlHours,
  });
  ```

### Part 2 — Micro-chore auto-clear (complementary)

**`src/core/pr-flow-cli.ts`**

- Extract a small helper (co-located, exported for test):
  ```
  export function clearMicroChoreSession(cwd: string, session: SessionMarker): void {
    if (session.path === 'micro-chore') clearSession(cwd);
  }
  ```
- Call it in `runCli` after the existing
  `process.stdout.write(\`PR merged: ...\`)` line (`pr-flow-cli.ts:192`) and
  before `return 0` — i.e. once the PR is confirmed merged and reported. The
  session survives through the whole pr-flow (which reads it to derive
  `PrFlowInput`) and is cleared only after the micro-chore has shipped.

This mirrors the cleanup worktree paths already get and closes the lingering
gap at its source. The Part 1 staleness expiry remains the safety net for any
micro-chore session that is abandoned before pr-flow runs (operator commits,
then walks away): the next day it reads as stale rather than enforcing a cold
allowlist.

`release-sweep` deliberately gets **no** Part-2 auto-clear: its end-of-flow is
`pnpm release`, not `pr-flow-cli`, so there is no single merge point to hook,
and a release sweep is a same-day operation. Its lingering risk is covered by
Part 1 staleness alone. The asymmetry is intentional — Part 2 targets only the
one main-repo path that flows through `pr-flow-cli`.

## Testing

- **`isSessionStale`** (`src/core/__tests__/session.test.ts`):
  - micro-chore fresh (1h) → `false`; micro-chore stale (25h) → `true`.
  - release-sweep stale (25h) → `true`.
  - fast-track stale (25h) → `false`; full-* stale (25h) → `false`;
    specs-only-* stale (25h) → `false`; release-automation stale (25h) → `false`.
  - unparseable `startedAt` → `false`.
  - exactly at boundary (`nowMs - parsed === ttlHours*3.6e6`) → `false`.
- **`runPreCommit`** (`src/hooks/__tests__/noldor-pre-commit.test.ts`):
  - stale micro-chore → `ok:false` with the **stale** reason (not the allowlist
    reason).
  - fresh micro-chore with files outside allowlist → existing allowlist reason
    (staleness did not pre-empt it).
  - stale release-sweep → `ok:false` stale reason.
  - `NOLDOR_PATH_OVERRIDE` set + stale session → `ok:true` (override wins).
  - stale fast-track → unaffected (no allowlist branch; returns `ok:true` via the
    existing fall-through / post-rollout path) — confirms the eligibility scope.
- **`resolveSessionTtlHours`** (`src/cr/__tests__/config.test.ts`):
  - config with `gate.sessionTtlHours: 6` → `6`.
  - config without `gate` block → `24`.
  - config with `gate.sessionTtlHours: 0` (or negative) → schema parse throws
    (the `.positive()` constraint), confirming bad config is rejected at parse.
  - `loadConfigSync` on a malformed config file → throws (strict, unchanged);
    a separate assertion that the hook entrypoint's try/catch yields `24` is
    covered by the `runPreCommit` wiring (resolution is fail-open at the call
    site, not in `loadConfigSync`).
- **`clearMicroChoreSession`** (`src/core/__tests__/pr-flow-cli.test.ts`):
  micro-chore session → `clearSession` invoked (marker file removed);
  non-micro-chore session → marker untouched.

## Files Touched

- `src/core/session.ts` — `isSessionStale`, `STALE_ELIGIBLE_PATHS`.
- `src/cr/config.ts` — `DEFAULT_SESSION_TTL_HOURS`, `gate` schema block, `resolveSessionTtlHours`, `loadConfigSync`.
- `src/hooks/noldor-pre-commit.ts` — staleness gate inside the micro-chore / release-sweep branches + fail-open entrypoint wiring. Adds an import of `DEFAULT_SESSION_TTL_HOURS` / `resolveSessionTtlHours` / `loadConfigSync` from `cr/config.ts` (top-layer hook→cr edge) and `isSessionStale` from `core/session.ts`; `join` from `node:path` is already imported (line 5) — no new path import.
- `src/hooks/__tests__/noldor-pre-commit.test.ts` — inject `nowMs`/`ttlHours` into all 15 existing `runPreCommit` calls (see Part 1 churn note) + new staleness cases.
- `src/core/pr-flow-cli.ts` — `clearMicroChoreSession` + post-merge call.
- Test files as listed above.
