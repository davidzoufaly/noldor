---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/release/release-state.ts
    - src/release/index.ts
    - src/cli/manifest.ts
  docs: []
  tests:
    - src/release/__tests__/release-resume.test.ts
    - src/release/__tests__/release-state.test.ts
  spec: docs/superpowers/specs/2026-07-02-pnpm-release-resume-design.md
name: '`pnpm release --resume`'
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.5.0
---
## Summary

`pnpm release` is not idempotent when the final `git commit` step fails. v0.4.0 release hit this when the release commit's pre-commit hook rejected the diff (micro-chore session active): all package.json bumps, CHANGELOG entry, release-notes entry, FD `introduced:` markers were already written + staged, but the commit failed. Re-running the script would derive a new (wrong) version. Manual recovery required (`git reset`, fix root cause, re-run). Fix: either (a) `pnpm release --resume` flag that skips precondition + version-derive and goes straight to commit-tag-push when staged files match the in-progress release shape, or (b) wrap the file-mutation phase in a temp staging area committed atomically only after precondition success — so a failed commit leaves an empty tree.

- triage 2026-05-11: relocated from `### UI Bugs & Polish` — misfiled at intake, semantically framework-scope.

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

## PRs

<!-- @prs-since-last-release: pnpm-release-resume -->

## Changelog

### Initial Release (v0.5.0)

#### Summary

Release-state persistence added so interrupted releases can resume (#132).

#### PRs

- #132: add release-state persistence for interrupted releases ([link](https://github.com/davidzoufaly/noldor/pull/132))

