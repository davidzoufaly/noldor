# `pnpm release --resume` — Design

**Slug:** pnpm-release-resume
**FD:** docs/features/pnpm-release-resume.md
**Date:** 2026-07-02
**Tier:** specs-only

## Problem

`pnpm release` (→ `node bin/noldor.mjs release run` → `src/release/index.ts`) is not idempotent when any step after the file-mutation phase fails. The v0.4.0 release hit this: all mutations were already written and staged — CHANGELOG entry (`prependToChangelog`, `src/release/index.ts:268`), release-notes entry (`prependToReleaseNotes`, `:278`), FD `introduced:` markers (`fillAllMarkers` / `fillAllNoldorMarkers`, `:244`/`:247`), package.json bumps (`bumpAllPackages`, `:255`) — but the `git commit` at `src/release/index.ts:296` was rejected by the pre-commit hook (a stale micro-chore session marker made `src/hooks/noldor-pre-commit.ts:79` enforce the micro-chore allowlist against the release diff).

After that failure the operator is stuck three ways:

1. **Re-run fails immediately** — `ensureCleanTreeOnMain()` (`src/release/index.ts:42`) rejects the dirty tree.
2. **Re-run after a manual commit derives the wrong version** — `readCommitsSince(previousTag)` + `deriveBumpLevel` (`:207`/`:214`) would now include the release commit itself and bump again.
3. **Manual `git commit` retry also fails** — `withReleaseSession` (`src/release/release-session.ts:20`) clears the `release-automation` session marker in its `finally`, so the retry commit runs into the post-rollout hard-wall session requirement in `noldor-pre-commit.ts` (rollout marker is LIVE: every commit needs a session).

Recovery today is manual: `git reset`, fix the root cause, re-run the entire pipeline including all checks.

## Goals

- `pnpm release --resume` finishes an in-progress release from wherever it died: commit → tag → push → GitHub Release, skipping preconditions, checks, and version derivation.
- The resumed run uses the **same version** the original run derived — never re-derives.
- Resume re-enters `withReleaseSession`, so the pre-commit hook sees a fresh `release-automation` marker (fixes stuck-state 3).
- A plain `pnpm release` run that finds an in-progress release aborts with an actionable hint instead of failing on the dirty tree with a generic message (fixes stuck-states 1 and 2).
- Resume is safe to re-run itself (idempotent ladder — each step checks whether it already happened).

## Non-goals

- Option (b) from the roadmap entry — wrapping the file-mutation phase in a temp staging area committed atomically. Rejected: it would touch every writer (`release-changelog.ts`, `release-notes.ts`, `release-markers.ts`, `release-packages.ts`) and still can't make `git commit` + `git tag` + `git push` + `gh release create` atomic as a group. The state-file + resume ladder covers the same failure and the post-commit failures too.
- Fixing the *root cause* of the v0.4.0 failure (stale micro-chore marker interplay) — that's session-staleness territory, partially addressed by PR #125's TTL refresh.
- Resuming a release that died *before* the mutation phase (during checks). Nothing was written; plain re-run is already correct there.
- Rollback tooling (`release --abort`). The error message documents the manual `git reset --hard` recipe instead.

## Design

### Unit 1 — release state file (`src/release/release-state.ts`, new)

Small module mirroring the shape of `src/core/session.ts` persistence:

- `writeReleaseState(cwd, state)` — writes `.noldor/release-state.json` with `{ version, previousTag, date, startedAt }`.
- `readReleaseState(cwd)` — parsed + zod-validated, `null` if absent.
- `clearReleaseState(cwd)` — unlink, tolerate absence.

`main()` in `src/release/index.ts` calls `writeReleaseState` right after the dry-run early-return point (`:230`) — i.e. the moment the run commits to mutating files — and `clearReleaseState` after the `gh release create` succeeds (`:318`). A run that dies anywhere in between leaves the state file behind as the resume token. Add `.noldor/release-state.json` to `.gitignore` (next to line 15's `.noldor/session.json`).

### Unit 2 — flag plumbing

`pnpm release --resume` → package.json script `"release": "node bin/noldor.mjs release run"` (package.json:39) with pnpm pass-through → `src/cli/index.ts:80` dispatches `rest = ['--resume']` into `process.argv` of `src/release/index.ts`. `main()` reads `const resume = process.argv.slice(2).includes('--resume')`. No manifest change needed beyond the `desc` string in `src/cli/manifest.ts:204` mentioning the flag.

### Unit 3 — in-progress guard on the normal path

Inside `withReleaseSession`, before `ensureCleanTreeOnMain()` (`src/release/index.ts:128`): if `readReleaseState()` returns non-null and `--resume` was not passed, throw:

> In-progress release v\<version\> detected (.noldor/release-state.json). Run `pnpm release --resume` to finish it, or discard with `git reset --hard && rm .noldor/release-state.json`.

This converts today's misleading "Working tree is not clean" into the correct instruction and blocks the wrong-version re-derive hazard.

### Unit 4 — resume ladder (`resumeRelease()` in `src/release/index.ts`)

Runs inside `withReleaseSession` (fresh `release-automation` marker → pre-commit hook passes). Steps:

1. **Load + verify state.** `readReleaseState()`; absent → error ("nothing to resume"). Verify branch is `main` (reuse the branch check from `ensureCleanTreeOnMain`, but *skip* the clean-tree and origin-sync checks — the tree is intentionally dirty). Cross-check: root package.json `version` in the working tree equals `state.version` (guards a stale state file left over from an unrelated reset).
2. **Shape check.** `git status --porcelain` — every dirty path must fall inside the release surface: `CHANGELOG.md`, `docs/release-notes.md`, `docs/sdd-report.md`, `docs/features/`, `docs/noldor/`, plus `lockstepPackages` from `loadConsumerConfig()` (same list as the `git add` at `src/release/index.ts:287-295`). Unrelated dirty paths → abort with the discard recipe; never guess.
3. **Commit** — skip if `git log -1 --format=%s` is already `chore(release): v<version>`; else re-run the same `git add` list and `git commit -m 'chore(release): v<version>'`.
4. **Tag** — skip if `git rev-parse -q --verify refs/tags/v<version>` succeeds; else `git tag -a`.
5. **Push** — skip if `origin/main` already equals HEAD (same `rev-parse` pair as `ensureCleanTreeOnMain:52-54` after a fetch); else `git push --follow-tags origin main` with `NOLDOR_RELEASE_PUSH=1` (as `:300`).
6. **GitHub Release** — skip if `gh release view v<version>` succeeds; else reuse `extractLatestReleaseNotes()` (`:116`) + `gh release create` (`:308-317`).
7. `clearReleaseState()`.

Because every rung is check-then-act, `--resume` after a *resume* failure (e.g. network drop mid-push) just walks the ladder again.

### Unit 5 — tests (`src/release/__tests__/release-state.test.ts`, extend `release-session.test.ts` pattern)

Scratch-git-repo pattern already used by `release-cr-gate-e2e.test.ts`. Cover: state write/read/clear round-trip; normal-path guard throws when state file present; ladder skip logic per rung (commit exists → no double commit; tag exists → no re-tag); shape-check abort on unrelated dirty file; package.json/state version mismatch abort.

## Acceptance criteria

- `pnpm release` killed after mutations but before commit leaves `.noldor/release-state.json`; `pnpm release --resume` then produces exactly one `chore(release): v<version>` commit, one `v<version>` tag, a push, and a GitHub Release, then removes the state file.
- `pnpm release --resume` run twice in a row is a no-op the second time (every rung skips), exits 0.
- Plain `pnpm release` with a state file present exits non-zero with a message naming `--resume` and the discard recipe — it never re-derives a version.
- Resume aborts (non-zero, no commit) when: state file absent; dirty paths outside the release surface; working-tree package.json version ≠ state version; current branch ≠ main.
- Resume never re-runs `deriveBumpLevel`, `applyBump`, consumer checks, or `fillAllMarkers` — asserted by the ladder using only state-file values.
- Successful end-to-end release (no failure) leaves no state file behind.
- `.noldor/release-state.json` is gitignored; `noldor release run --help` still short-circuits via `src/cli/index.ts:75` before any release logic.

## Risks / trade-offs

- **Stale state file + diverged tree** — operator resets by hand, forgets the state file, later runs `pnpm release` and gets blocked. Mitigated: guard message includes the `rm` recipe; version cross-check (Unit 4 step 1) refuses to resume against a tree that no longer matches.
- **Resume trusts previously-passed checks** — typecheck/test/CR gate are not re-run on resume. Acceptable: the tree content is byte-identical to when they passed; anything new the operator changed trips the shape check.
- **Shape check is path-granular, not content-granular** — a manual edit *inside* `CHANGELOG.md` between failure and resume would be committed as-is. Accepted: those paths are release-owned mid-release, and content diffing would reimplement the generators.
- **Ladder races with a concurrent push to origin/main** — push rung would fail non-fast-forward; resume re-run after the operator reconciles. Same exposure as today's one-shot push.

## User Story

As a Noldor release operator, I want `pnpm release --resume` to finish an interrupted release from the exact step that failed, so that a rejected release commit costs one re-command instead of a manual `git reset` and a full pipeline re-run with a risk of deriving the wrong version.

## Usage

```bash
pnpm release                 # dies at commit/tag/push/gh-release step
# fix root cause (e.g. rm stale .noldor/session.json)
pnpm release --resume        # skips checks + version derive, walks commit→tag→push→release ladder

# discard an in-progress release instead:
git reset --hard && rm .noldor/release-state.json
```

`pnpm release` with a leftover in-progress state aborts and prints exactly these two options.

## Open questions (resolved)

1. *Detect the in-progress release by inferring from staged-file shape (roadmap option a, literal reading) or from an explicit state file?* -> **State file** (`.noldor/release-state.json`). (D1) Shape inference can't recover the derived version reliably (package.json is the only carrier and could be mid-edit); a state file written at the mutation boundary is deterministic and doubles as the guard token for the normal path.
2. *Should `--resume` cover failures after the commit (tag / push / gh release), not just the commit step named in the entry?* -> **Yes — full check-then-act ladder.** (D2) The rungs are four cheap idempotence checks; stopping at commit would leave the identical "half-done release, manual recovery" hole one step later.
3. *Should plain `pnpm release` auto-resume when it finds a state file instead of aborting?* -> **Abort with hint, require explicit `--resume`.** (D3) Auto-resume would silently commit whatever the tree holds; the failure that stranded the release usually needs an operator fix first, so keep the human in the loop with a one-line cost.
4. *Re-run any checks on resume (e.g. `noldor validate features`)?* -> **No — straight to commit-tag-push per the entry body.** (D4) Tree bytes are unchanged since the checks passed; the shape check plus version cross-check catch external tampering, and re-running the full gate would reintroduce the very non-idempotence being fixed (e.g. sdd-report regen dirtying the tree again).
