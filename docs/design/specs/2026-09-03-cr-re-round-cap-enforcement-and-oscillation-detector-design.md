# CR Re-Round Cap Enforcement and Oscillation Detector — Design

**Slug:** cr-re-round-cap-enforcement-and-oscillation-detector
**FD:** docs/features/cr-re-round-cap-enforcement-and-oscillation-detector.md
**Date:** 2026-09-03
**Tier:** specs-only
**Deps:** none

## Problem

The re-round cap that `/noldor-gate` describes — two re-rounds per artifact kind per gate session — is enforced in one half of the loop and merely asserted in the other. `AUTOFIX_ROUND_CAP` in [`src/cr/autofix-ledger.ts`](../../../src/cr/autofix-ledger.ts) is a real bound: `decide` in [`src/cr/autofix.ts`](../../../src/cr/autofix.ts) declines with `round-cap` once the ledger holds two rounds. But only `cr autofix record` ever writes that ledger. An operator-driven round writes nothing, [`src/cr/orchestrate.ts`](../../../src/cr/orchestrate.ts) holds no round counter and never reads the ledger, and so the combined bound is prose in a skill file. Prose does not survive a context compaction, a runner swap, or an agent that reads a cap as advice.

The cost is visible in this repo's own history. Of 41 unique `Noldor-Path-Override` trailers across all branches, **23 name a CR round or convergence failure** — the majority use of the override is this one case. The reasons read as a catalogue of a single shape: *eight code-stage CR rounds without convergence*; *rounds 5-8 only found defects in prior rounds fixes*; *12 rounds — codex oscillating against its own round-4 demands*; *operator-waived review receipt at the CR re-round cap after 3 rounds and 23 fixed findings*.

Grounding the roadmap entry against the code turned up one fact that reshapes the design. **The re-flags of documented `noldor:cut` sites have a plain cause, not a detector-shaped one.** The reviewer lane is told about cut markers: `CUT_MARKER_GUIDE` in [`src/cr/lanes/subagent-dispatch.ts`](../../../src/cr/lanes/subagent-dispatch.ts) is injected whenever the active profile carries one of the four ladder dimensions. The codex lane is told nothing — its prompt is built two modules away in [`src/cr/run-codex.ts`](../../../src/cr/run-codex.ts) and carries no dimension list, no class tags and no cut guide. Codex was re-flagging cut sites five times in one review because nobody had ever told it that a marked cut is a decision. That is a prompt fix, and it accounts for five of the twelve wasted rounds in the incident the entry cites.

Underneath sits an arithmetic gap that any cap has to answer, and it is the reason a naive hard stop would be worse than the prose one. The cap bounds *arbitration*. The `Noldor-Reviewed-Subagent` receipt is bound to `HEAD^{tree}` and amended by orchestrate only on a green round, so the commit that fixes the last round's blocker strips it. [`docs/noldor/cr-pipeline.md`](../../noldor/cr-pipeline.md) records the concrete shape from Q-0158: the final round came back red, the operator fixed it, and a fourth dispatch that found nothing ran purely to mint a receipt on the new tip. A cap that counted dispatches would refuse exactly that dispatch and wedge the session.

## Goals

- Count every re-round for a `(slug, kind)` pair at the orchestrate layer, auto-fix and operator alike, so the cap is code rather than prose.
- Refuse to dispatch past the cap, and terminate in a printed round history that names the remedy rather than in silence.
- Never wedge a session that has fixed its last blockers and needs one dispatch to re-mint its receipt.
- Close the codex cut-marker gap.
- Leave every converging path untouched. A round that goes green in one or two passes must see no new behaviour, and the auto-fix seam must not decline on state this feature introduced.

## Non-goals

- The re-flag detector, locatable findings, the `noldor:cut` code scanner and the machine-readable arbitration record. Carved to **Q-0209**, which attaches to this same FD; see Scope.
- Changing what the codex lane reads as *rules*. `readRules` in [`src/cr/review-with-codex.ts`](../../../src/cr/review-with-codex.ts) falls back to `AGENTS.md` for codex-only consumer trees with no `.claude/`, so routing it through the `.noldor/rules/` cascade is its own decision with its own compatibility question. Recorded as a follow-up, not smuggled in here; the cut-marker contract reaches codex as prompt text instead.
- Making the reviewer converge. Nothing here changes review quality or effort; the findings in the non-convergent runs were real.
- Rounds of individual lanes. A round is one `cr orchestrate` invocation, not one lane.

## Design

### Structural context

Read via `pnpm noldor design graph-context` over the anchor files; the committed graph reports `fresh`. The `graph.brainstorm-summary.toon` digest is older than the graph, so the per-path digest is the source rather than the summary file.

The two units land in two communities that are only weakly joined, and that seam governs where state lives.

- **`src/cr/autofix-ledger.ts` and `src/cr/aggregate.ts` sit together in community `c5`**, with `src/cr/autofix.ts`, `src/cr/autofix-cli.ts` and their tests. This is the round-accounting neighbourhood. Its cross-community edges run only to `findings-schema.ts` and `atomic-write.ts` in `c19` and `slug-paths.ts` in `c78` — schema and persistence, nothing that decides policy.
- **`src/cr/orchestrate.ts` sits in `c29`**, with `src/core/config.ts`, `src/core/lanes.ts` and `src/cr/escalate-cli.ts` — lane resolution, dispatch, the receipt amend.

No god node appears in either digest, and neither file is a hub; each is interior to its own community, which is itself the finding. The consequence is direct: the round counter must be *written* where round state already lives (`c5`) and *read* where rounds are dispatched (`c29`), and the only existing bridge is the shared schema module in `c19`. Extending the ledger therefore beats minting a second store inside orchestrate, which would open a new cross-community write edge for state `c5` already owns. It also means the cap predicate belongs in `c5` beside `isSameSeries` and is *called* from `c29`, rather than being re-derived in orchestrate — the drift `isSameSeries` already exists to prevent.

Unit 1 touches `run-codex.ts`, which the digest places in the codex-lane neighbourhood reached from `orchestrate.ts` via `codex.ts`. Nothing about that edge constrains the change: it is prompt text, not structure.

### Unit 1 — give codex the cut-marker contract

The cut-marker guide moves to a shared module and both lanes read it from there. Today `CUT_MARKER_TOKEN` in `subagent-dispatch.ts` and `CUT_MARKER` in [`src/core/structural-context-contract.ts`](../../../src/core/structural-context-contract.ts) are two independent literals for one contract, tied together only by a test assertion against the rule store; this unit must collapse that to one definition rather than adding a third.

`formatPrompt` in `run-codex.ts` then injects that guide, with its carve-outs unchanged: a marker never waives a finding about a defect, a vulnerability, a race, an unintended state change, an accessibility regression, or explicitly-requested behaviour that was cut.

The reviewer injects the guide conditionally, gated on the profile carrying one of the four ladder dimensions. Codex has no profile and no dimension list, so its injection is unconditional. The asymmetry is deliberate and belongs in a comment: a conditional gate needs a condition to read, and codex has none.

Authority is unambiguous after this change. `.noldor/rules/lazy-decision-ladder.md` remains the author-side prose that tells a human writing code what a cut means; the shared guide is the reviewer-side text that tells a review lane how to treat one. The existing test that pins the guide against the rule file keeps its meaning, because it still compares two independently maintained artifacts. Codex receives the guide and does not additionally receive the rule file, so there is no path by which it can see two divergent statements of the contract.

This unit is independently shippable and nothing else here depends on it.

### Unit 2 — the ledger counts every re-round

The ledger at `.noldor/cr/autofix/<slug>-<kind>.json` widens from auto-fix rounds to all re-rounds, and orchestrate becomes its second writer.

**A recorded round is a re-round, never the initial pass.** This is what keeps one number in play. `cr autofix record` today writes only after a fix, so every entry it has ever written is already a re-round, and `decide`'s `priorRounds.length >= AUTOFIX_ROUND_CAP` already means "two re-rounds spent". Orchestrate adopts the same rule: a dispatch with no prior round for the pair is the initial pass and records nothing. `AUTOFIX_ROUND_CAP` stays at 2, the budget stays at two re-rounds plus the initial pass, and the printed counter reads `n/3` in dispatch terms only because the initial pass is the unrecorded first — the ledger itself never holds more than 2.

**The closing round is what prevents the wedge.** The receipt case on record is *red final round → operator fixes → one dispatch that finds nothing*. A rule that exempted a dispatch after a **green** round would not fire there at all, because the prior round was red. So the exemption is not about greenness: **once the cap is reached, exactly one further dispatch is permitted, and it is terminal.** It is recorded with `stopped: 'closing-round'`. Green, and orchestrate amends the receipt as it always does and the session ships. Red, and no further dispatch is offered — the override is the only remaining exit. One closing round is enough because the operator has already fixed everything they intend to fix; a second would be a new arbitration, which is precisely what the cap refuses.

**Write ownership is exclusive, decided by which command ran.** `cr autofix record` keeps writing the auto-fix round it applies, tagged `origin: 'autofix'`. Orchestrate writes only for a round the seam did not record — it appends `origin: 'operator'` after the round resolves, and skips the append when the ledger's last entry already names this round's `headSha` and fingerprint. That is the deduplication rule, and it makes an auto-fix round followed by its orchestrate re-run one entry rather than two, which is what "one auto-fix round and one operator round reports two rounds" requires.

**Fields.** `origin` is optional in the schema with a default of `'autofix'`, so every ledger written before this change parses unchanged and no existing series is quarantined or reset. `applied`, `deferred` and `diffStat` become optional too, because orchestrate applies nothing and cannot know what an operator applied — it omits them rather than writing a zero that would falsify a guard.

**`decide` reads the ledger by rule, not wholesale.** Only the cap rule counts every entry; that shared budget is the whole point. The other two ledger-reading rules filter to `origin: 'autofix'`, and both filters are load-bearing:

- `prior-deferred` fires on a non-zero `deferred`. An operator entry carries none, so without the filter the rule would read `undefined` and the seam's guard would rest on an absent field.
- `no-progress` compares this round's blocker fingerprint against prior entries. `runPlan` in [`src/cr/autofix-cli.ts`](../../../src/cr/autofix-cli.ts) recomputes that fingerprint over the *same sinks* orchestrate just hashed, so an unfiltered rule would match orchestrate's own entry on the very first round and decline `no-progress` every time — the seam would never run again. The filter is not a refinement; without it this feature disables the auto-fix path entirely.

**Reading "was the prior round red" needs a real read.** `priorSinkIsGreen` in `orchestrate.ts` is a per-lane predicate reached only inside the empty-diff branch, so it cannot answer a question about the round as a whole. Orchestrate instead records each round's verdict on the ledger entry as it writes it, and reads that back. State it once, at the point that already knows it.

**Session scoping.** `readLedger` returns `null` for a different session and `appendRound` then replaces the series, which is correct and stays. Orchestrate must key on the same value the seam does. That expression is `sessionKey` in `autofix-cli.ts`, a private helper today; it moves beside `isSameSeries` in the ledger module and both callers import it, rather than being re-derived inline. Its `?? ''` fallback is not carried over: a run with no session marker has no gate session to bound, so the cap is **inert** for it rather than sharing one global empty-key bucket across every sessionless invocation forever.

**Concurrency.** The cap is checked before dispatch and the entry appended after, so two concurrent orchestrates on the same pair could both see budget. In practice they do not exist: parallel drain assigns each child a distinct slug and the ledger is keyed per `(slug, kind)`. Recorded as `noldor:cut single writer per (slug, kind) — parallel drain gives each child its own slug; revisit if two agents ever review one pair concurrently, at which point the RMW needs a lock rather than a tighter check`.

Everything else about the file is unchanged: same directory (deliberately a subdirectory so `aggregate`'s sink scan cannot mistake a ledger for a lane sink), same `writeJsonAtomic`, same `.bad` quarantine on a parse failure, same `slugPath` guarding.

### Unit 3 — the prose this replaces

Three documents assert the behaviour this feature changes and must move with it, or the repo ships contradicting itself.

`.claude/skills/noldor-gate/SKILL.md` instructs the controller to track operator rounds in chat and calls the combined bound "controller-enforced prose, not code" — both become false. `docs/noldor/cr-pipeline.md` describes the two exits at a red cap round and the extra dispatch needed to re-earn a receipt; the closing round changes that runbook. `docs/noldor/script-catalog.md` documents orchestrate's exit codes and the `n/2` round counter. A `docs/noldor/**` change also needs a `Noldor-Sibling-Scope` trailer, and every one of these files has a twin under `templates/` that must be mirrored or doctor-drift reds.

### Scope

Grounding the entry turned up six units — the two above plus locatable findings, a `noldor:cut` code scanner, the re-flag detector and an arbitration record. Six units with a `Finding` schema change is `L` work under an `M` label, so the rest is carved to roadmap entry **Q-0209** (`split-from: Q-0170`, `blocked-by: Q-0170`), which attaches to this same FD so the feature's name stays honest about what it will eventually cover. The two kept units need no schema change to `Finding`, no new scanner and no receipt path, and between them they address the majority of the waste on record.

### Error handling

The cap fails **open**, toward today's behaviour. An unreadable or corrupt ledger, a `LedgerParseError`, an absent session marker — each degrades to no count and no enforcement for that round, logging the reason. A cap firing on bad data would refuse a round the operator needs with no way past it; a missed cap costs one dispatch, a false cap costs the ship.

The append fails open in the same direction and for the same reason. A failed write, or a process killed after the round resolved but before the append, loses that round from the count. Both are logged, and neither changes the round's own result — a review that ran and produced findings must report them whether or not its bookkeeping landed. The honest consequence is that the cap under-counts rather than over-counts, which is the safe error for a first enforcement pass.

The headless drain inherits all of this without special-casing. Under `onFailure: abort` a cap refusal fails the iteration and the supervisor's retry-then-skip surfaces it on the escalation channel, which is correct: no headless child can type an override.

### Testing

Deletion Test throughout: each unit's test fails if the unit is deleted.

Unit 1 asserts the codex prompt carries the cut-marker contract, that the contract text has exactly one definition, and that the existing rule-store pin still compares two independently maintained artifacts.

Unit 2 covers the initial pass recording nothing; a re-round dispatched by orchestrate landing in the ledger with no seam involvement; an auto-fix round plus an operator round counting as two; a re-run over an unchanged head not double-appending; the refusal at the cap with its exit code and printed history; the closing round being permitted once and only once, from a **red** prior round, with a green closing round minting the receipt and a red one refusing further dispatch; a ledger with no `origin` field parsing as `autofix` and not resetting; the seam still running normally after orchestrate has appended an entry, which is the `no-progress` regression; a sessionless run leaving the cap inert; and a corrupt ledger leaving dispatch, aggregate and receipt behaviour unchanged.

## Acceptance criteria

1. The codex lane's prompt carries the cut-marker contract, and that contract text has a single definition shared with the reviewer lane.
2. A dispatch with no prior ledger round for the pair records nothing.
3. A re-round dispatched by `cr orchestrate` is recorded for its `(slug, kind)` pair whether or not the auto-fix seam ran, and a session with one auto-fix round and one operator round reports two.
4. Orchestrate does not append when the ledger's last entry already names this round's head and fingerprint.
5. Once the ledger holds `AUTOFIX_ROUND_CAP` re-rounds, `cr orchestrate` refuses to dispatch, exits 3, and prints the round history and the `Noldor-Path-Override` remedy.
6. From a red round at the cap, exactly one further dispatch is permitted; a green one amends the receipt, and a red one refuses any further dispatch.
7. The auto-fix seam still reaches `auto-fix` on a round following an orchestrate-written entry, rather than declining `no-progress`.
8. `decide`'s `prior-deferred` rule ignores operator-origin entries.
9. A ledger entry written before this change, carrying no `origin`, parses as `autofix` and does not reset the series.
10. A run with no session marker leaves the cap inert.
11. A corrupt, unreadable or absent ledger, and a failed append, leave dispatch, aggregate and receipt behaviour exactly as today.
12. The gate skill, `cr-pipeline.md` and `script-catalog.md` no longer assert the replaced behaviour, and their `templates/` twins match.

## Risks / trade-offs

**The shared budget changes existing auto-fix behaviour.** A session that runs an operator round first will find the seam declining `round-cap` sooner than it does today. That is intended, but it is a live behaviour change for anyone relying on the seam's current budget and belongs in the release notes rather than being discovered.

**The closing round is a hole of exactly one dispatch.** An operator who fixes nothing and re-runs still gets it. That is accepted: the alternative is proving intent, which the framework cannot do, and one wasted dispatch is far cheaper than the wedge it prevents.

**A cap that refuses is a new failure mode in a hot path.** Every mitigation here is fail-open, but fail-open on a *counter* means the cap silently does nothing when the ledger is unreadable. That is the deliberate trade: an unenforced cap is today's status quo, while a falsely-enforced one is a locked door.

**Two writers to one file.** Exclusivity rests on a deduplication check rather than on a lock. The concurrency cut above records why that is sufficient today and what would invalidate it.

**Unifying the cut-marker guide touches the reviewer prompt.** Moving the string to a shared home changes a file whose exact text is pinned by a test against the rule store. The move must keep that assertion comparing two artifacts rather than making it assert against itself.

## User Story

As an agent or operator running code review through `/noldor-gate`, I want the re-round cap counted and enforced in code, and the codex lane told that a documented cut is a decision, so that a review loop stops at a budget it actually has instead of running twelve rounds and closing with a hand-typed override.

## Usage

Nothing new to invoke. `cr orchestrate` is called exactly as before and behaves identically while the budget lasts.

```
pnpm noldor cr orchestrate --slug <slug> --artifact . --kind code --base-sha origin/main
```

At the cap it refuses instead of dispatching, exits 3, and prints:

```
round 3/3 for <slug> (code) — cap reached
  1  autofix   3 applied, 1 deferred  <sha>   red
  2  operator  —                      <sha>   red
To close: fix the remaining blockers and re-review — one closing round is
still allowed — or record the arbitration:
  git commit --amend --no-edit --trailer "Noldor-Path-Override: <why>"
```

## Open questions (resolved)

1. *Is this one spec or two?*
   -> **Two.** (D1) The detector, locatable findings, the code-comment scanner and the arbitration record are carved to Q-0209, attached to this same FD. Six units with a `Finding` schema change is `L` work under an `M` label, and the contentious receipt question would otherwise hold the two cheap wins hostage.

2. *What does orchestrate do at the cap, now that the arbitration record is carved out?*
   -> **Refuse, print the round history, and name the existing `Noldor-Path-Override` remedy.** (D2) It is already the de-facto exit in 23 of 41 commits, so pointing at it adds enforcement without a new gate surface, and the printed history makes the override informed rather than blind.

3. *What counts as a round, given a capped session still needs a dispatch to re-earn its receipt?*
   -> **A recorded round is a re-round; the initial pass records nothing; and the cap admits exactly one terminal closing round.** (D3, revised) The first draft exempted a dispatch after a *green* round, which review showed does not fire on the case it was written for — the receipt re-earn on record follows a **red** final round and a fix commit. The closing round targets that shape directly and keeps `AUTOFIX_ROUND_CAP` meaning what it already means to the seam.

4. *When does orchestrate write the round entry?*
   -> **After the round resolves, with the real fingerprint, skipping the append when the seam already recorded that head.** (D4) The fingerprint hashes blockers that do not exist at dispatch time; a placeholder would poison the seam's no-progress rule, which reads the same field. A crashed round writes nothing and stays retryable.

5. *Should `decide` see operator rounds?*
   -> **The cap rule yes, the other two no.** (D5, revised) One shared budget is the point, but `no-progress` hashes the same sinks orchestrate just hashed and would decline on orchestrate's own entry every time, and `prior-deferred` would read a field operator entries do not carry.

6. *Is `AUTOFIX_ROUND_CAP = 2` still the right budget once operator rounds share it?*
   -> **Keep 2, and revisit only with evidence.** (D6) Two recorded re-rounds plus the initial pass is three dispatches, which the gate prose already calls the span that caught every real design flaw on record. The constant is pinned by a test, so a change is a visible one-line diff rather than silent drift.

7. *Does the codex lane's rules source change too?*
   -> **No — out of scope, recorded as a follow-up.** (D7) `readRules` falls back to `AGENTS.md` for codex-only consumer trees with no `.claude/`, so routing it through the `.noldor/rules/` cascade would have to add rather than replace, and that compatibility question deserves its own decision. The cut-marker contract reaches codex as prompt text, which is what the entry actually needs.
