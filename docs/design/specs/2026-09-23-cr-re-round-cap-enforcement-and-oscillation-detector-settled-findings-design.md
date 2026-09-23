# CR Finding Identity and Settled Decisions Across Rounds and Lanes — Design

**Slug:** cr-finding-identity-and-settled-decisions-across-rounds-and-lanes
**FD:** docs/features/cr-re-round-cap-enforcement-and-oscillation-detector.md
**Date:** 2026-09-23
**Tier:** specs-only
**Deps:** Q-0260 (shipped, PR #493 — the re-round contract), Q-0263 (shipped, PR #494 — the spec-stage basis), Q-0228 (shipped, PR #462 — `cr arbitration dispose`)

## Problem

A CR series forgets what it decided. Q-0260 made each prior-aware lane (`reviewer`, `codex`) answer its own prior blockers by number, and code re-files every prior the lane does not answer resolved (`applyPriorAnswers`, `src/cr/re-round.ts:63`). Three gaps remain.

An operator's ruling has no effect on the next round. When the operator rejects a blocker instead of applying it, the next round still hands it to the lane as a prior (`src/cr/orchestrate.ts:1043-1047`). The content did not change, because the operator decided it should not, so the lane answers "not resolved" and code re-files it. The round stays red on a settled question until the round cap forces an arbitration record (`src/cr/arbitration.ts`). That record is written only at the cap, and nothing reads its dispositions back into a later round. At the spec stage the ruling goes into the spec (ADR 0003), but a carried prior still comes back unless the lane itself decides the ruling resolves it. Before Q-0260 gave codex its priors, codex filed `phase: done` 28 times on Charuy #115 after the author ruled on it in round 1, and a wrong `templates/` parity claim 26 times. The same ruling now comes back as a carried prior instead.

Memory is one round deep and per lane. A lane sees only its own previous sink. A finding the reviewer filed and the operator rejected can be filed fresh by codex, which never saw it. A finding resolved in round 2 is gone from every later prompt, so a lane can demand the opposite of a fix it asked for: `onclose` moved after `connect()` in r7 and back in r9 (#90), and a layout setter went required → defensive → YAGNI → deleted (#136).

Identity is exact text. `fingerprintBlocker` (`src/cr/autofix-ledger.ts:319`) hashes `severity|file|message`. The id is stable while code re-files a finding unchanged (ADR 0002). A lane that describes the same defect in new words produces a new id, and R1, the no-progress stop and arbitration all see a new finding.

## Goals

- An operator's disposition of a blocker (accepted, rejected or deferred, with a reason) is recorded as machine state for the rest of the series, before the round cap as well as at it.
- A disposed finding is not handed to a lane as a prior again while the content it cites is unchanged.
- Every later prompt of every prior-aware lane lists every decided finding from any lane, each with its reason: the ones a lane answered resolved (fixed) and the ones the operator disposed.
- A disposed finding filed again while the content it cites is unchanged does not block.
- A receipt earned after a disposition says so in git.
- The mechanism is the same at every artifact kind.

## Non-goals

- A refutation judge that checks a blocker against the code before it can red a round: Q-0262.
- Recognizing in code a re-worded restatement of a settled finding, whether by its wording or by the lines it points at (Open question 1).
- Merging one lane's standing blocker with another lane's duplicate of it. A duplicate keeps its own id, and the operator disposes each.
- The `manual`, `verifier`, `ui-reviewer` and `render-compare` lanes. They return verdicts, not free-form findings, and re-check every round.
- Withdrawing a disposition. Disposing the same id again changes it.
- Carrying decisions across gate sessions. The store is scoped to the session, like the round ledger.
- Changing `fingerprintBlocker`, the round cap or the push guard.

## Design

UI verdict: skip — `consumer.uiPaths` is not configured, and the session touches only `src/cr/**` and docs.

### Structural context

`src/cr/re-round.ts` sits in community c16 with both prior-aware lanes (`src/cr/lanes/subagent.ts`, `src/cr/lanes/codex.ts`), `src/cr/run-codex.ts` and `src/cr/blocking-definition.ts`, so a rendering and a rule added there reach both lanes along edges that already exist. `src/cr/orchestrate.ts` (c15) defines `run()`, god node #7 with 29 edges. Prior-round context is attached there, and it is the only code that runs between the lanes and the round ledger. The ledger and the autofix seam (`autofix-ledger.ts`, `autofix.ts`, `autofix-cli.ts`) form c9, whose cross-community edges go to orchestrate, the schema hub and `aggregate.ts`. The arbitration record and its CLI share c10 with the pre-push guards (`noldor-enforce-arbitration.ts`, `noldor-pre-push.ts`). `src/cr/findings-schema.ts` (c24) is the schema hub: orchestrate, the ledger, arbitration, both lanes, `ui-design-resolve.ts`, `verify.ts` and `noldor-enforce-arbitration.ts` import it, which is why the sink change is one optional field. `src/cr/amend-receipt.ts` is a leaf that orchestrate already calls. `src/cr/reflag.ts` is interior (c110, only its test beside it) and is not touched.

### Unit 1 — The decision store

A new `src/cr/decisions.ts` owns one file per series, `.noldor/cr/decisions/<slug>-<kind>.json`, built with `slugKindJsonPath` like the ledger and the arbitration record. It lives in a subdirectory of `.noldor/cr` for the reason `ledgerDir` documents: `aggregate` treats every `.noldor/cr/<slug>-<kind>-*.json` regular file as a lane sink. It is scoped to the gate session with the ledger's key and predicate (`sessionKey`, `isSameSeries`, `src/cr/autofix-ledger.ts:176-195`). A file from another session reads as empty, and the first write of a session replaces it. With no session marker the key is empty, and then, as `hasClosingRound` does (`src/cr/autofix-ledger.ts:238`), the store reads as empty and nothing writes to it: orchestrate records no `fixed`, and `dispose` records no decision and says why.

A decision records the finding's `fingerprintBlocker` id, the `Finding` as filed, the lanes that filed it, a disposition (`fixed`, `accepted`, `rejected` or `deferred`), a reason (the lane's `why` for `fixed`, the operator's note otherwise), the round, and, for an operator decision, what the finding cites (Unit 2). A write replaces any decision for the same id. The store is written only between rounds: orchestrate writes `fixed` after a round, and `cr arbitration dispose` writes the operator's dispositions. A file that cannot be read or parsed is reported and treated as empty, which fails toward carrying blockers, never toward suppressing one.

### Unit 2 — Dispose records a disposition at any round

`dispose` (`src/cr/arbitration-cli.ts:62`) works before the cap as well as at it, so every ruling uses one command and one vocabulary. With no arbitration record on disk it no longer errors. It looks the id up among the latest round's standing blockers from the reviewer and codex lanes (`aggregate`, excluding integrity blockers and `<lane>` failure blockers), or among the series' operator decisions so a ruling can be changed later. It records the decision and says that later rounds will not carry it. When a record exists it disposes there exactly as today and records the same decision, so a closing round does not carry an arbitrated finding either. A missing or unknown `--blocker` lists the standing blockers with their ids; today ids are printed only by the cap's skeleton banner. Under `NOLDOR_DRAIN=1`, `dispose` records no decision: a disposition is an operator's ruling, and a drain child has no operator. Before the cap it then refuses; at the cap it writes the arbitration record as today. `digest` is unchanged. This rule is recorded as `docs/adr/0004-operator-rulings-on-cr-findings-hold-for-the-session.md`, which supersedes ADR 0003.

A disposition records what the finding cites, read at the head the round reviewed (the `headSha` orchestrate stamps in the expected-lanes record, `src/cr/expected-lanes.ts`). For each location a finding names (`locations` on a reviewer finding, `file` plus `line` on a codex finding) it stores the cited lines' text. A finding with no location cites its whole `file`, stored as the file's blob id, when `file` is a tracked path. A finding that cites nothing readable, such as a reviewer finding whose `file` is only the artifact label, has no citation, so its disposition holds for the rest of the series.

### Unit 3 — Orchestrate hands the series' decisions to every prior-aware lane

Before dispatch `run()` reads the store. For each operator decision it checks whether the cited content is unchanged at `HEAD`: every cited block of text still appears verbatim in its file, or the cited blob is unchanged. A disposition holds while its cited content is unchanged. `run()` builds each lane's prior context (`src/cr/orchestrate.ts:1043-1047`) without the ids whose disposition holds. It attaches the decided list to `reviewer` and `codex` whenever the list is non-empty, including for a lane with no standing priors of its own. A decided finding that is standing again, such as a fixed finding a lane re-filed, is shown as a prior, not as decided.

After the round `run()` reads each prior-aware lane's new sink and records a `fixed` decision for every prior the lane answered resolved. `PriorReview` (`src/cr/lane-types.ts:12`) gains `decided`. `LaneFindings` (`src/cr/findings-schema.ts:135`) gains an optional `resolved` list of `{ finding, why }`, which both lanes fill from `applyPriorAnswers`. Q-0260 kept those answers in `notes` because they mattered only to their round; a later round now reads them.

### Unit 4 — One rendering and one rule, in the re-round module

`renderPriorSection` (`src/cr/re-round.ts:37`) renders the decided list after the prior list, numbered `S1…Sm`. Each entry shows its disposition, its round, the message cut to 300 characters, its reason, and, for an operator decision, a marker when its cited content has changed since the ruling. The contract under the list: a fixed finding blocks again only as a regression, meaning its defect is back; a rejected, accepted or deferred finding is settled, and is raised again only when the content it cites has changed, saying what changed. With no priors, the prior list and its answer instructions are left out. With no decisions, the section is byte-identical to today's.

`splitSettled(findings, decided)` is the code half. A new blocking finding whose `fingerprintBlocker` id equals an operator decision that still holds is filed as a suggestion, with a note naming the decision. A finding that restates a fixed decision still blocks: it claims the defect is back, and R1 already reports it as a repeat. `applyPriorAnswers` also returns the priors it resolved, for the sink's `resolved` list.

### Unit 5 — Both lanes apply it

`runSubagent` (`src/cr/lanes/subagent.ts:253`) and the codex lane (`src/cr/lanes/codex.ts:56`) apply `splitSettled` to their new blocking findings, never to carried priors, and write `resolved`. A lane that fails writes no `resolved` entries, so no `fixed` decision comes from a review that did not happen.

### Unit 6 — A receipt earned after a disposition says so

When a green code round amends the tip with its receipt (`amendSubagentReceipt`, `src/cr/amend-receipt.ts`), the same amend writes one `Noldor-CR-Settled:` trailer per operator decision recorded in this session for the slug, across the spec, plan and code stores: `<kind> <disposition> <first 12 characters of the id> — <the note on one line, cut to 120 characters>`. It replaces any such trailers already on the tip, and a session with no operator decisions writes none. The receipt binds `HEAD^{tree}`, so the message change leaves it valid. The tip's trailers reach `main` in the squash commit's body. Without them, a round that went green because its blockers were disposed would read in git as a clean review.

### Unit 7 — Docs and the gate

`docs/noldor/cr-pipeline.md` describes disposing before the cap under "Taking the arbitration exit", the decided list under "Re-round contract", and, under "Spec-stage blocking", that a spec ruling is both written into the spec and disposed, citing ADR 0004 where it cites ADR 0003 today. The gate skill's bounded re-round rule tells the controller to dispose a blocker the operator rejects rather than applies, and only on the operator's ruling. Its clean-exit cleanup removes the series' decision files. Each doc changes with its `templates/` twin.

### Data flow

Round N: the lanes write their sinks, and orchestrate records the round plus a `fixed` decision for each entry in the sinks' `resolved` lists. Between rounds: the operator runs `cr arbitration dispose`, which records accepted, rejected or deferred decisions with their citations. Round N+1: orchestrate reads the decisions, checks their citations at `HEAD`, leaves the ids whose disposition holds out of each lane's priors and attaches the decided list. Each lane renders it, applies `applyPriorAnswers` and `splitSettled`, and writes its sink. Aggregate, the ledger, R1–R3, the cap and the arbitration skeleton read the sinks as today. A demoted restatement is a suggestion, so none of them count it. A green code round's receipt amend adds the `Noldor-CR-Settled:` trailers.

### Error handling

Every failure fails toward carrying a blocker. An unreadable decision store is treated as empty. A citation that cannot be checked (the file is gone at `HEAD`, git fails) reads as changed, so its disposition no longer holds. `dispose` with an id that names neither a standing reviewer or codex blocker nor an existing operator decision refuses and lists the ones it can take. A lane that fails records no `fixed` decision. A receipt amend that cannot read a store writes the trailers it can and says which store it could not read; the receipt itself is written as today.

### Testing

Unit tests from literals cover the store (session scoping, replace-per-id, an unreadable file), the citation check, `renderPriorSection` (the decided list, the changed marker, byte-identity without decisions), `splitSettled` and the trailer text. Lane tests with a fake dispatcher and a fake codex spawn cover a restated settled finding, a restated fixed finding and `resolved` in the sink. Orchestrate tests cover held dispositions left out of the priors, a lapsed one handed back, the decided list reaching both lanes without priors, `fixed` recorded after a round, and the trailers on a green code round. `arbitration-cli` tests cover `dispose` before the cap, the id listing, the drain refusal and the write-through at the cap. The deletion test runs two rounds end to end.

## Acceptance criteria

1. A first-round prompt for the reviewer or codex, in a series with no decisions, is byte-identical to today's.
2. Before the cap, `cr arbitration dispose` with a standing reviewer or codex blocker's id records the disposition and exits 0. Given an existing operator decision's id, it replaces that decision. With no `--blocker`, or one that names neither, it lists the standing blockers with their ids and exits non-zero.
3. With `NOLDOR_DRAIN=1`, `dispose` records no decision, and before the cap it exits non-zero.
4. At the cap, `dispose` writes the arbitration record as today and records the same decision.
5. A disposed finding whose cited content is unchanged is not handed to any lane as a prior in any later round of the series.
6. In every later round, the reviewer and codex prompts list every decided finding from any lane with its disposition and reason, including for a lane with no priors of its own.
7. Deletion test: a finding disposed rejected in round N and filed again with the same fingerprint by any prior-aware lane in round N+1, while the lines it cites are unchanged, is written to that lane's sink as a suggestion, not a blocker.
8. When the content a disposed finding cites has changed, the prompt marks it, and a finding filed again with its fingerprint blocks.
9. A prior a lane answers resolved is recorded as fixed and listed in later rounds, and the same finding filed again still blocks.
10. A green code round in a session with operator decisions leaves one `Noldor-CR-Settled:` trailer per decision on the tip commit, and a session with none leaves no such trailer.
11. Decisions are scoped to the gate session: a new session's first round sees none, and a run with no session marker records and reads none. An unreadable decision store does not stop a round and suppresses nothing.
12. `cr-pipeline.md` and the gate skill describe disposing before the cap, and each `templates/` twin matches.

## Risks / trade-offs

- A lane that restates a settled finding in new words gets a new id, and code does not match it to the settled one. Every lane is told what was decided, and the round cap still bounds the loop. The operator disposes the new id with one command.
- A disposition lets a round go green on a blocker nobody fixed. That is the operator's call to make, as it is at the cap today. The trailers make it visible in git, and a drain child cannot make it.
- `fixed` records a lane's claim that a prior is resolved, the same trust Q-0260 gives it. A wrong claim now also reaches later prompts as context.
- The store is local (`.noldor/cr/` is gitignored) and session-scoped, so it does not travel with the PR or survive `--resume`. The trailers and, at the spec stage, the ruling written into the spec (ADR 0003) are the durable record.
- The cited-text check reads a short or repeated block as unchanged even when the code around it changed, so a disposition can hold longer than it should. It only ever demotes an exact restatement of a finding the operator already ruled on.
- The reviewer's `file` is the artifact label, so a round run with a different `--artifact` label fingerprints the same message differently.
- Prompts grow by the decided list, which is bounded by the series' findings and the 300-character cut.
- New import edges (orchestrate, the arbitration CLI and the receipt amend to the store, `re-round.ts` to the fingerprint) may move the indirection ratchet. If they do, it is re-recorded in its own commit.

## User Story

As an operator running CR rounds through `/noldor-gate`, I want a blocker I rule on to stay ruled on for every lane and every later round, so that a settled question stops turning rounds red and a series ends when its real defects are fixed.

## Usage

When you decide not to fix a blocker, record why:

```
pnpm noldor cr arbitration dispose --slug <slug> --kind <kind> \
  --blocker <id> --disposition rejected --note "<why>"
```

Run it without `--blocker` to list the standing blockers and their ids. Later rounds of the series stop handing that finding to any lane as a prior, and every prior-aware lane sees it as settled, with your note. A lane that files it again unchanged gets it filed as a suggestion. If the lines it points at change, it can block again. At the spec stage, also write the ruling into the spec (Non-goals, Risks / trade-offs or Open questions (resolved)). At the round cap the same command fills the arbitration record, as before.

When the code round goes green, its receipt commit carries one line per ruling of the session:

```
Noldor-CR-Settled: code rejected 1a2b3c4d5e6f — the fallback is intentional; see the cut marker
```

## Open questions (resolved)

1. *How does code recognize a finding that restates a settled one?* → By its `fingerprintBlocker` id only (D1). Codex's observed repeats were word for word. Matching a finding by the lines it points at would also demote any different defect on the lines the operator ruled on, for the rest of the series.
2. *Which command records a disposition before the cap?* → `cr arbitration dispose`, extended (D2). It already has the flags, the vocabulary and the docs. A second verb for the same act would split one ruling across two commands.
3. *Is a fixed finding enforced like a settled one?* → No (D3). Filing it again claims the defect is back, which is a regression and must be able to block.
4. *What happens to ADR 0003's rule at the spec stage?* → The ruling is still written into the spec, and the finding is also disposed (D4). The spec is the durable, reviewed record, and the store is what stops the prior from being carried. ADR 0004 restates 0003's spec-stage rule and supersedes it.
5. *Where do decisions live?* → In their own session-scoped store, not in the round ledger (D5). `appendRound` rebuilds the ledger object and would drop a field it does not know, and the ledger belongs to the round budget.
6. *What does an unreadable store do?* → Nothing is suppressed, and the round runs as if there were no decisions (D6).
7. *How does orchestrate learn which priors were fixed?* → From an optional `resolved` list in the lane sink (D7). The answers now matter to later rounds, so they move out of `notes`.
8. *What does a finding with no location cite?* → Its file's blob when the file is tracked; otherwise nothing, and its disposition holds for the series (D8).
9. *How does a disposition reach git?* → As `Noldor-CR-Settled:` trailers on the green code round's receipt amend (D9). The store is local, and the receipt is the one commit every shipped session is sure to amend. A trailer names the ruling without gating anything.
10. *Who may dispose?* → The operator (D10). Under `NOLDOR_DRAIN=1`, the one context guaranteed to have no operator, `dispose` records no decision. Elsewhere the gate skill says a disposition follows the operator's ruling.
11. *Which blockers can be disposed before the cap?* → The reviewer's and codex's (D11). The other lanes re-check every round, so a disposition would not stop them; they are settled by a fix or at the cap.
