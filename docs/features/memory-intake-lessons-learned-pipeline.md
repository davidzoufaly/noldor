---
area: tooling
category: Tooling
deps: []
entry-id: Q-0026
links:
  code:
    - .claude/skills/noldor-absorb/SKILL.md
    - src/core/ff-sync.ts
    - src/triage/retro-cli.ts
  tests:
    - src/core/__tests__/ff-sync.test.ts
    - src/triage/__tests__/retro-cli.test.ts
  spec: >-
    docs/design/specs/archive/2026-07-13-memory-intake-lessons-learned-pipeline-design.md
name: Memory-Intake / Lessons-Learned Pipeline
packages:
  - scripts
phase: done
since: 2026-07-07T00:00:00.000Z
noldor-tier: specs-only
introduced: 1.0.0
---

## Summary

Systemic self-capture so the framework routinely absorbs ephemeral operator/agent knowledge into itself instead of depending on an out-of-repo assistant memory (the 2026-07-07 audit that produced Q-0019..Q-0025 was a one-time manual sweep). The intake is deliberately minimal: a `## Lessons` capture section in the existing `ideas.md` inbox (no new file, no new CLI) plus one skill — `/noldor-absorb` — that classifies each unfiled lesson (`drop` shipped-historical / `gotcha` → docs / `actionable` → triage queue / `feedback` → runbooks) and files it, stamping `[absorbed YYYY-MM-DD → <dest>]` on the source bullet. Goal: framework stays self-aware and self-owned with zero dependency on any single assistant's private memory. The session retro (`pnpm noldor triage retro`, gate Step 4.12) now does the capture after every merge, on every path and in drain; `/noldor-absorb` still does the filing.

The one-time migration of the existing Claude memories into the framework is split out as its own follow-up entry (seeded in `ideas.md` for triage); this FD ships the mechanism only.

## User Story

As an operator or agent, I want to drop a hard-won lesson under `## Lessons` in `ideas.md` and run one skill to classify and file it into the framework's own docs, so that operational knowledge lives in the repo — visible to every consumer and future agent — without a new tool, file, or CLI to learn.

## Usage

**UI**

1. Ship anything through `/noldor-gate`. After the merge, Step 4.12 (and every drain child) writes the session's lessons under `## Lessons` and its follow-ups under `## Not groomed` in the main checkout's `ideas.md`, each stamped `(<slug>, PR #<n>, <date>)`; missing sections are created, nothing is committed. You can also add a `-` bullet under `## Lessons` by hand.
2. Move ready follow-ups from `## Not groomed` under `## Verticals` for `/noldor-triage`.
3. Run `/noldor-absorb`.
4. Review the proposed disposition table (`drop | gotcha | actionable | feedback` per bullet) and batch-confirm; override any row.
5. Confirmed lessons are filed (`gotcha`/`feedback` → `docs/noldor/` page + template twin; `actionable` → `## Verticals → #### Later` for `/noldor-triage`) and stamped `[absorbed YYYY-MM-DD → <dest>]`.

**Agent/Programmatic API**

- `pnpm noldor triage retro --slug <slug> --pr <n> --file <notes> | --none` — `<notes>` holds one `lesson: <text>` or `followup: <text>` per line; exit 0 written or nothing to write, 2 usage or a malformed notes file, 1 I/O or lock.

## PRs

<!-- @prs-since-last-release: memory-intake-lessons-learned-pipeline -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-07-13-memory-intake-lessons-learned-pipeline-design.md`](../../docs/design/specs/archive/2026-07-13-memory-intake-lessons-learned-pipeline-design.md)
- **Code:**
  - [`.claude/skills/noldor-absorb/SKILL.md`](../../.claude/skills/noldor-absorb/SKILL.md)
  - [`src/core/ff-sync.ts`](../../src/core/ff-sync.ts)
  - [`src/triage/retro-cli.ts`](../../src/triage/retro-cli.ts)
- **Tests:**
  - [`src/core/__tests__/ff-sync.test.ts`](../../src/core/__tests__/ff-sync.test.ts)
  - [`src/triage/__tests__/retro-cli.test.ts`](../../src/triage/__tests__/retro-cli.test.ts)

<!-- /generated: resources -->
