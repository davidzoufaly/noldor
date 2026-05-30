---
noldor-page: index
introduced: 0.4.0
---

# Noldor

Noldor is the dev-loop framework that ships embedded in this repo: complexity-gated feature pipeline, worktree discipline, /promote /triage /garden skills, SDD audit, graphify integration. The pages in this folder are the single source of truth for framework rules — CLAUDE.md and README.md hold only Charuy product-specific overlays.

## When to read

| You are...                            | Read                                                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New to the framework                  | [`lifecycle.md`](lifecycle.md), then [`complexity-gating.md`](complexity-gating.md)                                                                                                         |
| Starting a feature                    | Run [`/gate`](../../.claude/skills/gate/SKILL.md) first — then [`complexity-gating.md`](complexity-gating.md), [`workflow.md`](workflow.md), [`feature-md-schema.md`](feature-md-schema.md) |
| Working in parallel branches          | [`worktree-discipline.md`](worktree-discipline.md), [`git-and-commits.md`](git-and-commits.md)                                                                                              |
| Writing tests                         | [`testing-principles.md`](testing-principles.md)                                                                                                                                            |
| Releasing                             | [`versioning.md`](versioning.md)                                                                                                                                                            |
| Reviewing code                        | [`cr-pipeline.md`](cr-pipeline.md)                                                                                                                                                          |
| Finishing a feature (PR + auto-merge) | [`pr-flow.md`](pr-flow.md)                                                                                                                                                                  |
| Writing docs                          | [`doc-conventions.md`](doc-conventions.md)                                                                                                                                                  |
| Auditing the framework                | [`garden-and-drift.md`](garden-and-drift.md), [`triage.md`](triage.md)                                                                                                                      |
| Looking up a pnpm script              | [`script-catalog.md`](script-catalog.md)                                                                                                                                                    |
| Bootstrapping Noldor in another repo  | [`adoption-guide.md`](adoption-guide.md) (stub — framework still WIP)                                                                                                                       |

## Pages

- [`lifecycle.md`](lifecycle.md) — pipeline diagram + 6 gate paths
- [`complexity-gating.md`](complexity-gating.md) — 6-path model (micro-chore / fast-track / specs-only-new / specs-only-attach / full-new / full-attach), allowlist, override
- [`cr-pipeline.md`](cr-pipeline.md) — Claude + Codex two-pass review, override trailer, release gate
- [`pr-flow.md`](pr-flow.md) — PR flow + agent auto-merge, pre-push hook, GitHub branch protection, release-push override
- [`feature-md-schema.md`](feature-md-schema.md) — FD frontmatter + body structure
- [`worktree-discipline.md`](worktree-discipline.md) — always-worktree, parallel cap, port-per-tree
- [`git-and-commits.md`](git-and-commits.md) — Conventional Commits, semver, granular commits
- [`workflow.md`](workflow.md) — /promote, /draft-feature-md, after-feature update, defer-past-milestone
- [`doc-conventions.md`](doc-conventions.md) — @feature: / @tests: tags, transclude, generated markers
- [`triage.md`](triage.md) — `/triage` skill flow + roadmap/backlog/ideas buckets
- [`testing-principles.md`](testing-principles.md) — testing layers, fixtures, e2e seeding
- [`versioning.md`](versioning.md) — semver policy + release flow
- [`skill-catalog.md`](skill-catalog.md) — /promote, /triage, /garden, /draft-feature-md, /new-feature reference
- [`script-catalog.md`](script-catalog.md) — every pnpm script the framework relies on, grouped by concern
- [`garden-and-drift.md`](garden-and-drift.md) — what /garden detects + sentinel rules
- [`graph-integration.md`](graph-integration.md) — graphify ↔ SDD substrate
- [`adoption-guide.md`](adoption-guide.md) — stub; framework is WIP, standalone-package lift tracked in backlog
- [`engineering-principles.md`](engineering-principles.md) — generic TS / React / a11y / testing principles
