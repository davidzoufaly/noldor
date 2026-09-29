---
area: tooling
category: Tooling
deps: []
entry-id: Q-0336
links:
  code:
    - src/garden/sdd-report.ts
  tests:
    - src/core/__tests__/consumer-config.test.ts
    - src/garden/__tests__/sdd-report.test.ts
  spec: >-
    docs/design/specs/archive/2026-09-29-sdd-report-honours-ownerless-on-purpose-design.md
name: SDD Report Honours Ownerless On Purpose
packages:
  - scripts
phase: done
since: 2026-09-29T00:00:00.000Z
noldor-tier: specs-only
introduced: 1.15.0
---
## Summary

ADR 0009 says a shared helper may have no owner, but the SDD report still counts it as a gap. Detector 9 ("Code files not referenced by any feature") counts every ownerless file, and detector 19 ("Done features without code") counts FDs that #636 emptied on purpose because their code lives in shared files (the five dashboard page FDs, `scripts-reorganization-by-feature-area`, `self-boundaries-declaration-and-cycle-break`). Honest rows and real gaps sit in one list, so the counts stop meaning anything. This feature adds a `consumer.ownerless` config block that both detectors read, each entry with a reason, plus a check that flags an entry once it stops being true. Of the 20 file rows on 2026-09-29, 10 shared helpers are declared and 10 are real gaps (PR #666 gave five of those an owner, so five rows remain); all 7 FD rows are declared. Surfaced 2026-09-26, PR #640.

## Diagram

noldor:cut the change is two filters and one detector inside `src/garden/sdd-report.ts` plus a config key; no component or flow shape changes

## User Story

As a maintainer (human or agent) reading the SDD report, I want files and features that are ownerless on purpose to drop out of the gap lists, so that every row left is a real gap I should fix.

## Usage

**Agent/Programmatic API**

- Declare a shared helper or an FD whose code lives in shared files in `.noldor/config.json`, each with a reason:
  `"consumer": { "ownerless": { "files": { "src/core/session.ts": "session-marker IO used by every gate path" }, "features": { "dashboard-wip-age-page": "page renders from the shared src/dashboard/ views" } } }`
- `pnpm noldor garden sdd-report` skips declared entries in "Code files not referenced by any feature" and "Done features without code".
- The same run adds a "Stale ownerless declarations" row for any entry that no longer hides a row (file deleted, renamed or now owned; test, infra or out-of-scan path; FD gone, not done, or now has `links.code`). Remove the entry to clear it.
- A blank reason makes every `pnpm noldor` command that loads the config fail.

## PRs

<!-- @prs-since-last-release: sdd-report-honours-ownerless-on-purpose -->

## Changelog

### Initial Release (v1.15.0)

#### Summary

The SDD report now honours ownerless-on-purpose declarations (#670).

#### PRs

- #670: SDD report honours ownerless-on-purpose declarations ([link](https://github.com/davidzoufaly/noldor/pull/670))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-09-29-sdd-report-honours-ownerless-on-purpose-design.md`](../../docs/design/specs/archive/2026-09-29-sdd-report-honours-ownerless-on-purpose-design.md)
- **Code:**
  - [`src/garden/sdd-report.ts`](../../src/garden/sdd-report.ts)
- **Tests:**
  - [`src/core/__tests__/consumer-config.test.ts`](../../src/core/__tests__/consumer-config.test.ts)
  - [`src/garden/__tests__/sdd-report.test.ts`](../../src/garden/__tests__/sdd-report.test.ts)

<!-- /generated: resources -->
