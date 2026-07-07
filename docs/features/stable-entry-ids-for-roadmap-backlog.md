---
area: tooling
category: Tooling
deps: []
links:
  code:
    - docs/roadmap.md
    - docs/backlog.md
    - .claude/skills/triage/SKILL.md
    - .claude/skills/new-feature/SKILL.md
    - .claude/skills/promote/SKILL.md
    - src/triage/entry-id.ts
    - src/triage/mint-id-cli.ts
    - src/triage/backfill-ids-cli.ts
    - src/triage/score.ts
    - src/triage/validate-triage.ts
    - src/utils/parse-blocks.ts
    - src/core/feature-schema.ts
    - src/cli/manifest.ts
    - docs/noldor/triage.md
    - docs/noldor/feature-md-schema.md
  docs: []
  tests:
    - src/triage/__tests__/entry-id.test.ts
  spec: >-
    docs/superpowers/specs/2026-07-03-stable-entry-ids-for-roadmap-backlog-design.md
name: Stable Entry IDs for Roadmap + Backlog
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.5.0
---
## Summary

Every roadmap and backlog entry is identified today by its kebab-slug derived from the heading. Slugs are rename-fragile — renaming an entry breaks every `deps:`, `parent:`, commit trailer, and dashboard link that targets it; moving an entry between roadmap ↔ backlog preserves the slug but loses heading-evolution traceability. Introduce a stable short ID minted at first triage and never rewritten: e.g. `R-0042` for roadmap and `B-0042` for backlog, or a single `Q-0042` namespace that survives cross-file moves. The ID becomes the canonical reference for `blocked-by:` / `parent:` / commit trailers / dashboard links / garden detectors. Slug stays a human-readable alias that can be rewritten without breakage. Counter persists in `.noldor/id-counter.json`; `/triage` and `/new-feature` mint IDs at creation. Migration: one-sweep backfill across current entries (~25 roadmap + ~7 backlog as of 2026-07-02).

## User Story

As an operator (or autonomous drain agent) managing the Noldor queue, I want every roadmap and backlog entry to carry a stable ID minted at triage and never rewritten, so that renaming a heading or moving an entry between roadmap and backlog never breaks `deps:` references, commit trailers, dashboard links, or detector output that target it.

## Usage

**Minting (automatic)** — `/triage` mints IDs for confirmed new-entry rows and writes `- id: Q-NNNN` as the first bullet of each schema-C block; `/new-feature` and `/promote` carry the ID into FD frontmatter as `entry-id`.

**CLI**

```bash
pnpm noldor triage mint-id [--count N]   # print next N IDs, bump .noldor/id-counter.json
pnpm noldor triage backfill-ids          # idempotent one-sweep stamp of all id-less entries
pnpm noldor validate triage              # now also enforces presence/format/cross-file uniqueness of ids
pnpm noldor triage score --deps=Q-0042   # deps accept IDs or slugs interchangeably
```

**Authoring rule** — never write `- id:` by hand except when resolving a counter merge conflict; never renumber; renaming a heading is now safe (slug is an alias).

**Agent API** — none beyond the CLI; agents reference entries by ID in `deps:` and (post `first-class-blocked-by`) `blocked-by:`.

## PRs

<!-- @prs-since-last-release: stable-entry-ids-for-roadmap-backlog -->

## Changelog

### Initial Release (v0.5.0)

#### Summary

Introduces stable entry IDs (Q-NNNN) for roadmap + backlog (#157).

#### PRs

- #157: stable entry IDs (Q-NNNN) for roadmap + backlog ([link](https://github.com/davidzoufaly/noldor/pull/157))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/2026-07-03-stable-entry-ids-for-roadmap-backlog-design.md`](../../docs/superpowers/specs/2026-07-03-stable-entry-ids-for-roadmap-backlog-design.md)
- **Code:**
  - [`docs/roadmap.md`](../../docs/roadmap.md)
  - [`docs/backlog.md`](../../docs/backlog.md)
  - [`.claude/skills/triage/SKILL.md`](../../.claude/skills/triage/SKILL.md)
  - [`.claude/skills/new-feature/SKILL.md`](../../.claude/skills/new-feature/SKILL.md)
  - [`.claude/skills/promote/SKILL.md`](../../.claude/skills/promote/SKILL.md)
  - [`src/triage/entry-id.ts`](../../src/triage/entry-id.ts)
  - [`src/triage/mint-id-cli.ts`](../../src/triage/mint-id-cli.ts)
  - [`src/triage/backfill-ids-cli.ts`](../../src/triage/backfill-ids-cli.ts)
  - [`src/triage/score.ts`](../../src/triage/score.ts)
  - [`src/triage/validate-triage.ts`](../../src/triage/validate-triage.ts)
  - [`src/utils/parse-blocks.ts`](../../src/utils/parse-blocks.ts)
  - [`src/core/feature-schema.ts`](../../src/core/feature-schema.ts)
  - [`src/cli/manifest.ts`](../../src/cli/manifest.ts)
  - [`docs/noldor/triage.md`](../../docs/noldor/triage.md)
  - [`docs/noldor/feature-md-schema.md`](../../docs/noldor/feature-md-schema.md)
- **Tests:**
  - [`src/triage/__tests__/entry-id.test.ts`](../../src/triage/__tests__/entry-id.test.ts)

<!-- /generated: resources -->
