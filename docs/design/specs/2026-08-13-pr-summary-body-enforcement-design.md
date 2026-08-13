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
- Rewriting the CR pipeline or the rules engine.
- Revisiting *why* `pickSummarySha` skips bookkeeping commits — PR #304 settled that intent. Its skip **set** does widen here (see Unit 4), which is a correctness fix to an under-specified predicate, not a change of policy.
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
ideas.md
.noldor/retired-entry-ids.json
.noldor/id-counter.json
.noldor/design/**
```

`ideas.md` and `.noldor/id-counter.json` are on the list because the framework's own bookkeeping commits stage them: `/noldor-triage` writes `ideas.md` alongside `docs/roadmap.md`, and `triage mint-id` bumps the counter into the same commit as a freshly scaffolded FD — commit `3e2cf1f`, this spec's own, stages exactly that trio. Omitting them would force Why/How/What onto a commit that changed no code.

`isBookkeepingOnly(paths)` is true when `paths` is non-empty and every entry matches. An empty `paths` returns `false` — the predicate answers "is this set entirely bookkeeping?", and an empty set proves nothing. Callers handle emptiness themselves (Unit 2 passes on it; Unit 4 cannot see it, since `pr-flow` already exits when no commits are ahead of base).

This is the exemption boundary for Unit 2: roadmap retirements, phase-flips, spec/plan commits and design-ledger writes carry no code and are exempt from the body contract.

Deliberately a *separate* glob set rather than a reuse of `MICRO_CHORE_GLOBS`: micro-chore's allowlist governs what a *path* may stage, this one governs what counts as *carrying no code*. Coupling them would let a widening of one silently widen the other.

Two further predicates over the same module, each with its own glob set — one exemption boundary cannot serve three questions:

- `isRetirementOnly(paths)` — every entry is `docs/roadmap.md` or `.noldor/retired-entry-ids.json`. Since Q-0107 `roadmap remove-block` writes the retired-ID map, so a real retirement commit stages **both**; a predicate naming only the roadmap would never match one (verified against `ef974e2`, PR #318). Consumed by Unit 4's retirement-only template.
- `touchesCode(paths)` — any entry matching `CODE_GLOBS`: `src/**`, `bin/**`, `scripts/**`, `templates/**` (excluding `templates/docs/**`), `lefthook/**`, `*.json` at root, `*.{ts,tsx,js,jsx,mjs,cjs}` anywhere. Consumed by Unit 4's Test Plan choice. It is **not** the negation of `isBookkeepingOnly`: `docs/noldor/**`, root `*.md` and `templates/docs/**` are neither bookkeeping nor code, and negating the exemption set would render the code checklist for an ordinary micro-chore doc PR — hole #5 inverted rather than closed.

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

   `parseTrailers` throws by documented contract ([`src/core/trailers.ts`](../../../src/core/trailers.ts) — "the throw is a load-bearing contract"), so this read is wrapped exactly as [`validate-noldor-scope.ts`](../../../src/core/validate-noldor-scope.ts) wraps its own: on a throw, fall back to matching `/^Noldor-Path:\s*(release-automation|release-sweep)\s*$/m` against the raw message. Without the fallback an `interpret-trailers` failure would fail a release-automation commit closed.
3. **Bookkeeping exemption.** `stagedFiles.length === 0 || isBookkeepingOnly(stagedFiles)` → pass. The empty case covers `--allow-empty` commits and a `git diff --cached` that returned nothing to read; neither has code to explain.

   The staged set is loaded with `git diff --cached --name-only` and **no `--diff-filter`**. The existing loader in `validate-noldor-scope.ts` pins `--diff-filter=ACMRT`, which drops deletions; reused as-is, a deletion-only code commit (the PR #300 dashboard-route deletion shape) would yield an empty set and take the empty-case pass. Deletions are code changes and must be explained.
4. **Structure check.** Strip the subject line and the trailer block via `stripTrailers`, then require three section markers, each on its own line:

   ```
   Why — <the problem or motivation, plainly, then the technical detail>
   How — <the mechanism and where it hooks in>
   What — <the concrete outcome: files, commands, behaviour>
   ```

   Each marker must be followed by at least `MIN_SECTION_CHARS` (24) of non-whitespace content, counted across that section's lines up to the next marker. Missing or too-short sections produce one error naming every failing section plus the template verbatim — an agent that reads the rejection can fix it without opening a doc.

`stripTrailers` is the existing implementation at [`src/core/pr-flow-cli.ts`](../../../src/core/pr-flow-cli.ts) (with `TRAILER_RE` beside it), **hoisted into a shared core module** and re-exported so `pr-flow-cli` keeps its import. Naming it as the reuse is what keeps the validator and `composeBody` agreeing on which lines are trailers; two independent strippers would eventually disagree, and the disagreement would surface as a body that passed the hook and rendered wrong in the PR.

The `—` separator (not `:`) is deliberate: `Why: …` in a body's last paragraph is a valid git trailer token and would be swallowed by `git interpret-trailers`, colliding with [`parseTrailers` / `detectDroppedTrailers`](../../../src/core/trailers.ts). An em dash cannot be a trailer separator.

Registered in [`src/cli/manifest.ts`](../../../src/cli/manifest.ts) under the `validate` group as `summary-body` → `core/validate-summary-body.ts`, and appended to `docs/noldor/script-catalog.md` (the `validate script-catalog` gate rejects an unlisted command).

**Why a separate command rather than folding this into `noldor-validate-trailer.ts`.** That hook already holds the rollout gate, a staged-file read and the `allowlist` import, so folding would save one node spawn and one `git diff --cached` per commit. Rejected on two grounds. First, precedent: `validate noldor-scope` and `validate feature-slug-scope` are *already* separate `commit-msg` jobs sitting beside the trailer hook — this is the established shape for a commit-msg concern, and the trailer hook is about trailers. Second, the standalone form `pnpm noldor validate summary-body <file>` lets an agent check a message before committing (see Usage), which a hook-internal check cannot offer. The per-commit cost is one extra process on a hook chain that already spawns four; ordering still puts the trailer diagnostic first (Unit 3).

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

- **Retirement-only branch** (`isRetirementOnly(branchFiles)` — every entry is `docs/roadmap.md` or `.noldor/retired-entry-ids.json`): emit a deterministic template instead of the bookkeeping subject —

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

- **`pickSummarySha` skips the whole bookkeeping set** (`src/core/pr-flow-cli.ts`): today it skips only `docs/roadmap.md`, so since Q-0107 co-staged `.noldor/retired-entry-ids.json` it lands on the retirement commit, and on a `full-*` branch it lands on the spec or plan commit. Both are Unit-2-exempt, so the selected commit's body is legitimately empty and the FD append below would add nothing. Reusing `isBookkeepingOnly` in the `find` predicate makes the selection land on the first commit that actually carries code — precisely the commit Unit 2 forced a body onto. The existing `?? commits[0]` fallback is unchanged, so a retirement-only branch still reaches the template above.

- **FD-carrying paths**: `fd.summary` stays as the feature framing and the structured body from `summaryCommit` is appended beneath it, separated by a blank line. An attach PR then describes its own enhancement instead of the parent feature. The body is present by construction *given the selection fix above* — Unit 2 required it on the code commit, and selection now lands there. When the branch genuinely carries no code commit, `summaryCommit.body` is empty and the append is skipped (the FD summary alone stands).

- **`testPlanItems` derives from the diff, not from `fd`**: `touchesCode(branchFiles)` renders the code checklist (`validate:features`, `typecheck`, `test`, dogfood) regardless of FD presence; otherwise the doc-only line stands. The FD-specific dogfood bullet stays conditional on `input.fd`. The predicate is `touchesCode`, **not** a negated `isBookkeepingOnly` — a `docs/noldor/**` micro-chore is neither bookkeeping nor code, and negation would hand it a typecheck/test/dogfood checklist it cannot satisfy.

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
- `isBookkeepingOnly`: each glob, a mixed set, an empty set (false), and the real trio from commit `3e2cf1f` (`.noldor/id-counter.json` + spec + FD → true).
- `isRetirementOnly`: `docs/roadmap.md` alone; the roadmap + `.noldor/retired-entry-ids.json` pair (the post-Q-0107 shape); the pair plus one code file (false).
- `touchesCode`: `src/**` true; `docs/noldor/**` false; `templates/docs/**` false; `templates/**` non-docs true; a deletion-only set true (the loader keeps `D`).
- `pickSummarySha`: a branch of `[retirement commit (roadmap + retired-ids), code commit]` selects the code commit; a `full-*` shape of `[spec, plan, code]` selects the code commit; a retirement-only branch still returns `commits[0]`.
- `composeBody`: retirement-only branch renders the template with the right slug; FD path appends the structured body under `fd.summary`; attach path uses the parent FD summary plus the enhancement's body; code diff with no FD renders the code test plan; `docs/noldor/**`-only diff renders the doc-only line.
- End-to-end against a real git repo (scratch consumer, real commits, real hook run) that a code commit without a body is rejected and the same commit with one passes — the same shape as the existing hook tests.

## Acceptance criteria

- [ ] `git commit` on a staged diff containing any non-bookkeeping path fails when the message body lacks a `Why —`, `How —` or `What —` section of at least 24 characters, and the error names each missing section plus the template.
- [ ] The same commit succeeds once the three sections are present.
- [ ] A commit staging only bookkeeping paths (roadmap retirement, phase-flip, spec/plan, `ideas.md` triage, an `id-counter` bump) commits with no body and no warning.
- [ ] A deletion-only code commit is NOT exempt — the staged-set loader carries no `--diff-filter`.
- [ ] A `docs/noldor/**`-only PR still renders the doc-only Test Plan line (`touchesCode` is false), so hole #5 is closed rather than inverted.
- [ ] `release-automation`, `release-sweep`, `fixup!`, `squash!` and `Revert "` commits are exempt.
- [ ] A tree without a rollout marker, or pre-rollout, is unaffected.
- [ ] A retirement-only branch produces a PR Summary carrying why, how and what, naming the retired slug — not the bookkeeping subject alone.
- [ ] An FD-carrying PR renders the FD summary followed by the summary commit's structured body; an attach PR's body describes the enhancement, not the parent feature.
- [ ] On a branch whose first commits are bookkeeping (retirement pair, or spec + plan), the PR title and Summary both describe the first *code* commit.
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
   -> **No.** It only claims what the branch shape proves: every commit touched the roadmap / retired-ID pair alone, so nothing but bookkeeping shipped. The slug is read from the session marker (D4).

7. *`pickSummarySha` selects a Unit-2-exempt commit on retirement and `full-*` branches — fix in selection or with a second selector?* (CR round 1, D1)
   -> **Widen the existing predicate to `isBookkeepingOnly`.** One selector keeps the PR title and the Summary body describing the same commit; a second selector could drift them onto different commits. PR #304's intent — skip bookkeeping, describe the change — is preserved; only its under-specified skip set changes (D7).

8. *Fold the body check into `noldor-validate-trailer.ts` to save a process?* (CR round 1, D2)
   -> **Keep it separate.** `validate noldor-scope` and `validate feature-slug-scope` are already separate `commit-msg` jobs, and the standalone `validate summary-body <file>` pre-check has no equivalent inside a hook. Rationale and cost are stated in Unit 2 rather than left implicit (D8).
