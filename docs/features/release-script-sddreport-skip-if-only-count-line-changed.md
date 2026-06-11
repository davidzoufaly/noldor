---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/release/index.ts
    - src/release/sdd-report-diff.ts
    - src/garden/sdd-report.ts
    - src/garden/sdd-report-format.ts
  tests:
    - src/release/__tests__/sdd-report-diff.test.ts
name: 'Release Script `sdd:report` Skip-If-Only-Count-Line-Changed'
packages:
  - noldor
phase: done
noldor-tier: specs-only
introduced: 0.3.0
---
## Summary

`src/release/index.ts` runs `pnpm noldor garden sdd-report --release` and aborts when `docs/sdd-report.md` is dirty. But `sdd:report` is not idempotent: the `Review-skip count (last 30 days)` line increments by 1 per commit on the active branch (each sweep commit lacks `Noldor-Reviewed` and counts as a review-skip). Even when `/release-sweep` step 5.5 pre-emptively commits the regen, the release-time re-run always produces a +1 diff and aborts. Discovered 2026-05-17 during `release-sweep-process-hardening` part 2 plan execution (idempotency verification failed). Two fix candidates: (a) release-script treats "only the review-skip count line changed" as clean and proceeds; (b) `sdd:report` gains a flag to exclude in-flight branch commits from the count. Until shipped, the release operator hits a single sdd:report-driven retry on the first `pnpm release` after sweep PR merge.

## User Story

As a release operator running `pnpm release`, I want the release to continue when the regenerated `docs/sdd-report.md` differs only in its rolling review-skip count line, so that I'm not forced into a spurious abort-and-retry on every release after a doc-sweep.

## Usage

Automatic — no manual step. During `pnpm release`, after `noldor garden sdd-report --release` regenerates `docs/sdd-report.md`:

- If the report is unchanged, the release proceeds as before.
- If the **only** changed line is `Gated commits missing \`Noldor-Reviewed\` trailer: <n>` (the count bumps once per in-flight branch commit), the release logs `folding regen into the release commit`, proceeds, and stages the regenerated report into the `chore(release)` commit so `main` carries the accurate count.
- If any other part of the report changed (a new gap, an override entry), the release still aborts with the "commit the regenerated report" error — real content drift remains an operator decision.
- On a first release with no committed `docs/sdd-report.md` baseline, the original abort behavior is kept.

## PRs

<!-- @prs-since-last-release: release-script-sddreport-skip-if-only-count-line-changed -->

## Changelog

<!-- generated: resources -->

## Resources

- **Code:**
  - [`src/release/index.ts`](../../src/release/index.ts)
  - [`src/release/sdd-report-diff.ts`](../../src/release/sdd-report-diff.ts)
  - [`src/garden/sdd-report.ts`](../../src/garden/sdd-report.ts)
  - [`src/garden/sdd-report-format.ts`](../../src/garden/sdd-report-format.ts)
- **Tests:**
  - [`src/release/__tests__/sdd-report-diff.test.ts`](../../src/release/__tests__/sdd-report-diff.test.ts)

<!-- /generated: resources -->
