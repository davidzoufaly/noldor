---
noldor-page: autonomy
introduced: 0.5.0
---

# Continuous Autonomy — watch, salvage, escalations

`noldor autonomous watch` makes the one-shot drain continuous: a long-lived (or cron-fired)
scheduler that keeps draining the roadmap queue in bounded cycles, repairs known failure modes,
and escalates the rest to a structured inbox instead of dying or blocking.

## Lifecycle

1. Acquire `.noldor/drain.lock` for the watcher's lifetime — a second watcher or a concurrent
   `autonomous run` refuses to start.
2. Clear a stale `.noldor/drain-stop` sentinel **once at startup** (a sentinel written during the
   run — including between cycles — is live operator intent and is honored, never cleared).
3. Cycle: pause check → daily-cap check → **cycle-start reconciliation** (same pass as
   `run`'s startup: reap orphan agents from a dead prior cycle/run, sync + local-ahead
   divergence pre-flight, heal open PRs, prune shipped worktrees). A reconcile failure
   always writes a `reconcile-failed` escalation + notify; a local-ahead **divergence**
   (persistent operator condition) or a full `maxConsecutiveFailures` streak trips —
   `drain.pause` + exit 1 — while any other throw (transient gh/network) just bumps the
   failure streak and retries next cycle. Then: bounded `runDrain` (`--max-features`
   per cycle, K=1) → escalation mapping → rails update → notify → sleep `--interval`
   minutes.
4. `--once` runs a single cycle and exits — cron mode is the same code.
5. Signals mirror `run`: SIGINT = graceful between-cycles stop (in-flight children
   finish); SIGTERM (`kill $(cat .noldor/watch.pid)`) group-kills the in-flight agent
   children with the watcher instead of orphaning them; SIGKILL is backstopped by the
   next cycle/run's orphan reap (agent pgids ride the `.noldor/drain-state.json`
   heartbeat from both runners).

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
A current-base branch with no PR is left to the gate child's force-recreate. Detection is
fail-closed: a failed `gh`/`ls-remote` aborts the run rather than guessing "clean". Caveat: a
human branch named exactly `fast/<queued-slug>` is indistinguishable from drain leftovers — the
namespace is the drain's by convention.

## Escalation inbox

Item-scoped terminal failures park the slug and the loop continues (park-and-continue):

| Reason              | Trigger                                                              | Parks |
| ------------------- | --------------------------------------------------------------------- | ----- |
| `retries-exhausted` | slug crossed `--max-retries`                                          | yes   |
| `pr-open-unmerged`  | opened PR still unmerged across **2 consecutive cycles** (grace = 1) | yes   |
| `merge-conflict`    | coordinator merge outcome                                              | yes   |
| `merge-timeout`     | coordinator merge outcome                                              | yes   |
| `run-aborted`       | repo-level abort (ff-only reject, gh failure) — bumps the trip rail   | no    |
| `watcher-tripped`   | `maxConsecutiveFailures` reached                                      | no    |
| `reconcile-failed`  | cycle-start reconciliation threw (divergence trips; transients retry) | no    |

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

## Unattended launch paths

A foreground `autonomous watch` started **inside a harness-managed background task** (e.g. Claude
Code `run_in_background`) gets SIGTERM-reaped (exit 143) within minutes — the managed-task
lifecycle tears it down. For an unattended run that outlives the launching session, the watcher
must be detached from it. Three supported paths, simplest first:

### 1. `watch --detach` (built-in, recommended)

```bash
pnpm noldor autonomous watch --detach            # daemon: re-checks every --interval minutes
pnpm noldor autonomous watch --detach --once     # single cycle, then exits (cron-shaped)
```

`--detach` re-spawns the watcher as a session-independent process (`detached: true` + `unref()` —
the same effect as `nohup … &`), redirects its stdout/stderr to `.noldor/watch.log`, records the
pid in `.noldor/watch.pid`, and the launching command exits 0 immediately. The detached child
acquires `.noldor/drain.lock` for its lifetime as usual. All other flags (`--interval`,
`--max-features`, `--max-retries`, `--iteration-timeout`, `--dry-run`, `--json`) pass through.

```bash
tail -f .noldor/watch.log         # follow progress
kill $(cat .noldor/watch.pid)     # stop (or: touch .noldor/drain-stop for a graceful exit-130)
```

If a watcher is already running (live `drain.lock`), `--detach` refuses and prints the live pid
rather than spawning a second daemon that would only lose the lock race.

### 2. `nohup` by hand

The manual equivalent, when you want to own the redirection:

```bash
nohup pnpm noldor autonomous watch > .noldor/watch.log 2>&1 &
disown
```

### 3. cron / systemd (`--once`)

Drive the cycle cadence externally instead of with the daemon's internal sleep. A crontab entry
fires one bounded cycle each interval:

```cron
*/30 * * * * cd /path/to/repo && pnpm noldor autonomous watch --once >> .noldor/watch.log 2>&1
```

`--once` exits after a single cycle, so the lock is held only for that cycle's duration — no
detach needed. A systemd `OnCalendar=` timer wrapping the same command works the same way.

> A **CI-cron** variant (run the watcher from CI on a schedule) is still out of scope — it waits on
> consumer-contract CI for the secrets + checkout strategy.
