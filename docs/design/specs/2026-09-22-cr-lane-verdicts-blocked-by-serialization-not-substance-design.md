# CR Lane Verdicts Blocked by Serialization, Not Substance — Design

**Slug:** cr-lane-verdicts-blocked-by-serialization-not-substance
**FD:** docs/features/cr-lane-verdicts-blocked-by-serialization-not-substance.md
**Date:** 2026-09-22
**Tier:** full
**Deps:** none

## Problem

A CR round can go red for reasons that have nothing to do with the change under review. The lane approves or verifies, and the gate still refuses, because of how the lane's answer was written down or because nothing told the lane what blocks.

Two transport mechanisms are confirmed. (1) The verifier, ui-reviewer and render-export lanes return their verdict as a fenced ```` ```json ```` block, read by `parseLastJsonFence` (`src/cr/extract-json.ts:38`). Its regex ``/```json\s*\n([\s\S]*?)```/g`` ends the block at the first triple backtick it meets, including one inside a JSON string. Any evidence that quotes a fenced snippet closes the block early, the JSON does not parse, and the lane reports "no trustworthy verdict" (Q-0239: two verifier runs emitted `{"verdict":"pass"}` and both were lost). The rescue valve `proseReportsSuccess` (`src/cr/lanes/verify.ts:72`) vetoes on words like `missing` or `cannot`, which an honest test report uses all the time, so it almost never rescues. (2) The reviewer lane answers in a markdown bucket format parsed by `parseSubagentMarkdown` (`src/cr/lanes/subagent.ts:31`). Every `- ` line under `Critical:` or `Important:` becomes a blocker, so a model that writes `- (none)` under an empty bucket files a phantom blocker whose message is `(none)` (Q-0246).

Next to transport sits a policy gap: no lane is told what blocks. Every reviewer Important item blocks, yet the reviewer prompt never says so. It allows "a few well-justified maybes" (`src/cr/lanes/subagent-dispatch.ts:60`), and it files a claim the reviewer could not verify under Important (`subagent-dispatch.ts:167`), which makes that claim block too. The codex code prompt (`src/cr/run-codex.ts:111`) gives codex no definition of a blocker at all. The lane's own `Assessment: approve` never feeds `ok` (`subagent.ts:287`), so a reviewer that approves while listing Important items still reds the round.

Round-cause forensics measured both effects. The sample was 46 Noldor PRs (#397–#491) and 129 Charuy PRs (#40–#224): every red round was rebuilt from lane transcripts and each blocker classified. Transport misreads cost about one red round in ten in Noldor. The fence bug hit 9 verifier sessions, lost 8 red rounds and forced the override on PR #478, and the `(none)` phantom appeared once (PR #483). In Charuy they cost about one in twenty, all of it "approve counted as red" (35 rounds), because the verifier never runs there. Nits filed as blockers are 25% of all Charuy blockers, and 37 Charuy rounds were red on nits alone. The larger cause of long loops is a different mechanism: each round's fix becomes the next round's findings, and old content draws late or repeated findings. That is carved out below.

## Goals

- A lane's real verdict reaches the sink however its answer quotes code, fences included.
- An empty finding list can never produce a blocker.
- A finding blocks only when its lane says it would refuse the merge over it, under one written definition that the reviewer and codex prompts share. `approve` always means no blocking finding.
- One way for agent lanes to hand back a structured answer: a JSON answer file. It replaces the two grammars in use today, fenced JSON and markdown buckets, both dug out of stdout.
- No sink schema migration. `laneFindingsSchema` (`src/cr/findings-schema.ts:134`) keeps its shape, so existing sinks, ledgers and arbitration records keep parsing.

## Non-goals

- The non-convergence loop is carved into four sibling roadmap entries:
  - Q-0260: re-rounds check the prior blockers and the fix's regressions instead of reviewing the fix as fresh surface.
  - Q-0261: finding identity and settled decisions carry across rounds and reach every lane, codex included.
  - Q-0262: a refutation judge pass runs before a blocker can red a round.
  - Q-0263: a stopping rule for spec-stage review.

  Across both repos, round-1 blockers are 73–78% real defects. Re-round blockers are mostly about the previous round's own fix (46–65%) or are late and repeated findings (14–23%).
- The codex lane's transport. It already gets schema-enforced output from `codex --output-schema` and reads it with `extractJsonObject` (`src/cr/run-codex.ts:79`). Its prompt does take the shared blocking definition (Unit 3).
- The standalone lane, which writes its own sink file from a separate terminal session.
- Native structured output on the claude runner (`claude --print --json-schema`). See Open question 1.

## Design

### Structural context

The fenced-JSON family is one graph community (c83): `src/cr/extract-json.ts`, `src/cr/lanes/prompt-parts.ts`, `verify-dispatch.ts`, `ui-review-dispatch.ts`, `render-export-dispatch.ts` and `lane-spawn.ts`, owned by the acceptance-verify-lane and ui-design-review-lane FDs. `prompt-parts.ts` is interior: no god node and no cross-community edge. `extract-json.ts` bridges to `run-codex.ts` (c4) through `extractJsonObject` and to the render-compare lane (c118), so changes there must leave `extractJsonObject` alone. The reviewer lane (`subagent.ts`, `subagent-dispatch.ts`) sits in c17 beside the rules brief (`src/rules/brief.ts`). It reaches orchestrate (c3), the agent-runner registry (c10) and the schema hub (c19). That hub is `src/cr/findings-schema.ts`, imported by orchestrate, the autofix ledger, arbitration, `noldor-enforce-arbitration.ts`, ui-design-resolve and every lane. Keeping its shape fixed keeps this change out of the ledger and arbitration code. `aggregate.ts` (c178) is imported by orchestrate and `autofix-cli.ts`.

### Unit 1 — Answers travel in a file, not in chat

No agent lane (reviewer, verifier, ui-reviewer, render-export) parses stdout any more. Before dispatch, the lane picks an answer path, `.noldor/cr/answers/<slug>-<kind>-<lane>.json`, and deletes any stale file there. The path is gitignored with the rest of `.noldor/cr/`, and it sits in a subdirectory because `aggregate`'s flat `readdir` (`src/cr/aggregate.ts:77`) reads every top-level `.json` there as a sink. The prompt tells the child to write its answer to that absolute path as one JSON object and nothing else. After the child exits, the lane reads the file and validates it with that lane's zod schema: `verifyVerdictSchema`, `uiReviewReportSchema`, `renderExportReportSchema`, or the reviewer schema from Unit 2. Fences, quoted code and prose no longer matter, because nothing has to find the answer inside the chatter.

A missing file, invalid JSON and a schema mismatch are one class ("no answer"), handled by Unit 4. Stdout is kept only as evidence in `notes` when that happens. `parseLastJsonFence` and `parseFencedJson` (`src/cr/extract-json.ts:38-66`) are deleted, but `extractJsonObject` stays because codex uses it. `fencedJsonInstruction` (`src/cr/lanes/prompt-parts.ts:12`) becomes `answerFileInstruction(path, shape)`. The dispatch seam passes `needsWrite: true`, so a codex-mapped role runs `workspace-write` instead of `read-only` (`src/core/agent-runner/runners/codex.ts:15`). The answer file stays after it is read, as the record of what the lane said, and the next dispatch deletes it first. One name per lane is enough without a per-dispatch suffix: two dispatches never share a slug, kind and lane at the same time, and a repair round deliberately reuses the path.

### Unit 2 — Reviewer answers in the same JSON shape

`buildPrompt` (`src/cr/lanes/subagent-dispatch.ts:139`) asks for one JSON object in the answer file instead of the markdown buckets on stdout:

`{ "assessment": "<one line>", "strengths": "<one line>", "findings": [{ "severity": "critical"|"important"|"minor", "blocking": true|false, "class": "mechanical"|"design", "message": "…path:line…" }] }`

With no issues, `findings` is `[]`: there is no bucket to leave empty and no bullet to misread. `runSubagent` reads and validates the answer file. A blocking finding becomes a blocker (critical→high, important→med). A non-blocking one becomes a suggestion (important→med, minor→low). A `minor` finding marked blocking is recorded as a suggestion, since nits never block. `class` becomes a field instead of the `[mechanical]` prefix. A blocking finding without one reads as `design`, just as an untagged bullet does today, so `cr autofix` never treats it as auto-fixable. `locations` are still derived from the message through `extractLocations`. `parseSubagentMarkdown` is deleted, and so is the reviewer's use of `splitClassTag`. JSON escaping in long, code-heavy messages is the one new failure surface this adds, and the repair round (Unit 4) backs it up (see Risks).

### Unit 3 — Every finding says whether it blocks

Whether a finding blocks stops being a side effect of which bucket it landed in. Each reviewer finding carries `blocking`, and the lane derives the verdict from those flags alone: `approve` when none blocks, otherwise `blockers found (N)`. The lane writes that as the sink `summary`, and the model's own one-line assessment moves to `notes`. Today `ok` comes from the blockers while the summary is the model's text (`subagent.ts:287`). After this change both come from one source and cannot disagree.

What blocks is written once, as an exported constant that the reviewer prompt and both codex prompt builders (`formatCodePrompt` and `formatArtifactPrompt`, `src/cr/run-codex.ts:111-138`) render, because codex fills its own `blockers` array. A finding blocks when shipping the change as it is would do one of these:

- produce wrong behaviour
- break a stated contract or an existing caller
- open a security hole
- lose or corrupt data
- leave a test that cannot fail
- put a false statement into docs that an agent or operator will act on

Everything else never blocks: cleanup, naming, wording, formatting, cross-references, style, and any finding marked `maybe:` or `unverified:`. The prompt says outright that approving means no finding blocks. The verify-before-flag rule (`subagent-dispatch.ts:167`) keeps asking for the command to be run, but a claim the reviewer could not verify is now filed as non-blocking instead of under Important.

The verifier keeps its own verdict vocabulary. Its schema gains a refinement (`pass` has no mismatches, `fail` has at least one), and an answer that breaks it counts as invalid. As defence in depth, the shared answer-file reader drops any finding whose message, trimmed of brackets and punctuation, is empty or a placeholder (`none`, `n/a`, `no issues`, `nothing`), case-insensitive.

### Unit 4 — One repair round, every agent lane

Today only the verifier has a repair round (`src/cr/lanes/verify.ts`, step 4): one cheap re-request that hands the child its own prose and asks it only to transcribe that into the schema. The shared dispatch seam (`createDispatcherSeam`, `src/cr/lane-spawn.ts:57`) gains that behaviour, so the reviewer, ui-reviewer and render-export lanes get it too. The reviewer currently spawns through its own `dispatcher` in `subagent-dispatch.ts`, so it moves onto the seam and keeps `setDispatcher` as its test injection point. When the answer file is missing or invalid after a clean exit, the seam dispatches once more. It hands over the child's stdout, the rejected file content and the validation error, and asks only for the answer file to be written. Each lane supplies its own transcription prompt, with the rule that a hedged report never becomes pass or approve. The repair is recorded in `notes`. An answer still missing or invalid after the repair takes the lane's existing "no trustworthy verdict" path, unchanged. A timed-out or crashed dispatch gets no repair, as today.

### Unit 5 — Delete the prose valve

`proseReportsSuccess`, `PROSE_SUCCESS_RE` and `PROSE_FAILURE_RE` (`verify.ts:67-74`) are deleted, along with the `proseGreen` branch of step 5 in `runVerify`. With Unit 1, the Q-0239 answer arrives in the answer file and reads as the pass it was. A verifier that writes no valid answer file, even after the repair round, has given no machine verdict. It takes the existing no-trustworthy-verdict path: fail-closed in `blocking` mode, `cannot-verify` in `advisory`. This is deliberately stricter than today for the rare prose-only answer the valve would have rescued to `cannot-verify`. The valve's word lists vetoed on `missing`, `cannot` and `wrong`, which honest test reports use constantly, so it almost never fired, and when it did fire it was guessing. `docs/noldor/cr-pipeline.md` and its `templates/` twin describe the valve, the repair round and both known traps: the fence trap and the `(none)` trap. Those passages change with this feature.

## Acceptance criteria

- A verifier answer whose evidence quotes triple-backtick fences and whose verdict is `pass` yields a sink with `verdict: "pass"` and a green lane (Q-0239 replay).
- A ui-reviewer or render-export report whose messages contain fences parses to its real verdict.
- A reviewer answer with an empty `findings` array yields zero blockers, a green lane and a sink summary of approve.
- A reviewer answer whose only findings are placeholders (`(none)`, `None`, `n/a`, empty) yields zero blockers (Q-0246 replay).
- A reviewer finding lands in the blockers exactly when it is marked blocking and is not `minor`. It carries its severity, `class` and resolved `locations`.
- A reviewer answer that approves over non-blocking Important findings yields a green lane, with those findings kept as suggestions.
- No reviewer sink has an approve summary while carrying blockers.
- The reviewer prompt and both codex prompts render the same blocking-definition constant.
- Any agent lane whose answer file is missing or invalid after a clean exit makes exactly one repair dispatch. A repaired answer is used and noted, and an unrepaired one takes that lane's existing no-trustworthy-verdict path.
- Only the answer file is read. A valid-looking verdict object printed on stdout never becomes the lane's verdict, and a stale answer file from an earlier round is never read.
- Sinks written before this change still pass `cr aggregate` unchanged.

## Risks / trade-offs

- The reviewer now decides what blocks. A real defect it wrongly marks non-blocking ships as a suggestion. Mitigation: the definition names the defect classes explicitly, suggestions stay visible in the sink, and on M/L/XL sessions codex reviews the same range on its own.
- The stricter meaning of "blocks" changes posture for every consumer, not only this repo. It lives in the shipped prompts, so consumers get it on upgrade and the release notes must say so.
- Changing the reviewer's answer format may shift what it says, not just how. Mitigation: the review instructions stay verbatim, and only the output and blocking sections change.
- JSON escaping in long, code-heavy messages is a new failure surface for the reviewer. The repair round absorbs it, but how often it happens is unknown until it runs.
- Deleting the valve makes blocking mode stricter for prose-only verifier answers.
- A child can forget to write the answer file. The repair round covers that. A child that forgets twice fails the same way an unparseable answer does today, no worse.
- A reviewer role mapped to codex now runs `workspace-write` so it can write the file, and a reviewer that can write could edit code. The claude runner already runs with `bypassPermissions`, so this matches what that runner allows today.

## User Story

As an operator (human or agent) shipping through the CR gate, I want a lane's real verdict to reach the aggregate however its answer quotes code or leaves a list empty, and I want a finding to block only when the lane would refuse the merge over it. Then a green review is never blocked by serialization or by a nit, and every red round means a finding somebody would actually stop the merge for.

## Usage

Nothing new to run. `pnpm noldor cr orchestrate …` and `pnpm noldor cr aggregate …` behave as before, and sinks keep their shape. What changes is what they contain:

- A reviewer finding blocks only when the reviewer marks it `blocking`. Everything else, including Important items the reviewer would still merge over, sits in `suggestions`.
- A reviewer sink's `summary` is derived from its findings, and the model's own one-line assessment sits in `notes`.
- A lane whose answer needed a repair round says so in `notes`.
- A blocker's `message` is always a real finding, never `(none)`.
- Each lane's last raw answer sits at `.noldor/cr/answers/<slug>-<kind>-<lane>.json`, for anyone debugging a round.

## Open questions (resolved)

1. *How does a lane hand back its answer: dug out of stdout by a tolerant reader, through the claude CLI's native structured output (`--print --json-schema`), or written to an answer file?*
   -> An answer file. It separates the answer from the chatter, so no heuristic has to find it, and it works on every runner that can write a file. Native structured output ties every consumer to a recent Claude Code CLI, where an older one rejects the flag and every dispatch fails, and to its output envelope. It would also still need a second path for opencode and the stub runner. (D1)
2. *Delete the prose valve?*
   -> Yes. Its only recorded rescue case (Q-0239) is fixed at the source by Unit 1, and a regex over free prose is the kind of guess this feature exists to remove. (D2)
3. *Does this feature also take on the non-convergence loop?*
   -> No. It takes the answer file and the blocking rule, and the loop is carved into Q-0260–Q-0263. Transport and blocking policy are one contract, while fix-seeded re-rounds, repeated findings, wrong claims and spec-stage churn are separate mechanisms, and one feature covering all of them would be L/XL. (D3)
4. *Move the reviewer to JSON, or patch the markdown bucket parser?*
   -> Move it to JSON. That gives one answer file and one repair round for every lane, an empty list that is structurally empty, and `blocking` and `class` as fields instead of bucket placement and regex tags. A patched markdown parser stays one new placeholder phrasing away from the next phantom blocker. (D4)
5. *Where does the placeholder-finding filter live?*
   -> In the shared answer-file reader, for every agent lane, so no lane can reintroduce the phantom. (D5)
6. *Keep the answer file after it is read, or delete it?*
   -> Keep it. It is gitignored, the next dispatch deletes it first, and it is the only record of what the lane actually said once the sink has reshaped it. (D6)
7. *Should `important` keep blocking by default, as it does today?*
   -> No. Blocking is the reviewer's call per finding, under the written definition. The data shows the reviewer already treats Important as "should fix": it approved over Important items in 35 Charuy rounds and 12 Noldor sessions. The gate was stricter than the reviewer's own judgment. (D7)
