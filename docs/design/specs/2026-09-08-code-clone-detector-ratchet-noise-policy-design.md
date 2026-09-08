# Clone-Ratchet Noise Policy — Design

**Slug:** code-clone-detector-ratchet-noise-policy
**FD:** docs/features/code-clone-detector.md
**Date:** 2026-09-08
**Tier:** specs-only
**Deps:** none

## Problem

The whole-corpus duplication ratchet (`compareToBaseline`,
`src/clones/baseline.ts`) reds when `duplicatedTokens` grows, and it has forced
a hand re-record of `.noldor/clones-baseline.json` twice. The roadmap entry
(Q-0214) attributes that to three classes of match that are not copied logic:
test scaffolds, thin typed façades, and leading import runs.

**One of those three is already handled.** `walkCodeFiles`
(`src/core/repo-paths.ts:97-106`) skips `*.test.*`, `*.spec.*` and
`__tests__/` unless `includeTests` is set; `includeTests` defaults to `false`
(`src/clones/clones-cli.ts:51`) and the pre-push job
(`lefthook/noldor.yml:128`) runs `pnpm noldor clones check` with no
`--include-tests`. The recorded baseline confirms it end-to-end:
`options.includeTests` is `false` and its `perFile` map contains zero test
files. A case added to a table-driven test file cannot move the ratchet today,
so whatever forced the two hand re-records, it was not test scaffolds. Unit 5
records that fact so the claim is not re-filed.

The other two axes are real and measurable. On the corpus at this commit
(289 groups, 28841 duplicated tokens, 340064 total):

| Axis | Groups | Duplicated tokens | Share |
| --- | --- | --- | --- |
| Import-dominated spans | 43 | 2377 | 8.2% |
| Delegation-only spans (`return <call>(…)`) | 8 | 503 | 1.7% |
| Test scaffolds | 0 | 0 | 0% |

Both classes are artifacts of Type-2 normalization rather than duplication a
refactor could remove. An import block is a *consequence* of a file's
dependencies — two files importing the same six symbols produce identical
normalized runs, and the only way to "fix" it is to import less. A run of thin
typed façades (`src/design/design-approval.ts:63-92` vs
`src/design/ui-capture.ts:76-108`) is a set of one-line delegations to an
already-shared receipt store, each binding a different schema, directory tuple
and return type; the normalizer folds every identifier to `ID`, so the
differences that make those façades worth having are exactly the ones it
erases. Extracting a shared wrapper there is strictly worse: one untyped
generic, indirection added, zero logic shared.

## Goals

- A file pair whose only structural overlap is a head-of-file import block
  plus a delegating one-liner produces no clone group.
- The ratchet stops charging a PR for duplication it did not introduce, so a
  re-record commit becomes evidence of a real change rather than paperwork.
- Every existing baseline — this repo's and every consumer's — keeps parsing.
  A policy change may make a baseline *incomparable* (reported, never red); it
  must not make one unreadable.
- Real duplication keeps being reported: a copied schema, a copied pipeline,
  or a copied handler is unaffected.

## Non-goals

- Re-litigating test exclusion. It already works; Unit 5 only corrects the
  record.
- Type-4 / semantic clone detection. Out of scope for the feature entirely.
- Tuning `minTokens` / `minLines` / `gapTokens`. The floors are not the
  problem — the token stream's content is.
- A per-group suppression file (`.noldor/clones-ignore`). An allow-list of
  accepted clones is a different and worse feature: it decays silently.
- An operator knob for this policy. See Unit 3.

## Design

### Structural context

Read from `pnpm noldor design graph-context` over the parent FD's `links.code`
(graph regenerated `--ast-only` at this commit; 3478 nodes, 9129 edges, 206
communities).

`src/clones/detect.ts`, `baseline.ts`, `diff-scope.ts` and `clones-cli.ts` all
sit in community **c12**, which the digest reports as owned by
`code-clone-detector` — the change is interior to its own feature's community,
the cheap case. `src/clones/tokenize.ts` is the exception: it lives alone in
**c115** with only its own test file alongside, bridged to c12 by two
`imports` / `imports_from` edges from `detect.ts`. The tokenizer is therefore a
leaf with exactly one consumer, and a change to the token stream propagates
through that single edge. No god node is defined anywhere in the clones module.

The edges that constrain the design are the ones leaving c12.
`clones-cli.ts` bridges to `src/core/config.ts` (**c95**) via `loadConfig()`,
and c95 is broadly imported — the digest names `orchestrate.ts`,
`garden-detect.ts`, `sdd-report.ts` and `index.ts` as cross-community
consumers. That breadth is the whole argument in Unit 3 for adding no config
knob: it would be the widest-reaching part of an otherwise interior change.
`clones-cli.ts` also bridges to `src/core/repo-paths.ts` (**c32**) via
`scanRoots()`, which is where the existing test-file predicate already lives —
Unit 5's evidence. And `detect.ts` bridges to `src/garden/sdd-report.ts`
(**c7**), the one file in the digest that defines a god node (`main()`, rank
#9, 24 edges). `sdd-report.ts` consumes only the finished `CloneReport`, so
that god node is downstream of every decision here; it is not a constraint on
the design, but it is the reason the `CloneReport` shape does not change.

### Unit 1 — drop the head-of-file import run from the token stream

Import blocks are excluded in the tokenizer rather than filtered out of groups,
following the precedent already in the file: `collapseBuilderChains`
(`src/clones/tokenize.ts:119-201`) solved the structurally identical zod-schema
false positive by reweighting the token stream, and its comment explains why —
a group-level filter cannot see *why* a run matched, only that it did.

`tokenize` gains a head-of-file exclusion. While the scanner is still in the
module header, a statement beginning `import`, or `export` followed by a
`from`-clause re-export, emits no tokens through its terminating `;`. The
header ends at the first statement that is neither, and the exclusion never
resumes — one boolean in the existing linear loop is the entire mechanism.
Because the exclusion is scoped to the header, an `import()` expression in a
function body is untouched (it is not a statement start, and it is past the
header anyway), and a lazy re-export lower down keeps every token of its
weight.

Bounding the rule to the header is deliberate. A general "imports never count"
rule would leave an unbounded hole: a genuinely pasted block that happens to
open with an import statement would have that part of its weight erased. The
header restriction cannot do that, because by definition nothing precedes it.
The 43 measured groups are all head-of-file, so on today's corpus the narrow
and general rules are indistinguishable — the narrowness buys the future
failure mode, not present accuracy.

The exclusion runs before `collapseBuilderChains`, which is the existing final
pass over the token list, so the two compose without either needing to know
about the other.

### Unit 2 — do not report a group whose every span is pure delegation

A clone class survives to the report only if at least one of its spans holds a
statement that is not a delegation. A span is *pure delegation* when its
normalized token run contains no statement keyword other than `return` — no
`if`, `for`, `while`, `switch`, `try`, `const`, `let`, or `var`. That is
exactly the signature-plus-`return <call>(…)` shape of a thin typed façade.
A class whose every span is pure delegation is dropped; a class with even one
span carrying real control flow is kept in full, at full weight.

The predicate is computable from the normalized stream alone, with no source
re-read: every one of those keywords is in `KEYWORDS`
(`src/clones/tokenize.ts:24-88`), so the scanner keeps each verbatim in `norm`
rather than folding it to `ID`. The check is a scan of the token slice the
class already owns.

The filter is a class-level pass in `detectClones`, placed after the step-10
coarser-family dedup and **before** the coverage math at
`src/clones/detect.ts:441-473`. Position matters: `duplicatedTokens`,
`perFile` and `duplicationPct` are all computed from surviving class spans, so
filtering after that point would report fewer groups while still charging their
tokens to the ratchet — the worst of both. It clears `members` and `spans` the
way steps 9 and 10 already do, so one mechanism drops a class and both the
coverage map and the group list see it.

The looser predicate is chosen over "exactly one `return` and nothing else"
because a two-return delegation is the same non-duplication for the same
reason, and the `minTokens: 50` floor already excludes anything small enough
for the looser rule to catch by accident.

### Unit 3 — record the policy in the baseline options, with no knob

Both units change what `duplicatedTokens` counts, so a baseline recorded before
them is not comparable to a run after them. That state is already modelled:
`compareToBaseline` returns `stale` — reported, never red — when `sameOptions`
fails, with a re-record hint.

The policy therefore joins `BaselineOptions` and `sameOptions`, and it is
**unconditional**: no `.noldor/config.json` entry, no CLI flag. No repo has a
reason to ask for its own import headers to keep counting as duplication, and
a knob would cost a config schema entry, a validator entry and three
subcommand flags in `src/core/config.ts` — the widest-reaching file this change
goes near (c95, above) — to buy reversibility nothing needs. The options block
already delivers the actual requirement, which is that the policy boundary is
auditable rather than switchable.

**The new field must be `.optional()`.** `baselineOptionsSchema` and
`cloneBaselineSchema` are both `.strict()` (`src/clones/baseline.ts:36-38`), so
a required addition makes every existing baseline fail `safeParse`, which
`readBaseline` reports as `unreadable` rather than `stale` — and an unreadable
baseline turns the ratchet off in every consumer repo at once. With the field
optional, an old baseline parses, its absent value reads as the legacy policy,
`sameOptions` mismatches, and the run reports `stale` with the re-record hint.
That is the intended path. The same trap was hit and avoided when `perFile` was
added, and the reasoning is recorded in the schema comment beside it.

`describeOptions` gains the field too, so the `stale` message names the policy
that changed instead of listing four identical numbers.

### Unit 4 — re-record the baseline in the shipping commit

The change removes roughly 2880 duplicated tokens on the current corpus
(2377 + 503, less any overlap where a span is both import-dominated and
delegation-only). A decrease is green with a "lock the improvement in" hint, so
nothing forces a re-record — which is exactly how ~2880 tokens of silent slack
would survive into the next change. The shipping commit re-records
`.noldor/clones-baseline.json`.

### Unit 5 — correct the record on test scaffolds

One sentence in the parent FD's Summary stating that test files have been out
of the clone corpus since `includeTests` defaulted to `false`, and that a
table-driven test file therefore cannot move the ratchet. The FD is what a
reader consults before re-filing an entry; `ideas.md` is for unfiled lessons,
and this is a settled fact about shipped behavior.

## Acceptance criteria

1. A file pair whose only structural overlap is a head-of-file import block
   produces no clone group.
2. A file pair whose only structural overlap is a head-of-file import block
   plus a delegating one-liner produces no clone group.
3. A genuinely copied schema declaration — dozens of fields, real bodies —
   still produces a group, so Unit 1 has not become a general logic exclusion.
4. A copied block that begins with an import statement but appears after the
   module header contributes its full token weight.
5. An `import()` expression inside a function body still contributes tokens.
6. A class in which one span carries control flow and another is pure
   delegation is still reported, at full weight.
7. A baseline recorded under the previous policy parses successfully, is
   reported `stale` rather than `unreadable`, and does not turn the run red.
8. `duplicatedTokens` after the change is lower than before on the repo's own
   corpus, and `perFile` still sums exactly to `duplicatedTokens`.
9. `pnpm noldor clones check` exits 0 against the re-recorded baseline at the
   shipping commit.
10. Adding a case to a table-driven test file does not change
    `duplicatedTokens`.

## Risks / trade-offs

**Suppression and improvement look identical in the number.** The ratchet
records one integer, so a 2880-token drop means "the policy changed", not
"someone deleted a clone", and only the commit distinguishes them. The `stale`
verdict plus the recorded policy field is the mitigation: the number is
explicitly marked incomparable across the boundary rather than quietly
improved.

**`totalTokens` moves too, so `duplicationPct` shifts.** Unit 1 removes tokens
from the denominator as well as the numerator, and the two do not move
proportionally, so the reported percentage changes by an amount this spec does
not predict. That matters only for `clones.thresholdPct`, an independent
verdict from the ratchet — unset in this repo, so permanently green here, but a
consumer running close to its threshold could flip in either direction on
upgrade. The `stale` verdict does not cover this: `thresholdPct` compares
against a configured constant, not against the baseline. Accepted and recorded
rather than mitigated; a consumer that trips it re-tunes one number.

**Unit 1 can hide a genuinely copied module header.** Two files with an
identical pasted import block stop being reported. Accepted: a copied import
block is not a refactoring target, and the header restriction bounds the blast
radius to exactly the region where that holds.

**Unit 2's predicate is syntactic, not semantic.** A span containing only
`return` statements that nonetheless does real work inside its call arguments —
a nested ternary, a long expression — reads as pure delegation and is dropped.
The `minTokens: 50` floor makes this unlikely (a delegation that long is
usually mostly signature) but not impossible.

**The two units are independently sized.** Unit 1 is 8.2% of the number,
Unit 2 is 1.7%. They ship together because they share one test fixture and one
baseline re-record; if implementation finds Unit 2's predicate contentious, it
can be dropped without touching Unit 1.

## User Story

As a framework maintainer, I want the duplication ratchet to ignore module
import headers and pure delegations, so that a red ratchet means someone
actually copied logic and a re-record commit is evidence rather than routine
paperwork.

## Usage

No new operator surface. The policy is the behavior of
`pnpm noldor clones report | baseline | check` and is recorded in
`.noldor/clones-baseline.json`'s `options` block.

First run after upgrading, in any repo carrying a baseline:

```
pnpm noldor clones check      # 'stale' — recorded under a different policy, not red
pnpm noldor clones baseline   # re-record under the new policy
pnpm noldor clones check      # green
```

## Open questions (resolved)

1. *Ship both units, or the import-run exclusion alone?*
   -> **Both.** (D1) They share one test fixture and one baseline re-record, so
   Unit 2's marginal cost is small next to its 1.7%; a separate entry would pay
   the whole re-record and stale-verdict ceremony again for 503 tokens.

2. *Should Unit 1 exclude only the head-of-file import run, or every top-level
   import wherever it appears?*
   -> **Head-of-file only.** (D2) One boolean in the existing scanner loop is
   the whole cost, and the two rules are indistinguishable on real ES modules
   today — so the choice buys the failure mode, and the general rule leaves an
   unbounded hole for a pasted block that happens to open with an import.

3. *Should the policy be operator-configurable?*
   -> **No. Unconditional, recorded in the options block.** (D3) A knob costs a
   config schema entry, a validator entry and three CLI flags in the
   widest-reaching community this change touches, for a policy nobody has a
   reason to turn off. The options block already makes the boundary auditable.

4. *Should Unit 2's predicate be "no statement keyword but `return`" or
   "exactly one `return` and nothing else"?*
   -> **No statement keyword but `return`.** (D4) A two-return delegation is
   the same non-duplication for the same reason, and the `minTokens: 50` floor
   already excludes anything small enough for the looser rule to catch by
   accident.

5. *Where does the falsified test-scaffold claim get recorded?*
   -> **The parent FD's Summary, one sentence.** (D5) `ideas.md` is for unfiled
   lessons; this is a settled fact about shipped behavior, and the FD is what a
   reader consults before re-filing the same entry.

6. *Does the shipping commit re-record the baseline, or is that left to the
   operator?*
   -> **The shipping commit re-records it.** (D6) A decrease is green, so
   nothing forces the re-record — which is exactly how ~2880 tokens of silent
   slack would survive into the next change.
