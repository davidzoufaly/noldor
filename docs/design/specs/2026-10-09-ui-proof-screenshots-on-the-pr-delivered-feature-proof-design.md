# UI Proof Shows the Delivered Feature — Design

**Slug:** ui-proof-screenshots-on-the-pr (enhancement: delivered-feature-proof)
**FD:** docs/features/ui-proof-screenshots-on-the-pr.md
**Date:** 2026-10-09
**Tier:** specs-only
**Entry:** Q-0365

## Problem

`consumer.uiProof.<surface>.command` runs one fixed command for every PR. A consumer points it at one static `@proof` test, so every PR posts the same screenshots. charuy's `apps/web/e2e/ui-proof.spec.ts` shoots "the app as it opens" and "the feature-showcase house" on every branch, whatever the branch changed. The `## UI Proof` section then proves that the app boots, not that the new feature works. `runProofCommand` in `src/core/ui-proof.ts` has no input that names the branch, so the consumer cannot select a per-feature test even if it wrote one.

## Goals

- On a surface that opts in with `featureSpec`, a UI-touching branch carries its own proof test and `pr-flow` runs that test, so the PR shows the feature that shipped.
- The proof command learns which branch it is proving, through a `{slug}` / `{spec}` placeholder and a `NOLDOR_PROOF_SLUG` / `NOLDOR_PROOF_SPEC` env var.
- A branch with no proof test of its own gets a loud `no feature proof` note on the PR and a warning on stderr, never a silent fall back to the fixed tour.
- The gate asks for the proof test before the code-stage review, on fast-track and on FD paths, so the note is the exception.

## Non-goals

- Writing the proof test for the consumer. Noldor names the expected path and asks; the agent in the session writes the Playwright code.
- Judging whether the screenshots actually show the change. That stays a reviewer call.
- Blocking the merge. A missing proof is a note, as today.
- Turning feature proof on by default. A surface without `featureSpec` keeps its fixed command; each consumer opts in per surface (charuy's adoption is its own step).
- Changing the image hosting (`hostUiProof`, the `noldor/ui-proof` branch) or the render-compare fallback.

## Design

### Structural context

`src/core/ui-proof.ts` sits in community c58, beside `run-capture.ts`; it defines no god node and is an interior file. Its cross-community edges are the ones this change uses: it imports types from `consumer-config.ts` (c22) and is called from `pr-flow-cli.ts` (c66). `consumer-config.ts` defines `loadConsumerConfig()`, god node rank #4 (46 edges), so the schema edit is additive only — one optional key — and changes no existing shape. No new cross-community edge is planned beyond a new check module importing `ui-proof.ts` and `consumer-config.ts`.

UI verdict: skip — noldor declares no `consumer.uiPaths`; the change is CLI and config only.

Architecture verdict: skip — no new directory, package or external; the new check lives under the existing `src/checks/`.

### Unit 1 — `featureSpec` in the proof recipe

`uiProof.<surface>` gains an optional `featureSpec`: a repo-relative path template that must contain `{slug}`, e.g. `"apps/web/e2e/proof/{slug}.spec.ts"`. Today `uiProof` reuses `uiCaptureRecipeSchema`; it gets its own schema (`uiProofRecipeSchema`, extending the capture one) so `uiCapture` does not grow a key it never reads. A surface without `featureSpec` behaves exactly as today — this is opt-in per surface.

### Unit 2 — the proof slug

The proof slug is the last segment of the branch name, run through `sanitizeSurfaceName`: `feat/ui-proof-delivered-feature-proof` → `ui-proof-delivered-feature-proof`, `fast/fix-bar` → `fix-bar`. That is also the worktree folder name, so an agent knows it without asking. It is not `session.slug` or the FD slug: on an attach path the FD slug is the parent's, shared by every enhancement, which would make two branches write the same file. Two live branches whose last segments match would share a slug, but they cannot both hold a worktree of that name. Branches spread out over time are the real collision, because a merged proof spec stays in the repo. Unit 3 handles that by counting a spec only when this branch changed it.

### Unit 3 — running the feature proof

In `runProofCommand`, when the recipe has `featureSpec`:

1. Resolve `spec = featureSpec.replace('{slug}', proofSlug)`.
2. Count the spec only when it exists in `HEAD` **and** this branch added or modified it (`git diff --name-only origin/main...HEAD`). An uncommitted file does not count. Neither does a spec left by an earlier branch with the same slug.
3. Present → substitute `{slug}` and `{spec}` in the command (single-quoted, like `{out}` today), set `NOLDOR_PROOF_SLUG` and `NOLDOR_PROOF_SPEC` beside `NOLDOR_PROOF_OUT`, run it. Everything after that — PNG collection, hosting — is unchanged.
4. Not counted → do not run the command. Add the note `no feature proof: <spec> is not on this branch` and fall through to the render-compare shot, as a failed command does today. `uiProofStep` warns on stderr for every `no feature proof` note, even when the render-compare shot fills the gap — the existing warning fires only for a surface left with no image, which would hide the missing proof behind a fallback picture.

### Unit 4 — `checks ui-proof-spec`

A new `pnpm noldor checks ui-proof-spec [--base origin/main]` reports, for each surface the branch touches (same `uiProofSurfaces` filter `pr-flow` uses) whose recipe has `featureSpec`, whether the expected spec counts under the Unit 3 rule. Exit 0 when every such surface has one, or none applies, or a `Noldor-UI-Proof: skip` / FD `design: skip` is declared. Exit 1 lists each missing path. It never runs the test.

### Unit 5 — gate step

`fast-track.md` (Step 4 doc-impact area) and `fd-close.md` (before the flip) each get one short line: run `checks ui-proof-spec`; on exit 1, write the named spec so it drives the new UI and shoots it into `NOLDOR_PROOF_OUT`, then commit it. The gate-skill-layout word cap has almost no headroom, so the added prose is offset by trimming in the same files.

### Error handling

A `featureSpec` without `{slug}`, an absolute path, or a `..` segment fails `validate noldor-config`. A `git cat-file` failure other than "missing" becomes a note, like any other proof-step failure; the step still never throws.

### Testing

`ui-proof.test.ts`: present spec → command gets `{slug}`/`{spec}` and both env vars; absent spec → command not run, note added, render-compare fallback used; no `featureSpec` → today's behaviour. `consumer-config.test.ts`: schema accepts and rejects the template shapes above. A new check test drives a temp repo with and without the spec file.

## Acceptance criteria

1. A surface whose recipe has no `featureSpec` produces the same proof as before (command, notes, fallback).
2. With `featureSpec` set and the resolved file added or modified on the branch, `pr-flow` runs the proof command with `{slug}`/`{spec}` substituted and `NOLDOR_PROOF_SLUG`/`NOLDOR_PROOF_SPEC` set.
3. With `featureSpec` set and the file absent from `HEAD`, or present but unchanged since `origin/main`, the command does not run, the PR gets a `no feature proof` note naming the expected path, and stderr warns.
4. The proof slug is the branch's last segment, sanitized; two attach branches under one parent FD with different enhancement names get different slugs.
5. `validate noldor-config` rejects a `featureSpec` that lacks `{slug}`, is absolute, or contains `..`.
6. `checks ui-proof-spec` exits 1 and names the path when a touched surface's spec is missing; exits 0 when present, when no surface applies, or when a UI-proof skip is declared.
7. The fast-track and fd-close gate pages tell the session to run the check and write the spec on exit 1; `gate-skill-layout.test.ts` stays green.
8. The parent FD's Usage documents `featureSpec`, the placeholders and env vars, and the check.

## Risks / trade-offs

- Proof specs pile up in the consumer's e2e folder, one per UI branch. They are real tests of the feature, so this is mostly a gain, but each must skip itself when `NOLDOR_PROOF_OUT` is unset or the normal e2e run slows down.
- An agent can write a proof test that shoots the wrong screen. The note makes a missing proof loud; a wrong one is still a reviewer catch.
- The branch-name slug changes if a branch is renamed before ship; the check catches that because it uses the same rule.

## User Story

As a reviewer of a consumer PR that changes UI (human or agent), I want the PR's screenshots to come from a test written for this branch, so that they show the feature that shipped and not the same tour every time.

## Usage

- In `.noldor/config.json`: `"uiProof": { "app": { "command": "pnpm test:e2e {spec}", "featureSpec": "apps/web/e2e/proof/{slug}.spec.ts" } }`.
- `{slug}` is the branch's last segment (also the worktree name); `{spec}` is the resolved path. Both are also in `NOLDOR_PROOF_SLUG` / `NOLDOR_PROOF_SPEC`.
- `pnpm noldor checks ui-proof-spec` — names any missing proof spec for the branch. The gate runs it before code review.
- No proof spec on the branch → the PR says `no feature proof` and uses the render-compare shot if there is one.

## Open questions (resolved)

1. *Where does the proof slug come from?* -> The branch's last segment. (D1) It is per-branch on every path and equals the worktree name; the FD slug is shared across attach enhancements.
2. *When the feature spec is missing, run the old fixed command anyway?* -> No: note and fall to render-compare. (D2) Running the fixed tour is exactly the misleading output this entry removes; a note is honest.
3. *Should proof specs stay in the repo after merge?* -> Yes, committed with the feature. (D3) They are regression tests of the feature for free, and pr-flow must read them from `HEAD`.
