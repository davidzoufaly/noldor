---
id: abstraction-cost
applies-to: ["src/**/*.{ts,tsx,js,jsx}"]
stage: [code]
enforce: true
links: [docs/noldor/rules.md, docs/noldor/gotchas.md]
---

Abstraction is priced by file boundaries. Inside one file it is nearly free; across
files it costs the reader a fetch and an agent a round trip on every crossing. A long
file of small local helpers is cheap; four files that must be opened in sequence to
follow one call are not.

Three reasons to abstract, and if none applies, inline it:

1. **Hide complexity** behind an interface a caller genuinely should not see.
2. **Name a thing** — but only where the call site cannot already read the name off the
   expression. `const MAX = 3` used once names nothing the literal did not.
3. **Reuse** from the third call site, not the second. Two similar lines are fine.

Anti-patterns this rule names:

- The single-use constant whose name says no more than its value.
- The single-consumer translation layer that only renames what it forwards.
- The factory wrapping a value the type system already constrains.

Barrel re-exports are deliberately not on that list: a `src/index.ts` style public
surface legitimately re-exports, and a blanket clause would turn a repo convention into
a reviewer blocker.

The glob covers the extensions the mechanical counterpart measures. It cannot cover the
same roots — rule globs are repo-relative and resolved at rule-resolution time, while
scan roots come from consumer config at run time — so a consumer whose code lives
outside `src/` widens this glob in its own copy. Under-reaching costs a consumer advice,
not enforcement: the ratchet still measures every scan root.

The mechanical counterpart is `pnpm noldor indirection check`, which ratchets the total
transitive-import-closure excess across the corpus. This rule covers what the counter
cannot see: whether a given crossing was worth it.

`pnpm noldor clones check` returns three independent verdicts and only one of them
answers to a baseline, so name the verdict before choosing a remedy:

- **ratchet** — corpus duplication rose above `.noldor/clones-baseline.json`. This is the
  verdict the rebaseline advice is about: a red here that can only be cleared by adding a
  cross-file wrapper is the case both halves exist for — decline the wrapper and
  `pnpm noldor clones baseline`, rather than paying indirection to lower a duplication
  count.
- **threshold** — corpus duplication above `clones.thresholdPct`. Re-recording does not
  reach it; the call is to raise the percentage or to extract.
- **diffScope** — a clone group overlaps a line *this change wrote*. No baseline silences
  it, a re-record leaves it red, and its only config opt-out is repo-wide.

When diff-scope is the one talking, rule 3 yields and you extract at the second call site.
The detector's default floor is 50 tokens across 5 lines (`clones.minTokens` /
`clones.minLines`), well above the "two similar lines are fine" that rule 3 protects — a
block that large, duplicated by the change in front of you, is not the cheap similarity
this rule defends. Splitting a file so its import block drops under the floor is the other
honest fix; perturbing code to break the token match is honest only where the two sites
coincide in shape and differ in intent. Setting `clones.diffScope: false` is never the
answer to a single call site — it is a repo-wide switch bought by one change, and it
retires the only verdict that asks about the diff at all. See `docs/noldor/gotchas.md` for
the operational walkthrough.
