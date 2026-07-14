---
name: noldor-debug
description: Use when encountering any bug, test failure, or unexpected behaviour, before proposing a fix — reproduce it, trace the root cause, and write a failing test before changing code. Root cause before fixes, always. Vendored (self-contained, no plugin) so a Noldor consumer without superpowers still gets the discipline.
---

# /noldor-debug

Systematic-debugging discipline, vendored for Noldor. Self-contained — no `superpowers` plugin required.

## Overview

Random fixes waste time and create new bugs. A quick patch masks the underlying cause, and the symptom comes back.

**Core principle:** find the root cause before changing any code. A symptom fix is a failure, not a shortcut.

**Violating the letter of this rule is violating the spirit of it.** "Just one quick change to see" is the exact rationalization this discipline exists to stop.

## The Iron Law

```
NO FIX WITHOUT ROOT-CAUSE INVESTIGATION FIRST
```

If you have not reproduced the failure and traced it to its origin, you cannot propose a fix.

## The loop

One loop, six moves: **reproduce → minimise → hypothesise → instrument → fix → regression-test.** It expands into four phases — complete each before the next. If a phase can't be completed, you are not ready to fix.

### Phase 1 — Root cause (reproduce · minimise · instrument)

Before attempting ANY fix:

1. **Read the error completely.** Full stack trace, exit code, error text, line/file. The message often names the cause — don't skim past it.
2. **Reproduce consistently.** Exact steps; does it fail every time? Not reproducible → gather more data, don't guess.
3. **Minimise.** Shrink to the smallest input/state that still triggers it. A one-line repro beats a full-flow repro.
4. **Check recent changes.** `git diff` / `git log` — what changed that could cause this? New dep, config, env difference?
5. **Instrument multi-component systems.** When data crosses boundaries (CLI → core → git, API → service → DB), log what enters and exits each boundary and run once to see WHERE it breaks — then investigate that component. Trace a bad value backward to its source; fix at the source, not the symptom.

### Phase 2 — Pattern analysis

1. **Find a working example.** Similar code in the same repo that works — what's different?
2. **Read references completely.** If mirroring a pattern (as a vendored skill mirrors its twin), read the reference in full; don't adapt from a skim.
3. **List every difference,** however small. Don't assume "that can't matter."

### Phase 3 — Hypothesis (hypothesise · test minimally)

1. **State ONE hypothesis:** "I think X is the root cause because Y." Write it down. Be specific.
2. **Test minimally.** Smallest possible change, one variable at a time. Don't fix several things at once — you won't know what worked.
3. **Confirmed?** Yes → Phase 4. No → form a NEW hypothesis; don't stack fixes on top.
4. **When you don't know, say so.** "I don't understand X" beats a confident guess. Research or ask.

### Phase 4 — Fix (fix · regression-test)

1. **Write a failing test first.** Simplest reproduction as an automated test (or a one-off script if no framework). Run it — it MUST fail for the right reason before you fix. This is the red of red-green.
2. **Implement ONE fix** at the root cause. No "while I'm here" refactors, no bundled changes.
3. **Verify with evidence.** Test passes now; nothing else broke (`pnpm test`); the original symptom is actually gone. Prove it before claiming it — see `/noldor-verify`.
4. **Regression-test the red-green cycle:** revert the fix → the new test MUST fail → restore → it passes. A test that never went red proves nothing.

## When 3+ fixes fail — question the architecture

If each fix reveals a new problem elsewhere, or fixes need "massive refactoring," STOP. This is not a failed hypothesis — it's a wrong architecture. Don't attempt fix #4. Ask: is this pattern sound, or are we continuing through inertia? Discuss with your human partner before more fixes.

## Red flags — STOP, return to Phase 1

- "Quick fix now, investigate later" / "just try changing X and see"
- proposing a fix before reproducing or tracing the data flow
- multiple changes at once, then run tests
- "skip the test, I'll verify by hand"
- "it's probably X, let me fix that" (symptom seen ≠ root cause understood)
- "one more fix attempt" after 2+ have failed
- your human partner says "stop guessing", "is that not happening?", "we're stuck?" — your approach isn't working

## Common rationalizations

| Excuse | Reality |
| --- | --- |
| "Issue is simple, no need for process" | Simple bugs have root causes too; the loop is fast for them. |
| "Emergency, no time" | Systematic is FASTER than guess-and-check thrashing. |
| "Just try this first, then investigate" | The first fix sets the pattern. Do it right from the start. |
| "I'll write the test after the fix works" | Untested fixes don't stick; the failing test first proves the cause. |
| "Multiple fixes at once saves time" | You can't tell what worked, and you cause new bugs. |
| "Reference is long, I'll adapt the pattern" | Partial understanding guarantees bugs. Read it fully. |
| "I see the problem, let me fix it" | Seeing the symptom ≠ understanding the root cause. |
| "One more fix" (after 2+ failures) | 3+ failures = architectural problem. Question the pattern, don't fix again. |

## When to apply

Any technical issue, ESPECIALLY under pressure: bug, test failure, unexpected behaviour, performance regression, build failure, flaky drain iteration. Use it before proposing a fix on a gate `fast-track` bug change, and before trusting a subagent's or drain's "fixed" report (verify via `git diff`/`git log`, not the report).

This is the discipline the gate assumes on any fix: the phases produce a root cause and a red-green regression test; `/noldor-verify` is the rule that you then run `pnpm test` / `pnpm verify` and read the output before claiming it's fixed.

## The bottom line

Reproduce it. Find the root cause. Write the failing test. Fix once. Prove it red-green. No shortcuts. Non-negotiable.
