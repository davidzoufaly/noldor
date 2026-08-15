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
- Green-ness and context both derive from its result — `green ≡ sink !== null && sink.blockers.length === 0`; `context-eligible ≡ sink !== null && sink.blockers.length > 0`. The green check is deliberately stricter than today's loose `JSON.parse` + `blockers ?? []`: a sink zod rejects now reads as *not green*, so the delta short-circuit re-reviews instead of minting a synthetic OK from an unparseable file.
- **Read-once discipline:** `run()` calls `readPriorSink` at most once per lane per invocation and holds the result in a local. For `reviewer` that single result feeds both the green check inside the delta loop and the context attachment — never a second probe or read. `run()`'s per-lane green checks for the other lanes derive from the same helper (one call each).
- **Test seam:** `RunOpts` gains optional `readPriorSink` mirroring the existing `isEmptyDiff` injection point, so read-count and content assertions need no module mocking.

### Unit 2 — carrier type (`src/cr/lane-types.ts`)

```ts
export interface PriorReview {
  blockers: Finding[];
  mode: 'fixes-in-diff' | 'unchanged';
}
```

`LaneInput` gains `priorReview?: PriorReview`. Reuses the exported `Finding` type from `findings-schema.ts` — no new finding shape, so `class` (`mechanical`/`design`) rides along for free. No `summary` field: nothing renders it.

**Mode predicate (reuses the already-computed diff verdict, no extra subprocess):** `mode: 'fixes-in-diff'` if and only if the delta short-circuit branch ran (`baseSha` present and `fullReview` absent) and its computed `empty` value is `false`. Every other shape with prior blockers is `'unchanged'`: the `fullReviewOverride` path (that branch computed `empty === true`) and explicit `--full-review` with or without `--base-sha` (no diff verdict is computed there, and the safe default is the mode that can only cause a re-confirmation, never a suppression). No new `isEmptyDiff` call exists anywhere in the predicate.

### Unit 3 — attachment site (`src/cr/orchestrate.ts` `run()`)

Only when `'reviewer'` survived `guardLaneOverwrite` into the effective lane set, `run()` reads the reviewer's prior sink (Unit 1, once) and — when context-eligible — attaches `priorReview` with the Unit 2 mode to the reviewer's dispatch input. Ordering: the read happens after the guard (its archive action is a `copyFile`, so the prior sink is still on disk, and a lane only overwrites its sink when it finishes); the mode is decided where the delta branch's `empty` verdict is in scope; the attachment lands when `dispatchInput` is assembled. Read-early, attach-late — the value is held in a local across those points. First rounds have no sink and attach nothing.

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
The artifact is UNCHANGED since these blockers were raised — do not assume any of them were addressed. Re-examine each against the current content: re-raise every one that still stands, keeping its message text identical to the listing above so the finding's identity stays stable across rounds; drop only those the content genuinely resolves; new findings remain fully in scope.
```

- Blockers are severity-sorted (`high` before `med`, stable within a severity) **before** the cap, so a long sink can never push every `high` past the cutoff.
- Cap: 20 blockers; overflow renders the `…and N more` line.
- Message hygiene by mode: in `fixes-in-diff`, each message is truncated to 300 chars; in `unchanged`, messages render **untruncated** — the clause asks for identical re-raise, so the renderer must not mangle what it asks to be preserved. Newlines are collapsed to spaces in both modes (reviewer-sink messages are single-line by parser construction, so this is a guard, not a transform).
- The section's bullets are the only structure the renderer emits — prior messages land inside `- ` list items and nothing else, so a message containing prompt-like text (e.g. `Range under review:`) cannot masquerade as a new prompt section.
- Absent field → zero output change: the prompt is byte-identical to today's.

### Unit 5 — passthrough + full-review range fix (`src/cr/lanes/subagent.ts`)

- `runSubagent` spreads `input.priorReview` into the `dispatchSubagent` call when present — same conditional-spread idiom the surrounding fields use.
- `runSubagent` now honors `input.fullReview` when computing the prompt range: `baseShaForSlot = input.fullReview ? input.artifactSha : (input.baseSha ?? \`${input.artifactSha}~1\`)`. Equal base and head shas select `buildPrompt`'s existing "if equal, review the whole artifact" branch. This closes a latent flaw the context feature would otherwise inherit: today the `fullReviewOverride` path deletes `baseSha` and sets `fullReview`, but the lane ignores the flag and falls back to `HEAD~1..HEAD` — a *diff* prompt — so the "review the whole artifact" intent never reached the reviewer, and the `unchanged` clause would instruct re-examination of content the prompt scoped out.

### Data flow

`run()` → `readPriorSink(cwd, slug, kind, 'reviewer')` (once) → mode from the delta branch's computed verdict → `dispatchInput.priorReview` → `runSubagent` → `DispatchInput.priorReview` → `buildPrompt` section → reviewer agent.

### Error handling

All read/parse failures degrade to `null` — no context section, lane runs normally, exit semantics unchanged. A prior sink recording a lane infra error (`subagent lane errored: …` blocker) renders as one noise bullet; accepted, it self-clears next green round.

### Testing

- `buildPrompt` unit tests (pure fn): both mode clauses, class-bracket omission, severity-sort before cap, cap + overflow line, per-mode truncation (300-char in `fixes-in-diff`, untruncated in `unchanged`), newline collapse, byte-identical output when field absent, section position between rules and range line.
- `orchestrate` unit tests with temp sinks + injected `readPriorSink`/`isEmptyDiff`: red prior + non-empty diff → `fixes-in-diff`; `fullReviewOverride` → `unchanged`; explicit `--full-review` → `unchanged`; green prior → absent; suggestions-only prior → absent; malformed JSON / zod-reject → absent AND not green; legacy-named sink → present; reviewer not in effective set → no read; read-count = 1 for reviewer across green check + attachment.
- `subagent` tests via `setDispatcher` mock: `priorReview` passthrough; `fullReview: true` → dispatched `baseSha === headSha`.

## Acceptance criteria

1. `buildPrompt` with `priorReview` renders the prior-round section between the rules section and the "Range under review" line, listing each blocker as `[severity][class] message` (class bracket omitted when the finding has none) inside `- ` bullets and no other structure.
2. `mode: 'fixes-in-diff'` renders the fixes-in-diff clause (verify-before-re-raise, settled-unless-regressed, regressions/new in scope); `mode: 'unchanged'` renders the unchanged clause (assume nothing addressed, re-raise still-standing blockers with identical message text, drop only genuinely-resolved ones).
3. Blockers are severity-sorted before the cap; more than 20 → exactly the first 20 post-sort render plus an `…and N more` overflow line with the correct count.
4. In `fixes-in-diff` mode messages render truncated to 300 chars; in `unchanged` mode they render untruncated; newlines collapse to spaces in both.
5. `buildPrompt` without `priorReview` produces byte-identical output to the pre-change prompt.
6. A re-run whose prior reviewer sink carries ≥1 blocker and whose delta branch computed a non-empty diff dispatches the reviewer with `priorReview` matching that sink's blockers and `mode: 'fixes-in-diff'`.
7. The `fullReviewOverride` path attaches `mode: 'unchanged'`; explicit `--full-review` (with or without `--base-sha`) attaches `mode: 'unchanged'`; neither triggers any additional `isEmptyDiff` call.
8. A prior sink with no blockers attaches nothing — suggestions alone (and synthetic-OK sinks) never produce a context section.
9. An absent, malformed, or zod-rejected prior sink attaches nothing, is not green (no synthetic OK), and the lane still runs (no throw).
10. A legacy-named prior sink (pre-0.7.0 lane name) is found and attached via the existing candidate probe.
11. `run()` performs exactly one prior-sink read for the reviewer lane per invocation, observed via the injected `readPriorSink` seam; when `reviewer` is not in the effective lane set, it performs none for it.
12. With `fullReview: true`, `runSubagent` dispatches `baseSha === headSha`, selecting the whole-artifact branch of the range instruction.
13. `manual` / `codex` / `verifier` lane prompts and sinks are unchanged; no new files under `.noldor/`; the sink schema is unchanged.

## Risks / trade-offs

- **Anchoring:** a reviewer told "these are settled" may under-flag real regressions near adjudicated findings. Mitigated in the fixes-in-diff clause — regressions are named as explicitly in scope — and the unchanged clause assumes nothing is settled at all.
- **Stricter green-check:** unifying on `laneFindingsSchema.safeParse` means a blockers-empty sink that zod rejects no longer counts as green — the lane re-reviews instead of short-circuiting. Deliberate: fail toward re-review, never toward a synthetic OK.
- **Full-review range change:** honoring `fullReview` in the lane alters the dispatched range for every existing `--full-review` and `fullReviewOverride` run (from `HEAD~1..HEAD` to whole-artifact). That is the documented intent those paths already claim; the change makes behavior match it.
- **Unbounded message length in `unchanged` mode:** the price of identical re-raise. Bounded in practice by single-line parser construction and the 20-blocker cap.
- **Noise bullet from infra-error priors:** a prior sink whose blocker is `subagent lane errored: …` renders one meaningless line. Accepted over filtering by summary string (brittle) — it costs one prompt line and disappears after the next clean round.
- **Stale-session priors:** a sink left by an earlier gate session still renders. Acceptable — it is that artifact+kind's most recent adjudication regardless of which session produced it.

## User Story

As an operator running CR re-rounds, I want the re-dispatched reviewer to see the prior round's blockers with framing that matches whether a fix diff exists, so that it stops re-litigating settled calls on fix rounds and re-raises unaddressed blockers verbatim on unchanged ones.

## Usage

No new surface. `pnpm noldor cr orchestrate --slug <slug> --artifact <path> --kind <kind> --lanes reviewer --base-sha <sha>` — any re-round over a sink with blockers automatically carries the prior-round section; first rounds and green-prior rounds are unchanged.

## Open questions (resolved)

1. *What stands in for the entry's "recorded resolutions"?* -> Diff-as-resolution: the prompt states the fixes live in the reviewed diff — but only when a non-empty fix diff is actually under review. No per-finding resolution record exists (the autofix ledger stores counts only) and adding one is surface without a consumer. (D1)
2. *When does the context ride the prompt?* -> Any re-run whose prior reviewer sink has blockers — delta, `fullReviewOverride`, and explicit `--full-review` alike. (D2)
3. *Which lanes?* -> `reviewer` only; the `LaneInput` field is lane-generic so codex can opt in later without schema change. (D3)
4. *Rendering ownership and bound?* -> Typed `LaneInput.priorReview` parsed best-effort by orchestrate; `buildPrompt` owns rendering; severity-sort, cap 20, per-mode truncation. (D4)
5. *How can the framing claim "fixes are in the diff" on a path where nothing changed?* -> It must not: `fixes-in-diff` is granted only when the delta branch verified a non-empty diff; every other shape gets the `unchanged` clause. The safe direction is re-confirmation, never suppression. (D5)
6. *Do prior suggestions ride along?* -> No. Minors are non-blocking, routinely unfixed, never adjudicated — rendering them as settled would suppress open findings. Blockers only. (D6)
7. *Two sink readers or one?* -> One: `readPriorSink`, schema-validated, read once per lane per run; green-check and context both derive from the held result. (D7)
8. *Can the unchanged clause demand identical re-raise while the renderer truncates?* -> No — `unchanged` mode renders untruncated. Truncation applies only in `fixes-in-diff`, where nothing asks for preservation. (D8)
9. *Does the whole-artifact intent of `fullReviewOverride` actually reach the reviewer?* -> Not today — the lane ignores `fullReview` and prompts `HEAD~1..HEAD`. Fixed here: `fullReview` dispatches equal base/head shas, selecting the whole-artifact instruction. (D9)
