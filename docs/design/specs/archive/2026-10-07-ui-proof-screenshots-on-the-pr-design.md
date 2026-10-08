# UI Proof Screenshots on the PR — Design

**Slug:** ui-proof-screenshots-on-the-pr
**FD:** docs/features/ui-proof-screenshots-on-the-pr.md
**Date:** 2026-10-07
**Tier:** specs-only

UI verdict: skip — Noldor declares no `consumer.uiPaths`; the feature changes `pr-flow`, not a UI surface.
Architecture verdict: skip — one new module under `src/core/` and a new PR body section; no new package, scan root or cross-module boundary.

## Problem

A consumer UI change ships with a text-only PR body. `composeBody` in `src/core/pr-flow.ts` renders Summary, Scope, Links, CR Results, Verify Evidence and Test Plan — every one of them prose or a table. A reviewer who wants to see the change has to check out the branch and boot the app.

The pictures already exist, and are thrown away. In charuy, the code-stage `render-compare` lane (`src/cr/lanes/render-compare.ts`) runs the consumer's `uiBoot.<surface>.screenshotCommand` against the booted app and writes `<surface>.shot.png` to `.noldor/cr/render-compare/<slug>/`, which is gitignored. Playwright e2e runs (charuy `apps/web/playwright.config.ts`) write to `test-results/`, also gitignored. Nothing carries either one onto the PR, and GitHub has no API for attaching an image to a PR body — so the gap is as much "where does the image live" as "which image".

## Goals

- A PR whose branch diff touches a UI path carries a `## UI Proof` section with one image per affected surface, rendered inline.
- When the consumer declares a proof command for a surface, the image comes from that e2e run, made fresh at ship time; otherwise it comes from the render-compare lane's shot.
- Hosting needs nothing beyond `git` and the `gh` auth `pr-flow` already uses.
- A UI-bearing PR with no image says so on the PR, with the reason, rather than staying silent.

## Non-goals

- No screenshot code in Noldor. Noldor runs the consumer's own proof command, or reuses the render-compare lane's capture; it never drives a browser itself.
- No visual diffing, before/after pairs or video. render-compare owns diffing; this feature only carries pictures to the PR.
- No blocking: a missing image never stops `pr-flow`.
- Noldor's own repo: it has no `uiPaths`, so the section never renders here.

## Design

### Structural context

`src/core/pr-flow.ts` sits in community c15. Its cross-community edges go to `prep-promote.ts` (c85, `shipBranch()` calls it), `session.ts` (c58), `pr-flow-cli.ts` (c71) and `allowlist.ts` (c25). `src/core/pr-flow-cli.ts` (c71) is the input builder: it imports `readSession()`, `fd-load.ts`, `config.ts` and `branch-added.ts`, and it is where new input data enters. `src/verify/smoke.ts` (c112) is owned by acceptance-verify-lane and is not touched. None of the three files is a god node; `pr-flow.ts` is a bridge between the ship path (c85) and the CLI (c71), so the new section lands in `composeBody` and its data is gathered in `pr-flow-cli.ts` (`runCli`, beside the existing `branchFiles` at :435 and `loadVerifyEvidence`), keeping `composeBody` pure. Collection, the proof command and the proof-branch push live in the new `src/core/ui-proof.ts`. `runCli` does not call them directly: it passes a lazy `prepareUiProof` step into `openAndAutoMerge`, which runs it after its guards (see Error handling).

### UI-bearing check at ship time

The section keys on the **branch diff**, not on the session marker's spec-time `uiVerdict`. No TypeScript reads `uiVerdict` today, and a spec-time `skip` is only a prediction. `pr-flow-cli.ts` already has the branch's changed files (`branchFiles`); it maps them through `surfaceMap` / `isUiBearing` from `src/core/ui-predicate.ts` to get the affected surfaces. No affected surface → no section, no proof push, no output. An FD `design: skip` suppresses the section even when the diff matches; there is no forcing override, because a section needs a surface to capture.

### Image sources

`src/core/ui-proof.ts` (new) exposes `collectUiProof(cwd, slug, surfaces, config) → UiProofItem[]`, one item per surface: `{ surface, source: 'e2e' | 'render-compare' | null, files: string[], notes: string[] }`. Sources, in order:

1. **e2e proof run** — a new optional `consumer.uiProof.<surface>.command`, a shell string with one placeholder, `{out}`. At ship time Noldor creates an empty folder, `.noldor/ui-proof/<slug>/<surface>/`, substitutes it, shell-quoted, for `{out}`, and runs the command through `runCapture` (`src/core/run-capture.ts`, already shared by render-compare and `design capture`) under `uiProof.<surface>.timeoutMs` (default 300 s). On exit 0 it takes every PNG the command wrote into that folder, sorted by name, capped at 3. Fresh by construction: the folder is emptied before every run, so nothing from an earlier run or another branch can appear. The consumer writes the shots from its own tests, e.g. a Playwright test tagged `@proof` that calls `page.screenshot({ path: \`${process.env.NOLDOR_PROOF_OUT}/home.png\` })` — Noldor also exports the folder as `NOLDOR_PROOF_OUT` for test code that cannot see the shell string.
2. **render-compare** — `.noldor/cr/render-compare/<slug>/<sanitizeSurfaceName(surface)>.shot.png` (the lane's own naming, `src/core/ui-boot.ts`), used when no proof command is configured for the surface, or when it exits non-zero or writes no PNG. The shot carries no commit today, so the lane gains one write: beside each shot, `<name>.shot.json` with `{ tree }`, the `HEAD^{tree}` it captured, published in the same round set as the shot by `swapRoundArtifacts` (`src/cr/lanes/round-artifacts.ts`), so a round that keeps the prior files keeps their old tree too. Noldor uses the shot only when that tree equals `HEAD^{tree}` at ship time. Tree, not commit SHA, because the review receipt is amended onto the tip after the lane runs, which changes the SHA but not the tree (`src/hooks/noldor-enforce-review-receipt.ts`). A shot with no sidecar or a different tree is stale and is not used.

Every candidate file must start with the 8-byte PNG signature; a file that does not is skipped with a reason, as if missing.

A failed or timed-out proof command is not hidden: the item records the reason (`proof command exited 1`, `timed out after 300 s`) whether or not the render-compare fallback then supplies an image. `UiProofItem` therefore holds `files: string[]` and `notes: string[]` independently.

### Hosting: an orphan proof branch

Images go to an orphan branch, `noldor/ui-proof`, never to the feature branch — a squash merge would otherwise land PNGs on `main` forever. `pushUiProof` writes the files under `<branch>/<headSha>/<surface>-<n>.png` with git plumbing: `git fetch origin noldor/ui-proof` (absent on the first ever push → a root commit), then `hash-object -w`, `mktree` and `commit-tree` on the fetched tip, then `push origin <sha>:refs/heads/noldor/ui-proof`, so the working tree and index are never touched. A rejected push (another session raced it) re-reads the tip and retries once. The PR links each image as `${repoUrl}/blob/<proofCommitSha>/<path>?raw=true`, pinned to the proof commit so later pushes cannot change what the PR shows. That link renders inline in private repos for any viewer with read access.

The branch is never pruned in this slice: it grows by a few hundred KB per UI PR. The alternatives were weighed and rejected — committing to the feature branch lands PNGs on `main` through the squash merge, release assets need a release per PR, and `gh gist` cannot hold binaries.

### PR body section

`renderUiProofSection(items)` in `pr-flow.ts` follows the `renderVerifySection` pattern: returns `''` when `items` is empty, else `## UI Proof` with, per surface, a `### <surface>` line, the source in one line, the image(s) as markdown, then each note as an italic line. An item with no image also renders `_No screenshot._` with the remedy (configure `uiProof.<surface>.command` or enable the `render-compare` lane). It slots before `## Verify Evidence`. `composeBody` takes the hosted links as data, so it stays pure: `openAndAutoMerge` awaits `prepareUiProof` after its guards and sets `input.uiProof` (already-hosted URLs) before `createPr` / `refreshExistingPr` call `composeBody`.

### Error handling

The proof step warns and never blocks. Every failure inside it — proof command non-zero or timed out, no PNG written, an invalid PNG, no fresh render-compare shot, push rejected twice, no `origin` — degrades to a note on the item, and to no image when no source is left. `pr-flow` prints one warning line per surface and goes on with an unchanged exit code. This matches the lanes that make the pictures: `render-compare` and the verifier both run `advisory` in charuy's autonomous config, so a stricter rule here would stop ships the review stage already let through.

Order inside `openAndAutoMerge`: `validatePrSummary` → `preflightGh` → `checkRedundantDelivery` → `prepareUiProof` (proof commands, then the proof-branch push) → push the feature branch → `gh pr create` (or `gh pr edit --body` for a reused open PR, so it gets the section too). The proof step runs after the guards so that a rejected summary, a gh-auth failure or a redundant delivery never pays for an e2e run or pushes images.

## Acceptance criteria

1. A branch whose diff touches no `uiPaths` file produces a PR body byte-identical to today's, and no push to `noldor/ui-proof` happens.
2. A branch touching one UI surface, with a render-compare shot whose sidecar tree equals `HEAD^{tree}`, yields a PR body with a `## UI Proof` section holding one inline image link for that surface.
3. When `consumer.uiProof.<surface>.command` is set, Noldor runs it into an emptied folder and uses the PNGs it wrote (at most 3) instead of the render-compare shot; when it fails or writes none, the render-compare shot is used and the failure reason still appears on the PR.
4. Images land on `refs/heads/noldor/ui-proof` under `<branch>/<headSha>/`; the feature branch's tree, index and working tree are unchanged.
5. Each image link names the proof commit SHA, not a branch name.
6. A render-compare shot with no sidecar or a different tree, or any file without the PNG signature, is not published.
7. A UI-bearing branch with no image renders a no-screenshot line with a reason, and `pr-flow` still opens and merges the PR.
8. A failed proof push (rejected twice, or no `origin`) leaves `pr-flow`'s exit code unchanged and prints one warning.
9. A reused open PR has its body refreshed with the section.
10. A redundant delivery or a failed `validatePrSummary` / `preflightGh` runs no proof command and pushes nothing to `noldor/ui-proof`.
11. `pnpm noldor validate noldor-config` accepts a `consumer.uiProof` block and rejects an unknown surface key.

## Risks / trade-offs

- The proof branch grows without bound. Each PNG is small (hundreds of KB), but a busy consumer adds them every UI PR. Pruning is deferred.
- Parallel drain (K>1): sibling children can run proof commands at once, and two that boot a dev server on the same port collide. The loser's item degrades to a note; the PR still ships. Port isolation is the consumer command's job (`{port}`-style allocation is out of scope here).
- A render-compare shot taken from a dirty worktree shows edits its sidecar tree does not hold. The code stage runs on committed work, so this is accepted rather than guarded.
- `?raw=true` links depend on GitHub's blob redirect; a GitHub change could break inline rendering in old PRs.
- The proof command adds one e2e run to every UI-bearing `pr-flow` (charuy's web suite boots `pnpm dev` and retries twice). A tag filter (`--grep @proof`) keeps it short; the timeout caps the worst case.
- Consumers must write proof tests for the e2e source to work; Playwright's `screenshot: 'only-on-failure'` (charuy today) captures nothing on a green run.

## User Story

As a reviewer of a consumer PR that changes UI, I want the PR body to show a screenshot of the change working, so that I can judge the result without checking out the branch.

## Usage

- No setup for render-compare users: when the code-stage `render-compare` lane ran, `pnpm noldor pr-flow` adds its shot to the PR under `## UI Proof`.
- For e2e proof, write a UI test tagged `@proof` that saves shots into the folder Noldor hands it (`await page.screenshot({ path: \`${process.env.NOLDOR_PROOF_OUT}/home.png\` })`), and declare the command in `.noldor/config.json`:
  `"consumer": { "uiProof": { "app": { "command": "pnpm test:e2e --grep @proof" } } }`
  Add `{out}` to the command when the test runner takes the folder as an argument instead of reading `NOLDOR_PROOF_OUT`.
- Images live on the `noldor/ui-proof` branch; nothing to clean up per PR.

## Open questions (resolved)

1. *Should a UI-bearing PR with no screenshot block `pr-flow`?* -> No, warn on the PR. (D1) render-compare and verify are advisory in charuy's autonomous config; blocking here would be stricter than the lanes that make the pictures.
2. *Where do images live?* -> Orphan `noldor/ui-proof` branch, linked by commit SHA. (D2) Committing to the feature branch lands PNGs on `main`; release assets need a release per PR; gists cannot hold binaries through `gh`.
3. *Which UI signal decides?* -> The branch diff against `uiPaths`, not the spec-time marker. (D3) The marker is a prediction and nothing reads it at ship time.
4. *How does an e2e image stay fresh?* -> Noldor runs `uiProof.<surface>.command` into an emptied folder at ship time. (D4) A glob over existing `test-results/` files has to guess freshness from mtime, and a stale or restored file passes that guess.
5. *Prune the proof branch?* -> Not in this slice. (D5) Growth is slow; a `garden` detector can propose pruning merged PRs' folders later.
