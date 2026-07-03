---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/cr/review-profile.ts
    - src/cr/config.ts
  docs: []
  tests:
    - src/cr/__tests__/review-profile.test.ts
    - src/cr/__tests__/config.test.ts
  spec: docs/superpowers/specs/archive/2026-06-13-code-reviewer-20-design.md
  plan: docs/superpowers/plans/archive/2026-06-13-code-reviewer-20.md
name: Code Reviewer 2.0
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.4.0
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

### Initial Release (v0.4.0)

#### Summary

Added a review-profile schema along with built-in profiles (#98).

#### PRs

- #98: add review-profile schema and built-in profiles ([link](https://github.com/davidzoufaly/noldor/pull/98))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-06-13-code-reviewer-20-design.md`](../../docs/superpowers/specs/archive/2026-06-13-code-reviewer-20-design.md)
- **Plan:**
  - [`docs/superpowers/plans/archive/2026-06-13-code-reviewer-20.md`](../../docs/superpowers/plans/archive/2026-06-13-code-reviewer-20.md)

<!-- /generated: resources -->
