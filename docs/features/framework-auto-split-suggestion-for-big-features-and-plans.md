---
area: tooling
category: Tooling
deps: []
links:
  code: []
  docs: []
  tests: []
  spec: >-
    docs/superpowers/specs/2026-07-03-framework-auto-split-suggestion-for-big-features-and-plans-design.md
name: Framework Auto-Split Suggestion for Big Features and Plans
packages:
  - scripts
phase: in-progress
noldor-tier: specs-only
---
## Summary

When a feature or plan grows past size thresholds, the framework should suggest a split rather than letting work calcify around an oversized FD or unwieldy plan. Heuristics: word count, scope-bullet count, file-touch breadth (from `links.code`), or for plans the row count. The suggestion surfaces in `/promote` (feature) and the plan skill before the operator commits to the path. Today the operator is on their own to spot oversized scope — live example: `prefix-skills-with-noldor` sat mislabeled S for weeks until a drain attempt revealed an L-sized self-referential mega-rename (now parked in backlog, re-sized).

- Plan threshold — suggest split when a plan exceeds ~1000 rows (one part = ~1000 rows). Use this as the initial heuristic and tune with experience.

## User Story

As an operator promoting roadmap entries and reviewing plans, I want the framework to flag oversized scope — bloated entry bodies at `/promote`, everything-FD attaches, and plans past ~1000 rows — before I commit to a path, so that work gets split early instead of calcifying around a mislabeled entry or an unwieldy plan.

## Usage

**Ad-hoc CLI**

```
pnpm noldor noldor split-check --entry <slug>        # roadmap/backlog body heuristics (E1–E3)
pnpm noldor noldor split-check --fd <slug> --add p1.ts --add p2.ts   # attach breadth (F1)
pnpm noldor noldor split-check --plan docs/superpowers/plans/2026-07-03-foo.md  # row count (P1)
```

Exit 0 = clean, 2 = signals on stdout (one per line), 1 = infra error.

**In-flow (no extra operator action)**

1. `/promote <slug>` — step 1.7 runs the entry check automatically; on signals, pick proceed / split-first / abort-and-re-size. Attach picks also see the F1 parent-breadth signal.
2. `noldor-plan` — post-save check; an oversized plan is restructured into `-part<N>` files before the skill reports done.
3. `/gate` Step 2.5 `--kind plan` — split findings appear alongside lint findings in the continue-dialog, informational.
4. Headless drain — an entry whose body trips the signals is bounced to the escalation surface instead of shipped.

**Keyboard shortcut** — none (CLI + skill flow).

## PRs

<!-- @prs-since-last-release: framework-auto-split-suggestion-for-big-features-and-plans -->

## Changelog
