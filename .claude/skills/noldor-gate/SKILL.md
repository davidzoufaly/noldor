---
name: noldor-gate
description: Single mandatory entry for any code change. Picks one of 6 paths, scaffolds artifacts, sets session marker. Required before any Edit/Write to tracked files.
---

# /noldor-gate

Mandatory entry. Pick a path. Scaffold artifacts. Set session marker. Then proceed.

## Parameters

- `--resume <slug>` — resume an in-progress FD; skips the path picker (see **--resume mode** at the end).
- `--drain <slug>` — **headless drain entry, supervisor-only.** The autonomous queue-drain supervisor passes it on every spawned `claude --print`; never for interactive use.
- `--finish` — **only with `--drain <slug>`, supervisor-only.** The branch already carries committed work that a prior child never delivered.
- Every other invocation is interactive.

## How this skill loads

This file is a router. It holds what every session runs; each branch lives in its own file beside it, in the skill's base directory (the path printed when the skill loaded). A fork carries one line of the form **Read now:** [`<file>`](<file>). That line is part of its step: read the named file in full at that point, before acting on the branch, and read it again if the context was compacted since. Never act on a fork from memory — its rules live only in that file.

| Session | Reads on every run | Reads only when |
| --- | --- | --- |
| `micro-chore` | `micro-chore.md` | — |
| `fast-track` | `fast-track.md`, `code-review.md` | `blockers.md` on a red round or a red test run; `design-writeback.md` when `checks arch-baseline` reports findings |
| `specs-only-new` | `artifact-review.md`, `fd-close.md`, `code-review.md` | `blockers.md` on a red round or a red test run; `design-writeback.md` for a UI or architecture design, or when `checks arch-baseline` reports findings |
| `specs-only-attach` | `attach.md`, `artifact-review.md`, `fd-close.md`, `code-review.md` | as `specs-only-new` |
| `full-new` | `artifact-review.md`, `fd-close.md`, `code-review.md` | as `specs-only-new`; `autonomous.md` after `proceed-autonomous` |
| `full-attach` | `attach.md`, `artifact-review.md`, `fd-close.md`, `code-review.md` | as `full-new` |
| `--drain <slug>` | `docs/noldor/drain-mode.md` | — |
| `--drain <slug> --finish` | `docs/noldor/drain-mode.md` | — |
| `--resume <slug>` under `NOLDOR_DRAIN=1` | `docs/noldor/drain-mode.md` | — |
| `--resume <slug>` | the row of the path it resumes | — |

For the three drain rows the page is the whole contract: no step of this router after the entry check runs.

## Flow

**Entry check — before Step 0.** `/noldor-gate --drain <slug>` is an unattended drain child: the supervisor sets `NOLDOR_DRAIN=1` and disallows `AskUserQuestion`, so any interactive step would stall the iteration until its timeout. Run neither Step 0 nor Step 1. **Read now:** [`docs/noldor/drain-mode.md`](../../../docs/noldor/drain-mode.md) — and follow it end to end for that exact `<slug>`: its Finish path when `--finish` rides the invocation or `printenv NOLDOR_DRAIN_FINISH` shows `1`, its Resume path for `--resume <slug>` under `NOLDOR_DRAIN=1`. When `--drain` is absent but `printenv NOLDOR_DRAIN` shows `1`, it is still a drain run: take the slug from `NOLDOR_DRAIN_SLUG` when set, else from the page's fallback. An interactive `--resume <slug>` goes to **--resume mode** at the end of this file; every other interactive run continues at Step 0.

**Reading an exit code through `pnpm`.** `pnpm` reports every failing script as exit 1, so every "exit 2 / 3 / 4 / 10 / 11" branch in this skill reads as 1 when the command runs as `pnpm noldor …`. The CLI restates the real code on stderr as `noldor: exit code <n>` whenever it is 2 or higher — capture stderr along with stdout, and when that line is present, branch on its `<n>`, not on the shell's exit status. No line and a non-zero status means the real code is 1.

0. **Priority pickup.** Run `pnpm noldor next-priority --suggestions --json` and capture stdout + exit code. The entry check has already routed `--resume` and `--drain` runs, so they never reach this step.
   - Exit code 2 → no in-progress FDs AND no roadmap entries. Proceed to Step 1 (path picker).
   - Exit code 0 → parse stdout as JSON. If the parse fails (corrupt stdout despite exit 0), treat as "any other exit code" below — don't try to recover. On success, build the **bucket question** dynamically — include only buckets that are non-empty:
     - `In-progress` (when `inProgress.length > 0`) — label `Continue in-progress (<inProgress.length>)`, description names the first FD's slug.
     - `Top priority` (when `topPriority.length > 0`) — label `Top priority: <topPriority[0].name>`, description names `topPriority[1].name` and `topPriority[2].name` for context when present.
     - `Quick win` (when `smallHighImpact.length > 0`) — label `Quick win: <smallHighImpact[0].name>`, description names `smallHighImpact[1].name` if present.
     - `Bugfix` (when `bugfixes.length > 0`) — label `Bugfix: <bugfixes[0].name>`, description names `bugfixes[1].name` and `bugfixes[2].name` when present. `bugfixes` holds the `type: fix` entries no other bucket surfaced, highest `impact` first — the repair queue, offered as a choice to fix rather than build.
     - `Milestone-aligned` (when `milestoneAligned !== null`) — label `[milestone] <milestoneAligned.name>`.
     - `Path picker` (always present) — label `Path picker`, description `Skip priority pickup and go straight to path selection.` When a bucket was dropped by the budget below, append `Not shown: <dropped bucket labels>.` so the operator knows what the cap hid.

     **Option budget.** The bucket question caps at 4 options and `Path picker` always takes one, so at most 3 buckets fit. Fill those 3 slots from the non-empty buckets in this fixed rank — `In-progress` → `Top priority` → `Quick win` → `Bugfix` → `Milestone-aligned` — and drop the rest. The rank is the policy: resuming work beats starting it, the priority order beats any filter over it, and a declared repair queue beats a text-overlap guess. Never drop a bucket by any other rule.

   - **On `In-progress` bucket pick:** if `inProgress.length === 1`, derive `slug = inProgress[0].slug` and invoke `/noldor-gate --resume <slug>`. Otherwise, fire a second `AskUserQuestion` with up to 4 options (first 4 entries of `inProgress`; if more than 4 in-progress FDs exist, the 4th option is `[more — see docs/features/]` which prints the full list to chat and exits the gate so the operator can re-invoke with `--resume <slug>` explicitly). On pick, invoke `/noldor-gate --resume <slug>`.
   - **On `Top priority` bucket pick:** if `topPriority.length === 1`, use that entry directly. Otherwise, fire a second `AskUserQuestion` with up to 4 options: `topPriority[0]`, `topPriority[1]` (if present), `topPriority[2]` (if present), `Back`. On entry pick: use `entry.slug` (carried in the JSON by `BacklogEntry.slug`) and `entry.suggestedPath` (stamped by `getSuggestions` per the size→path policy — see the `suggestedPath` handling below), then fall through to Step 1 with that path pre-filled.
   - **On `Quick win` or `Bugfix` bucket pick:** a single entry is used directly; otherwise a second question offers the bucket's entries (both quick wins, up to 3 bugfixes) + `Back`. **On `Milestone-aligned` pick:** use `milestoneAligned` directly — always a single entry (`BacklogEntry | null`, never a list). Same `suggestedPath` handling for all three.
   - **On `Path picker` bucket pick:** fast-track straight to Step 1 — no intermediate confirmation. To cancel, escape the path-picker prompt.
   - Any other exit code → report the stderr message and stop (don't auto-skip; surfacing the error keeps roadmap parse bugs visible).

   **`suggestedPath` handling for the prefill.** Every surfaced entry carries `suggestedPath`, computed by `entryToPath(size, hasParent, touches)` in [`src/core/size-routing.ts`](../../../src/core/size-routing.ts) — the single source of truth for the size→path policy (XS/S → `fast-track`, or `micro-chore` when every path the entry's `Touches:` clause declares is on that lane; M → `specs-only-*`; L/XL → `full-*`; the `-attach` variant when the entry declares a `parent`). On pick:
   - `fast-track` (size XS/S) → **no `/noldor-promote`** (no FD, no spec). Carry `entry.slug` forward and go straight to Step 1 with `fast-track` pre-filled; the scaffold records the slug in the session marker so the source roadmap block is retired (`fast-track.md`). An entry with no `Touches:` clause is routed by size alone, so the downgrade is still a judgment call: pick `micro-chore` instead when the diff will be pure-doc or `.claude/**` prose — `checks shared-files` refuses `.claude/skills/**` from a fast-track worktree.
   - `micro-chore` (size XS/S, every `Touches:` path on the micro-chore lane — `MICRO_CHORE_GLOBS` in [`src/core/allowlist.ts`](../../../src/core/allowlist.ts)) → **no `/noldor-promote`, no worktree.** Carry `entry.slug` forward and go straight to Step 1 with `micro-chore` pre-filled. This is where a skill edit belongs: `checks shared-files` refuses `.claude/skills/**` from a `.worktrees/` checkout, so a fast-track session would build its worktree and retire the block before the real commit is refused. The block is retired inside the micro-chore commit itself (`micro-chore.md`).
   - `specs-only-new` / `specs-only-attach` (size M) → `/noldor-promote <slug> --tier=specs-only`, then prefill that path.
   - `full-new` / `full-attach` (size L/XL) → `/noldor-promote <slug> --tier=full`, then prefill that path.

1. **Path picker.** Use AskUserQuestion to select one of:
   - `micro-chore` — doc/policy edits only (allowlisted)
   - `fast-track` — small code change, no FD
   - `specs-only-new` — new FD, no spec
   - `specs-only-attach` — attach to existing FD, no spec
   - `full-new` — new FD with spec
   - `full-attach` — attach with spec

2. **Path-specific scaffold.**
   - `micro-chore` — **Read now:** [`micro-chore.md`](micro-chore.md) — its scaffold, the temp-branch handoff, roadmap-entry retirement and merge cleanup.
   - `fast-track` — **Read now:** [`fast-track.md`](fast-track.md) — worktree, session marker and roadmap-entry retirement.
   - `specs-only-new`: Prompt slug + category. **Create the worktree first** via `pnpm noldor worktrees create <slug>` (creates `.worktrees/<slug>` on `feat/<slug>` and runs the install; see `docs/noldor/worktree-discipline.md`). Write session marker `{ path, slug, startedAt, markerVersion: 2 }` _inside_ the worktree's `.noldor/session.json`. **Then** invoke `/noldor-promote <slug> --tier=specs-only` (or `/noldor-new-feature <slug> --tier=specs-only` when slug isn't in roadmap/backlog). Then the `noldor-spec` skill to produce the spec at `docs/design/specs/<date>-<slug>-design.md`. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, advance directly to implementation (no plan stage).
   - `full-new`: Prompt slug + category. **Create the worktree first** via `pnpm noldor worktrees create <slug>` (creates `.worktrees/<slug>` on `feat/<slug>` and runs the install). Write session marker `{ path, slug, startedAt }` inside the worktree. **Then** invoke `/noldor-promote <slug> --tier=full` (or `/noldor-new-feature <slug> --tier=full` when slug isn't in roadmap/backlog). Then the `noldor-spec` skill to produce the spec. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, continue: `/noldor-draft-feature-md <slug> --from-spec` (writes FD body stubs from the spec). Then the `noldor-plan` skill. **After plan returns, run Step 2.5 with `--kind plan` again.**
   - `specs-only-attach`, `full-attach` — **Read now:** [`attach.md`](attach.md) — the parent and enhancement prompts, the scaffold and the phase-revert lifecycle.

2.5. **Multi-reviewer CR gate (mandatory pause after every spec/plan artifact).** On `specs-only-*` and `full-*` paths, every spec and every plan stops here before the next skill runs. **Read now:** [`artifact-review.md`](artifact-review.md) — lint, commit, review lanes and the continue dialog.

3. **Session marker.** Always write `.noldor/session.json` (use `src/core/session.ts`).

3.5. **Rule brief before the first edit to a file (every path, every runner).** Before the first `Edit`/`Write` to a file in this session, run:

   `pnpm noldor rules brief --file <path> --stage code`

   Pass one `--file` per path when you already know the set (the spec's "Files touched", a plan task's file list) — repeated `--file` unions into one call. Treat the `ENFORCE` section as **binding**: it is repo policy, not preference, and the code-stage CR reviews the diff against the same rule text (Step 4 resolves it from the changed files automatically). `ADVISORY` is context.

   `--file` is required and there is no stage-only form: a file-scoped rule never matches a query without a file ([`src/rules/resolve.ts`](../../../src/rules/resolve.ts) `fileMatches`), so a stage-only brief would report "no rules match" however full the store is. The command also stamps `session.injectedRules` with what it surfaced — an exposure record, never a compliance claim.

   Re-run it when the session starts touching a file family it has not briefed on (e.g. moving from `src/**/*.ts` into `src/**/*.test.ts`, which carries its own rules). Skipping the brief does not block anything — Step 4's reviewer still holds the rule text — but then the rules arrive as findings instead of as guidance.

4. **End-of-flow (PR flow).** When the user signals "ready to ship", run these in order. Each line names the sessions it applies to and the file that holds its steps; skip a line that does not apply. A `micro-chore` runs only lines 10 and 11.
   1. **Refresh the FD body** — FD-carrying paths (`specs-only-*`, `full-*`). **Read now:** [`fd-close.md`](fd-close.md); on attach paths the scope comes from `attach.md`. Fast-track and micro-chore skip it — neither has an FD of its own.
   2. **Doc-impact check** — `fast-track` only, per `fast-track.md`, before the push-gate preflight.
   3. **Archive this session's design artifacts** — FD-carrying paths, per `fd-close.md`.
   4. **UI baseline write-back** — UI-bearing sessions, including one whose UI emerged during implementation. **Read now:** [`design-writeback.md`](design-writeback.md).
   5. **Architecture baseline write-back** — every path, when `docs/design/architecture/baseline.pen` exists: run `pnpm noldor checks arch-baseline`. When the session approved an architecture `.pen`, or the check reports findings, **Read now:** [`design-writeback.md`](design-writeback.md). Its exit code never blocks `pr-flow`.
   6. **Flip FD `phase: in-progress → done`** — FD-carrying paths, per `fd-close.md`. That one commit carries the refreshed body, the archive moves, any baseline write-back and the flip.
   7. **UI freshness (advisory)** — run `pnpm noldor checks ui-design-freshness` after the flip commit (it reads committed history, so staged edits are invisible to it) and print its per-surface rows. A red is baseline debt: surface it with the `pnpm noldor design ui-sync` remedy and continue. The blocking point is release preflight, never `pr-flow`.
   8. **Code-stage review** — `fast-track`, `specs-only-*`, `full-*`. Tests and typecheck are green first; a red verification run, at any point before this review, **Read now:** [`blockers.md`](blockers.md) — escalate on test-red. Then **Read now:** [`code-review.md`](code-review.md) — wait for artifact lanes, preflight the push gates, orchestrate, aggregate, clean up. A red aggregate goes on to `blockers.md` from there.
   9. **Bootstrap immunity** — FD-carrying paths, per `fd-close.md`, after the green code-stage review and before `pr-flow`.
   10. **`pnpm noldor pr-flow`** — every path. The CLI ([`src/core/pr-flow-cli.ts`](../../../src/core/pr-flow-cli.ts)) reads `.noldor/session.json`, derives its input from the session, the FD frontmatter, the `Noldor-Reviewed-Subagent` trailer and the branch's spec/plan paths, then runs preflight `gh` → `git push --force-with-lease --set-upstream origin <branch>` → `gh pr create` → `gh pr merge --auto --squash` → poll until merged. Flow diagram, push runbook and failure runbook: [`docs/noldor/pr-flow.md`](../../../docs/noldor/pr-flow.md).
   11. **On merged, clean up** — scripted, no interactive finishing skill. **Worktree-backed paths** (`fast-track`, `specs-only-*`, `full-*`): from the **main workspace** run `git worktree remove [--force] .worktrees/<name>` then `git branch -D feat/<name>`. Do NOT use the `ExitWorktree` native tool: the framework creates worktrees with `git worktree add`, so `ExitWorktree` is a no-op that leaves the worktree and branch on disk. `-D` (force) is required because the squash merge leaves the branch's commits off `main`, so `-d` rejects them as not fully merged; `--force` on the remove only when the worktree has uncommitted changes (it should not). **Then sync local `main`: `git fetch origin main && git checkout main && git merge --ff-only origin/main`** — a PR is not finished until local `main` matches `origin/main`. If `--ff-only` rejects, stop and surface the divergence; never force it. **Micro-chore:** per `micro-chore.md`. Print `gh pr view <pr-url>` for the operator, then Step 5.

5. **Next-priority handoff (always-clear).** After Step 4's PR merges and cleanup completes:

- Run `pnpm noldor next-priority`. Capture only the exit code; do NOT read or echo the entry name / size / impact / parent / description from stdout in any user-facing output.
- Exit code 2 → queue empty. Print `Queue empty — ship-ready. Session may exit.` Skip the rest of this step.
- Exit code 0 → top entry exists. Print exactly:

  ```
  Queue non-empty — top priority lives in docs/roadmap.md.

  Always-clear policy: this session ends here. Continue in a fresh context.

  Operator next steps:
    1. /clear
    2. /noldor-gate

  The fresh /noldor-gate will read top-of-roadmap at Step 0 and surface the entry there.
  ```

- Any other exit code → report the stderr message and stop.

**Do NOT name, summarize, paraphrase, or otherwise leak the top entry in the current session.** Even read-only mention biases the operator's framing with stale-context residue from the just-shipped work — exactly the drift the always-clear policy closes. The top entry surfaces ONLY in a fresh `/noldor-gate` Step 0 invocation. Same rule applies if the operator asks "what's next?" in the dirty session — answer: "the roadmap holds it; /clear + /noldor-gate to see."

**Do NOT prompt for "start now" or re-enter `/noldor-gate` inside the same conversation** for the same reason.

## --resume mode

Re-establish session marker for an existing in-progress FD. Reads tier from FD frontmatter, infers path (`specs-only-new` or `full-new` based on tier; user can override to `*-attach` if extending an existing FD). Advances straight to the Step 2 scaffold. Under `NOLDOR_DRAIN=1` the entry check has already sent the run to `docs/noldor/drain-mode.md`.
