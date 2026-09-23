---
status: accepted
date: 2026-09-23
supersedes: '0003'
---

# Operator Rulings on CR Findings Hold for the Session

## Context

A CR re-round inherits its prior blockers, and since Q-0260 code re-files every prior a lane does not answer resolved (`src/cr/re-round.ts`). An operator who rejects a blocker instead of fixing it leaves the content unchanged, so the lane answers "not resolved" and the next round goes red on a settled question. Until now a ruling became machine state only at the round cap, in the arbitration record, and no later round reads that record. At the spec stage ADR 0003 routed rulings into the spec and ruled out a separate per-blocker record, but a carried prior still came back unless the lane decided the ruling resolved it. Each lane also saw only its own last sink, so a finding ruled on in one lane could be filed fresh by another. Q-0261 weighed three alternatives: keeping rulings in the artifact only, adding a second command for rulings made before the cap, and matching a restated finding to a ruling by the lines it points at.

## Structural context

`cr arbitration dispose` (`src/cr/arbitration-cli.ts`, community c10 with the pre-push guards) writes the ruling into a session-scoped store beside the round ledger (`src/cr/autofix-ledger.ts`, c9). `run()` in `src/cr/orchestrate.ts` (c15, god node #7) reads the store before dispatch. The rendering and the restatement rule live in `src/cr/re-round.ts` (c16), which both prior-aware lanes already import. The receipt amend (`src/cr/amend-receipt.ts`) carries each ruling into git.

## Decision

An operator's ruling on a CR finding (accepted, rejected or deferred, with a reason) is recorded with `cr arbitration dispose` at any round. It holds for the rest of the gate session's series for that artifact kind, while the content the finding cites is unchanged. While it holds, no round hands the finding to a lane as a prior, every prior-aware lane is shown it with its reason, and a finding with the same `fingerprintBlocker` id is filed as a suggestion. Identity stays exact: code never matches a finding to a ruling by its wording or by the lines it points at. A green code round's receipt names every ruling of the session in a `Noldor-CR-Settled:` trailer. A drain child records no ruling.

At the spec stage the ruling is also written into the spec, in the contract section that fits it: Non-goals for a requirement scoped out, Risks / trade-offs for an accepted risk, and Open questions (resolved) for a design choice or a disputed feasibility claim, with its reason. A finding that re-argues a ruling recorded there has no basis and does not block, unless it shows the recorded choice cannot be built, which blocks under feasibility.

## Consequences

Easier: a ruling stops turning rounds red as soon as it is made, reaches every lane, and reaches git through the receipt. One command and one vocabulary cover every ruling, before the cap and at it.

Harder: the store is local and session-scoped, so a resumed session starts with no rulings. A lane that restates a ruled finding in new words gets a new id and blocks until it is ruled on again. A round can go green on a blocker nobody fixed; the trailer makes that visible rather than preventing it.

Ruled out: a ruling that has no machine effect before the cap, matching findings to rulings in code by similarity or location, and a drain child recording a ruling. This record supersedes ADR 0003, whose rule on spec-stage rulings is restated above. The separate per-blocker record that 0003 ruled out is now the mechanism, at every kind.
