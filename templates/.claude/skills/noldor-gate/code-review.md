# /noldor-gate — code-stage review (Step 4)

Read by `fast-track`, `specs-only-*` and `full-*` sessions at Step 4, after the flip commit and before `pr-flow`. A red aggregate continues in `blockers.md`.

## Wait for in-flight standalone from Step 2.5

Before code-stage review starts, drain any artifact-stage lanes that are still running (a standalone-claude spawned earlier may still be writing its sink):

```
pnpm noldor cr aggregate --slug <slug> --wait-ms 150000 --unresolved-only
```

Polls up to 2.5 minutes for unresolved lanes. Exit 0 = every artifact-stage lane has finished writing; exit 1 = a lane is still unresolved, or a sink cannot be read/parsed/trusted (integrity) — loop back to Step 2.5 `address-blockers`.

`--unresolved-only` is what makes this step ask the question it is here to ask. The call is kind-less on purpose (the controller cannot know which artifact kinds this session produced), so it also reads the spec/plan sinks — and a round that **fix-and-proceeded at the re-round cap leaves its sink red by design**: the findings were fixed in commits and deliberately not re-dispatched. Without the flag this step re-reds on those already-addressed findings, and every such session needs a manual override. With the flag, every lane finding still prints (nothing is hidden) but only lane resolution and sink integrity set the exit code — and the `ok=` header reports that same verdict, so the output never reads `ok=false` above an exit 0. The mute covers every blocker a lane filed, a sink reporting that its own review never happened (`verdict: cannot-verify`) included; that sink was already surfaced by the artifact stage's own aggregate at Step 2.5. The artifact's verdict is not this step's business: it was settled at the Step 2.5 continue-dialog, and the code-stage aggregate below is already `--kind code`-scoped.

## Preflight the push-range gates (before any code-stage review)

`pr-flow`'s push fires the pre-push chain (main-push block + docs/adr/ append-only scan, `template-sync`, `noldor-clones`) only after the review receipt is earned — so a gate failure at push time forces a fix commit, the tree changes, the `Noldor-Reviewed-Subagent` receipt invalidates, and a full code-stage dispatch runs purely to re-earn it. Replay the real hook author-side first, while no receipt exists to lose:

```
pnpm noldor checks push-gates
```

That one command hands the hook to **lefthook itself** — it synthesizes the pre-push stdin line git will send (the branch, `HEAD`, and the branch's remote-tracking sha, or zeros when the remote has no such branch yet) and runs `lefthook run pre-push origin` over it, with `LEFTHOOK_EXCLUDE=noldor-enforce-review-receipt`. So every blocking `pre-push` job runs exactly as the push will run it, and a job later added to `lefthook/noldor.yml` is preflighted with no edit to this prose. `enforce-review-receipt` is the one deliberate exclusion — the receipt is earned by the review below, so before it runs that job can only be red.

Exit 0 = the push will be accepted. Exit 1 = a gate refuses this tree — fix it now (mirror a template twin, re-record a clones baseline alongside the change that moved it) and land the fix as an ordinary commit, then re-run until green. Exit 3 = the replay could not run at all (detached HEAD, or no lefthook on PATH or in `node_modules/.bin`); it prints the jobs to run by hand and is never a pass. A mechanical fix landed here costs one commit; the same fix landed after a green review also costs a receipt re-earn dispatch.

Separately, confirm the first substantive commit's body carries `Why — / How — / What —` sections (24+ non-whitespace chars each): `pr-flow` composes the PR Summary from it and `validatePrSummary` refuses delivery without them — cheaper to reword now (rebase/amend) than at PR-open.

## Code-stage orchestrate

Run the code-stage lanes. Pass **no `--lanes`**: at `--kind code` orchestrate reads `crLanes.code` from `.noldor/config.json` in every session, interactive or autonomous (there is no lane picker at this stage to prompt), falling back to `reviewer` alone when the block is absent — and on `specs-only-*` / `full-*` paths it forces `codex` into the set regardless, so an M/L/XL feature never ships reviewed by one model family. An explicit `--lanes` wins over config outright: `--lanes reviewer` in a repo configuring `['reviewer', 'verifier']` runs half its review posture and the aggregate still reads green. Reach for `--lanes` only to narrow one run on purpose, e.g. to leave the verifier out of a change with no runtime surface.

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

**Delta re-earn after a post-green mechanical fix.** `--base-sha origin/main` (the full feature range) is mandatory only for the **first** code-stage pass. When a commit lands *after* the reviewer went green — a push-gate fix the preflight didn't catch, a fmt-hook rewrite, a one-line message reword that still changed the tree — the receipt invalidates, but the already-reviewed range hasn't changed. Re-earn with a delta pass over just the fix instead of re-reviewing the whole feature: capture `git rev-parse HEAD` **before** committing the fix (that tip carried the green receipt), then

```
pnpm noldor cr orchestrate --slug <slug> --artifact <code-paths> --kind code --base-sha <last-green-tip>
```

(keep `--profile fast-track` when the first pass used it). It is the same `--base-sha` mechanism the autofix loop uses through its printed `base-sha:` line; the push-gate-failure path bypasses autofix, so it is prescribed here. The reviewer sees only `<last-green-tip>..HEAD`, so a mechanical fix re-earns the receipt in one cheap dispatch instead of a full-range re-review.

Recovering the green tip when it wasn't captured: only when the fix landed as a **new commit on top** is it recoverable as `git log -1 --format=%H --grep='^Noldor-Reviewed-Subagent:' origin/main..HEAD` (the receipt-carrying commit sits below the fix). Never use that grep after an amend or rebase rewrite — the rewritten commit keeps the stale trailer text in its message, so the grep returns the new HEAD itself, `<last-green-tip>..HEAD` is empty, and the prior-green gate mints a synthetic OK: a re-earned receipt whose fix was never reviewed. After a rewrite, the pre-fix sha comes from the captured value, or from the reflog — `git rev-parse HEAD@{1}` immediately after a single amend; after a rebase **onto the same base** (a reword or amend inside the branch) use the branch reflog (`git rev-parse <branch>@{1}`), because HEAD's reflog moves once per replayed commit, so `HEAD@{1}` lands on an intermediate rebase step and the delta would omit rewritten commits. After a rebase onto a MOVED `origin/main`, `<branch>@{1}` is the pre-rebase tip, and orchestrate resolves the base through `git merge-base`, which for that tip is the OLD fork point — so every lane reviews main's new commits as part of the branch. Pass the rebased twin of the last reviewed head instead (see [`worktree-discipline.md`](../../../docs/noldor/worktree-discipline.md#resuming-a-parked-or-dead-session)), or `--base-sha origin/main` to review the whole branch.

## Aggregate code-stage

```
pnpm noldor cr aggregate --slug <slug> --kind code
```

Exit 0 → context cleanup below, then back to the router's Step 4 checklist. Exit 1 → **Read now:** [`blockers.md`](blockers.md) — try the auto-fix seam, then escalate.

## Context cleanup on clean exit

Once all aggregates are green and the gate is about to enter PR flow, remove the escalation context file so stale failure context can't leak into a subsequent retry on the next feature, together with the auto-fix round ledgers, any quarantine remnant, and the series' decision stores (the green code round's receipt has already named every ruling in its `Noldor-CR-Settled:` trailers):

```
rm -f .noldor/cr/<slug>-escalation-context.md \
      .noldor/cr/autofix/<slug>-spec.json  .noldor/cr/autofix/<slug>-spec.json.bad \
      .noldor/cr/autofix/<slug>-plan.json  .noldor/cr/autofix/<slug>-plan.json.bad \
      .noldor/cr/autofix/<slug>-code.json  .noldor/cr/autofix/<slug>-code.json.bad \
      .noldor/cr/decisions/<slug>-spec.json .noldor/cr/decisions/<slug>-plan.json \
      .noldor/cr/decisions/<slug>-code.json
```

All three kinds are listed because a `full-*` session runs Step 2.5 at both `spec` and `plan` and Step 4 at `code`, so up to three ledgers and three decision stores exist; `rm -f` on an absent path is a no-op, so enumeration beats deriving the set from the session path. Nothing else ever removes a `.bad` file. Do **not** collapse this to `.noldor/cr/autofix/<slug>-*`: the directory is shared in the main workspace, so a slug that is a prefix of another (`foo` vs `foo-bar`) would cross-match and delete a sibling feature's ledger. In bash/zsh `rm -f .noldor/cr/autofix/<slug>-{spec,plan,code}.json{,.bad}` is an equivalent shorthand — brace expansion is deterministic expansion, not pattern matching — but the enumerated form above is the portable one.
