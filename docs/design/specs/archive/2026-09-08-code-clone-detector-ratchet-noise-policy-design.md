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

`tokenize` gains a head-of-file exclusion built as a **bounded forward match
against the import grammar** — not as a statement-boundary scan. While the
scanner is still in the module header it attempts, at each statement start, to
match one of the two excluded declaration shapes. A match consumes and discards
its tokens; a failure emits the tokens it inspected verbatim and ends the
header, which never resumes.

A **leading shebang is skipped before matching begins.** `src/clones/tokenize.ts`
emits `#` and `!` as ordinary punctuation (`:308-310`), so a `#!/usr/bin/env …`
first line otherwise fails the match at token one, ends the header immediately,
and leaves the file's whole import block counted. That is not hypothetical:
`src/graphify/graph-to-toon.ts:1` is exactly this file, with its imports at
`:15-16`. Everything from a leading `#` to the first newline is dropped, the
same way the existing comment handling drops a `//` run.

The two shapes are then matched positionally, and both end at the **module
specifier** — a `LIT` token — followed by an optional import-attributes clause
and an optional `;`:

- **Static import** — `import`, an optional `type`, then either a bare `LIT`
  (side-effect import), or a clause (`*` `as` ID | `{` … `}` | ID, optionally
  `,` then one of those) followed by `from` and a `LIT`.
- **Re-export** — `export`, an optional `type`, then `*` (optionally `as` ID)
  or `{` … `}`, followed by `from` and a `LIT`.
- **Attributes tail (both shapes)** — after the `LIT`, an optional
  `with` `{` … `}` (also the legacy `assert` `{` … `}`), consumed as part of
  the declaration.

Consuming the attributes tail is required, not thoroughness. Terminating at the
`LIT` alone *succeeds* on `import data from './data.json' with { type: 'json' }`
and discards the declaration, leaving the orphan `with { type: 'json' }` tokens
at the next statement start; those fail the match, get emitted, and **end the
header** — so every later import in that file silently stops being excluded.
The failure is not that the attribute tokens are counted, it is that the header
closes early and the rest of the block is counted too.

**The module specifier is the terminator, so no statement-boundary rule is
needed at all.** This is what makes the unit implementable in a scanner rather
than a parser. Newlines are already whitespace to `tokenize`, so
`import { Foo }` / newline / `from './m.js'` matches exactly like its
single-line form, and a `semi: false` repo needs no special handling — the
match simply stops at the `LIT` and takes a following `;` if one is there.
There is no ASI to approximate, and there is no unbounded buffer: the match
either completes at a `LIT` or fails, and a failure emits.

The failure direction is the safety property. `import('./x.js')` fails at the
second token (`(` is not `type`, a clause opener, or a `LIT`), and
`import.meta.url` fails the same way, so both keep every token. `export const
from = startOfDay(x)` fails at `const`, which is neither `type`, `*` nor `{` —
so it is emitted *and* ends the header, and the statement after it is counted
too. A token-search for a depth-0 `from` would have discarded it, because
`from` is a keyword in this scanner (`src/clones/tokenize.ts:49`) and stays
verbatim in `norm`: real code deleted from the corpus, with the exclusion left
running into the next statement. Positional matching cannot reach that state.

If the match runs off the end of the file without reaching its `LIT`, the
inspected tokens are **emitted, not discarded** — `tokenize` is documented as
never-throw / degrade-gracefully (`src/clones/tokenize.ts:203`), and the same
posture applies here: malformed input costs a few extra tokens rather than
deleted code.

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
statement that is not a delegation. A span is *pure delegation* when **both**
of these hold:

- it contains **no disqualifying keyword** — none of `if`, `for`, `while`,
  `switch`, `try`, `const`, `let`, or `var` — and
- it contains **at least one real return statement**, per the token test below.

That is the signature-plus-`return <call>(…)` shape of a thin typed façade. A
class whose every span is pure delegation is dropped; a class with even one
span failing the predicate is kept in full, at full weight.

**The positive requirement is load-bearing**, and stating the predicate as an
absence alone would be a defect rather than a shorthand: a span with *no*
keyword at all vacuously satisfies "none of the above". A copied
object-literal body, a copied `interface` or `enum`, or a match landing
mid-declaration so its `const` falls outside the span, carries no keyword
whatsoever and would be classified as delegation and silently dropped — a
genuinely copied declaration disappearing from the report, which contradicts
the Goals outright, and the `minTokens: 50` floor does not protect against it.
The positive requirement also keeps a copied sequence of side-effect calls or
property assignments reported, since such a span has neither a return statement
nor another keyword.

**A real return statement is identified by three local token tests, not by its
container.** `return` is a legal member name and a legal property key in
TypeScript, so the token alone proves nothing. A `return` counts only when all
three hold:

1. The preceding token is not `.` — excludes a method call such as
   `iterator.return()`.
2. The following token is not `:` — excludes an object-literal or type-member
   property key such as `{ return: 1 }`.
3. Stepping over an optional `?` — and re-applying test 2 after it, since an
   optional *property key* `return?: string` is still a property key — then
   over an optional balanced `<…>`, if the next token is `(`, the token after
   that parenthesis group's matching `)` is not `:`. This excludes
   `return(v: T): T` and equally its `return?(…)`, `return<T>(…)` and
   `return?<T>(…)` forms, while keeping the legal statements `return (foo)` and
   `return (a, b)`, whose `)` is followed by `;` or the span's end. The marker
   steps are load-bearing rather than thoroughness: without them neither test
   fires on an optional or generic member, so a copied `interface` declaring
   one is dropped — the exact silent loss test 3 exists to prevent.

   The `<…>` scan does **not** bail on a `(`, because a constraint may
   legitimately contain one (`<T extends (x: string) => string>`); it ignores
   the `>` of an `=>` (which scans as `=` then `>`), bails on a `;`, and treats
   an unclosed list as *not* a return statement — so an unparseable form leaves
   the class reported rather than deleting it. A `<` directly after `return`
   can only open type parameters or a type assertion, never a comparison, which
   is what makes the scan safe to start at all.

All three are **local to the `return` token**, which is the property that
matters here. Clone spans are raw token-index ranges produced by window
matching and greedy extension (`src/clones/detect.ts:271-274`) with no
declaration alignment, so a copied `interface I { … }` frequently matches from
*inside* the braces — the `interface` keyword falls outside the span entirely.
Any guard that disqualified the container would therefore not fire on exactly
the spans that need it, whereas test 3 examines the `return(v: T): T` member
itself and fires wherever the span happens to start.

For the same reason `interface`, `type`, `enum` and `class` are **not** in the
disqualifying keyword list. Beyond being unsound mid-span, `type` and `class`
are ordinary object-literal property keys (`{ type: 'json' }`, `{ class: 'btn' }`)
that this scanner keeps verbatim in `norm` because both are in `KEYWORDS`
(`src/clones/tokenize.ts:24-88`) — so including them would disqualify genuine
delegation bodies that forward such a literal, costing recall to buy a guard
that test 3 already provides.

`function` and `export` are likewise not disqualifying: the measured façade
group (`src/design/design-approval.ts:63-92`) is a run of
`export function … { return … }`, so either would empty Unit 2 of its only real
subject.

Everything here is computable from the normalized stream with no source
re-read: the keywords stay verbatim in `norm`, and `.`, `:`, `(` and `)` are
single-character punctuation the scanner keeps as-is
(`src/clones/tokenize.ts:308-310`). No test depends on a preceding `{` or `;`,
so the predicate is unaffected by whether the source carries semicolons — a
`semi: false` delegation body reading `doThing()` newline `return g(a)` matches
exactly like its semicolon-terminated form.

**The per-axis figures were pre-implementation estimates.** They were taken
with coarser predicates than the ones specified here, so criterion 14 asserts
only that `duplicatedTokens` falls, not by how much. Measured after
implementation, the two units together take the corpus from 28841 duplicated
tokens across 289 groups to 25796 across 233 — 3045 tokens and 56 groups.

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

The policy is recorded as **one named field, `noisePolicy`**, a monotonically
increasing policy generation rather than a set of per-unit booleans — a single
integer keeps `sameOptions` a scalar comparison and lets a future noise rule
bump the generation without another schema field.

- **Schema:** `noisePolicy: z.number().int().nonnegative().optional()` on
  `baselineOptionsSchema` (`src/clones/baseline.ts:36-38`).
- **Value new baselines write:** `1`, exported as a named constant
  (`CURRENT_NOISE_POLICY`) so the write site and the compare site cannot drift.
- **Legacy representation:** absent. Absence means generation `0` — the policy
  in force before this change.
- **Comparison:** `sameOptions` compares `(a.noisePolicy ?? 0) === (b.noisePolicy ?? 0)`.
  What the coalesce buys is that a legacy baseline's *absent* value equals an
  explicit `noisePolicy: 0` — nothing more. It is **not** what guards the
  optionality trap below: two `undefined`s already compare equal, and since the
  `now` side always stamps `CURRENT_NOISE_POLICY` the coalesce on that side is
  dead. The guard is the both-write-sites rule, stated below.
- **`describeOptions`:** renders `noise-policy ${o.noisePolicy ?? 0}` — the same
  coalesce as the comparison, so a legacy consumer's `stale` message reads
  `noise-policy 0` against `noise-policy 1` rather than `noise-policy undefined`,
  and actually names the generation that changed.

It is **unconditional**: no `.noldor/config.json` entry, no CLI flag. No repo
has a reason to ask for its own import headers to keep counting as duplication,
and a knob would cost a config schema entry, a validator entry and three
subcommand flags in `src/core/config.ts` — the widest-reaching file this change
goes near (c95, above) — to buy reversibility nothing needs. The options block
already delivers the actual requirement, which is that the policy boundary is
auditable rather than switchable.

**The field must be `.optional()`.** `baselineOptionsSchema` and
`cloneBaselineSchema` are both `.strict()`, so a required addition makes every
existing baseline fail `safeParse`, which `readBaseline` reports as
`unreadable` rather than `stale` — and an unreadable baseline turns the ratchet
off in every consumer repo at once. With the field optional, an old baseline
parses, its absent value reads as generation `0`, `sameOptions` mismatches, and
the run reports `stale` with the re-record hint. That is the intended path. The
same trap was hit and avoided when `perFile` was added, and the reasoning is
recorded in the schema comment beside it.

**Optionality creates a second trap, and both write sites must stamp the
field.** `compareToBaseline` builds the current options at
`src/clones/baseline.ts:198` as `const now: BaselineOptions = { ...opts, includeTests }`.
Because `noisePolicy` is optional, omitting it there is not a type error:
`now.noisePolicy` reads `undefined`, a legacy baseline's value is also absent,
`sameOptions` passes, and the run compares the new lower number against the old
baseline as *green with a re-record hint* instead of `stale`. Unit 3 would then
do nothing at all, with no compiler diagnostic and no visible symptom — the
number would simply look like an improvement. So `compareToBaseline` must
construct `now` as `{ ...opts, includeTests, noisePolicy: CURRENT_NOISE_POLICY }`,
and `buildBaseline` (`src/clones/baseline.ts:66-84`) must stamp the same
constant into the options block it writes. Criterion 13 exists to pin exactly
this: a legacy baseline must come back `stale`, and a test that only checks
"parses without error" would pass while the bug is live.

### Unit 4 — re-record the baseline in the shipping commit

The change removes 3045 duplicated tokens on the current corpus, taking the
recorded number from 28841 to 25796 and the group count from 289 to 233. A
decrease is green with a "lock the improvement in" hint, so nothing forces a
re-record — which is exactly how 3045 tokens of silent slack would survive into
the next change. The shipping commit re-records
`.noldor/clones-baseline.json`.

### Unit 5 — correct the record on test scaffolds

One sentence in the parent FD's Summary stating that test files have been out
of the clone corpus since `includeTests` defaulted to `false`, and that a
table-driven test file therefore cannot move the ratchet. The FD is what a
reader consults before re-filing an entry; `ideas.md` is for unfiled lessons,
and this is a settled fact about shipped behavior.

## Acceptance criteria

Fixture files for criteria 1-12 must clear both detection floors
(`minTokens: 50`, `minLines: 5`), or the assertion passes for the wrong reason.

1. A file pair whose only structural overlap is a head-of-file import block
   produces no clone group.
2. A file pair whose only structural overlap is a head-of-file import block
   plus a delegating one-liner produces no clone group.
3. A genuinely copied schema declaration — dozens of fields, real bodies —
   still produces a group, so Unit 1 has not become a general logic exclusion.
4. A copied block that begins with an import statement but appears after the
   module header contributes its full token weight.
5. Import forms tokenize identically whatever the formatting: a
   semicolon-free header, a header whose `from` clause sits on its own line,
   and a semicolon-free final import with no trailing newline all yield the
   same non-import token count as the single-line semicolon-terminated
   equivalent, and a copied body following such an import is still reported.
6. A file opening with a `#!/usr/bin/env …` line has its import block excluded
   exactly as the same file without the shebang does — pinned against
   `src/graphify/graph-to-toon.ts`, the one such file in the corpus.
7. An import carrying an attributes clause (`with { type: 'json' }`) is
   excluded whole, and a *second* import later in the same file is still
   excluded — the header does not close on the attribute tokens.
8. A truncated import that never reaches its module specifier is emitted, not
   discarded, so `totalTokens` never collapses on malformed input.
9. `export const from = startOfDay(x)` in header position is emitted at full
   token weight and ends the header, so the statement following it is counted
   too.
10. A top-level `import('./x.js')` call and a top-level `import.meta.url`
    reference each contribute their full token weight, as does an `import()`
    inside a function body.
11. The delegation predicate does not over-fire. Each of these is still
    reported: a copied `interface` whose only member is `return(v: T): T`
    **with the span beginning after the `interface` keyword** (so the case does
    not rely on the container being in-span); the optional, generic,
    optional-generic and constrained-generic forms of that member
    (`return?(…)`, `return<T>(…)`, `return?<T>(…)`,
    `return<T extends (x: string) => string>(…)`); a copied body carrying a
    `return:` or `return?:` property; a span whose only `return` is an `iterator.return()` call; a
    copied sequence of side-effect calls with no `return`; and a class in which
    one span carries control flow while another is pure delegation.
12. The delegation predicate does not under-fire where it is sure. A span
    returning `return (foo)` or `return (a, b)` is still recognised as
    delegation, and a `semi: false` delegation body is dropped exactly as its
    semicolon-terminated form is. A span returning a generic arrow
    (`return <T,>(x: T): T => x`) is the documented exception and stays
    reported.
13. A baseline whose `options` omits `noisePolicy` parses successfully and
    `compareToBaseline` returns `stale` — not `unreadable`, and not green —
    even when `duplicatedTokens` fell, and its message renders
    `noise-policy 0`.
14. `duplicatedTokens` after the change is lower than before on the repo's own
    corpus, and `perFile` still sums exactly to `duplicatedTokens`.
15. `pnpm noldor clones check` exits 0 against the re-recorded baseline at the
    shipping commit, and adding a case to a table-driven test file does not
    change `duplicatedTokens`.

## Risks / trade-offs

**Suppression and improvement look identical in the number.** The ratchet
records one integer, so the 3045-token drop means "the policy changed", not
"someone deleted a clone", and only the commit distinguishes them. The `stale`
verdict plus the recorded policy field is the mitigation: the number is
explicitly marked incomparable across the boundary rather than quietly
improved.

**`totalTokens` moves too, so `duplicationPct` shifts.** Unit 1 removes tokens
from the denominator as well as the numerator, and the two do not move
proportionally. Measured on this corpus the ratio falls, 8.48% to 7.92%
(`totalTokens` 340064 to 325874), but the direction is a property of the corpus
rather than of the change. That matters only for `clones.thresholdPct`, an independent
verdict from the ratchet — unset in this repo, so permanently green here, but a
consumer running close to its threshold could flip in either direction on
upgrade. The `stale` verdict does not cover this: `thresholdPct` compares
against a configured constant, not against the baseline. Accepted and recorded
rather than mitigated; a consumer that trips it re-tunes one number.

**Unit 1 can hide a genuinely copied module header.** Two files with an
identical pasted import block stop being reported. Accepted: a copied import
block is not a refactoring target, and the header restriction bounds the blast
radius to exactly the region where that holds.

**Unit 1 recognises an enumerated grammar, so an unlisted import form ends the
header early.** `tokenize` is a scanner by design
(`src/clones/tokenize.ts:1-11`), and the forward match enumerates the static
import and re-export shapes explicitly. A future syntax the enumeration does
not cover fails the match, is emitted, and — because a failure is also what
ends the header — stops the remaining imports in that file from being excluded
too. So the residual failure mode is a ratchet number that is too high, never
one that is too low: the match is positional and bounded by the module
specifier plus its attributes tail, so it cannot discard a statement that is
not one of the enumerated shapes, and it cannot run past the declaration it is
matching.

That asymmetry is the reason the shebang and import-attribute cases are handled
in the unit rather than accepted as gaps. Both looked like "a few extra tokens
counted" and were in fact "the header ends at line 1" and "every import after
the first attributed one is counted" — a single unhandled form disables the
exclusion for a whole file, so the cost of a missed form scales with the file,
not with the form.

**Unit 2's predicate is syntactic, not semantic.** A span whose only statements
are `return`s but which does real work inside its call arguments — a nested
ternary, a long expression — reads as pure delegation and is dropped. The
`minTokens: 50` floor makes this unlikely (a delegation that long is usually
mostly signature) but not impossible. The positive-`return` requirement bounds
the class: a keyword-free span can no longer qualify, so the residual risk is
confined to spans that genuinely do return something.

**Where the predicate is unsure, it reports.** `return <T,>(x: T): T => x`
returns a generic arrow, and after the type-parameter step its `)` is followed
by `:` — indistinguishable from a method signature without also hunting the
`=>`. Such a delegation is therefore NOT dropped and its class stays in the
report. The asymmetry is deliberate and general: under-filtering leaves a real
clone visible, while over-filtering deletes one from the report. The `?` and
`<…>` steps earn their place because omitting them deletes a copied
declaration; chasing the `=>` would only recover a rare delegation shape.

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

4. *What positively identifies a delegation span?*
   -> **No `if`/`for`/`while`/`switch`/`try`/`const`/`let`/`var`, plus at
   least one `return` passing three local tests: not preceded by `.`, not
   followed by `:`, and — when followed by `(` — that group's matching `)` not
   followed by `:`.** (D4) An absence-only rule is vacuously satisfied by a
   keyword-free span, so a copied object-literal body or a match landing
   mid-declaration would be dropped; the positive requirement closes that. The
   three tests then separate a return statement from `return` as a member name
   or property key. They are deliberately local: spans are raw token ranges
   with no declaration alignment (`src/clones/detect.ts:271-274`), so a copied
   `interface` routinely matches from inside its braces and a
   container-keyword guard would not fire on the spans that need it. That is
   also why `interface`/`type`/`enum`/`class` are *not* disqualifying — and
   `type` and `class` are ordinary property keys this scanner keeps verbatim,
   so listing them would drop real delegations. `function` and `export` are
   not disqualifying either: the measured façade run is
   `export function … { return … }`.

5. *How does Unit 1 know where an excluded import ends?*
   -> **It does not need to: the match is a bounded forward match on the import
   grammar, terminating at the module-specifier `LIT` (plus an optional `;`).**
   (D5) A statement-boundary rule was the wrong shape — a depth-0 newline is
   not a boundary (`import { Foo }` newline `from './m.js'` is one statement),
   and a `;`-only rule runs away in `semi: false` source. Matching the grammar
   removes the question: newlines are already whitespace to `tokenize`, so
   formatting is irrelevant, and the match either completes at its `LIT` or
   fails and emits. That failure direction is also what keeps
   `import('./x.js')`, `import.meta.url` and `export const from = …` counted —
   the first two fail at their second token, the third at `const`. A search for
   a depth-0 `from` would have discarded that last one, since `from` is a
   keyword in this scanner (`src/clones/tokenize.ts:49`). Two forms must be
   handled inside the match rather than left to fail, because a failure also
   ends the header and so costs the whole file's remaining imports: a leading
   shebang (skipped before matching) and an import-attributes tail
   (`with { … }`, consumed after the specifier).

6. *What exactly is persisted in the baseline options?*
   -> **`noisePolicy`, `z.number().int().nonnegative().optional()`, value `1`
   from an exported `CURRENT_NOISE_POLICY`; absent means generation `0`;
   `sameOptions` compares `(a ?? 0) === (b ?? 0)`; `describeOptions` renders
   `noise-policy ${o.noisePolicy ?? 0}`.** (D6) A generation integer keeps the
   comparison scalar and absorbs a future noise rule without another field. The
   coalesce only equates a legacy absent value with an explicit `0`; it is not
   the guard against the optionality trap. Both write sites —
   `buildBaseline` and `compareToBaseline`'s `now` at
   `src/clones/baseline.ts:198` — must stamp the constant: because the field is
   optional, omitting it there is not a type error, and `undefined` would
   compare equal to a legacy baseline's absent value, reporting green instead
   of `stale` and voiding Unit 3 with no diagnostic.

7. *Where does the falsified test-scaffold claim get recorded?*
   -> **The parent FD's Summary, one sentence.** (D7) `ideas.md` is for unfiled
   lessons; this is a settled fact about shipped behavior, and the FD is what a
   reader consults before re-filing the same entry.

8. *Does the shipping commit re-record the baseline, or is that left to the
   operator?*
   -> **The shipping commit re-records it.** (D8) A decrease is green, so
   nothing forces the re-record — which is exactly how 3045 tokens of silent
   slack would survive into the next change.
