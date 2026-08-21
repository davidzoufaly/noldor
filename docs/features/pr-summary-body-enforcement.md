---
area: tooling
category: Tooling
deps: []
entry-id: Q-0124
links:
  code: []
  tests:
    - src/core/__tests__/pr-flow.test.ts
    - src/prep/__tests__/formats.test.ts
name: PR Summary Body Enforcement
packages:
  - package.json
phase: done
noldor-tier: specs-only
introduced: 1.3.0
---

## Summary

Makes "a PR explains itself" a mechanically enforced property rather than a hope — once per delivery, at the PR seam. `validatePrSummary` runs at the top of `openAndAutoMerge` (before anything is pushed) and refuses to deliver a code-carrying PR whose composed Summary lacks a `Why —`, `How —` and `What —` section of at least 24 characters each. Commit bodies are free-form: the per-commit `pre-push` scan, the `commit-msg` advisory and the activation-snapshot machinery are retired. `pr-flow` still composes the PR Summary and Test Plan from the branch's own diff — so a retirement-only branch gets deterministic prose instead of a bookkeeping subject, an attach PR describes its own enhancement rather than its parent feature, and a code change never claims "Doc-only change".

## User Story

As an agent delivering a reviewed branch, I want Noldor to validate the PR body it is about to open, so that a PR cannot ship an unexplained code change — while individual commits stay free-form.

## Usage

**Writing the summary**

1. Write the body of the branch's **first substantive commit** (the one `pickSummarySha` selects — it becomes the PR Summary) with three sections, each on its own line:

   ```
   Why — the problem or motivation, plainly, then the technical detail.
   How — the mechanism, and where it hooks in.
   What — the concrete outcome: files, commands, behaviour.
   ```

2. Use an em dash, never a colon — `Why:` at the start of a body's last paragraph is a valid git trailer and `git interpret-trailers` absorbs it. The gate's diagnostic names the colon form when it sees one.
3. Each section needs at least 24 characters of content. Order of presence is checked, not sequence.
4. Every other commit body is free-form.

**Where it is enforced**

- At PR-open: `validatePrSummary` runs at the top of `openAndAutoMerge`, before the push, and throws `PrSummaryError` with the diagnostic plus the summary commit's subject. Nothing has left the machine when it rejects — amend the summary commit's body and re-run `pnpm noldor pr-flow`.

**Exempt — deliver freely without the sections**

- A branch that carries no code: bookkeeping (roadmap, backlog, FDs, design artifacts, milestones, `ideas.md`, the retired-ID map, the id counter) and ordinary prose alike. One code path on the branch is enough to require the sections.
- `release-sweep` sessions — the sweep PR body is a deterministic automation template.
- Retirement-only branches — `composeBody` renders their Why/How/What from a deterministic template.

**Agent/Programmatic API**

- `validatePrSummary(input)` in [`src/core/pr-flow.ts`](../../src/core/pr-flow.ts) — the pure gate over a `PrFlowInput`; `openAndAutoMerge` throws `PrSummaryError` on a rejection.
- `measureSections(body)`, `summaryBodyTemplate()`, `SECTIONS`, `MIN_SECTION_CHARS` in [`src/core/summary-body-contract.ts`](../../src/core/summary-body-contract.ts) — the shared shape, also prescribed to plan executors by `src/prep/formats.ts`.
- `isBookkeepingOnly(paths)`, `isRetirementOnly(paths)`, `touchesCode(paths)` in [`src/core/allowlist.ts`](../../src/core/allowlist.ts) — the predicates that decide exemption, the retirement Summary template, and the Test Plan shape.

## PRs

<!-- @prs-since-last-release: pr-summary-body-enforcement -->

## Changelog

### Initial Release (v1.3.0)

#### Summary

Noldor now rejects a code commit whose body does not explain the change (#321).

#### PRs

- #321: reject a code commit whose body does not explain the change ([link](https://github.com/davidzoufaly/noldor/pull/321))

<!-- generated: resources -->

## Resources

- **Tests:**
  - [`src/core/__tests__/pr-flow.test.ts`](../../src/core/__tests__/pr-flow.test.ts)
  - [`src/prep/__tests__/formats.test.ts`](../../src/prep/__tests__/formats.test.ts)

<!-- /generated: resources -->
