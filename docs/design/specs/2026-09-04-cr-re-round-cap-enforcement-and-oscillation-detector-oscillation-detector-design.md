# CR Oscillation Detector and Arbitration Receipt — Design

**Slug:** cr-oscillation-detector-and-arbitration-receipt
**FD:** docs/features/cr-re-round-cap-enforcement-and-oscillation-detector.md
**Date:** 2026-09-04
**Tier:** full
**Deps:** Q-0170 (shipped, PR #431)

Nine decisions, each with its rejected alternative, are recorded in the design ledger at
`.noldor/design/cr-re-round-cap-enforcement-and-oscillation-detector-oscillation-detector.md` and
summarised under **Open questions (resolved)** below.

## Problem

Q-0170 gave the review loop a bound: `cr orchestrate` owns the round ledger, counts red rounds, and
refuses to dispatch past `AUTOFIX_ROUND_CAP`. That stops the bleeding. It does not say *why* a loop
bled, and it terminates in free text — `renderCapRefusal` in
[`src/cr/orchestrate.ts:363`](../../../src/cr/orchestrate.ts#L363) points the operator at
`git commit --amend --no-edit --trailer "Noldor-Path-Override: <why>"`, and 23 of this repo's 41
unique overrides are exactly that sentence typed by hand.

Three specific blindnesses remain.

**Findings are not locatable.** `runSubagent` in
[`src/cr/lanes/subagent.ts:206-216`](../../../src/cr/lanes/subagent.ts#L206-L216) builds every
`Finding` with `file: input.artifact` — the labeling string the gate passes as `--artifact`, often a
representative path or `.` — and never sets `line`, even though `findingSchema`
([`src/cr/findings-schema.ts:14`](../../../src/cr/findings-schema.ts#L14)) already carries an optional
one. Every reviewer-lane finding in a round therefore shares one constant `file`, so
`fingerprintBlockers` ([`src/cr/autofix-ledger.ts:291`](../../../src/cr/autofix-ledger.ts#L291))
degenerates from `severity|file|message` to `severity|message`, and nothing downstream can ask
whether two findings are about the same code.

**Marked cuts are invisible to code.** `CUT_MARKER` is defined once
([`src/core/structural-context-contract.ts:34`](../../../src/core/structural-context-contract.ts#L34))
and reaches review lanes as prose through `CUT_MARKER_GUIDE`. The ~20 real `noldor:cut` comments in
`src/**` are read today by humans and by `/noldor-refactor`'s grep alone. `cutReasons` in
[`src/core/markdown-section-scan.ts:337`](../../../src/core/markdown-section-scan.ts#L337) parses
markers, but only in markdown, and deliberately from a *comment-blanked* view — the exact opposite of
what a TypeScript scanner needs.

**Arbitration is unstructured.** When the cap fires, what survives is a commit-message sentence. The
round history, which blockers were left standing, and what the operator decided about each are lost.
`Noldor-Path-Override` is read by six consumers today (`validate-noldor-scope.ts`,
`noldor-validate-trailer.ts`, `release-cr-gate.ts`, `override-audit.ts`, `sdd-report.ts`,
`gate-registry.ts`), and every one of them treats the value as opaque text.

## Goals

- A reviewer-lane finding can name the file and line(s) it is about, without breaking any sink written
  before this landed.
- The `noldor:cut` markers in TypeScript source are readable by code, from the same constant the prose
  contract already uses.
- A pure, I/O-free detector reports *why* a round looks like oscillation — repeat, cut-site,
  contradiction — as advisory signals that never suppress a finding and never move an exit code.
- The cap terminates in a machine-readable arbitration record carrying the round history, the
  unresolved blockers, the per-round signals, and a required operator disposition per unresolved
  blocker, bound to the tree it arbitrated.

## Non-goals

- Changing `AUTOFIX_ROUND_CAP`, `capVerdict`, or the closing-round contract. Q-0170 settled those.
- Auto-suppressing findings. Signals are advisory with teeth, in the same posture as
  `split-suggestion.ts`: the framework reports, the operator decides.
- Teaching lanes other than `reviewer` to emit locations. Codex, manual and verifier stay as they are;
  an absent `locations` must degrade cleanly.
- Replacing `Noldor-Path-Override`. Whatever the receipt answer turns out to be (D1), the existing
  trailer and its six consumers keep working unchanged.

## Design

### Structural context

Written from `pnpm noldor design graph-context` over the nine candidate paths (`links.code` ∪ the
entry's `Touches:`), against a graph regenerated in the working tree for this read
(`status: fresh`, 3382 nodes / 8829 edges / 199 communities).

The change lands in five communities, and that spread is the shape of the work rather than an
accident: **c34** (`findings-schema.ts` alongside `aggregate.ts`, `lane-sink.ts`, `expected-lanes.ts`
— the sink contract), **c45** (`subagent.ts` + `subagent-dispatch.ts` + `lane-types.ts` — the reviewer
lane), **c39** (`autofix-ledger.ts` alone with its two tests — the round ledger), **c43**
(`orchestrate.ts` + its tests — the round driver), and **c32** (`structural-context-contract.ts`
alongside `markdown-section-scan.ts` and the `structural-context` / `fd-diagram` detectors — the
marker-contract neighbourhood). `run-codex.ts` sits apart in **c7**.

**No file in the candidate set defines a god node.** The graph's ten god nodes are `loadDocRoots()`
(degree 84), `loadConsumerConfig()` (40), `parseSlug()` (38), `detectAll()` (32),
`atomicWriteFileSync()` (30), `parseBacklog()` (28), `escapeHtml()` (28), `main()` (27),
`runIfDirect()` (23) and `scanRoots()` (23) — none of them here. Every file in scope is interior to its
own community, which is itself the finding: this work adds surface rather than widening a hub.

Two cross-community edges are load-bearing for the design. `findings-schema.ts` [c34] is imported by
`orchestrate.ts` [c43], `autofix-ledger.ts` [c39], `subagent.ts` [c45], `verify.ts` [c48],
`ui-design-resolve.ts` [c41], `render-compare.ts` [c50] and `dashboard/types.ts` [c4] — so U1's schema
edit is the widest-blast-radius change in the feature and must stay purely additive.
`structural-context-contract.ts` [c32] is imported by `subagent-dispatch.ts` [c45], `run-codex.ts`
[c7], `adr-schema.ts` [c6] and `prep/formats.ts` [c92] — four communities already read the marker
constant, which is why U2 reuses `CUT_MARKER` rather than minting a third spelling.

The new detector belongs beside the ledger in **c39**, not inside `orchestrate.ts` [c43]: c39 is a
two-test island whose only outward edge is to orchestrate, which is the dependency direction a pure
module wants. (The roadmap entry named "graph community c5"; community numbers are not stable across
regenerations, and c39 is where the ledger sits in the current graph. The intent — beside the ledger —
is what carries.)

### U1 — Locatable findings

`findingSchema` gains an optional `locations` array of `{ file, line?, endLine? }`. The existing `file`
and `line` fields keep their present meaning and are not deprecated, so every sink on disk still
parses and no other lane needs migration — the same additive posture `class` took at
[`findings-schema.ts:24`](../../../src/cr/findings-schema.ts#L24).

**Locations are read out of the message, not out of a new grammar.** A probe over this repo's 26
reviewer sinks (74 findings) found that **27 of them — 36% — already name an explicit `file:line`
unprompted**, in a settled convention: a leading backticked `` `upgrade.ts:74` ``. So `mkFinding`
extracts every `path.ts:NN` occurrence from the bullet text by regex and leaves the message intact,
beside the existing `splitClassTag` call. `parseSubagentMarkdown` keeps returning plain bullet strings
and the bullet grammar does not change. `buildPrompt` in
[`src/cr/lanes/subagent-dispatch.ts`](../../../src/cr/lanes/subagent-dispatch.ts) is updated to ask each
Critical/Important bullet to name one, which raises the rate rather than creating the capability. A
bullet naming none yields no `locations` key.

That choice buys retroactive coverage — every sink already on disk becomes partly locatable — and adds
no second thing a reviewer can get wrong. The rejected alternative, a structured leading token parsed
like the class tag, is deterministic but starts at zero coverage and turns a malformed prefix into a new
parse-failure class.

**Every resolved location is confined to the round's changed-file set** — the choke-point posture
Q-0097 established for `slugPath`. This is a security boundary, not a convenience: `locations.file`
originates in LLM output, and orchestrate then *reads* those files to resolve U2's marker scopes. So a
mention is resolved only by matching it against `discoverChangedFiles` (already called at
[`subagent.ts:94`](../../../src/cr/lanes/subagent.ts#L94)), and a mention that does not match yields no
location. An absolute path, a traversal like `../../x.ts:1`, and a directory-qualified path outside the
changed set are all simply unmatched — the resolver never opens a path it was handed, only one it
recognised.

Of the 30 location mentions observed, 21 carry a directory and 9 are a bare basename; none of the 8
distinct basenames was ambiguous even against all of `src/`, and the changed set is far smaller. An
ambiguous basename also yields no location, rather than a guess.

**`fingerprintBlockers` does not change**, and `locations` is not added to it. Its docstring
([`autofix-ledger.ts:283-290`](../../../src/cr/autofix-ledger.ts#L283-L290)) explains why `line` is
excluded — an unrelated edit shifts it, so including it would make an unfixed blocker fingerprint as
progress and the no-progress stop would never fire. That reasoning applies to `locations` verbatim. R1
therefore keeps using the existing fingerprint; only R2 and R3 read locations.

### U2 — Cut-marker scanner for TypeScript comments

A new pure module reads TypeScript source text and returns the markers in it. It imports `CUT_MARKER`
from `structural-context-contract.ts` rather than restating the literal — the third spelling is exactly
what that file's `CUT_MARKER_TOKEN` docstring exists to prevent.

Two real comment forms must both parse, because both appear in `src/**` today: the line form
(`// noldor:cut stdout accumulates unbounded — …`,
[`agent-runner/registry.ts:228`](../../../src/core/agent-runner/registry.ts#L228)) and the JSDoc form
(` * noldor:cut a RELATIVE scan root that is itself a symlink …`,
[`core/repo-paths.ts:164`](../../../src/core/repo-paths.ts#L164)).

Two hazards the markdown scanner already documents apply here. The marker must be its own token —
`markdown-section-scan.ts:331` records that a bare `startsWith` let `noldor:cutlery` suppress a section
— and `noldor:cut-section` is a *different* marker owned by
[`src/docs/architecture-form.ts:24`](../../../src/docs/architecture-form.ts#L24), so a word-boundary
match is mandatory rather than tidy. Unlike `cutReasons`, this scanner reads markers *inside* comments,
which is the inverse of the markdown contract; the two must not share an implementation.

**Scope is brace-matched, not parsed.** A marker's scope runs from its own line to the end of the
innermost brace block containing it, and the block boundaries come from
[`tokenize()`](../../../src/clones/tokenize.ts) — the repo's existing hand-rolled TS/JS scanner, which
is pure, does no fs, skips comments, collapses every string and template literal to one token, and tags
each token with 1-based `line` / `endLine`. Brace matching over that token stream therefore cannot be
fooled by a `{` inside a string or a comment, which is the whole reason a naive brace count would not
do. No parser, no new dependency, and the scope reaches the function *body*, where a re-flagged finding
actually lands.

The scanner makes two passes over one file, and they are deliberately different passes: markers are
**found** by a line regex over the raw text (they live in comments, which `tokenize()` discards), and
then **scoped** by brace matching over the token stream. One pass cannot do both jobs.

Two fallbacks pin the module-scope case, which is the common JSDoc shape (` * noldor:cut …` above a
declaration, as at `repo-paths.ts:164`). When no brace block encloses the marker, the scope is the next
brace block that *opens* after it — the declaration the comment documents. When there is no such block
either (a marker above a bare `const`, or at end of file), the scope is the marker's contiguous comment
block plus the following non-blank line. Neither fallback ever runs to EOF.

### U3 — The re-flag detector

A pure module beside the ledger in c39, shaped after
[`src/core/split-suggestion.ts`](../../../src/core/split-suggestion.ts): exported threshold constants,
a `{ rule, value, threshold, message }` signal record, one function per rule, no I/O, no clock.

- **R1 — repeat.** This round's blocker fingerprint matches a prior round's in the ledger. Reads
  `AutofixRound.fingerprint`, which already exists and is already written every round.
- **R2 — cut-site.** A blocker's location falls inside a documented cut marker's scope (U2). This is
  the signal that would have caught the Q-0146 case the parent FD names: codex re-flagged documented
  cut sites five times in one review.
- **R3 — contradiction.** A blocker is located on a line that a prior round's fix introduced.

Signals never suppress a finding, never edit a sink, and never move an aggregate exit code — the same
contract `split-suggestion.ts` holds and the same posture the roadmap entry demanded.

**The module takes data; the caller fetches it.** R3 needs a git diff and R2 needs file reads, and
neither belongs inside a module whose whole contract is that it cannot fail. `cr orchestrate` resolves
R3's changed-line set from the ledger's `fixHeadSha` / `diffRange`
([`autofix-ledger.ts:49`](../../../src/cr/autofix-ledger.ts#L49),
[`:84`](../../../src/cr/autofix-ledger.ts#L84)) and resolves U2's marker scopes, then passes both in.
That is exactly how `split-suggestion.ts` earns its testability, and it means every rule is testable
from literals with no fixture repo.

**Signals are persisted per round, on the ledger.** `AutofixRound` gains an optional `signals` array,
written by orchestrate in the same `appendRound` call that already writes the round verdict
([`orchestrate.ts:706`](../../../src/cr/orchestrate.ts#L706)). This is not a convenience: lane sinks
are overwritten each round and survive only in `archive/`, so a signal computed at round 2 is
unrecoverable at cap time unless it was written down. Orchestrate is already the ledger's only
appender, and the field is optional, so every ledger Q-0170 wrote still parses. The record skeleton
(U4) then reads the ledger it already reads instead of recomputing anything.

Signals also print to orchestrate's stdout beneath the round summary, so they are useful at round 2 —
before the budget is spent — rather than only as an epitaph at the cap.

### U4 — The arbitration record

`.noldor/cr/arbitration/<slug>-<kind>.json`, carrying the round history, the unresolved blockers, the
per-round signals, and a required operator disposition per unresolved blocker. Blob-bound to the tree
it arbitrated, in the same shape Q-0196's design-approval record uses, so a later commit invalidates it
rather than letting it silently stand.

The **subdirectory is not cosmetic**. `aggregate` collects every `.noldor/cr/<slug>-<kind>-*.json`
regular file as a lane sink, and `autofix-ledger.ts:120-130` records what happened last time a file
landed inside that glob: `inferLaneFromFilename` returned null and a bogus `non-conforming filename`
HIGH blocker appeared in every aggregate for the pair, turning green runs red. `aggregate` skips
non-files, so nesting removes the whole collision class. This record reuses the ledger's proven answer
rather than minting a second one.

**Two writers, two jobs.** `cr orchestrate` writes the record *skeleton* on its cap refusal. What it
holds at that moment is only the **ledger**: the refusal returns at
[`orchestrate.ts:476-479`](../../../src/cr/orchestrate.ts#L476-L479) before any dispatch, with
`lanesRun: []`, and the ledger stores a blocker-set *fingerprint*, never the blockers themselves. The
skeleton's unresolved blockers therefore come from **re-reading the pair's current lane sinks**, which
are still on disk precisely because a refused run writes none. Round history and per-round signals come
from the ledger; `dispositions` is left empty for the operator. The
**pre-push hook enforces**, beside the existing `enforce-review-receipt` job: a bare free-text
`Noldor-Path-Override` is refused when the ledger shows red rounds for the pair and no filled record
matches the tree. Orchestrate cannot enforce — it is not on the path to `main`, so an operator who
simply never re-runs it would push a bare override unimpeded.

**The trailer vocabulary does not change.** The record is named by a structured value *inside* the
existing `Noldor-Path-Override`, because
[`release-cr-gate.ts:134`](../../../src/release/release-cr-gate.ts#L134) accepts that key on a bare
non-empty check — so a structured value costs zero gate changes and invalidates no override already in
history. A new `Noldor-CR-Arbitration:` key would instead need teaching to six consumers
(`release-cr-gate.ts`, `validate-noldor-scope.ts`, `noldor-validate-trailer.ts`, `override-audit.ts`,
`sdd-report.ts`, `gate-registry.ts`), and until every one of them knew it, a commit carrying only that
trailer would *fail* the release gate.

**An absent ledger fails open, loudly.** No ledger means no proof any red round happened, and the guard
cannot tell a deleted ledger from a session that never hit the cap — so it allows the push and prints
that it could not verify. Failing closed would shut the known delete-to-reset hole, but would also
refuse every honest override from a session that never ran orchestrate at all (micro-chore,
fast-track, a doc fix), which is most overrides in this repo. This deliberately matches Q-0170's
existing behaviour rather than silently widening it; the printed line is what keeps the hole visible.

## Acceptance criteria

1. Every `LaneFindings` sink and every `AutofixLedger` written before this change parses unchanged, and
   yields no `locations` and no `signals`.
2. A reviewer bullet naming a file and line yields a `Finding` whose `locations` names it; a bullet
   naming none yields no `locations` key; a bare basename that does not resolve unambiguously against
   the round's changed files yields no location rather than a guess.
3. `fingerprintBlockers` returns the same digest for the same blocker set as it does today.
4. The scanner reads both the line-comment and the JSDoc-comment marker forms from real `src/**` files,
   and does not match `noldor:cut-section` or `noldor:cutlery`.
5. A `{` inside a string, template literal or comment does not change a marker's resolved scope.
6. A marker with no enclosing brace block scopes to the next block that opens after it; with no such
   block either, to its comment block plus the following non-blank line. Neither ever reaches EOF.
7. Renaming `CUT_MARKER` in `structural-context-contract.ts` fails the suite rather than silently
   splitting the grammar between the scanner and the prose contract.
8. R1 fires when a blocker fingerprint repeats across rounds; R2 fires for a blocker located inside a
   marker's scope and not for one outside it; R3 fires for a blocker on a line a prior round's fix
   introduced. Each is decidable from literals, with no fixture repo.
9. A round carrying any signal exits with the same code, and writes the same lane sinks, as the
   identical round carrying none.
10. Signals computed in a round are readable from the ledger after that round's lane sinks have been
    overwritten.
11. `aggregate` does not collect the arbitration record as a lane sink, and files no
    `non-conforming filename` blocker because of it.
12. A bare free-text `Noldor-Path-Override` is refused at pre-push when the ledger shows red rounds for
    the pair and no filled record matches the tree; the same push is allowed, with a printed
    could-not-verify line, when no ledger exists.
13. An arbitration record whose bound tree no longer matches is reported as stale rather than honored.

## Risks / trade-offs

- **A brace-matched scope over-reaches on a long function.** The scope now runs to the end of the
  enclosing block, so a marker inside a 200-line function claims all 200 lines and R2 can fire for a
  finding the marker was never about. This is the accepted cost of reaching the body at all; it
  produces a false *signal*, never a suppressed finding, and the signal names the marker's declared
  line so an operator can dismiss it in a glance. The narrower comment-block scope was rejected because
  it would have gone silent on most real re-flags.
- **U1's coverage is partial and stays partial.** 36% of findings carry a location today and the prompt
  nudge raises that, but nothing forces it. Below full coverage, R2 and R3 fire on a subset — quiet,
  never wrong. The feature still delivers R1 and the record on a round where no finding is locatable.
- **The units are a chain, not slices.** U1 feeds R2/R3; U2 feeds R2; U3 feeds U4. This is why the `E1`
  split signal at promote was accepted rather than carved — and it means a plan that parallelises them
  is wrong.
- **Additive schema, permanent surface.** `locations` alongside `file` and `line` is three ways to say
  where a finding is, and `signals` widens a ledger schema Q-0170 shipped a day ago. Additive is the
  only safe direction given seven importers of `findings-schema.ts` across five communities, but the
  redundancy is real and should carry a `noldor:cut` naming the consolidation being declined.
- **The guard's fail-open leaves a known hole.** Deleting `.noldor/cr/autofix/<slug>-<kind>.json` still
  resets the cap, and now also disarms the override guard. This spec does not close that — it declines
  to widen it, and makes it audible. Closing it needs the ledger to live somewhere an operator cannot
  casually remove, which is its own piece of work.

## User Story

As an operator or agent arbitrating a code-review loop that has hit its round cap, I want the framework
to tell me *why* the loop is not converging — this blocker repeats, that one sits on a documented cut,
this one is about a line the last fix wrote — and to record my decisions in a machine-readable
arbitration record, so that the loop terminates in auditable evidence instead of a hand-typed override
sentence.

## Usage

Nothing new to invoke in the common case. `cr orchestrate` runs exactly as before and prints the
detector's signals beneath the round summary when any fire:

```
pnpm noldor cr orchestrate --slug <slug> --artifact . --kind code --base-sha origin/main
```

```
[R1] blocker fingerprint repeats round 2 — the same finding survived a fix.
[R2] blocker at src/core/repo-paths.ts:166 sits inside a noldor:cut scope declared at :164.
```

At the cap, orchestrate writes the record skeleton and its refusal banner names it. The operator fills
one disposition per unresolved blocker, then records the arbitration in the trailer that already exists:

```
red rounds 3/3 for <slug> (code) — cap reached
  …round history…
arbitration skeleton written: .noldor/cr/arbitration/<slug>-code.json
  2 unresolved blockers await a disposition; then commit with:
  git commit --amend --no-edit --trailer \
    "Noldor-Path-Override: cr-arbitration <record-sha> — <why>"
```

Pushing with a bare free-text override instead is refused while the ledger shows red rounds for that
pair. With no ledger at all the push proceeds and pre-push prints that it could not verify.

## Open questions (resolved)

1. *Does the arbitration record earn the receipt through a new trailer, or through a structured reason
   inside the existing `Noldor-Path-Override`?*
   -> **Structured reason inside the existing override, plus a pre-push guard that makes the record
   required.** (D1, ratified) `release-cr-gate.ts:134` accepts that trailer on a bare non-empty check,
   so a structured value costs zero gate changes and invalidates no override in history — but the
   trailer shape alone cannot make the record mandatory, and 23 of this repo's 41 overrides are the
   bare hand-typed sentence, so an advisory record would mostly go unwritten. A new trailer key was
   rejected: six consumers would need teaching, and until all of them knew it a commit carrying only
   that trailer would fail the release gate.

2. *How reliably do reviewer subagents emit file:line, and what happens when they do not?*
   -> **Measured, not assumed: 36% already do, so extract by regex from the message.** (D2, ratified) A
   probe over this repo's 26 reviewer sinks / 74 findings found 27 already carrying an explicit
   `file:line` in a settled backticked convention. Regex extraction therefore has retroactive coverage
   and mints no new bullet grammar; the prompt nudge raises the rate rather than creating the
   capability. A finding with no location produces no R2/R3 signal — silence, never a guess.

3. *What is a `noldor:cut` marker's scope?*
   -> **The marker line through the end of its enclosing brace block, resolved by brace-matching over
   `tokenize()`.** (D3, ratified) `src/clones/tokenize.ts` is already pure, no-fs, skips comments and
   collapses string/template literals, and carries 1-based `line`/`endLine` per token — so brace
   matching cannot be fooled by a brace in a string, needs no parser and no new dependency, and reaches
   the function body where re-flags land. Rejected: comment-block-plus-next-line (parse-free but silent
   on any finding more than a line past the marker, which is most real re-flags) and `@swc/core`
   `parseSync` (accurate, and already a production dependency, but it mints a new parsing surface in
   noldor code and a slower scan for no extra signal here).

4. *Does the detector run every round, or only at the cap?*
   -> **Every round.** (D4) R1 needs the history it accumulates anyway, the module is pure and cheap,
   and a signal is most useful at round 2 — before the budget is spent — rather than as an epitaph.

5. *Where does the arbitration record live, given the `aggregate` glob hazard?*
   -> **A subdirectory, `.noldor/cr/arbitration/<slug>-<kind>.json`.** (D5) Exactly the remedy
   `autofix-ledger.ts:120-130` adopted for the ledger after the same collision, and reusing a proven
   answer beats minting a second one.

6. *Do `file`, `line` and `locations` all survive?*
   -> **Yes, additively, with a `noldor:cut` naming the declined consolidation.** (D6) Seven modules
   import `findings-schema.ts` across five communities; a breaking change there is out of proportion to
   the tidiness gained.

7. *Where does the guard run, and what happens when the ledger is absent?*
   -> **Orchestrate writes the skeleton, pre-push enforces; an absent ledger fails open and says so.**
   (D7, ratified) Orchestrate holds the ledger and the unresolved blockers at the moment it refuses but
   is not on the path to `main`; pre-push is, and already hosts `enforce-review-receipt`. An absent
   ledger cannot be told apart from a session that never hit the cap, so refusing there would block
   every honest micro-chore and fast-track override — the printed could-not-verify line keeps the known
   delete-to-reset hole visible instead.

8. *Where do per-round signals live, given lane sinks are overwritten each round?*
   -> **On the ledger round entry, as an optional `signals` array.** (D8, ratified) Orchestrate is
   already the ledger's only appender and already computes the verdict at that point, so the signals
   ride the same `appendRound` call; the record skeleton then reads a ledger it reads anyway. Rejected:
   recomputing at cap time from `archive/`, which makes archived sinks load-bearing, re-runs the file
   scan over every past round, and recovers nothing for a round whose archived sink is gone.

9. *Who fetches the data the detector reasons over?*
   -> **The caller, always.** (D9, ratified) Orchestrate resolves R3's changed-line set from
   `fixHeadSha` / `diffRange` and U2's marker scopes, and passes both in. This is what makes every rule
   testable from literals with no fixture repo, exactly as `split-suggestion.ts` is — and it keeps I/O
   failure handling out of a module whose whole contract is that it cannot fail.
