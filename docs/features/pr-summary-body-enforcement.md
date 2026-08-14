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
phase: done
noldor-tier: specs-only
---
## Summary

Makes "a PR explains itself" a mechanically enforced property rather than a hope. A `pre-push` gate reads the commit **objects** about to cross the repository boundary and rejects any that carries code without a `Why —`, `How —` and `What —` section — every commit newly reachable through a pushed ref, so a valid tip cannot hide an invalid one beneath it. Because it judges what git stored rather than what an author was typing, merge identity comes from parent count and paths from `diff-tree -z`, closing the forged-subject and empty-amend-index holes that a `commit-msg` check structurally cannot. `commit-msg` keeps a demoted advisory that always exits 0, and `pr-flow` composes the PR Summary and Test Plan from the branch's own diff — so a retirement-only branch gets deterministic prose instead of a bookkeeping subject, an attach PR describes its own enhancement rather than its parent feature, and a code change never again claims "Doc-only change".

## User Story

As an agent pushing a reviewed branch, I want Noldor to validate the stored message, files and parent structure of every outgoing commit, so that a PR cannot ship an unexplained code change because a commit-msg hook misread provisional git state.

## Usage

**Writing a commit**

1. Write the body of any code-carrying commit with three sections, each on its own line:

   ```
   Why — the problem or motivation, plainly, then the technical detail.
   How — the mechanism, and where it hooks in.
   What — the concrete outcome: files, commands, behaviour.
   ```

2. Use an em dash, never a colon — `Why:` at the start of a body's last paragraph is a valid git trailer and `git interpret-trailers` absorbs it. The check rejects the colon form and says so.
3. Each section needs at least 24 characters of content. Order of presence is checked, not sequence.

**Where it is enforced**

- At `pre-push`, over the commit objects git has already stored — every commit newly reachable through a pushed ref, so a valid tip cannot hide an invalid one beneath it. A rejection names every offending SHA in one run; because the remote has not moved, reword or rebase the unpublished commits and push again rather than reaching for `--no-verify`.
- At `commit-msg` the `summary-body-advisory` job reports the same finding early and **always exits 0**. It reads a provisional message file and the current index, neither of which is what git will store, so it advises and never certifies.

**Exempt — commit freely with no body**

- Any diff that carries no code: bookkeeping (roadmap, backlog, FDs, design artifacts, milestones, `ideas.md`, the retired-ID map, the id counter) and ordinary prose alike. One code path among the prose is enough to require a body.
- `release-automation` / `release-sweep` commits — recognised only through exactly one such value in git's own final trailer block, and only when the object corroborates it: `release-automation` needs the `chore(release): vX.Y.Z` subject, `release-sweep` must touch sweep outputs only. A `Noldor-Path:` line in body prose buys nothing, and neither does a bare trailer added under `--no-verify`.
- `fixup!` / `squash!` / `amend!` subjects — **at `commit-msg` only**. At `pre-push` the object is crossing unsquashed, so exempting it there would make one token a bypass of the whole gate; rebase first, or `--no-verify` a deliberate work-in-progress push.
- A real merge, keyed on the object's **parent count**. A single-parent commit wearing a forged `Merge branch 'x'` subject is not exempt, and neither are cherry-picks or reverts that survive into pushed history.
- Any clone that has not committed `.noldor/summary-body-rollout.json` — though both hooks say so rather than going quiet.

**Activating it**

- `pnpm noldor init --update` (or `pnpm noldor upgrade`) writes `.noldor/summary-body-rollout.json`, recording every commit-ref tip present at that moment. Exactly the history reachable from those tips is grandfathered, on every branch; the next commit on any of them enforces. Commit the file — a clone without it stays advisory-only, and it is never rewritten once created.

**Agent/Programmatic API**

- `pnpm noldor hooks pre-push <remote>` — the blocking check, fed git's ref updates on stdin. Exit 1 lists every commit needing rewording; exit 2 signals malformed ref input or a corrupt activation snapshot.
- `pnpm noldor validate summary-body <commit-msg-file>` — the advisory check. Always exit 0.
- `validateSummaryCommit(input)` in [`src/core/validate-summary-body.ts`](../../src/core/validate-summary-body.ts) — the pure policy over one stored object (`sha`, `message`, `files`, `parentCount`, `noldorPath`).
- `isBookkeepingOnly(paths)`, `isRetirementOnly(paths)`, `touchesCode(paths)` in [`src/core/allowlist.ts`](../../src/core/allowlist.ts) — the predicates that decide exemption, the retirement Summary template, and the Test Plan shape.

## PRs

<!-- @prs-since-last-release: pr-summary-body-enforcement -->

## Changelog
