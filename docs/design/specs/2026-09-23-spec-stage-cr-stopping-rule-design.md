# Spec-Stage CR Stopping Rule — Design

**Slug:** spec-stage-cr-stopping-rule
**FD:** docs/features/spec-stage-cr-stopping-rule.md
**Date:** 2026-09-23
**Tier:** specs-only
**Deps:** Q-0250 (shipped, PR #492 — `BLOCKING_DEFINITION` and the per-finding `blocking` flag), Q-0260 (shipped, PR #493 — the re-round contract in `src/cr/re-round.ts`)

## Problem

Spec-stage review almost never ends green. In Charuy, 1 of 34 spec stages ended green and none was green on round 1. In Noldor, 28 of 29 spec series since Aug 20 ended red, and no multi-round series converged. Blocker counts stay flat across rounds (15 → 15 → 14, 8 → 9 → 11) while the specs grow (#148 went from 279 to 520 lines), so every round buys surface for the next.

Three causes are visible in the code. First, the only written definition of a blocker is the one Q-0250 wrote for shipped code (`BLOCKING_DEFINITION`, `src/cr/blocking-definition.ts:10`), and every lane renders it at every kind: the reviewer unconditionally (`src/cr/lanes/subagent-dispatch.ts:133`), codex through `CODEX_BLOCKING` in both prompt builders (`src/cr/run-codex.ts:114`). Its last clause, "put a false statement into docs that an agent or operator will act on", covers almost any inaccuracy in a spec, because a spec is a document an implementer acts on. At spec stage the definition narrows nothing. Second, the codex artifact prompt asks codex to surface "placeholder / TODO / unfilled content that must be resolved before implementation" (`run-codex.ts:149`) and feeds it the whole feature MD (`src/cr/review-with-codex.ts:61-63`). At spec stage that FD's Diagram, User Story and Usage sections are TODO stubs on purpose: `/noldor-promote` scaffolds them, and they are written after the spec (`/noldor-draft-feature-md` drafts User Story and Usage from it). The reviewer lane reads only the FD's Summary (`readFdSummary`, `src/cr/lanes/subagent.ts:166`), so this one is codex-only, and it produced repeated blockers on #148 and #113. Third, nothing tells a lane which questions the operator already settled. A spec records its settled choices under Non-goals, Risks / trade-offs and Open questions (resolved), but no prompt says that re-arguing them is not a blocker, and a blocker the operator rejects at `address-blockers` is recorded only in chat.

## Goals

- A spec-stage finding blocks only on one of three bases: a missing or contradictory requirement, a design that cannot be built as written, or a risk the spec neither prevents nor accepts.
- Wording, formatting, cross-references, section structure and FD TODO stubs never block a spec.
- The reviewer and codex render the same spec definition from one place, and code enforces its structural half: a spec blocker must name its basis.
- FD stubs never reach a spec review as content.
- What the operator settled lives in the spec itself, where every lane of every later round reads it.
- Deletion test: a spec whose remaining findings are wording, formatting or FD-stub TODOs is green.

## Non-goals

- Finding identity across rounds and lanes, and operator dispositions that stop a settled finding from coming back: Q-0261.
- A refutation pass that checks a blocker's claim before it can red a round: Q-0262.
- Plan and code blocking. Both keep Q-0250's definition and their prompt texts. Their only change is the `basis` key that codex's shared output schema now requires, which they leave `null`.
- The review dimensions and profile a spec is reviewed under (`DEFAULT_REVIEW_PROFILES`, `src/core/review-profile.ts:38`). The definition, not the dimension list, decides what blocks.
- The round cap (`AUTOFIX_ROUND_CAP`) and its ledger. See Open question 2.
- The whole-FD feed at plan and code kinds, where an unfilled `## Diagram` stub can still reach codex. It is the same defect one stage later, and it is captured in `ideas.md` as its own entry.
- A sink schema migration. `findingSchema` gains one optional field; existing sinks keep parsing.

## Design

UI verdict: skip — `consumer.uiPaths` is not configured, and the session touches only `src/cr/**` and docs.

### Structural context

The review-policy modules and the codex runner form community c0: `src/cr/blocking-definition.ts`, `src/cr/re-round.ts`, `src/cr/run-codex.ts`, `src/cr/review-with-codex.ts`, `src/cr/lanes/codex.ts` and `src/cr/sidecar.ts`, owned mostly by the acceptance-verify-lane and specs-cr-gate-multi-reviewer FDs. `sidecar.ts` is interior: no god node and no cross-community edge. The reviewer's prompt builder, `src/cr/lanes/subagent-dispatch.ts`, sits in c25 beside the answer seam (`src/cr/lane-spawn.ts`) and reaches c0 through `blocking-definition.ts` and `renderPriorSection`. The reviewer lane itself, `src/cr/lanes/subagent.ts`, sits in c8 with `src/cr/read-fd-summary.ts` and the rules cascade. `src/cr/findings-schema.ts` (c26) is the schema hub: orchestrate, the autofix ledger, arbitration, `noldor-enforce-arbitration.ts`, `verify.ts` and `ui-design-resolve.ts` all import it, which is why the one field it gains is optional. `re-round.ts` and `src/cr/aggregate-cli.ts` change only in how they print a finding. No candidate file defines a god node. `run()` in `src/cr/orchestrate.ts` (god node #7, 29 edges) needs no change: the artifact kind already reaches every lane through `LaneInput.kind`.

### Unit 1 — What blocks a spec

`src/cr/blocking-definition.ts` gains `SPEC_BLOCKING_BASES = ['requirement', 'feasibility', 'risk']` and `SPEC_BLOCKING_DEFINITION`, beside `BLOCKING_DEFINITION` and for the same reason: one text that both prompts render, so they cannot drift. It says a finding about a spec blocks only when it names one of three bases. **requirement**: something the feature has to do is missing, or two parts of the spec (or the spec and its FD Summary) contradict each other. **feasibility**: the design cannot be built as written, because it relies on code, a contract or a behaviour that does not exist or does not work the way the spec says. **risk**: building the spec as written would ship wrong behaviour, a broken contract or caller, a security hole, lost or corrupt data, or a test that cannot fail, and the spec neither prevents that nor accepts it under Risks / trade-offs.

Nothing else blocks a spec: wording, formatting, cross-references and line numbers, section structure, detail an implementer can decide, a preference between two designs that would both work, re-arguing a choice the spec records under Non-goals or Open questions (resolved), the feature MD's own sections, and any finding marked `maybe:` or `unverified:`. A recorded choice that cannot be built still blocks, under feasibility. The reviewer's `buildPrompt` renders this text in place of `BLOCKING_DEFINITION` when the kind is `spec`, and so does `formatArtifactPrompt`. For specs it also drops the sentence that ties spec blocking to the code defect list ("blocks only when implementing it as written would ship one of the defects below", `run-codex.ts:151`) and keeps that line's `"line": null` instruction. Plan and code prompts render exactly what they render today.

### Unit 2 — A spec blocker names its basis

The definition gets a code half, as Q-0250's did with `isNeverBlockingMessage`. At kind `spec`, every finding a lane marks blocking carries `basis`, one of `SPEC_BLOCKING_BASES`, and a finding marked blocking with no valid basis is filed as a suggestion. A blocker a lane files about its own failure, against a `<lane>` file (`isLaneFailureBlocker`, `src/cr/re-round.ts:116`), is not a finding about the spec and is never demoted, so a review that failed still reds its round.

The reviewer's spec-kind answer adds `basis` to each finding. `isEffectivelyBlocking` (`subagent.ts:102`) and `toSinkFinding`, which calls it to pick a severity, take the kind and require a valid basis at kind `spec`. The answer schema takes `basis` as any string, so one unknown value demotes its own finding instead of failing the whole answer. The plan- and code-kind answer shape stays byte-identical, so the spec kind gets its own answer contract beside `REVIEWER_ANSWER` (`subagent-dispatch.ts:192`) and a second answer seam built from it. `dispatchSubagent` picks the seam by `DispatchInput.kind`, a new field, and `setDispatcher` injects into both. The spec contract's repair prompt carries each finding's basis, so a repair round never demotes a blocker the review had based.

Codex's `FindingSchema` (`src/cr/sidecar.ts:6`) gains `basis`: one of `SPEC_BLOCKING_BASES` or `null`, required because strict structured output rejects an optional key, so the three values reach codex through the regenerated `cr-record.schema.json`. Code and plan reviews answer `null`. `toFindings` (`review-with-codex.ts:117`) takes the kind and demotes a spec-kind blocker whose basis is not one of the three, as it demotes a `maybe:` one today. `OutFinding` gains `basis`, which the codex lane writes into its sink finding at kind `spec`.

The sink's `findingSchema` (`src/cr/findings-schema.ts:30`) gains an optional `basis`, the way it carries `class`. Lanes write it at kind `spec` only. `renderPriorSection` shows it beside the class (`P1 [high][design][risk] …`), and the `cr aggregate` blocker line shows it beside the severity. `fingerprintBlocker` hashes severity, file and message only, so a blocker's id does not change.

### Unit 3 — The FD reaches a spec review as its Summary

At kind `spec`, `reviewWithCodex` hands codex the FD's Summary through `readFdSummary`, the same context the reviewer lane already gets, instead of the whole file. The Diagram, User Story and Usage stubs are simply absent. The prompt heading reads `## Feature summary`, and the placeholder bullet is scoped to the spec's own text. Plan and code reviews keep the whole FD: by the plan stage `/noldor-draft-feature-md --from-spec` has written its User Story and Usage, and gate Step 4 refreshes them before code review. A missing FD file still yields an empty FD section, as today. An FD with no Summary makes the codex spec review fail the way it already fails the reviewer lane.

### Unit 4 — Operator decisions live in the spec

The spec contract already has the three places a decision belongs: Non-goals for scope, Risks / trade-offs for an accepted risk, Open questions (resolved) for a design choice. Unit 1 makes them the adjudication record: a finding that re-argues one of them has no basis. So each basis has a resolution that does not require agreeing with the lane. A missing requirement is added, or moved to Non-goals. A contradiction is fixed on one side. An unaccepted risk is prevented, or accepted under Risks / trade-offs. A disputed feasibility claim is answered under Open questions with the reason the design can be built. On the next round the Q-0260 contract marks a settled prior resolved, because the spec no longer has the defect it named. A feasibility claim the lane still upholds is carried, and the round cap's arbitration settles it. This rule is recorded as [`docs/adr/0003-spec-stage-decisions-live-in-the-spec.md`](../../adr/0003-spec-stage-decisions-live-in-the-spec.md).

The gate skill's bounded re-round rule (`.claude/skills/noldor-gate/SKILL.md:186`) says a rejected design blocker's rationale is recorded "in chat". At kind `spec` it becomes: record it in the spec, in whichever of the three sections fits, so the next round and every lane sees it. `docs/noldor/cr-pipeline.md` gains a "Spec-stage blocking" subsection naming the three bases and how a blocker on each is resolved. Both files have `templates/` twins that change with them.

### Data flow

Orchestrate passes the kind through `LaneInput` as today. For the reviewer, `runSubagent` dispatches the spec-kind contract at kind `spec`, `buildPrompt` renders `SPEC_BLOCKING_DEFINITION`, and `toSinkFinding(f, kind)` writes each answer finding with its basis, as a blocker only when `isEffectivelyBlocking(f, kind)` holds. For codex, the lane calls `reviewWithCodex`, which reads the FD Summary at kind `spec`, renders the spec prompt and maps the record through `toFindings`, demoting every blocker about the spec that lacks a valid basis. The aggregate, the ledger, R1–R3 and the prior contract read the sinks as today.

### Error handling

A finding the rule does not admit is demoted, never dropped: a basis that is missing, `null` or outside the three values turns a blocking finding about the spec into a suggestion that stays visible in the sink. A lane-failure blocker is never demoted. A transport step never changes a finding's basis, which is why the spec-kind repair prompt carries it. A reviewer answer that fails its spec-kind schema takes the existing repair round and, after it, the existing "no trustworthy answer" failure. A codex record without `basis` fails `CrRecordSchema` and takes codex's existing malformed-record path, a synthetic blocker against `<codex>`, which stays red. A malformed FD fails the codex spec review into a synthetic blocker, as it fails the reviewer lane.

### Testing

Unit tests pin `SPEC_BLOCKING_DEFINITION` rendering in both prompt builders at kind `spec`, and byte-identity of the plan- and code-kind reviewer prompts and answer shape. `subagent` lane tests with a fake dispatcher cover a spec-kind finding marked blocking with each basis, with none and with an invalid one. Codex lane tests with a fake spawn cover blockers with a valid and a `null` basis at kind `spec` and at kind `code`, and a spec-kind timeout and malformed record, each of which must write a red sink. A `review-with-codex` test asserts the spec prompt carries the FD Summary and no other FD section. The schema-parity test covers `cr-record.schema.json`. Template-sync covers the doc twins.

## Acceptance criteria

1. A spec-kind review prompt, reviewer or codex, renders `SPEC_BLOCKING_DEFINITION` and not `BLOCKING_DEFINITION`. Plan- and code-kind reviewer prompts and answer shape are byte-identical to today's, and so are the plan- and code-kind codex prompt texts.
2. At kind `spec`, a reviewer finding lands in the blockers only when it is effectively blocking under Q-0250's rule and names a basis from `SPEC_BLOCKING_BASES`. A finding marked blocking with a missing or unknown basis lands in the suggestions, and the rest of the answer is still used.
3. A spec-kind reviewer repair round keeps every finding's basis.
4. At kind `spec`, a codex blocker whose basis is not one of `SPEC_BLOCKING_BASES` lands in the suggestions. At plan and code kinds `basis` has no effect.
5. At kind `spec`, a lane that fails still writes a red sink: a codex spawn failure, timeout, non-JSON output or malformed record, and a reviewer dispatch or answer failure.
6. Deletion test: a spec round whose lanes file only findings with no basis (wording, formatting, cross-references, FD stubs) writes green reviewer and codex sinks, and orchestrate exits 0.
7. The codex spec-kind prompt carries the FD's Summary and none of the FD's other sections; plan- and code-kind codex prompts carry the whole FD.
8. A blocker's basis is recorded in its sink finding and shown in the re-round prior list and the `cr aggregate` blocker line. Its `fingerprintBlocker` id does not depend on it.
9. `CrRecordSchema` requires `basis` (nullable) on every finding, and the committed `cr-record.schema.json` matches it.
10. Sinks written before this change still pass `cr aggregate` unchanged.
11. The gate skill and `docs/noldor/cr-pipeline.md` say a rejected spec blocker is recorded in the spec, and each `templates/` twin matches.

## Risks / trade-offs

- A lane can put a basis on a nit. The code half forces the claim but cannot check it. The basis is visible in the sink and the aggregate, so a wrong one can be seen and argued, and Q-0262's judge is the check that can refute it.
- A real spec defect that a lane files without a basis reaches implementation as a suggestion. Code-stage CR (reviewer, plus codex on every M/L/XL session) is the backstop, and the suggestion stays in the spec sink.
- The codex output schema changes for every codex review, including the `cr codex` CLI: each finding must carry `basis`. A codex CLI that ignores `--output-schema` produces a malformed record and a synthetic blocker, the same risk Q-0260's required `prior` already carries.
- The shipped prompts change posture for every consumer's spec stage. The release notes must say so.
- The reviewer lane gets a second answer contract, so two shapes must stay in step. Both are built from one finding schema, and the spec one only adds `basis`.
- `.claude/skills/**` is on the worktree block list of `checks shared-files`, so the commit that edits the gate skill and its twin sets `NOLDOR_ALLOW_SHARED=1`, as PR #493's did.
- `review-with-codex.ts` gains an import of `read-fd-summary.ts`, which may move the indirection ratchet. If it does, the ratchet is re-recorded in its own commit.

## User Story

As an operator (human or agent) taking a spec through the CR gate, I want a spec finding to block only when it names a missing or contradictory requirement, a design that cannot be built, or a risk the spec has not accepted, and I want the choices I recorded in the spec to stay settled, so that a spec whose remaining findings are wording and stubs goes green instead of looping to the round cap.

## Usage

Nothing new to run. `pnpm noldor cr orchestrate --slug <slug> --artifact <spec> --kind spec` and `pnpm noldor cr aggregate --slug <slug> --kind spec` behave as before. What changes is what a spec round contains:

- Every spec blocker carries a basis — `requirement`, `feasibility` or `risk` — shown in the `cr aggregate` line and the sink.
- A spec finding with no basis is a suggestion, whatever the lane called it.
- To settle a spec blocker without applying it, record the decision in the spec: move the requirement to Non-goals, accept the risk under Risks / trade-offs, or answer the design question under Open questions (resolved). The next round's lanes read it there.

## Open questions (resolved)

1. *Enforce the basis in code, or ask for it in the prompt only?*
   -> In code. A basis-less blocking finding is a suggestion. Prompt text is not enforcement, and a forced basis makes every spec blocker's claim explicit and checkable. (D1)
2. *Add a hard stop — after the second spec round, only a finding that meets the definition and was not already adjudicated can block?*
   -> No round-count rule. The definition applies from round 1, which is stronger than applying it after round 2, and "already adjudicated" means recorded in the spec (Unit 4), which every round reads. The existing cap still bounds the tail at three red rounds. A rule that let only standing priors block from round 3 would turn a genuinely new late defect into a suggestion. (D2)
3. *Keep FD stubs out by sending the FD's Summary, or by stripping TODO comments from the whole FD?*
   -> The Summary. It is what the reviewer lane already gets, and at spec stage the rest of the FD is by design written after the spec. Stripping TODO comments would still leave empty headings for codex to flag. (D3)
4. *Does the plan stage get its own definition?*
   -> No. Plans cite files, commands and tests the way code does, and Q-0250's definition fits them. (D4)
5. *Where does a rejected spec blocker's reason go?*
   -> Into the spec, under Non-goals, Risks / trade-offs or Open questions (resolved). Chat is invisible to the next round's lanes. (D5)
6. *Does the basis enter the sink?*
   -> Yes, as an optional field like `class`. The operator sees it, the prior list carries it, and no existing sink stops parsing. (D6)
