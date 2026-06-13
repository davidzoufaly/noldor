---
area: tooling
category: Tooling
deps: []
links:
  code: []
  docs: []
  tests: []
  spec: docs/superpowers/specs/2026-06-13-code-reviewer-20-design.md
  plan: docs/superpowers/plans/2026-06-13-code-reviewer-20.md
name: Code Reviewer 2.0
packages:
  - scripts
phase: done
noldor-tier: full
---
## Summary

Next-generation code reviewer, taking inspiration from the MC Code Reviewer. Raise review quality beyond the current CR lane.

- Code-reviewer configuration for fast-track — let fast-track tune/scope the CR pass.

## User Story

As an operator running the autonomous drain, I want each CR lane to review
along explicit, configurable dimensions at a per-path effort level, so that
full-tier features get a deep multi-dimension review while fast-track XS/S
changes get a fast, focused correctness+security pass instead of the same
one-size-fits-all prompt.

## Usage

Config (`.noldor/config.json`) — optional; built-ins apply when absent:
```json
{
  "crReview": {
    "profiles": {
      "fast-track": { "effort": "low", "dimensions": ["correctness", "security"] },
      "default": { "effort": "high", "dimensions": ["correctness","security","reuse","simplification","efficiency","altitude"] }
    }
  }
}
```

CLI — select a profile for one orchestrate run:
```bash
pnpm noldor cr orchestrate --slug <slug> --artifact <paths> --kind code \
  --lanes subagent --base-sha origin/main --profile fast-track
```
Omit `--profile` → `default` profile. Gate's fast-track Step 4 appends
`--profile fast-track` automatically when the session path is `fast-track`.

## PRs

<!-- @prs-since-last-release: code-reviewer-20 -->

## Changelog
