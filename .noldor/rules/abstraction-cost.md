---
id: abstraction-cost
applies-to: ["src/**/*.{ts,tsx,js,jsx}"]
stage: [code]
enforce: true
links: [docs/noldor/rules.md]
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
cannot see: whether a given crossing was worth it. A clone-gate red that can only be
cleared by adding a cross-file wrapper is the case both halves exist for — decline the
wrapper and rebaseline, rather than paying indirection to lower a duplication count.
