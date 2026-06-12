# Continuous Drain Daemon and Escalation Inbox — Design

**Slug:** continuous-drain-daemon-and-escalation-inbox
**FD:** docs/features/continuous-drain-daemon-and-escalation-inbox.md
**Date:** 2026-06-12
**Tier:** full
**Deps:** agent-events-log-and-agents-dashboard-page (unshipped — dashboard surface deferred, see Non-goals), acceptance-verify-lane (unshipped — verify-lane consumption is forward-compatible, not wired here)

## Problem

Every autonomous stage today is one-shot and operator-fired: someone types `noldor autonomous run`, watches or returns later, reads logs on failure, and salvages stale bases by hand from a memory recipe. `runDrain` (`src/autonomous/drain-loop.ts`) already retries and skip-continues per item, but the loop ends when the invocation ends; retry-exhausted slugs vanish into `skipped` with no persisted reason; repo-level failures abort the whole run; and the stale-base failure mode (leftover `fast/<slug>` branch and/or closed-unmerged PR after a failed attempt — the live PR #49→#55 case) wedges re-attempts until an operator intervenes. "Agents ship unsupervised" currently means "unsupervised per invocation".

## Goals

- `noldor autonomous watch`: a long-lived (or cron-fired via `--once`) scheduler that keeps draining the roadmap queue in bounded cycles.
- Auto-salvage: mechanize the stale-base recipe — detect at pickup, clean local branch + worktree + remote branch, re-spawn from fresh main; emit a `salvaged` event.
- Escalation inbox: item-scoped terminal failures park the slug (with persisted reason + evidence) and the loop continues with the next item; operator triages via `noldor autonomous inbox` and resolves via `noldor autonomous unpark <slug>`.
- Pluggable notification hook (`autonomous.watch.notifyCommand`) on escalation, cycle summary, and watcher trip.
- Safety rails, all config with conservative defaults: per-day ship cap, consecutive-failure trip, file-based pause switch honored mid-cycle. A paused or tripped watcher is loud (notify + nonzero exit), never silent.

## Non-goals

- Dashboard inbox page. Dep entry `agent-events-log-and-agents-dashboard-page` (unshipped) owns the `/agents` surface; this slice ships CLI-only inbox + JSONL storage it can later read. No new dashboard route.
- Auto-release. Release stays operator-fired (`pnpm release`); the watcher never cuts versions.
- CI-cron placement. Local daemon/cron only; CI variant waits for consumer-contract CI (documented as follow-up in `docs/noldor/autonomy.md`).
- Token-budget rail. No token accounting exists; the config schema documents the omission rather than reserving a dead field.
- Multi-repo coordination. One watcher per repo; the existing `drain.lock` already serializes within a repo.
- Changing child-gate semantics. `assertConfig` headless preconditions (`onFailure: abort`, `skipLanePicker`, `requireHumanPrApproval: false` in `src/autonomous/queue-drain.ts`) are unchanged; park-and-continue lives at the watch layer, not inside the spawned gate.

## Design

### Unit 1 — `src/autonomous/watch.ts` (new): scheduler CLI

Registered as `autonomous.watch` in `src/cli/manifest.ts`. Flags: `--interval <min>` (default from config), `--max-features <n>` (per-cycle bound, default 1), `--once` (single cycle, exit — makes cron trivial), `--json`, plus pass-throughs `--max-retries`, `--iteration-timeout` mirroring `parseArgs` in `src/autonomous/queue-drain.ts`.

Lifecycle:

1. Parse flags; `assertConfig(loadConfigSync())` (reuse from `queue-drain.ts`); load `watch` rails from config.
2. `acquireLock(cwd, startedAt)` (`src/autonomous/drain-lock.ts`) **once for the watcher's lifetime** — a second watcher (or a concurrent `autonomous run`) refuses to start, exactly today's semantics. Released in `finally`.
3. Cycle loop:
   a. Pause check: `.noldor/drain.pause` exists → daemon logs + sleeps (re-checks each interval); `--once` exits 0 with a "paused" note.
   b. Daily-cap check from watch state (Unit 5): `shippedToday >= maxFeaturesPerDay` → sleep until `dayKey` rolls (daemon) or exit 0 (`--once`).
   c. Run one bounded drain: call `runDrain(deps, opts)` as a library (NOT the `queue-drain.ts` CLI — that would double-acquire the lock). Deps are the production set from `queue-drain.ts` (`spawnGate`, `syncMainCleanState`, `openPrExistsFor`, `mergePr`, `writeState` from `src/autonomous/drain-io.ts` / `drain-state.ts`) with two changes: the source is wrapped by the park-filter decorator (Unit 3) and `salvageStaleBase` (Unit 2) is provided; `stopRequested` returns true on SIGINT, `.noldor/drain-stop`, **or `.noldor/drain.pause`** — so a pause written mid-cycle stops between iterations through the existing seam (the exit-130 path `runDrain` already implements).
   d. Map the `DrainResult` to escalations (Unit 3), update watch state + rails (Unit 5), fire `cycle-summary` notify (Unit 4).
   e. `--once` → exit; else sleep `intervalMinutes` (interruptible by SIGINT).
4. Exit codes: 0 clean/paused/capped, 1 tripped or repo-level abort with trip, 130 operator stop.

### Unit 2 — `src/autonomous/salvage.ts` (new): pre-spawn clean-room

Hook: a new **optional** dep on `DrainDeps` (`src/autonomous/drain-loop.ts`):

```ts
salvageStaleBase?: (slug: string, branch: string) => 'clean' | 'salvaged';
```

Called in `worker()` after the `openPrExistsFor` skip-guard and before `spawnGate`. Optional → every existing `runDrain` test and the `queue-drain.ts` K>1 path compile and behave unchanged; `queue-drain.ts` also gains it (the recipe benefits plain `run`, not just `watch`).

`detectStale(cwd, slug, branch)` classifies via `execFileSync` (same style as `drain-io.ts`):

- local branch exists (`git rev-parse --verify <branch>`) and `git merge-base --is-ancestor origin/main <branch>` fails — `origin/main` is not an ancestor of the branch tip, so the branch was cut from (and still bases on) an older main → stale; OR
- a **closed-unmerged** PR exists for the head: `gh pr list --state closed --head <branch> --json number,mergedAt` with `mergedAt == null` entries (mirrors `openPrExistsFor` in `drain-io.ts`); OR
- a remote branch `origin/<branch>` exists with no open PR (leftover push).

`repair(cwd, slug, branch)` then: `git worktree remove --force .worktrees/<slug>` (if registered), `git branch -D <branch>` (if exists), `git push origin --delete <branch>` (best-effort — remote may already be gone), and appends a `salvaged` event (Unit 6). Closed PRs are left as history. Return `'salvaged'`.

Honesty note: the gate child already force-recreates the worktree per slug (see the `syncMainCleanState` doc comment in `drain-io.ts`), but the live PR #49→#55 case proved remote leftovers + closed-unmerged PRs still wedge re-attempts (non-fast-forward pushes / duplicate-head PR creation). Salvage makes the clean room deterministic *before* spawn instead of relying on child behavior. The child then re-implements from fresh main — the recipe's "re-apply, don't cherry-pick": the stale tip is discarded, never merged.

Failure inside salvage: throw → the worker's existing catch treats it as a systemic abort (consistent with fail-closed git/gh handling in the loop). Detection commands failing (e.g. `gh` down) abort rather than guess.

### Unit 3 — `src/autonomous/escalations.ts` (new): park-and-continue

Storage (both under `.noldor/`, gitignored like the other runtime artifacts):

- `escalations.jsonl` — append-only audit log: `{ ts, slug, reason, evidence, stateSnapshot, suggestedAction }`. `reason ∈ 'retries-exhausted' | 'merge-conflict' | 'run-aborted' | 'watcher-tripped'`. `evidence` = retry count, last skip reason, `res.error` text when present. `stateSnapshot` = `{ shipped, skipped, retries }` from the `DrainResult`. `suggestedAction` = canned per reason (e.g. retries-exhausted → "inspect `.noldor/cr/<slug>-*` sinks; unpark after fixing the entry or its premise").
- `drain-park.json` — the open set: `{ [slug]: { reason, ts } }`. Parked slugs are the inbox's "open" items; resolution = removal.

Loop visibility change (the only `drain-loop.ts` edit besides the optional dep): `recordRetryOrSkip` records `skipReasons[slug] = 'retries-exhausted'` when it crosses `maxRetries` into `skip` — today that reason is silent, which makes post-run mapping impossible. Ineligible skips keep their precise source-provided reasons.

Mapping (watch layer, after each cycle — the loop itself stays IO-pure):

- skip with reason `retries-exhausted` or the coordinator's `merge-conflict — PR left open for human resolution` → append escalation + park the slug.
- `res.error` set (abort: ff-only reject, `gh` failure, unknown git state) → append `run-aborted` escalation, **no park** (repo-scoped — the next item would hit the same wall), bump the consecutive-failure rail.
- ineligible skips → never escalated (they're queue hygiene, not failures).

Park enforcement: `parkAwareSource(inner, parked)` decorator wraps `DrainSource.nextItem(exclude)` to add parked slugs to the exclude set (and filters `parseAll` is NOT touched — absence-oracle semantics must stay pristine). Zero `runDrain` signature change.

CLI (registered under `autonomous` in `src/cli/manifest.ts`):

- `noldor autonomous inbox [--json]` — joins `drain-park.json` with the latest matching `escalations.jsonl` line per slug; prints one-glance `slug | reason | ts | evidence-summary | suggested-action`.
- `noldor autonomous unpark <slug>` — removes from `drain-park.json` (idempotent; missing slug = note + exit 0); appends a resolution line to `escalations.jsonl` (`reason: 'unparked'`-style audit entry is NOT a new reason enum member — it's written as a plain JSONL line with `{ ts, slug, resolved: true }`) so the audit trail closes.

### Unit 4 — `src/autonomous/notify.ts` (new): pluggable hook

Config: `autonomous.watch.notifyCommand?: string`. Unset → no-op. Set → `spawnSync('bash', ['-c', cmd])` with env `NOLDOR_NOTIFY_KIND` (`escalation` | `cycle-summary` | `watcher-tripped`) and `NOLDOR_NOTIFY_JSON` (compact payload). 10s timeout, stdio piped, any failure logged to stderr and swallowed — notification must never block or kill the loop (same fail-open contract as `appendAgentEvent` in `src/core/agent-events.ts`). Slack/mail/push is the consumer's one-liner, out of framework scope.

### Unit 5 — rails: config schema + watch state

`autonomousConfigSchema` in `src/cr/config.ts` (the real home of the `autonomous` block — the roadmap entry's `src/core/consumer-config.ts` pointer was stale) gains an optional sub-block:

```ts
watch: z.object({
  intervalMinutes: z.number().int().positive().default(30),
  maxFeaturesPerDay: z.number().int().positive().default(10),
  maxConsecutiveFailures: z.number().int().positive().default(3),
  notifyCommand: z.string().optional(),
}).optional()
```

Wall-clock cap per item = the existing `--iteration-timeout` (default 30 min in `parseArgs`) — documented in `autonomy.md`, not duplicated as a new rail.

`watch-state.json` (`.noldor/`, best-effort writes mirroring `writeState` in `drain-state.ts`): `{ dayKey: 'YYYY-MM-DD', shippedToday, consecutiveFailures, lastCycleAt, pausedReason? }`. Day rollover resets `shippedToday`. Restart-safe: a restarted watcher resumes today's counts instead of resetting the cap.

Trip rule: a cycle counts as failed when `res.exitCode === 1` (abort) or (`res.shipped === 0` and ≥1 new escalation this cycle). `consecutiveFailures` resets on any cycle with ≥1 ship or with zero failures. Reaching `maxConsecutiveFailures` → write `.noldor/drain.pause` (so even a cron-fired `--once` respects the trip), append `watcher-tripped` escalation, fire notify, exit 1. Resume: operator clears escalations via inbox, then `rm .noldor/drain.pause` (documented; no auto-unpause).

### Unit 6 — `salvaged` event

`AgentEvent` (`src/core/agent-events.ts`) gains optional additive fields `kind?: string; slug?: string`. Salvage appends `{ ts, runner: 'drain', role: 'watch', kind: 'salvaged', slug, exitCode: 0, durationMs, timedOut: false }`. Fail-open as today. The `/agents` dep entry later formalizes the event vocabulary; additive-optional keeps this forward-compatible.

### Data flow (one cycle)

```
watch.ts ── pause/cap checks ── runDrain(deps)
  deps.source        = parkAwareSource(roadmapSource(cwd), drain-park.json)
  deps.salvageStale  = salvage.detect+repair  → agent-events.jsonl ('salvaged')
  deps.stopRequested = SIGINT ∨ drain-stop ∨ drain.pause
        │
  DrainResult { shipped, skipped, skipReasons, error }
        │
  escalations.mapCycle() → escalations.jsonl + drain-park.json
  watchState.update()    → watch-state.json (dayKey / counts / trip)
  notify('cycle-summary' | 'escalation' | 'watcher-tripped')
```

### Docs

New `docs/noldor/autonomy.md` (watch lifecycle, rails table, pause/resume + trip runbook, salvage semantics, notify contract, CI-cron follow-up note); `docs/noldor/cr-pipeline.md` gains a pointer from the drain section; `script-catalog.md` regenerated for the three new manifest entries.

## Acceptance criteria

- `noldor autonomous watch --interval 5 --max-features 1` over a queue seeded with 3 entries (one engineered stale-base, one destined-to-fail): two ship across cycles — the stale-base one only after a `salvaged` event appears in `agent-events.jsonl`; the failing one lands in `escalations.jsonl` with reason `retries-exhausted`, evidence, and a park entry, and the watcher proceeds to the next item in the same run.
- `noldor autonomous inbox` lists the parked slug with reason + suggested action; `--json` emits machine-readable rows; `noldor autonomous unpark <slug>` removes it and the next cycle re-selects the slug.
- Creating `.noldor/drain.pause` mid-cycle stops the drain between iterations (exit 130 path) and the daemon refuses to start a new cycle while the file exists; `--once` exits 0 with a paused note.
- With `notifyCommand` set, the hook fires with `NOLDOR_NOTIFY_KIND=escalation` on the parked failure and `cycle-summary` after each cycle; an exiting/broken hook never fails the cycle.
- `maxConsecutiveFailures` reached → `drain.pause` exists afterwards, a `watcher-tripped` escalation row exists, exit code 1.
- `shippedToday >= maxFeaturesPerDay` → no further spawns that day (`--once` exits 0 with a capped note).
- A second `noldor autonomous watch` (or `autonomous run`) while one holds `drain.lock` refuses to start.
- All existing `src/autonomous/__tests__` pass unchanged (optional-dep + decorator design).

## Risks / trade-offs

- **Salvage deletes branches.** Scoped strictly to the drain's own `fast/<slug>` for the slug being picked up, only when stale-classified (behind main / closed-unmerged PR / orphan remote), mirroring the deliberate narrowness documented in `syncMainCleanState`. A human branch named `fast/<slug>` for a queued slug is indistinguishable — accepted risk, documented in `autonomy.md` (same namespace-collision caveat the drain already carries).
- **Park list can mask a fixed entry.** Parked slugs stay parked until explicit `unpark` — an operator who fixes the cause but forgets to unpark sees the item silently skipped. Mitigation: inbox is the loud surface; cycle summary includes parked count.
- **Trip heuristic is coarse.** "0 ships + ≥1 escalation" can trip on a genuinely empty-but-noisy queue. Conservative default (3) + loud pause beats a runaway loop; tune later with telemetry (the metrics roadmap entry).
- **`watch` and an operator in the same repo**: the lock serializes drains, and `syncMainCleanState` checking out `main` underneath an operator's dirty main workspace remains the documented hazard it is today — `drain.pause` is the operator's "I'm working here" switch (runbook in `autonomy.md`).
- **Two new persisted files** (`watch-state.json`, `drain-park.json`) under `.noldor/` — both best-effort/fail-open writes; corruption degrades to "rails reset / nothing parked", never a crash.

## User Story

As an operator running an agent-driven repo, I want the roadmap queue to drain continuously — salvaging its own known failure modes and parking the rest into a reviewable inbox — so that my job collapses to feeding triage and clearing escalations instead of babysitting one-shot drain invocations.

## Usage

```bash
# long-lived daemon: bounded cycle every 30 min (config default)
pnpm noldor autonomous watch

# cron mode: one cycle, then exit
pnpm noldor autonomous watch --once --max-features 1

# triage
pnpm noldor autonomous inbox            # open escalations: slug | reason | evidence | suggested action
pnpm noldor autonomous unpark <slug>    # resolve → re-eligible next cycle

# pause / resume
touch .noldor/drain.pause               # honored mid-cycle (between iterations)
rm .noldor/drain.pause

# notification hook (consumer one-liner, .noldor/config.json)
# autonomous.watch.notifyCommand: "slack-cli post --channel ops \"$NOLDOR_NOTIFY_JSON\""
```

## Open questions (resolved)

1. *Daemon vs cron-fired?* -> Same code; `--once` makes cron trivial (D1: one scheduler loop, two run shapes — zero duplicated logic).
2. *Where does the operator read escalations, given the `/agents` dashboard dep is unshipped?* -> CLI inbox + JSONL v1; dashboard page lands with `agent-events-log-and-agents-dashboard-page` reading the same files (D2: smallest honest surface, no duplicated future work). Ratified by operator at spec dialogue.
3. *Does salvage live in `watch` only?* -> No — optional `DrainDeps.salvageStaleBase` wired by both `queue-drain.ts` and `watch.ts` (D3: the stale-base hazard exists for plain `run` too; the seam is loop-level pickup).
4. *Should park-and-continue change `assertConfig` / child-gate failure handling?* -> No — child keeps `onFailure: abort`; watch parks at the loop level after the child's verdict (D4: keeps the headless-safety contract intact and the change surface small).
5. *Auto-release after N ships?* -> Out of scope v1; release stays operator-fired (D5: per the roadmap entry's explicit scoping).
6. *Token-budget rail now?* -> Omit; no token accounting exists to read (D6: a dead config field would be a lie; metrics entry owns cost accounting).
7. *Salvage when the existing branch is NOT behind main (fresh leftover)?* -> Still salvage if a closed-unmerged PR or orphan remote exists; a current-base branch with no PR is left for the child's force-recreate (D7: only provably-wedging states justify deletion).
