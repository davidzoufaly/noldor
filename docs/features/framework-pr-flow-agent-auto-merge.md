---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/core/pr-flow.ts
    - src/core/cr-retry.ts
    - src/core/phase-revert.ts
    - src/hooks/noldor-pre-push.ts
    - src/garden/detectors/branch-protection.ts
    - src/garden/detectors/override-audit.ts
    - src/release/index.ts
    - src/release/release-fd-changelog.ts
    - src/release/release-markers.ts
    - src/release/release-pr-bullets.ts
    - src/release/release-find-first-pr-commit.ts
  spec: >-
    lost-pre-extraction
  tests:
    - src/core/__tests__/phase-revert.test.ts
    - src/release/__tests__/release-fd-changelog-in-progress.test.ts
    - src/release/__tests__/release-fd-changelog-initial-release.test.ts
    - src/release/__tests__/release-find-first-pr-commit.test.ts
    - src/release/__tests__/release-markers-auto-restore.test.ts
    - src/release/__tests__/release-pr-bullets.test.ts
name: Framework PR Flow + Agent Auto-Merge
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.5.1
---

## Summary

Add first-class PR support to Noldor: feature work on a worktree branch lands via PR rather than direct merge to main. Agent-side question: can the controlling agent open the PR, run the CR pipeline (Claude + Codex), and auto-merge once green? Today merge is a manual operator step. Encode the GitHub PR flow in the framework (separate from `/gate`'s commit gating) and explore agent permissions for `gh pr create` + `gh pr merge --auto`. Pairs with the existing CR pipeline — review gate becomes the merge gate.

## User Story

As an operator driving `/gate` (human or agent controlling the framework), I want the worktree branch to land on `main` via an auto-merged GitHub PR instead of a direct local merge, so that every integration boundary carries a PR audit trail, runs the CR pipeline as the merge gate, and can be cross-machine-enforced via GitHub branch protection.

## Usage

**`/gate` end-of-flow (post-implementation, all non-micro-chore paths)**

1. With session marker active and worktree branch ready, signal "ready to ship" to `/gate`.
2. Gate runs Claude review + `pnpm cr:codex` + retry loop until clean (max 3 codex retries; on `exhausted`, surfaces findings via AskUserQuestion).
3. Gate invokes `src/core/pr-flow.ts openAndAutoMerge()` — pushes branch, opens PR via `gh pr create`, sets `gh pr merge --auto --squash`, polls `gh pr view` until merged (timeout 10min, 20min if PR enters `BEHIND` state).
4. On merge: gate cleans up via `ExitWorktree` (worktree removed, local branch deleted), prints the PR URL, hands off to Step 5 next-priority handoff.

**`/gate` micro-chore path (no worktree)**

1. Edit allowlisted files on local `main` (no worktree).
2. Commit (existing pre-commit allowlist gate enforces scope).
3. Gate creates a temp branch `micro/<utc-timestamp>` at HEAD, resets local `main` to `origin/main`, pushes the temp branch.
4. Same PR/auto-merge flow as above. On merge: `git branch -D <temp-branch>` + `git fetch origin main && git rebase origin/main`.

**`pnpm release` (release-push override)**

- `pnpm release` sets `NOLDOR_RELEASE_PUSH=1` immediately before `git push origin main`. The pre-push hook recognizes this env var and allows the push.
- Each release push appends a receipt line to `.noldor/release-pushes.log` (`<iso> <sha> <pkg-version>`), audited by `pnpm garden:detect` (override-audit detector).

**One-time operator setup**

1. `brew install gh` (or platform equivalent). `gh auth login` (scopes: `repo`, `read:org`). Verify with `gh auth status`.
2. After the local hook lands and survives ~1 week of dogfooding, apply GitHub branch protection on `origin/main` per [`docs/noldor/pr-flow.md`](../noldor/pr-flow.md):
   - Require a pull request before merging.
   - No bypass roles (admin included).
3. `pnpm garden:detect` runs the new `branch-protection.ts` detector to confirm settings are applied and unchanged.

**Failure runbook**

- `gh` missing → `brew install gh` + auth (preflight check in `openAndAutoMerge` step 0 surfaces a `GhPreflightError` before any git push).
- `gh` unauthenticated → `gh auth login`.
- PR creation 403 / pre-receive hook → check `gh auth status` scopes; verify branch protection allows PR creation from operator's role.
- Auto-merge times out → `gh pr view <pr-url>` to check status (`BEHIND` = waiting on base sync; `BLOCKED` = required checks failing); manually merge or intervene as needed.
- Direct push to `main` blocked locally → look at session marker; if PR flow should be running but isn't, ensure `/gate` end-of-flow was invoked; otherwise use the release override only for actual releases.

**Keyboard shortcut**

_none — framework / git-flow feature, not a UI action._

**Agent API**

_none — operates through `gh` CLI, lefthook hooks, and `pnpm` scripts; no `window.charuy.*` surface._

**`/gate full-attach` / `specs-only-attach` (enhancement on a done FD)**

1. Operator selects `full-attach` or `specs-only-attach` in `/gate` Step 1 and supplies the parent FD slug.
2. Gate scaffolding reads `docs/features/<parent>.md`. If `phase: done`, gate runs `src/core/phase-revert.ts:revertPhaseForAttach` on the file and commits the revert on the worktree branch as `docs(features:<parent>): revert phase done → in-progress for attach session`.
3. Enhancement spec / plan / implementation proceed normally on the worktree branch. No restore commit is written by `finishing-a-development-branch`.
4. PR squash-merges to main. Main's parent FD now shows `phase: in-progress` (the revert is preserved through the squash).
5. Next `pnpm release` runs. Step 3 renders a `### <X> (in-progress)` block under the parent FD's `## Changelog` (the (in-progress) label is permanent — historical signal). Step 4 (`fillMarkers`) detects `phase: in-progress` + `introduced` already set + changelog block → auto-flips `phase: done` + sets `updated: vX`.

The (in-progress) heading suffix distinguishes attach-originated work from direct maintenance edits; the distinction is visible in the FD body forever.

**Lag window (operational caveat).** Between the attach PR squash-merging and the next `pnpm release` running, main's parent FD shows `phase: in-progress` even though no active worktree exists for the enhancement. Dashboards keying off `phase` will see this as "active development" until the next release auto-restores phase to `done`. This is accepted (per spec §8 Open Question #3) — the alternative would require a second PR just for the phase flip, which the framework's "1 PR = 1 commit" model explicitly avoids.

## PRs

<!-- @prs-since-last-release: framework-pr-flow-agent-auto-merge -->

## Changelog

### Initial Release (v0.5.1)

#### Summary

This release fixes composeBody so Feature MD links fall through to session.parent on attach paths (#11), lands the pr-push-speed-fix triple-bundle covering lefthook use_stdin + readStdin seatbelt + pnpm pr-flow CLI + runbook (#7), activates PR-flow bootstrap via lefthook + /gate skill + allowlist (#3), and drops the pending-priority file mechanism (#2).

#### PRs

- #11: composeBody Feature MD link falls through to session.parent on attach paths ([link](https://github.com/davidzoufaly/charuy/pull/11))
- #7: pr-push-speed-fix triple-bundle (lefthook use_stdin + readStdin seatbelt + pnpm pr-flow CLI + runbook) ([link](https://github.com/davidzoufaly/charuy/pull/7))
- #3: activate PR-flow bootstrap (lefthook + /gate skill + allowlist) ([link](https://github.com/davidzoufaly/charuy/pull/3))
- #2: drop pending-priority file mechanism ([link](https://github.com/davidzoufaly/charuy/pull/2))

### 0.5.0 (in-progress)

#### Summary

This release fixes composeBody's Feature MD link falling through to session.parent on attach paths (#11) and adds a revertPhaseForAttach pure function, extends fillMarkers with phase-aware 4-branch logic, adds renderPerReleaseBlock and renderInitialReleaseBlock while rewiring generateFdChangelogs, and introduces findFirstPrCommit and renderPrBullets helpers alongside fixes addressing final review findings. On the release and PR-flow side, it sets NOLDOR_RELEASE_PUSH=1 on release push and registers a pre-push hook script, adds a branch-protection /garden detector, auditReleasePushes in override-audit, a pre-push hook blocking direct origin/main, a cr-retry runCrRetryLoop module, Task 2 code-review fixes, preflightGh, pollAutoMerge, and openAndAutoMerge, plus composeTitle and composeBody pure functions. It also delivers the pr-push-speed-fix triple-bundle (lefthook use_stdin + readStdin seatbelt + pnpm pr-flow CLI + runbook) (#7), activates the PR-flow bootstrap (lefthook + /gate skill + allowlist) (#3), and drops the pending-priority file mechanism (#2).

#### PRs

- #11: composeBody Feature MD link falls through to session.parent on attach paths ([link](https://github.com/davidzoufaly/charuy/pull/11))
- #7: pr-push-speed-fix triple-bundle (lefthook use_stdin + readStdin seatbelt + pnpm pr-flow CLI + runbook) ([link](https://github.com/davidzoufaly/charuy/pull/7))
- #3: activate PR-flow bootstrap (lefthook + /gate skill + allowlist) ([link](https://github.com/davidzoufaly/charuy/pull/3))
- #2: drop pending-priority file mechanism ([link](https://github.com/davidzoufaly/charuy/pull/2))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-05-15-framework-pr-flow-agent-auto-merge-design.md`](../../docs/superpowers/specs/archive/2026-05-15-framework-pr-flow-agent-auto-merge-design.md)
- **Code:**
  - [`src/core/pr-flow.ts`](../../src/core/pr-flow.ts)
  - [`src/core/cr-retry.ts`](../../src/core/cr-retry.ts)
  - [`src/core/phase-revert.ts`](../../src/core/phase-revert.ts)
  - [`src/hooks/noldor-pre-push.ts`](../../src/hooks/noldor-pre-push.ts)
  - [`src/garden/detectors/branch-protection.ts`](../../src/garden/detectors/branch-protection.ts)
  - [`src/garden/detectors/override-audit.ts`](../../src/garden/detectors/override-audit.ts)
  - [`src/release/index.ts`](../../src/release/index.ts)
  - [`src/release/release-fd-changelog.ts`](../../src/release/release-fd-changelog.ts)
  - [`src/release/release-markers.ts`](../../src/release/release-markers.ts)
  - [`src/release/release-pr-bullets.ts`](../../src/release/release-pr-bullets.ts)
  - [`src/release/release-find-first-pr-commit.ts`](../../src/release/release-find-first-pr-commit.ts)
- **Tests:**
  - [`src/core/__tests__/phase-revert.test.ts`](../../src/core/__tests__/phase-revert.test.ts)
  - [`src/release/__tests__/release-fd-changelog-in-progress.test.ts`](../../src/release/__tests__/release-fd-changelog-in-progress.test.ts)
  - [`src/release/__tests__/release-fd-changelog-initial-release.test.ts`](../../src/release/__tests__/release-fd-changelog-initial-release.test.ts)
  - [`src/release/__tests__/release-find-first-pr-commit.test.ts`](../../src/release/__tests__/release-find-first-pr-commit.test.ts)
  - [`src/release/__tests__/release-markers-auto-restore.test.ts`](../../src/release/__tests__/release-markers-auto-restore.test.ts)
  - [`src/release/__tests__/release-pr-bullets.test.ts`](../../src/release/__tests__/release-pr-bullets.test.ts)

<!-- /generated: resources -->
