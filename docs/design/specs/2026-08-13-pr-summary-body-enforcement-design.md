# PR Summary Body Enforcement — Design

**Slug:** pr-summary-body-enforcement
**FD:** docs/features/pr-summary-body-enforcement.md
**Date:** 2026-08-13
**Tier:** specs-only
**Deps:** none

## Problem

The `pr-summary-why-how-what` rule ([`.noldor/rules/pr-summary-why-how-what.md`](../../../.noldor/rules/pr-summary-why-how-what.md)) is `enforce: true`, yet PRs keep shipping summaries that fail it. Five independent holes, all confirmed against merged PRs:

1. **The rule never sees its own output.** It declares `applies-to: ["src/core/pr-flow.ts", "src/core/pr-flow-cli.ts"]` with `stage: [code]`. [`fileMatches`](../../../src/rules/resolve.ts) resolves a file-scoped rule only when the query names that file, so the rule fires when an agent *edits pr-flow's source* and never against the PR body pr-flow *emits*. Compliance is therefore whatever prose an agent happened to type into a commit body — which is why it works "sometimes".

2. **Silent degradation to subject-only.** [`composeBody`](../../../src/core/pr-flow.ts) appends `summaryCommit.body` only when non-empty; an empty body yields `Fast-track: <subject>` — what-only, failing the rule by construction, with no warning and no non-zero exit. PR #298 shipped this way.

3. **Retirement-only branches always fail.** [`pickSummarySha`](../../../src/core/pr-flow-cli.ts) falls back to `commits[0]` when every commit touches only `docs/roadmap.md`. PRs #318 and #319 carry a one-line Summary that is the bookkeeping subject itself.

4. **The both-registers clause has no source.** The rule demands each of why/how/what in a technical *and* a plain-language rendering. The pipeline has exactly one prose source — a commit body, written for reviewers. PRs #313 and #315 are why/how/what-complete and register-incomplete: `resolveChangedRanges now unions git ls-files --others`, `loadDocRoots() treats the override as a repository root`.

5. **The Test Plan lies.** `testPlanItems` keys off `input.fd` being null, so every no-FD PR renders `- [ ] Doc-only change; no test plan beyond pnpm validate:features`. PRs #298, #313 and #315 are all code changes. A false "what" in the same body the rule governs.

Separately, FD-carrying paths render the FD's `## Summary` via [`loadFdSummary`](../../../src/core/pr-flow-cli.ts). On **attach** paths that is the *parent feature's* description, so an attach PR structurally misdescribes the enhancement that actually shipped.

`docs/vision.md` states the standard this misses: *"every commit carries enough context for an autonomous agent or human reviewer to understand the why."*

## Goals

- Make why/how/what a **mechanically enforced** property of the commit body, checked at the cheapest possible failure point.
- Give the plain-language register a named home in the pipeline instead of hoping for it.
- Make every PR body pr-flow emits satisfy the rule structurally — including retirement-only branches and FD-carrying paths.
- Stop the Test Plan section from asserting something the diff contradicts.

## Non-goals

- Mechanically judging *register quality*. A validator can check that a Why section exists and is non-trivial; it cannot check that it reads plainly. That bar stays with the rule text, the human reviewer and the code-stage CR.
- Rewriting the CR pipeline, the rules engine, or `pickSummarySha`'s selection policy (PR #304 settled that).
- Retroactively fixing merged PR bodies.
- Enforcement at `pr-flow` time. Rejected deliberately: a `pr-flow` failure destroys a drain iteration *after* implementation and CR have run (~13 min, ~170k tokens per the finish-mode record), whereas a commit-msg rejection costs one amend.

## Design

### Unit 1 — `isBookkeepingOnly` (extends `src/core/allowlist.ts`)

A new exported predicate beside the existing `isMicroChoreAllowed` / `isReleaseSweepAllowed`, over a `BOOKKEEPING_GLOBS` set:

```
docs/roadmap.md
docs/backlog.md
docs/features/**/*.md
docs/design/**/*.md
docs/milestones/**/*.md
.noldor/retired-entry-ids.json
.noldor/design/**
```

`isBookkeepingOnly(paths)` is true when `paths` is non-empty and every entry matches. An empty `paths` returns `false` — the predicate answers "is this set entirely bookkeeping?", and an empty set proves nothing. Callers handle emptiness themselves (Unit 2 passes on it; Unit 4 cannot see it, since `pr-flow` already exits when no commits are ahead of base).

This is the exemption boundary for Unit 2: roadmap retirements, phase-flips, spec/plan commits and design-ledger writes carry no code and are exempt from the body contract.

Deliberately a *separate* glob set rather than a reuse of `MICRO_CHORE_GLOBS`: micro-chore's allowlist governs what a *path* may stage, this one governs what counts as *carrying no code*. Coupling them would let a widening of one silently widen the other.

### Unit 2 — `src/core/validate-summary-body.ts` (new)

Mirrors [`src/core/validate-noldor-scope.ts`](../../../src/core/validate-noldor-scope.ts) exactly: a pure validator plus a CLI entry in the same file.

```ts
export interface ValidateSummaryBodyInput {
  message: string;        // full commit message
  stagedFiles: string[];  // git diff --cached --name-only
}
export interface ValidateSummaryBodyResult {
  success: boolean;
  error?: string;
}
export function validateSummaryBody(input: ValidateSummaryBodyInput): ValidateSummaryBodyResult;
```

Decision order:

1. **Rollout gate.** Reuse `rolloutMarkerExists` + `isPostRollout` from [`src/core/rollout-marker.ts`](../../../src/core/rollout-marker.ts) exactly as `validateTrailer` does, so a pre-rollout consumer is never broken by an upgrade. Not post-rollout → pass.
2. **Automation exemptions.** `Noldor-Path` of `release-automation` or `release-sweep`, or a subject matching `/^(fixup|squash)!/` or `/^Revert "/` → pass. These messages are machine-shaped and have no author to ask.
3. **Bookkeeping exemption.** `stagedFiles.length === 0 || isBookkeepingOnly(stagedFiles)` → pass. The empty case covers `--allow-empty` commits and a `git diff --cached` that returned nothing to read; neither has code to explain.
4. **Structure check.** Strip the subject line and the trailer block, then require three section markers, each on its own line:

   ```
   Why — <the problem or motivation, plainly, then the technical detail>
   How — <the mechanism and where it hooks in>
   What — <the concrete outcome: files, commands, behaviour>
   ```

   Each marker must be followed by at least `MIN_SECTION_CHARS` (24) of non-whitespace content, counted across that section's lines up to the next marker. Missing or too-short sections produce one error naming every failing section plus the template verbatim — an agent that reads the rejection can fix it without opening a doc.

The `—` separator (not `:`) is deliberate: `Why: …` in a body's last paragraph is a valid git trailer token and would be swallowed by `git interpret-trailers`, colliding with [`parseTrailers` / `detectDroppedTrailers`](../../../src/core/trailers.ts). An em dash cannot be a trailer separator.

Registered in [`src/cli/manifest.ts`](../../../src/cli/manifest.ts) under the `validate` group as `summary-body` → `core/validate-summary-body.ts`, and appended to `docs/noldor/script-catalog.md` (the `validate script-catalog` gate rejects an unlisted command).

### Unit 3 — commit-msg wiring

A fourth job in the `commit-msg` block of [`lefthook/noldor.yml`](../../../lefthook/noldor.yml), after `noldor-validate-trailer`:

```yaml
    - name: summary-body
      run: pnpm noldor validate summary-body {1}
```

Mirrored into `templates/lefthook/noldor.yml` (the consumer twin; `checks template-sync` enforces the pair).

Ordering matters: trailer validation runs first, so a commit missing its session marker fails with the marker diagnostic rather than a confusing body complaint.

### Unit 4 — `composeBody` reshaping (`src/core/pr-flow.ts`)

`PrFlowInput` gains one field, `branchFiles: readonly string[]` — the file list of every commit in `origin/main..HEAD`, flattened. `pr-flow-cli.ts` already computes exactly this via `parseCommitFileLists` for `pickSummarySha`; it is passed through rather than recomputed.

Three changes:

- **Retirement-only branch** (`branchFiles` is non-empty and every entry is `docs/roadmap.md`): emit a deterministic template instead of the bookkeeping subject —

  ```
  Bookkeeping: retire `<slug>` from the roadmap queue.

  Why — the entry already shipped, but its roadmap block was never removed, so
  the gate keeps re-surfacing work that is done.
  How — `roadmap remove-block <slug>` drops the block and records its ID in
  `.noldor/retired-entry-ids.json`, so existing `blocked-by:` references keep
  resolving.
  What — one block removed from `docs/roadmap.md`; no code change.
  ```

  Deterministic prose over a known-shaped change; no authoring, nothing invented. `<slug>` comes from `session.slug`, falling back to the subject's `retire <slug>` capture.

- **FD-carrying paths**: `fd.summary` stays as the feature framing and the structured body from `summaryCommit` is appended beneath it, separated by a blank line. An attach PR then describes its own enhancement instead of the parent feature. The body is present by construction — Unit 2 required it on the code commit this branch must contain.

- **`testPlanItems` derives from the diff, not from `fd`**: when `branchFiles` contains any non-bookkeeping path (same `isBookkeepingOnly` predicate, negated), render the code checklist (`validate:features`, `typecheck`, `test`, dogfood) regardless of FD presence. Only a genuinely doc-only diff renders the doc-only line. The FD-specific dogfood bullet stays conditional on `input.fd`.

The no-FD subject-only fallback at `pr-flow.ts:171-173` **stays** as-is. It is now unreachable for hook-validated commits and remains the graceful degradation for branches built before this lands, `--no-verify` commits, and rebases. Compose never fails; the hook is the enforcement point.

### Unit 5 — rule and doc updates

- [`.noldor/rules/pr-summary-why-how-what.md`](../../../.noldor/rules/pr-summary-why-how-what.md): widen `applies-to` to include `src/core/validate-summary-body.ts`, and state the split explicitly — the hook enforces *structure*, the rule text is the *register* bar that a reviewer and the code-stage CR hold. Naming the mechanical floor inside the rule stops the next reader assuming a green commit means a compliant summary.
- [`docs/noldor/pr-flow.md`](../../../docs/noldor/pr-flow.md) §"Where the title and Summary come from": replace the paragraph documenting subject-only degradation as intended design with the new contract (hook-enforced body, retirement template, FD append, diff-derived test plan).
- [`docs/noldor/git-and-commits.md`](../../../docs/noldor/git-and-commits.md): add the commit-body contract with the three-section template and the bookkeeping exemption list.
- `templates/docs/noldor/pr-flow.md` and `templates/docs/noldor/git-and-commits.md`: same edits (`checks template-sync` gates the twins).

### Data flow

```
git commit
  ├─ prepare-commit-msg: inject-trailers        (unchanged)
  └─ commit-msg
       ├─ validate noldor-scope                 (unchanged)
       ├─ validate feature-slug-scope           (unchanged)
       ├─ hooks validate-trailer                (unchanged)
       └─ validate summary-body                 ← NEW: rejects a code commit
                                                  lacking Why/How/What
pnpm noldor pr-flow
  └─ composeBody
       ├─ retirement-only?  → deterministic template          ← NEW
       ├─ FD path?          → fd.summary + structured body    ← CHANGED
       ├─ no-FD path?       → label + subject + body          (unchanged)
       └─ testPlanItems     → derived from diff shape         ← CHANGED
```

### Error handling

- Every validator failure is a single stderr line prefixed `✗ commit-msg gate:` (the existing convention) naming the missing sections and printing the template. Exit 1.
- `git diff --cached` failure → treat the staged set as unknown and **pass**. A git-plumbing failure must not block a commit; the pre-push receipt and the CR remain downstream.
- `composeBody` never throws on a missing or malformed body — it degrades as it does today.

### Testing

Per `docs/noldor/testing-principles.md`, real behaviour over mocks:

- `validateSummaryBody` unit matrix: all three sections present; each one missing; a section present but under `MIN_SECTION_CHARS`; sections in the wrong order (accepted — order of *presence* is not enforced, the rule's ordering is a prose bar); `Why:` colon form (rejected, with the trailer-collision hint); markers inside the trailer block (not counted); bookkeeping-only staged set (passes with no body); `fixup!`/`Revert "` subjects; `release-automation` path; pre-rollout tree.
- `isBookkeepingOnly`: each glob, a mixed set, an empty set (false).
- `composeBody`: retirement-only branch renders the template with the right slug; FD path appends the structured body under `fd.summary`; attach path uses the parent FD summary plus the enhancement's body; code diff with no FD renders the code test plan; doc-only diff renders the doc-only line.
- End-to-end against a real git repo (scratch consumer, real commits, real hook run) that a code commit without a body is rejected and the same commit with one passes — the same shape as the existing hook tests.

## Acceptance criteria

- [ ] `git commit` on a staged diff containing any non-bookkeeping path fails when the message body lacks a `Why —`, `How —` or `What —` section of at least 24 characters, and the error names each missing section plus the template.
- [ ] The same commit succeeds once the three sections are present.
- [ ] A commit staging only bookkeeping paths (roadmap retirement, phase-flip, spec/plan) commits with no body and no warning.
- [ ] `release-automation`, `release-sweep`, `fixup!`, `squash!` and `Revert "` commits are exempt.
- [ ] A tree without a rollout marker, or pre-rollout, is unaffected.
- [ ] A retirement-only branch produces a PR Summary carrying why, how and what, naming the retired slug — not the bookkeeping subject alone.
- [ ] An FD-carrying PR renders the FD summary followed by the summary commit's structured body; an attach PR's body describes the enhancement, not the parent feature.
- [ ] A no-FD PR whose diff touches code renders the code Test Plan checklist, never `Doc-only change`.
- [ ] `pnpm noldor validate script-catalog`, `pnpm noldor checks template-sync` and `pnpm noldor rules validate` all pass with the new command, twins and rule edit.

## Risks / trade-offs

- **Noise on multi-commit branches.** A plan-driven `full-*` branch with eight task commits now needs eight bodies. Accepted: this is the vision's stated standard, and each body is three lines. The bookkeeping exemption keeps the spec/plan/phase-flip commits free.
- **A mechanical check is a necessary, not sufficient, condition.** `Why — because it was broken` passes at 24 characters. The register bar stays with the rule text and the reviewer. Stated in the rule so nobody reads a green hook as compliance.
- **No escape hatch.** The operator declined an override trailer, so a wedged headless drain has only `--no-verify` (which then trips the pre-push receipt gate). Mitigation is diagnostic quality: the rejection prints the template, so the fix is an amend, not an investigation.
- **Behaviour change lands for every consumer on upgrade.** The rollout-marker gate is what keeps this from breaking an unmigrated consumer; without it the hook would reject their first commit after `pnpm noldor upgrade`.
- **`git interpret-trailers` collision** if the markers were colon-separated. Mitigated by the em dash and covered by a test asserting `Why:` is rejected with the hint.

## User Story

As an agent shipping a change through the gate, I want the commit-msg hook to reject a code commit whose body does not state why, how and what, so that every PR Noldor opens explains itself — and I find out at commit time, when the fix is a three-line amend, instead of after implementation and code review have already run.

## Usage

Write the summary commit body with three sections:

```
fix(clones): union untracked files into the diff-scoped verdict

Why — a new file has no git post-image, so the clone gate printed
"green" for a file whose every line was just written. Plainly: the
duplicate-code check silently skipped brand-new files.
How — resolveChangedRanges now unions `git ls-files --others` into the
changed-range map as whole-file spans; an ls-files failure returns null
so "unknown" is never printed as clean.
What — src/clones/ranges.ts plus a regression test; `noldor clones
check` now reds on a pasted new file.

Noldor-Path: fast-track
```

Bookkeeping commits need no body:

```bash
git commit -m "docs(roadmap): retire <slug> — shipped via fast-track (no FD)"
```

Check a message without committing:

```bash
pnpm noldor validate summary-body .git/COMMIT_EDITMSG
```

## Open questions (resolved)

1. *Section marker syntax — `Why:` or `Why —`?*
   -> **Em dash.** `Why:` at the start of a body's last paragraph is a valid git trailer and `git interpret-trailers` would absorb it, colliding with the existing `detectDroppedTrailers` guard (D2).

2. *How much content counts as a real section?*
   -> **24 non-whitespace characters per section.** Long enough to reject `Why — x`, short enough never to block an honest one-line reason. Any threshold is arbitrary; this one is cheap to change and covered by a boundary test (D2).

3. *Should the hook apply to consumers immediately on upgrade?*
   -> **No — gate on the rollout marker,** reusing `rolloutMarkerExists` + `isPostRollout` exactly as `validateTrailer` does. A consumer upgrading mid-branch otherwise has their next commit rejected by a rule they never opted into (D3).

4. *Is section order enforced?*
   -> **Presence only.** The rule's why→how→what ordering stays a prose bar. Enforcing order mechanically adds a failure mode with no reviewer benefit — a body with all three sections in any order is readable (D2).

5. *What happens to the existing subject-only fallback in `composeBody`?*
   -> **Kept.** It is unreachable for hook-validated commits and remains the graceful path for pre-existing branches, `--no-verify` commits and rebases. `composeBody` must never fail; enforcement belongs at the hook (D3).

6. *Does the retirement-only template risk asserting something false?*
   -> **No.** It only claims what the branch shape proves: every commit touched `docs/roadmap.md` alone, so nothing but bookkeeping shipped. The slug is read from the session marker (D4).
