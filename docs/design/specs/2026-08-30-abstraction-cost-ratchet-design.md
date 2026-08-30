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
- **Not a barrel detector.** Detecting a re-export-only module is an *export-side* fact; `cruise()` reports dependencies, not exports, and TypeScript 7 exposes no in-process parser (`src/invariants/public-api-tsdoc.ts` records this). Any implementation would fall back to a source regex, which `.claude/engineering-rules.md` discourages and which could not honestly claim to be false-positive-free. Barrels remain covered by the prose rule only.

## Design

### Structural context

`pnpm noldor design graph-context` over the five anchor files, against a graph regenerated in this worktree (`--ast-only`, 3108 nodes / 8329 edges / 159 communities):

- **`src/invariants/boundaries.ts`** — community `c11`, owned by the `architecture-invariants` FD, sitting alongside `src/invariants/index.ts`, `src/invariants/types.ts` and `src/checks/check-invariants.ts`. Its only cross-community edges run to `consumer-config.ts` [`c82`] via `loadConsumerConfig()`. This is the community that already owns dependency-cruiser usage, and it is where the parser-availability guard lives.
- **`src/clones/baseline.ts`** and **`src/clones/detect.ts`** — both in `c59`, owned by `code-clone-detector`, with their tests. Their cross-community edges run to `clones-cli.ts` [`c66`] and to `atomicWriteFileSync()` [`c58`].
- **`src/clones/clones-cli.ts`** — a **separate** community `c66`, reaching `repo-paths.ts` [`c31`] via `scanRoots()`, `config.ts` [`c29`] via `loadConfig()`, and `cli-entry.ts` [`c18`] via `runIfDirect()`. The engine/CLI split is an existing structural fact, not a preference, and the new detector mirrors it.
- **`src/rules/load.ts`** — community `c1`, alongside `src/cr/lanes/subagent.ts`, `src/rules/brief.ts` and `src/rules/cli-brief.ts`; the digest reports it as an interior file with no god nodes and no cross-community edges. The rule store and the reviewer lane already share a community, which is the path a new `enforce` rule travels with no new wiring.

### Unit 1 — the rule

One rule file at `.noldor/rules/abstraction-cost.md`, `enforce: true`, `applies-to: ["src/**/*.{ts,tsx,js,jsx}"]`, `stage: [code]`, with the identical twin at `templates/.noldor/rules/abstraction-cost.md` that `check-template-sync` holds to parity.

The glob covers the same extensions the detector measures (`CODE_FILE_RE`), so a `.tsx` file cannot be measured by the ratchet while being invisible to the rule. It cannot cover the same *roots*, though: rule globs are repo-relative and evaluated at rule-resolution time, while `scanRoots()` is resolved from the consumer's config at run time, so the framework cannot write a glob for a layout it does not know at template time. A consumer whose code lives outside `src/` widens the glob in its own rule-store copy. This asymmetry is accepted rather than solved — the rule is guidance to an author and context to a reviewer, so under-reaching costs advice, whereas the ratchet is mechanical and does reach every scan root. It carries only the delta over `.claude/engineering-rules.md`, which already owns YAGNI (L76), "DRY threshold = 3" (L78) and "Prop drilling beats Context until 3+ levels" (L121):

1. **Abstraction is priced by file boundaries.** Inside one file it is nearly free; across files it costs a fetch and a round trip on every crossing.
2. **Three reasons to abstract:** hide complexity behind an interface a caller genuinely should not see; give a thing a name *that the call site cannot already read off the expression*; reuse from the third call site, not the second. If none applies, inline it.
3. **Named anti-patterns:** the single-use constant whose name says no more than its value; the single-consumer translation layer that only renames; the factory wrapping a value the type system already constrains.

Clause 2's naming test is stated narrowly on purpose: "name a thing" would otherwise justify every single-use constant, which is the first anti-pattern in clause 3. The rule does **not** name barrel re-exports as an anti-pattern — `src/index.ts` style public-API surfaces legitimately re-export, and a blanket clause would turn a repo convention into a reviewer blocker.

It reaches the author through `pnpm noldor rules brief` at gate Step 3.5, and the reviewer through the `enforce` bucket that `src/cr/lanes/subagent.ts` resolves for changed files — so a violation is a finding even when the author never ran the brief.

### Unit 2 — closure measurement

For each in-repo module, the size of its transitive in-repo import closure: the count of distinct in-repo files reachable by following import edges, excluding the module itself. This is the article's cost model stated mechanically — how many files a reader or agent must fetch to understand this one.

**Which files are modules.** The measured set is every file under `scanRoots()` (`src/core/repo-paths.ts`, the same provider `clones-cli.ts` uses) matching `CODE_FILE_RE` — `/\.(ts|tsx|js|jsx)$/`, `repo-paths.ts:72` — excluding: anything `TEST_FILE_RE` matches or living under a `__tests__` directory (see below); `.d.ts` declaration files, which carry no runtime edges; and anything `dependency-cruiser` resolves outside the scan roots, including `node_modules` and other workspace packages. A workspace sibling is a published boundary, not an in-repo hop, so an edge into one terminates rather than expanding.

The extension set is taken from `CODE_FILE_RE` rather than invented, and that is a constraint rather than a preference. `.mts`, `.cts`, `.mjs` and `.cjs` are **out of scope**, because the repo's three existing policies agree on the narrow set and disagreeing with them silently reopens the holes this design exists to close: `TEST_FILE_RE` does not match `foo.test.mts`, so measuring `.mts` would count that test as a module and inflate the baseline — precisely the failure the exclusion fix set out to prevent — and `TS_EXTENSIONS` in `boundaries.ts:12` is `{'.ts', '.tsx'}`, so an unparseable `.mts` would never trip `findUnparseableTsExtensions` and the silent-green hole would stay open for it. Widening the measured set is therefore a change to `CODE_FILE_RE`, `TEST_FILE_RE` and `TS_EXTENSIONS` together, not to this detector alone.

**Test exclusion derives from the repo's own policy, not from a restated literal.** `src/core/repo-paths.ts:74` owns it: `TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/`, and `walkCodeFiles({ includeTests })` also skips `__tests__` directories. The narrower `exclude: { path: '__tests__|\\.test\\.ts$' }` literal in `boundaries.ts` misses `.spec.ts` entirely, so a consumer laid out with `*.spec.ts` would have its tests counted as modules — silently inflating every closure and the baseline recorded from it. The cruise `exclude` pattern is therefore derived from `TEST_FILE_RE`, so the two cannot drift.

**Which edges count.** Static `import` and `export … from`, `import type` included (a type in another file is still a file the reader opens; `tsPreCompilationDeps: true` is what surfaces them), plus `require()` where dependency-cruiser resolves it. Dynamic `import()` counts when the specifier is a string literal dependency-cruiser can resolve, and is ignored when it cannot. A `tsconfig` path alias counts as the file it resolves to. A directory specifier counts as the index file it resolves to.

**The unresolved-import predicate, stated once and used everywhere.** An import counts as *unresolved-in-scope* when dependency-cruiser marks it `couldNotResolve` **and** its specifier is either relative (`./`, `../`) or matches a `tsconfig` path alias. A bare package specifier that fails to resolve is **never** unresolved-in-scope: dependency-cruiser reports `couldNotResolve` for ordinary, healthy reasons — an optional peer that is not installed, a package whose `types` entry does not resolve — and treating those as failures would hard-block pre-push in consumer repos that are perfectly fine. An unresolved-in-scope import means the measured graph is genuinely incomplete, so it is reported by `report` and makes `check` exit 3: "could not look", not "clean". Unit 4 and the acceptance criteria use this predicate by name and state nothing narrower or broader.

**Flagging and the measured distribution.** A module is *flagged* when its closure exceeds `INDIRECTION_CLOSURE_THRESHOLD` (30). Flagging drives what `report` prints; the ratchet number is defined in Unit 3. Measured on this repo today, with the exclusion above: 401 modules, closure p50 = 4, p75 = 11, p90 = 30, p99 = 89, max = 103 (`src/release/index.ts`); 38 modules flagged.

**Two cheaper signals were measured and rejected.** *Thin-wrapper counting* (few dependents, small body) yields 36 hits at `deps ≤ 2, body ≤ 20`, but the sample is dominated by registry and plugin members — `src/migrations/0.4.0.ts`, `src/garden/detectors/adr.ts`, `src/core/agent-runner/runners/stub.ts` — which have one dependent *by design*. With no waiver list, every new migration or detector would red the gate. *Pass-through-chain counting* (each link having exactly one dependent) finds 3 chains in the entire repo, and all 3 are that same registry pattern. Closure measurement is immune to both, because a registry member's own closure is small.

### Unit 3 — baseline and ratchet

The ratchet number is the **excess sum**: `Σ max(0, closure(m) − 30)` over every module. It is **882** on this repo today.

A count of flagged modules — the obvious first choice, and this spec's own first draft — cannot see the worst kind of deepening. A module whose closure grows from 31 to 100 leaves the count unchanged, and the count can stay flat while one module crosses the threshold and another drops below it. The excess sum moves by 69 on that same growth and still registers a crossing as +1. Summing *un*-thresholded closures was also rejected — it rises whenever any shared module gains a consumer, so ordinary clean feature work would red it.

**Registry immunity is conditional, not absolute, and the condition is measured.** A registry *member* always contributes 0, because its own closure is small. The *aggregator* is the exposed case: it reaches every member, so once the aggregator's own closure exceeds the threshold, each added member raises its excess by one — and that of every flagged module whose closure contains it. Measured on this repo: `src/migrations/registry.ts` closure 14, `src/core/agent-runner/registry.ts` 15, `src/invariants/index.ts` 13 — all far below 30, so adding a migration or a runner costs exactly 0, and no flagged module contains `migrations/registry.ts` at all. The one aggregator above the line is `src/garden/garden-detect.ts` at 72, where adding a garden detector costs +1 against a total of 882. So the exposure is real but bounded to aggregators that are already deep, and its magnitude there is noise rather than a gate event. What the framework must not claim is blanket immunity.

**Offsetting is intentional.** Like every aggregate ratchet, this one is fungible: a module deepening by 69 can be masked by 69 of reduction elsewhere and `check` stays green. That is the same property `duplicatedTokens` has in the clone ratchet, and it is the price of a single whole-corpus number that a human can hold. The per-module rows in `report` are what makes a masked rise visible to anyone who looks; the ratchet is a floor against drift, not a per-module assertion.

The number is absolute rather than a ratio, for the reason `src/clones/baseline.ts` gives in its own header: a ratio moves for reasons unrelated to the thing being ratcheted.

`.noldor/indirection-baseline.json` is tracked. Schema, validated with Zod and `.strict()` like every other state file in the repo:

| Field | Type | Role |
| --- | --- | --- |
| `excessSum` | non-negative int | **the ratchet number** — the only field compared |
| `flaggedModules` | non-negative int | descriptive; printed, never compared |
| `modulesScanned` | non-negative int | descriptive |
| `percentiles` | `{ p50, p75, p90, p99, max }`, non-negative ints **or `null`** | descriptive; `null` throughout when no modules were measured, since nearest-rank and max are undefined on an empty vector |
| `options` | `{ threshold: positive int, scanRoots: string[], includeTests: boolean }` | comparability guard |
| `algorithmVersion` | positive int | comparability guard |
| `recordedAt` | ISO-8601 UTC string | provenance |

Written through `atomicWriteFileSync` and read through `readJsonState`, as clones does. Paths are stored repo-relative and POSIX-separated so a baseline recorded on one platform compares on another.

**Comparability: stale is reported, never red.** A baseline whose `options` or `algorithmVersion` differ from the current run is not comparable, so `check` reports it as **stale and exits 0** — it does not compare the numbers and it does not red. This follows the sibling verbatim (`src/clones/baseline.ts:113-116`: *"`stale` means the baseline was recorded under different detection knobs, so the two numbers are not comparable — reported, never red, because the mismatch is a config change rather than new duplication"*), and the reason generalises exactly: `scanRoots` and `includeTests` are **consumer-owned**, so a consumer editing `scanPaths` in `.noldor/config.json` would otherwise have every push hard-blocked until they rebaselined, with no framework migration able to ship for a knob the framework does not own. Reding on a config change punishes the wrong event.

`algorithmVersion` exists because `options` alone cannot catch a change in how the closure is *computed*: a fix to alias or dynamic-import handling changes every number without changing a knob, and silently comparing across that boundary is worse than reporting stale. Implementations bump it whenever the traversal changes.

**Absent baseline is green**, matching `clones-cli.ts:229` (*"Absent baseline is green — a consumer that never ran"*). A consumer installing Noldor has no baseline file, and a blocking gate that reds until someone runs an unfamiliar command is an adoption blocker. `report` and `check` both say plainly that no baseline is recorded and name the command that records one.

**Threshold retunes still ship a migration.** Stale-not-red already means a retune cannot break a consumer's push, so the migration is no longer load-bearing for safety — but a permanently stale baseline is a silently disabled gate, which is worse than a noisy one. Any release changing `INDIRECTION_CLOSURE_THRESHOLD` or `algorithmVersion` therefore ships a `src/migrations/<version>.ts` step that re-records the baseline under the new knobs, in the same slot `src/migrations/registry.ts` already dispatches, so the gate comes back live without the consumer having to notice. A consumer-owned knob change (`scanRoots`, `includeTests`) has no migration and is repaired by running `indirection baseline`, which the stale message names.

**Drift is reported in both directions.** `check` prints the delta against the baseline whether it rose or fell, and a fall is surfaced as recoverable slack rather than passing silently, so `baseline` is understood as a ratchet-down move and not only an unblock move.

### Unit 4 — CLI

`pnpm noldor indirection <report|check|baseline>`, mirroring `clones-cli.ts` — a separate module from the engine, matching the `c59`/`c66` split above.

**Exit contract, per subcommand.** Codes follow the sibling (`clones-cli.ts:141` returns 3, `:185` returns 1), and keeping 3 distinct from 1 is the whole point — the comment at `clones-cli.ts:133` states it as *"Exit 3 (not 1) keeps 'could not look' distinct from 'found duplication'"*. A pre-push consumer acts on that distinction: 1 means fix or rebaseline, 3 means the gate did not run.

| | `report` | `check` | `baseline` |
| --- | --- | --- | --- |
| Clean run | 0 | 0 | 0 |
| Excess sum above baseline | 0 (prints it) | **1** | 0 (records it, prints the direction) |
| Baseline absent | 0 | **0**, "no baseline recorded" | 0 |
| Baseline stale (`options` / `algorithmVersion` differ) | 0 | **0**, reported stale | 0 (overwrites) |
| Baseline unreadable / malformed | 0 | **3** | **0 — overwrites** |
| No usable parser | **3** | **3** | **3** |
| Unresolved-in-scope import | 0 (lists them) | **3** | **3** |

`baseline` **writes unconditionally**, reading the prior file only to name the direction of the change. Refusing to overwrite an unreadable or stale baseline would be a deadlock, since re-recording is the only repair for exactly those states; the sibling behaves the same way (`clones-cli.ts:158-161` reads `prior` solely for the drift line and calls `writeBaseline` regardless). It does still refuse on a broken *graph* — no parser, or an unresolved-in-scope import — because recording a number measured over an incomplete graph would bless a wrong baseline as truth.

`report` never fails on a verdict; it fails only when it could not measure. That keeps it usable as a diagnostic in exactly the states where `check` is red or refusing.

`report` prints, in this order: the excess sum and the recorded baseline; the percentile block (p50, p75, p90, p99, max, computed by nearest-rank on the ascending closure vector); then one row per flagged module — path, closure size, excess — sorted by closure descending, path ascending as tiebreak, so output is stable across runs and diffable.

### Unit 5 — parser availability

`dependency-cruiser` parses TypeScript through `typescript` (which it accepts only at `>=2 <6`) or `@swc/core`. This repo is on TypeScript 7, so swc is the only working parser, and without it `cruise` returns zero modules — a clean green over an unparsed tree. `boundaries.ts:107-124` already documents this and guards it with `findUnparseableTsExtensions(allExtensions)`; the new detector reuses that guard and exits 3 rather than reporting a number.

Zero modules is separately disambiguated from a broken run, and the enumerator is named rather than implied: the candidate set is `walkCodeFiles(root, { includeTests: true })` over each scan root. If it returns no files, the repository is genuinely empty for our purposes — exit 0, excess sum 0, `percentiles: null`. If it returns files but `cruise` yields no modules, that is a parser or resolution failure — exit 3.

Naming the enumerator matters because `walkCodeFiles` skips `WALK_EXCLUDED_DIRS` (`repo-paths.ts:75-83`: `node_modules`, `dist`, `.turbo`, `coverage`, `.git`, **`fixtures`**). A tree living under any of those is invisible to the walker, so it would be classified "empty repository, exit 0" rather than exit 3 — which would let the exit-3 acceptance criterion pass vacuously green. The Testing section's fixture trees therefore must **not** live under a path segment named `fixtures`; they live under `src/indirection/__tests__/trees/<case>/` and are addressed as explicit scan roots. `includeTests: true` is deliberate here: this walk answers "does any source file exist", not "what do we measure", so excluding tests would misreport a test-only tree as empty.

`@swc/core` is currently a **devDependency** while `dependency-cruiser` is a production dependency. A consumer installing Noldor therefore gets the cruiser and no parser. For a blocking, consumer-shipped gate that is fatal, so `@swc/core` moves to `dependencies`. This also closes the same latent hole for the existing `boundaries` invariant, which consumers already run under `checks invariants`.

### Unit 6 — wiring, registration and consumer shipping

A `noldor-indirection` pre-push job beside `noldor-clones` in `lefthook/noldor.yml`, and the same in the templated copy so consumers receive it. Because `checks push-gates` replays lefthook itself rather than an enumeration, the gate is preflighted at gate Step 4 with no edit to the gate skill's prose.

The command must also be **registered**, or it cannot be committed: `src/cli/manifest.ts` gets an `indirection` leaf beside `clones` (`manifest.ts:459`), and `docs/noldor/script-catalog.md` gets the matching entry. `validate script-catalog` is a pre-commit job globbed on exactly those two files (`lefthook/noldor.yml:86-88`) and blocks on any manifest leaf `src` path no catalog link reaches.

### Testing

Per `docs/noldor/testing-principles.md`, assertions are on the detector's own counters against **dedicated fixture trees**, never live `src/` — that file records the Q-0122 lesson, where tests pinned to real code went green for the wrong reason once the code was refactored.

Fixture trees live under `src/indirection/__tests__/trees/<case>/` and are passed as explicit scan roots. They must not sit under a path segment named `fixtures`, `dist`, `coverage` or `.turbo` — `walkCodeFiles` skips those (`WALK_EXCLUDED_DIRS`), which would make the empty-versus-broken assertions pass vacuously against a tree the walker cannot see.

Cases: a deep chain with a hand-computable closure; a shallow registry whose aggregator sits below threshold (adding a member must cost 0); a deep registry whose aggregator sits above it (adding a member must cost exactly the predicted amount); a tree exercising alias, directory-index and dynamic-import edges; a tree with an unresolved relative import and one with an unresolved bare specifier, which must be classified differently; and an empty scan root.

The **no-parser** case is deliberately not a fixture tree — parser availability is a process condition, and after `@swc/core` moves to `dependencies` the test environment always has it. `findUnparseableTsExtensions` takes the availability report as a parameter, so the guard is tested by passing a synthetic report, and the zero-modules-versus-empty-repo split is tested by pairing that synthetic report with a non-empty tree.

## Acceptance criteria

1. A module's closure equals the number of distinct in-repo files transitively reachable through its imports, excluding itself, on a fixture with a hand-computed answer.
2. `import type` edges are counted; edges into `node_modules`, other workspace packages, and `.d.ts` files are not.
3. Alias, directory-index and string-literal dynamic-import edges are counted; a dynamic import with a non-literal specifier is ignored.
4. Files matching `TEST_FILE_RE` (including `*.spec.ts`) and files under `__tests__` contribute no modules and no edges; a `.mts` file is not measured at all.
5. The ratchet number equals `Σ max(0, closure − threshold)`; on a fixture where one already-flagged module's closure rises with no module crossing the threshold, the number increases.
6. In a wide-registry fixture whose aggregator closure is **below** threshold, adding a member leaves the ratchet number unchanged; in one whose aggregator is **above** threshold, adding a member raises it by exactly one per flagged module reaching the aggregator.
7. `baseline` writes `.noldor/indirection-baseline.json` carrying `excessSum`, `options` and `algorithmVersion`; re-reading it round-trips through the Zod schema.
8. `check` exits **0** when the excess sum is at or below the baseline, and **1** when it exceeds it.
9. `check` exits **3**, not 1, for: no usable parser, an unresolved-in-scope import (relative or alias specifier), and an unreadable baseline.
10. `check` exits **0** for each of: an absent baseline, an `options` mismatch, and an `algorithmVersion` mismatch — the latter two reported as stale, with the numbers not compared.
11. A `couldNotResolve` on a **bare package specifier** does not make `check` exit 3.
12. `baseline` exits 0 and overwrites when the existing baseline is unreadable or stale, and exits 3 without writing when no parser is available or an unresolved-in-scope import exists.
13. Given files under a scan root but zero modules from `cruise`, `check` exits 3; given a scan root `walkCodeFiles` finds no files in, it exits 0 with excess sum 0 and `percentiles: null`.
14. `report` output is byte-identical across two runs on an unchanged tree, names p50/p75/p90/p99/max, and exits 0 when `check` would exit 1.
15. `check` prints the signed delta against the baseline when the number falls as well as when it rises.
16. `.noldor/rules/abstraction-cost.md` resolves into the `enforce` bucket for both a `.ts` and a `.tsx` file under `src/` at `code` stage; `rules validate` passes; the file and its `templates/` twin are byte-identical and `checks template-sync` passes.
17. `@swc/core` is in `dependencies`; `validate script-catalog` passes with the new `indirection` manifest leaf; `checks push-gates` runs the `noldor-indirection` job.

## Risks / trade-offs

- **A blocking, consumer-shipped gate with no waiver list lands an uncalibrated signal in other people's repos.** Chosen deliberately over a waiver escape; mitigated by rebaselining being one command, by an absent baseline being green, and by the signal being structurally immune to the registry pattern that was the measured false-positive family. Still the largest risk here.
- **A new deep module is the most likely red, and the ordinary answer is to rebaseline.** Any newly added orchestrator or CLI whose own closure exceeds the threshold raises the number — this feature's own `indirection-cli.ts` will, since it reaches `scanRoots`, `loadConfig`, `cli-entry`, the engine and the baseline store. If rebaselining is the reflex, the ratchet degrades toward a rubber stamp. Bounded by reporting drift in both directions (Unit 3) so a rise is always visible in review as a recorded number rather than an invisible reset.
- **Adding a genuinely shared utility raises the number by one per flagged module that reaches it.** Intended — a new file-crossing dependency for many deep modules is a real cost — but it will occasionally red a change that is on balance good.
- **The threshold is one constant for every repo.** A repo legitimately deeper than this one starts with a high baseline, which is harmless since only growth is measured, but its first `baseline` run silently blesses whatever it has.
- **Excess sum is less legible than a count.** "882 → 894" says less at a glance than "38 → 39 modules", which is why `report` prints the per-module rows and `check` prints the signed delta.
- **Offsetting can mask a real regression.** A deepening of 69 in one module is invisible if 69 of reduction lands elsewhere in the same push. Inherent to any single aggregate number, and shared with the clone ratchet; the per-module rows are the only defence, and they require someone to look.
- **A deep aggregator taxes its own extension.** Where a registry's aggregator is already above the threshold — `garden/garden-detect.ts` at 72 — every new member costs +1. Small in absolute terms against 882, but it means the gate charges a little for a growth pattern the framework actively encourages, and that will occasionally read as unfair to whoever pays it.
- **Stale-not-red means a misconfigured consumer silently has no gate.** Reporting rather than reding on a knob mismatch is the right call for a config change, but a consumer who edits `scanPaths` and ignores the stale line keeps pushing with the ratchet effectively off until they rebaseline.
- **The two ratchets can in principle disagree on one commit.** In practice rarely: an honest Rule-of-3 extraction has three dependents and a small closure, so it lowers the clone number without raising this one.

## User Story

As an engineer or agent changing code in a Noldor repo, I want the framework to price cross-file indirection the way it already prices duplication, so that clearing the clone gate cannot quietly push me into an abstraction that costs more than the duplication it removed.

## Usage

```
pnpm noldor indirection report      # excess sum, percentiles, flagged modules
pnpm noldor indirection check       # compare against the recorded baseline
pnpm noldor indirection baseline    # record the current number as the baseline
```

`check` runs as the `noldor-indirection` pre-push job and is replayed author-side by `pnpm noldor checks push-gates` before the code-stage review earns its receipt. Exit 1 means the number rose: reduce the indirection, or re-record with `pnpm noldor indirection baseline` and commit the baseline alongside the change. Exit 3 means the gate could not run and names why.

The rule reaches authors through `pnpm noldor rules brief --file <path> --stage code`, which lists it under `ENFORCE`.

## Open questions (resolved)

1. *What closure threshold flags a module?* → **30**, the measured p90 of this repo. (D1) It flags 38 of 401 modules (9.5%), and the flagged count is flat across 30–35 (38 then 36), so the verdict sits on a plateau rather than a cliff — which matters for a constant shipped to repos it was never measured against. Below that it climbs steeply (57 at 20, 72 at 15) and stops discriminating; at 50 it tracks only the 13 orchestrators already known to be deep.

2. *Count of flagged modules, or excess sum?* → **Excess sum.** (D2) A count cannot see a closure growing 31 → 100, and can stay flat when one module crosses while another drops below. The excess sum moves 69 on that growth, registers a crossing as +1, and still contributes 0 for every registry member.

3. *Does the feature also ship a diff-scoped gate, the way clones runs one beside its corpus ratchet?* → **No.** (D3) A clone group is a local, attributable fact about the lines a change touched. Closure is a whole-graph property — a module's closure grows because of an edge added elsewhere — so a diff-scoped verdict would routinely name a file the change never opened. Corpus ratchet only; revisit if it proves too coarse.

4. *Does a barrel-only signal ship?* → **No.** (D4) It is an export-side fact, `cruise()` reports dependencies rather than exports, and TypeScript 7 exposes no in-process parser, so the only implementation is a source regex — which cannot honestly claim to be false-positive-free and would be calibrated against the zero barrels this repo contains. Barrels stay covered by the prose rule.

5. *What happens on a consumer with no baseline?* → **Green**, with a message naming the command that records one. (D5) This matches `clones-cli.ts:229`, and a blocking gate that reds on first install is an adoption blocker — which `docs/vision.md` ranks above internal polish.

6. *What invalidates a baseline, and what happens then?* → **A differing `options` block or `algorithmVersion` makes it stale; `check` reports and exits 0, never 1 or 3.** (D6) `options` alone cannot catch a change in how the closure is computed — a fix to alias handling moves every number without moving a knob — so `algorithmVersion` exists to catch that. Neither reds, because `scanRoots` and `includeTests` are consumer-owned: reding would hard-block every push in a repo that merely edited `scanPaths`, with no framework migration possible for a knob the framework does not own. This is the sibling's rule verbatim (`clones/baseline.ts:113-116`).

7. *Which unresolved imports are fatal?* → **Only relative and `tsconfig`-alias specifiers**; never bare package specifiers. (D7) dependency-cruiser reports `couldNotResolve` for healthy reasons on bare specifiers — an uninstalled optional peer, a package whose `types` entry does not resolve — so treating those as failures would hard-block pre-push in consumer repos that are fine, while an unresolved relative import genuinely means the measured graph is incomplete.

8. *Which extensions are measured?* → **`CODE_FILE_RE` only: `.ts`, `.tsx`, `.js`, `.jsx`.** (D8) `.mts`/`.cts` are excluded because `TEST_FILE_RE` would not exclude their test files and `TS_EXTENSIONS` would not catch them in the parser guard — measuring them would silently reopen both holes this design closes. Widening is a coordinated change to all three constants, not to this detector.
