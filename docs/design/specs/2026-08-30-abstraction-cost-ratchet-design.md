# Abstraction-Cost Ratchet — Design

**Slug:** abstraction-cost-ratchet
**FD:** docs/features/abstraction-cost-ratchet.md
**Date:** 2026-08-30
**Tier:** full
**Deps:** none

## Problem

Noldor enforces the duplication axis in one direction only. The clone ratchet (`src/clones/detect.ts`, baseline at `.noldor/clones-baseline.json`) reds when `duplicatedTokens` grows, so the cheapest way for an author to clear it is to extract a shared helper. Nothing in the framework measures what that extraction costs, which means the gate can push a repo toward an abstraction that makes it worse.

That is not hypothetical here. On 2026-08-30 the release sweep hit exactly this: the whole-corpus ratchet came in +112 tokens over the baseline PR #406 recorded, and the largest new group was `src/design/design-approval.ts:63-92` against `src/design/ui-capture.ts:76-108`. Neither site holds copied logic — both are one-line delegations to the already-shared receipt store, each binding a different schema, dir-segment tuple and return type. The tokenizer normalizes identifiers for Type-2 matching, so two same-shaped one-line delegations match structurally. The recorded judgement was that extracting would be *"strictly worse — one generic untyped wrapper, indirection added, zero logic shared"*, and the baseline was moved to 28844 to unblock the sweep. The operator was right and the gate was wrong, and the framework had no way to say so.

Cross-file indirection is also the dominant cost term for agent-driven development specifically, which is the workload this framework exists to serve. Abstraction that stays inside one file is nearly free to a reader and to an agent; abstraction that spans files costs a fetch and a model round trip every time it is crossed. Published measurement over 394 agent runs puts an over-abstracted corpus at ~2.2x the model round trips and ~30% higher agent spend than a collocated equivalent, with per-task worst cases near 5x.

## Goals

- A scoped rule stating when abstraction is warranted, binding at `code` stage, resolved into both the author brief and the CR reviewer prompt.
- A mechanical ratchet that reds when the repo's cross-file indirection grows, in the same shape as the clone ratchet so the two read as one family.
- Consumer parity: blocking at pre-push, shipped through `templates/`.
- Close the parser gap that lets `dependency-cruiser` return zero modules under TypeScript 7 and report it as clean.

## Non-goals

- **Not a waiver system.** The escape valve is rebaselining, exactly as with clones. A per-finding waiver list would turn every contested reading into a config edit.
- **Not intra-file abstraction.** The cost model is file-crossing; a long file with many small local functions is out of scope by construction.
- **Not a relaxation of the clone ratchet.** The two gates measure different things and both stay live. Fixing the tokenizer's facade false-positive is separate work.
- **Not configurable thresholds.** `docs/vision.md`: opinionated, not configurable. The threshold is an exported constant, as with the `split-suggestion.ts` thresholds.

## Design

### Structural context

`pnpm noldor design graph-context` over the five anchor files, against a graph regenerated in this worktree (`--ast-only`, 3108 nodes / 8329 edges / 159 communities):

- **`src/invariants/boundaries.ts`** — community `c11`, owned by the `architecture-invariants` FD, sitting alongside `src/invariants/index.ts`, `src/invariants/types.ts` and `src/checks/check-invariants.ts`. Its only cross-community edges run to `consumer-config.ts` [`c82`] via `loadConsumerConfig()`. This is the community that already owns dependency-cruiser usage, and it is where the parser-availability guard lives.
- **`src/clones/baseline.ts`** and **`src/clones/detect.ts`** — both in `c59`, owned by `code-clone-detector`, with their tests. Their cross-community edges run to `clones-cli.ts` [`c66`] and to `atomicWriteFileSync()` [`c58`].
- **`src/clones/clones-cli.ts`** — a **separate** community `c66`, reaching `repo-paths.ts` [`c31`] via `scanRoots()`, `config.ts` [`c29`] via `loadConfig()`, and `cli-entry.ts` [`c18`] via `runIfDirect()`. The engine/CLI split is an existing structural fact, not a preference, and the new detector mirrors it.
- **`src/rules/load.ts`** — community `c1`, alongside `src/cr/lanes/subagent.ts`, `src/rules/brief.ts` and `src/rules/cli-brief.ts`; the digest reports it as an interior file with no god nodes and no cross-community edges. The rule store and the reviewer lane already share a community, which is the path a new `enforce` rule travels with no new wiring.

### Unit 1 — the rule

One rule file, `enforce: true`, `applies-to: ["src/**/*.ts"]`, `stage: [code]`, with the identical twin at `templates/.noldor/rules/abstraction-cost.md` that `check-template-sync` holds to parity. It carries only the delta over `.claude/engineering-rules.md`, which already owns YAGNI (L76), "DRY threshold = 3" (L78) and "Prop drilling beats Context until 3+ levels" (L121):

1. Abstraction is priced by file boundaries — inside one file it is nearly free, across files it costs a fetch and a round trip.
2. Three reasons to abstract: hide complexity, name a thing, reuse a thing — reuse counting from the third call site. None apply → inline it.
3. Named anti-patterns: the single-use constant, the single-consumer translation layer, the factory wrapping a value the type system already constrains, the barrel re-export.

It reaches the author through `pnpm noldor rules brief` at gate Step 3.5, and the reviewer through the `enforce` bucket that `src/cr/lanes/subagent.ts` resolves for changed files — so a violation is a finding even when the author never ran the brief.

### Unit 2 — closure measurement

For each in-repo module, the size of its transitive in-repo import closure: the count of distinct repo files reachable by following import edges, excluding the module itself. This is the article's cost model stated mechanically — how many files a reader or agent must fetch to understand this one.

Input is a `cruise()` call shaped like the one in `boundaries.ts:126-133` — `validate: false`, `doNotFollow: { path: 'node_modules' }`, `tsPreCompilationDeps: true`, tests excluded. Scan roots come from `scanRoots()` in `repo-paths.ts`, the same provider `clones-cli.ts` already uses, so a consumer with a non-`src` layout is measured correctly.

Type-only imports are counted. A type that lives in another file is still a file the reader opens, and `tsPreCompilationDeps: true` is what surfaces them.

A module is **flagged** when its closure exceeds `INDIRECTION_CLOSURE_THRESHOLD`. Measured distribution on this repo today (401 modules, 36 861 code lines, 1018 internal edges): p50 = 4, p75 = 11, p90 = 30, p99 = 89, max = 103 (`src/release/index.ts`).

Two signal designs were measured and rejected before this one. **Thin-wrapper counting** (few dependents, small body) yields 36 hits at `deps ≤ 2, body ≤ 20`, but the sample is dominated by registry and plugin members — `src/migrations/0.4.0.ts`, `src/garden/detectors/adr.ts`, `src/core/agent-runner/runners/stub.ts` — which have one dependent *by design*. With no waiver list, every new migration or detector would red the gate. **Pass-through-chain counting** (each link having exactly one dependent) finds 3 chains in the entire repo, and all 3 are that same registry pattern. Closure size is immune to both: a registry member's own closure is small, and it is the aggregator's depth that grows when indirection is genuinely added.

### Unit 3 — baseline and ratchet

The ratchet number is the **count of flagged modules** (38 on this repo at threshold 30). It is absolute rather than a ratio, for the reason `src/clones/baseline.ts` states in its own header, and it is stable under clean growth in a way a raw closure sum is not: summing every module's closure (3995 today) rises whenever any shared module gains a consumer, so ordinary feature work would red it.

`.noldor/indirection-baseline.json` is tracked, mirroring `cloneBaselineSchema`: the ratchet count, the descriptive numbers a human reads but nothing compares (percentiles, modules scanned, total edges), an `options` block recording the threshold and scan roots and test-inclusion the baseline was taken under, and `recordedAt`. A baseline whose `options` differ from the current run is not comparable and is rejected rather than trusted — raising the threshold would otherwise shrink the count with nobody removing an edge. Written through `atomicWriteFileSync` and read through `readJsonState`, as clones does.

### Unit 4 — CLI

`pnpm noldor indirection <report|check|baseline>`, mirroring `clones-cli.ts` — a separate module from the engine, matching the `c59`/`c66` split above. `report` prints the flagged modules and the distribution; `check` compares against the baseline; `baseline` records one. Exit contract as elsewhere in the repo: 0 clean, 1 infra error, non-zero on ratchet growth.

`report` additionally lists **barrel-only modules** — modules whose every statement is a re-export. They are counted and printed, but they do **not** contribute to the ratchet number and cannot red `check`. This repo has zero of them, so the signal would be calibrated against nothing here; consumers are far likelier to carry them, and a zero-false-positive row that only informs is worth shipping where the same row wired into a blocking count would not be.

### Unit 5 — parser availability

`dependency-cruiser` parses TypeScript through `typescript` (which it accepts only at `>=2 <6`) or `@swc/core`. This repo is on TypeScript 7, so swc is the only working parser, and without it `cruise` returns zero modules — a clean green over an unparsed tree. `boundaries.ts:107-124` already documents this and guards it with `findUnparseableTsExtensions`; the new detector reuses that guard and fails loudly rather than reporting a count of zero.

`@swc/core` is currently a **devDependency** while `dependency-cruiser` is a production dependency. A consumer installing Noldor therefore gets the cruiser and no parser. For a blocking, consumer-shipped gate that is fatal, so `@swc/core` moves to `dependencies`. This also closes the same latent hole for the existing `boundaries` invariant, which consumers already run under `checks invariants`.

### Unit 6 — wiring and consumer shipping

A `noldor-indirection` pre-push job beside `noldor-clones` in `lefthook/noldor.yml`, and the same in the templated copy so consumers receive it. Because `checks push-gates` replays lefthook itself rather than an enumeration, the gate is preflighted at gate Step 4 with no edit to the gate skill's prose.

### Testing

Per `docs/noldor/testing-principles.md`, assertions are on the detector's own counters against **dedicated fixture trees**, never live `src/` — that file records the Q-0122 lesson, where tests pinned to real code went green for the wrong reason once the code was refactored. Four fixtures: a deep chain (flags), a wide registry (must **not** flag), a barrel re-export, and a tree with no available parser (must fail loudly rather than report zero).

## Acceptance criteria

1. `pnpm noldor indirection report` prints, for a fixture tree, one row per flagged module with its closure size, and the closure distribution.
2. A module's closure count equals the number of distinct in-repo files transitively reachable through its imports, excluding itself, on a fixture with a known answer.
3. Type-only imports are counted in the closure.
4. Files excluded by the test-exclusion pattern contribute no modules and no edges.
5. `pnpm noldor indirection baseline` writes `.noldor/indirection-baseline.json` containing the flagged count and an `options` block recording threshold, scan roots and test-inclusion.
6. `pnpm noldor indirection check` exits 0 when the flagged count is at or below the baseline, and non-zero when it exceeds it.
7. `check` refuses a baseline whose `options` differ from the current run, rather than comparing across knobs.
8. With no usable TypeScript parser installed, every subcommand exits non-zero with a message naming the missing parser — never a count of zero and never exit 0.
9. A fixture registry tree, where many small modules each have exactly one dependent, produces zero flagged modules.
10. `.noldor/rules/abstraction-cost.md` resolves into the `enforce` bucket for a `src/**/*.ts` file at `code` stage, and `pnpm noldor rules validate` passes.
11. `.noldor/rules/abstraction-cost.md` and its `templates/` twin are byte-identical, and `pnpm noldor checks template-sync` passes.
12. `@swc/core` appears in `dependencies`, not `devDependencies`, and `pnpm noldor checks push-gates` runs the `noldor-indirection` job.
13. On a fixture containing a barrel-only module, `report` lists it and the flagged count is unchanged by its presence.

## Risks / trade-offs

- **A blocking, consumer-shipped gate with no waiver list lands an uncalibrated signal in other people's repos.** This was chosen deliberately over a waiver escape; the mitigation is that rebaselining is a one-command escape and that the signal is structurally immune to the registry pattern, which was the measured false-positive family. It remains the largest risk in this spec.
- **The threshold is one number for every repo.** A repo whose modules are legitimately deeper than this one's starts with a high baseline, which is harmless — the ratchet only measures growth — but its first `baseline` run silently blesses whatever it has.
- **Closure size does not distinguish necessary depth from needless depth.** A module with a closure of 35 may be honestly complex. The gate claims only that the repo got harder to read, not that any particular module is wrong.
- **Adding a genuinely shared utility can push several modules over the threshold at once.** That is the intended reading — a new file-crossing dependency for many modules is a real cost — but it will occasionally red a change that is on balance good, and the answer there is to rebaseline with the change.
- **The two ratchets can in principle disagree on one commit.** In practice they rarely do: an honest Rule-of-3 extraction has three dependents and a small closure, so it lowers the clone count without raising the flagged count.

## User Story

As an engineer or agent changing code in a Noldor repo, I want the framework to price cross-file indirection the way it already prices duplication, so that clearing the clone gate cannot quietly push me into an abstraction that costs more than the duplication it removed.

## Usage

```
pnpm noldor indirection report      # flagged modules + closure distribution
pnpm noldor indirection check       # compare against the recorded baseline
pnpm noldor indirection baseline    # record the current count as the baseline
```

`check` runs automatically as the `noldor-indirection` pre-push job, and is replayed author-side by `pnpm noldor checks push-gates` before the code-stage review earns its receipt. When a change legitimately raises the count, re-record with `pnpm noldor indirection baseline` and commit the baseline alongside the change — the same move the clone ratchet uses.

The rule reaches authors through `pnpm noldor rules brief --file <path> --stage code`, which lists it under `ENFORCE`.

## Open questions (resolved)

1. *What closure threshold flags a module?* → **30**, the measured p90 of this repo. (D1) It puts 38 of 401 modules (9.5%) in scope — enough that the ratchet has real signal to move, few enough that the flagged set is legible when someone reads the report. The measured curve is also flat across 30–35 (38 flagged, then 36), so the choice sits on a plateau rather than on a cliff: the verdict does not depend on tuning the number precisely. Below that it climbs steeply (57 at 20, 72 at 15) and stops discriminating; above it, 50 tracks only the 13 orchestrators already known to be deep.

2. *Does the feature also ship a diff-scoped gate, the way clones runs one beside its corpus ratchet?* → **No, not in this feature.** (D2) The clone diff-scope gate exists because a clone group is a local, attributable fact about the lines a change touched. Closure size is a whole-graph property — a module's closure grows because of an edge added elsewhere — so a diff-scoped verdict would frequently name a file the change never opened. Corpus ratchet only; revisit if the ratchet proves too coarse in practice.

3. *Should the barrel-only signal ship, given this repo has zero barrels?* → **Yes, as a report-only row, not part of the ratchet number.** (D3) It costs almost nothing, it is genuinely zero-false-positive, and consumers are far more likely than this repo to carry barrels. Keeping it out of the ratchet count means it cannot red a gate it was never calibrated against.

4. *Are `__tests__` and `*.test.ts` measured?* → **No, excluded**, matching the exclusion `boundaries.ts` already applies. (D4) Test files import broadly by nature and would dominate the count without saying anything about the shipped graph's readability.

5. *Does the baseline live in `.noldor/` or in config?* → **`.noldor/indirection-baseline.json`**, tracked, beside `clones-baseline.json`. (D5) It is a recorded measurement rather than a preference, which is the same reason the clone baseline is not a config key.
