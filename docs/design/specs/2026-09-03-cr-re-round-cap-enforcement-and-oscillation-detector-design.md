# CR Re-Round Cap Enforcement and Oscillation Detector — Design

**Slug:** cr-re-round-cap-enforcement-and-oscillation-detector
**FD:** docs/features/cr-re-round-cap-enforcement-and-oscillation-detector.md
**Date:** 2026-09-03
**Tier:** specs-only
**Deps:** none

## Problem

The re-round cap that `/noldor-gate` describes — two re-rounds per artifact kind per gate session — is enforced in one half of the loop and merely asserted in the other. `AUTOFIX_ROUND_CAP` in [`src/cr/autofix-ledger.ts`](../../../src/cr/autofix-ledger.ts) is a real bound: `decide` in [`src/cr/autofix.ts`](../../../src/cr/autofix.ts) declines with `round-cap` once the ledger holds two rounds. But only `cr autofix record` ever writes that ledger. An operator-driven round writes nothing, [`src/cr/orchestrate.ts`](../../../src/cr/orchestrate.ts) holds no round counter and never reads the ledger, and so the combined bound is prose in a skill file. Prose does not survive a context compaction, a runner swap, or an agent that reads a cap as advice.

The cost is visible in this repo's own history. Of 41 unique `Noldor-Path-Override` trailers across all branches, **23 name a CR round or convergence failure** — the majority use of the override is this one case. The reasons read as a catalogue of a single shape: *eight code-stage CR rounds without convergence*; *rounds 5-8 only found defects in prior rounds fixes*; *12 rounds — codex oscillating against its own round-4 demands*; *operator-waived review receipt at the CR re-round cap after 3 rounds and 23 fixed findings*.

Grounding the roadmap entry against the code turned up one fact that reshapes the design, and it is worth stating before any unit. **The re-flags of documented `noldor:cut` sites have a plain cause, not a detector-shaped one.** The reviewer lane is told about cut markers: `CUT_MARKER_GUIDE` in [`src/cr/lanes/subagent-dispatch.ts`](../../../src/cr/lanes/subagent-dispatch.ts) is injected whenever the active profile carries one of the four ladder dimensions. The codex lane is told nothing. Its prompt is built two modules away in [`src/cr/run-codex.ts`](../../../src/cr/run-codex.ts), carries no dimension list, no class tags and no cut guide, and its rules come from `.claude/engineering-rules.md` or `AGENTS.md` rather than the `.noldor/rules/` cascade — so `lazy-decision-ladder.md`, which defines the marker grammar, never reaches it. Codex was re-flagging cut sites five times in one review because nobody had ever told it that a marked cut is a decision. That is a prompt fix, and it accounts for five of the twelve wasted rounds in the incident the entry cites.

Underneath sits an arithmetic gap that any cap has to answer, and it is the reason a naive hard stop would be worse than the prose one. The cap bounds *arbitration* rounds. The `Noldor-Reviewed-Subagent` receipt is bound to `HEAD^{tree}` and amended by orchestrate only on a green round, so the commit that fixes the last round's blocker strips it — [`docs/noldor/cr-pipeline.md`](../../noldor/cr-pipeline.md) records that this costs a whole extra dispatch purely to re-mint the receipt. A cap that counted dispatches would refuse exactly that dispatch and wedge every session that reached it.

## Goals

- Count every arbitration round for a `(slug, kind)` pair at the orchestrate layer, auto-fix and operator alike, so the cap is code rather than prose.
- Refuse to dispatch past the cap, and terminate in a printed round history that names the remedy rather than in silence.
- Close the codex cut-marker gap directly.
- Leave every converging path untouched. A round that goes green in one or two passes must see no new behaviour, and a receipt re-earn must never be refused.

## Non-goals

- The re-flag detector, locatable findings, the `noldor:cut` code scanner and the arbitration record. Carved to **Q-0209** during this dialogue; see Scope.
- Making the reviewer converge. Nothing here changes review quality or effort; the findings in the non-convergent runs were real.
- Rounds of the `verify`, `ui-reviewer` and `render-compare` lanes. A round is one orchestrate invocation, not one lane.
- A validator for the `// noldor:cut` code-comment grammar.

## Design

### Structural context

Read via `pnpm noldor design graph-context` over the anchor files; the committed graph reports `fresh`. The `graph.brainstorm-summary.toon` digest is older than the graph, so the per-path digest is the source rather than the summary file.

The two units land in two communities that are only weakly joined, and that seam governs where state lives.

- **`src/cr/autofix-ledger.ts` and `src/cr/aggregate.ts` sit together in community `c5`**, with `src/cr/autofix.ts`, `src/cr/autofix-cli.ts` and their tests. This is the round-accounting neighbourhood. Its cross-community edges run only to `findings-schema.ts` and `atomic-write.ts` in `c19` and `slug-paths.ts` in `c78` — schema and persistence, nothing that decides policy.
- **`src/cr/orchestrate.ts` sits in `c29`**, with `src/core/config.ts`, `src/core/lanes.ts` and `src/cr/escalate-cli.ts` — lane resolution, dispatch, the receipt amend.

No god node appears in either digest, and neither file is a hub; each is interior to its own community, which is itself the finding. The consequence is direct: the round counter must be *written* where round state already lives (`c5`) and *read* where rounds are dispatched (`c29`), and the only existing bridge is the shared schema module in `c19`. Extending the ledger therefore beats minting a second store inside orchestrate, which would open a new cross-community write edge for state `c5` already owns.

Unit 1 touches `src/cr/run-codex.ts`, which the digest did not resolve as a distinct community member; the graph shows it inside the codex-lane neighbourhood reached from `orchestrate.ts` via `codex.ts`. Nothing about that edge constrains the change — it is prompt text, not structure.

### Unit 1 — give codex the cut-marker contract

`formatPrompt` in `run-codex.ts` gains the same `CUT_MARKER_GUIDE` text the reviewer receives, and its rules source changes to the `.noldor/rules/` cascade so `lazy-decision-ladder.md` reaches it. The guide's carve-outs come along unchanged: a marker never waives a finding about a defect, a vulnerability, a race, an unintended state change, an accessibility regression, or explicitly-requested behaviour that was cut.

The guide is one string with two consumers, so it moves to a shared home rather than being duplicated. `CUT_MARKER_TOKEN` in `subagent-dispatch.ts` and `CUT_MARKER` in [`src/core/structural-context-contract.ts`](../../../src/core/structural-context-contract.ts) are already two independent literals for one contract, tied together only by a test assertion; this unit must not add a third.

The reviewer injects the guide conditionally, gated on the profile carrying one of the four ladder dimensions. Codex has no profile and no dimension list, so its injection is unconditional. That asymmetry is deliberate and belongs in a comment: a conditional gate needs a condition to read, and codex has none.

This unit is independently shippable and nothing else here depends on it.

### Unit 2 — the ledger counts every arbitration round

The ledger at `.noldor/cr/autofix/<slug>-<kind>.json` widens from auto-fix rounds to all arbitration rounds. `AutofixRound` gains an `origin` of `autofix` or `operator`, and orchestrate appends an entry itself, so a round counts because it ran rather than because a controller remembered it.

**What counts.** A dispatch is an arbitration round when there is no prior round for the pair (the initial pass) or when the immediately-prior round was red. A dispatch whose prior round was **green** is a receipt re-earn over an already-reviewed tree — the tree moved only because a fix commit stripped the `HEAD^{tree}` trailer — and does not count. This is the answer to the arithmetic gap above, and it needs no new state: orchestrate already reads the prior sink for the delta short-circuit and already has `priorSinkIsGreen`. A cap that counted dispatches instead would refuse the one dispatch every capped-and-then-fixed session needs.

**When it is written.** After the round resolves, with the real `fingerprintBlockers` hash over that round's blockers. `AutofixRound.fingerprint` is a non-empty string by schema and the blockers do not exist at dispatch time, so a dispatch-time write would need either a placeholder — which poisons the seam's no-progress rule, since that rule hashes the same field — or a two-phase write leaving a half-entry to reason about after a kill. A lane that crashes or times out therefore writes nothing and stays retryable, which is right: an infra failure produced no arbitration.

**One shared budget.** `decide` keeps reading the whole ledger, so operator rounds count against `AUTOFIX_ROUND_CAP` and the auto-fix seam declines earlier than it does today. That is the feature rather than a side effect — the seam and the operator drawing from one budget is exactly the combined bound the gate prose describes and cannot enforce. `decide`'s first-match-wins rule order is untouched.

**At the cap**, orchestrate refuses to dispatch, prints the round history and names the existing remedy: amend `Noldor-Path-Override` on the tip. That override is already the de-facto exit for this case in 23 of 41 commits; pointing at it adds enforcement without minting a new gate surface in a slice that deliberately carved out the receipt work, and the printed history makes the override informed rather than blind. Orchestrate's exit code is 0 or 1 today, so the cap takes a third value.

**Session scoping needs care.** `readLedger` returns `null` for a different session and `appendRound` then *replaces* the series. That is correct for the seam and stays correct here, but orchestrate must resolve the same session key the seam does — `readSession(cwd)?.startedAt ?? ''` — or a mixed session would silently reset its own count.

Everything else about the file is unchanged: same directory (deliberately a subdirectory so `aggregate`'s sink scan cannot mistake a ledger for a lane sink), same `writeJsonAtomic`, same `.bad` quarantine on a parse failure, same `slugPath` guarding.

### Scope

Grounding the entry turned up six units — the two above plus locatable findings, a `noldor:cut` code scanner, the re-flag detector and an arbitration record. Six units with a `Finding` schema change is `L` work under an `M` label, so the rest is carved to roadmap entry **Q-0209** (`split-from: Q-0170`, `blocked-by: Q-0170`), which carries the detector and the receipt answer on top of this counter. The two kept units need no schema change, no new scanner and no receipt path, and between them they address the majority of the waste on record. Keeping the contentious receipt question here would hold both cheap wins hostage to it.

### Error handling

Both units fail **open**, toward today's behaviour. An unreadable or corrupt ledger, a `LedgerParseError`, a failed session read — each degrades to no count and no cap enforcement for that round, logging the reason. A cap firing on bad data would refuse a round the operator needs with no way past it; a missed cap costs one dispatch, a false cap costs the ship.

The headless drain inherits this without special-casing. Under `onFailure: abort` a cap refusal fails the iteration, and the supervisor's retry-then-skip surfaces it on the escalation channel — which is correct, since no headless child can type an override.

### Testing

Deletion Test throughout: each unit's test fails if the unit is deleted.

Unit 1 asserts the codex prompt carries the cut-marker contract, pinned against the rule file the way `subagent-dispatch.test.ts` already pins the reviewer half, plus a test that the guide has exactly one definition. Unit 2 covers a round dispatched by orchestrate landing in the ledger with no seam involvement; auto-fix and operator rounds counting together; a dispatch after a green round not counting; the refusal at the cap with its exit code and printed history; and a corrupt ledger leaving dispatch, aggregate and receipt behaviour unchanged.

## Acceptance criteria

1. The codex lane's prompt carries the cut-marker contract, and the contract text has a single definition shared with the reviewer lane.
2. The codex lane resolves its rules from the `.noldor/rules/` cascade, so `lazy-decision-ladder.md` reaches it.
3. A round dispatched by `cr orchestrate` is recorded in the ledger for its `(slug, kind)` pair whether or not the auto-fix seam ran.
4. A session that ran one auto-fix round and one operator round reports two rounds.
5. A dispatch whose immediately-prior round was green is not counted as a round.
6. A dispatch with no prior round, or whose prior round was red, is counted as a round.
7. A round that crashes or times out records no ledger entry.
8. Once the ledger holds `AUTOFIX_ROUND_CAP` arbitration rounds for the pair, `cr orchestrate` refuses to dispatch and exits with a distinct documented code.
9. That refusal prints the round history and names the `Noldor-Path-Override` remedy.
10. The auto-fix seam's `decide` counts operator rounds against the same cap.
11. A ledger written under a different session key does not count toward this session's cap.
12. A corrupt, unreadable or absent ledger leaves dispatch, aggregate and receipt behaviour exactly as today.

## Risks / trade-offs

**The shared budget changes existing auto-fix behaviour.** A session that runs an operator round first will find the seam declining `round-cap` sooner than it does today. That is intended, but it is a live behaviour change for anyone relying on the seam's current budget, and it should be called out in the release notes rather than discovered.

**The green-prior-round exemption can be gamed by accident.** A round that goes green, then a fix, then a red round, then another fix, alternates between counting and not counting. The alternation is bounded in practice because a green round ends the session, but a pathological sequence could stretch the budget. Accepted: the exemption's purpose is to never wedge a legitimate re-earn, and over-permitting is the safe direction for a first enforcement pass.

**A cap that refuses is a new failure mode in a hot path.** Every mitigation here is fail-open, but fail-open on a *counter* means the cap silently does nothing when the ledger is unreadable. That is the deliberate trade: an unenforced cap is today's status quo, while a falsely-enforced one is a locked door.

**Unifying the cut-marker guide touches the reviewer prompt.** Moving the string to a shared home changes a file whose exact text is pinned by a test against the rule store. The move must keep that assertion meaningful rather than making it assert against itself.

## User Story

As an agent or operator running code review through `/noldor-gate`, I want the re-round cap counted and enforced in code, and the codex lane told that a documented cut is a decision, so that a review loop stops at a budget it actually has instead of running twelve rounds and closing with a hand-typed override.

## Usage

```
# Ordinary orchestrate — unchanged while the round budget lasts
pnpm noldor cr orchestrate --slug <slug> --artifact . --kind code --base-sha origin/main

# At the cap it refuses, prints the history, and names the remedy:
#   round 3/3 for (<slug>, code) — cap reached
#   1  autofix   3 applied, 1 deferred  <sha>
#   2  operator  2 applied, 0 deferred  <sha>
#   To close: fix and re-review, or record the arbitration:
#     git commit --amend --no-edit --trailer "Noldor-Path-Override: <why>"

# A dispatch after a green round is a receipt re-earn and does not count
pnpm noldor cr orchestrate --slug <slug> --artifact . --kind code --base-sha <last-green-tip>
```

## Open questions (resolved)

1. *Is this one spec or two?*
   -> **Two.** (D1) The detector, locatable findings, the code-comment scanner and the arbitration record are carved to Q-0209. Six units with a schema change is `L` work under an `M` label, and the contentious receipt question would otherwise hold the two cheap wins hostage.

2. *What does orchestrate do at the cap, now that the arbitration record is carved out?*
   -> **Refuse, print the round history, and name the existing `Noldor-Path-Override` remedy.** (D2) It is already the de-facto exit in 23 of 41 commits, so pointing at it adds enforcement without a new gate surface, and the printed history makes the override informed rather than blind.

3. *What counts as a round, given a capped session still needs a dispatch to re-earn its receipt?*
   -> **Only a dispatch that arbitrates unresolved blockers: no prior round, or a red prior round.** (D3) A green prior round means the tree moved by a fix commit alone, which is a receipt re-earn. Counting dispatches would refuse it and wedge every capped session.

4. *When does orchestrate write the round entry?*
   -> **After the round resolves, with the real fingerprint.** (D4) The fingerprint hashes blockers that do not exist at dispatch time; a placeholder would poison the seam's no-progress rule, which reads the same field. A crashed round writes nothing and stays retryable.

5. *Should `decide` see operator rounds?*
   -> **Yes — one shared budget.** (D5) The seam and the operator drawing from one count is the combined bound the gate prose describes and cannot enforce. A second constant would re-create the two-number split this entry exists to close.

6. *Is `AUTOFIX_ROUND_CAP = 2` still the right budget once operator rounds share it?*
   -> **Keep 2, and revisit only with evidence.** (D6) Two recorded arbitration rounds plus the initial pass is three dispatches, which the gate prose already calls the span that caught every real design flaw on record. The constant is pinned by a test, so a change is a visible one-line diff rather than a silent drift.
