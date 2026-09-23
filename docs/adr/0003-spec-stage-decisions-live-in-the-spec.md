---
status: accepted
date: 2026-09-23
---

# Spec-Stage Decisions Live in the Spec

## Context

A spec CR round inherits its prior blockers, and the Q-0260 contract (`src/cr/re-round.ts`) carries every prior a lane does not answer resolved. When the operator rejects a spec blocker at `address-blockers` instead of applying it, the gate skill said to record the rationale in chat. No lane reads chat, so the next round could re-file the rejected blocker, and the round stayed red until the cap's arbitration. Q-0263 made the spec-stage blocking definition (`SPEC_BLOCKING_DEFINITION`, `src/cr/blocking-definition.ts`) name three bases: a missing or contradictory requirement, a design that cannot be built, and a risk the spec neither prevents nor accepts. That leaves the question of where an operator's ruling on a spec finding is written down. The alternatives were chat, which no lane can see, and a separate disposition record per blocker, which would add state beside a document that already has sections for scope, accepted risk and settled choices.

## Structural context

The definition lives in `src/cr/blocking-definition.ts` (community c0), next to `re-round.ts` and the codex runner, and both prompt builders render it: the reviewer's `src/cr/lanes/subagent-dispatch.ts` (c25) and `src/cr/run-codex.ts` (c0). No schema, ledger or orchestrate code carries the ruling. It travels in the artifact every lane already reads.

## Decision

An operator's ruling on a spec-stage finding is recorded in the spec itself, in the contract section that fits it: Non-goals for a requirement scoped out, Risks / trade-offs for an accepted risk, and Open questions (resolved) for a design choice or a disputed feasibility claim, with its reason. A finding that re-argues a ruling recorded there has no basis and does not block, unless it shows the recorded choice cannot be built, which blocks under feasibility.

## Consequences

Easier: a ruling reaches every lane of every later round with no new state, survives a context compaction and a fresh clone, and is reviewed as part of the spec. Each basis has a resolution that does not require agreeing with the lane: add or scope out a requirement, fix one side of a contradiction, prevent or accept a risk, answer a feasibility claim.

Harder: settling a finding edits the spec, so a ruling is itself spec content that a delta re-round reviews. The operator must also pick the right section for it. A feasibility claim the lane still upholds after the answer is carried, and only the round cap's arbitration closes it.

Ruled out: recording spec-stage rulings only in chat, and a separate per-blocker disposition record for the spec stage. Finding identity and dispositions across rounds and lanes at every kind remain Q-0261's to decide, and a record from Q-0261 that changes this rule supersedes this one.
