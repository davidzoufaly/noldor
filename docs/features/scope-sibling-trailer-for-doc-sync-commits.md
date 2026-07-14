---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/core/validate-noldor-scope.ts
    - src/core/changelog.ts
  docs:
    - docs/noldor/git-and-commits.md
    - docs/noldor/script-catalog.md
  tests:
    - src/core/__tests__/changelog.test.ts
    - src/core/__tests__/validate-noldor-scope.test.ts
    - src/hooks/__tests__/noldor-validate-trailer.test.ts
  spec: >-
    docs/design/specs/archive/2026-07-03-scope-sibling-trailer-for-doc-sync-commits-design.md
name: Scope Sibling Trailer for Doc-Sync Commits
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.5.0
---

## Summary

The noldor-scope validator (`src/core/validate-noldor-scope.ts`) can force one logically-coherent change (feat in code, tests, sibling doc syncs in `docs/noldor/<page>.md` and `docs/features/<slug>.md`) to split into separate commits per scope. Mechanically correct, but the same logical change becomes 3 entries in `git log` and 3× the gate dance (session, hook, trailer). 2026-05-12 roadmap-priority follow-up hit this. Proposal: introduce a `Noldor-Sibling-Scope: <scope-list>` trailer that lets the validator accept files mapping to listed sibling scopes, keeping the work as one atomic commit. Alternative: validator auto-detects "doc-sync-for-this-feat" patterns and waives the split heuristically. **Re-verify pain before spec'ing** (2026-07-02 note): the validator moved to `src/core/` and appears laxer than this entry claims — multi-page edits pass under a plain `noldor` scope; confirm the forced-split still bites on current code before spending an M on it.

## User Story

As an agent shipping a feature that also syncs its `docs/noldor/` page, I want to declare the doc pages as sibling scopes via a `Noldor-Sibling-Scope` trailer, so that one logical change lands as one atomic commit with its real code scope instead of splitting into a doc commit and a code commit.

## Usage

```bash
# Mixed commit: code + its doc-sync page, one commit, real scope kept
git add src/prep/dispatch.ts docs/noldor/workflow.md
git commit -m "feat(prep): add dispatch runner" \
  -m "Noldor-Sibling-Scope: noldor:workflow" \
  -m "Noldor-Path: fast-track"

# Multiple sibling pages
git commit -m "feat(core): rework session markers" \
  -m "Noldor-Sibling-Scope: noldor:workflow, noldor:script-catalog" ...

# Validation is the existing commit-msg job — no new CLI surface
pnpm noldor validate noldor-scope .git/COMMIT_EDITMSG
```

On failure, the validator error itself prints the exact trailer line to add.

## PRs

<!-- @prs-since-last-release: scope-sibling-trailer-for-doc-sync-commits -->

## Changelog

### Initial Release (v0.5.0)

#### Summary

`noldor-scope` validation now accepts the `Noldor-Sibling-Scope` trailer (#158).

#### PRs

- #158: accept Noldor-Sibling-Scope trailer in noldor-scope validation ([link](https://github.com/davidzoufaly/noldor/pull/158))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-07-03-scope-sibling-trailer-for-doc-sync-commits-design.md`](../../docs/design/specs/archive/2026-07-03-scope-sibling-trailer-for-doc-sync-commits-design.md)
- **Code:**
  - [`src/core/validate-noldor-scope.ts`](../../src/core/validate-noldor-scope.ts)
  - [`src/core/changelog.ts`](../../src/core/changelog.ts)
- **Tests:**
  - [`src/core/__tests__/changelog.test.ts`](../../src/core/__tests__/changelog.test.ts)
  - [`src/core/__tests__/validate-noldor-scope.test.ts`](../../src/core/__tests__/validate-noldor-scope.test.ts)
  - [`src/hooks/__tests__/noldor-validate-trailer.test.ts`](../../src/hooks/__tests__/noldor-validate-trailer.test.ts)
- **Docs:**
  - [`docs/noldor/git-and-commits.md`](../../docs/noldor/git-and-commits.md)
  - [`docs/noldor/script-catalog.md`](../../docs/noldor/script-catalog.md)

<!-- /generated: resources -->
