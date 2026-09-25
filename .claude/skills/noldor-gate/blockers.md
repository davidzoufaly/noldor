# /noldor-gate — blockers

Read on any red round: at Step 2.5 when the operator picks `address-blockers`, at Step 4 when the code-stage aggregate is red, and whenever tests or typecheck fail before the code-stage review (**Escalate on test-red** below).

## Spec and plan rounds (Step 2.5)

**When a split signal is live, ask which kind of addressing first.** If this round's findings include a `split-check` signal (`S1`/`S2` at `--kind spec`, `P1` at `--kind plan`), fire a second `AskUserQuestion`: `fix-in-place / split-back / back`. `fix-in-place` is the auto-fix-then-operator path below, unchanged; `split-back` is the carve described under **Split-back**; `back` returns to the continue-dialog. With no split signal in the round, skip this question and go straight to the auto-fix seam. The nesting keeps the dialog inside the four-option `AskUserQuestion` ceiling — at `kind === 'plan'` the top level is already full — and an oversized artifact *is* a blocker, so carving belongs here. Dropping `proceed-autonomous` whenever a threshold trips would instead remove an unrelated capability on a heuristic.

### The auto-fix seam — try it first, then fall back to the operator

Run `pnpm noldor cr autofix plan --slug <slug> --kind <kind>` and branch on its exit code:

- **0** (`next: reround` — auto-fix, all-mechanical) → apply the listed `M<n>` mechanical blockers yourself — each with the smallest change that resolves it, preferring to delete a claim over adding one (the `fix-rule:` line `plan` prints) — commit the fix, then `pnpm noldor cr autofix record --slug <slug> --kind <kind> --applied <n> --deferred <n> --since <the printed base-sha>`, re-run orchestrate with `--base-sha <the printed base-sha>` and loop back to this branch. (`--since` is what makes the ledger's `diffStat` cover the whole fix when scope rules split it across commits.)
- **11** (`next: apply-then-stop` — auto-fix, MIXED round) → apply the `M<n>` subset and `record` it, then **stop**. `record` is the same command as above with one difference: `--deferred` is the design count plus any mechanical blocker you left unapplied (`D<n>` + unapplied `M<n>`), never `0` — `record` derives that count from the sinks and refuses a disagreeing `--deferred` with exit 2. Then surface the applied fix diff plus the `D<n>` design blockers verbatim at the continue-dialog. Do NOT re-round — the design blocker would just be re-reported (and under `onFailure: abort` the round aborts anyway). The exit code, not the `design:` count, is what tells the two apart.
- **10** (`next: operator`, declined with a `reason:`), **2** (error), anything else (crash) → the operator takes the round: edit the artifact to the same `fix-rule:`, then apply the **bounded re-round rule** below to decide whether the fix loops back to the top of Step 2.5 (lint → commit the fix → re-pick lanes) or proceeds as addressed with no re-dispatch. Surface the printed `reason:` so the operator knows why the seam declined (`knob-off` / `lanes-in-flight` / `stale-round` / `prior-deferred` / `round-cap` / `no-progress` / `no-mechanical` / `no-base-sha`). `prior-deferred` means the previous round left a blocker unapplied, so the seam refuses to re-round it into a false green — the operator takes it from here. `lanes-in-flight` means a lane is still writing its sink (`in-flight lanes:` names them) — drain it with `pnpm noldor cr aggregate --slug <slug> --wait-ms <ms>` and re-run `plan` rather than treating it as a real decline. `stale-round` means the sinks describe a tree the checkout has moved past, so the blocker set is obsolete rather than merely provisional — re-run `pnpm noldor cr orchestrate --kind <kind>` to review the current tree, or, where the round cap refuses that, arbitrate the round; never apply the listed fixes, since the code may already carry them.
- **Any non-zero from `record` stops the loop** and falls to the same operator branch. An unrecorded round is invisible to the round cap *and* leaves the next fingerprint without a predecessor, so continuing would rest the whole loop bound on `record` having silently succeeded.

The seam is off unless `.noldor/config.json` sets `autonomous.onBlockers: 'auto-fix'` (default `prompt` → `plan` exits 10 with `knob-off`), and it is bounded at 2 rounds per gate session plus a no-progress stop. Orchestrate's `guardLaneOverwrite` prompts overwrite / archive-and-overwrite / keep-and-skip per existing sink; in-flight standalone trips a separate `wait / kill-and-respawn / continue-without-lane` guard.

### Bounded re-round rule (every operator-driven round)

The auto-fix seam is bounded in code (`AUTOFIX_ROUND_CAP` in [`src/cr/autofix-ledger.ts`](../../../src/cr/autofix-ledger.ts)); the operator loop needs the same bound, because an unbounded loop feeds itself — every fix is fresh prose surface, so a delta review of it near-guarantees a new finding. Two rules terminate the loop:

- **Only `[design]` blockers trigger a re-round.** Partition the round's blockers by the reviewer's class tag (`[mechanical]` / `[design]`; an untagged blocker reads as `design` — the same fail-safe read the autofix seam applies). A round with ≥1 design blocker earns one re-round after the operator arbitrates it: the judgment call changed the artifact, so the change gets reviewed (re-run orchestrate with `--base-sha` as `artifact-review.md` describes; mechanical fixes from the same round ride that re-round rather than earning their own). An all-mechanical round is fix-and-proceed: apply the fixes, commit, and treat the artifact as explicitly-addressed at the continue-dialog — no re-dispatch. The next stage reviews those fixes anyway (the plan-stage pass for a spec fix; the code-stage CR's `origin/main..HEAD` range for a plan fix), so a fix-seeded regression cannot reach `main` unreviewed. A design blocker the operator rejects rather than applies is also explicitly-addressed and earns no re-round of its own. Record the ruling — only on the operator's word — with `pnpm noldor cr arbitration dispose --slug <slug> --kind <kind> --blocker <id> --disposition rejected --note "<why>"` (without `--blocker` it lists the ids): no later round of the session hands that finding to a lane as a prior while the lines it cites are unchanged, and every lane is shown the ruling (see cr-pipeline.md → Rulings before the cap). At the spec stage, also record the ruling in the spec itself — Non-goals for a requirement scoped out, Risks / trade-offs for an accepted risk, Open questions (resolved) for a design choice — so every lane of any later round reads it: a spec finding that re-argues a recorded ruling has no basis and does not block (see cr-pipeline.md → Spec-stage blocking). An unchanged artifact has nothing new to review.
- **Hard cap: 2 re-rounds per artifact kind per gate session**, auto-fix and operator rounds combined (`AUTOFIX_ROUND_CAP = 2`; with the initial pass that is 3 total rounds — cr-pipeline.md → Round budget records why three). **Enforced in code, both halves.** `cr orchestrate` appends a ledger entry for every round it resolves and refuses to dispatch past the cap (exit 3), printing the round history and the remedy; the auto-fix seam reads that same ledger, so the two draw from one budget. Only RED rounds count — a green dispatch arbitrates nothing, and a session re-mints its `HEAD^{tree}`-bound receipt after every fix commit, so those finding-nothing rounds must stay free. Past the cap a commit that changes `HEAD` earns exactly ONE closing round: green mints the receipt and the session ships, red refuses everything after. At the cap, no further dispatch. Batch every remaining blocker into ONE operator decision — `fix-and-proceed` (apply what is worth applying; addressed, not re-reviewed) or `abort` — instead of arbitrating round-by-round. A `[med]` wording nit and a design flaw no longer cost the same loop iteration; the tail collapses into a single choice.

### Split-back

The `address-blockers` → `split-back` branch. The artifact is oversized, not merely flawed: the remedy is to move scope out rather than to edit prose. This is a *bounce* to the phase that owns splits — `/noldor-promote` step 1.7 — but it is non-destructive: the FD, the session marker and the worktree all survive, and no promotion is unwound. See [complexity-gating.md → Which phase owns the split](../../../docs/noldor/complexity-gating.md#which-phase-owns-the-split).

1. Operator names the scope that leaves.
2. Write sibling roadmap blocks per the **sibling-emission recipe** in [`/noldor-promote`](../noldor-promote/SKILL.md) step 1.7 — minted `- id:` first, then `- area:` / `- type:` / `- since:` / `- size:` / `- impact:`, with `- split-from: <entry-id>` read from the FD's `entry-id:` frontmatter. No source block is removed here (there is none — it was retired at promote), so `remove-block --split-into` does not apply.
3. Narrow the artifact to slice 1 on disk.
4. Commit the narrowed artifact and the roadmap blocks as a **follow-up commit — never an amend.** The artifact commit carries no review receipt at this stage, but an amend still moves the tree under any lane sink already written; a follow-up keeps those sinks' base valid and lets a re-round use `--base-sha`.
5. Re-run `pnpm noldor noldor split-check --<kind> <artifact-path>` and **report the result — it does not gate.** Return to the continue-dialog.

Step 5 is advisory deliberately. Enforcing a clean re-run would make this the framework's second hard stop on an operator-present surface (the headless drain is the only one), and combined with the cap it could wedge a session: at the cap with the signal still tripping, neither `proceed` nor another carve would be legal. **`proceed` stays available at every point**, cap or no cap. An operator who has carved twice and still trips a threshold has a judgment call, not a locked door.

A `split-back` counts as an operator re-round against the cap — it is not exempt, because an unbounded carve loop is the same self-feeding failure the cap exists to stop.

## Code-stage rounds (Step 4)

**Auto-fix mechanical blockers (before escalating).** Same pair as the spec and plan rounds, same branching:

```
pnpm noldor cr autofix plan --slug <slug> --kind code
```

- **0** (`next: reround`) → apply the listed `M<n>` blockers to the `fix-rule:` line, commit, `pnpm noldor cr autofix record --slug <slug> --kind code --applied <n> --deferred <n> --since <the printed base-sha>`, then re-run the code-stage orchestrate with `--base-sha <the printed base-sha>` (that re-run is what re-earns the `Noldor-Reviewed-Subagent` receipt — orchestrate only amends it on a green reviewer run) and re-aggregate.
- **11** (`next: apply-then-stop`) → apply + `record` the `M<n>` subset (`--deferred` = `D<n>` count + unapplied `M<n>`, as above), then stop looping and **escalate** on the `D<n>` design blockers below.
- **any other non-zero** (from `plan` or from `record`) → capture stderr/findings to a temp file and **escalate** exactly as below. On `reason: lanes-in-flight` prefer draining the lane first (`pnpm noldor cr aggregate --slug <slug> --wait-ms <ms>`) and re-running `plan`.

Off by default (`autonomous.onBlockers`, as above), bounded at 2 rounds per session plus a no-progress stop.

**Escalate on cr-red.**

```
pnpm noldor cr escalate --slug <slug> --reason cr-red --context-file <stderr-path>
```

CLI prompts the operator interactively (`retry-implementation / spawn-deep-review / override-with-trailer / abort`); add `--autonomous` to use the config default from `autonomous.onFailure` (`abort` / `spawn-deep-review` / `prompt`). Exit codes drive the next step:

- **0** (`spawned` / `override`) → deep-review was spawned in a fresh iTerm2 window (via `lanes/standalone.ts`) OR the operator chose `override-with-trailer`. Proceed to PR flow.
- **1** (`abort`) → full halt. Operator manually salvages.
- **10** (`retry-implementation`) → loop back to Step 3 (implementation). Append `## Findings to address` to the plan MD using the content from `.noldor/cr/<slug>-escalation-context.md` so the next implementation pass has the failure context inline.

**Escalate on test-red.** Same CLI, different reason — invoked earlier in the flow when the verification step (test pass before CR) fails:

```
pnpm noldor cr escalate --slug <slug> --reason test-red --context-file <test-output>
```

**Autonomous mode:** same `--autonomous` flag + `autonomous.onFailure` semantics as cr-red, and the same exit-code semantics.
