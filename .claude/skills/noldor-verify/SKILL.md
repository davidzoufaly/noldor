---
name: noldor-verify
description: Use when about to claim work is complete, fixed, passing, green, or merged — before committing, opening a PR, flipping a phase, or handing off. Requires running the proving command and reading its output first. Evidence before assertions, always. Vendored (self-contained, no plugin) so a Noldor consumer without superpowers still gets the rule.
---

# /noldor-verify

Verification-before-completion discipline, vendored for Noldor. Self-contained — no `superpowers` plugin required.

## Overview

Claiming work is done without verifying it is dishonesty, not efficiency.

**Core principle:** evidence before claims, always.

**Violating the letter of this rule is violating the spirit of it.** Paraphrasing the claim ("looks correct", "should be green") does not exempt it.

## The Iron Law

```
NO COMPLETION CLAIM WITHOUT FRESH VERIFICATION EVIDENCE
```

If you have not run the proving command in this same message, you cannot claim the result. A prior run does not count — code changed since.

## The Gate Function

```
BEFORE claiming any status, or expressing satisfaction:

1. IDENTIFY  which command proves this claim?
2. RUN       execute the FULL command, fresh and complete
3. READ      full output — exit code, failure count, error text
4. VERIFY    does the output confirm the claim?
               NO  → state the actual status, with evidence
               YES → state the claim, WITH the evidence
5. ONLY THEN make the claim

Skipping any step is lying, not verifying.
```

## Common failures (Noldor commands)

| Claim | Proven by | NOT sufficient |
| --- | --- | --- |
| Tests pass | `pnpm test` output: 0 failures | a previous run, "should pass" |
| Lint/format clean | `pnpm lint` + `pnpm fmt:check`: 0 errors | one of the two, extrapolation |
| Typecheck clean | `pnpm typecheck`: exit 0 | lint passing |
| `verify` green | `pnpm verify`: exit 0 (whole composite) | one sub-step green |
| Bug fixed | reproduce the original symptom → gone | code changed, assumed fixed |
| Regression test works | red-green verified (revert fix → test FAILS) | test passes once |
| CR clean | `pnpm noldor cr aggregate --slug <s> --kind code`: exit 0 | orchestrate "ran", one lane green |
| PR merged | `gh pr view <url>` state MERGED | `pr-flow` "returned", auto-merge "queued" |
| Subagent/drain done | `git diff`/`git log` shows the change | the agent's own "success" report |
| Requirements met | line-by-line re-read of spec/plan | tests passing |

## Red flags — STOP

- "should", "probably", "seems to", "looks right"
- satisfaction before evidence — "Great!", "Perfect!", "Done!", "Shipped!"
- about to commit / push / `pr-flow` / flip phase without a fresh run
- trusting a subagent or drain-iteration success report
- relying on a partial check (one lane, one sub-step)
- "just this once" / tired and wanting it over
- ANY wording implying success without having run the proving command

## Rationalization prevention

| Excuse | Reality |
| --- | --- |
| "Should work now" | RUN the command |
| "I'm confident" | confidence ≠ evidence |
| "Just this once" | no exceptions |
| "Lint passed" | lint ≠ typecheck ≠ test |
| "Agent said success" | verify independently via VCS |
| "One lane is green" | aggregate is the gate, not a lane |
| "I'm tired" | exhaustion ≠ excuse |
| "Different words, so the rule doesn't apply" | spirit over letter |

## Key patterns

**Tests / verify:**

```
✅ run `pnpm test` → see "34/34 pass" → "tests pass"
✅ run `pnpm verify` → exit 0 → "verify is green"
❌ "should pass now" / "looks correct"
```

**Regression (red-green):**

```
✅ write test → run (pass) → revert the fix → run (MUST FAIL) → restore → run (pass)
❌ "I wrote a regression test" without the red-green cycle
```

**CR / ship (gate Step 4):**

```
✅ `cr orchestrate` → `cr aggregate --kind code` exit 0 → "CR is clean"
✅ `pr-flow` → `gh pr view <url>` MERGED → "PR merged"
❌ "orchestrate ran, so CR is clean" / "auto-merge queued, so it's merged"
```

**Delegation (subagent / drain):**

```
✅ agent reports success → check `git diff`/`git log` → verify the change → report actual state
❌ trust the report
```

## When to apply

**Always, before:**

- any completion / success claim, or any paraphrase or implication of one
- any expression of satisfaction with the work
- committing, opening a PR, running `pr-flow`, flipping `phase: in-progress → done`
- moving to the next task or handing off
- trusting a subagent or drain iteration

This is the discipline the gate's Step 4 ship path assumes: the CR lanes and `pnpm verify` are the *checks*; this skill is the *rule* that you actually run them and read the output before you say it passed.

## The bottom line

Run the command. Read the output. THEN make the claim. No shortcuts. Non-negotiable.
