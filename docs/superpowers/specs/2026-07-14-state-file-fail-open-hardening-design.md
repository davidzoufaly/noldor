# State-File Fail-Open Hardening — Design

**Slug:** state-file-fail-open-hardening
**FD:** docs/features/state-file-fail-open-hardening.md
**Date:** 2026-07-14
**Tier:** specs-only
**Deps:** none

## Problem

Deep-audit batch `.noldor/research/2026-07-13-184850` found that Noldor's state-file handling consistently **fails open**: a corrupt file or a torn write silently resets the system toward the *permissive* default. Confirmed live, grounded in the current tree:

1. **Lock ownership.** `releaseLock` ([src/autonomous/drain-lock.ts:103-109](../../../src/autonomous/drain-lock.ts#L103-L109)) unconditionally `unlinkSync`s `.noldor/drain.lock` by path, ignoring the `{ pid, startedAt }` owner token `acquireLock` writes at [drain-lock.ts:65](../../../src/autonomous/drain-lock.ts#L65). The real-world trigger is the top-level crash handler at [src/autonomous/watch.ts:432-439](../../../src/autonomous/watch.ts#L432-L439): if `main()` throws anywhere in its pre-acquire region (cwd read, arg parse, config load, `--detach` respawn — lines 111-143, before the `acquireLock` at [watch.ts:146](../../../src/autonomous/watch.ts#L146)), the `.catch` still calls `releaseLock(process.cwd())`, deleting a *different* live supervisor's lock → two concurrent supervisors drain one repo, double-spawn gates, race merges.

2. **Rollout marker.** `isPostRollout` ([src/core/rollout-marker.ts:22-30](../../../src/core/rollout-marker.ts#L22-L30)) runs `git merge-base --is-ancestor <marker> HEAD` and `return r.status === 0`. A corrupt marker (torn write, truncated SHA) makes git exit 128 (`fatal: Not a valid object name`), collapsing to `false` — indistinguishable from clean "pre-rollout". All three commit/push gates then soft-mode via `if (!isPostRollout(head)) return { ok: true }`: [noldor-pre-commit.ts:115](../../../src/hooks/noldor-pre-commit.ts#L115), [noldor-validate-trailer.ts:81](../../../src/hooks/noldor-validate-trailer.ts#L81), [noldor-enforce-review-receipt.ts:36](../../../src/hooks/noldor-enforce-review-receipt.ts#L36). A single corrupt marker disables the session wall, trailer validation, and receipt check repo-wide. (Asymmetry: the pre-edit-guard tests marker *truthiness* directly at [noldor-pre-edit-guard.ts:58](../../../src/hooks/noldor-pre-edit-guard.ts#L58), so it stays fail-*closed* on the same corruption — the two layers disagree.)

3. **Session guard.** `readSession` ([src/core/session.ts:72-76](../../../src/core/session.ts#L72-L76)) has no try/catch: a torn `.noldor/session.json` throws (`JSON.parse` `SyntaxError` or Zod `ZodError`). The pre-edit-guard entrypoint's `try` ([noldor-pre-edit-guard.ts:98-102](../../../src/hooks/noldor-pre-edit-guard.ts#L98-L102)) wraps only the stdin parse; `runPreEditGuard` runs *outside* it (lines 90/103), so the throw is uncaught → Node exits **1**. Per Claude Code PreToolUse semantics, exit 2 = block, any other non-zero = non-blocking error → **the edit proceeds**. A torn session file silently bypasses the edit gate. (Confirmed; no test covers it.)

4. **Watch state.** `loadWatchState` ([src/autonomous/watch-state.ts:25-50](../../../src/autonomous/watch-state.ts#L25-L50)) `catch`es any parse error and returns zeroed defaults — resetting both `shippedToday` (daily cap) and `consecutiveFailures` (trip rail) to 0. A torn file → unlimited spawns + wiped trip history. The write at [watch-state.ts:56](../../../src/autonomous/watch-state.ts#L56) is plain `writeFileSync` (the torn-file source). The existing test [watch-state.test.ts:125-129](../../../src/autonomous/__tests__/watch-state.test.ts#L125-L129) *asserts* this fail-open.

5. **Drain park.** `loadPark` ([src/autonomous/escalations.ts:152-158](../../../src/autonomous/escalations.ts#L152-L158)) returns `{}` on any parse error → **all** known-failing entries unparked → drain retries entries that always fail. Write at [escalations.ts:163](../../../src/autonomous/escalations.ts#L163) is plain `writeFileSync`. Test [escalations.test.ts:246-251](../../../src/autonomous/__tests__/escalations.test.ts#L246-L251) asserts the fail-open.

6. **Dashboard bind.** `startServer` calls `server.listen(desired, resolve)` ([src/dashboard/server.ts:909](../../../src/dashboard/server.ts#L909)) — the host arg is omitted, so Node binds all interfaces (`0.0.0.0`/`::`), LAN-reachable. There is **no auth** anywhere in the request path ([server.ts:818-847](../../../src/dashboard/server.ts#L818-L847)); five unauthenticated `POST` endpoints mutate `docs/roadmap.md`/`docs/backlog.md` ([server.ts:185-207](../../../src/dashboard/server.ts#L185-L207)), notably `POST /api/roadmap/add` ([handleApiAdd, server.ts:345-377](../../../src/dashboard/server.ts#L345-L377)) which writes attacker-controlled fields verbatim. Composed with a `bypassPermissions` drain agent, this is a LAN roadmap-inject → RCE chain. Host is not configurable today (only port is).

Shared root cause: plain `writeFileSync` + parse-error-→-permissive-default, while atomic-write and O_EXCL-lock primitives already exist but callers bypass their guarantees.

## Goals

- Every read that **gates an action** (enforcement decision, drain spawn, park-skip, edit-gate) fails **closed** on corruption, distinguishing a legitimately-absent file (fresh start) from a corrupt one. Read-only *views* (the dashboard) surface corruption instead of silently rendering the permissive default.
- Torn writes are prevented at the source by routing state writers through an atomic write.
- `releaseLock` only removes a lock whose on-disk owner token matches this process — which, on its own, makes a pre-acquire crash-handler release a no-op against a foreign lock.
- The dashboard binds loopback by default, with an explicit opt-out for deliberate exposure.
- Corruption is **loud** (stderr), never silent.

## Non-goals

- **Dashboard authentication.** Loopback-bind removes the LAN vector; adding tokens/origin checks is a separate, larger design (deferred — see Risks).
- Reworking the async dashboard `atomicWriteFile` ([src/dashboard/api/atomic.ts](../../../src/dashboard/api/atomic.ts)) or its `blocks.ts` callers — they already write atomically and stay as-is.
- Encrypting or checksumming state files; atomicity + fail-closed reads are sufficient.
- Changing `readSession`'s public contract (other callers depend on throw-on-bad-shape); the fix is at the guard entrypoint.
- **`drain-state.json`** (`readState` [drain-state.ts:81-87](../../../src/autonomous/drain-state.ts#L81-L87) `catch → null`; `writeState` plain `writeFileSync` [drain-state.ts:92](../../../src/autonomous/drain-state.ts#L92)) is deliberately excluded: it is an observability snapshot (last drain progress for the status/dashboard read-out), not an action-gate — a torn read degrades a status display, it does not relax enforcement or uncap a rail. If it were ever wired into a gating decision, it would inherit `atomicWriteFileSync` too.

## Design

### Unit 1 — `atomicWriteFileSync` (new shared core primitive)

New `src/core/atomic-write.ts` exporting `atomicWriteFileSync(target: string, content: string): void` — write to `<target>.tmp.<pid>`, then `renameSync(tmp, target)` (same-filesystem rename is atomic; a reader sees old-or-new, never torn). Mirrors the existing sync pattern at [src/core/agent-events.ts:103-112](../../../src/core/agent-events.ts#L103-L112). Sync (not the async [dashboard/api/atomic.ts](../../../src/dashboard/api/atomic.ts)) because all four callers below are synchronous; forcing async would ripple into their non-async call sites in `watch.ts`/`escalations.ts`. The helper does **not** create directories; the four callers keep their existing `mkdirSync('.noldor', { recursive: true })` (session.ts:80, rollout-marker.ts:47, watch-state.ts:55, escalations.ts:162) so the target dir exists for the `.tmp.<pid>` write.

Route these four plain-`writeFileSync` writers through it:
- `writeSession` — [session.ts:81](../../../src/core/session.ts#L81)
- `ensureRolloutMarker` — [rollout-marker.ts:48](../../../src/core/rollout-marker.ts#L48)
- `saveWatchState` — [watch-state.ts:56](../../../src/autonomous/watch-state.ts#L56)
- `savePark` — [escalations.ts:163](../../../src/autonomous/escalations.ts#L163)

### Unit 2 — Owner-checked `releaseLock` (load-bearing) + optional crash-handler guard

**Load-bearing fix:** `releaseLock(cwd, token?)` in [drain-lock.ts](../../../src/autonomous/drain-lock.ts) reads+parses the on-disk `{ pid, startedAt }` payload and `unlinkSync`s **only if** `holder.pid === process.pid` and, when `token` is supplied, `holder.startedAt === token.startedAt` (the `startedAt`+pid pair survives PID reuse). A missing/unparseable lock is still a no-op (idempotent). Thread the acquire-time `startedAt` (in scope at the acquire sites [queue-drain.ts:131](../../../src/autonomous/queue-drain.ts#L131), [watch.ts:146](../../../src/autonomous/watch.ts#L146)) into the release sites that can see it — five of the six; the module-scope crash handler at [watch.ts:436](../../../src/autonomous/watch.ts#L436) cannot reach `main()`-local `startedAt`, so it calls the pid-only form (which already no-ops against a foreign lock). `releaseLock`'s `token` is therefore optional by design.

This alone closes the primary bug: the top-level crash handler at [watch.ts:432-439](../../../src/autonomous/watch.ts#L432-L439) fires when `main()` throws pre-acquire; its `releaseLock(process.cwd())` then reads the *foreign* live supervisor's lock, sees a different `pid`, and no-ops. No mutable "did-I-acquire" flag is required.

**Optional belt-and-suspenders:** if an explicit acquisition guard is still wanted, note that the `.catch` at [watch.ts:434-438](../../../src/autonomous/watch.ts#L434-L438) is **module-scope, outside `main()`** — a `let acquired` declared inside `main()` would be invisible to it, so any such flag must be module-scoped. Given the owner-check already suffices, this spec does **not** add the flag; the owner-check is the fix. TOCTOU: the read-then-unlink accepts the small idempotent race (a concurrent reclaim already renames the stale lock aside at [drain-lock.ts:80-85](../../../src/autonomous/drain-lock.ts#L80-L85)); owner-match makes a mismatched delete impossible.

### Unit 3 — Rollout-marker fail-closed

`isPostRollout` ([rollout-marker.ts:22-30](../../../src/core/rollout-marker.ts#L22-L30)): branch on the `git merge-base --is-ancestor` exit status —
- `0` → `true` (ancestor: post-rollout, enforce).
- `1` → `false` (clean not-an-ancestor: pre-rollout, soft).
- anything else — status `128` (bad/unresolvable object, i.e. corrupt marker) **or `null`** (`spawnSync` returns `status: null` when git is absent or the child was signal-killed) → **`true`** (fail closed: enforce).

Behavior-change note: in a git-absent environment `isPostRollout` today returns `false` (soft); after this change a *present* marker + no git → `true` (enforce). This is the correct fail-closed posture for an enforcement decision, but it is a deliberate behavior change worth flagging (a marker only exists post-rollout anyway, so a real git-less repo has no marker and hits the `!marker → false` guard first).

`readRolloutMarker` is left unchanged — it already returns corrupt-but-non-empty content as truthy, which keeps the pre-edit-guard ([:58](../../../src/hooks/noldor-pre-edit-guard.ts#L58)) fail-closed; this change aligns the three commit gates to the same posture. No hook-site edits (all three trust the boolean).

### Unit 4 — Session-guard fail-closed

In the pre-edit-guard entrypoint ([noldor-pre-edit-guard.ts:85-112](../../../src/hooks/noldor-pre-edit-guard.ts#L85-L112)) wrap both `runPreEditGuard(...)` invocations (lines 90 and 103) in try/catch; on any throw, `console.error` the reason and `process.exit(2)` (block). A torn/corrupt `session.json` → `readSession` throws → caught → exit 2 → edit blocked. `readSession` and its other callers are untouched.

### Unit 5 — Watch-state & drain-park fail-closed reads

Both `loadWatchState` ([watch-state.ts:25-50](../../../src/autonomous/watch-state.ts#L25-L50)) and `loadPark` ([escalations.ts:152-158](../../../src/autonomous/escalations.ts#L152-L158)) distinguish **absent** from **corrupt**:
- `ENOENT` (file missing) → current defaults (`{shippedToday:0, consecutiveFailures:0}` / `{}`) — a fresh start is legitimate.
- File present but unparseable → write a loud `stderr` warning and **throw** a typed `StateFileCorruptError`.

**Action-gating callers** — the daemon top-level (`runDrain`/watch cycle) and the report paths — let the throw surface: the drain aborts the cycle loudly rather than silently resuming with reset rails / an empty park set. Atomic writes (Unit 1) make a torn file nearly impossible; this read-side guard is defense-in-depth for external corruption.

**Read-only view caller (the fail-open-view gap).** The dashboard `/agents` pane calls `loadPark` inside a swallow at [data.ts:2463-2467](../../../src/dashboard/data.ts#L2463-L2467) (`try { parked = … } catch { parked = [] }`) — a bare throw there would be *swallowed* and re-render an **empty** parked list, i.e. a fail-open *view* (operator sees "nothing parked" when the file is actually corrupt). The stderr warning from `loadPark` still fires, but the render must not lie. Fix: the view caller catches `StateFileCorruptError` distinctly and surfaces a corruption state (a `parkedCorrupt: true` flag on the view model → the pane renders "parked list unreadable (corrupt `.noldor/drain-park.json`)" instead of an empty list). Any other error keeps today's empty fallback. (The adjacent swallow at [data.ts:2448-2450](../../../src/dashboard/data.ts#L2448-L2450) is the **drain-state `readState`** parse — out of scope per Non-goals, observability not a rail — and `loadWatchState` has **no** dashboard caller at all (only [watch.ts:197](../../../src/autonomous/watch.ts#L197)); so the park swallow at [data.ts:2463-2467](../../../src/dashboard/data.ts#L2463-L2467) is the single in-scope view site.)

Update the two tests that currently lock in the fail-open ([watch-state.test.ts:125-129](../../../src/autonomous/__tests__/watch-state.test.ts#L125-L129), [escalations.test.ts:246-251](../../../src/autonomous/__tests__/escalations.test.ts#L246-L251)) to assert: missing → defaults; corrupt → throws. Add a dashboard test asserting a corrupt park file renders the corruption state, not an empty list.

### Unit 6 — Dashboard loopback bind

`startServer(opts: { port?: number; host?: string })` in [server.ts:902-912](../../../src/dashboard/server.ts#L902-L912): resolve `const host = opts.host ?? process.env.DASHBOARD_HOST ?? '127.0.0.1'` and call `server.listen(desired, host, resolve)` ([:909](../../../src/dashboard/server.ts#L909)). Add `--host` to `parseCliArgs`/`CliArgs` ([server.ts:72-85](../../../src/dashboard/server.ts#L72-L85)) and thread through `main()`. Propagate `DASHBOARD_HOST` in the detached spawn env at [ensure.ts:95](../../../src/dashboard/ensure.ts#L95) (today only `PORT` is forwarded) so a hook-launched server honors the opt-out. Health-probe base URLs use `http://localhost` ([server.ts:911](../../../src/dashboard/server.ts#L911), [ensure.ts:115](../../../src/dashboard/ensure.ts#L115)). IPv6 note: on an IPv6-preferring resolver `localhost` → `::1`, which an IPv4-only `127.0.0.1` bind refuses — today this works only because Node 20+ `autoSelectFamily` retries IPv4. To remove that hidden dependency, point the probes at `127.0.0.1` explicitly (matching the default bind) rather than `localhost`; when a custom `--host` is set, thread it into the probe URL — except a wildcard bind, where `http://0.0.0.0:<port>` is not a portable *connect* target on all OSes, so the probe should still connect via `127.0.0.1`. Deliberate LAN exposure: `DASHBOARD_HOST=0.0.0.0` (or `--host 0.0.0.0`).

## Acceptance criteria

- [ ] `atomicWriteFileSync` exists in `src/core/`, unit-tested (writes content; leaves no `.tmp.*` on success; concurrent read never observes partial content).
- [ ] `writeSession`, `ensureRolloutMarker`, `saveWatchState`, `savePark` all route through `atomicWriteFileSync` (no remaining plain `writeFileSync` on those four state files).
- [ ] `releaseLock` deletes only a lock whose on-disk `{pid,startedAt}` matches the caller; a non-owner `releaseLock(cwd)` is a no-op — which is exactly the pre-acquire crash-handler scenario. Test proves a foreign-owned lock survives a non-owner release.
- [ ] `isPostRollout` returns `true` (enforce) when the marker is present but git cannot resolve it (status `128` or `null`); `1` still means pre-rollout. Test with a garbage marker asserts enforce.
- [ ] Pre-edit-guard exits **2** (block) on a corrupt `session.json`; test asserts exit code 2, not 1.
- [ ] `loadWatchState`/`loadPark` return defaults on a missing file and **throw** (loud stderr) on a corrupt one; the two existing fail-open tests are updated accordingly.
- [ ] The dashboard `/agents` view renders a corruption state (not an empty parked list) when `.noldor/drain-park.json` is corrupt; test asserts the `parkedCorrupt` path.
- [ ] Dashboard binds `127.0.0.1` by default; `DASHBOARD_HOST=0.0.0.0` (and `--host`) opts out; test asserts the default bound address is loopback. `DASHBOARD_HOST` survives the detached spawn.
- [ ] `pnpm verify` green.

## Risks / trade-offs

- **Daemon halts on corrupt operational state (Unit 5).** Throwing on a corrupt watch-state/drain-park file stops the drain rather than silently continuing. This is the intended fail-closed posture, and atomic writes make it rare, but a corruption from *outside* Noldor now surfaces as a hard stop the operator must clear. Accepted: a stopped drain is safer than an uncapped or amnesiac one.
- **Dashboard still unauthenticated on loopback.** Loopback-bind closes the LAN vector but a local process / a future tunnel still reaches the mutating endpoints unauthenticated. Auth is a deferred non-goal; the FD notes it as a follow-up.
- **Two atomic-write helpers now coexist** (sync core + async dashboard). Documented divergence by call-site sync/async need; consolidating later is optional and out of scope.
- **PID-reuse window in lock ownership.** The `pid`+`startedAt` pair closes the common case; a pathological same-`startedAt` collision is ignored (startedAt is millisecond-ISO from distinct process launches).

## User Story

As an autonomous drain agent (and the operator supervising it), I want every Noldor state file to fail *closed* when it is corrupt or half-written, so that a crash or torn write can never silently disable the gate, uncap the drain, free a lock I don't own, or expose the dashboard to the LAN.

## Usage

- No new day-to-day commands. Enforcement, drain, and edit-gating behave identically on healthy state files.
- Dashboard now binds loopback: `pnpm noldor dashboard server` → `http://127.0.0.1:4321`. For deliberate LAN exposure: `DASHBOARD_HOST=0.0.0.0 pnpm noldor dashboard server` or `--host 0.0.0.0`.
- On a corrupt state file the operator sees a loud stderr line (`state file corrupt: <path>`); the fix is to delete the offending `.noldor/*.json` (a missing file is a clean fresh start) and re-run.

## Open questions (resolved)

1. *Ship all six fixes as one FD/PR, or slice the independent ones (dashboard-bind, lock-ownership) out first?* -> **One PR** (D1). The roadmap entry batches them as one fix under a shared root cause; each unit is small and Unit 1 (atomic write) underpins Units 3/4/5. Size stays M (split-check clean). Rationale: shared-cause batches review better together than as fragmented one-liners.
2. *Sync or async atomic-write helper?* -> **Sync, in `src/core/`** (D2). All four callers are synchronous; the async dashboard helper would force `saveWatchState`/`savePark`/`writeSession` async and ripple into non-async call sites. Mirror `agent-events.ts:103-112`.
3. *Lock ownership: compare `pid` only, or `pid`+`startedAt`?* -> **`pid`+`startedAt`** (D3). PID-only is vulnerable to reuse; the pair is already written at acquire and is nearly free to compare. No separate crash-handler flag is added (see D8) — the owner-check itself makes the crash-handler release a no-op against a foreign lock.
4. *Corrupt watch-state/drain-park: silently reset (today), fail-safe sentinel, or throw loud?* -> **Throw loud** (D4). Sentinels (max-cap/park-all) hide the corruption; the audit's directive is "make corruption loud and fail toward enforcement". Atomic writes make it rare; a rare loud stop is the correct trade.
5. *Fix `readRolloutMarker` shape (40-hex validate) or only `isPostRollout`?* -> **Only `isPostRollout`** (D5). Hex-validating in `readRolloutMarker` would turn garbage into `null` → *pre*-rollout → soft mode, i.e. reintroduce fail-open in the pre-edit-guard's direct truthiness read. Keeping the raw read truthy + fixing the status branch makes corrupt fail-closed everywhere.
6. *Add dashboard auth now?* -> **No** (D6), deferred non-goal. Loopback-bind removes the LAN vector cheaply; auth is a larger design that shouldn't block this security fix.
7. *Read-only dashboard on a corrupt park/watch-state file: keep today's swallow-to-empty, or surface corruption?* -> **Surface corruption** (D7). A view that silently renders "nothing parked" on a corrupt file is itself a fail-open — it misleads the operator into thinking the drain will retry entries that are actually parked. A distinct `parkedCorrupt` state is cheap; the action-gating drain path still hard-fails via the Unit 5 throw. (Raised by the spec-stage CR — the `data.ts` swallow would otherwise eat the throw.)
8. *Is the Unit 2 `acquired` flag needed alongside the owner-check?* -> **No** (D8). Owner-checked `releaseLock` already no-ops against a foreign lock, so the pre-acquire crash handler is safe without a flag; and the module-scope `.catch` can't see a `main()`-local flag anyway. Owner-check is the single fix. (Raised by the spec-stage CR.)
