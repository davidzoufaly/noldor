---
area: tooling
category: Tooling
deps: []
entry-id: Q-0170
links:
  code: []
  tests: []
name: CR Re-Round Cap Enforcement and Oscillation Detector
packages:
  - scripts
phase: in-progress
since: 2026-08-23
noldor-tier: specs-only
---

## Summary

Q-0130's re-round cap (2) is enforced in one half of the loop and asserted in the other. `AUTOFIX_ROUND_CAP` is a real bound on the auto-fix seam, but only `cr autofix record` writes the ledger it reads — an operator-driven round writes nothing, `cr orchestrate` has no round counter at all, and the combined bound is prose in a skill file. The cost is measurable: of 41 unique `Noldor-Path-Override` trailers in this repo's history, 23 name a CR round or convergence failure. The Q-0146 code CR ran 12 rounds, the reviewer finding one new med per round indefinitely while codex oscillated against its own round-4 demand and re-flagged documented `noldor:cut` sites five times.

This feature ships the enforcement half. `cr orchestrate` records every arbitration round in the existing ledger and refuses to dispatch past the cap, printing the round history and naming the `Noldor-Path-Override` remedy. A dispatch counts as a round only when it arbitrates unresolved blockers, so the extra dispatch a capped-then-fixed session needs to re-mint its `HEAD^{tree}`-bound receipt is never refused. Separately it closes the codex cut-marker gap at its source: the codex prompt is built in `run-codex.ts` and carries no cut guide and no `.noldor/rules/` cascade, so codex had never been told that a marked cut is a decision — which accounts for five of those twelve wasted rounds on its own.

The oscillation detector, locatable findings, the `noldor:cut` code-comment scanner and the machine-readable arbitration record are carved to **Q-0209** (`split-from: Q-0170`), which builds on this counter.

## Diagram

Component view of one code-review round. `cr orchestrate` gains a read of the round ledger before it dispatches and a write after the round resolves; the ledger was previously written only by `cr autofix record`, which is why an operator round was invisible to the cap.

```mermaid
flowchart TD
    GATE["/noldor-gate Step 2.5 / Step 4"] --> ORCH["cr orchestrate"]
    ORCH -->|"read: rounds so far"| LEDGER[("round ledger<br/>.noldor/cr/autofix/slug-kind.json")]
    ORCH -->|"at cap: refuse, exit 3"| STOP["print history<br/>name the override remedy"]
    ORCH -->|"under cap: dispatch"| LANES["reviewer / codex / verifier lanes"]
    LANES --> SINKS[("lane sinks<br/>.noldor/cr/slug-kind-lane.json")]
    SINKS --> ORCH
    ORCH -->|"write: round entry, origin=operator"| LEDGER
    GATE --> SEAM["cr autofix plan / record"]
    SEAM -->|"read + write, origin=autofix"| LEDGER
    LANES -.->|"codex now carries<br/>the cut-marker contract"| CUT["shared CUT_MARKER_GUIDE"]
```

## User Story

As an agent or operator running code review through `/noldor-gate`, I want the re-round cap counted and enforced in code, and the codex lane told that a documented cut is a decision, so that a review loop stops at a budget it actually has instead of running twelve rounds and closing with a hand-typed override.

## Usage

Nothing new to invoke. `cr orchestrate` is called exactly as before and behaves identically while the round budget lasts.

```
pnpm noldor cr orchestrate --slug <slug> --artifact . --kind code --base-sha origin/main
```

Once the ledger holds `AUTOFIX_ROUND_CAP` re-rounds for the pair, the next call refuses instead of dispatching, exits 3, and prints the round history plus the remedy:

```
round 3/3 for (<slug>, code) — cap reached
  1  autofix   3 applied, 1 deferred  <sha>
  2  operator  —                      <sha>
To close: fix the remaining blockers and re-review (one closing round is
still allowed), or record the arbitration:
  git commit --amend --no-edit --trailer "Noldor-Path-Override: <why>"
```

## PRs

<!-- @prs-since-last-release: cr-re-round-cap-enforcement-and-oscillation-detector -->

## Changelog
