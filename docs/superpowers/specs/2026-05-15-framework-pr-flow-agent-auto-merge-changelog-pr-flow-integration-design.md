# Changelog PR-Flow Integration — Design

Status: draft (brainstorming complete 2026-05-15)
Feature: [`docs/features/framework-pr-flow-agent-auto-merge.md`](../../features/framework-pr-flow-agent-auto-merge.md) — attached enhancement; lands on the same FD as a follow-up to the v0.4.0+ PR-flow work.

## Motivation

Today `release-fd-changelog.ts` renders `### <version>` blocks under each FD's `## Changelog` section only when `phase: done` (line 94 of `release-fd-changelog.ts`). The block contents are a single `#### Summary` paragraph — LLM-polished prose from commit subjects in the `previousTag..HEAD` range. There is no per-PR attribution, and FDs that develop across multiple release cycles as `phase: in-progress` get NO changelog blocks at all until the cycle when they flip to `done`. That cycle's block then covers only `previousTag..HEAD` — bulk-of-development work from earlier cycles is invisible in the FD body.

Three gaps the framework's PR-flow integration exposes:

1. **Commit-as-attribution-unit is awkward.** Under PR-flow (`framework-pr-flow-agent-auto-merge`), each FD's worktree merges as a single squash commit per PR. The squash commit subject is in Conventional Commits format and carries a `(#N)` PR suffix, so commit-grep continues to work mechanically — but the FD body never surfaces the PR-as-unit-of-change. The `#### Summary` prose abstracts away the work without linking back to its review surface.
2. **Pre-`done` work is invisible.** A typical FD's `## Changelog` is empty (only a `<!-- TBD -->` style placeholder) until the cycle when phase flips, even when 5+ release cycles of in-progress work happened before that. Readers of the FD body see no per-release history; they have to walk `git log` separately.
3. **First-`done` release is incomplete.** When an FD finally flips to `done`, the rendered `### <X>` block walks only `previousTag..HEAD`, missing every PR landed in earlier cycles. The release-notes pipeline (`release-notes.ts`) pulls FD `## Summary` for `introduced` features, which papers over this — but the FD's own changelog history has a one-version-only view of work that may have spanned six versions.

This FD encodes a PR-driven, phase-aware changelog format that:

- Adds a `#### PRs` sub-section listing PR-attached commits (PR number re-parsed from `FeatureCommit.subject` via the same regex the global pipeline uses on `Commit.subject` in `release-commits.ts`).
- Renders per-release blocks for FDs in any phase that have qualifying PRs in the release range — in-progress and done alike.
- At first-done, replaces the per-release block with an `### Initial Release (v<introduced>)` block whose range is cumulative (`<first slug-matching PR>..HEAD`).
- Introduces a phase-revert mechanism so attach sessions (`/gate full-attach` / `specs-only-attach` on a `done` parent FD) flip the parent back to `in-progress` for the enhancement cycle, then back to `done` when the worktree finishes.

The aim is twofold: PR-as-unit-of-attribution everywhere FD history is rendered, and parity between an FD's life-cycle (in-progress → done → enhanced → done) and what the `## Changelog` section actually shows.

## Goals

- Per-release `### <X>` blocks render for FDs in ANY phase (in-progress or done) that have slug-matching PRs in the release range. In-progress blocks carry the `(in-progress)` suffix; done blocks do not.
- Each per-release block contains `#### Summary` (existing LLM-polished prose) PLUS a new `#### PRs` sub-section listing PR-extracted commits as `- #N: <title> ([link](url))`, newest first.
- At first-done, the block is named `### Initial Release (v<introduced>)`; range is `<first slug-matching PR>..HEAD` (cumulative since FD inception); replaces what would otherwise be `### v<introduced>`.
- The phase-revert mechanism is asymmetric: `/gate` writes the `done → in-progress` revert commit on the worktree branch at session start; the `in-progress → done` restore is handled by `release-markers.ts` on the next `pnpm release` (not by `finishing-a-development-branch`). This is forced by squash-merge semantics — a counter-restore commit on the worktree would cancel out the revert in the squash, making the `(in-progress)` label invisible. See §3.5 for the rationale.
- Forward-only rollout — existing 53 done FDs' `## Changelog` sections stay as-is (no retroactive `### Initial Release` block, no retrofitted `#### PRs` sub-section in their existing blocks).
- Release-notes (`docs/release-notes.md`) and global CHANGELOG.md require no semantics changes (both already PR-aware for the data they render).

## Non-goals

- **Backfill of existing done FDs.** Per the Q4 decision, no rewriting of the 53 existing done FDs. Their `## Changelog` sections remain authored-as-was.
- **GitHub API queries for PR data.** No `gh pr list` / `gh pr view` calls in the release script. The squash-commit subject IS the PR title (Conventional Commits enforced by `composeTitle` in `pr-flow.ts`); the `(#N)` suffix carries the PR number. The FD-level pipeline (`commitsForFeature` → `FeatureCommit[]`) re-applies the same regex pattern `readCommitsSince` uses to populate `Commit.prNumber` — but consumes it per-bullet rather than via a shared field, because `FeatureCommit` (the FD-pipeline type) has no `prNumber` member.
- **Retroactive label updates.** Once a `### <X> (in-progress)` block is written, it stays labeled (frozen at render time). When phase flips to `done` in a later release, prior in-progress-labeled blocks are NOT rewritten. They are a historical record of when the work happened.
- **Pre-PR-flow commit coverage in `#### PRs`.** Non-PR commits (pre-bootstrap of `framework-pr-flow-agent-auto-merge`) are silently skipped from `#### PRs`. The prose Summary still abstracts them; `#### PRs` lists only PRs.
- **New frontmatter fields.** No `developmentStarted` / `inProgressUpdated` / similar. The cumulative range for Initial Release is derived from `git log` (first slug-matching commit with PR ref).
- **Reshape `release-notes.md` rendering.** Release-notes continues to pull FD `## Summary` for `introduced` and the per-release block's `#### Summary` for `updated`. The new `### Initial Release` block IS the per-release block at first-done, so release-notes extraction works unchanged.
- **Reshape global `CHANGELOG.md`.** Already lists commits with PR # links via `renderCommit` (`release-changelog.ts:15-20`). Untouched.

## §1 FD `## Changelog` Format

### 1.1 Per-release block (in-progress or done, non-first-done)

```markdown
### <version>[ (in-progress)]

#### Summary

<LLM-polished prose summarizing the release-range PRs, sourced from
`polishSummary` over filtered commit subjects — same as today.>

#### PRs

- #<N>: <PR title> ([link](https://github.com/<owner>/<repo>/pull/<N>))
- #<N>: <PR title> ([link](...))
- ...
```

**Heading suffix:** `(in-progress)` appended when, at render time (release script execution), the FD's frontmatter `phase` is `in-progress`. Removed when phase is `done`. Once written, the suffix is frozen for that block — later releases don't rewrite it.

**`#### Summary`** is unchanged from today's implementation: filtered commit subjects (drop `chore|docs|test|style|ci|build`) → `polishSummary` (LLM polish with deterministic fallback). The data source remains `git log` (commits with `<pkg>:<slug>` scope or `Noldor-FD:` trailer in the release range).

**`#### PRs`** is new. Bullets list commits whose subject matches `\(#\d+\)\s*$` (the squash-commit PR suffix written by `gh pr merge --squash`). Each bullet is `- #<N>: <subject without "(#N)" suffix> ([link](<repoUrl>/pull/<N>))`. Bullets are deduplicated by PR number and ordered newest-first (matches `git log` default order). If no commits in the range have a PR number, the `#### PRs` sub-heading is omitted entirely (don't render an empty section).

**Block rendered when:** the FD has at least one qualifying commit in the release range (`previousTag..HEAD`), regardless of `phase`. This is the change from today's `phase === 'done'` gate.

### 1.2 Initial Release block (first-done)

When an FD's `phase` first flips to `done` in the release-script execution, the per-release block for that release is renamed and the content range is widened. The heading becomes:

```markdown
### Initial Release (v<introduced>)

#### Summary

<LLM-polished prose summarizing ALL PRs since FD inception, sourced via
the same `polishSummary` call but with a wider commit range.>

#### PRs

- #<N>: <PR title> ([link](...)) # newest PR
- ...
- #<N>: <PR title> ([link](...)) # oldest slug-matching PR with PR ref
```

**Heading format:** `### Initial Release (v<introduced>)`. The version anchor mirrors the FD's `introduced` field (set by the release script in the same execution that renders this block). Once written, this block is the FD's first-done changelog entry — there is no separate `### v<introduced>` block alongside it (per layout decision: Initial Release REPLACES v<first-done>).

**Detection of first-done:** the FD's frontmatter has `phase: done` AND `introduced` is unset (i.e., about to be set by step 4 of the release pipeline). The release script's existing `fillMarkers` step gates on this signal already; this spec hooks into the same condition before that step runs (so we can read `introduced === undefined` and render the appropriate heading).

**Inception range:** `<first slug-matching commit with PR ref>..HEAD`. Derivation:

1. Walk `git log --reverse --grep='<scope-grep>' --grep='<trailer-grep>'` over all repo history (no `--since` cap).
2. For each commit, parse the subject for `\(#\d+\)\s*$`. Take the FIRST commit (oldest) whose PR ref extracts cleanly. Its parent SHA becomes the lower bound (range = `<first-PR-commit-sha>^..HEAD`). Older slug-matching commits without PR refs are EXCLUDED from both Summary and `#### PRs` — accepted gap per Q10.
3. If no slug-matching commit has a PR ref (entirely pre-PR-flow FD), the Initial Release block omits `#### PRs` AND the Summary range falls back to repo-start (`fromRef = ''`). This is the only fallback that widens beyond first-PR.

**Corner case — first-done FD with zero slug-matching commits.** A newly-scaffolded FD where the operator manually flips phase to done without any work having been committed under the slug. `findFirstPrCommit` returns null AND `commitsForFeature` returns []. `renderInitialReleaseBlock` returns null → no block written. `fillMarkers` still sets `introduced=newVersion` (its existing behavior). Net result: FD ends with `introduced` set but empty `## Changelog`. This is an authorial choice the framework allows (the FD's `## Summary` is the only narrative); not corrupt state.

**Initial Release rendered when:** the FD's `phase` is `done` AND `introduced` is unset prior to this release's `fillMarkers` step. Subsequent done-flip cycles (after a phase-revert + re-ship enhancement) render normal `### <X>` blocks — no second Initial Release.

### 1.3 In-progress phase rendering

When release script runs and an FD has `phase: in-progress`:

- If the FD has qualifying commits in `previousTag..HEAD`: render a `### <version> (in-progress)` block per §1.1.
- The FD does NOT get its `updated` field set (per Q5 decision — `updated` semantics unchanged; only done-FD blocks trigger `updated`).
- The FD does NOT appear in `docs/release-notes.md` for this version (release-notes filters on `introduced == newVersion || updated == newVersion`; in-progress FDs match neither).
- Block heading is permanent: when phase flips to done in a later release, the prior `(in-progress)` labels stay (historical signal of when work happened).

**Edge case — phase flips during the cycle:** if PRs in `previousTag..HEAD` were merged while phase was in-progress, then a later PR in the same cycle flips phase to done, the release script reads phase as `done` at render time. This triggers the first-done path (§1.2) → `### Initial Release` block instead of `### <X> (in-progress)`. The early-cycle in-progress PRs are folded into Initial Release. Acceptable: the FD's first-done snapshot is the cumulative view; the cycle's mid-development "in-progress" sub-state isn't independently preserved (the Initial Release block IS the historical record).

### 1.4 Worked examples

**Example A — fresh feature `foo` started post-v0.1.0, shipped at v0.2.0:**

```
Cycle v0.2.0: 3 PRs land (#1, #5, #12). Phase flips to done. introduced
unset before release-script. Release script: detect first-done → render
Initial Release block. Range = first-PR (= parent of #1's commit) → HEAD.
```

`docs/features/foo.md` after v0.2.0:

```markdown
## Changelog

### Initial Release (v0.2.0)

#### Summary

<LLM-polished prose covering PRs #1, #5, #12 — full first-ship scope>

#### PRs

- #12: <title> ([link](.../pull/12))
- #5: <title> ([link](.../pull/5))
- #1: <title> ([link](.../pull/1))
```

(No separate `### 0.2.0` block.)

**Example B — feature `bar` in-progress across v0.2.0 + v0.3.0, ships at v0.4.0:**

```
Cycle v0.2.0: 3 PRs (#1, #5, #12), phase: in-progress.
  Release script: render `### 0.2.0 (in-progress)` block.
Cycle v0.3.0: 2 PRs (#15, #18), still phase: in-progress.
  Release script: render `### 0.3.0 (in-progress)` block (prepended).
Cycle v0.4.0: 1 PR (#22), phase flips to done. introduced unset.
  Release script: first-done → render `### Initial Release (v0.4.0)` block.
  Range = parent-of-#1 → HEAD (6 PRs cumulative).
```

`docs/features/bar.md` after v0.4.0:

```markdown
## Changelog

### Initial Release (v0.4.0)

#### Summary

<cumulative prose for all 6 PRs>

#### PRs

- #22: <title>
- #18: <title>
- #15: <title>
- #12: <title>
- #5: <title>
- #1: <title>

### 0.3.0 (in-progress)

#### Summary

<prose for PRs #15, #18 — the cycle's incremental work>

#### PRs

- #18: <title>
- #15: <title>

### 0.2.0 (in-progress)

#### Summary

<prose for PRs #1, #5, #12>

#### PRs

- #12: <title>
- #5: <title>
- #1: <title>
```

(In-progress blocks below Initial Release are historical incremental snapshots. Initial Release is the consolidated first-ship view.)

**Example C — feature `baz` shipped at v0.2.0, enhanced via attach at v0.4.0 + v0.5.0:**

```
Cycle v0.2.0: 3 PRs, phase: in-progress → done (operator commits flip).
  Release script: detect first-done → render Initial Release (v0.2.0).
  fillMarkers: introduced=0.2.0.
Cycle v0.3.0: no PRs touch slug. No block.
Cycle v0.4.0: /gate full-attach (phase reverts to in-progress on worktree).
  2 PRs (#150, #155). Worktree finishes (NO restore commit).
  PR squash-merges to main: phase=in-progress on main.
  Release script: step 3 reads phase=in-progress → render `### 0.4.0 (in-progress)`.
  fillMarkers: introduced already=0.2.0 + phase=in-progress
                    → auto-flip phase to done, set updated=0.4.0.
Cycle v0.5.0: same flow as v0.4.0. /gate specs-only-attach.
  2 PRs (#210, #211). No restore commit. Squash to main: phase=in-progress.
  Release: render `### 0.5.0 (in-progress)`. Auto-flip → done, updated=0.5.0.
```

`docs/features/baz.md` after v0.5.0:

```markdown
## Changelog

### 0.5.0 (in-progress)

#### Summary

<prose for #210, #211>

#### PRs

- #211: <title>
- #210: <title>

### 0.4.0 (in-progress)

#### Summary

<prose for #150, #155>

#### PRs

- #155: <title>
- #150: <title>

### Initial Release (v0.2.0)

#### Summary

<prose for #1, #5, #12 — first-ship cumulative>

#### PRs

- #12: <title>
- #5: <title>
- #1: <title>
```

Newest-first ordering throughout. Initial Release lands at its chronological position (oldest, bottom). Enhancement cycles render with `(in-progress)` label — a permanent historical signal that the block originated from an attach-session revert. Maintenance updates on a done FD without an attach session would render without the `(in-progress)` suffix; the distinction is visible in the FD body forever.

## §2 PR Extraction

### 2.1 Data source

Reuse the existing `Commit.prNumber` field populated by `readCommitsSince` in `release-commits.ts:133-162`. Extraction rules already implemented:

```typescript
const PR_IN_SUBJECT_RE = /\(#(\d+)\)\s*$/;
const PR_TRAILER_RE = /^PR-#:\s*(\d+)\s*$/m;
```

`gh pr merge --auto --squash` appends `(#N)` to the squash commit's subject (validated by `pr-flow.ts` tests in the parent FD). So commits landed via PR-flow carry the PR ref in the subject. The `PR-#:` trailer remains a backup path for any manual override commits.

**No GitHub API calls.** `gh pr view` is NOT invoked. The PR title used in `#### PRs` bullets is the squash-commit subject MINUS the `(#N)` suffix. The repo URL is read from `git config remote.origin.url` (canonicalize SSH to HTTPS).

### 2.2 Filter rules

Per `release-fd-changelog.ts:14`:

```typescript
const NOISE_TYPES = new Set(['chore', 'docs', 'test', 'style', 'ci', 'build']);
```

`#### PRs` applies the SAME filter as `#### Summary` (drop noise types). This keeps the two sub-sections coherent. If a commit is filtered out of Summary, its PR is filtered out of `#### PRs`.

### 2.3 Bullet rendering

`FeatureCommit` (from `release-fd-commits.ts`) does NOT carry a `prNumber` field — only the global `Commit` type from `release-commits.ts` does. The FD-level pipeline uses `commitsForFeature` returning `FeatureCommit[]`, so the PR ref must be re-parsed from `subject` at render time (rather than reusing `Commit.prNumber`). See §4.4 for the actual implementation.

Conceptual shape of the per-bullet render:

```typescript
function renderPrBulletFromSubject(subject: string, repoUrl: string): string | null {
  const m = subject.match(/\(#(\d+)\)\s*$/);
  if (!m) return null;
  const prNumber = Number(m[1]);
  const title = subject.replace(/\s*\(#\d+\)\s*$/, '').trim();
  return `- #${prNumber}: ${title} ([link](${repoUrl}/pull/${prNumber}))`;
}
```

Sort: newest-first (input order from `commitsForFeature` is already newest-first per `git log`). Deduplicate by `prNumber` — multiple commits with the same PR ref (rare; happens with squash + an amend) collapse to one bullet.

Ordering caveat: `commitsForFeature` unions scope-grep results and trailer-grep results through a `Set`, preserving insertion order. Each group is newest-first internally; the two groups are concatenated, not merge-sorted. For post-PR-flow commits (where scope-grep matches the squash subject directly), this is fine — virtually all PR-attached commits land in the scope-grep group. Trailer-only commits are rare in the post-PR-flow world. `findFirstPrCommit`'s `.slice().reverse()` (§4.3) relies on the within-group ordering, not the cross-group merge.

If a commit's subject doesn't match the regex: skip the bullet entirely. The commit still contributes to `#### Summary` (which doesn't care about PR refs).

If NO commit in the range has a PR number: omit the `#### PRs` sub-heading and its (empty) bullet list. Block is then just `### <X>` + `#### Summary`.

## §3 Phase-Revert State Machine

The mechanism is asymmetric: `/gate` writes the `done → in-progress` revert at session start, but the `in-progress → done` restore is centralized in `release-markers.ts` (the release script) instead of in `finishing-a-development-branch`. This is forced by squash-merge semantics — see §3.5 for the rationale.

### 3.1 Revert trigger — `/gate` session start

The gate skill's `full-attach` and `specs-only-attach` paths (§2 of `.claude/skills/gate/SKILL.md`) prompt for the parent FD slug. After validating the parent FD exists and creating the worktree, the gate skill performs (from inside the worktree):

```typescript
const fdPath = `docs/features/${parentSlug}.md`;
const parsed = matter(await readFile(fdPath, 'utf8'));
if (parsed.data.phase === 'done') {
  parsed.data.phase = 'in-progress';
  await writeFile(fdPath, matter.stringify(parsed.content, parsed.data), 'utf8');
}
```

This edit is committed in the scaffolding commit on the worktree branch. The commit subject: `chore(<scope>:<parent-slug>): revert phase done → in-progress for attach session`. Scope: matches the parent FD's `area` or category.

**No-op cases:**

- Parent FD is already `phase: in-progress` (fresh-development FD that hasn't shipped yet — the attach session is a continuation, not an enhancement). No revert commit. Session proceeds normally.
- Parent FD is `phase: proposed` (shouldn't happen but guard against it). No revert; emit a warning that proposed FDs shouldn't have attach sessions.

### 3.2 No restore commit on worktree

The worktree branch does NOT contain a counter-restore commit (`in-progress → done`). The restore is handled by the release script (§3.3). This is deliberate: a revert+restore pair in the same worktree squashes to zero net change on main (see §3.5).

The PR squashes the revert + enhancement work into one commit on main. main's FD shows `phase: in-progress` after the merge — exactly the state the release script needs to read at step 3 (changelog generation) to render the `### <X> (in-progress)` block.

### 3.3 Auto-restore — `release-markers.ts`

`fillMarkers` (current implementation in `release-markers.ts:25-48`) has an early-return guard:

```typescript
if (data.phase !== 'done') {
  return md;
}
```

This guard MUST be relaxed for the auto-restore branch to be reachable. Replace with phase-aware branching that covers all four mutually-exclusive cases. Branches are exhaustive over the (phase, introduced) × hasChangelogBlock cross-product:

```typescript
export function fillMarkers(md: string, opts: FillOptions): string {
  const parsed = matter(md);
  const data = parsed.data as Record<string, unknown>;
  let changed = false;

  if (data.phase === 'done' && data.introduced === undefined) {
    // First-done. Set introduced. No phase flip (already done).
    data.introduced = opts.newVersion;
    changed = true;
  } else if (
    data.phase === 'in-progress' &&
    data.introduced !== undefined &&
    opts.hasChangelogBlock
  ) {
    // Enhancement cycle on a previously-shipped FD. Auto-restore to done +
    // set updated. The `### <X> (in-progress)` block was already rendered
    // by step 3 — its heading suffix is frozen as the historical signal.
    data.phase = 'done';
    data.updated = opts.newVersion;
    changed = true;
  } else if (
    data.phase === 'done' &&
    data.introduced !== undefined &&
    data.introduced !== opts.newVersion &&
    opts.hasChangelogBlock
  ) {
    // Maintenance update on done FD that wasn't reverted (direct edit
    // without attach session). Set updated; phase already done. The
    // rendered block has no `(in-progress)` suffix. The
    // `introduced !== newVersion` guard preserves the original
    // `fillMarkers` behavior — prevents a release-replay from writing
    // `updated: <newVersion>` when `introduced` already equals it.
    data.updated = opts.newVersion;
    changed = true;
  }
  // else: phase=in-progress + introduced=undefined → fresh in-progress FD.
  //       No markers set; operator must commit phase: done explicitly to ship.
  //       The in-progress block stays in the FD body for incremental visibility.

  if (!changed) return md;
  return matter.stringify(parsed.content.replace(/^\n/, ''), data);
}
```

`fillAllMarkers` (the orchestrator) currently receives `changelogSlugs: Set<string>`. The new logic still uses a Set membership check (`opts.hasChangelogBlock = changelogSlugs.has(slug)`) — no signature change required for the caller. The Map-vs-Set choice is purely internal.

**Key distinguisher:** `introduced` already set + phase in-progress = enhancement-cycle restore case. The auto-flip happens AFTER step 3 has already rendered the `### <X> (in-progress)` block. Block heading is permanent (historical), but frontmatter ends the release at `phase: done`.

### 3.4 Edge cases

- **Two concurrent attach sessions on same parent.** Both worktrees write identical revert commits (because both branched from main when phase was done). When the first PR merges, main becomes phase: in-progress. The second PR's revert commit is a no-op edit (no diff) — git will likely auto-resolve as clean merge. If a conflict occurs, the operator resolves manually. No coordination logic needed.
- **Attach session abandoned before PR merge.** No commits land on main. Phase on main stays `done`. Correct outcome — abandoned work shouldn't change FD state.
- **Attach session on phase: in-progress parent.** §3.1's no-op rule applies. No revert commit. Work proceeds. Release script renders the FD's normal in-progress block (§1.3) and does NOT auto-restore (since `introduced` is unset, per §3.3's branch).
- **Phase manually edited.** Operator commits a phase flip outside of gate/release flows. The release script reads whatever it finds at render time; no enforcement that gate is the only writer.

### 3.5 Why not restore on worktree finish?

The intuitive design (gate writes revert; finishing-a-development-branch writes restore) BREAKS under squash-merge. Walkthrough:

```
worktree branch commits (chronological):
  c1: chore(scope:parent): revert phase done → in-progress  ← gate scaffolding
  c2: feat(scope:enh): add bar                              ← enhancement work
  c3: chore(scope:parent): restore phase in-progress → done ← finish-step
```

`gh pr merge --squash` squashes c1+c2+c3 into a single commit on main, equal to the diff between main's tip-before-merge and the worktree branch's tip. The phase frontmatter in worktree-tip is `done` (because c3 restored it); the phase frontmatter in main-before-merge is `done` (untouched since worktree was created). Net diff: zero phase change. main's FD shows `done` continuously across the merge; the `(in-progress)` interval is invisible.

With the asymmetric model (§3.1 + §3.3, no c3): worktree-tip ends at `phase: in-progress`. Squash to main: net diff includes the phase change. main reflects in-progress until the next `pnpm release` auto-restores. Window when main shows in-progress: post-PR-merge → pre-release-run, typically minutes to hours.

Alternative considered: rebase-merge instead of squash, preserving the c1/c2/c3 sequence on main. Rejected because the parent FD's PR flow already mandates `gh pr merge --auto --squash` (per pr-flow.md §1.1) — switching merge strategies per-PR adds branching complexity and weakens the "1 PR = 1 commit on main" invariant.

**Known failure mode under operator override.** If an operator forces a `--rebase` or `--merge` strategy for an attach-session PR (against framework policy), the asymmetric model degrades silently: c1 (revert) and c3 (if accidentally written) would both reach main, c3 cancels c1, main ends at `phase: done`, the `(in-progress)` block never renders. The undetected risk is acceptable because the framework policy is enforced upstream (pr-flow.md prescribes `--squash`); no guard inside `release-fd-changelog.ts` is warranted.

### 3.6 State diagram

```
FD lifecycle, asymmetric phase-revert:

   proposed
      │
      ▼ (initial creation via /new-feature or /promote)
   in-progress  ←──────────────────────┐
      │                                 │
      │ (operator commits               │ (auto-restore by
      │  phase: done explicitly)        │  release-markers when
      │                                 │  introduced is already
      ▼                                 │  set — enhancement case)
    done ─── /gate attach ────────────► in-progress
      │     (revert commit on           │
      │      worktree branch)           │ (enhancement work,
      │                                 │  squash-merge to main)
      │
      └─── (FD stays done across cycles with no attach activity)
```

The done ↔ in-progress edge is bidirectional only when introduced is already set. The first done flip is one-way and operator-driven (operator commits `phase: done`; release detects first-done and sets `introduced`; no auto-revert). Auto-restore by release-markers fires only when `introduced` is already set AND the cycle had a changelog block — i.e., the enhancement-cycle case.

## §4 Release Script Changes

### 4.1 `release-fd-changelog.ts` modifications

Current behavior (line 94): `if (parsed.data.phase !== 'done') continue;`. This single line gates the entire FD-level changelog generation.

Replace with a phase-aware branch:

```typescript
const fm = FeatureFrontmatterSchema.parse(parsed.data);
const phase = fm.phase; // 'in-progress' | 'done' | 'proposed' (skip 'proposed')
if (phase === 'proposed') continue;

const commits = await commitsForFeature(slug, input.previousTag, input.toRef ?? 'HEAD', input.cwd);

const isFirstDone = phase === 'done' && fm.introduced === undefined;
const block = isFirstDone
  ? await renderInitialReleaseBlock({
      cwd: input.cwd,
      slug,
      version: input.newVersion,
      polish: input.polish,
      offline: input.offline,
      repoUrl: input.repoUrl,
    })
  : await renderPerReleaseBlock({
      version: input.newVersion,
      phase,
      commits,
      repoUrl: input.repoUrl,
      polish: input.polish,
      offline: input.offline,
    });

if (!block) continue;

const newBody = prependChangelogBlock(parsed.content, block);
await writeFile(path, matter.stringify(newBody.replace(/^\n/, ''), parsed.data), 'utf8');
result.set(slug, block);
```

### 4.2 `renderPerReleaseBlock`

Refactor of today's `renderChangelogBlock` (line 38-51). Signature change to accept `phase` and `repoUrl`:

```typescript
interface RenderPerReleaseBlockInput {
  version: string;
  phase: 'in-progress' | 'done';
  commits: FeatureCommit[];
  repoUrl: string;
  polish?: PolishRunner;
  offline?: boolean;
}

export async function renderPerReleaseBlock(
  input: RenderPerReleaseBlockInput,
): Promise<string | null> {
  const visible = input.commits.filter((c) => !NOISE_TYPES.has(stripBang(c.type)));
  if (visible.length === 0) return null;

  const summary = await polishSummary(visible, {
    offline: input.offline,
    runner: input.polish,
  });
  const summaryText = summary.trim().length > 0 ? summary.trim() : EMPTY_SUMMARY_PLACEHOLDER;

  const heading =
    input.phase === 'in-progress' ? `### ${input.version} (in-progress)` : `### ${input.version}`;
  const lines: string[] = [heading, '', '#### Summary', '', summaryText];

  const prBullets = renderPrBullets(visible, input.repoUrl);
  if (prBullets.length > 0) {
    lines.push('', '#### PRs', '', ...prBullets);
  }

  return lines.join('\n');
}
```

### 4.3 `renderInitialReleaseBlock`

New function. Determines inception range, walks commits, renders block:

```typescript
interface RenderInitialReleaseBlockInput {
  cwd: string;
  slug: string;
  version: string; // newVersion (= introduced once set)
  repoUrl: string;
  polish?: PolishRunner;
  offline?: boolean;
}

export async function renderInitialReleaseBlock(
  input: RenderInitialReleaseBlockInput,
): Promise<string | null> {
  const inception = await findFirstPrCommit(input.slug, input.cwd);
  const fromRef = inception ? `${inception}^` : '';
  const commits = await commitsForFeature(input.slug, fromRef, 'HEAD', input.cwd);
  const visible = commits.filter((c) => !NOISE_TYPES.has(stripBang(c.type)));
  if (visible.length === 0) return null;

  const summary = await polishSummary(visible, {
    offline: input.offline,
    runner: input.polish,
  });
  const summaryText = summary.trim().length > 0 ? summary.trim() : EMPTY_SUMMARY_PLACEHOLDER;

  const lines: string[] = [
    `### Initial Release (v${input.version})`,
    '',
    '#### Summary',
    '',
    summaryText,
  ];

  const prBullets = renderPrBullets(visible, input.repoUrl);
  if (prBullets.length > 0) {
    lines.push('', '#### PRs', '', ...prBullets);
  }

  return lines.join('\n');
}

async function findFirstPrCommit(slug: string, cwd: string): Promise<string | null> {
  // Walk all-time slug-matching commits in reverse-chronological order (oldest first).
  // Return the first one whose subject carries a PR ref.
  const commits = await commitsForFeature(slug, '', 'HEAD', cwd);
  const reversed = commits.slice().reverse(); // oldest first
  for (const c of reversed) {
    if (c.subject.match(/\(#\d+\)\s*$/)) {
      return c.sha;
    }
    // Trailer-only PRs would need a body fetch; skipped for simplicity since
    // subject `(#N)` is the canonical PR-flow output.
  }
  return null;
}
```

**No-PR fallback** (per Q10 decision): if `findFirstPrCommit` returns `null` (entirely pre-PR-flow FD), the Initial Release block omits `#### PRs` and the Summary range falls back to the earliest commit (`fromRef = ''`). The 2 currently-in-progress FDs at the time of this spec are the relevant cases — both will land their post-bootstrap PRs and `findFirstPrCommit` will resolve normally when they ship.

### 4.4 `renderPrBullets` helper

```typescript
function renderPrBullets(commits: FeatureCommit[], repoUrl: string): string[] {
  const seen = new Set<number>();
  const bullets: string[] = [];
  for (const c of commits) {
    const prMatch = c.subject.match(/\(#(\d+)\)\s*$/);
    if (!prMatch) continue;
    const prNumber = Number(prMatch[1]);
    if (seen.has(prNumber)) continue;
    seen.add(prNumber);
    const title = c.subject.replace(/\s*\(#\d+\)\s*$/, '').trim();
    bullets.push(`- #${prNumber}: ${title} ([link](${repoUrl}/pull/${prNumber}))`);
  }
  return bullets;
}
```

`commits` is already newest-first (from `git log`), so `bullets` is naturally newest-first too.

### 4.5 Release-script ordering

Today's `pnpm release` step ordering (from `versioning.md:73-96`):

1. Preconditions (build, validate, CR gate).
2. Derive new version.
3. **Generate per-FD changelogs.** ← This is where `release-fd-changelog.ts` runs.
4. Set release markers (`introduced`, `updated`).
5. Bump package.json.
6. Write `CHANGELOG.md`.
7. Write `docs/release-notes.md`.
8. Commit + tag.
9. Push + GitHub Release.

Step 3 still runs at the same position. Step 4 reads the FD's `phase` AFTER step 3 has prepended the block. The change: step 3 now does a 2-way branch on whether the FD is first-done (renders `### Initial Release`) vs not (renders `### <X>` with phase-aware suffix).

For this to work, step 3 needs to read `introduced` BEFORE step 4 writes it. That's already the case — step 3 reads it freshly per FD before doing any work. No reorder needed.

## §5 Release-Notes Interaction

`docs/release-notes.md` rendering (`release-notes.ts`):

- **`introduced` features:** uses FD's `## Summary` paragraph (unchanged).
- **`updated` features:** extracts `#### Summary` from the per-release changelog block returned by `generateFdChangelogs` (unchanged).

The new `### Initial Release` block IS the changelog block returned to release-notes for the first-done version. `extractChangelogSummary` (line 99 of `release-notes.ts`) reads the block looking for `#### Summary`. Since the Initial Release block contains a `#### Summary` sub-section, the extraction works identically.

**Behavior:** when an FD's `phase` flips to `done` in the same cycle that introduces it, `release-notes.md`'s entry uses the FD's `## Summary` paragraph (because `kind === 'introduced'`, not `updated`). The Initial Release block's `#### Summary` is NOT pulled. This matches today's semantics — first-ship release notes are author-curated FD-body prose, not LLM-polished commit summaries.

Implication: the Initial Release block's `#### Summary` is consumed by readers BROWSING the FD body, not by automated release-notes rendering. Its purpose is the FD's own historical record.

## §6 Affected Files

### 6.1 Created

- `scripts/release/__tests__/release-fd-changelog-initial-release.test.ts` — unit tests for the new Initial Release path.
- `scripts/release/release-pr-bullets.ts` — extracted module for `renderPrBullets` (pure helper, shared by `renderPerReleaseBlock` and `renderInitialReleaseBlock`).
- `scripts/release/release-find-first-pr-commit.ts` — extracted module for `findFirstPrCommit` (inception detector).
- `scripts/release/__tests__/release-pr-bullets.test.ts` — unit tests for `renderPrBullets` (PR extraction, dedup, ordering, no-PR fallback).
- `scripts/release/__tests__/release-find-first-pr-commit.test.ts` — unit tests for `findFirstPrCommit` (oldest PR commit lookup, null fallbacks).
- `scripts/release/__tests__/release-fd-changelog-in-progress.test.ts` — unit tests for in-progress phase rendering (label suffix, when-to-render).
- `scripts/noldor/__tests__/phase-revert.test.ts` — unit tests for the `done → in-progress` state-edit function (the gate-side revert).
- `scripts/noldor/phase-revert.ts` — single pure function `revertPhaseForAttach(fdPath)`. The restore side lives in `release-markers.ts` (not a separate module) because the auto-restore is part of the existing release-pipeline lifecycle responsibilities.

### 6.2 Modified

- `scripts/release/release-fd-changelog.ts` — replace `renderChangelogBlock` with `renderPerReleaseBlock` + `renderInitialReleaseBlock` + `renderPrBullets`. Update `generateFdChangelogs` to branch on `phase` and `introduced`. Drop the `phase === 'done'` gate.
- `scripts/release/release-markers.ts` — extend `fillMarkers` with the auto-restore branch (phase=in-progress + introduced set + changelog block this release → flip phase to done, set updated).
- `scripts/release/release-fd-commits.ts` — no changes (existing `commitsForFeature` already handles the wider range needed; passing `fromRef = ''` for repo-start is already supported per the function's docstring at line 84-86).
- `.claude/skills/gate/SKILL.md` — add a step to `full-attach` / `specs-only-attach` paths (Step 2 scaffolding): invoke `revertPhaseForAttach(<parent-fd-path>)`. Update the docstring for both paths to mention the revert side effect AND the asymmetric restore (no commit on worktree branch; release-markers handles it).
- `docs/noldor/versioning.md` — update step 3 description to reflect phase-aware rendering + Initial Release semantics. Update step 4 (release markers) to describe the new auto-restore branch. Add subsection on in-progress block rendering + the asymmetric phase-revert model.
- `docs/noldor/lifecycle.md` — add the done → in-progress (attach-revert) transition AND the in-progress → done (release-auto-restore) transition to the phase state diagram + table.
- `docs/noldor/pr-flow.md` — add cross-reference: "Each merged PR contributes a `#### PRs` bullet to its FD's `## Changelog` next release cycle. See [`versioning.md`](versioning.md). Attach-session PRs additionally carry a phase-revert commit; release-markers auto-restores on the next release."
- `docs/features/framework-pr-flow-agent-auto-merge.md` — update Usage section to describe phase-revert on attach sessions.

### 6.3 Untouched

- `scripts/release/release-changelog.ts` — global CHANGELOG.md already PR-aware.
- `scripts/release/release-notes.ts` — pulls FD `## Summary` for introduced, `#### Summary` from changelog block for updated. Both paths unaffected.

## §7 Testing

### 7.1 Unit — `renderPerReleaseBlock`

- **Renders in-progress label.** Phase `in-progress`, 2 visible commits with PR refs → block heading is `### 0.5.0 (in-progress)`; `#### PRs` lists both.
- **Renders done unlabeled.** Phase `done`, 1 visible commit → `### 0.5.0` (no suffix); single `#### PRs` bullet.
- **Skips noise types.** Phase `done`, 3 commits where 2 are `chore` → block has 1 PR bullet, Summary covers 1 commit.
- **Omits empty `#### PRs`.** Phase `done`, 1 commit without PR ref → block has Summary only, no `#### PRs` heading.
- **Returns null for empty range.** No visible commits → null (caller skips FD).

### 7.2 Unit — `renderInitialReleaseBlock`

- **Heading format.** Renders `### Initial Release (v0.2.0)` ((not `### 0.2.0`)).
- **Cumulative range.** Mock 5 slug-matching commits across 3 prior tags, all with PR refs → block lists all 5 PRs.
- **Inception extraction.** Mock commits where #1 is the oldest with PR ref `(#1)` and a yet-older commit lacks a PR ref → inception is #1's commit; the older no-PR commit is absent from BOTH `#### PRs` AND `#### Summary` (the gap is accepted per Q10).
- **No-PR fallback.** Mock FD with only pre-PR-flow commits (zero PR refs) → `#### PRs` omitted; Summary range falls back to repo-start (`fromRef = ''`) and covers all commits. This is the only fallback path that includes pre-PR-flow commits in Summary.
- **Returns null for FD with no commits.** Newly created FD with phase=done but no slug-matching commits → null. Caller skips writing a block; `fillMarkers` still sets `introduced=newVersion` based on phase, so the FD ends with `introduced` set but no `### Initial Release` block in body. Documented corner case in §1.2.

### 7.3 Unit — `renderPrBullets`

- **Extracts PR from subject.** Commits with subjects ending in `(#42)` → bullet with `#42`.
- **Extracts via trailer.** Commit with `PR-#: 99` trailer → bullet with `#99`. (Validates parity with `release-commits.ts` extraction.)
- **Dedups by PR number.** Two commits same PR ref → one bullet.
- **Strips suffix from title.** Subject `feat(scripts:foo): add bar (#42)` → bullet text `feat(scripts:foo): add bar`.
- **Skips commits without PR ref.** No `(#N)` → omit bullet.
- **Newest-first preserved.** Input newest-first → output newest-first.

### 7.4 Unit — `phase-revert.ts`

- **`revertPhaseForAttach`** flips `phase: done` → `phase: in-progress`.
- **No-op on `phase: in-progress`** (fresh in-progress parent — attach session is a continuation, not an enhancement).
- **No-op on `phase: proposed`** (guard + warning).
- **Preserves frontmatter ordering** (uses `matter.stringify` which preserves key order).

### 7.5 Unit — `release-markers.ts` auto-restore

- **Enhancement-cycle auto-restore.** FD has phase=in-progress, introduced=0.2.0, has changelog block in this release (newVersion=0.4.0) → fillMarkers flips phase to done, sets updated=0.4.0.
- **Fresh in-progress NOT auto-restored.** FD has phase=in-progress, introduced=undefined, has changelog block → no phase flip, no introduced/updated set (operator must commit phase: done explicitly to ship).
- **First-done unchanged.** FD has phase=done, introduced=undefined, has changelog block → fillMarkers sets introduced=newVersion (existing behavior preserved).
- **Maintenance update unchanged.** FD has phase=done, introduced=0.2.0, has changelog block (operator made a direct edit, no attach revert) → sets updated=newVersion (existing behavior preserved).
- **Done FD without block.** FD has phase=done, introduced=0.2.0, NO changelog block in this release → fillMarkers writes nothing (existing behavior preserved).

### 7.6 Integration

- **End-to-end first-done.** Fake repo with 3 slug-matching commits across 2 tags, run `generateFdChangelogs` + `fillMarkers` → FD body has `### Initial Release (v0.2.0)` block, frontmatter has phase=done + introduced=0.2.0. No `### 0.2.0` block.
- **End-to-end in-progress.** Fake repo with 2 slug-matching commits since previous tag, FD phase=in-progress, introduced=undefined → block heading is `### 0.2.0 (in-progress)`, frontmatter unchanged (no auto-flip).
- **End-to-end enhancement cycle.** Fake repo where FD is done at v0.2.0 (existing block in body), simulate attach revert (gate-side: write phase=in-progress on worktree branch). Land 2 PRs. Merge to main (simulated). Release runs at v0.3.0 → FD body has new `### 0.3.0 (in-progress)` block above Initial Release block; frontmatter has phase=done + updated=0.3.0 (auto-restored).
- **No restore commit on worktree.** Trace the worktree branch's commit log: scaffolding revert commit only; no later restore commit. The squash to main carries phase=in-progress.

### 7.7 Manual dogfood

- Take the framework-pr-flow-agent-auto-merge FD (currently `phase: in-progress`). Once the bootstrap activation backlog entry lands and a PR-flow merge happens for any slug-matching enhancement: run a dry release. Confirm a `### <N> (in-progress)` block appears in the FD body.
- When the framework-pr-flow FD eventually flips to `done`: confirm `### Initial Release (v<X>)` block appears (range covers all post-bootstrap PRs; pre-bootstrap commits in Summary but not `#### PRs`).
- Smoke-test enhancement-cycle auto-restore: create a temp `done`-phase FD with `introduced` set, manually edit its phase to `in-progress` (simulating a merged attach revert), add a slug-matching commit, run a dry release. Confirm the FD ends with `phase: done` + `updated` set + a `### <X> (in-progress)`-labeled block.

## §8 Open Questions

1. **`introduced` detection robustness.** Both the first-done detection (§4.1) and the auto-restore branch (§3.3) rely on reading `introduced` BEFORE `fillMarkers` writes it. The pipeline ordering — step 3 (changelog gen) reads introduced, step 4 (markers) writes introduced — must be preserved. Mitigation: assert the order in a test that ties the two steps together.
2. **Trailer-only PR extraction.** `findFirstPrCommit` (§4.3) only scans subject `(#N)` suffix; not `PR-#:` trailer. Could yield a different "first PR" if early PRs only had trailer-style refs. Pragmatically, `gh pr merge --squash` always writes the subject suffix, so trailer-only is hypothetical. Document as a known limitation; expand if it ever bites.
3. **Phase-revert lag window on main.** Between the attach PR squash-merging and the next `pnpm release` running, main's FD shows `phase: in-progress` even though no active work is in flight (the worktree is gone). Dashboards that key off `phase` see this as "active development." Mitigation options for a future refactor: a `noldor:reconcile-phase` script that auto-flips dormant in-progress FDs to done; a dashboard filter that distinguishes "in-progress with active worktree" from "in-progress awaiting release." Out of scope for this spec.
4. **Maintenance edits without revert.** If an operator commits a `<pkg>:<slug>` change directly to main (bypassing attach session) — say, a release-time docs typo fix — phase stays done. Release script renders `### <X>` block (no label). The (in-progress) label is the differentiator for attach-originated work; bare edits remain unlabeled. This is the intended distinction, but worth documenting explicitly so reviewers understand why labels diverge.

## §9 Out of Scope (folded to follow-up roadmap)

- **Migration script for the 2 currently-in-progress FDs.** They'll naturally pick up the new format on next release (no script needed). Add to the roadmap if any pre-release validation surfaces a gap.
- **`Noldor-Reviewed-PR-Driven` audit detector.** A `/garden` detector that verifies all post-PR-flow-bootstrap commits with `<pkg>:<slug>` scope carry a PR ref. Out-of-scope here; tracked as a follow-up backlog entry.
- **`pnpm noldor:backfill-fd-changelogs` opt-in command.** Per Q4 (forward-only). If operator demand emerges, add as a separate FD.
- **Visual indicator in dashboard for in-progress vs done blocks.** The `dashboard-wip-age-page` (existing FD) could surface phase-revert status; design decision deferred until dashboard regains priority.
