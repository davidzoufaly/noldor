---
noldor-page: drain-mode
introduced: 0.5.0
---
<!-- @feature: portable-gate-entrypoint-for-non-claude-runners -->

# Drain Mode

The runner-neutral contract for one headless gate child spawned by the
autonomous drain supervisor (`pnpm noldor autonomous run` / `noldor autonomous
watch`). The supervisor owns the loop, retries, skips, and the lock; each child
ships exactly one entry and exits. Claude children receive `/noldor-gate --drain
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
- On CR-red, run `pnpm noldor cr autofix plan --slug <slug> --kind code` FIRST.
  On exit 0, apply the listed `M<n>` mechanical blockers, commit,
  `pnpm noldor cr autofix record --slug <slug> --kind code --applied <n> --deferred <n>`,
  re-run the code-stage orchestrate with the printed `base-sha`, and re-aggregate.
  With `autonomous.onBlockers: 'auto-fix'` this is what lets a mechanical-only red
  self-heal instead of failing the whole iteration — the drain's usual outcome for
  a missing section or an unmet stated contract. Bounded at 2 rounds per session
  plus a no-progress stop; any non-zero from either verb falls through to the next
  bullet. The knob defaults to `prompt`, in which case `plan` exits 10 with
  `knob-off` and behaviour is unchanged. `onBlockers` is deliberately NOT part of
  the headless-safe precondition set: both values are safe unattended.
- On a CR-red the seam declined, or on test/typecheck-red: run
  `pnpm noldor cr escalate --autonomous` (config `autonomous.onFailure` governs)
  and exit non-zero — the supervisor retries from clean or skips.
- Commit and push gates run unchanged: hooks inject the `Noldor-*` trailers
  from the session marker; drain mode never bypasses them.
- **Never background these commands, and never end the run before the PR
  exists.** Run each in the foreground and wait for it to exit. Committed work
  plus a clean exit plus a "waiting on the reviewer lane" sign-off is
  indistinguishable from a finished iteration — the supervisor reads it as a
  failed build and re-spawns a full rebuild. Before returning, assert delivery:
  `gh pr list --state open --head <branch> --json number` must be non-empty (or
  `pr-flow` must have reported the merge when `NOLDOR_DRAIN_OPEN_ONLY` is
  unset). Empty means the iteration is not done — finish it or exit non-zero;
  never report success.

## Finish path (undelivered work on `fast/<slug>`)

The supervisor sends this variant when a prior child for the same slug exited
`0`, opened no PR, and left the branch with commits ahead of `origin/main` — the
delivery assertion above having been skipped. The work exists; only delivery is
missing, so a rebuild would burn ~13 minutes and ~170k tokens for nothing. Both
the prompt directive and `NOLDOR_DRAIN_FINISH=1` mark such a run.

- **Do NOT force-recreate or delete the branch** (local or remote). Those steps
  discard *abandoned* state; here they would destroy the commits being
  finished. Reuse the existing worktree if present. If there is none, note that
  the work may live only on the remote (a prior child that pushed without
  opening a PR), so resolve the branch before checking it out:

  ```sh
  git fetch origin
  git rev-parse --verify fast/<slug> \
    && git worktree add .worktrees/<slug> fast/<slug> \
    || git worktree add -B fast/<slug> .worktrees/<slug> origin/fast/<slug>
  ```

  `git worktree add <path> <branch>` does not resolve a remote-only branch, so
  the plain form fails with "invalid reference" in exactly the pushed-but-no-PR
  case; `-B … origin/fast/<slug>` creates the local branch from the remote tip.
- **Re-establish the session marker if it is missing.** Finish mode skips path
  selection, so it assumes `.noldor/session.json` survived from the prior child.
  On a fresh worktree it has not, and `pnpm noldor noldor set-autonomous` then
  exits 1 (`no session marker`) and the commit hooks block delivery. Write the
  same fast-track marker the drain path writes (`path: fast-track`, this
  `slug`, `startedAt`) before continuing.
- **Do NOT re-implement the entry** — `git log --oneline origin/main..HEAD` and
  `git diff --stat origin/main..HEAD` show what already landed. The supervisor
  only sends a finish run for a branch a prior child finished cleanly (a child
  killed by the per-entry timeout is rebuilt, not finished), so the work is
  complete; deliver it.
- Re-run roadmap retirement anyway: `pnpm noldor roadmap remove-block <slug>`
  is idempotent — a no-op when the prior child retired the block, and the fix
  when it did not.
- Then run the autonomous end-of-flow above, delivery assertion included.
  Re-running `cr orchestrate --autonomous` over an existing sink is safe (its
  overwrite guard defaults to archive-and-overwrite).
- Finish attempts count against the supervisor's `--max-retries` like any other
  iteration, so a finish that fails again falls through to retry/skip.

## Resume path (designed FDs, `feat/<slug>`)

The plans-source drain resumes an in-progress FD that is already designed.
Differences from the roadmap path:

- Branch is `feat/<slug>` — resume it (create from `main` only when absent);
  no force-recreate of prior plan work.
- Preconditions: `docs/design/specs/<date>-<slug>-design.md` AND
  `docs/design/plans/<date>-<slug>.md` must exist. If either is missing,
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

## Double-skip salvage

A drain iteration can double-skip (auto-park "retries-exhausted") for reasons
that are NOT real blockers: transient connection drops, and — recurring every
cycle — the verify lane running `oxfmt --check` against the worktree's
**untracked** `.claude/settings.local.json`.

When the branch work is actually sound, salvage by hand:

1. Worktree the feat branch → `git rebase main`.
2. `oxfmt .claude/settings.local.json` in place (clears the untracked-file fmt red).
3. `pnpm verify`.
4. `cr orchestrate --kind code --autonomous` (mints the receipt).
5. `cr aggregate --kind code`.
6. `pnpm pr-flow` from the worktree.
7. `autonomous unpark <slug>` — a by-hand ship leaves the park entry behind.

Note: with no `agents` block in `.noldor/config.json`, spawned subagents inherit
the `~/.claude/settings.json` model default (opus), never the orchestrator's env
default.
