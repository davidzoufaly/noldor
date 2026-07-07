---
noldor-page: drain-mode
introduced: 0.5.0
---
<!-- @feature: portable-gate-entrypoint-for-non-claude-runners -->

# Drain Mode

The runner-neutral contract for one headless gate child spawned by the
autonomous drain supervisor (`pnpm noldor autonomous run` / `noldor autonomous
watch`). The supervisor owns the loop, retries, skips, and the lock; each child
ships exactly one entry and exits. Claude children receive `/gate --drain
<slug>` and follow the gate skill's drain-mode section; prose-dispatch runners
(codex, opencode — see the [flag mapping](agent-runtimes.md)) receive a
self-contained directive that points here. This page is that directive's
canonical referent: it restates the drain contract without any slash-command
dependency, so the prompt stays a thin pointer.

## Entry binding

- Ship **exactly the slug named by the spawn directive** — never re-pick from
  the queue (parallel drain assigns each concurrent child a distinct slug).
  Fallbacks when no slug rides the prompt: the `NOLDOR_DRAIN_SLUG` env var if
  set, else the top entry from `pnpm noldor next-priority --suggestions --json`.
- Honor `NOLDOR_DRAIN_SKIP` (comma-separated slugs the supervisor already
  skipped): never pick a listed entry.
- **Oversize guard:** before scaffolding anything, run
  `pnpm noldor noldor split-check --entry <slug>` and capture stdout + exit
  code. On exit 2, exit non-zero without scaffolding and echo the signal
  lines to stderr — an entry whose *label* routes to fast-track but whose
  *body* trips the oversize heuristics needs a human re-size or split, never
  a headless ship. On exit 1 (checker infra error), continue — never block a
  drain on checker infra.
- The supervisor sets `NOLDOR_DRAIN=1` in the child environment; treat its
  presence as confirmation you are a drain child.
- **Never ask interactive questions.** Runners enforce this via their
  kill-switch — see the [agent-runtimes flag mapping](agent-runtimes.md)
  (`--disallowed-tools AskUserQuestion`, non-interactive exec,
  `permission.question: "deny"`). Anything that would block on a human must
  instead fail the run (exit non-zero).

## Branch discipline — `fast/<slug>` (roadmap entries)

- The branch name is deterministic: `fast/<slug>` — the supervisor maps
  slug → branch → PR to detect shipped work.
- **Force-recreate before starting:** remove a stale worktree for the branch
  first (`git worktree remove --force <dir>`, if present), then
  `git branch -D fast/<slug>` and `git push origin --delete fast/<slug>`
  (each only when it exists). Reaching this point means the supervisor found
  no open PR for the slug, so leftover `fast/<slug>` state is abandoned work,
  safe to discard. This per-slug removal is the only worktree a drain child
  deletes.
- Do the work on that branch and run every noldor command from inside its
  checkout/worktree.

## Roadmap retirement

- Implement the entry, then remove its roadmap block **on the branch**:
  `pnpm noldor roadmap remove-block <slug>`. Absence of the block on `main`
  after merge is the supervisor's success oracle.

## Autonomous end-of-flow

- Mark the session autonomous immediately after the session marker exists:
  `pnpm noldor noldor set-autonomous` — never ask autonomous-vs-interactive.
- Code-stage CR:
  `pnpm noldor cr orchestrate --slug <slug> --artifact . --kind code --profile fast-track --autonomous`
  (drop `--profile fast-track` on the resume path — that profile is for
  fast-track roadmap entries).
- Ship via `pnpm noldor pr-flow` (auto-merge; polls until the PR merges).
  Under parallel drain the supervisor sets `NOLDOR_DRAIN_OPEN_ONLY=1`:
  `pr-flow` then pushes + opens the PR and returns at PR-open — the
  supervisor's serialized merge coordinator does the merging.
- On CR-red or test/typecheck-red: run `pnpm noldor cr escalate --autonomous`
  (config `autonomous.onFailure` governs) and exit non-zero — the supervisor
  retries from clean or skips.
- Commit and push gates run unchanged: hooks inject the `Noldor-*` trailers
  from the session marker; drain mode never bypasses them.

## Resume path (designed FDs, `feat/<slug>`)

The plans-source drain resumes an in-progress FD that is already designed.
Differences from the roadmap path:

- Branch is `feat/<slug>` — resume it (create from `main` only when absent);
  no force-recreate of prior plan work.
- Preconditions: `docs/superpowers/specs/<date>-<slug>-design.md` AND
  `docs/superpowers/plans/<date>-<slug>.md` must exist. If either is missing,
  exit non-zero immediately — never improvise a design.
- Execute the plan task-by-task inline, then the same autonomous end-of-flow
  as above plus the FD seams: refresh the FD's Usage section and flip the
  phase before merge (`pnpm noldor features phase-flip-done <slug>`).
- Never pause for a lane picker or PR approval.

## Exit-code contract

- `0` — the entry shipped (PR merged, or opened under
  `NOLDOR_DRAIN_OPEN_ONLY=1`).
- non-zero — the iteration failed; leave state clean enough for the
  supervisor's retry-from-clean (its salvage rebuilds a stale `fast/<slug>`
  from fresh `main`).

Drain mode is stricter than plain autonomous mode: it requires the
headless-safe config set (`autonomous.onFailure: "abort"`,
`skipLanePicker: true`, `requireHumanPrApproval: false`) — the supervisor
refuses to start otherwise. The Claude-path rendering of this contract lives
in the gate skill's Drain-mode section; keep the two in sync.
