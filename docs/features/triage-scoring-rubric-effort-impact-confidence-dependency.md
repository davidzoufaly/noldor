---
area: tooling
category: Tooling
deps: []
links:
  code:
    - .claude/skills/triage/SKILL.md
    - docs/noldor/triage.md
    - src/triage/score.ts
  tests: []
name: '`/triage` Scoring Rubric (effort × impact × confidence × dependency)'
packages:
  - scripts
  - skills
  - docs
phase: done
noldor-tier: specs-only
introduced: 0.5.1
---

## Summary

Replace the now/next/later bucket heuristic in `/triage` with a derived integer score from an `effort × impact × confidence × dependency-weight` matrix. Effort = build cost (S/M/L or 1-5; mirrors existing `- size:` field). Impact = user usefulness / strategic value (mirrors existing `- impact:` field). Confidence = how sure we are about effort + impact at triage time. Dependency-weight discounts items blocked on unshipped work. `/triage` proposes the score, operator confirms; the score feeds priority — either ordering the file directly (current Path 1 convention) or filling the explicit `- priority:` field if Path 2 lands. Folds in the former `Multi-Factor Triage Value Scoring` entry (was `## Later → Tooling`, since 2026-04-28, dropped on 2026-05-11 fold).

## User Story

As a Noldor operator running `/triage` on a fresh batch of ideas, I want each row in the confirmation table to show a computed score, so I can pick insert positions from a numeric ranking instead of pure judgment — and so the same input always produces the same ordering.

## Usage

Set the new bullet fields when triaging:

- `- confidence: low | med | high` — how sure the size + impact estimate is.
- `- deps: <slug>, <slug>` — comma-separated kebab slugs of unshipped blockers; empty when none.

`/triage` proposes both per row and prints a `score` column in the confirmation table:

```
Idea                  | proposal | size | impact | conf | score
──────────────────────┼──────────┼──────┼────────┼──────┼──────
new perf tracking     | roadmap  | M    | high   | med  | 150
brand identity        | merge    | L    | high   | high | 133
```

Higher score = higher priority. The operator uses the score to pick `top` / `after:<slug>` / `bottom` insert positions. Score is recomputed on every `/triage` run; it is not persisted to the schema-C block.

## PRs

<!-- @prs-since-last-release: triage-scoring-rubric-effort-impact-confidence-dependency -->

## Changelog

### Initial Release (v0.5.1)

#### Summary

Triage-list-untriaged now tolerates missing ideas.md.

#### PRs

- #15: tolerate missing ideas.md in triage-list-untriaged ([link](https://github.com/davidzoufaly/charuy/pull/15))

### 0.5.0 (in-progress)

#### Summary

This release tolerates a missing `ideas.md` in `triage-list-untriaged` (#15), boundary-validates CLI input and switches FD parsing to `gray-matter`, surfaces a proposed confidence and surface score in the triage table, adds a score helper alongside a dependency resolver and CLI, drops stale `## Next` wrappers from test fixtures, and parses confidence and deps bullets.

#### PRs

- #15: tolerate missing ideas.md in triage-list-untriaged ([link](https://github.com/davidzoufaly/charuy/pull/15))

<!-- generated: resources -->

## Resources

- **Code:**
  - [`.claude/skills/triage/SKILL.md`](../../.claude/skills/triage/SKILL.md)
  - [`docs/noldor/triage.md`](../../docs/noldor/triage.md)
  - [`src/triage/score.ts`](../../src/triage/score.ts)

<!-- /generated: resources -->
