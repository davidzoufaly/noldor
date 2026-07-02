---
area: tooling
category: Tooling
deps: []
links:
  code:
    - .claude/skills/release-sweep/SKILL.md
    - docs/noldor/complexity-gating.md
    - docs/noldor/versioning.md
    - src/garden/garden-detect.ts
    - src/hooks/noldor-enforce-review-receipt.ts
    - src/hooks/noldor-inject-trailers.ts
    - src/core/allowlist.ts
    - src/core/session.ts
    - src/release/index.ts
  plan:
    - lost-pre-extraction
    - lost-pre-extraction
    - lost-pre-extraction
  spec: lost-pre-extraction
  tests:
    - src/core/__tests__/allowlist.test.ts
    - src/core/__tests__/pr-flow-cli.test.ts
    - src/core/__tests__/session.test.ts
    - src/core/rules/__tests__/session-injected.test.ts
    - src/garden/__tests__/garden-detect.test.ts
    - src/hooks/__tests__/noldor-enforce-review-receipt.test.ts
    - src/hooks/__tests__/noldor-inject-trailers.test.ts
    - src/release/__tests__/release-session.test.ts
    - src/testing/__tests__/drain-e2e.test.ts
name: Release-Sweep Process Hardening
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.5.1
---

## Summary

Six-part overhaul of the pre-release sweep flow, surfaced during the v0.5.0 release where ~80% of operator time went into friction rather than the sweep itself. (a) **New `release-sweep` gate path** — add to `PATHS` in [src/core/session.ts](../../src/core/session.ts); allowlist `graphify-out/**`, `docs/sdd-report.md`, `docs/release-notes.md`, `docs/user/reference/api/**`, `docs/**/*.md`, `docs/superpowers/{plans,specs}/**`; multi-commit; auto-write session at skill start, auto-clear at end; skip Step 0 priority pickup. Replaces hand-written session marker + manual `Noldor-Path-Override` trailer on every sweep commit. (b) **Pre-empt release-script drift** — sweep step 6 runs `pnpm docs:build` + `pnpm sdd:report --release` and commits any drift before invoking release. Eliminates the 2 mid-release follow-up PRs the v0.5.0 sweep needed (broken-link drift + sdd-report regen drift). (c) **Path-Override trailer placement guardrail** — either `noldor-inject-trailers` moves `Noldor-Path-Override:` into the trailer block if found out-of-block, or `enforce-review-receipt` parses with `git interpret-trailers --parse` instead of regex on raw message. Closes the silent footgun where an override above `Co-Authored-By:` doesn't register. (d) **Auto re-stamp garden receipt** — release script auto-stamps at start when `garden:detect` was clean within a recent window; eliminates the manual 3× re-stamp loop after each follow-up PR merge. (e) **Garden manual-sweep detector smarter** — extend `garden-detect.ts` plan-staleness check to fall back to FD frontmatter `links.plan` and `graphify-out/graph.json` adjacency for multi-feature plans, infra plans, and `<parent>-partN` splits that today land in the manual sweep bucket (14 of 20 plans were unflagged in v0.5.0 sweep). (f) **Release-sweep skill automates PR-flow** — skill commits land on `release-sweep/<ts>` branch, pushed + auto-merged + ff-pulled before the release-confirmation prompt; folds the 4× manual temp-branch + PR dance into the skill.

## User Story

As an operator preparing a release, I want `/release-sweep` to run end-to-end unattended — graphify, refactor sweep, README drift, `docs:build` + `sdd:report --release` pre-empt, post-refactor graphify, PR open + auto-merge, ff-pull main — so that I return to a merged sweep PR with zero mid-sweep prompts and only confirm the final `pnpm release` gate.

## Usage

**CLI / Skill flow**

1. From `main` workspace, signal readiness: `/release-sweep`.
2. Skill writes `.noldor/session.json` with `{ path: 'release-sweep', startedAt: <ISO> }` and creates branch `release-sweep/<ts>` from `main`. No worktree (named carve-out from worktree-discipline; see spec §4.1).
3. Skill auto-runs the sweep pipeline: `/graphify` → `pnpm toon` → `/refactor` against new `GRAPH_REPORT.md` → README drift check → `pnpm docs:build` + `pnpm sdd:report --release` → second `/graphify` + `pnpm toon` capturing the refactor. Each step commits with `chore(release-sweep): <step>` subject; `Noldor-Path: release-sweep` injected automatically.
4. Skill invokes `pnpm pr-flow` — pushes branch, opens PR with templated body listing every sweep commit, sets `gh pr merge --auto --squash`, polls until merged, ff-pulls `main`.
5. Skill pauses with `AskUserQuestion`: "Sweep PR merged. Run `pnpm release` now?" — Yes / No / Defer.
6. On Yes: `pnpm release` runs. Release-script step 0 (new) runs `garden:detect` inline and auto-stamps the receipt on clean — no manual `/garden` re-stamp loop.
7. On No / Defer: skill exits without releasing; operator can re-invoke `pnpm release` later.
8. Skill auto-clears `.noldor/session.json` regardless of release outcome.

**Agent API**

- No `window.charuy.*` surface — this FD is operator-facing tooling.

**Keyboard shortcut**

- _none_ — CLI skill, no UI binding.

## PRs

<!-- @prs-since-last-release: release-sweep-process-hardening -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** _lost-pre-extraction_
- **Plan:**
  - _lost-pre-extraction_
  - _lost-pre-extraction_
  - _lost-pre-extraction_
- **Code:**
  - [`.claude/skills/release-sweep/SKILL.md`](../../.claude/skills/release-sweep/SKILL.md)
  - [`docs/noldor/complexity-gating.md`](../../docs/noldor/complexity-gating.md)
  - [`docs/noldor/versioning.md`](../../docs/noldor/versioning.md)
  - [`src/garden/garden-detect.ts`](../../src/garden/garden-detect.ts)
  - [`src/hooks/noldor-enforce-review-receipt.ts`](../../src/hooks/noldor-enforce-review-receipt.ts)
  - [`src/hooks/noldor-inject-trailers.ts`](../../src/hooks/noldor-inject-trailers.ts)
  - [`src/core/allowlist.ts`](../../src/core/allowlist.ts)
  - [`src/core/session.ts`](../../src/core/session.ts)
  - [`src/release/index.ts`](../../src/release/index.ts)
- **Tests:**
  - [`src/core/__tests__/allowlist.test.ts`](../../src/core/__tests__/allowlist.test.ts)
  - [`src/core/__tests__/pr-flow-cli.test.ts`](../../src/core/__tests__/pr-flow-cli.test.ts)
  - [`src/core/__tests__/session.test.ts`](../../src/core/__tests__/session.test.ts)
  - [`src/core/rules/__tests__/session-injected.test.ts`](../../src/core/rules/__tests__/session-injected.test.ts)
  - [`src/garden/__tests__/garden-detect.test.ts`](../../src/garden/__tests__/garden-detect.test.ts)
  - [`src/hooks/__tests__/noldor-enforce-review-receipt.test.ts`](../../src/hooks/__tests__/noldor-enforce-review-receipt.test.ts)
  - [`src/hooks/__tests__/noldor-inject-trailers.test.ts`](../../src/hooks/__tests__/noldor-inject-trailers.test.ts)
  - [`src/release/__tests__/release-session.test.ts`](../../src/release/__tests__/release-session.test.ts)
  - [`src/testing/__tests__/drain-e2e.test.ts`](../../src/testing/__tests__/drain-e2e.test.ts)

<!-- /generated: resources -->
