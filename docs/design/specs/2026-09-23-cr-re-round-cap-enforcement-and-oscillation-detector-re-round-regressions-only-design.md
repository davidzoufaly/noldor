# CR Re-Rounds Review the Fix's Regressions, Not the Fix as Fresh Surface — Design

**Slug:** cr-re-rounds-review-the-fixs-regressions-not-the-fix-as-fresh-surface
**FD:** docs/features/cr-re-round-cap-enforcement-and-oscillation-detector.md
**Date:** 2026-09-23
**Tier:** specs-only
**Deps:** Q-0250 (shipped, PR #492 — the shared blocking definition and the JSON answer file)

## Problem

Round 1 of a CR series finds real defects; the rounds after it mostly review the previous round's own fix. The Q-0250 forensics (46 Noldor PRs, 129 Charuy PRs) put round-1 blockers at 73–78% real original defects, while re-round blockers were 46–65% about content the previous fix had introduced and only 3% original defects. Delta-scoped re-rounds are the worst case: in Noldor 89% of their blockers were fix-seeded, because the delta *is* the fix and the lane reviews it at full strength as new surface.

The code says the same thing. On a re-round the reviewer gets its prior blockers (`renderPriorReview`, `src/cr/lanes/subagent-dispatch.ts:114`), but the `fixes-in-diff` clause ends with "regressions and genuinely new issues remain fully in scope" (`subagent-dispatch.ts:106`), so the fix is reviewed like a fresh change. The lane never says which prior blockers the fix resolved: it either drops a blocker silently or re-describes it, and a re-description changes `fingerprintBlocker`'s id (`src/cr/autofix-ledger.ts:319`), so R1 and the no-progress stop lose track of it. Codex, mandatory on M/L/XL sessions, gets no prior context at all (`src/cr/orchestrate.ts:1002` attaches it to the reviewer only): a delta re-round hands it the fix diff (`src/cr/review-with-codex.ts:75`) and nothing else. Nothing tells whoever writes the fix to keep it small; the only such advice is a gotcha in `docs/noldor/cr-pipeline.md` ("prefer the candidate that DELETES a rule").

## Goals

- A re-round answers every prior blocker it inherited: resolved or not resolved.
- A re-round blocks only on a prior blocker that still stands, a regression the fix caused, or a finding that meets the Q-0250 blocking definition. Everything else about the fix's own content is a suggestion.
- A blocker that still stands keeps its identity across rounds, because code re-files it rather than the model re-describing it.
- The reviewer and codex lanes follow one contract, rendered from one place.
- Whoever writes a fix — operator, autofix controller, drain child — is told to make the smallest change that resolves the blocker and to prefer deleting a claim to adding one.

## Non-goals

- Finding identity across lanes, operator dispositions (rejected, arbitrated) and "a settled finding cannot be raised again": Q-0261. This spec carries each lane's own prior blockers only.
- A refutation judge pass before a blocker can red a round: Q-0262.
- A spec-stage stopping rule and keeping FD TODO stubs out of spec review: Q-0263.
- The `manual`, `verifier`, `standalone`, `ui-reviewer` and `render-compare` lanes. They return verdicts, not free-form review of the fix.
- A sink schema change. `laneFindingsSchema` (`src/cr/findings-schema.ts:132`) keeps its shape.
- Demoting a fix-text finding in code by where it points. See Open question 4.

## Design

UI verdict: skip — `consumer.uiPaths` is not configured, and the session touches only `src/cr/**` and docs.

### Structural context

The reviewer's prompt builder, `src/cr/lanes/subagent-dispatch.ts`, sits in community c36 beside the lane answer seam (`lane-spawn.ts`, `lane-answer.ts`) and the other dispatch builders. It bridges to c1 (`src/cr/lanes/subagent.ts`, `src/cr/blocking-definition.ts`), c22 (`src/cr/lane-types.ts`), c153 (`src/core/structural-context-contract.ts`) and c84 (`review-profile.ts` and the prompt tests). The codex runner, `src/cr/run-codex.ts` with `src/cr/review-with-codex.ts`, is its own community (c2). Its only edges into review policy go to `blocking-definition.ts` [c1] and the codex adapter [c22]. So a shared re-round module next to `blocking-definition.ts` reaches both prompt builders along edges that already exist. `src/cr/orchestrate.ts` (c18) defines `run()`, god node #8 with 28 edges; prior-round context is attached there. `src/cr/findings-schema.ts` (c51) is the schema hub: orchestrate, autofix, the ledger, arbitration, `noldor-enforce-arbitration.ts`, `ui-design-resolve.ts`, `verify.ts` and `lane-types.ts` all import it. That is why the per-prior answers stay in lane answers and sink notes rather than in the sink schema. The autofix seam (`autofix.ts`, `autofix-cli.ts` in c31; `autofix-ledger.ts` in c37) is interior. Its fingerprints hash `severity|file|message`, so a carried prior must keep those three fields byte-identical.

### Unit 1 — One re-round contract, in one module

A new `src/cr/re-round.ts`, beside `blocking-definition.ts`, owns everything both lanes share. `renderPriorSection(prior)` moves here from `subagent-dispatch.ts` and numbers the prior blockers `P1…Pn` in sink order. After the list it renders the contract, which is the same in both modes:

1. Answer every prior blocker in `prior`: resolved (the current content no longer has the defect) or not resolved, with one line of why. Do not restate a prior blocker as a new finding.
2. Report as blocking only (a) a regression the fix caused, meaning something that was correct before the fix and is not after it (a behaviour, a contract, or a statement elsewhere in the artifact the fix now contradicts), or (b) a finding that meets the blocking definition above. Every other finding about the fix's own content is a suggestion.

The section also tells the lane how to answer: add `"prior": [{"n": 1, "resolved": true | false, "why": "..."}]` to its answer object. The instruction lives only in this section, so a first round's prompt is unchanged.

The mode keeps one framing line. `fixes-in-diff` says the range under review is the fix for these blockers. `reexamine` says not to assume any of them were addressed. Every prior is rendered: the 20-blocker cap (`PRIOR_BLOCKER_CAP`, `subagent-dispatch.ts:94`) is deleted, because a prior the lane never sees can only be carried unexamined. Messages are truncated to 300 characters in both modes. Code now re-files a standing blocker verbatim, so the model never re-types it, and the reason `reexamine` kept messages untruncated is gone.

`priorAnswerSchema` (`{ n, resolved, why }`) and `applyPriorAnswers(prior, answers)` live here too. The second returns `{ carried, notes }`. `carried` holds every prior not answered `resolved: true`, as the prior sink `Finding` object unchanged. `notes` records a line per answer, including the lane's `why`. A prior with no well-formed answer, or with conflicting answers, is carried. This rule is recorded as `docs/adr/0002-code-refiles-standing-cr-blockers.md`.

### Unit 2 — The reviewer answers each prior blocker

`reviewerAnswerSchema` (`subagent-dispatch.ts:196`) gains `prior: z.array(priorAnswerSchema).default([])`. `REVIEWER_SHAPE` stays as it is, because the prior section describes the field (Unit 1). `buildPrompt` renders `renderPriorSection` where `renderPriorReview` renders today. With no `priorReview` the whole prompt, answer instruction included, stays byte-identical to today's. When `input.priorReview` is present, `runSubagent` (`subagent.ts:131`) calls `applyPriorAnswers`. The carried priors join the blockers ahead of the new effectively-blocking findings, the notes join `notes`, and `summary`/`ok` count both. The repair prompt's transcription rules gain one: carry over the review's prior answers, and never mark a prior resolved that the review did not. A repair that drops an answer is safe, because a missing answer carries the blocker.

### Unit 3 — Codex gets the same contract

`ReviewCtx` (`run-codex.ts:13-27`) gains `prior?: PriorReview`. `formatCodePrompt` and `formatArtifactPrompt` render `renderPriorSection` after `CODEX_BLOCKING`, so "the blocking definition above" resolves in both. `CrRecordSchema` (`src/cr/sidecar.ts:14`) gains a required `prior` array of `{ n, resolved, why }`. It has to be required: codex's strict structured output rejects an optional key, and a first round answers `[]`. `cr-record.schema.json` is regenerated, and the existing schema-parity test pins it. `reviewWithCodex` threads `prior` in and returns the record's `prior` answers beside the findings. `src/cr/lanes/codex.ts` applies them with `applyPriorAnswers` exactly as the reviewer lane does. The `cr codex` CLI passes no prior and is unchanged apart from the empty `prior` field in its record.

### Unit 4 — Orchestrate attaches each lane's own priors

`run()` generalizes `reviewerPrior` and `reviewerContext` (`orchestrate.ts:936-1008`) to the lanes in a `PRIOR_AWARE_LANES` set (`reviewer`, `codex`). Each of their prior sinks is read once, before the delta loop, as the reviewer's is today (`orchestrate.ts:937`). The loop's green check then reuses that read instead of reading codex's sink a second time (`orchestrate.ts:972`). The mode is decided once per round, as today. A lane failure never costs the blockers it was handed. Each prior-aware lane files its own failure blocker against a sentinel file named for the lane. Codex's `synthBlocker` already files against `<codex>` (`run-codex.ts:161`). `reviewWithCodex`'s catch and the reviewer's two failure payloads (`subagent.ts:192`, `subagent.ts:214`) adopt `<codex>` and `<reviewer>`. A lane that fails after being given priors writes its failure blocker followed by those priors, verbatim, so the round stays red on them and the next round finds them again. The prior reader never carries a blocker filed against a `<lane>` sentinel. A lane failure is not a finding about the artifact, and carrying one would keep the round red forever on something no fix can resolve. The codex lane knows its review failed when a finding is filed against `<codex>`.

A prior sink that exists but cannot be read is not a first round. `readPriorSinkDefault` (`orchestrate.ts:226`) returns `null` both for a missing sink and for one it cannot use: a read error, JSON that does not parse, or a `laneFindingsSchema` mismatch, blocker entries included. It is split in two. A missing sink still means a first round. If a prior-aware lane's sink exists but fails any of those three checks, orchestrate refuses the round before dispatching any lane: it exits non-zero, names the file, and gives the remedy (repair it, or remove it to start that lane's series over). Running the lane as a first round would let a delta re-round pass without ever seeing its blockers. Every lane outside the set still receives the shared input untouched.

### Unit 5 — The fix rule, where fixes are written

`cr autofix plan` (`runPlan`, `src/cr/autofix-cli.ts:127`) prints one `fix-rule:` line whenever it lists at least one blocker. The text is a single exported constant: make the smallest change that resolves the blocker, and prefer deleting a claim to adding one. A sentence, case or distinction the fix adds is surface the next round reviews. Every fixer runs `plan` before it fixes (operator, autofix controller, drain child), so the rule reaches all three. One clause states the same rule where those actors are instructed: the gate skill's Step 2.5 auto-fix seam, its bounded re-round rule and its Step 4 auto-fix bullet (`.claude/skills/noldor-gate/SKILL.md`), plus `docs/noldor/drain-mode.md`. `docs/noldor/cr-pipeline.md` gains a "Re-round contract" subsection under "Delta re-review", and its JSON contract describes the `<lane>` failure sentinel. Each of these docs has a `templates/` twin that changes with it.

### Data flow

`run()` reads each prior-aware lane's sink once. It refuses the round if one exists but cannot be read, drops `<lane>` failure blockers from the priors, and decides the mode. `launch(l)` attaches `{ blockers, mode }` to that lane's input. For the reviewer, `runSubagent` → `buildPrompt` renders the section, the answer's `prior` goes through `applyPriorAnswers`, and the sink is written. For codex, `runCodex` (lane) → `reviewWithCodex` → `formatPrompt` renders the section, the record's `prior` goes through `applyPriorAnswers`, and the sink is written. The aggregate, the ledger, R1–R3 and the no-progress stop read the sink as today. Carried priors keep their fingerprint, so R1 reports them as "survived a fix". That report is correct.

### Error handling

Every failure fails toward carrying a blocker, never toward dropping one. An unanswered prior, a malformed `prior` entry, an out-of-range `n` and two conflicting answers for one `n` all carry the prior and add a note. A reviewer repair round that loses the answers carries every prior, which costs a red round but never hides a blocker. A lane that fails outright carries the priors it was given into its failure sink (Unit 4). A prior sink that exists but fails the read, JSON or schema check refuses the round (Unit 4). Until now it was treated as a first round. Codex answering without `prior` is a schema failure. It takes codex's existing malformed-record path, a synthetic blocker, and codex has no repair round. See Risks.

### Testing

Unit tests pin `renderPriorSection` and `applyPriorAnswers` from literals. The existing `subagent-dispatch` byte-identity test keeps pinning the first-round prompt. `runSubagent` and codex lane tests run against a fake dispatcher and a fake spawn with prior answers covering resolved, not resolved, unanswered and conflicting. The orchestrate tests assert that priors reach reviewer and codex, reach no other lane, and come from one read per lane. They also assert that an unreadable prior sink refuses the round before any dispatch. The lane tests cover a failed dispatch that was given priors. The schema-parity test covers `cr-record.schema.json`. An `autofix-cli` test pins the `fix-rule:` line on every exit path that lists blockers. Template-sync covers the doc twins.

## Acceptance criteria

1. A first-round reviewer or codex prompt, with no prior blockers, is byte-identical to the current one.
2. A re-round prompt, reviewer or codex, lists every inherited prior blocker as `P1…Pn`, with none dropped by a cap, and carries the re-round contract.
3. A prior that the answer marks resolved is removed from the sink's `blockers` and recorded in `notes`.
4. A prior that is marked not resolved, left unanswered, answered malformed, or answered twice with conflicting values is re-filed with the same `severity`, `file` and `message` (and `class` and `locations`), so its `fingerprintBlocker` id is unchanged across the two rounds.
5. Deletion test: a re-round whose answer resolves every prior and files one non-blocking finding about a sentence the fix added writes a green reviewer sink (`summary: approve`, no blockers), and orchestrate exits 0 for that lane.
6. A new finding marked blocking that is not `minor`, `maybe:` or `unverified:` still blocks on a re-round. The contract narrows what the prompt asks for; code never demotes a blocking call.
7. The codex lane gives the same outcomes as criteria 3 and 4 for its own priors. `CrRecordSchema` requires `prior`, and the committed `cr-record.schema.json` matches it.
8. Orchestrate attaches prior blockers only to `reviewer` and `codex`, each from its own prior sink, read once per lane.
9. A reviewer or codex dispatch that fails after being given priors writes a sink that still holds those priors. Its own failure blocker, filed against `<reviewer>` or `<codex>`, is never carried into the next round.
10. When a reviewer or codex prior sink exists but cannot be read, is not valid JSON, or fails `laneFindingsSchema`, orchestrate dispatches no lane, exits non-zero, and names the file.
11. `cr autofix plan` prints the fix rule whenever it lists at least one blocker.
12. The gate skill, `drain-mode.md` and `cr-pipeline.md` state the fix rule and the re-round contract, and each `templates/` twin matches.

## Risks / trade-offs

- A lane that marks a standing blocker "resolved" suppresses it. That is the same trust the reviewer already has when it drops a fixed blocker in `fixes-in-diff` mode. The difference is that the claim is now explicit and has a why, so a wrong one is visible in the sink notes. The next stage's review is the backstop.
- "Regression" and "meets the blocking definition" are the model's judgement. They are enforced in the prompt, like Q-0250's blocking flag. This spec moves the default, not the ceiling.
- Codex's strict schema makes `prior` required. A codex CLI that fails to honour `--output-schema` produces a malformed record and a synthetic blocker, and codex has no repair round. The codex version pin already carries that risk for every other field.
- Carried priors always fire R1. That is what R1 is for, but it makes R1 louder on genuinely stuck findings.
- A corrupt prior sink now stops the round until an operator repairs or removes it. The refusal names the file. This trades a rare manual step for never passing a delta re-round that is missing its blockers.
- The new `re-round.ts` import from `autofix-cli.ts` adds an import edge and may move the indirection ratchet. If it does, the ratchet is re-recorded in its own commit.

## User Story

As an operator or a drain child running CR re-rounds, I want each re-round to say which prior blockers my fix resolved and to block only on the ones still standing, on regressions, or on real defects, so that a fix that resolves its blocker ends the loop instead of seeding the next round.

## Usage

Nothing new to invoke. Re-rounds run as today: `pnpm noldor cr orchestrate --slug <slug> --artifact <path> --kind <kind> --base-sha <sha>`. In a re-round, the reviewer and codex sinks record `prior P<n> resolved: <why>` lines in `notes`. A blocker still standing keeps its original message, and the lane's reason for keeping it is in `notes`. `pnpm noldor cr autofix plan --slug <slug> --kind <kind>` prints a `fix-rule:` line above the blockers it lists.

## Open questions (resolved)

1. *Which lanes follow the contract?* → Reviewer and codex (D1). Codex is mandatory on M/L/XL spec and code rounds and reviews the fix diff with no prior context. If it were left out, the deletion test would still fail on every session where codex runs.
2. *What does an unanswered prior mean?* → Not resolved; it is carried (D2). A missing answer must never suppress a blocker, and carrying it is always safe.
3. *Where does the fix rule live?* → In `cr autofix plan` output plus one clause in the gate skill and drain doc (D3). Every fixer runs `plan` before fixing. A doc gotcha alone was not read at fix time.
4. *Should code demote a finding located only on lines the fix introduced (R3's introduced-line map)?* → No (D4). It would demote real defects the fix introduced, such as a security hole in a new sentence of code, and the blocking definition already sorts those.
5. *Does the 20-blocker render cap stay?* → Drop it (D5). Every prior must be answerable, and 300-character truncation already bounds the prompt. A prior that is never shown can only be carried unexamined.
6. *Do per-prior answers enter the sink schema?* → No; they go in `notes` (D6). No sink migration is needed, and the answer only matters to the round it belongs to.
7. *How does the prior reader tell a lane failure from a finding?* → By the `<lane>` sentinel file that codex's synthetic blocker already uses (D7). A sink-level flag such as `reason` cannot tell the failure blocker apart from the priors a failure sink now carries. Matching message text would break the first time a message is reworded.
8. *Does the reviewer's answer shape change for every round?* → No (D8). Only the prior section describes the `prior` field, so a first-round prompt stays byte-identical, and the schema's `default([])` accepts an answer that omits it.
9. *What does an unreadable prior sink do?* → It refuses the round (D9). A silent first round would drop its blockers, which is the one outcome this spec exists to rule out. A forced whole-artifact review is undefined for the code kind, whose `--artifact` is only a label.
