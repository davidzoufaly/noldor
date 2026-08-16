# Spec Size Governor — Design

**Slug:** framework-auto-split-suggestion-for-big-features-and-plans-spec-size-governor
**FD:** docs/features/framework-auto-split-suggestion-for-big-features-and-plans.md
**Date:** 2026-08-16
**Tier:** full
**Deps:** none
**Roadmap entry:** Q-0131 `spec-size-governor` (retired into this attach session)

## Problem

`split-check` governs roadmap/backlog entries (`--entry`, rules E1–E3), FDs (`--fd`, rule F1) and plans (`--plan`, rule P1) — but not specs. Nothing measures a spec at its commit point, so an oversized spec sails into review unflagged. Oversize specs correlate directly with review-tail blowups: the two largest specs in the corpus (8000 words / 28 acceptance criteria; 7078 words / 22 criteria) each produced a 10+ round review tail, most of it self-consistency findings (criteria vs prose vs resolved-questions drift) rather than design flaws. The corpus median sits at ~3–5k words and 8–16 criteria.

Beyond raw size, two authoring habits inflate the self-consistency surface: acceptance criteria that pin exact phrasing (so every reword becomes a criteria-drift finding), and review-history meta-narrative written into the artifact (the 7078-word spec narrated its own review rounds three times and was flagged for each).

## Goals

- `pnpm noldor noldor split-check --spec <path>` measures a spec file and emits split signals under the existing 0/2/1 exit contract.
- Gate Step 2.5 runs the check automatically on every `kind=spec` artifact, mirroring the existing `kind=plan` → `--plan` wiring. Signals are informational — they never block.
- The `noldor-spec` skill carries three authoring rules that shrink the self-consistency surface at write time.

## Non-goals

- No auto-split, no re-size — same posture as E1/F1/P1 (the framework suggests; the operator decides).
- No meta-narrative heuristic (S3). Keyword detection ("round", "reviewer flagged") false-positives on specs whose *subject* is the CR system — common in this repo. The reviewer lane already catches violations; the rule is prose-only.
- No config surface. Thresholds are exported constants beside `ENTRY_WORD_THRESHOLD` — tuning is a one-line diff.
- No changes to `--entry` / `--fd` / `--plan` behavior.

## Design

### Unit 1 — `assessSpecSplit()` in [`src/core/split-suggestion.ts`](../../../src/core/split-suggestion.ts)

Two new rules, shaped exactly like `assessEntrySplit()`:

- **S1 — spec bulk.** `SPEC_WORD_THRESHOLD = 6000`. Word count comes from a shared `countWords(md: string): number` helper extracted in `split-suggestion.ts` — the existing E1 expression (`trimmed === '' ? 0 : trimmed.split(/\s+/).length`, empty-safe) moves into it and both E1 and S1 call it, so the two rules cannot drift. Fires strictly greater-than. Message suggests splitting the design into sibling attach enhancements, one per concern.
- **S2 — criteria bloat.** `SPEC_CRITERIA_THRESHOLD = 20`. Count top-level `- ` bullets inside the acceptance section (from the first line matching `/^##\s+Acceptance/i` up to the next `/^## /` or EOF; nested bullets — indented `- ` — are not counted). The loose anchor covers the corpus's real heading variants (`## Acceptance criteria`, bare `## Acceptance` — 61 of 75 historical specs). Message states the ~12-criteria budget and suggests collapsing per-detail criteria into behavior-level ones.

A spec with no `## Acceptance*` heading counts 0 criteria — S2 stays silent by design: with no criteria section there is no criteria bloat to measure, and S1 still covers such a spec's raw bulk (the largest heading-less spec in the corpus, 6340 words, trips S1). This describes 14 of 75 legacy specs; new specs follow the `prep format spec` contract, which includes the section.

Signature: `assessSpecSplit(specMd: string): SplitSignal[]` — same return shape, one signal per tripped rule, rule order S1 then S2.

Thresholds are outlier-only by design: both historical review-tail offenders trip both rules; the healthy 3–5k-word band stays silent. The ~12-criteria budget is deliberately *not* the checker threshold — prose teaches the budget, the checker catches the runaway.

### Unit 2 — `--spec` mode in [`src/core/split-check-cli.ts`](../../../src/core/split-check-cli.ts)

Mirror of the `--plan` branch: accept `--spec <path>` in the arg loop, extend the exactly-one-mode check to four modes, resolve relative paths against `cwd`, `readFileOrNull`, `usageError` on unreadable path (`cannot read spec at <path>`), then `toResult(assessSpecSplit(md))`. USAGE line becomes:

```
usage: split-check --entry <slug> | --plan <path> | --spec <path> | --fd <slug> [--add <path>...]
```

Routing in [`src/cli/manifest.ts:387`](../../../src/cli/manifest.ts) is unchanged (flags are parsed internally), but the entry's `desc` string enumerates the modes and must gain `--spec`.

### Unit 5 — mode-list doc/desc sync

Every surface that enumerates split-check's modes or rules gains S1/S2 + `--spec`, in the same commit as Unit 1/2 so none rots (none of these red CI — `validate-script-catalog.ts` diffs only `src/` link targets):

- `templates/docs/noldor/complexity-gating.md` — rule table (S1/S2 rows beside E1–P1) and the `Modes:` sentence. Templated: edit the template, never the rendered `docs/noldor/` copy.
- `templates/docs/noldor/script-catalog.md` — the split-check entry's mode list (`--entry|--fd|--plan` → add `--spec`).
- `src/cli/manifest.ts` — `split-check.desc`.
- `src/core/split-suggestion.ts` — `SplitSignal.rule` comment union and the module JSDoc's commit-point list (add gate Step 2.5 kind=spec).

### Unit 3 — gate wiring ([`.claude/skills/noldor-gate/SKILL.md`](../../../.claude/skills/noldor-gate/SKILL.md) + templates twin)

Step 2.5 lint pass currently reads: "When the artifact kind is `plan`, also run `pnpm noldor noldor split-check --plan <artifact-path>`". Extend with the symmetric sentence: when the kind is `spec`, also run `pnpm noldor noldor split-check --spec <artifact-path>` (same 0/2/1 contract, stdout appended to the captured lint output, findings informational). Both the live skill and `templates/.claude/skills/noldor-gate/SKILL.md` change; `pnpm noldor checks template-sync` enforces parity.

### Unit 4 — authoring rules ([`.claude/skills/noldor-spec/SKILL.md`](../../../.claude/skills/noldor-spec/SKILL.md) + templates twin)

Add three rules to the skill's `## Rules` section (live + twin):

1. **Criteria pin behavior, not phrasing.** An acceptance criterion states an observable outcome (exit code, file written, signal emitted) — never exact wording of messages or prose structure, which turns every reword into a drift finding.
2. **Budget ~12 acceptance criteria.** More usually means the spec is bundling concerns or pinning details; collapse per-detail criteria into behavior-level ones or split the scope.
3. **Never write review-history meta-narrative into the artifact.** No "as flagged in round N", no reviewer-dialogue recaps, no self-references to the spec's own revision process — pure liability surface that later rounds re-flag.

### Data flow

Gate Step 2.5 (kind=spec) → `split-check --spec <artifact>` → `runSplitCheck` parses mode → `assessSpecSplit(md)` → signals formatted `[S1]/[S2] <message>` on stdout, exit 2 → gate includes lines in the lane-picker prompt description. Exit 1 (unreadable path) is mentioned but never blocks — identical to the plan-lint contract.

### Error handling

- Unreadable/absent spec path → exit 1 with `usage` + `error:` lines on stdout (existing `usageError` shape).
- Empty file → 0 words, 0 criteria → exit 0.
- Multiple mode flags (`--spec` + `--plan`) → exit 1 usage error (existing exactly-one-mode check, widened to four).

### Testing

Extend the two existing suites (no new test files):

- [`src/core/__tests__/split-suggestion.test.ts`](../../../src/core/__tests__/split-suggestion.test.ts): S1 fires above / stays silent at threshold; S2 counts only top-level bullets in the criteria section (nested bullets and bullets in other sections excluded); missing section → no S2; both rules fire together in S1,S2 order.
- [`src/core/__tests__/split-check-cli.test.ts`](../../../src/core/__tests__/split-check-cli.test.ts): `--spec` clean file → exit 0; oversize fixture → exit 2 with `[S1]`/`[S2]` lines; unreadable path → exit 1; `--spec` + `--plan` together → exit 1 usage.

## Acceptance criteria

- `split-check --spec <path>` on a spec ≤6000 words with ≤20 criteria exits 0 with no output.
- A spec over 6000 words yields an `[S1]` line and exit 2.
- A spec with more than 20 top-level bullets in its acceptance section (first `/^##\s+Acceptance/i` heading) yields an `[S2]` line and exit 2; a bare `## Acceptance` heading is matched.
- Nested (indented) bullets and bullets outside the acceptance section do not count toward S2.
- A spec with no `## Acceptance*` heading never yields S2.
- An unreadable `--spec` path exits 1 with usage + error lines on stdout.
- Passing two mode flags (e.g. `--spec` with `--plan`) exits 1.
- `SPEC_WORD_THRESHOLD` and `SPEC_CRITERIA_THRESHOLD` are exported constants in `split-suggestion.ts`; E1 and S1 share one `countWords()` helper.
- The mode/rule enumerations in `templates/docs/noldor/complexity-gating.md`, `templates/docs/noldor/script-catalog.md`, and the manifest `desc` name `--spec` and S1/S2.
- Gate SKILL.md Step 2.5 (live + templates twin) instructs running `split-check --spec` on kind=spec artifacts; `checks template-sync` passes.
- noldor-spec SKILL.md `## Rules` (live + templates twin) carries the three authoring rules.
- Existing `--entry` / `--fd` / `--plan` behavior is unchanged (existing tests stay green).

## Risks / trade-offs

- **Prose wiring, not code.** Step 2.5 runs the check because the gate skill says so — a controller that skips the lint pass skips S1/S2 too. Accepted: identical posture to the existing plan lint, and the reviewer lane remains the backstop.
- **S2 coverage is heading-dependent.** The `/^##\s+Acceptance/i` anchor measures 61 of 75 historical specs; the 14 with no acceptance heading are S2-silent (S1 alone covers their bulk), and a future spec that omits or fully renames the heading escapes S2 the same way. Accepted: criteria bloat is only measurable where a criteria section exists, and the reviewer lane sees the whole artifact regardless.
- **Thresholds may need tuning.** 6000/20 is calibrated to a 74-spec corpus with two known-bad outliers. Constants-not-config keeps retuning a one-line diff.

## User Story

As an operator (or autonomous gate run), I want oversized specs flagged at the Step 2.5 checkpoint with concrete split guidance, so that runaway design artifacts get decomposed before they seed multi-round self-consistency review tails.

## Usage

- Manual: `pnpm noldor noldor split-check --spec docs/design/specs/2026-08-16-foo-design.md` → exit 0 silent, or `[S1]`/`[S2]` lines + exit 2.
- Automatic: `/noldor-gate` Step 2.5 runs it in the lint pass (before the artifact commit) and surfaces signal lines in the lane-picker prompt; signals inform, never block.
- Authoring: `/noldor-spec` writes specs under the three rules (behavior-pinning criteria, ~12-criteria budget, no review meta-narrative).

## Open questions (resolved)

1. *Should S1/S2 thresholds be config?* → No — exported constants beside `ENTRY_WORD_THRESHOLD`, matching the deliberate E1/P1 decision; outlier-only values (6000/20) rarely need per-consumer tuning.
2. *Count criteria by section bullets or format-aware parse?* → Section bullets (top-level `- ` between the criteria heading and the next `## `). The format contract fixes the structure; a markdown AST parse buys nothing here.
3. *Should the check also run inside the noldor-spec skill post-save?* → No — gate Step 2.5 is the authoritative checkpoint every path passes through; a second invocation site doubles maintenance for no coverage gain.
