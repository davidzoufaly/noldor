# Continuous Autonomy — watch, salvage, escalations

`noldor autonomous watch` makes the one-shot drain continuous: a long-lived (or cron-fired)
scheduler that keeps draining the roadmap queue in bounded cycles, repairs known failure modes,
and escalates the rest to a structured inbox instead of dying or blocking.

## Lifecycle

1. Acquire `.noldor/drain.lock` for the watcher's lifetime — a second watcher or a concurrent
   `autonomous run` refuses to start.
2. Clear a stale `.noldor/drain-stop` sentinel **once at startup** (a sentinel written during the
   run — including between cycles — is live operator intent and is honored, never cleared).
3. Cycle: pause check → daily-cap check → bounded `runDrain` (`--max-features` per cycle,
   K=1) → escalation mapping → rails update → notify → sleep `--interval` minutes.
4. `--once` runs a single cycle and exits — cron mode is the same code.

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

## CI-cron placement

Out of scope for now: run the watcher on the operator's machine (daemon or local cron with
`--once`). A CI-cron variant waits for consumer-contract CI (secrets + checkout strategy).
