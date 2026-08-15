# Re-Round Reviewer Context — Design

**Slug:** re-round-reviewer-context (attach to `specs-cr-gate-multi-reviewer`)
**FD:** docs/features/specs-cr-gate-multi-reviewer.md
**Date:** 2026-08-15
**Tier:** specs-only
**Deps:** none

## Problem

Every CR re-round dispatches a stateless reviewer with no memory of prior rounds. It re-litigates settled calls and proposes fixes the artifact content already falsifies, which then cost another fix commit to correct. The prior round's findings sit on disk in the lane sink (`.noldor/cr/<slug>-<kind>-reviewer.json`) at dispatch time, but nothing threads them into the prompt.

## Goals

- A re-run reviewer sees the prior round's blockers before it flags anything.
- The prompt framing matches what actually happened: when a fix diff is under review it says so; when the artifact is unchanged it says that instead — the context must never suppress an unaddressed finding.
- Zero new state files; zero new CLI surface.

## Non-goals

- Per-finding resolution records. Nothing granular exists today (the autofix ledger records per-round applied/deferred counts only), and inventing a record store is unjustified surface — the diff is the resolution.
- Rendering prior `suggestions` (Minor bullets). They are non-blocking, routinely unfixed, and were never adjudicated — framing them as settled would suppress still-open findings. Blockers only.
- Codex lane threading. The carrier field is lane-generic; codex ignores it today and can opt in later without schema change.
- Multi-round history chains. The sink holds exactly the last round; that is the round the current fix commit addresses. Archived sinks under `.noldor/cr/archive/` stay untouched.

## Design

### Unit 1 — single prior-sink reader (`src/cr/orchestrate.ts`)

One module-level reader replaces today's ad-hoc read in `priorRunWasGreen`:

```ts
async function readPriorSink(
  cwd: string, slug: string, kind: ArtifactKind, lane: Lane,
): Promise<LaneFindings | null>
```

- Resolves the path via the existing `findExistingSink` (canonical name first, then the pre-0.7.0 legacy name).
- Parses with `laneFindingsSchema.safeParse` over `JSON.parse`. Any fs error, parse failure, or schema mismatch → `null`.
- Both consumers derive from it — one probe, one read, one parse policy:
  - `priorRunWasGreen(...)` ≡ `sink !== null && sink.blockers.length === 0`. This is deliberately stricter than today's loose `JSON.parse` + `blockers ?? []`: a sink zod rejects now reads as *not green*, so the delta short-circuit re-reviews instead of minting a synthetic OK from an unparseable file.
  - Prior-review context ≡ `sink !== null && sink.blockers.length > 0` → project `{ summary, blockers }`.

### Unit 2 — carrier type (`src/cr/lane-types.ts`)

```ts
export interface PriorReview {
  summary: string;
  blockers: Finding[];
  mode: 'fixes-in-diff' | 'unchanged';
}
```

`LaneInput` gains `priorReview?: PriorReview`. Reuses the exported `Finding` type from `findings-schema.ts` — no new finding shape, so `class` (`mechanical`/`design`) and `file` ride along for free.

**Mode predicate (single rule, safe default):** `mode: 'fixes-in-diff'` only when a non-empty diff range is under review — `baseSha` present and `isEmptyDiff(baseSha..HEAD, artifact)` false. Every other shape with prior blockers is `'unchanged'`: the `fullReviewOverride` path (empty diff, non-green prior — `baseSha` is deleted there) and an explicit `--full-review` without a `baseSha`. When in doubt the predicate lands on `'unchanged'`, which can only cause a re-confirmation, never a suppression.

### Unit 3 — attachment site (`src/cr/orchestrate.ts` `run()`)

After `guardLaneOverwrite`, and only when `'reviewer'` survived into the effective lane set, `run()` calls `readPriorSink(cwd, slug, kind, 'reviewer')` and attaches `priorReview` to the reviewer's dispatch input per the Unit 2 predicate. Ordering is safe because the guard's archive action is a `copyFile` (the prior sink stays on disk) and a lane only overwrites its sink when it finishes. First rounds have no sink and attach nothing. The `fullReviewOverride` branch already reads the sink to decide green-ness; with Unit 1 that read happens once and serves both decisions.

### Unit 4 — prompt section (`src/cr/lanes/subagent-dispatch.ts`)

`DispatchInput` gains `priorReview?: PriorReview`. `buildPrompt` renders a section between the rules section and the "Range under review" line, only when the field is present. Shared body:

```
Prior review round — the previous reviewer pass over this artifact raised the blockers below.
- [high][mechanical] <message>
- [med][design] <message>
…and <N> more prior blockers
```

Mode-specific clause, `fixes-in-diff`:

```
The diff under review contains the fixes. Do not re-raise a blocker the diff resolves. Before flagging anything that overlaps these, verify against the current content — never propose a change the content already implements or falsifies. Adjudicated decisions are settled unless the diff regresses them; regressions and genuinely new issues remain fully in scope.
```

Mode-specific clause, `unchanged`:

```
The artifact is UNCHANGED since these blockers were raised — do not assume any of them were addressed. Re-examine each against the current content: re-raise every one that still stands, wording it VERBATIM as listed above (stable wording lets the no-progress detector see it is the same finding); drop only those the content genuinely resolves; new findings remain fully in scope.
```

- Blockers render as `[<severity>][<class>]` (class bracket omitted when absent).
- Cap: 20 blockers; overflow renders the `…and N more` line. Each message is truncated to 300 chars and has newlines collapsed to spaces before rendering, so one long finding cannot dominate the prompt.
- Absent field → zero output change: the prompt is byte-identical to today's.

### Unit 5 — passthrough (`src/cr/lanes/subagent.ts`)

`runSubagent` spreads `input.priorReview` into the `dispatchSubagent` call when present — same conditional-spread idiom the surrounding fields use.

### Data flow

`run()` → `readPriorSink(cwd, slug, kind, 'reviewer')` → mode predicate → `dispatchInput.priorReview` → `runSubagent` → `DispatchInput.priorReview` → `buildPrompt` section → reviewer agent.

### Error handling

All read/parse failures degrade to `null` — no context section, lane runs normally, exit semantics unchanged. A prior sink recording a lane infra error (`subagent lane errored: …` blocker) renders as one noise bullet; accepted, it self-clears next green round.

### Testing

- `buildPrompt` unit tests (pure fn): both mode clauses, class-bracket omission, cap + overflow line, message truncation + newline collapse, byte-identical output when field absent, section position between rules and range line.
- `orchestrate` unit tests with temp sinks: red prior + non-empty diff → `fixes-in-diff`; `fullReviewOverride` → `unchanged`; green prior → absent; suggestions-only prior → absent; malformed JSON / zod-reject → absent AND not green; legacy-named sink → present; reviewer not in effective set → no read.
- `subagent` passthrough test via `setDispatcher` mock capturing `DispatchInput`.

## Acceptance criteria

1. `buildPrompt` with `priorReview` renders the prior-round section between the rules section and the "Range under review" line, listing each blocker as `[severity][class] message` (class bracket omitted when the finding has none).
2. `mode: 'fixes-in-diff'` renders the fixes-in-diff clause (verify-before-re-raise, settled-unless-regressed, regressions/new in scope); `mode: 'unchanged'` renders the unchanged clause (assume nothing addressed, re-raise still-standing blockers verbatim, drop only genuinely-resolved ones).
3. More than 20 blockers → exactly 20 render plus an `…and N more` overflow line with the correct count; each message renders newline-collapsed and truncated to 300 chars.
4. `buildPrompt` without `priorReview` produces byte-identical output to the pre-change prompt.
5. An orchestrate re-run whose prior reviewer sink carries ≥1 blocker and whose reviewed diff (`baseSha..HEAD` over the artifact) is non-empty dispatches the reviewer with `priorReview` matching that sink's blockers and `mode: 'fixes-in-diff'`.
6. The `fullReviewOverride` path (empty diff, non-green prior) attaches `priorReview` with `mode: 'unchanged'`.
7. A prior sink with no blockers attaches nothing — suggestions alone (and synthetic-OK sinks) never produce a context section.
8. An absent, malformed, or zod-rejected prior sink attaches nothing, is not green (no synthetic OK), and the lane still runs (no throw).
9. A legacy-named prior sink (pre-0.7.0 lane name) is found and attached via the existing candidate probe.
10. `priorRunWasGreen` and the context attachment derive from the same `readPriorSink` result — one probe, one read, one parse policy (asserted by a single-read test on the `fullReviewOverride` path).
11. When `reviewer` is not in the effective lane set, no prior-sink read happens for it.
12. `manual` / `codex` / `verifier` lane prompts and sinks are unchanged; no new files under `.noldor/`; the sink schema is unchanged.

## Risks / trade-offs

- **Anchoring:** a reviewer told "these are settled" may under-flag real regressions near adjudicated findings. Mitigated in the fixes-in-diff clause — regressions are named as explicitly in scope — and the unchanged clause assumes nothing is settled at all.
- **Stricter green-check:** unifying on `laneFindingsSchema.safeParse` means a blockers-empty sink that zod rejects no longer counts as green — the lane re-reviews instead of short-circuiting. Deliberate: fail toward re-review, never toward a synthetic OK.
- **Noise bullet from infra-error priors:** a prior sink whose blocker is `subagent lane errored: …` renders one meaningless line. Accepted over filtering by summary string (brittle) — it costs one prompt line and disappears after the next clean round.
- **Stale-session priors:** a sink left by an earlier gate session still renders. Acceptable — it is that artifact+kind's most recent adjudication regardless of which session produced it.
- **Prompt growth:** bounded at 20 truncated one-liners plus a fixed clause.

## User Story

As an operator running CR re-rounds, I want the re-dispatched reviewer to see the prior round's blockers with framing that matches whether a fix diff exists, so that it stops re-litigating settled calls on fix rounds and re-raises unaddressed blockers verbatim on unchanged ones.

## Usage

No new surface. `pnpm noldor cr orchestrate --slug <slug> --artifact <path> --kind <kind> --lanes reviewer --base-sha <sha>` — any re-round over a sink with blockers automatically carries the prior-round section; first rounds and green-prior rounds are unchanged.

## Open questions (resolved)

1. *What stands in for the entry's "recorded resolutions"?* -> Diff-as-resolution: the prompt states the fixes live in the reviewed diff — but only when a non-empty fix diff is actually under review. No per-finding resolution record exists (the autofix ledger stores counts only) and adding one is surface without a consumer. (D1)
2. *When does the context ride the prompt?* -> Any re-run whose prior reviewer sink has blockers — delta, `fullReviewOverride`, and explicit `--full-review` alike. (D2)
3. *Which lanes?* -> `reviewer` only; the `LaneInput` field is lane-generic so codex can opt in later without schema change. (D3)
4. *Rendering ownership and bound?* -> Typed `LaneInput.priorReview` parsed best-effort by orchestrate; `buildPrompt` owns rendering; cap 20, 300-char truncation, newline collapse. (D4)
5. *How can the framing claim "fixes are in the diff" on a path where nothing changed?* -> It must not: the mode predicate grants `fixes-in-diff` only to a verified non-empty diff range; every other shape gets the `unchanged` clause, which instructs verbatim re-raise of still-standing blockers — the safe direction is re-confirmation, never suppression. (D5)
6. *Do prior suggestions ride along?* -> No. Minors are non-blocking, routinely unfixed, never adjudicated — rendering them as settled would suppress open findings. Blockers only. (D6)
7. *Two sink readers or one?* -> One: `readPriorSink`, schema-validated; green-check and context both derive from its result. (D7)
