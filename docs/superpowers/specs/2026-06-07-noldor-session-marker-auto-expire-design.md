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

- Expiry for `full-*` / `specs-only-*` sessions. These are designed for
  multi-day, multi-commit feature work; a 24h hard block mid-feature would be a
  false alarm. `/gate --resume <slug>` already re-stamps such a marker when
  needed.
- A git `post-commit` hook for the auto-clear. The micro-chore PR flow
  (`pr-flow-cli`) reads the session **after** the commit; clearing at
  post-commit time would break it.

## Design

### Part 1 — Staleness expiry (primary)

Staleness applies only to **short-intent** paths: `micro-chore` and
`fast-track`. Both are "should be quick" flows where a multi-day age signals the
operator's intent has gone cold. Time-based staleness is distinct from
completion-based clearing (Part 2): a 2-day-old `fast-track` *is* cold even if it
has only one commit, whereas a 2-day-old `full-*` feature session is normal.

**`src/core/session.ts`**

- `export const DEFAULT_SESSION_TTL_HOURS = 24`
- `const STALE_ELIGIBLE_PATHS: ReadonlySet<Path> = new Set(['micro-chore', 'fast-track'])`
- `export function isSessionStale(session: SessionMarker, nowMs: number, ttlHours: number): boolean`
  - Returns `false` immediately when `session.path ∉ STALE_ELIGIBLE_PATHS`.
  - Parses `startedAt` via `Date.parse`. If `NaN` (unparseable) → returns
    `false` — never block a commit on a garbage timestamp.
  - Returns `nowMs - parsedMs > ttlHours * 3_600_000`. Strict `>`: a session
    exactly at the boundary is still fresh.

Pure function — no clock, no filesystem. The caller injects `nowMs` and
`ttlHours`, keeping it fully unit-testable.

**`src/cr/config.ts`** (the canonical `.noldor/config.json` schema — already home
to the non-cr `autonomous` block)

- Extend `noldorConfigSchema` with an optional block:
  `gate: z.object({ sessionTtlHours: z.number().positive() }).optional()`
- `export function resolveSessionTtlHours(config: NoldorConfig | null): number`
  — returns `config?.gate?.sessionTtlHours ?? DEFAULT_SESSION_TTL_HOURS`.
- `export function loadConfigSync(path?: string): NoldorConfig | null` — a
  synchronous sibling of the existing async `loadConfig`, needed because the
  pre-commit hook entrypoint cannot `await`. Reads the file with `readFileSync`,
  parses against `noldorConfigSchema`, returns `null` on missing file (matching
  `loadConfig`'s missing-file behavior).

**`src/hooks/noldor-pre-commit.ts`**

- `runPreCommit` opts gain `nowMs: number` and `ttlHours: number` (the function
  stays pure — no `Date.now()` / config read inside it).
- After `readSession` resolves a non-null session and **before** the
  `micro-chore` / `release-sweep` branches:
  ```
  if (session && isSessionStale(session, opts.nowMs, opts.ttlHours)) {
    return {
      ok: false,
      reason: `session stale: '${session.path}' started ${session.startedAt} ` +
              `(older than ${opts.ttlHours}h). Run /gate again to refresh.`,
    };
  }
  ```
  Because `isSessionStale` returns `false` for non-eligible paths, `full-*` /
  `specs-only-*` are untouched.
- The existing `NOLDOR_PATH_OVERRIDE` check already short-circuits at the top of
  `runPreCommit`, so an override bypasses the staleness check for free —
  consistent with override semantics at every other layer.
- The `import.meta.url` entrypoint resolves the inputs:
  `ttlHours = resolveSessionTtlHours(loadConfigSync())`, `nowMs = Date.now()`.

### Part 2 — Micro-chore auto-clear (complementary)

**`src/core/pr-flow-cli.ts`**

- Extract a small helper (co-located, exported for test):
  ```
  export function clearMicroChoreSession(cwd: string, session: SessionMarker): void {
    if (session.path === 'micro-chore') clearSession(cwd);
  }
  ```
- Call it in `runCli` immediately after `openAndAutoMerge` resolves and before
  `return 0` — i.e. once the PR is confirmed merged. The session survives through
  the whole pr-flow (which reads it to derive `PrFlowInput`) and is cleared only
  after the micro-chore has shipped.

This mirrors the cleanup worktree paths already get and closes the lingering
gap at its source. The Part 1 staleness expiry remains the safety net for any
micro-chore session that is abandoned before pr-flow runs (operator commits,
then walks away): the next day it reads as stale rather than enforcing a cold
allowlist.

## Testing

- **`isSessionStale`** (`src/core/__tests__/session.test.ts`):
  - micro-chore fresh (1h) → `false`; micro-chore stale (25h) → `true`.
  - fast-track stale (25h) → `true`.
  - full-* stale (25h) → `false`; specs-only-* stale (25h) → `false`.
  - unparseable `startedAt` → `false`.
  - exactly at boundary (`nowMs - parsed === ttlHours*3.6e6`) → `false`.
- **`runPreCommit`** (`src/hooks/__tests__/noldor-pre-commit.test.ts`):
  - stale micro-chore → `ok:false` with the **stale** reason (not the allowlist
    reason).
  - fresh micro-chore with files outside allowlist → existing allowlist reason
    (staleness did not pre-empt it).
  - `NOLDOR_PATH_OVERRIDE` set + stale session → `ok:true` (override wins).
  - stale fast-track → `ok:false` stale reason.
- **`resolveSessionTtlHours`** (`src/cr/__tests__/config.test.ts`):
  - config with `gate.sessionTtlHours: 6` → `6`.
  - config without `gate` block → `24`.
- **`clearMicroChoreSession`** (`src/core/__tests__/pr-flow-cli.test.ts` or
  session test): micro-chore session → `clearSession` invoked (marker file
  removed); non-micro-chore session → marker untouched.

## Files Touched

- `src/core/session.ts` — `isSessionStale`, `DEFAULT_SESSION_TTL_HOURS`, `STALE_ELIGIBLE_PATHS`.
- `src/cr/config.ts` — `gate` schema block, `resolveSessionTtlHours`, `loadConfigSync`.
- `src/hooks/noldor-pre-commit.ts` — staleness gate + entrypoint wiring.
- `src/core/pr-flow-cli.ts` — `clearMicroChoreSession` + post-merge call.
- Test files as listed above.
