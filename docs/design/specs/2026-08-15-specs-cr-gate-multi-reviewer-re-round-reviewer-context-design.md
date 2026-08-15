# Re-Round Reviewer Context — Design

**Slug:** re-round-reviewer-context (attach to `specs-cr-gate-multi-reviewer`)
**FD:** docs/features/specs-cr-gate-multi-reviewer.md
**Date:** 2026-08-15
**Tier:** specs-only
**Deps:** none

## Problem

Every CR re-round dispatches a stateless reviewer with no memory of prior rounds. It re-litigates settled calls and proposes fixes the artifact content already falsifies, which then cost another fix commit to correct. The prior round's findings sit on disk in the lane sink (`.noldor/cr/<slug>-<kind>-reviewer.json`) at dispatch time, but nothing threads them into the prompt.

## Goals

- A re-run reviewer sees the prior round's findings before it flags anything.
- The prompt states that the fixes live in the diff under review, so the reviewer verifies against current content instead of re-raising.
- Zero new state files; zero new CLI surface.

## Non-goals

- Per-finding resolution records. Nothing granular exists today (the autofix ledger records per-round applied/deferred counts only), and inventing a record store is unjustified surface — the diff is the resolution.
- Codex lane threading. The carrier field is lane-generic; codex ignores it today and can opt in later without schema change.
- Multi-round history chains. The sink holds exactly the last round; that is the round the current fix commit addresses. Archived sinks under `.noldor/cr/archive/` stay untouched.

## Design

### Unit 1 — prior-sink read (`src/cr/orchestrate.ts`)

New module-level helper:

```ts
async function readPriorReview(
  cwd: string, slug: string, kind: ArtifactKind, lane: Lane,
): Promise<PriorReview | null>
```

- Resolves the sink path via the existing `findExistingSink` (canonical name first, then the pre-0.7.0 legacy name — same probe `guardLaneOverwrite` uses).
- Parses with `laneFindingsSchema.safeParse` over `JSON.parse`. Any fs error, parse failure, or schema mismatch → `null` (best-effort: a broken prior sink must not fail the round).
- Empty prior (`blockers.length + suggestions.length === 0`, which includes synthetic-OK sinks) → `null`.
- Non-null result: `{ summary, blockers, suggestions }` projected from the parsed `LaneFindings`.

Call site: inside `run()`, after `guardLaneOverwrite` and before the `Promise.allSettled` dispatch. Ordering is safe because the guard's archive action is a `copyFile` (the prior sink stays on disk) and a lane only overwrites its sink when it finishes — the read happens strictly before any lane can write. The result is attached to the dispatched input for the `reviewer` lane on **every** re-run shape: plain delta (`baseSha` set), `fullReviewOverride` (empty diff with a red prior — the hottest re-litigation case), and explicit `--full-review`. First rounds have no sink and get `null`.

### Unit 2 — carrier type (`src/cr/lane-types.ts`)

```ts
export interface PriorReview {
  summary: string;
  blockers: Finding[];
  suggestions: Finding[];
}
```

`LaneInput` gains `priorReview?: PriorReview`. Reuses the exported `Finding` type from `findings-schema.ts` — no new finding shape, so `class` (`mechanical`/`design`) and `file` ride along for free.

### Unit 3 — prompt section (`src/cr/lanes/subagent-dispatch.ts`)

`DispatchInput` gains `priorReview?: PriorReview`. `buildPrompt` renders a section between the rules section and the "Range under review" line, only when the field is present:

```
Prior review round (already adjudicated) — the previous reviewer pass over this artifact raised the findings below. The diff under review contains the fixes:
- [high][mechanical] <message>
- [med][design] <message>
- [minor] <message>
…and <N> more prior findings

Do not re-raise a finding the diff resolves. Before flagging anything that overlaps these, verify against the current content — never propose a change the content already implements or falsifies. Adjudicated decisions are settled unless the diff regresses them; regressions and genuinely new issues remain fully in scope.
```

- Blockers render first as `[<severity>][<class>]` (class bracket omitted when absent), then suggestions as `[minor]`.
- Cap: 20 findings total across both lists; overflow renders the `…and N more` line.
- Absent field → zero output change: the prompt is byte-identical to today's.

### Unit 4 — passthrough (`src/cr/lanes/subagent.ts`)

`runSubagent` spreads `input.priorReview` into the `dispatchSubagent` call when present — same conditional-spread idiom the surrounding fields use.

### Data flow

`run()` → `readPriorReview(cwd, slug, kind, 'reviewer')` → `dispatchInput.priorReview` → `runSubagent` → `DispatchInput.priorReview` → `buildPrompt` section → reviewer agent.

### Error handling

All read/parse failures degrade to "no section" — the lane never errors, never blocks, never logs above `console.error`. A prior sink recording a lane infra error (`subagent lane errored: …` blocker) renders as one noise bullet; accepted, it self-clears next green round.

### Testing

- `buildPrompt` unit tests (pure fn): section rendering, class-bracket omission, cap + overflow line, byte-identical output when field absent.
- `orchestrate` unit tests with temp sinks: red prior → dispatched input carries `priorReview`; green/synthetic-OK prior → absent; malformed JSON → absent; legacy-named sink → present; `fullReviewOverride` path → present.
- `subagent` passthrough test via `setDispatcher` mock capturing `DispatchInput`.

## Acceptance criteria

1. `buildPrompt` with `priorReview` renders the prior-round section listing each blocker as `[severity][class] message` (class bracket omitted when the finding has none) and each suggestion as `[minor] message`, blockers first.
2. The section contains the no-relitigation guidance: verify-before-re-raise, settled-stays-settled, regressions and new issues in scope.
3. More than 20 total findings → exactly 20 render plus an `…and N more` overflow line with the correct count.
4. `buildPrompt` without `priorReview` produces byte-identical output to the pre-change prompt.
5. An orchestrate delta run whose prior reviewer sink carries ≥1 blocker or suggestion dispatches the reviewer with `priorReview` matching that sink's content.
6. The `fullReviewOverride` path (empty diff, non-green prior) attaches `priorReview`.
7. A prior sink with no blockers *and* no suggestions (including synthetic-OK, which writes both empty) attaches nothing.
8. An absent, malformed, or unreadable prior sink attaches nothing and the lane still runs (no throw, exit semantics unchanged).
9. A legacy-named prior sink (pre-0.7.0 lane name) is found and attached via the existing candidate probe.
10. `manual` / `codex` / `verifier` lane prompts and sinks are unchanged.
11. No new files are written under `.noldor/`; the sink schema is unchanged.

## Risks / trade-offs

- **Anchoring:** a reviewer told "these are settled" may under-flag real regressions near adjudicated findings. Mitigated in the guidance clause — regressions are named as explicitly in scope.
- **Noise bullet from infra-error priors:** a prior sink whose blocker is `subagent lane errored: …` renders one meaningless line. Accepted over filtering by summary string (brittle) — it costs one prompt line and disappears after the next clean round.
- **Stale-session priors:** a sink left by an earlier gate session still renders. Acceptable — it is that artifact+kind's most recent adjudication regardless of which session produced it.
- **Prompt growth:** bounded at 20 one-line findings plus a fixed clause.

## User Story

As an operator running CR re-rounds, I want the re-dispatched reviewer to see the prior round's findings and know their fixes are in the diff under review, so that it stops re-litigating settled calls and proposing fixes the content already falsifies.

## Usage

No new surface. `pnpm noldor cr orchestrate --slug <slug> --artifact <path> --kind <kind> --lanes reviewer --base-sha <sha>` — any re-round over a sink with findings automatically carries the prior-round section; first rounds and green-prior rounds are unchanged.

## Open questions (resolved)

1. *What stands in for the entry's "recorded resolutions"?* -> Diff-as-resolution: the prompt states the fixes live in the reviewed diff. No per-finding resolution record exists (the autofix ledger stores counts only) and adding one is surface without a consumer. (D1)
2. *When does the context ride the prompt?* -> Any re-run whose prior reviewer sink has findings — delta, `fullReviewOverride`, and explicit `--full-review` alike; the red-prior full round is precisely the re-litigation hotspot. (D2)
3. *Which lanes?* -> `reviewer` only; the `LaneInput` field is lane-generic so codex can opt in later without schema change. (D3)
4. *Rendering ownership and bound?* -> Typed `LaneInput.priorReview` parsed best-effort by orchestrate; `buildPrompt` owns rendering; cap 20 with an overflow count. (D4)
