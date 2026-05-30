---
noldor-page: pr-flow
introduced: 0.5.0
---

# PR Flow + Agent Auto-Merge

Every gate path lands `main` only via a GitHub PR opened by the controlling agent. The CR pipeline (Claude review + `pnpm noldor cr codex`) runs locally as a pre-merge gate; once green, the agent sets `gh pr merge --auto --squash` and polls until merged.

## Top-level flow

```
gate end-of-flow (any path)
  ├─ Claude review (superpowers:requesting-code-review) — address inline, no retry cap
  ├─ codex CR retry loop (scripts/noldor/cr-retry.ts) — up to 3 retries
  ├─ pnpm noldor pr-flow → openAndAutoMerge (scripts/noldor/pr-flow-cli.ts → pr-flow.ts):
  │    1. preflight: gh --version + gh auth status
  │    2. git push --force-with-lease --set-upstream origin <branch>
  │    3. gh pr create --base main --head <branch> --title <…> --body <…>
  │    4. gh pr merge <pr> --auto --squash
  │       └─ on failure (e.g. repo doesn't have auto-merge enabled): retry `gh pr merge --squash --delete-branch` synchronously, verify via `gh pr view --json mergedAt,state`
  │    5. poll gh pr view --json mergedAt,state until merged (10min timeout; 20min if BEHIND) — skipped on the fallback path because the synchronous merge has already completed
  ├─ explicit cleanup: ExitWorktree (worktree paths) OR delete temp branch (micro-chore)
  ├─ sync local main to origin/main (git fetch + ff-only merge / rebase) — PR is not "finished" until local main matches origin
  └─ Step 5 next-priority handoff (always-clear)
```

**Local main sync is part of PR completion.** A merged PR isn't done at the GitHub side — the next session must start from the merged state, not a behind one. Both gate paths refresh local main as part of Step 4 cleanup: worktree paths run `git fetch origin main && git checkout main && git merge --ff-only origin/main` in the main workspace after `ExitWorktree`; micro-chore runs `git fetch origin main && git rebase origin/main` after deleting the temp branch. If `--ff-only` rejects (local main has commits ahead of origin), stop and surface the divergence — do not force the merge.

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
5. **Confirm via /garden.** `pnpm noldor garden detect` runs the `branch-protection.ts` detector and surfaces drift as a WARN finding.

## Override semantics

The only allowed bypass of the local pre-push hook is `NOLDOR_RELEASE_PUSH=1`. `pnpm release` sets this env var immediately before `git push origin main`. Every release push appends a receipt line to `.noldor/release-pushes.log` (`<iso> <sha> <pkg-version>`) — audited by `pnpm noldor garden detect` via `auditReleasePushes` in `override-audit.ts`.

Any other bypass attempt (e.g., `--no-verify`) leaves no receipt and surfaces in `/garden` review.

**Note:** `.noldor/release-pushes.log` is machine-local (gitignored). `pnpm noldor garden detect` surfaces audit data only when run on the same machine as `pnpm release`. The log is volatile state, similar to `.noldor/session.json`.

## Push runbook — fast-fail diagnosis

If `git push` does **not** emit `Counting objects` or `To https://…` within ~20 seconds, do NOT retry. Kill the process and diagnose:

1. **Check the pre-push hook script.** Look for `await readStdin()`, `await process.stdin`, or any network call. These patterns can hang under lefthook orchestration.
2. **Check `lefthook.yml`.** If `pre-push:` has any job that reads stdin, it MUST have `use_stdin: true` (default is `false` — lefthook does not proxy git's stdin to child jobs by default). Confirmed via `node_modules/lefthook/schema.json` (job-level `use_stdin: boolean`).
3. **Bypass lefthook to confirm.** `LEFTHOOK=0 git push` — if push completes in <5 sec, the hang is in a hook (not network).
4. **Read the hook output.** If the `noldor-pre-push` hook exits with `stdin read timed out after 5s` (or `stdin emitted an error before end-of-input`), the seatbelt in [`scripts/hooks/noldor-pre-push.ts:readStdinWithTimeout`](../../scripts/hooks/noldor-pre-push.ts) fired. Re-confirm `use_stdin: true` on the offending job before pushing again.

The 20-second operator threshold (step 1) and the 5-second hook seatbelt are independent guards: the seatbelt forces a fast hook exit even when the operator is not paying attention; the 20s threshold catches network-level hangs that the seatbelt cannot see (it only protects against stdin-coupled hangs). If you observe a 5-15 second hang followed by a hook timeout error, that's the seatbelt working as designed.

Each blind retry forks another zombie hook chain and amplifies wasted time. The 2026-05-16 retro recorded 8 attempts × ~2 min each = ~15 min wasted on what should have been a 30-sec push.

### `pnpm noldor pr-flow` recovery — when the CLI itself is broken

The `/gate` Step 4 path invokes `pnpm noldor pr-flow`. If the CLI exits non-zero for a reason unrelated to the pre-push hook (e.g. a regression in [`scripts/noldor/pr-flow-cli.ts`](../../scripts/noldor/pr-flow-cli.ts), an upstream `gh` change, a malformed FD that `loadFdSummary` can't parse), fall back to the manual three-step ship — the same one the framework used pre-CLI:

```bash
git push --force-with-lease --set-upstream origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --head "$(git rev-parse --abbrev-ref HEAD)" \
  --title "<first commit subject>" \
  --body "<paste from prior gate flow or write inline>"
gh pr merge "$(gh pr view --json url --jq .url)" --auto --squash
```

You lose the composed PR body (CR result table, scope block, spec/plan links) but the merge mechanics are identical. File the CLI regression as a follow-up against `framework-pr-flow-agent-auto-merge`. Do NOT skip the gate's review steps in the fallback path — the CR receipt + codex retry loop still run before this point.

## Auto-merge fallback

`gh pr merge --auto` requires the repo to have auto-merge enabled (Settings → General → Pull Requests → "Allow auto-merge"). When it's disabled, the API returns `enablePullRequestAutoMerge` and the auto attempt exits non-zero. `openAndAutoMerge` handles this transparently:

1. Try `gh pr merge --auto --squash` first (the happy path when auto-merge is enabled + checks gate the merge).
2. On any non-zero exit, retry with `gh pr merge --squash --delete-branch` (synchronous — the merge happens immediately, no polling needed).
3. Verify the result via `gh pr view --json mergedAt,state` rather than trusting the direct-merge exit code: when invoked from inside a worktree, gh can emit a non-zero exit on the post-merge local-checkout step (`'main' is already used by another worktree`) even though the merge succeeded server-side.
4. If `gh pr view` reports `state: MERGED`, return `mergedAt`. If still `OPEN`, throw with both exit codes for diagnostic context.

The fallback prints `pr-flow: gh pr merge --auto failed; falling back to direct squash-merge.` to stderr so the operator can tell which path ran. To make the auto path active, follow the "GitHub branch protection" step in [One-time operator setup](#one-time-operator-setup) above and enable auto-merge in repo settings.

## Failure runbook

| Symptom                                            | Diagnosis                                                                             | Fix                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Direct push to origin/main is blocked …`          | Pre-push hook rejected a non-release push.                                            | Ensure `/gate` end-of-flow is invoked; or set `NOLDOR_RELEASE_PUSH=1` if this IS a release push (`pnpm release` should set it automatically).               |
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

These commits are written by `/gate` Step 2 scaffolding (see [`.claude/skills/gate/SKILL.md`](../../.claude/skills/gate/SKILL.md) "Phase-revert lifecycle (attach paths)").

The reverse (`phase: in-progress → done`) is auto-restored by `release-markers.ts:fillMarkers` at the next `pnpm release` — see [versioning.md](versioning.md) step 4 and the [changelog-pr-flow-integration spec](../superpowers/specs/2026-05-15-framework-pr-flow-agent-auto-merge-changelog-pr-flow-integration-design.md) §3 for the asymmetric model.

## See also

- [`docs/noldor/cr-pipeline.md`](cr-pipeline.md) — Claude + codex review semantics.
- [`docs/noldor/git-and-commits.md`](git-and-commits.md) — Conventional Commits, trailers, scope rules.
- Spec: [`docs/superpowers/specs/archive/2026-05-15-framework-pr-flow-agent-auto-merge-design.md`](../superpowers/specs/archive/2026-05-15-framework-pr-flow-agent-auto-merge-design.md).
- Spec: [`docs/superpowers/specs/2026-05-15-framework-pr-flow-agent-auto-merge-changelog-pr-flow-integration-design.md`](../superpowers/specs/2026-05-15-framework-pr-flow-agent-auto-merge-changelog-pr-flow-integration-design.md) — Changelog integration + phase-revert details.
