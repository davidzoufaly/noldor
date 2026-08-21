---
noldor-page: pr-flow
introduced: 0.5.0
---

# PR Flow + Agent Auto-Merge

Every gate path lands `main` only via a GitHub PR opened by the controlling agent. The CR pipeline (`pnpm noldor cr orchestrate --kind code`, reviewer lane by default; codex opt-in via `crLanes.code` config, and forced automatically on M/L/XL sessions — see cr-pipeline.md) runs locally as a pre-merge gate; once green, the agent sets `gh pr merge --auto --squash` and polls until merged.

## Top-level flow

```
gate end-of-flow (any path)
  ├─ code-stage CR (noldor cr orchestrate --kind code, reviewer lane; codex opt-in via crLanes.code, forced on M/L/XL sessions) — address inline, no retry cap
  ├─ pnpm noldor pr-flow → openAndAutoMerge (src/core/pr-flow-cli.ts → pr-flow.ts):
  │    1. preflight: gh --version + gh auth status
  │    2. git push --force-with-lease --set-upstream origin <branch>
  │    3. gh pr create --base main --head <branch> --title <…> --body <…>
  │    4. gh pr merge <pr> --auto --squash
  │       └─ on failure (e.g. repo doesn't have auto-merge enabled): retry `gh pr merge --squash` synchronously (`--delete-branch` only outside a linked worktree), verify via `gh pr view --json mergedAt,state,headRefName`
  │    5. poll gh pr view --json mergedAt,state,mergeStateStatus until merged (10min timeout; 20min if BEHIND) — streams a throttled status line per cycle (Auto-merge: state=…, mergeStateStatus=…, elapsed=…s) to stderr; skipped on the fallback path because the synchronous merge has already completed
  ├─ explicit cleanup: git worktree remove + git branch -D (worktree paths) OR delete temp branch (micro-chore)
  ├─ sync local main to origin/main (git fetch + ff-only merge / rebase) — PR is not "finished" until local main matches origin
  └─ Step 5 next-priority handoff (always-clear)
```

**Local main sync is part of PR completion.** A merged PR isn't done at the GitHub side — the next session must start from the merged state, not a behind one. Both gate paths refresh local main as part of Step 4 cleanup: worktree paths run `git fetch origin main && git checkout main && git merge --ff-only origin/main` in the main workspace after `git worktree remove`; micro-chore runs `git fetch origin main && git rebase origin/main` after deleting the temp branch. If `--ff-only` rejects (local main has commits ahead of origin), stop and surface the divergence — do not force the merge.

**The sync belongs to the main workspace, never to a worktree.** `git checkout main` from a linked worktree always fails — `fatal: 'main' is already used by worktree at <main-workspace>` — because the main checkout holds the branch. So every post-merge local step is worktree-aware: the direct-merge fallback withholds `gh pr merge --delete-branch` (see [Auto-merge fallback](#auto-merge-fallback)), and `noldor prep promote --ship` skips its own `checkout main` + `branch -D` + fast-forward leg outright, reporting `local main sync skipped — run from a linked worktree, sync from the main workspace. Local branch <branch> left in place there — remove it with: git branch -D <branch>` (the note names the leftover branch because the skip drops the `branch -D` too). Both use the same `isLinkedWorktree` probe, which warns to stderr and falls back to main-checkout behaviour if `git rev-parse --path-format=absolute` is unavailable (git < 2.31).

## Where the title and Summary come from

`composeTitle` and the Summary section of `composeBody` both read `PrFlowInput.summaryCommit` — the **first commit ahead of the base that carries code**, resolved by `pickSummarySha` in [`src/core/pr-flow-cli.ts`](../../src/core/pr-flow-cli.ts).

That predicate exists because `/noldor-gate` retires an entry's roadmap block *before* implementing it (skill Step 2, "Roadmap-entry retirement"), so the oldest commit on a drained fast-track branch is bookkeeping. Sourcing the title from the first commit put `docs(roadmap): retire <slug> — shipped via fast-track (no FD)` on every drained PR and never named the change that shipped.

"Carries code" is the whole `isBookkeepingOnly` set, not just `docs/roadmap.md` — since Q-0107 `remove-block` co-stages `.noldor/retired-entry-ids.json`, and a `full-*` branch leads with its spec and plan commits, so a roadmap-only test lands on those instead. A commit whose file list is **empty** is skipped too: `git log --name-only` prints no paths for a merge, so without that guard a branch an operator merged `main` into would be titled `Merge branch 'main'`.

Summary by branch shape:

| Shape | Summary |
| --- | --- |
| Retirement-only (roadmap + retired-ID map, nothing else) | Deterministic template naming the slug, with the reason **quoted** from the retirement subject's em-dash clause (`— shipped via fast-track (no FD)`), degrading to "the entry is being taken off the queue" when there is none. Never a template-asserted cause: `remove-block` treats shipped, superseded, abandoned and duplicate identically. |
| FD-carrying (`specs-only-*`, `full-*`) | The FD's `## Summary` prose, **followed by** the summary commit's body. The FD names the feature; the commit body explains this increment — without it an attach PR describes its parent feature and never mentions the enhancement that shipped. |
| No-FD (`fast-track`, `micro-chore`) | The summary commit's subject and body, with `Noldor-*` / `Co-authored-by` / `Signed-off-by` trailers stripped. |

The commit body is load-bearing in every row, because a subject line is what-only and `pr-summary-why-how-what` requires why and how too. `composeBody` composes deterministically and cannot author prose, so it surfaces what the commit already says. That body is not a matter of hope: `validatePrSummary` runs at the top of `openAndAutoMerge` and refuses to deliver a code-carrying PR whose Summary lacks `Why —` / `How —` / `What —` sections of at least 24 characters each — see [git-and-commits.md](git-and-commits.md) § PR summary contract. Commit bodies themselves are free-form; the contract binds once, at the PR seam.

The **Test Plan** section is chosen the same way — from the branch's own diff (`touchesCode`), not from FD presence. A no-FD fast-track that rewrites `src/**` gets the code checklist; only a genuinely doc-class diff renders `Doc-only change`.

Practical consequence: **on a fast-track branch, the implementation commit's message is the PR summary.** Write it accordingly.

## One-time operator setup

1. **Install `gh`.** macOS: `brew install gh`. Other platforms: see [cli.github.com](https://cli.github.com/).
2. **Authenticate.** `gh auth login`. Choose `GitHub.com`, HTTPS, login via web browser. Scopes needed: `repo`, `read:org`.
3. **Verify.** `gh auth status` should show `Logged in to github.com as <user>`.
4. **GitHub branch protection (after the local hook lands and 1 week of dogfooding).** Repo settings → Branches → Add rule for `main`:
   - ☑ Require a pull request before merging
   - ☐ Require approvals (solo dev — off)
   - ☐ Require status checks (off initially; flip on when `pnpm verify` lands as a GH Action)
   - ☑ Restrict who can push to matching branches: empty
   - ☑ Do not allow bypassing the above settings (admin included)
5. **Confirm via /noldor-garden.** `pnpm noldor garden detect` runs the `branch-protection.ts` detector and surfaces drift as a WARN finding.

## Override semantics

The only allowed bypass of the local pre-push hook is `NOLDOR_RELEASE_PUSH=1`. `pnpm release` sets this env var immediately before `git push origin main`. Every release push appends a receipt line to `.noldor/release-pushes.log` (`<iso> <sha> <pkg-version>`) — audited by `pnpm noldor garden detect` via `auditReleasePushes` in `override-audit.ts`.

Any other bypass attempt (e.g., `--no-verify`) leaves no receipt and surfaces in `/noldor-garden` review.

**Note:** `.noldor/release-pushes.log` is machine-local (gitignored). `pnpm noldor garden detect` surfaces audit data only when run on the same machine as `pnpm release`. The log is volatile state, similar to `.noldor/session.json`.

## Push runbook — fast-fail diagnosis

If `git push` does **not** emit `Counting objects` or `To https://…` within ~20 seconds, do NOT retry. Kill the process and diagnose:

1. **Check the pre-push hook script.** Look for `await readStdin()`, `await process.stdin`, or any network call. These patterns can hang under lefthook orchestration.
2. **Check `lefthook.yml`.** If `pre-push:` has any job that reads stdin, it MUST have `use_stdin: true` (default is `false` — lefthook does not proxy git's stdin to child jobs by default). Confirmed via `node_modules/lefthook/schema.json` (job-level `use_stdin: boolean`).
3. **Bypass lefthook to confirm.** `LEFTHOOK=0 git push` — if push completes in <5 sec, the hang is in a hook (not network).
4. **Read the hook output.** If the `noldor-pre-push` hook exits with `stdin read timed out after 5s` (or `stdin emitted an error before end-of-input`), the seatbelt in [`src/hooks/noldor-pre-push.ts:readStdinWithTimeout`](../../src/hooks/noldor-pre-push.ts) fired. Re-confirm `use_stdin: true` on the offending job before pushing again.

The 20-second operator threshold (step 1) and the 5-second hook seatbelt are independent guards: the seatbelt forces a fast hook exit even when the operator is not paying attention; the 20s threshold catches network-level hangs that the seatbelt cannot see (it only protects against stdin-coupled hangs). If you observe a 5-15 second hang followed by a hook timeout error, that's the seatbelt working as designed.

Each blind retry forks another zombie hook chain and amplifies wasted time. The 2026-05-16 retro recorded 8 attempts × ~2 min each = ~15 min wasted on what should have been a 30-sec push.

### `pnpm noldor pr-flow` recovery — when the CLI itself is broken

The `/noldor-gate` Step 4 path invokes `pnpm noldor pr-flow`. If the CLI exits non-zero for a reason unrelated to the pre-push hook (e.g. a regression in [`src/core/pr-flow-cli.ts`](../../src/core/pr-flow-cli.ts), an upstream `gh` change, a malformed FD that `loadFdSummary` can't parse), fall back to the manual three-step ship — the same one the framework used pre-CLI:

```bash
git push --force-with-lease --set-upstream origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --head "$(git rev-parse --abbrev-ref HEAD)" \
  --title "<summary commit subject — see Where the title and Summary come from>" \
  --body "<paste from prior gate flow or write inline>"
gh pr merge "$(gh pr view --json url --jq .url)" --auto --squash
```

You lose the composed PR body (CR result table, scope block, spec/plan links) but the merge mechanics are identical. File the CLI regression as a follow-up against `framework-pr-flow-agent-auto-merge`. Do NOT skip the gate's review steps in the fallback path — the code-stage CR + receipt amend still run before this point.

## Auto-merge fallback

`gh pr merge --auto` requires the repo to have auto-merge enabled (Settings → General → Pull Requests → "Allow auto-merge"). When it's disabled, the API returns `enablePullRequestAutoMerge` and the auto attempt exits non-zero. `openAndAutoMerge` handles this transparently:

1. Try `gh pr merge --auto --squash` first (the happy path when auto-merge is enabled + checks gate the merge).
2. On any non-zero exit, retry with `gh pr merge --squash` (synchronous — the merge happens immediately, no polling needed). `--delete-branch` rides along **only from the main checkout**: the flag makes gh check out the base branch locally before deleting the head branch, and from a linked worktree that checkout always fails with `fatal: 'main' is already used by worktree at <main-workspace>` — taking the remote-branch delete down with it. So pr-flow probes worktree context first (`git rev-parse --path-format=absolute --git-dir --git-common-dir`; the two paths differ only in a linked worktree) and, when inside one, withholds the flag and deletes the remote ref itself via `git push origin --delete <headRefName>` (best-effort — a failure only warns, since the repo's auto-delete-head-branches setting may have beaten it to it). The *local* branch stays for the gate's Step 4 cleanup, which runs `git worktree remove` + `git branch -D` + the `main` fast-forward from the main workspace, where checking out `main` is legal. From the main checkout the delete is gh's to do, so pr-flow verifies it afterwards — `git ls-remote --heads origin refs/heads/<headRefName>` — and warns `remote branch <b> still exists after gh pr merge --delete-branch` when the ref survives; a gh-side delete failure used to be silent on that leg. The probe is best-effort: it stays quiet when `ls-remote` itself fails rather than claiming a ref it could not see.
3. Verify the result via `gh pr view --json mergedAt,state,headRefName` rather than trusting the direct-merge exit code: gh can still emit a non-zero exit from a post-merge local step even though the merge succeeded server-side.
4. If `gh pr view` reports `state: MERGED`, return `mergedAt`. If still `OPEN`, throw with both exit codes for diagnostic context.

The fallback prints `pr-flow: gh pr merge --auto failed; falling back to direct squash-merge.` to stderr so the operator can tell which path ran. To make the auto path active, follow the "GitHub branch protection" step in [One-time operator setup](#one-time-operator-setup) above and enable auto-merge in repo settings.

## Failure runbook

| Symptom                                            | Diagnosis                                                                             | Fix                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Direct push to origin/main is blocked …`          | Pre-push hook rejected a non-release push.                                            | Ensure `/noldor-gate` end-of-flow is invoked; or set `NOLDOR_RELEASE_PUSH=1` if this IS a release push (`pnpm release` should set it automatically).               |
| `GhPreflightError: gh CLI not installed`           | `gh` binary missing from PATH.                                                        | `brew install gh` then `gh auth login`.                                                                                                                     |
| `GhPreflightError: gh CLI is unauthenticated`      | `gh auth status` returned non-zero.                                                   | `gh auth login`.                                                                                                                                            |
| `gh pr create failed: exit N`                      | Network, 403 (scope), or pre-receive hook rejection on origin.                        | `gh auth status` to check scopes; check origin's pre-receive logs in repo settings → Hooks.                                                                 |
| `direct merge fallback exit N; PR state is "OPEN"` | Both auto and direct merge failed — usually merge conflict or required-check failure. | Resolve via `gh pr view <pr-url>` — if `MERGEABLE: CONFLICTING`, rebase the worktree branch on `origin/main`; if checks are red, fix them and re-trigger.   |
| `MergeTimeoutError`                                | Auto-merge didn't complete within 10min (or 20min if `BEHIND`).                       | `gh pr view <pr-url>` to check state. If `BEHIND` and base is moving fast: wait + manual merge. If `BLOCKED`: required checks failing — fix and re-trigger. |
| `PrClosedWithoutMergeError`                        | Operator or external action closed the PR without merging.                            | Investigate via `gh pr view`. Re-open and re-invoke gate end-of-flow if appropriate.                                                                        |

## Changelog Integration

Each merged PR contributes:

- One `(#N)` bullet to the FD's `## Changelog` `#### PRs` sub-section in the next release cycle (per [versioning.md](versioning.md) step 3).
- The corresponding squash commit feeds `polishSummary` for the `#### Summary` prose (newest-cycle's PRs only, per the `prevTag..HEAD` range).

Attach-session PRs additionally carry a phase-revert commit (`phase: done → in-progress` on the parent FD). Look for the commit subject pattern:

```
docs(features:<parent-slug>): revert phase done → in-progress for attach session
```

These commits are written by `/noldor-gate` Step 2 scaffolding (see [`.claude/skills/noldor-gate/SKILL.md`](../../.claude/skills/noldor-gate/SKILL.md) "Phase-revert lifecycle (attach paths)").

The reverse (`phase: in-progress → done`) is written by `/noldor-gate` Step 4 end-of-flow (`pnpm noldor features phase-flip-done`) so it lands on `main` inside the feature PR; `release-markers.ts:fillMarkers` remains the release-time safety net for FDs that missed the flip — see [versioning.md](versioning.md) step 4 and the changelog-pr-flow-integration spec §3 for the original (now superseded) asymmetric model.

## Open-only mode (parallel drain)

Under parallel drain (`pnpm noldor autonomous queue-drain --concurrency N`, N > 1) the supervisor sets `NOLDOR_DRAIN_OPEN_ONLY=1` in each child's environment. `openAndAutoMerge` then pushes the branch and opens the PR but **returns at PR-open without merging or polling** — `PrFlowResult.mergedAt` is `null`. The supervisor's serialized merge coordinator (`src/autonomous/drain-loop.ts`) then merges the open PRs one at a time — `gh pr merge --auto --squash` + poll `mergeStateStatus`, advancing local `main` between merges — so two concurrent children never race a `main` update. At `--concurrency 1` (default) the flag is unset and the child merges inline exactly as documented above.

## See also

- [`docs/noldor/cr-pipeline.md`](cr-pipeline.md) — Claude + codex review semantics.
- [`docs/noldor/git-and-commits.md`](git-and-commits.md) — Conventional Commits, trailers, scope rules.
- Spec: `docs/design/specs/archive/2026-05-15-framework-pr-flow-agent-auto-merge-design.md`.
- Spec: `docs/design/specs/2026-05-15-framework-pr-flow-agent-auto-merge-changelog-pr-flow-integration-design.md` — Changelog integration + phase-revert details.
