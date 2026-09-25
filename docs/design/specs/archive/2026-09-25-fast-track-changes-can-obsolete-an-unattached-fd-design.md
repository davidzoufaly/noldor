# Fast-Track Changes Can Obsolete an Unattached FD — Design

**Slug:** fast-track-changes-can-obsolete-an-unattached-fd
**FD:** docs/features/fast-track-changes-can-obsolete-an-unattached-fd.md
**Date:** 2026-09-25
**Tier:** specs-only
**Entry:** Q-0233

## Problem

A fast-track ships code without touching any feature MD. Gate Step 4 refreshes an FD's User Story and Usage only on FD-carrying paths; for `fast-track` the step reads "skip (no FD)", and drain mode skips the same seam. Fast-tracks are not rare: 296 of the 614 first-parent commits on `main` carry `Noldor-Path: fast-track`.

Nothing records that a fast-track changed an FD's code. An FD "records" a commit through `commitsForFeature()` in `src/release/release-fd-commits.ts`: the subject scope names it (`feat(features:<slug>):`) or the body carries `Noldor-FD: <slug>`. A fast-track subject is `fix(<area>):`, and its `Noldor-FD` line, when it has one, names the roadmap entry it retired, which has no FD. So the FD's `## PRs` list, its changelog, and every reader of the FD see nothing.

Ownership is broad. 439 files sit in some FD's `links.code`, 98 of them in more than one (`src/cli/manifest.ts` in 14). Each of the last 40 fast-tracks changed at least one owned file; the files one fast-track changed had between 1 and 29 owning FDs, 4 at the median. Those 40 merged over two days (2026-09-24 and 25) and between them touched code owned by 67 of the 95 done FDs. So "a fast-track touched a file this FD owns" cannot be the staleness signal on its own: it would name most done FDs after two days of drains. The one party that knows whether a change alters what an FD documents is the change's author, at ship time.

The existing detectors check shape, not truth. `fd-link-rot` stats link targets, `fd-command-rot` checks that cited commands exist, `code-links-drift` compares `links.code` with the `// @fd:` tags, and Detector 15 (`detectSourceDrift` in `src/garden/garden-detect.ts`) dates Noldor pages against their sources. None asks whether a done FD's Usage still describes code that changed under it.

## Goals

- At ship time, a fast-track sees which done FDs own the code it changed, and updates the Usage of any whose documented behaviour it altered, in the same PR.
- The fast-track records that it looked: a `Noldor-Doc-Impact:` line naming the FDs it updated, or `none`.
- `garden detect` names each FD whose owned code changed under a fast-track that recorded nothing — the gaps, not the whole corpus.
- One owner lookup serves both halves, so the seam and the detector cannot disagree about who owns a file.

## Non-goals

- FD-carrying sessions (`specs-only-*`, `full-*`) that touch files another FD owns. The same staleness risk, but a different seam.
- Making a fast-track show up in an FD's `## PRs` list or changelog. That changes release attribution in `commitsForFeature()`.
- Judging whether a Usage section is true. No model-driven check in garden; the detector checks that a declaration exists, not that it is right.
- Blocking anything. No pre-push or release gate in this change.
- Commits made before a repo first used the declaration.

## Design

UI verdict: skip — no `consumer.uiPaths` configured and no UI surface in the change.
Architecture verdict: skip — no new directory, package or external; the imports it needs (`src/garden` → `src/release`, `src/features` → `src/garden`) already exist.

### Structural context

The detector lands in community c10 beside `src/core/fd-load.ts`, `src/garden/plan-resolution.ts` and the `fd-without-plan` / `malformed-fd` detectors. `src/garden/garden-detect.ts` defines the god node `detectAll()` (rank #8, 32 edges); the change adds one call to it. The owner map lives in `src/garden/graph-fd-lookup.ts` (c31), which `src/features/seed-test-tags.ts` and `propose-pointers.ts` already import, with edges out to `garden-detect.ts`, `sdd-report.ts` (c13) and `fd-load.ts`. `commitsForFeature()` sits in `src/release/release-fd-commits.ts` (c17) with `release-fd-changelog.ts` and `fd-prs-since-tag.ts`, and is reused read-only. The trailer check lands in `src/hooks/noldor-validate-trailer.ts` (c88, beside `src/core/trailers.ts`). The CLI registers in `src/cli/manifest.ts` (c9). `.claude/skills/noldor-gate/SKILL.md` is not in the graph.

### Unit 1 — Owner lookup

A pure function maps a set of changed paths to the FDs that own them: `buildFileToFdsMap()` and `getFdOwnersForFile()` from `src/garden/graph-fd-lookup.ts` (direct match plus ancestor-directory match), over `loadSddFeatures()` from `src/core/fd-load.ts`. Each owner is a **candidate** only when it is `phase: done` and its `## Usage` is written, meaning the section has no `<!-- TODO` stub — the same rule `/noldor-draft-feature-md` keys on; the body is read for that check, since `loadSddFeatures()` returns frontmatter only. An in-progress FD is left to its own session, which refreshes it at its own Step 4; a stub has nothing to go stale. `loadSddFeatures()` skips an FD whose frontmatter does not parse, so the lookup also lists the files it skipped, and a caller must not read a list with skips as complete.

`pnpm noldor features owners --base <ref>` runs it over `git diff --name-only <ref>...HEAD` (default `origin/main`), or over explicit `--path` values. It prints one block per owning FD — slug, candidate or the reason it is not, and the changed files it owns — sorted by owned-file count, so the FDs a change is most about come first; `--json` prints the same data. Zero owners is exit 0 with an empty result. A bad flag, an unresolvable ref, a git failure or an FD it could not parse is exit 2, naming the cause, and never an empty result — `validate features` blocks a malformed FD at pre-commit, so on a healthy branch that last case does not arise. Hub files such as `src/cli/manifest.ts` get no special treatment: the sort already puts their many incidental owners last, and judging one of those is a quick read of a Usage section the change never mentions.

### Unit 2 — Doc-impact seam at fast-track Step 4

Gate Step 4 gains a bullet for `fast-track`, before the push-gate preflight, in both the interactive flow and the drain overrides (`.claude/skills/noldor-gate/SKILL.md` and its runner-neutral twin `docs/noldor/drain-mode.md`):

1. Run `pnpm noldor features owners --base origin/main`.
2. For each candidate, judge whether the change alters what its User Story or Usage says. For each that it does, update the FD — `/noldor-draft-feature-md <slug> --refresh --scope <its owned changed files> --usage-only` (add `--yes` in autonomous or drain mode), the same scoped refresh attach paths run, or a hand edit when the change is one flag or one line.
3. Record the outcome as a trailer: `Noldor-Doc-Impact: <slug>, <slug>` on the commit that updates the FDs (`docs(features:<slug>): …`), or `Noldor-Doc-Impact: none` amended onto the tip commit when no candidate changed. A message-only amend keeps the tree, so no review receipt is lost.

The FD edit is in `origin/main..HEAD`, so the code-stage review sees it with the code. The declaration is made even when there are no candidates at all — one rule with no branch to forget. A later fix commit (a review round, a push-gate repair) that changes documented behaviour updates the FD the same way; the declaration already on the branch stays.

### Unit 3 — The doc-impact trailer

Its value is `none` or a comma-separated list of FD slugs. `src/hooks/noldor-validate-trailer.ts` refuses a value that is neither, or that names a slug with no `docs/features/<slug>.md`. The hook reads the commit being made, whose trailer block is intact. On `main` it is not: after a squash merge the line survives in the squash body but not in its trailer block — GitHub appends `Co-authored-by:` lines after a `---------` separator — so the detector scans body lines, as `commitsForFeature()` does, and never `parseTrailers()`.

### Unit 4 — Garden detector: undeclared doc impact

A new detector in `src/garden/detectors/` walks first-parent history on `HEAD`:

- **Floor.** The oldest first-parent commit whose body carries a `Noldor-Doc-Impact:` line. No such commit, no findings: a repo that never used the declaration is silent, so the detector calibrates itself per repo instead of reading a date.
- **Candidate commits.** Fast-track commits (`Noldor-Path: fast-track` in the body) after the floor with no declaration line.
- **Findings.** For each candidate FD (Unit 1's rule) that owns a file one of those commits changed, keep the commits newer than the FD's latest recorded commit — one `commitsForFeature()` finds, or a first-parent commit whose `Noldor-Doc-Impact:` line names the FD — so any commit the FD records clears everything before it. The second form is how a fast-track's own FD update counts: after the squash its `docs(features:<slug>):` subject sits in the body behind a `* ` bullet, where the scope grep cannot match it. One finding per FD: the slug, the commits, the files.

It rides its own key in `GardenFindings`, like `architectureAdvisories` and `fdDiagramStubs`, and stays out of `FINDING_CATEGORIES` in `src/garden/garden-detect-runner.ts`, so it never blocks the receipt restamp or a release. A git failure is reported as a finding that names it, never as a clean result. An FD the lookup skipped as unparseable is not reported here; `detectMalformedFds()` already names it in the same run.

**Clearing.** A finding clears when the FD records a later commit — the rule above, not a separate mechanism. Updating the FD is one such commit. When the operator reads the FD against the listed commits and it is still right, the commit that says so adds or updates one line under the FD's `## Usage` heading: `<!-- noldor:usage-checked <sha> -->`, where `<sha>` is the newest commit checked. It is committed as `docs(features:<slug>): Usage checked against <sha>`, delivered like any micro-chore. An empty commit would not do: the micro-chore guard refuses a commit with nothing staged (`everyPathMatches()` in `src/core/allowlist.ts` returns `false` for an empty set). The marker is one line per FD, overwritten on the next check rather than appended, and needs no schema or config change; the detector never parses it, because the commit alone clears the finding. The finding's remedy text names both ways out: update the Usage, or add the marker.

### Unit 5 — Docs

`docs/noldor/garden-and-drift.md` gains the detector row, `docs/noldor/script-catalog.md` the `features owners` entry, and `docs/noldor/git-and-commits.md` the trailer; each has a `templates/` twin. The manifest entry regenerates the capability index in `AGENTS.md` (`pnpm noldor docs capability-index --write`). `/noldor-garden` needs no edit: it derives its checklist sections from the keys `garden detect` emits. The gate skill edit, with its `templates/.claude/skills/noldor-gate/SKILL.md` twin, rides this PR under `NOLDOR_ALLOW_SHARED=1`, because `checks shared-files` refuses `.claude/skills/**` from a worktree. A commit that mixes code with `docs/noldor/` pages carries `Noldor-Sibling-Scope`, as `git-and-commits.md` requires.

## Acceptance criteria

- `features owners --base <ref>` lists every FD whose `links.code` owns a file changed in `<ref>...HEAD` (direct or ancestor-directory match) with those files, and marks an FD a candidate only when it is `phase: done` with a written `## Usage`; `--json` emits the same data.
- `features owners` exits 0 with an empty result when nothing is owned, and exits 2 on a bad flag, an unresolvable ref, a git failure or an FD it could not parse.
- The gate's fast-track Step 4, interactive and drain, runs `features owners` before the push-gate preflight and updates the Usage of each candidate whose documented behaviour the change alters, on the same branch.
- Every fast-track branch the gate delivers carries a `Noldor-Doc-Impact:` line: `none`, or the slugs of the FDs it updated.
- The commit-msg hook refuses a `Noldor-Doc-Impact:` value that is neither `none` nor a list of existing FD slugs.
- `garden detect` reports, under its own key, each candidate FD owning a file changed by a first-parent fast-track commit that is at or after the floor, carries no declaration, and is newer than the FD's latest recorded commit; each finding names the FD, the commits and the files.
- A repo with no declaration anywhere in its first-parent history gets no findings from the detector.
- A commit the FD records clears every earlier finding for that FD — one `commitsForFeature()` finds, including a micro-chore commit whose only change is a `<!-- noldor:usage-checked <sha> -->` line under the FD's `## Usage`, or a first-parent commit whose `Noldor-Doc-Impact:` line names the FD.
- The detector never blocks: the garden receipt restamp and release preflight are unaffected by its findings.
- A git failure inside the detector produces a finding that names it, not an empty result.
- `garden-and-drift.md`, `script-catalog.md` and `git-and-commits.md` describe the detector, the command and the trailer, and their `templates/` twins match.

## Risks / trade-offs

- **The declaration is trusted.** A wrong `none` is caught only by review; the detector checks presence, not truth. Accepted: the author holds the context, and the declaration makes the judgment visible to the code-stage reviewer.
- **Hub files make the list long.** A fast-track touching `src/cli/manifest.ts` lists up to 14 owners, and one recent fast-track touched 29. Candidates exclude in-progress FDs and stub Usage, and the list sorts by owned-file count; the cost is reading those FDs' Usage sections.
- **An FD refreshed from a fast-track worktree could collide with a live session on the same FD.** Excluding in-progress FDs removes the common case.
- **`detectAll()` is a god node.** One more call is the registry doing its job.
- **The usage-checked marker is a claim, not a proof.** Like the declaration, it records that someone looked. It is visible in the FD and in the commit, so a reader can see how old the check is.

## User Story

As an operator or drain agent shipping a fast-track, I want the gate to show me which feature docs own the code I changed and to record whether I updated them, so that a fast-track cannot quietly leave a feature doc describing behaviour that no longer exists — and so that garden names the ones that slipped through.

## Usage

- `pnpm noldor features owners --base origin/main [--json]` — the FDs that own this branch's changed files, and which of them are candidates.
- Gate Step 4 on `fast-track` (interactive and drain) runs it, updates the affected FDs' Usage, and records `Noldor-Doc-Impact: <slug>, …` or `Noldor-Doc-Impact: none`.
- `pnpm noldor garden detect` lists undeclared fast-tracks per FD under their own key; `/noldor-garden` shows them in its checklist.
- To clear a finding: update the FD's Usage, or — when it is still right — commit `<!-- noldor:usage-checked <sha> -->` under its `## Usage` heading as `docs(features:<slug>): Usage checked against <sha>` through a micro-chore.

## Open questions (resolved)

1. *Ship-time seam, garden detector, or both?* -> Both, joined by the declaration trailer. The seam alone leaves no trace when skipped; the detector alone has only the "touched an owned file" signal, which names nearly every FD. (D1)
2. *Which owning FDs must the fast-track consider?* -> `phase: done` with a written Usage. An in-progress FD belongs to its own session; a stub cannot go stale. (D2)
3. *Where does the declaration live?* -> A trailer on a branch commit — the FD-update commit, or a message-only amend of the tip for `none` — read from squash bodies line by line. (D3)
4. *What floor keeps the detector quiet on old history?* -> The oldest first-parent commit carrying a declaration: silent until a repo adopts, portable across consumers, no date to configure. (D4)
5. *How does a finding clear?* -> Any later commit the FD records, which is how a refresh already lands. When nothing needed changing, that commit adds or updates a `<!-- noldor:usage-checked <sha> -->` line under `## Usage`: a real one-line edit the micro-chore guard admits, where an empty commit is refused. (D5)
6. *How does the skill edit land from a worktree?* -> In this PR under `NOLDOR_ALLOW_SHARED=1`, so the prose never names a command `main` lacks. (D6)
7. *Is the trailer validated?* -> Yes, at commit-msg: a declaration naming a missing FD is a silent lie. (D7)
8. *Command name?* -> `features owners`: it answers "who owns these paths"; the impact judgment stays with the agent. (D8)
