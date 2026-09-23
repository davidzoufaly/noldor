---
status: accepted
date: 2026-09-23
---

# Code Re-files Standing CR Blockers

## Context

A CR re-round inherits the previous round's blockers, and something has to decide which of them still stand. Until now the lane decided. In `reexamine` mode the reviewer's prompt asked it to re-raise every standing blocker with its message text identical. In `fixes-in-diff` mode it simply dropped the ones it judged fixed, without saying so. Models re-word what they re-type, and a re-worded blocker gets a new `fingerprintBlocker` id (`severity|file|message`). That id is what the R1 repeat rule, the no-progress stop and arbitration dispositions all key on. So a finding that survived a fix read as a new finding, and the loop could not see that it was stuck. Q-0260 weighed two alternatives: keep the prompt-only verbatim re-raise, or run a separate check-only dispatch on every re-round, which would double each re-round's cost.

## Structural context

The rule lives in `src/cr/re-round.ts`, a new module next to `src/cr/blocking-definition.ts` in community c1. Both prompt builders already import that community: the reviewer's `src/cr/lanes/subagent-dispatch.ts` (c36) and the codex runner's `src/cr/run-codex.ts` (c2). The fingerprints the rule protects are defined in `src/cr/autofix-ledger.ts` (c37). The re-filed object is the `Finding` from the schema hub `src/cr/findings-schema.ts` (c51), which orchestrate, the ledger, arbitration and every lane import. Because the whole object is kept, none of those readers change.

## Decision

A review lane never re-types a prior blocker. It answers each prior by number, resolved or not resolved, and code re-files every prior not answered `resolved: true` as the prior sink's `Finding` object, unchanged. An unanswered, malformed or contradictory answer counts as not resolved. The rule binds every lane that inherits prior blockers, which today means the reviewer and codex.

## Consequences

Easier: a blocker keeps its fingerprint for as long as it stands, so R1, the no-progress stop and any disposition keyed on the id stay accurate by construction. A lane's claim that a blocker is fixed is explicit and carries a reason in the sink notes, so a wrong claim can be seen.

Harder: every lane that inherits priors needs a `prior` field in its answer schema, and for codex strict structured output makes that field required. A lane that loses its answers, for example in a repair round, keeps every prior red for that round.

Ruled out: asking a model to re-raise a standing blocker verbatim, and a lane dropping a prior it judges fixed without answering for it.
