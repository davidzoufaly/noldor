---
area: tooling
category: Tooling
deps: []
entry-id: Q-0124
links:
  code: []
  tests:
    - src/core/__tests__/summary-body-rollout.test.ts
    - src/core/__tests__/validate-summary-body.test.ts
    - src/hooks/__tests__/validate-pushed-summaries.test.ts
name: PR Summary Body Enforcement
packages:
  - package.json
phase: in-progress
noldor-tier: specs-only
---
## Summary

Makes "a PR explains itself" a mechanically enforced property rather than a hope. A `commit-msg` gate rejects any commit carrying code whose body lacks a `Why —`, `How —` and `What —` section, and `pr-flow` composes the PR Summary and Test Plan from the branch's own diff — so a retirement-only branch gets deterministic prose instead of a bookkeeping subject, an attach PR describes its own enhancement rather than its parent feature, and a code change never again claims "Doc-only change".

## User Story

As an agent shipping a change through the gate, I want the commit-msg hook to reject a code commit whose body does not state why, how and what, so that every PR Noldor opens explains itself — and I find out at commit time, when the fix is a three-line amend, instead of after implementation and code review have already run.

## Usage

**Writing a commit**

1. Write the body of any code-carrying commit with three sections, each on its own line:

   ```
   Why — the problem or motivation, plainly, then the technical detail.
   How — the mechanism, and where it hooks in.
   What — the concrete outcome: files, commands, behaviour.
   ```

2. Use an em dash, never a colon — `Why:` at the start of a body's last paragraph is a valid git trailer and `git interpret-trailers` absorbs it. The validator rejects the colon form and says so.
3. Each section needs at least 24 characters of content. Order of presence is checked, not sequence.

**Exempt — commit freely with no body**

- Bookkeeping-only diffs (roadmap, backlog, FDs, design artifacts, milestones, `ideas.md`, the retired-ID map, the id counter).
- `release-automation` / `release-sweep` commits, and `fixup!` / `squash!` / `Revert "` subjects.
- A real merge, keyed on `MERGE_HEAD` — `git merge --no-ff` commits; a forged `Merge branch 'x'` subject with code staged does not.
- Any tree that has not armed `.noldor/rollout-marker`.

**Agent/Programmatic API**

- `pnpm noldor validate summary-body <commit-msg-file>` — check a message without committing (exit 1 with the missing sections named, plus the template). Runs automatically as the `summary-body` job in `commit-msg`.
- `isBookkeepingOnly(paths)`, `isRetirementOnly(paths)`, `touchesCode(paths)` in [`src/core/allowlist.ts`](../../src/core/allowlist.ts) — the three predicates that decide exemption, the retirement Summary template, and the Test Plan shape.

## PRs

<!-- @prs-since-last-release: pr-summary-body-enforcement -->

## Changelog
