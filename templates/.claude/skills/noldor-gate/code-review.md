# /noldor-gate — code-stage review (Step 4)

Read by `fast-track`, `specs-only-*` and `full-*` sessions at Step 4, after the flip commit and before `pr-flow`. A red aggregate continues in `blockers.md`.

## Wait for in-flight standalone from Step 2.5

Before code-stage review starts, drain any artifact-stage lanes that are still running (a standalone-claude spawned earlier may still be writing its sink):

```
pnpm noldor cr aggregate --slug <slug> --wait-ms 150000 --unresolved-only
```

Polls up to 2.5 minutes for unresolved lanes. Exit 0 = every artifact-stage lane has finished writing; exit 1 = a lane is still unresolved, or a sink cannot be read/parsed/trusted (integrity) — loop back to Step 2.5 `address-blockers`.

`--unresolved-only` keeps this step to its one question: are the lanes done? The call is kind-less (it cannot know which artifact kinds ran), so it reads the spec/plan sinks too — and a round that **fix-and-proceeded at the re-round cap leaves its sink red by design**. With the flag every finding still prints, but only lane resolution and sink integrity set the exit code and the `ok=` header — `verdict: cannot-verify` sinks included, which Step 2.5's aggregate already surfaced. The artifact verdict was settled at the Step 2.5 continue-dialog.

## Preflight the push-range gates (before any code-stage review)

`pr-flow`'s push fires the pre-push chain (main-push block + docs/adr/ append-only scan, `template-sync`, `noldor-clones`) only after the review receipt is earned — so a gate failure at push time forces a fix commit, the tree changes, the `Noldor-Reviewed-Subagent` receipt invalidates, and a full code-stage dispatch runs purely to re-earn it. Replay the real hook author-side first, while no receipt exists to lose:

```
pnpm noldor checks push-gates
```

That one command hands the hook to **lefthook itself** — it synthesizes the pre-push stdin line git will send (the branch, `HEAD`, and the branch's remote-tracking sha, or zeros when the remote has no such branch yet) and runs `lefthook run pre-push origin` over it, with `LEFTHOOK_EXCLUDE=noldor-enforce-review-receipt`. So every blocking `pre-push` job runs exactly as the push will run it, and a job later added to `lefthook/noldor.yml` is preflighted with no edit to this prose. `enforce-review-receipt` is the one deliberate exclusion — the receipt is earned by the review below, so before it runs that job can only be red.

Exit 0 = the push will be accepted. Exit 1 = a gate refuses this tree — fix it now (mirror a template twin, re-record a clones baseline alongside the change that moved it) and land the fix as an ordinary commit, then re-run until green. Exit 3 = the replay could not run at all (detached HEAD, or no lefthook on PATH or in `node_modules/.bin`); it prints the jobs to run by hand and is never a pass. A mechanical fix landed here costs one commit; the same fix landed after a green review also costs a receipt re-earn dispatch.

Separately, confirm the first substantive commit's body carries `Why — / How — / What —` sections (24+ non-whitespace chars each): `pr-flow` composes the PR Summary from it and `validatePrSummary` refuses delivery without them — cheaper to reword now (rebase/amend) than at PR-open.

## Code-stage orchestrate

Run the code-stage lanes. Pass **no `--lanes`**: at `--kind code` orchestrate reads `crLanes.code` from `.noldor/config.json` in every session (falling back to `reviewer` alone), and on `specs-only-*` / `full-*` paths forces `codex` in, so an M/L/XL feature never ships reviewed by one model family. An explicit `--lanes` wins over config outright — `--lanes reviewer` silently drops a configured verifier — so use it only to narrow one run on purpose.

```
pnpm noldor cr orchestrate --slug <slug> --artifact <code-paths> --kind code --base-sha origin/main
```

`<code-paths>` is a representative changed path used only for labeling; the subagent lane actually reviews the **`BASE_SHA..HEAD` diff range**, so pass `--base-sha origin/main` to cover the whole feature diff — which **includes the refreshed `docs/features/<slug>.md`** from the FD refresh. That range membership is what delivers the "refreshed FD is reviewed by the code-stage CR" guarantee. Omitting `--base-sha` defaults the lane to `HEAD~1..HEAD` (last commit only — usually not what you want at end-of-flow). On attach paths pass the **parent** slug for `--slug` (the lane reads `docs/features/<slug>.md` as FD context, and attach has no child FD).

**Autonomous mode:** add `--autonomous`. Lanes already come from `crLanes.code` at this stage; the flag is what suppresses the overwrite-guard prompts and the standalone-in-progress prompt, so re-runs over prior sinks don't pause.

**Fast-track profile.** When the session marker `path` is `fast-track`, append `--profile fast-track` to the orchestrate command so the CR pass is scoped (low effort, correctness+security+reuse+simplification per `crReview.profiles`). Other paths omit the flag and get the `default` profile (med effort, every dimension). For the fast-track code-stage review the command is:

```
pnpm noldor cr orchestrate --slug <slug> --artifact <code-paths> --kind code --base-sha origin/main --profile fast-track
```

Sinks: `.noldor/cr/<slug>-code-<lane>.json`, one per lane that ran. Trailer amended on tip commit: `Noldor-Reviewed-Subagent: <tree>`.

**Delta re-earn after a post-green mechanical fix.** `--base-sha origin/main` (the full feature range) is mandatory only for the **first** code-stage pass. A commit landing *after* the green review (a push-gate fix, a fmt-hook rewrite) invalidates the receipt but not the reviewed range, so re-earn with a delta pass: capture `git rev-parse HEAD` **before** committing the fix, then

```
pnpm noldor cr orchestrate --slug <slug> --artifact <code-paths> --kind code --base-sha <last-green-tip>
```

(keep `--profile fast-track` when the first pass used it). The reviewer sees only `<last-green-tip>..HEAD` — the same mechanism as the autofix loop's printed `base-sha:` line.

Uncaptured green tip: only when the fix landed as a **new commit on top** is it `git log -1 --format=%H --grep='^Noldor-Reviewed-Subagent:' origin/main..HEAD`. Never after an amend or rebase — the rewritten commit keeps the stale trailer, the grep returns HEAD itself, the delta is empty, and the gate mints a synthetic OK for an unreviewed fix. After a rewrite use the captured sha, `git rev-parse HEAD@{1}` right after a single amend, or `git rev-parse <branch>@{1}` after a rebase **onto the same base** (`HEAD@{1}` is an intermediate rebase step). After a rebase onto a MOVED `origin/main`, `<branch>@{1}`'s merge-base is the OLD fork point, so lanes would review main's new commits: pass the rebased twin of the last reviewed head (see [`worktree-discipline.md`](../../../docs/noldor/worktree-discipline.md#resuming-a-parked-or-dead-session)), or `--base-sha origin/main`.

## Aggregate code-stage

```
pnpm noldor cr aggregate --slug <slug> --kind code
```

Exit 0 → back to the router's Step 4 checklist (cleanup waits for the merge). Exit 1 → **Read now:** [`blockers.md`](blockers.md) — try the auto-fix seam, then escalate.

## Context cleanup after merge

Run at Step 4.11, after `pr-flow` prints `PR merged:`, inside the worktree before its removal — never at the green aggregate: a failed merge's rebased re-review needs the ledgers' round cap and the stores' rulings. Remove the escalation context file, so stale failure context can't leak into a later retry, plus the auto-fix round ledgers, any quarantine remnant and the decision stores (the green receipt's `Noldor-CR-Settled:` trailers already name every ruling):

```
rm -f .noldor/cr/<slug>-escalation-context.md \
      .noldor/cr/autofix/<slug>-spec.json  .noldor/cr/autofix/<slug>-spec.json.bad \
      .noldor/cr/autofix/<slug>-plan.json  .noldor/cr/autofix/<slug>-plan.json.bad \
      .noldor/cr/autofix/<slug>-code.json  .noldor/cr/autofix/<slug>-code.json.bad \
      .noldor/cr/decisions/<slug>-spec.json .noldor/cr/decisions/<slug>-plan.json \
      .noldor/cr/decisions/<slug>-code.json
```

All three kinds are listed because a `full-*` session runs Step 2.5 at both `spec` and `plan` and Step 4 at `code`, so up to three ledgers and three decision stores exist; `rm -f` on an absent path is a no-op, so enumeration beats deriving the set from the session path. Nothing else ever removes a `.bad` file. Do **not** collapse this to `.noldor/cr/autofix/<slug>-*`: the directory is shared in the main workspace, so a slug that is a prefix of another (`foo` vs `foo-bar`) would cross-match and delete a sibling feature's ledger.
