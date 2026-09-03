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

- Count every round for a `(slug, kind)` pair at the orchestrate layer, and bound the budget on the rounds that found blockers, so the cap is code rather than prose.
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

`run-codex.ts` then injects that guide, with its carve-outs unchanged: a marker never waives a finding about a defect, a vulnerability, a race, an unintended state change, an accessibility regression, or explicitly-requested behaviour that was cut.

The injection sits **above** `formatPrompt`'s branch, so both prompt builders carry it. `formatPrompt` early-returns `formatArtifactPrompt` for every artifact review, and that builder composes its own text — injecting inside the code branch alone would leave spec- and plan-stage codex reviews with no cut contract, which is the stage where markers in FDs and structural-context sections actually live.

The reviewer injects the guide conditionally, gated on the profile carrying one of the four ladder dimensions. Codex has no profile and no dimension list, so its injection is unconditional. The asymmetry is deliberate and belongs in a comment: a conditional gate needs a condition to read, and codex has none.

Authority is unambiguous after this change. `.noldor/rules/lazy-decision-ladder.md` remains the author-side prose that tells a human writing code what a cut means; the shared guide is the reviewer-side text that tells a review lane how to treat one. The existing test that pins the guide against the rule file keeps its meaning, because it still compares two independently maintained artifacts. Codex receives the guide and does not additionally receive the rule file, so there is no path by which it can see two divergent statements of the contract.

This unit is independently shippable and nothing else here depends on it.

### Unit 2 — the ledger counts red rounds, and orchestrate owns it

The ledger at `.noldor/cr/autofix/<slug>-<kind>.json` becomes a record of rounds rather than of auto-fix applications, and it gets exactly one writer.

**Orchestrate writes every resolved round, including the first.** Excluding the initial pass cannot bootstrap the counter: with no prior entry the next dispatch is also an initial pass, and the ledger stays empty forever. So every dispatch that resolves appends an entry carrying its `verdict` — `green` when the round's `aggregate` for the pair reports `ok`, `red` otherwise. That is a definition the multi-lane case already has: `ok` is false when any lane blocks or any expected lane is unresolved, which covers a skipped lane, a timeout and a malformed sink alike. A dispatch that crashes before resolving writes nothing and stays retryable.

**`cr autofix record` stops appending and starts annotating.** It runs after the seam has applied a fix, and the round whose blockers it fixed is the ledger's last entry — so it writes `applied`, `deferred` and `diffStat` onto that entry instead of creating a new one. This is what makes round identity unambiguous. Two writers appending needed a deduplication key, and the only key available did not work: `record` hashes the blockers it just *fixed* while orchestrate hashes the *next* round's blockers, so a `(headSha, fingerprint)` pair matches only in the no-progress case. One writer removes the question, and it removes the `origin` field with it — nothing needs to know which command wrote an entry when only one does.

**The cap counts red rounds.** `redRounds` is the number of entries whose verdict is `red`; orchestrate refuses to dispatch when `redRounds > AUTOFIX_ROUND_CAP`. With the cap at 2 that is three red rounds — the initial pass plus two re-rounds, the budget the gate prose already describes — and one denominator, `n/3`, printed everywhere. `decide`'s cap rule reads the same count so the seam and the operator share one budget, and the seam's own printed counter moves to the same denominator rather than showing `3/2` for one cap.

Counting red rounds rather than dispatches is also what makes the FD's promise true: a round counts only when it arbitrates unresolved blockers. A green dispatch is free, however many there are. That matters more than it first appears, because the `HEAD^{tree}`-bound receipt is stripped by every fix commit, so a code-stage session routinely runs several green, finding-nothing dispatches purely to re-mint. None of them may cost budget.

**The closing round handles the one case greenness cannot.** The receipt shape on record is *red final round → operator fixes → one dispatch that finds nothing*. At the cap that dispatch is refused, and the session is wedged. So the refusal carries a discriminator: orchestrate refuses when `redRounds > AUTOFIX_ROUND_CAP` **and** either `HEAD` equals the last recorded round's head, or a `stopped: 'closing-round'` entry already exists. A changed head means the operator committed a fix since the cap was hit, and that earns exactly one further dispatch, recorded with `stopped: 'closing-round'`. Green mints the receipt and the session ships; red refuses everything after, because the second condition now holds regardless of how many further fixes are committed. Both acceptance criteria then describe the same state machine rather than contradicting each other, and repeated invocations at an unchanged head are refused rather than looping.

**Field compatibility.** `verdict` is optional and absent reads as `red`, which is the fail-safe direction and also the truth about historical entries — every one of them was written by the seam after a fix, so its round had blockers. `applied`, `deferred` and `diffStat` stay **required**: orchestrate writes zeros and an empty stat when it creates an entry, and `record` overwrites them when it annotates. Making them optional would have let `decide`'s `prior-deferred` rule evaluate `undefined > 0` and silently never fire, disarming the guard the code documents as its defence against laundering an unapplied blocker into a green. A round the seam never touched carries `deferred: 0` and does not trip that guard, which is right: the operator disposed of those blockers, and the seam has no business inferring otherwise.

**`no-progress` must skip the current round's own entry.** `runPlan` in [`src/cr/autofix-cli.ts`](../../../src/cr/autofix-cli.ts) recomputes `fingerprintBlockers` over the *same sinks* orchestrate just hashed, so a rule comparing against every entry would match the one orchestrate wrote moments earlier and decline `no-progress` on every single round — the seam would never run again. It compares against every entry *before the last*. This is not a refinement; without it the feature disables the auto-fix path entirely.

**Session scoping is unchanged.** `readLedger` returns `null` for a different session and `appendRound` then replaces the series, which is correct and stays. Orchestrate keys on the same value the seam does: `sessionKey` moves from `autofix-cli.ts` beside `isSameSeries` and both callers import it rather than re-deriving the expression — the drift `isSameSeries` exists to prevent. Its `?? ''` fallback is **kept**, because the seam's docblock already reasons about it: rounds accumulate across unrelated sessionless runs, which over-counts and therefore caps early, never late. Dropping it would have made the cap inert for sessionless `cr autofix record` runs too — a fail-open reset for the one writer that enforces anything today.

**Concurrency.** The cap is checked before dispatch and the entry appended after, so two concurrent orchestrates on one pair could both see budget. In practice they do not exist: parallel drain assigns each child a distinct slug and the ledger is keyed per `(slug, kind)`. Recorded as `noldor:cut single writer per (slug, kind) — parallel drain gives each child its own slug; revisit if two agents ever review one pair concurrently, at which point the read-modify-write needs a lock rather than a tighter check`.

Everything else about the file is unchanged: same directory (deliberately a subdirectory so `aggregate`'s sink scan cannot mistake a ledger for a lane sink), same `writeJsonAtomic`, same `.bad` quarantine on a parse failure, same `slugPath` guarding. The series is no longer bounded in length, since green rounds accumulate without counting.

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

Unit 2 covers the first dispatch appending an entry, which is what makes the counter bootstrap at all; a round's verdict following its aggregate across a blocking lane, an unresolved lane and a clean run; `record` annotating the last entry rather than appending, so an auto-fix cycle reports two rounds and not three; a run of green rounds never advancing the cap; the refusal at the cap with its exit code and printed history; the refusal holding at an unchanged head and lifting exactly once at a changed one, with a green closing round minting the receipt and every later dispatch refused; both counters printing one denominator; the seam still reaching `auto-fix` after orchestrate appended this round's entry, which is the `no-progress` regression; `prior-deferred` still firing on a real deferred count; and a pre-change ledger parsing, keeping its series and reading as red.

## Acceptance criteria

1. Both codex prompt builders carry the cut-marker contract, and that contract text has a single definition shared with the reviewer lane.
2. Every resolved `cr orchestrate` dispatch appends one ledger entry for its `(slug, kind)` pair, the first included, carrying a verdict of `green` when the round's aggregate reports `ok` and `red` otherwise. A dispatch that crashes before resolving appends nothing.
3. `cr autofix record` annotates the ledger's last entry with `applied`, `deferred` and `diffStat` instead of appending a round, so an auto-fix cycle and its re-review report two rounds rather than three.
4. Green rounds never count toward the cap, however many run.
5. `cr orchestrate` refuses to dispatch when red rounds exceed `AUTOFIX_ROUND_CAP` and either `HEAD` matches the last recorded round's head or a closing round has already run; it exits 3 and prints the round history and the `Noldor-Path-Override` remedy.
6. At the cap with a changed `HEAD` and no prior closing round, exactly one further dispatch runs and is recorded as the closing round; a green one amends the receipt, and every dispatch after it is refused.
7. Orchestrate and the auto-fix seam print the same denominator for the same cap.
8. The auto-fix seam still reaches `auto-fix` on a round following an orchestrate-written entry, rather than declining `no-progress` against that round's own entry.
9. `decide`'s `prior-deferred` rule reads a present `deferred` on every entry, and a round the seam never annotated does not trip it.
10. A ledger written before this change parses, keeps its series, and its entries read as red.
11. A corrupt, unreadable or absent ledger, and a failed append, leave dispatch, aggregate and receipt behaviour exactly as today.
12. The gate skill, `cr-pipeline.md` and `script-catalog.md` no longer assert the replaced behaviour, and their `templates/` twins match.

## Risks / trade-offs

**The shared budget changes existing auto-fix behaviour.** The seam's cap now counts rounds it did not run, so a session that reviews before it auto-fixes will find `round-cap` declining sooner than today. That is intended — it is the combined bound the gate prose describes — but it is a live behaviour change for anyone relying on the seam's current budget, and it belongs in the release notes rather than being discovered.

**The closing round is a hole of exactly one dispatch.** Any commit changes `HEAD`, so an operator who commits something unrelated and re-runs still spends it. Proving intent is not something the framework can do, and one dispatch is far cheaper than the wedge it prevents.

**Counting red rounds means a stuck-but-green loop is unbounded.** A session that dispatches green repeatedly — re-minting a receipt that keeps being stripped — never advances the cap. That is deliberate: those rounds arbitrate nothing, and bounding them would re-create the wedge. The cost is real dispatches that no counter stops, which is the honest trade for never blocking a ship that has already passed review.

**A cap that refuses is a new failure mode in a hot path.** Every mitigation here is fail-open, but fail-open on a *counter* means the cap silently does nothing when the ledger is unreadable. That is the deliberate trade: an unenforced cap is today's status quo, while a falsely-enforced one is a locked door.

**A single writer moves work into orchestrate.** `cr autofix record` becomes an annotator, so a ledger entry now depends on orchestrate having written one first. A `record` invoked with no preceding round has nothing to annotate and must say so rather than silently no-op.

**Unifying the cut-marker guide touches the reviewer prompt.** Moving the string to a shared home changes a file whose exact text is pinned by a test against the rule store. The move must keep that assertion comparing two artifacts rather than making it assert against itself.

## User Story

As an agent or operator running code review through `/noldor-gate`, I want the re-round cap counted and enforced in code, and the codex lane told that a documented cut is a decision, so that a review loop stops at a budget it actually has instead of running twelve rounds and closing with a hand-typed override.

## Usage

Nothing new to invoke. `cr orchestrate` is called exactly as before and behaves identically while the budget lasts.

```
pnpm noldor cr orchestrate --slug <slug> --artifact . --kind code --base-sha origin/main
```

Once red rounds exceed the cap and `HEAD` still matches the last recorded round, it refuses instead of dispatching, exits 3, and prints:

```
red rounds 3/3 for <slug> (code) — cap reached
  1  red    3 applied, 1 deferred  <sha>
  2  red    2 applied, 0 deferred  <sha>
  3  red    0 applied, 0 deferred  <sha>
HEAD is unchanged since round 3, so no further round will be dispatched.
To close: commit the remaining fixes and re-review — that earns one closing
round — or record the arbitration:
  git commit --amend --no-edit --trailer "Noldor-Path-Override: <why>"
```

Committing a fix and re-running then spends the closing round. A green one mints the receipt and the session ships; a red one is the last, and the override is the only exit after it.

## Open questions (resolved)

1. *Is this one spec or two?*
   -> **Two.** (D1) The detector, locatable findings, the code-comment scanner and the arbitration record are carved to Q-0209, attached to this same FD. Six units with a `Finding` schema change is `L` work under an `M` label, and the contentious receipt question would otherwise hold the two cheap wins hostage.

2. *What does orchestrate do at the cap, now that the arbitration record is carved out?*
   -> **Refuse, print the round history, and name the existing `Noldor-Path-Override` remedy.** (D2) It is already the de-facto exit in 23 of 41 commits, so pointing at it adds enforcement without a new gate surface, and the printed history makes the override informed rather than blind.

3. *What counts as a round, given a capped session still needs a dispatch to re-earn its receipt?*
   -> **Only a red round counts, and the cap admits one closing round discriminated by a changed `HEAD`.** (D3) Exempting a dispatch that follows a *green* round would not fire on the case this exists for: the receipt re-earn on record follows a **red** final round and a fix commit. A closing round alone is not enough either, because orchestrate needs some way to tell a refusal from a closing round in the same ledger state. Counting red rounds makes every green re-mint free, and the changed-head discriminator makes the state machine determinate.

4. *When does orchestrate write the round entry?*
   -> **After every round resolves, the first included.** (D4) Excluding the initial pass cannot bootstrap: with no prior entry the next dispatch is also an initial pass, so the ledger stays empty forever. A crashed round writes nothing and stays retryable.

5. *Two writers or one?*
   -> **One.** (D5) Two appending writers would need a deduplication key, and the only available key does not work — `record` hashes the blockers it fixed while orchestrate hashes the next round's, so they match only in the no-progress case, and an auto-fix cycle would burn the whole budget in two dispatches. `record` now annotates the last entry instead, which also retires the `origin` field.

6. *Is `AUTOFIX_ROUND_CAP = 2` still the right budget once every round shares it?*
   -> **Keep 2, and revisit only with evidence.** (D6) Two re-rounds plus the initial pass is three red rounds, which the gate prose already calls the span that caught every real design flaw on record. The constant is pinned by a test, so a change is a visible one-line diff rather than silent drift.

7. *Does the codex lane's rules source change too?*
   -> **No — out of scope, recorded as a follow-up.** (D7) `readRules` falls back to `AGENTS.md` for codex-only consumer trees with no `.claude/`, so routing it through the `.noldor/rules/` cascade would have to add rather than replace, and that compatibility question deserves its own decision. The cut-marker contract reaches codex as prompt text, which is what the entry actually needs.
