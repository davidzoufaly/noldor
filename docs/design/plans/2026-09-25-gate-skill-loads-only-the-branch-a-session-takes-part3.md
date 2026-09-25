# Gate Skill Loads Only the Branch a Session Takes Implementation Plan — Part 3: the router and its branch files

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `.claude/skills/noldor-gate/SKILL.md` becomes a 2,701-word router with a load table and `**Read now:**` forks; nine branch files beside it carry the rest; a clean `specs-only-new` run loads 6,395 words (46.7% of the pre-split 13,690); incident history lives in the runbooks; and a test holds all of it.

**Architecture:**
- **Built from the pre-split text, not retyped.** Every file is assembled from line ranges of `.claude/skills/noldor-gate/SKILL.md` at `c7bc4bc` (the tree the spec measured), with list-continuation indentation stripped, then finished by one patch. The patch is the whole editorial change — headers, read-now lines, history removed, wording tightened — so a reviewer reads exactly what moved and what changed. The move ledger below maps every section of the pre-split file to its destination (spec criterion 4).
- **By job, not by path** (spec D1, ADR 0008). A seam several paths share lives in one file.
- **History out, one-line why in.** The stories go to `docs/noldor/cr-pipeline.md`, `pr-flow.md` and a new `gotchas.md` § Gate sessions; three were already homed there, so their tags simply go.
- **Patches.** Every `~~~diff` block applies with `git apply` from the repo root: save it to a file and run `git apply <file>`.

**Tech Stack:** Markdown, Node (assembly), vitest, the `noldor` CLI.

**Parts:** 3 of 4. Part 4 makes the router's links a blocking check.

**Spec:** [`2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md`](../specs/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md) — § Router, Branch files, Load table and read-now forks, Incident history out; acceptance criteria 1–4, 6–7.

---

## File Structure

- `.claude/skills/noldor-gate/{micro-chore,fast-track,attach,artifact-review,blockers,code-review,fd-close,design-writeback,autonomous}.md` + `templates/` twins — **Create.** The branch files.
- `.claude/skills/noldor-gate/SKILL.md` + `templates/` twin — **Modify.** The router.
- `src/checks/__tests__/gate-skill-layout.test.ts` — **Create.** Router budget, load table, clean-run load, no history ids, Resume-path parity.
- `docs/noldor/cr-pipeline.md`, `docs/noldor/pr-flow.md`, `docs/noldor/gotchas.md`, `docs/noldor/complexity-gating.md` + `templates/` twins — **Modify.** Moved history and repointed section links.
- `.noldor/skill-size-baseline.json` — **Modify.** Re-recorded after the split.

## Move ledger

Every section and bullet of the pre-split `SKILL.md` (`git show c7bc4bc:.claude/skills/noldor-gate/SKILL.md`) and where it lives after this part.

| Lines | Content | Destination |
|---|---|---|
| 1–8 | frontmatter, title, purpose | `SKILL.md` |
| 10–17 | Parameters | `SKILL.md` § Parameters (Part 2 text: drain and finish point at the page) |
| 19, 23 | `## Flow`; exit codes through pnpm | `SKILL.md` |
| 21 | drain-mode entry check | `SKILL.md` § Flow, entry check → `docs/noldor/drain-mode.md` |
| 25–51 | Step 0 | `SKILL.md` (26–27 folded into the first line; the Quick win / Bugfix / Milestone pick lines merged; retirement pointers → `fast-track.md` / `micro-chore.md`) |
| 53–59 | Step 1 | `SKILL.md` |
| 61 | Step 2 heading | `SKILL.md` Step 2 (per-path read-now lines) |
| 63 | Input localization | `attach.md` § Scaffold |
| 65–74 | micro-chore scaffold, temp-branch handoff, trade-off | `micro-chore.md` § Scaffold |
| 76 | fast-track scaffold | `fast-track.md` § Scaffold |
| 77, 79 | specs-only-new, full-new scaffolds | `SKILL.md` Step 2 |
| 78, 80 | specs-only-attach, full-attach scaffolds | `attach.md` § Scaffold |
| 82–98 | roadmap-entry retirement | `fast-track.md` § Roadmap-entry retirement |
| 100 | micro-chore retirement variant | `micro-chore.md` § Roadmap-entry retirement (the Step 1 command inlined) |
| 102–121 | phase-revert lifecycle | `attach.md` § Phase-revert lifecycle |
| 122 | `(in-progress)` label trade-off | `fd-close.md` § Flip (stated once) |
| 124 | pointer to a pruned spec | dropped — the spec no longer exists |
| 126–158 | Step 2.5 intro, lint, commit, lanes, reviewer mandate, orchestrate, summary | `artifact-review.md` (link rule and reviewer mandate tightened); `SKILL.md` Step 2.5 pointer |
| 160 | design-approval drift | `design-writeback.md` § Design-approval drift, read from `artifact-review.md` |
| 162–181, 210–212 | specs-only summary, continue dialog, proceed options, abort, cheapest-place line | `artifact-review.md` § Continue dialog |
| 182–208 | address-blockers, auto-fix seam, bounded re-round rule, split-back | `blockers.md` § Spec and plan rounds (the round counts → `cr-pipeline.md` § Round budget) |
| 214, 216–224 | Steps 3 and 3.5 | `SKILL.md` |
| 226 | Step 4 intro | `SKILL.md` Step 4 checklist |
| 228–229, 232 | FD body refresh | `fd-close.md` § Refresh |
| 230 | attach refresh scope | `attach.md` § Parent-FD refresh scope |
| 231, 273 | fast-track / micro-chore skip refresh and flip | `SKILL.md` Step 4 lines 1 and 6 |
| 234–239 | doc-impact check | `fast-track.md` § Doc-impact check |
| 241–251 | archive | `fd-close.md` § Archive |
| 253 | UI baseline write-back | `design-writeback.md` (its tag goes; `gotchas.md` already holds the story) |
| 255–259 | architecture baseline write-back | `design-writeback.md`; the run-the-check line → `SKILL.md` Step 4 line 5 |
| 261–272 | flip | `fd-close.md` § Flip |
| 275 | UI freshness | `SKILL.md` Step 4 line 7 |
| 277–285 | wait for in-flight standalone | `code-review.md` (the history → `cr-pipeline.md` § Review gotchas) |
| 287–299 | push-gate preflight | `code-review.md` (287's history → `pr-flow.md` § Push runbook; 295 dropped — `gotchas.md` already holds it) |
| 301–327 | code-stage orchestrate, fast-track profile, delta re-earn | `code-review.md` (301's tag goes; `cr-pipeline.md` already holds it) |
| 329–335 | aggregate | `code-review.md` (a red one → `blockers.md`) |
| 337–368 | code-stage auto-fix, escalate cr-red and test-red | `blockers.md` § Code-stage rounds |
| 370–381 | context cleanup | `code-review.md` |
| 383 | bootstrap immunity | `fd-close.md`; `SKILL.md` Step 4 line 9 |
| 385 | pr-flow | `SKILL.md` Step 4 line 10 |
| 387 | the old codex retry loop | dropped — `cr-pipeline.md` § Step 4 collapse holds it |
| 389–390, 392 | merged cleanup (worktree paths), `gh pr view` | `SKILL.md` Step 4 line 11 |
| 391 | merged cleanup (micro-chore) | `micro-chore.md` § Merge cleanup |
| 394–416 | Step 5 | `SKILL.md` (414's memory reference and incident → `gotchas.md` § Gate sessions) |
| 418–420 | `--resume mode` | `SKILL.md` |
| 422–436 | `--resume` under drain | `docs/noldor/drain-mode.md` § Resume path (Part 2) |
| 438–469 | autonomous mode | `autonomous.md` |
| 471–590 | drain mode, finish mode | `docs/noldor/drain-mode.md` (Part 2) |

The micro-chore stash rationale in line 69 keeps its why in `micro-chore.md`; the incident behind it → `gotchas.md` § Gate sessions.

---

## Task 6: Move the branches into their own files

**Files:**
- Create: the nine branch files under `.claude/skills/noldor-gate/` and their `templates/.claude/skills/noldor-gate/` twins

- [x] **Step 1: Brief the rules.**

  Run: `pnpm noldor rules brief --file .claude/skills/noldor-gate/artifact-review.md --stage code`

- [x] **Step 2: Confirm main has not changed the gate skill since `c7bc4bc`.**

  Run: `git fetch -q origin main && git diff --quiet c7bc4bc origin/main -- .claude/skills/noldor-gate/SKILL.md; echo $?`

  Expected: `0`. Anything else means a gate-skill edit landed on `main` after `c7bc4bc`, and assembling from `c7bc4bc` would silently drop it: stop, and re-derive the ranges and patches from the new text first.

- [x] **Step 3: Save the assembler.** Write `/tmp/gate-assemble.mjs`:

  ```js
  import { execFileSync } from 'node:child_process';
  import { writeFileSync } from 'node:fs';

  const source = execFileSync('git', ['show', 'c7bc4bc:.claude/skills/noldor-gate/SKILL.md'], {
    encoding: 'utf8',
  }).split('\n');
  const RANGES = JSON.parse(process.argv[2]);
  for (const [file, ranges] of Object.entries(RANGES)) {
    const blocks = ranges.map(([from, to, dedent]) =>
      source
        .slice(from - 1, to)
        .map((line) => line.replace(new RegExp(`^ {0,${dedent}}`), ''))
        .join('\n'),
    );
    writeFileSync(`.claude/skills/noldor-gate/${file}`, `${blocks.join('\n\n')}\n`);
  }
  ```

  Each range is `[firstLine, lastLine, spacesToStrip]`; the strip only removes the indentation a block carried as a list continuation in the monolith.

- [x] **Step 4: Assemble the nine files verbatim.**

  Run:

  ```bash
  node /tmp/gate-assemble.mjs '{"micro-chore.md":[[65,65,3],[66,74,5],[100,100,0],[391,391,2]],"fast-track.md":[[76,76,3],[82,98,0],[234,239,2]],"attach.md":[[63,63,3],[78,78,3],[80,80,3],[102,121,0],[230,230,2]],"artifact-review.md":[[126,158,0],[162,181,0],[210,212,0]],"blockers.md":[[182,208,2],[337,368,2]],"code-review.md":[[277,335,2],[370,381,2]],"fd-close.md":[[228,229,2],[232,232,2],[241,251,2],[261,272,2],[383,383,0]],"design-writeback.md":[[160,160,0],[253,259,2]],"autonomous.md":[[438,469,0]]}'
  ```

  Expected: the nine files exist and hold only pre-split text.

- [x] **Step 5: Finish each file with its patch.** Apply all nine:

~~~diff
--- a/.claude/skills/noldor-gate/micro-chore.md
+++ b/.claude/skills/noldor-gate/micro-chore.md
@@ -1,3 +1,9 @@
-- `micro-chore`: Confirm diff scope (pre-commit allowlist enforces, see [`src/core/allowlist.ts`](../../../src/core/allowlist.ts)). Write session marker `{ path: 'micro-chore', startedAt }` (the `startedAt` timestamp is required by the schema and drives the 24h staleness expiry — see the Noldor FD Usage "Session-marker expiry"). Include `slug: <roadmap-slug>` when the session was entered from a Step 0 roadmap pick; its block is then retired inside this commit (see "Roadmap-entry retirement" below). No worktree — edits land on local `main`, so **sync it before the first edit**: `git fetch origin main && git merge --ff-only origin/main` (a worktree gets this from `worktrees create`; local `main` is routinely one commit behind, because the graph-refresh PR merges itself after the previous session's end-of-flow sync). If `--ff-only` rejects, local `main` has commits `origin/main` lacks — stop and surface the divergence rather than editing on top of it. Commit. After commit, gate scaffolds the temp-branch handoff so Step 4 can deliver the change via PR:
+# /noldor-gate — micro-chore
 
+Read by `micro-chore` sessions at Step 2. Holds the scaffold, the temp-branch handoff, the roadmap-entry retirement and the merge cleanup; Step 4 runs only `pr-flow` and the cleanup below.
+
+## Scaffold
+
+Confirm diff scope (pre-commit allowlist enforces, see [`src/core/allowlist.ts`](../../../src/core/allowlist.ts)). Write session marker `{ path: 'micro-chore', startedAt }` (the `startedAt` timestamp is required by the schema and drives the 24h staleness expiry — see the Noldor FD Usage "Session-marker expiry"). Include `slug: <roadmap-slug>` when the session was entered from a Step 0 roadmap pick; its block is then retired inside this commit (see **Roadmap-entry retirement** below). No worktree — edits land on local `main`, so **sync it before the first edit**: `git fetch origin main && git merge --ff-only origin/main` (a worktree gets this from `worktrees create`; local `main` is routinely one commit behind, because the graph-refresh PR merges itself after the previous session's end-of-flow sync). If `--ff-only` rejects, local `main` has commits `origin/main` lacks — stop and surface the divergence rather than editing on top of it. Commit. After commit, gate scaffolds the temp-branch handoff so Step 4 can deliver the change via PR:
+
 1. `branch=micro/$(date -u +%s)` — epoch seconds, unique + sortable.
@@ -5,3 +11,3 @@
 3. `git stash push --include-untracked -m noldor-microchore` — park any *unrelated* uncommitted edits before the rewind. The step-1 commit already holds the micro-chore change itself; this protects every *other* dirty working-tree file (notably in-flight `ideas.md`/roadmap edits) from the `reset --hard` below. On a clean tree this no-ops and creates no stash entry.
-4. `git reset --hard origin/main` — rewind local main (keeps the PR shape: temp branch is the only commit ahead of `origin/main`). The step-3 stash means the reset can no longer silently destroy unrelated working-tree edits — closing the live data-loss hazard where a drain's micro-chore iteration wiped uncommitted `ideas.md` edits (uncommitted content never enters git's object store, so `git fsck` could not recover it).
+4. `git reset --hard origin/main` — rewind local main (keeps the PR shape: temp branch is the only commit ahead of `origin/main`). The step-3 stash is what keeps this reset from destroying unrelated working-tree edits: uncommitted content never enters git's object store, so nothing could recover it afterwards.
 5. `git stash list | grep -q noldor-microchore && git stash pop` — restore the parked edits on top of the rewound main, only when step 3 actually stashed something. A pop conflict means an unrelated edit overlaps a file the micro-chore commit also touched; surface it to the operator instead of forcing.
@@ -12,4 +18,8 @@
 
-**Micro-chore variant.** A `micro-chore` session entered from a roadmap pick (a `micro-chore` `suggestedPath`) carries `slug` too and needs the same retirement, with one difference: it rides the micro-chore commit instead of preceding it, because a micro-chore session is single-commit (see the trade-off note under the micro-chore scaffold). Run Step 1 on `main` before that commit, then stage `docs/roadmap.md` — and `.noldor/retired-entry-ids.json` when the CLI wrote it — alongside the change. Both are micro-chore paths, so the one commit carries the change and its retirement, and it reaches `main` through the same temp-branch PR. The hook injects `Noldor-Path: micro-chore` and `Noldor-FD: <slug>` from the marker; the micro-chore validator checks the staged paths, not the FD.
+## Roadmap-entry retirement
 
-- **Micro-chore path** (no worktree, see Step 2): `git checkout main` (a no-op when `gh` already switched back) + `git branch -D <temp-branch>` + `git fetch origin main && git rebase origin/main` to refresh the local main pointer. (Same rule — local main must match origin/main before the session exits.)
+A micro-chore session entered from a roadmap pick (a `micro-chore` `suggestedPath`) carries `slug` and must retire the entry, or the shipped entry re-surfaces at the next gate. The retirement rides the micro-chore commit instead of preceding it, because the session is single-commit. Run `pnpm noldor roadmap remove-block <slug>` on `main` before that commit — it is idempotent (an absent slug prints `nothing to do` and exits 0), and when the removed block carries an `- id:` it records the ID in `.noldor/retired-entry-ids.json` so `blocked-by:` references to it keep resolving. Then stage `docs/roadmap.md` — and `.noldor/retired-entry-ids.json` when the CLI wrote it — alongside the change. Both are micro-chore paths, so the one commit carries the change and its retirement, and it reaches `main` through the same temp-branch PR. The hook injects `Noldor-Path: micro-chore` and `Noldor-FD: <slug>` from the marker; the micro-chore validator checks the staged paths, not the FD.
+
+## Merge cleanup
+
+`git checkout main` (a no-op when `gh` already switched back) + `git branch -D <temp-branch>` + `git fetch origin main && git rebase origin/main` to refresh the local main pointer. Local main must match `origin/main` before the session exits.
~~~

~~~diff
--- a/.claude/skills/noldor-gate/fast-track.md
+++ b/.claude/skills/noldor-gate/fast-track.md
@@ -1,7 +1,13 @@
-- `fast-track`: Create the worktree via `pnpm noldor worktrees create <short-desc> --branch fast/<short-desc>`. Write session marker `{ path: 'fast-track', startedAt }` — include `slug: <roadmap-slug>` when this fast-track was entered from a Step 0 roadmap pick (an XS/S `suggestedPath`). Branch named `fast/<short-desc>`. No FD. When the marker carries a `slug`, run the **Roadmap-entry retirement** sequence below so the shipped entry leaves the queue. A commit that mixes code with `docs/noldor/` pages keeps its code scope only with a `Noldor-Sibling-Scope: noldor:<page>, …` trailer naming every staged page (see [`git-and-commits.md`](../../../docs/noldor/git-and-commits.md) § Sibling doc-sync commits) — the commit-msg hook refuses it otherwise.
+# /noldor-gate — fast-track
 
-### Roadmap-entry retirement (fast-track or micro-chore from a roadmap pick)
+Read by `fast-track` sessions at Step 2. Holds the scaffold, the roadmap-entry retirement, and the doc-impact check Step 4 runs before the push-gate preflight.
 
-When a `fast-track` session was entered from a Step 0 roadmap pick (XS/S `suggestedPath`), its session marker carries `slug`. Unlike `/noldor-promote` — which removes the source block as it scaffolds an FD — `fast-track` creates no FD, so the source roadmap block must be retired explicitly or the shipped entry re-surfaces at the next gate. Execute this on the worktree branch immediately after worktree creation + session-marker write (mirrors the phase-revert sequence). Skip entirely when the marker has no `slug` (ad-hoc fast-track not tied to a roadmap entry).
+## Scaffold
 
+Create the worktree via `pnpm noldor worktrees create <short-desc> --branch fast/<short-desc>`. Write session marker `{ path: 'fast-track', startedAt }` — include `slug: <roadmap-slug>` when this fast-track was entered from a Step 0 roadmap pick (an XS/S `suggestedPath`). Branch named `fast/<short-desc>`. No FD. When the marker carries a `slug`, run the **Roadmap-entry retirement** sequence below so the shipped entry leaves the queue. A commit that mixes code with `docs/noldor/` pages keeps its code scope only with a `Noldor-Sibling-Scope: noldor:<page>, …` trailer naming every staged page (see [`git-and-commits.md`](../../../docs/noldor/git-and-commits.md) § Sibling doc-sync commits) — the commit-msg hook refuses it otherwise.
+
+## Roadmap-entry retirement
+
+When a `fast-track` session was entered from a Step 0 roadmap pick (XS/S `suggestedPath`), its session marker carries `slug`. Unlike `/noldor-promote` — which removes the source block as it scaffolds an FD — `fast-track` creates no FD, so the source roadmap block must be retired explicitly or the shipped entry re-surfaces at the next gate. Execute this on the worktree branch immediately after worktree creation + session-marker write. Skip entirely when the marker has no `slug` (ad-hoc fast-track not tied to a roadmap entry).
+
 **Step 1 — remove the block (built-in no-op when the slug is already absent):**
@@ -20,3 +26,6 @@
 
-- **Doc-impact check (`fast-track` only)**, before the push-gate preflight below. A fast-track has no FD, but the code it changed may be what other FDs document:
+## Doc-impact check (Step 4)
+
+Runs before the push-gate preflight. A fast-track has no FD, but the code it changed may be what other FDs document:
+
 1. `pnpm noldor features owners --base origin/main` lists every FD owning a changed file. A `candidate` is `phase: done` with a written `## Usage`; an in-progress FD belongs to its own session. Exit 2 means the list could not be built — fix what it names, and never read it as "no owners".
~~~

~~~diff
--- a/.claude/skills/noldor-gate/attach.md
+++ b/.claude/skills/noldor-gate/attach.md
@@ -1 +1,7 @@
+# /noldor-gate — attach paths
+
+Read by `specs-only-attach` and `full-attach` sessions at Step 2. Holds the prompts, the scaffold, the phase-revert lifecycle, and the scope of the parent-FD refresh at Step 4.
+
+## Scaffold
+
 **Input localization.** When a prompt asks for an input that resolves to an *existing* on-disk file — notably a parent slug (`docs/features/<slug>.md`) — don't ask blind. Run a read-only lookup first (`ls docs/features/`), surface the matching candidates, and echo the resolved path as a clickable link so the operator verifies against the real file instead of recalling it from memory. On a parent-slug prompt: list the existing FD slugs, and once picked echo `docs/features/<slug>.md` as a link before validating it exists.
@@ -3,6 +9,5 @@
 - `specs-only-attach`: Prompt parent slug (localize per the Input-localization note above). Prompt enhancement slug (`Enhancement slug (short, kebab-case, scopes the spec filename)?`). Validate parent FD exists. Worktree. Session `{ path, parent, enhancement, startedAt, markerVersion: 2 }`. Run the phase-revert sequence below if applicable. `noldor-spec` writing spec named `<date>-<parent>-<enhancement>-design.md`. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, advance directly to implementation (no plan stage).
-
 - `full-attach`: Prompt parent slug (localize per the Input-localization note above). Prompt enhancement slug (`Enhancement slug (short, kebab-case, scopes the spec/plan filename)?`). Worktree. Session `{ path, parent, enhancement, startedAt }`. Run the phase-revert sequence below if applicable. `noldor-spec` writing spec named `<date>-<parent>-<enhancement>-design.md`. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, continue: the `noldor-plan` skill. **After plan returns, run Step 2.5 with `--kind plan` again.**
 
-### Phase-revert lifecycle (attach paths)
+## Phase-revert lifecycle
 
@@ -20,3 +25,3 @@
 
-The map is staged here because attach retires its source block through `remove-block --retired-into <parent-slug>` (`/noldor-promote` Step 6.alt), which writes `.noldor/retired-entry-ids.json` but never stages or commits — and every downstream gate commit is pathspec-scoped to the artifact or the FD, so an unstaged map never reaches `main` and the retired ID dangles anyway. Gating on `git diff --cached --quiet` rather than `git diff --quiet <fd>` is what makes the map land in the common case where the phase-revert itself was a no-op (parent already `in-progress`) and the map is the only change. When that happens the subject describes a revert that didn't occur — reword it to `docs(triage): record retired entry ID absorbed into <parent-slug>` and keep both trailers. The same `2>/dev/null` + `--cached` reasoning as the fast-track retirement above applies: `git add` on an absent map exits 128, and the `-- <paths>` limiter keeps the commit scoped.
+The map is staged here because attach retires its source block through `remove-block --retired-into <parent-slug>` (`/noldor-promote` Step 6.alt), which writes `.noldor/retired-entry-ids.json` but never stages or commits — and every downstream gate commit is pathspec-scoped to the artifact or the FD, so an unstaged map never reaches `main` and the retired ID dangles anyway. Gating on `git diff --cached --quiet` rather than `git diff --quiet <fd>` is what makes the map land in the common case where the phase-revert itself was a no-op (parent already `in-progress`) and the map is the only change. When that happens the subject describes a revert that didn't occur — reword it to `docs(triage): record retired entry ID absorbed into <parent-slug>` and keep both trailers. The second `git add` may fail silently: on an absent map it exits 128, which is why the commit gates on `--cached`, and the `-- <paths>` limiter keeps unrelated pre-staged work out of the commit.
 
@@ -24,5 +29,6 @@
 
-The reverse transition `in-progress → done` is written by `/noldor-gate` Step 4 end-of-flow (see Step 4's first bullet) — `flipPhaseToDone` from `src/core/phase-flip-done.ts` flips phase back to `done` in the last commit before merge, so `phase: done` lands on `main` as part of the feature PR. `release-markers.ts:fillMarkers` remains the release-time safety net for any FD that didn't get flipped at end-of-flow.
+The reverse transition `in-progress → done` is written at Step 4 (`fd-close.md`, the flip) — `flipPhaseToDone` from `src/core/phase-flip-done.ts` flips phase back to `done` in the last commit before merge, so `phase: done` lands on `main` as part of the feature PR. `release-markers.ts:fillMarkers` remains the release-time safety net for any FD that didn't get flipped at end-of-flow.
 
+## Parent-FD refresh scope (Step 4)
 
-- **Attach paths** (`specs-only-attach`, `full-attach`): target = `parent`; scoped + Usage-only so a small enhancement can't rewrite the parent FD's story. Changed files = `git diff --name-only origin/main...HEAD` filtered to `/noldor-draft-feature-md`'s source-extension allowlist, excluding the target FD file and anything under `docs/design/`. **If that filter yields zero files, skip the refresh entirely** (treat as no-op — do *not* invoke `/noldor-draft-feature-md`, which aborts on empty scope; this also keeps the autonomous `--yes` pipeline from halting). Otherwise **join the surviving paths with commas** (the `git diff` output is newline-separated; `--scope` wants comma-separated) and invoke `/noldor-draft-feature-md <parent> --refresh --scope <comma-joined paths> --usage-only` (add `--yes` in autonomous mode).
+Target = `parent`; scoped + Usage-only so a small enhancement can't rewrite the parent FD's story. Changed files = `git diff --name-only origin/main...HEAD` filtered to `/noldor-draft-feature-md`'s source-extension allowlist, excluding the target FD file and anything under `docs/design/`. **If that filter yields zero files, skip the refresh entirely** (treat as no-op — do *not* invoke `/noldor-draft-feature-md`, which aborts on empty scope; this also keeps the autonomous `--yes` pipeline from halting). Otherwise **join the surviving paths with commas** (the `git diff` output is newline-separated; `--scope` wants comma-separated) and invoke `/noldor-draft-feature-md <parent> --refresh --scope <comma-joined paths> --usage-only` (add `--yes` in autonomous mode).
~~~

~~~diff
--- a/.claude/skills/noldor-gate/artifact-review.md
+++ b/.claude/skills/noldor-gate/artifact-review.md
@@ -1,9 +1,15 @@
-2.5. **Multi-reviewer CR gate (mandatory pause after every spec/plan artifact).** Don't auto-chain into the next skill (implementation, draft-feature-md, etc.).
+# /noldor-gate — artifact review (Step 2.5)
 
-**Lint pass first.** Run `pnpm noldor noldor lint-plan-snippets <artifact-path>` and capture stdout + exit code. When the artifact kind is `plan`, also run `pnpm noldor noldor split-check --plan <artifact-path>` (same 0/2/1 exit contract) and append its stdout to the captured lint output; when the kind is `spec`, do the same with `pnpm noldor noldor split-check --spec <artifact-path>` (S1 word bulk / S2 criteria bloat — informational, never blocks). Exit code 0 = clean; exit code 2 = findings present (include the captured stdout verbatim in the AskUserQuestion description so the operator sees them before choosing); exit code 1 = script error (mention the error in the description but still proceed to the prompt — never block on linter infra). Findings are informational; they do not gate the choice. This Step 2.5 pass is the authoritative split checkpoint: autonomous/plans-drain paths execute committed plans without re-invoking the `noldor-plan` skill, so its post-save self-check may never have run.
+Read by `specs-only-*` and `full-*` sessions after each spec and each plan. **Multi-reviewer CR gate — a mandatory pause.** Don't auto-chain into the next skill (implementation, draft-feature-md, etc.).
 
-**Commit the artifact first.** Surface the artifact path in one sentence, then stage + commit it (no confirm — recoverable via `git reset --soft HEAD~1` if the round needs unwinding) before any lane runs — subagent needs a `BASE_SHA..HEAD_SHA` range, standalone needs the file on disk, and every lane needs the artifact at a stable `HEAD`.
+## Lint pass first
 
-When surfacing that path, **paste the link the auto-open hook supplied** in its `additionalContext` rather than building one from the repo-relative path. (The hook always supplies the link; it opens a tab only when the repo sets `design.autoOpen: true`, which is off by default so a launch cannot raise a different editor window mid-task.) A markdown link resolves against the editor's workspace folder while the artifact's repo-relative path is relative to this session's checkout, and those diverge for every session running inside `.worktrees/<slug>/` — a hand-built link renders and does nothing. No hook output to hand (not wired, or `code` absent)? Run `pnpm noldor design open <artifact-path>` once and use its `link:` line; `NOLDOR_WORKSPACE_ROOT` overrides the resolved root when the ladder guesses wrong.
+Run `pnpm noldor noldor lint-plan-snippets <artifact-path>` and capture stdout + exit code. When the artifact kind is `plan`, also run `pnpm noldor noldor split-check --plan <artifact-path>` (same 0/2/1 exit contract) and append its stdout to the captured lint output; when the kind is `spec`, do the same with `pnpm noldor noldor split-check --spec <artifact-path>` (S1 word bulk / S2 criteria bloat — informational, never blocks). Exit code 0 = clean; exit code 2 = findings present (include the captured stdout verbatim in the AskUserQuestion description so the operator sees them before choosing); exit code 1 = script error (mention the error in the description but still proceed to the prompt — never block on linter infra). Findings are informational; they do not gate the choice. This pass is the authoritative split checkpoint: autonomous/plans-drain paths execute committed plans without re-invoking the `noldor-plan` skill, so its post-save self-check may never have run.
 
+## Commit the artifact first
+
+Surface the artifact path in one sentence, then stage + commit it (no confirm — recoverable via `git reset --soft HEAD~1` if the round needs unwinding) before any lane runs — subagent needs a `BASE_SHA..HEAD_SHA` range, standalone needs the file on disk, and every lane needs the artifact at a stable `HEAD`.
+
+When surfacing that path, **paste the link the auto-open hook supplied** in its `additionalContext`; never build one from the repo-relative path. A markdown link resolves against the editor's workspace folder, the path against this session's checkout, and the two diverge in every `.worktrees/<slug>/` session — a hand-built link renders and does nothing. (The hook opens a tab only when the repo sets `design.autoOpen: true`, off by default so no editor window is raised mid-task.) No hook output to hand (not wired, or `code` absent)? Run `pnpm noldor design open <artifact-path>` once and use its `link:` line; `NOLDOR_WORKSPACE_ROOT` overrides the resolved root when the ladder guesses wrong.
+
 - After spec: `docs(features:<slug>): add spec for <slug>` (attach paths scope on the parent slug + name the enhancement in the subject)
@@ -13,4 +19,6 @@
 
-**Lane multi-select.** After the artifact commits, fire `AskUserQuestion` with multi-select on these options:
+## Lanes
 
+After the artifact commits, fire `AskUserQuestion` with multi-select on these options:
+
 - `manual` — operator reads the artifact, returns blockers/notes via stdin prompt in the CLI
@@ -22,5 +30,5 @@
 
-**The `reviewer` lane is mandatory at `--kind spec` and `--kind plan`, and there is no skip option.** No spec or plan reaches implementation unreviewed, so this stage offers **no `proceed-without-review`** — the only way past it is a green (or explicitly-addressed) reviewer pass. Enforcement, once orchestrate is invoked, is in code rather than prose: `withMandatoryReviewer` ([`src/core/lanes.ts`](../../../src/core/lanes.ts)) unions `reviewer` into every spec/plan lane set `resolveLanes` returns — whether it came from `--lanes` or from `crLanes.<kind>` — and orchestrate prints `lane 'reviewer' is mandatory for <kind> artifacts — added to the requested lanes` when it had to add it. `pnpm noldor validate noldor-config` refuses a `crLanes.spec` / `crLanes.plan` block that omits `reviewer`, so the config can't claim a review posture the runtime won't honor. The overwrite guard also withholds `keep-and-skip` for that lane, so a stale or red prior sink can't stand in for the review. `--kind code` is exempt from the union — its reviewer pass is enforced instead by the `Noldor-Reviewed-Subagent` receipt the pre-push hook validates. What code cannot enforce is a controller that never invokes orchestrate at all: dropping the `proceed-without-review` option above is what closes that hole, and it is prose.
+**The `reviewer` lane is mandatory at `--kind spec` and `--kind plan`, and there is no skip option.** No spec or plan reaches implementation unreviewed, so this stage offers **no `proceed-without-review`**: the only way past it is a green (or explicitly-addressed) reviewer pass. Once orchestrate runs, code enforces it — `withMandatoryReviewer` ([`src/core/lanes.ts`](../../../src/core/lanes.ts)) unions `reviewer` into every spec/plan lane set, from `--lanes` or `crLanes.<kind>` alike, and says so when it adds it; `pnpm noldor validate noldor-config` refuses a `crLanes.spec` / `crLanes.plan` block without `reviewer`; the overwrite guard withholds `keep-and-skip` for that lane, so a stale or red prior sink cannot stand in for the review. `--kind code` is exempt from the union — the `Noldor-Reviewed-Subagent` receipt the pre-push hook validates enforces it there. What code cannot enforce is a controller that never invokes orchestrate at all; the missing `proceed-without-review` option is what closes that hole.
 
-**Invoke orchestrate.**
+## Invoke orchestrate
 
@@ -34,2 +42,4 @@
 
+**UI- or architecture-bearing session** (marker `uiVerdict: required` with no `uiWaiver`, or `archVerdict: required` with no `archWaiver`): **Read now:** [`design-writeback.md`](design-writeback.md) — its design-approval drift check runs before the continue dialog.
+
 **Detailed spec summary (specs-only handoff).** When `kind === 'spec'` on a `specs-only-*` path, print a detailed summary of the committed spec to chat BEFORE the continue dialog — this pause is the last review surface before implementation (no plan stage follows), so a minimal "spec written, proceed?" prompt is not enough. Render four sections, each sourced from the spec body:
@@ -43,4 +53,6 @@
 
-**Continue dialog — lead with the artifact link.** Open the message carrying this `AskUserQuestion` with the artifact's clickable link, re-pasted **verbatim** from what the auto-open hook supplied when the artifact was written (the link rule at the top of this step). The summaries above *describe* the artifact; only the link *addresses* it — without one the operator either scrolls back for the path or approves prose they did not re-read, and spec approval is the one gate whose whole value is that a human read the thing. Both kinds get it, for the same reason. No hook string to hand? Run `pnpm noldor design open <artifact-path>` and use its `link:` line; never build the link from the repo-relative path, which resolves against the wrong root in every `.worktrees/<slug>/` session.
+## Continue dialog
 
+**Lead with the artifact link.** Open the message carrying this `AskUserQuestion` with the artifact's clickable link, re-pasted **verbatim** from what the auto-open hook supplied (the link rule above). The summaries *describe* the artifact; only the link *addresses* it — without one the operator scrolls back for the path or approves prose they did not re-read, and spec approval is the one gate whose whole value is that a human read the thing. Both kinds get it. No hook string to hand? Run `pnpm noldor design open <artifact-path>` and use its `link:` line.
+
 Then surface `AskUserQuestion`. When `kind === 'plan'`, options are: `proceed-autonomous / proceed / address-blockers / abort`. When `kind === 'spec'`, the autonomous option is omitted (autonomous mode triggers on plan-confirm, not spec-confirm).
@@ -52,5 +64,5 @@
 
-- `proceed-autonomous` (kind=plan only) → run `pnpm noldor noldor set-autonomous` to set `session.autonomous = true`, then advance to implementation. All remaining seams between this point and PR-merge run without prompts (see "Autonomous mode" section below).
+- `proceed-autonomous` (kind=plan only) → run `pnpm noldor noldor set-autonomous` to set `session.autonomous = true`, then advance to implementation. All remaining seams between this point and PR-merge run without prompts. **Read now:** [`autonomous.md`](autonomous.md).
 - `proceed` → advance to next skill in the path (interactive, today's behavior).
-
+- `address-blockers` → **Read now:** [`blockers.md`](blockers.md) — the split-back question, the auto-fix seam and the round cap.
 - `abort` → halt the path. Because the artifact was already committed at the top of Step 2.5, document `git reset --soft HEAD~1` in chat so the operator can unstage cleanly. **Abort does NOT remove `.noldor/cr/<slug>-<kind>-*.json` sinks** — on the next gate session the priors remain and `guardLaneOverwrite` catches them. State this explicitly so the operator knows the next round will prompt for overwrite/archive/keep.
~~~

~~~diff
--- a/.claude/skills/noldor-gate/blockers.md
+++ b/.claude/skills/noldor-gate/blockers.md
@@ -1,6 +1,13 @@
-- `address-blockers` → **when a split signal is live, ask which kind of addressing first.** If this round's findings include a `split-check` signal (`S1`/`S2` at `--kind spec`, `P1` at `--kind plan`), fire a second `AskUserQuestion`: `fix-in-place / split-back / back`. `fix-in-place` is the auto-fix-then-operator path below, unchanged; `split-back` is the carve described under "Split-back" further down; `back` returns to the continue-dialog. With no split signal in the round, skip this question and go straight to the auto-fix seam.
+# /noldor-gate — blockers
 
-The nesting is what keeps the dialog inside the four-option `AskUserQuestion` ceiling — at `kind === 'plan'` the top level is already full — and it is also where a split signal belongs: an oversized artifact *is* a blocker, and carving is one way to address it. The alternative, dropping `proceed-autonomous` whenever a threshold trips, would remove an unrelated capability on a heuristic.
+Read on any red round: at Step 2.5 when the operator picks `address-blockers`, and at Step 4 when the code-stage aggregate is red.
 
-**The auto-fix seam — try it first, then fall back to the operator.** Run `pnpm noldor cr autofix plan --slug <slug> --kind <kind>` and branch on its exit code:
+## Spec and plan rounds (Step 2.5)
+
+**When a split signal is live, ask which kind of addressing first.** If this round's findings include a `split-check` signal (`S1`/`S2` at `--kind spec`, `P1` at `--kind plan`), fire a second `AskUserQuestion`: `fix-in-place / split-back / back`. `fix-in-place` is the auto-fix-then-operator path below, unchanged; `split-back` is the carve described under **Split-back**; `back` returns to the continue-dialog. With no split signal in the round, skip this question and go straight to the auto-fix seam. The nesting keeps the dialog inside the four-option `AskUserQuestion` ceiling — at `kind === 'plan'` the top level is already full — and an oversized artifact *is* a blocker, so carving belongs here. Dropping `proceed-autonomous` whenever a threshold trips would instead remove an unrelated capability on a heuristic.
+
+### The auto-fix seam — try it first, then fall back to the operator
+
+Run `pnpm noldor cr autofix plan --slug <slug> --kind <kind>` and branch on its exit code:
+
 - **0** (`next: reround` — auto-fix, all-mechanical) → apply the listed `M<n>` mechanical blockers yourself — each with the smallest change that resolves it, preferring to delete a claim over adding one (the `fix-rule:` line `plan` prints) — commit the fix, then `pnpm noldor cr autofix record --slug <slug> --kind <kind> --applied <n> --deferred <n> --since <the printed base-sha>`, re-run orchestrate with `--base-sha <the printed base-sha>` and loop back to this branch. (`--since` is what makes the ledger's `diffStat` cover the whole fix when scope rules split it across commits.)
@@ -12,8 +19,13 @@
 
-**Bounded re-round rule (every operator-driven round).** The auto-fix seam above is bounded in code (`AUTOFIX_ROUND_CAP` in [`src/cr/autofix-ledger.ts`](../../../src/cr/autofix-ledger.ts)); the operator loop historically was not, and an unbounded loop self-feeds — every fix is fresh prose surface, so a delta review of it near-guarantees a new finding (Q-0073 ran 14 rounds, Q-0078 11, Q-0124 10; in Q-0112 rounds 1–3 caught real design flaws while rounds 4–11 were self-consistency findings seeded by the previous round's fix). Two rules terminate the loop:
+### Bounded re-round rule (every operator-driven round)
 
-- **Only `[design]` blockers trigger a re-round.** Partition the round's blockers by the reviewer's class tag (`[mechanical]` / `[design]`; an untagged blocker reads as `design` — the same fail-safe read the autofix seam applies). A round with ≥1 design blocker earns one re-round after the operator arbitrates it: the judgment call changed the artifact, so the change gets reviewed (re-run orchestrate with `--base-sha` per the note above; mechanical fixes from the same round ride that re-round rather than earning their own). An all-mechanical round is fix-and-proceed: apply the fixes, commit, and treat the artifact as explicitly-addressed at the continue-dialog — no re-dispatch. The next stage reviews those fixes anyway (the plan-stage pass for a spec fix; the code-stage CR's `origin/main..HEAD` range for a plan fix), so a fix-seeded regression cannot reach `main` unreviewed. A design blocker the operator rejects rather than applies is also explicitly-addressed and earns no re-round of its own. Record the ruling — only on the operator's word — with `pnpm noldor cr arbitration dispose --slug <slug> --kind <kind> --blocker <id> --disposition rejected --note "<why>"` (without `--blocker` it lists the ids): no later round of the session hands that finding to a lane as a prior while the lines it cites are unchanged, and every lane is shown the ruling (see cr-pipeline.md → Rulings before the cap). At the spec stage, also record the ruling in the spec itself — Non-goals for a requirement scoped out, Risks / trade-offs for an accepted risk, Open questions (resolved) for a design choice — so every lane of any later round reads it: a spec finding that re-argues a recorded ruling has no basis and does not block (see cr-pipeline.md → Spec-stage blocking). An unchanged artifact has nothing new to review.
-- **Hard cap: 2 re-rounds per artifact kind per gate session**, auto-fix and operator rounds combined (`AUTOFIX_ROUND_CAP = 2`; with the initial pass that is 3 total rounds — exactly the span that caught every real design flaw on record). **Enforced in code, both halves.** `cr orchestrate` appends a ledger entry for every round it resolves and refuses to dispatch past the cap (exit 3), printing the round history and the remedy; the auto-fix seam reads that same ledger, so the two draw from one budget. Only RED rounds count — a green dispatch arbitrates nothing, and a session re-mints its `HEAD^{tree}`-bound receipt after every fix commit, so those finding-nothing rounds must stay free. Past the cap a commit that changes `HEAD` earns exactly ONE closing round: green mints the receipt and the session ships, red refuses everything after. At the cap, no further dispatch. Batch every remaining blocker into ONE operator decision — `fix-and-proceed` (apply what is worth applying; addressed, not re-reviewed) or `abort` — instead of arbitrating round-by-round. A `[med]` wording nit and a design flaw no longer cost the same loop iteration; the tail collapses into a single choice.
-**Split-back (the `address-blockers` → `split-back` branch).** The artifact is oversized, not merely flawed: the remedy is to move scope out rather than to edit prose. This is a *bounce* to the phase that owns splits — `/noldor-promote` step 1.7 — but it is non-destructive: the FD, the session marker and the worktree all survive, and no promotion is unwound. See [complexity-gating.md → Which phase owns the split](../../../docs/noldor/complexity-gating.md#which-phase-owns-the-split).
+The auto-fix seam is bounded in code (`AUTOFIX_ROUND_CAP` in [`src/cr/autofix-ledger.ts`](../../../src/cr/autofix-ledger.ts)); the operator loop needs the same bound, because an unbounded loop feeds itself — every fix is fresh prose surface, so a delta review of it near-guarantees a new finding. Two rules terminate the loop:
 
+- **Only `[design]` blockers trigger a re-round.** Partition the round's blockers by the reviewer's class tag (`[mechanical]` / `[design]`; an untagged blocker reads as `design` — the same fail-safe read the autofix seam applies). A round with ≥1 design blocker earns one re-round after the operator arbitrates it: the judgment call changed the artifact, so the change gets reviewed (re-run orchestrate with `--base-sha` as `artifact-review.md` describes; mechanical fixes from the same round ride that re-round rather than earning their own). An all-mechanical round is fix-and-proceed: apply the fixes, commit, and treat the artifact as explicitly-addressed at the continue-dialog — no re-dispatch. The next stage reviews those fixes anyway (the plan-stage pass for a spec fix; the code-stage CR's `origin/main..HEAD` range for a plan fix), so a fix-seeded regression cannot reach `main` unreviewed. A design blocker the operator rejects rather than applies is also explicitly-addressed and earns no re-round of its own. Record the ruling — only on the operator's word — with `pnpm noldor cr arbitration dispose --slug <slug> --kind <kind> --blocker <id> --disposition rejected --note "<why>"` (without `--blocker` it lists the ids): no later round of the session hands that finding to a lane as a prior while the lines it cites are unchanged, and every lane is shown the ruling (see cr-pipeline.md → Rulings before the cap). At the spec stage, also record the ruling in the spec itself — Non-goals for a requirement scoped out, Risks / trade-offs for an accepted risk, Open questions (resolved) for a design choice — so every lane of any later round reads it: a spec finding that re-argues a recorded ruling has no basis and does not block (see cr-pipeline.md → Spec-stage blocking). An unchanged artifact has nothing new to review.
+- **Hard cap: 2 re-rounds per artifact kind per gate session**, auto-fix and operator rounds combined (`AUTOFIX_ROUND_CAP = 2`; with the initial pass that is 3 total rounds — cr-pipeline.md → Round budget records why three). **Enforced in code, both halves.** `cr orchestrate` appends a ledger entry for every round it resolves and refuses to dispatch past the cap (exit 3), printing the round history and the remedy; the auto-fix seam reads that same ledger, so the two draw from one budget. Only RED rounds count — a green dispatch arbitrates nothing, and a session re-mints its `HEAD^{tree}`-bound receipt after every fix commit, so those finding-nothing rounds must stay free. Past the cap a commit that changes `HEAD` earns exactly ONE closing round: green mints the receipt and the session ships, red refuses everything after. At the cap, no further dispatch. Batch every remaining blocker into ONE operator decision — `fix-and-proceed` (apply what is worth applying; addressed, not re-reviewed) or `abort` — instead of arbitrating round-by-round. A `[med]` wording nit and a design flaw no longer cost the same loop iteration; the tail collapses into a single choice.
+
+### Split-back
+
+The `address-blockers` → `split-back` branch. The artifact is oversized, not merely flawed: the remedy is to move scope out rather than to edit prose. This is a *bounce* to the phase that owns splits — `/noldor-promote` step 1.7 — but it is non-destructive: the FD, the session marker and the worktree all survive, and no promotion is unwound. See [complexity-gating.md → Which phase owns the split](../../../docs/noldor/complexity-gating.md#which-phase-owns-the-split).
+
 1. Operator names the scope that leaves.
@@ -24,8 +36,10 @@
 
-Step 5 is advisory deliberately. Enforcing a clean re-run would make this the framework's second hard stop on an operator-present surface (the headless drain is the only one), and combined with the cap below it could wedge a session: at the cap with the signal still tripping, neither `proceed` nor another carve would be legal. **`proceed` stays available at every point**, cap or no cap. An operator who has carved twice and still trips a threshold has a judgment call, not a locked door.
+Step 5 is advisory deliberately. Enforcing a clean re-run would make this the framework's second hard stop on an operator-present surface (the headless drain is the only one), and combined with the cap it could wedge a session: at the cap with the signal still tripping, neither `proceed` nor another carve would be legal. **`proceed` stays available at every point**, cap or no cap. An operator who has carved twice and still trips a threshold has a judgment call, not a locked door.
 
-A `split-back` counts as an operator re-round against the cap below — it is not exempt, because an unbounded carve loop is the same self-feeding failure the cap exists to stop.
+A `split-back` counts as an operator re-round against the cap — it is not exempt, because an unbounded carve loop is the same self-feeding failure the cap exists to stop.
 
-- **Auto-fix mechanical blockers (before escalating).** Same pair as Step 2.5, same branching:
+## Code-stage rounds (Step 4)
 
+**Auto-fix mechanical blockers (before escalating).** Same pair as the spec and plan rounds, same branching:
+
 ```
@@ -35,8 +49,8 @@
 - **0** (`next: reround`) → apply the listed `M<n>` blockers to the `fix-rule:` line, commit, `pnpm noldor cr autofix record --slug <slug> --kind code --applied <n> --deferred <n> --since <the printed base-sha>`, then re-run the code-stage orchestrate with `--base-sha <the printed base-sha>` (that re-run is what re-earns the `Noldor-Reviewed-Subagent` receipt — orchestrate only amends it on a green reviewer run) and re-aggregate.
-- **11** (`next: apply-then-stop`) → apply + `record` the `M<n>` subset (`--deferred` = `D<n>` count + unapplied `M<n>`, as in Step 2.5), then stop looping and **escalate** on the `D<n>` design blockers below.
+- **11** (`next: apply-then-stop`) → apply + `record` the `M<n>` subset (`--deferred` = `D<n>` count + unapplied `M<n>`, as above), then stop looping and **escalate** on the `D<n>` design blockers below.
 - **any other non-zero** (from `plan` or from `record`) → capture stderr/findings to a temp file and **escalate** exactly as below. On `reason: lanes-in-flight` prefer draining the lane first (`pnpm noldor cr aggregate --slug <slug> --wait-ms <ms>`) and re-running `plan`.
 
-Off by default (`autonomous.onBlockers`, see Step 2.5), bounded at 2 rounds per session plus a no-progress stop.
+Off by default (`autonomous.onBlockers`, as above), bounded at 2 rounds per session plus a no-progress stop.
 
-- **Escalate on cr-red.**
+**Escalate on cr-red.**
 
@@ -47,2 +61,3 @@
 CLI prompts the operator interactively (`retry-implementation / spawn-deep-review / override-with-trailer / abort`); add `--autonomous` to use the config default from `autonomous.onFailure` (`abort` / `spawn-deep-review` / `prompt`). Exit codes drive the next step:
+
 - **0** (`spawned` / `override`) → deep-review was spawned in a fresh iTerm2 window (via `lanes/standalone.ts`) OR the operator chose `override-with-trailer`. Proceed to PR flow.
@@ -51,3 +66,3 @@
 
-- **Escalate on test-red.** Same CLI, different reason — invoked earlier in the flow when the verification step (test pass before CR) fails:
+**Escalate on test-red.** Same CLI, different reason — invoked earlier in the flow when the verification step (test pass before CR) fails:
 
@@ -57,4 +72,2 @@
 
-**Autonomous mode:** same `--autonomous` flag + `autonomous.onFailure` semantics as the cr-red bullet above.
-
-Same exit-code semantics as above.
+**Autonomous mode:** same `--autonomous` flag + `autonomous.onFailure` semantics as cr-red, and the same exit-code semantics.
~~~

~~~diff
--- a/.claude/skills/noldor-gate/code-review.md
+++ b/.claude/skills/noldor-gate/code-review.md
@@ -1,3 +1,9 @@
-- **Wait for in-flight standalone from Step 2.5.** Before code-stage review starts, drain any artifact-stage lanes that are still running (a standalone-claude spawned earlier may still be writing its sink):
+# /noldor-gate — code-stage review (Step 4)
 
+Read by `fast-track`, `specs-only-*` and `full-*` sessions at Step 4, after the flip commit and before `pr-flow`. A red aggregate continues in `blockers.md`.
+
+## Wait for in-flight standalone from Step 2.5
+
+Before code-stage review starts, drain any artifact-stage lanes that are still running (a standalone-claude spawned earlier may still be writing its sink):
+
 ```
@@ -8,6 +14,8 @@
 
-`--unresolved-only` is what makes this step ask the question it is here to ask. The call is kind-less on purpose (the controller cannot know which artifact kinds this session produced), so it also reads the spec/plan sinks — and a round that **fix-and-proceeded at the re-round cap leaves its sink red by design**: the findings were fixed in commits and deliberately not re-dispatched. Without the flag this step re-reds on those already-addressed findings, and the controller has to recognise the staleness by hand and proceed on the Q-0069 precedent (code-stage green earns the receipt) — a manual override on every such session (Q-0154; hit on Q-0131 and again on Q-0092). With the flag, every lane finding still prints (nothing is hidden) but only lane resolution and sink integrity set the exit code — and the `ok=` header reports that same verdict, so the output never reads `ok=false` above an exit 0. The mute covers every blocker a lane filed, a sink reporting that its own review never happened (`verdict: cannot-verify`) included; that sink was already surfaced by the artifact stage's own aggregate at Step 2.5. The artifact's verdict is not this step's business: it was settled at the Step 2.5 continue-dialog, and the code-stage aggregate below is already `--kind code`-scoped.
+`--unresolved-only` is what makes this step ask the question it is here to ask. The call is kind-less on purpose (the controller cannot know which artifact kinds this session produced), so it also reads the spec/plan sinks — and a round that **fix-and-proceeded at the re-round cap leaves its sink red by design**: the findings were fixed in commits and deliberately not re-dispatched. Without the flag this step re-reds on those already-addressed findings, and every such session needs a manual override. With the flag, every lane finding still prints (nothing is hidden) but only lane resolution and sink integrity set the exit code — and the `ok=` header reports that same verdict, so the output never reads `ok=false` above an exit 0. The mute covers every blocker a lane filed, a sink reporting that its own review never happened (`verdict: cannot-verify`) included; that sink was already surfaced by the artifact stage's own aggregate at Step 2.5. The artifact's verdict is not this step's business: it was settled at the Step 2.5 continue-dialog, and the code-stage aggregate below is already `--kind code`-scoped.
 
-- **Preflight the push-range gates (before any code-stage review).** `pr-flow`'s push fires the pre-push chain (main-push block + docs/adr/ append-only scan, `template-sync`, `noldor-clones`) only after the review receipt is earned — so a gate failure at push time forces a fix commit, the tree changes, the `Noldor-Reviewed-Subagent` receipt invalidates, and a full code-stage dispatch runs purely to re-earn it (Q-0112: 2 of 6 code-stage dispatches plus 3 failed pushes were this class — zero review value). Replay the real hook author-side first, while no receipt exists to lose:
+## Preflight the push-range gates (before any code-stage review)
 
+`pr-flow`'s push fires the pre-push chain (main-push block + docs/adr/ append-only scan, `template-sync`, `noldor-clones`) only after the review receipt is earned — so a gate failure at push time forces a fix commit, the tree changes, the `Noldor-Reviewed-Subagent` receipt invalidates, and a full code-stage dispatch runs purely to re-earn it. Replay the real hook author-side first, while no receipt exists to lose:
+
 ```
@@ -18,4 +26,2 @@
 
-This replaces an earlier three-command enumeration (`checks template-sync`, `clones check`, a hand-`printf`-ed `hooks pre-push`), which is why the preflight could pass while the push was refused (Q-0165): an enumeration reproduces neither lefthook's job list nor its skip/exit semantics, and it silently omits whatever the block gained since it was written.
-
 Exit 0 = the push will be accepted. Exit 1 = a gate refuses this tree — fix it now (mirror a template twin, re-record a clones baseline alongside the change that moved it) and land the fix as an ordinary commit, then re-run until green. Exit 3 = the replay could not run at all (detached HEAD, or no lefthook on PATH or in `node_modules/.bin`); it prints the jobs to run by hand and is never a pass. A mechanical fix landed here costs one commit; the same fix landed after a green review also costs a receipt re-earn dispatch.
@@ -24,4 +30,6 @@
 
-- **Code-stage orchestrate.** Run the code-stage lanes. Pass **no `--lanes`**: at `--kind code` orchestrate reads `crLanes.code` from `.noldor/config.json` in every session, interactive or autonomous (there is no lane picker at this stage to prompt), falling back to `reviewer` alone when the block is absent — and on `specs-only-*` / `full-*` paths it forces `codex` into the set regardless, so an M/L/XL feature never ships reviewed by one model family. An explicit `--lanes` wins over config outright: `--lanes reviewer` in a repo configuring `['reviewer', 'verifier']` runs half its review posture and the aggregate still reads green (Q-0270). Reach for `--lanes` only to narrow one run on purpose, e.g. to leave the verifier out of a change with no runtime surface.
+## Code-stage orchestrate
 
+Run the code-stage lanes. Pass **no `--lanes`**: at `--kind code` orchestrate reads `crLanes.code` from `.noldor/config.json` in every session, interactive or autonomous (there is no lane picker at this stage to prompt), falling back to `reviewer` alone when the block is absent — and on `specs-only-*` / `full-*` paths it forces `codex` into the set regardless, so an M/L/XL feature never ships reviewed by one model family. An explicit `--lanes` wins over config outright: `--lanes reviewer` in a repo configuring `['reviewer', 'verifier']` runs half its review posture and the aggregate still reads green. Reach for `--lanes` only to narrow one run on purpose, e.g. to leave the verifier out of a change with no runtime surface.
+
 ```
@@ -30,3 +38,3 @@
 
-`<code-paths>` is a representative changed path used only for labeling; the subagent lane actually reviews the **`BASE_SHA..HEAD` diff range**, so pass `--base-sha origin/main` to cover the whole feature diff — which **includes the refreshed `docs/features/<slug>.md`** from the first bullet. That range membership is what delivers the "refreshed FD is reviewed by the code-stage CR" guarantee. Omitting `--base-sha` defaults the lane to `HEAD~1..HEAD` (last commit only — usually not what you want at end-of-flow). On attach paths pass the **parent** slug for `--slug` (the lane reads `docs/features/<slug>.md` as FD context, and attach has no child FD).
+`<code-paths>` is a representative changed path used only for labeling; the subagent lane actually reviews the **`BASE_SHA..HEAD` diff range**, so pass `--base-sha origin/main` to cover the whole feature diff — which **includes the refreshed `docs/features/<slug>.md`** from the FD refresh. That range membership is what delivers the "refreshed FD is reviewed by the code-stage CR" guarantee. Omitting `--base-sha` defaults the lane to `HEAD~1..HEAD` (last commit only — usually not what you want at end-of-flow). On attach paths pass the **parent** slug for `--slug` (the lane reads `docs/features/<slug>.md` as FD context, and attach has no child FD).
 
@@ -34,3 +42,3 @@
 
-**Fast-track profile.** When the session marker `path` is `fast-track`, append `--profile fast-track` to the orchestrate command so the CR pass is scoped (low effort, correctness+security+reuse+simplification per `crReview.profiles`). Other paths omit the flag and get the `default` profile (med effort, every dimension). For the fast-track / drain code-stage review the command is:
+**Fast-track profile.** When the session marker `path` is `fast-track`, append `--profile fast-track` to the orchestrate command so the CR pass is scoped (low effort, correctness+security+reuse+simplification per `crReview.profiles`). Other paths omit the flag and get the `default` profile (med effort, every dimension). For the fast-track code-stage review the command is:
 
@@ -42,3 +50,3 @@
 
-**Delta re-earn after a post-green mechanical fix.** `--base-sha origin/main` (the full feature range) is mandatory only for the **first** code-stage pass. When a commit lands *after* the reviewer went green — a push-gate fix the preflight bullet didn't catch, a fmt-hook rewrite, a one-line message reword that still changed the tree — the receipt invalidates, but the already-reviewed range hasn't changed. Re-earn with a delta pass over just the fix instead of re-reviewing the whole feature: capture `git rev-parse HEAD` **before** committing the fix (that tip carried the green receipt), then
+**Delta re-earn after a post-green mechanical fix.** `--base-sha origin/main` (the full feature range) is mandatory only for the **first** code-stage pass. When a commit lands *after* the reviewer went green — a push-gate fix the preflight didn't catch, a fmt-hook rewrite, a one-line message reword that still changed the tree — the receipt invalidates, but the already-reviewed range hasn't changed. Re-earn with a delta pass over just the fix instead of re-reviewing the whole feature: capture `git rev-parse HEAD` **before** committing the fix (that tip carried the green receipt), then
 
@@ -48,3 +56,3 @@
 
-(keep `--profile fast-track` when the first pass used it). Orchestrate already supports delta review — this is the same `--base-sha` mechanism the autofix loop uses via its printed `base-sha:` line; the skill just never prescribed it for the push-gate-failure path, which bypasses autofix. The reviewer sees only `<last-green-tip>..HEAD`, so a mechanical fix re-earns the receipt in one cheap dispatch instead of a full-range re-review.
+(keep `--profile fast-track` when the first pass used it). It is the same `--base-sha` mechanism the autofix loop uses through its printed `base-sha:` line; the push-gate-failure path bypasses autofix, so it is prescribed here. The reviewer sees only `<last-green-tip>..HEAD`, so a mechanical fix re-earns the receipt in one cheap dispatch instead of a full-range re-review.
 
@@ -52,3 +60,3 @@
 
-- **Aggregate code-stage.**
+## Aggregate code-stage
 
@@ -58,6 +66,8 @@
 
-Exit 0 → proceed to PR flow. Exit 1 → **try the auto-fix seam, then escalate**.
+Exit 0 → context cleanup below, then back to the router's Step 4 checklist. Exit 1 → **Read now:** [`blockers.md`](blockers.md) — try the auto-fix seam, then escalate.
 
-- **Context cleanup on clean exit.** Once all aggregates are green and the gate is about to enter PR flow, remove the escalation context file so stale failure context can't leak into a subsequent retry on the next feature, together with the auto-fix round ledgers, any quarantine remnant, and the series' decision stores (the green code round's receipt has already named every ruling in its `Noldor-CR-Settled:` trailers):
+## Context cleanup on clean exit
 
+Once all aggregates are green and the gate is about to enter PR flow, remove the escalation context file so stale failure context can't leak into a subsequent retry on the next feature, together with the auto-fix round ledgers, any quarantine remnant, and the series' decision stores (the green code round's receipt has already named every ruling in its `Noldor-CR-Settled:` trailers):
+
 ```
~~~

~~~diff
--- a/.claude/skills/noldor-gate/fd-close.md
+++ b/.claude/skills/noldor-gate/fd-close.md
@@ -1,8 +1,18 @@
-- **Refresh the feature-MD body (`/noldor-draft-feature-md --refresh`)** for all FD-carrying paths, *before* the phase-flip below, so refreshed `User Story` / `Usage` ride the same commit and are seen by the code-stage CR. Resolve target + scope by path:
+# /noldor-gate — FD close-out (Step 4)
+
+Read by FD-carrying sessions (`specs-only-*`, `full-*`) at Step 4. Holds the FD body refresh, the design-artifact archive, the phase flip, and bootstrap immunity, in the order the router's checklist runs them.
+
+## Refresh the feature-MD body
+
+Run `/noldor-draft-feature-md --refresh` *before* the phase-flip below, so the refreshed `User Story` / `Usage` ride the same commit and are seen by the code-stage CR. Resolve target + scope by path:
+
 - **New-FD paths** (`specs-only-new`, `full-new`): target = `slug`; full `links.code` / `links.tests`; both sections. Invoke `/noldor-draft-feature-md <slug> --refresh` (add `--yes` in autonomous mode).
+- **Attach paths** (`specs-only-attach`, `full-attach`): target, scope and the zero-file skip come from `attach.md` → Parent-FD refresh scope.
 
-`/noldor-draft-feature-md` never stages or commits — the flip step below commits the refreshed body together with `phase: done`. In autonomous mode `--yes` runs it non-interactively (no prompt). Because the flip commits the refreshed FD onto the branch, it rides the `origin/main..HEAD` diff that the code-stage CR reviews below (that step passes `--base-sha origin/main`) — that is the mechanism behind "reviewed by the code-stage CR".
+`/noldor-draft-feature-md` never stages or commits — the flip step below commits the refreshed body together with `phase: done`. In autonomous mode `--yes` runs it non-interactively (no prompt). Because the flip commits the refreshed FD onto the branch, it rides the `origin/main..HEAD` diff that the code-stage CR reviews (that step passes `--base-sha origin/main`) — that is the mechanism behind "reviewed by the code-stage CR".
 
-- **Archive this session's design artifacts** for all FD-carrying paths, immediately before the flip below so the move rides the same commit. The flip commit records the *index*, so assert it is empty first:
+## Archive this session's design artifacts
 
+Immediately before the flip below, so the move rides the same commit. The flip commit records the *index*, so assert it is empty first:
+
 `git diff --cached --quiet || { echo "index not empty before flip — resolve by hand"; exit 1; }`
@@ -17,4 +27,6 @@
 
-- **Flip FD `phase: in-progress → done`** for all FD-carrying paths (`specs-only-new`, `specs-only-attach`, `full-new`, `full-attach`). Read `slug` (new-FD paths) or `parent` (attach paths) from `.noldor/session.json`. Then commit the index — FD plus the archive moves staged above:
+## Flip FD `phase: in-progress → done`
 
+For all FD-carrying paths (`specs-only-new`, `specs-only-attach`, `full-new`, `full-attach`). Read `slug` (new-FD paths) or `parent` (attach paths) from `.noldor/session.json`. Then commit the index — FD plus the archive moves staged above:
+
 `pnpm noldor features phase-flip-done <slug>`
@@ -27,5 +39,6 @@
 
-`release-markers.ts:fillMarkers` remains the release-time safety net for any FD that didn't get flipped at end-of-flow (forgot, manual commits, etc.) — its branches still accept `phase: in-progress + introduced` as input. Trade-off: the `### <version> (in-progress)` changelog label no longer renders for enhancement cycles whose Step 4 flip succeeded — the original asymmetric design in `framework-pr-flow-agent-auto-merge` spec §3 is superseded by this end-of-flow flip. The `(in-progress)` label still renders for FDs caught by the release-time safety net.
+`release-markers.ts:fillMarkers` remains the release-time safety net for any FD that didn't get flipped at end-of-flow (forgot, manual commits, etc.) — its branches still accept `phase: in-progress + introduced` as input. Trade-off: the `### <version> (in-progress)` changelog label renders only for FDs caught by that safety net, never for an enhancement cycle whose Step 4 flip succeeded.
 
+## Bootstrap immunity (gate-introducing FDs only)
 
-- **Bootstrap-immunity (gate-introducing FDs only).** Run `pnpm noldor cr bootstrap --slug <slug>`. If the FD's frontmatter declares `introduces-gate`, this rewrites every commit on the worktree branch to carry the matching bootstrap override so the release gate the feature introduces can't block its own commits. No-op otherwise (`no introduces-gate — skipped`). Runs **after** the code-stage review amends `Noldor-Reviewed-Subagent` on the tip (the rewrite is message-only, tree-preserving, so review receipts stay valid) and **before** `pnpm noldor pr-flow` (so the history rewrite stays local, pre-push). Fast-track / micro-chore paths skip it (no FD).
+Run `pnpm noldor cr bootstrap --slug <slug>`. If the FD's frontmatter declares `introduces-gate`, this rewrites every commit on the worktree branch to carry the matching bootstrap override so the release gate the feature introduces can't block its own commits. No-op otherwise (`no introduces-gate — skipped`). Runs **after** the code-stage review amends `Noldor-Reviewed-Subagent` on the tip (the rewrite is message-only, tree-preserving, so review receipts stay valid) and **before** `pnpm noldor pr-flow` (so the history rewrite stays local, pre-push).
~~~

~~~diff
--- a/.claude/skills/noldor-gate/design-writeback.md
+++ b/.claude/skills/noldor-gate/design-writeback.md
@@ -1,7 +1,20 @@
-**Design-approval drift (UI-bearing sessions).** When the session marker carries `uiVerdict: required` and no `uiWaiver`, run `pnpm noldor design verdict --check --pen <the session's .pen>` before the continue-dialog: the approval record binds the spec's text, and a CR fix round may have changed what the approved design is supposed to show. Exit 0 → the approval still covers this spec (or it was waived). Exit 1 → it printed the spec diff since the approval; show the operator that diff and ask whether the design still depicts the spec — yes → `pnpm noldor design verdict --pen <the .pen> --reconfirm` and commit the rewritten record (on a UI design it also holds the changed spec's `### Design coverage` table against the design's pages, and exits 2 on a gap: correct the table, or revise the design, as it prints); no → revise the design (`noldor-spec` step 1.5 Iterate) and take the verdict again. Exit 2 → the approval cannot be checked (no record, or one from before spec binding): take the verdict again with `--spec`. Leaving drift for later only moves the question past the implementation — the code-stage `ui-reviewer` lane refuses it as `design-approval-spec-stale`. The same check runs on the architecture `.pen` when the marker carries `archVerdict: required` and no `archWaiver`: `pnpm noldor design verdict --check --pen <the session's architecture .pen>`, with the same three exit branches.
+# /noldor-gate — design approval and baseline write-back
 
-- **UI baseline write-back (UI-bearing sessions only).** Runs AFTER the archive seam above — the empty-index assertion precedes the archive step, and the write-back's staged baselines then join the archive moves in the same flip commit below. When `session.uiWaiver` is present, skip the write-back entirely: a waived session has no feature `.pen` to start from — print the debt + `pnpm noldor design ui-sync` (the freshness check stays red until repaid) and continue. Otherwise recompute the UI verdict from the real diff: candidate paths = `git diff --name-only origin/main...HEAD`, config = `consumer.uiPaths`/`uiSurfaces`, FD `design:` override still absolute. On `skip`: continue (a spec-time `required` with no UI diff no-ops here; the feature `.pen` was already archived above). On `required`: for every affected surface, update `docs/design/ui/baseline/<surface>.pen` via pencil MCP to the as-built UI — start from the archived feature `.pen`'s `FINAL:<surface>:` pages, adjust for implementation drift; never edit the feature `.pen` itself. **Assert the write target first:** call `get_app_state` and confirm the open document is the baseline you are about to write — `execute` routes by `filePath` only while that file exists, and a path that does not silently falls back to the editor's open canvas (Q-0187). Then, for each surface written, run `pnpm noldor design capture --surface <surface> --vouch-only` and stage the receipt alongside it: the hand edit changes the baseline's git blob, so without a fresh receipt the surface reads `stale` at the next check, and the only other command that clears that — a real `design capture` — would re-run the consumer's capture and overwrite the edit just made. `--vouch-only` records a receipt for the file on disk without running anything, needs no declared `uiCapture` command, and requires `--surface` so one surface's hand edit cannot vouch for another's untouched baseline. Stage the baseline files and their receipts; they ride the flip commit with the archive moves. This is the one sanctioned baseline write in the whole flow, and `checks shared-files` refuses a baseline `.pen` staged from a feature worktree, so make that commit with `NOLDOR_ALLOW_PEN_WRITE=1` set — the override is the acknowledgement that this write is deliberate, and every other baseline edit from a feature session is the wrong-canvas bug. Spec-time `skip` that turned ship-time `required` (UI emerged during implementation): same write-back via the `ui-sync` flow — no retroactive design artifact is required. Pencil MCP failing with `A file needs to be open in the editor`: that is the bridge being down, not the editor being absent — run `pnpm noldor design pen-bridge` (asks VS Code to open a tracked `.pen`; exit 1 = none tracked, so the editor must author one; exit 3 = the pen.dev extension `highagency.pencildev` is not installed, so VS Code would show raw JSON instead of a canvas) and retry once. A still-dead bridge may also be an `--app` pin on the wrong editor — `pnpm noldor checks pen-bridge` names it, and expects `visual_studio_code`. Pencil MCP tools missing entirely means the harness: the server does not connect under the Claude Code VS Code extension, so that step needs a terminal session. Pencil MCP still unavailable after that: skip LOUDLY — print the debt + `pnpm noldor design ui-sync`; do NOT block the ship on it.
+Read by UI- or architecture-bearing sessions: at Step 2.5 for the design-approval drift check, and at Step 4 for the UI and architecture baseline write-backs; also by any session whose `checks arch-baseline` reports findings at Step 4.
 
-- **Architecture baseline write-back (every path, when `docs/design/architecture/baseline.pen` exists).** Runs after the UI write-back and before the flip commit. Run `pnpm noldor checks arch-baseline`, then:
-- **The session approved an architecture `.pen`** (`archVerdict: required`, no `archWaiver`; the archive seam just moved it into `docs/design/architecture/archive/`): for each `FINAL:<view>:` page, apply the change it makes against its `BASE:<view>:` page onto the **current** baseline view through pencil MCP — never copy the page over, because another feature may have written that view back since Seed. Open the baseline with `pnpm noldor design pen-bridge --pen docs/design/architecture/baseline.pen` and assert it with `get_app_state` before the first write. Save, re-route each changed view (`pnpm -s noldor design arch-route --pen docs/design/architecture/baseline.pen --view <view>`, stdout as `execute`'s `input`), and re-run the check until it is green.
+## Design-approval drift (Step 2.5)
+
+When the session marker carries `uiVerdict: required` and no `uiWaiver`, run `pnpm noldor design verdict --check --pen <the session's .pen>` before the continue-dialog: the approval record binds the spec's text, and a CR fix round may have changed what the approved design is supposed to show. Exit 0 → the approval still covers this spec (or it was waived). Exit 1 → it printed the spec diff since the approval; show the operator that diff and ask whether the design still depicts the spec — yes → `pnpm noldor design verdict --pen <the .pen> --reconfirm` and commit the rewritten record (on a UI design it also holds the changed spec's `### Design coverage` table against the design's pages, and exits 2 on a gap: correct the table, or revise the design, as it prints); no → revise the design (`noldor-spec` step 1.5 Iterate) and take the verdict again. Exit 2 → the approval cannot be checked (no record, or one from before spec binding): take the verdict again with `--spec`. Leaving drift for later only moves the question past the implementation — the code-stage `ui-reviewer` lane refuses it as `design-approval-spec-stale`. The same check runs on the architecture `.pen` when the marker carries `archVerdict: required` and no `archWaiver`: `pnpm noldor design verdict --check --pen <the session's architecture .pen>`, with the same three exit branches.
+
+## UI baseline write-back (Step 4, UI-bearing sessions only)
+
+Runs AFTER the archive step (`fd-close.md`) — the empty-index assertion precedes the archive, and the write-back's staged baselines then join the archive moves in the flip commit. When `session.uiWaiver` is present, skip the write-back entirely: a waived session has no feature `.pen` to start from — print the debt + `pnpm noldor design ui-sync` (the freshness check stays red until repaid) and continue. Otherwise recompute the UI verdict from the real diff: candidate paths = `git diff --name-only origin/main...HEAD`, config = `consumer.uiPaths`/`uiSurfaces`, FD `design:` override still absolute. On `skip`: continue (a spec-time `required` with no UI diff no-ops here; the feature `.pen` was already archived). On `required`: for every affected surface, update `docs/design/ui/baseline/<surface>.pen` via pencil MCP to the as-built UI — start from the archived feature `.pen`'s `FINAL:<surface>:` pages, adjust for implementation drift; never edit the feature `.pen` itself. **Assert the write target first:** call `get_app_state` and confirm the open document is the baseline you are about to write — `execute` routes by `filePath` only while that file exists, and a path that does not silently falls back to the editor's open canvas. Then, for each surface written, run `pnpm noldor design capture --surface <surface> --vouch-only` and stage the receipt alongside it: the hand edit changes the baseline's git blob, so without a fresh receipt the surface reads `stale` at the next check, and the only other command that clears that — a real `design capture` — would re-run the consumer's capture and overwrite the edit just made. `--vouch-only` records a receipt for the file on disk without running anything, needs no declared `uiCapture` command, and requires `--surface` so one surface's hand edit cannot vouch for another's untouched baseline. Stage the baseline files and their receipts; they ride the flip commit with the archive moves. This is the one sanctioned baseline write in the whole flow, and `checks shared-files` refuses a baseline `.pen` staged from a feature worktree, so make that commit with `NOLDOR_ALLOW_PEN_WRITE=1` set — the override is the acknowledgement that this write is deliberate, and every other baseline edit from a feature session is the wrong-canvas bug. Spec-time `skip` that turned ship-time `required` (UI emerged during implementation): same write-back via the `ui-sync` flow — no retroactive design artifact is required.
+
+Pencil MCP failing with `A file needs to be open in the editor`: that is the bridge being down, not the editor being absent — run `pnpm noldor design pen-bridge` (asks VS Code to open a tracked `.pen`; exit 1 = none tracked, so the editor must author one; exit 3 = the pen.dev extension `highagency.pencildev` is not installed, so VS Code would show raw JSON instead of a canvas) and retry once. A still-dead bridge may also be an `--app` pin on the wrong editor — `pnpm noldor checks pen-bridge` names it, and expects `visual_studio_code`. Pencil MCP tools missing entirely means the harness: the server does not connect under the Claude Code VS Code extension, so that step needs a terminal session. Pencil MCP still unavailable after that: skip LOUDLY — print the debt + `pnpm noldor design ui-sync`; do NOT block the ship on it.
+
+## Architecture baseline write-back (Step 4)
+
+Every path, when `docs/design/architecture/baseline.pen` exists. Runs after the UI write-back and before the flip commit. Run `pnpm noldor checks arch-baseline`, then:
+
+- **The session approved an architecture `.pen`** (`archVerdict: required`, no `archWaiver`; the archive step just moved it into `docs/design/architecture/archive/`): for each `FINAL:<view>:` page, apply the change it makes against its `BASE:<view>:` page onto the **current** baseline view through pencil MCP — never copy the page over, because another feature may have written that view back since Seed. Open the baseline with `pnpm noldor design pen-bridge --pen docs/design/architecture/baseline.pen` and assert it with `get_app_state` before the first write. Save, re-route each changed view (`pnpm -s noldor design arch-route --pen docs/design/architecture/baseline.pen --view <view>`, stdout as `execute`'s `input`), and re-run the check until it is green.
 - **The check is red on a session with no architecture design** — a module added, removed or rewired without one: write the baseline back the same way from the code, adding, renaming or removing exactly the boxes and arrows the findings name.
~~~

~~~diff
--- a/.claude/skills/noldor-gate/autonomous.md
+++ b/.claude/skills/noldor-gate/autonomous.md
@@ -1,3 +1,5 @@
-## Autonomous mode
+# /noldor-gate — autonomous mode
 
+Read by `full-*` sessions when the operator picks `proceed-autonomous` at the plan-stage continue dialog (`artifact-review.md`).
+
 Activated when the operator picks `proceed-autonomous` at the plan-stage Step 2.5 continue-dialog. Persisted as `session.autonomous = true` in `.noldor/session.json` (via `pnpm noldor noldor set-autonomous`). Stays on through PR-merge — no operator-facing "exit autonomous" command; the session marker is cleared by the post-merge cleanup like any other session.
~~~

- [x] **Step 6: Mirror the twins and measure.**

  Run:

  ```bash
  for f in micro-chore fast-track attach artifact-review blockers code-review fd-close design-writeback autonomous; do
    cp ".claude/skills/noldor-gate/$f.md" "templates/.claude/skills/noldor-gate/$f.md"
  done
  wc -w .claude/skills/noldor-gate/*.md
  ```

  Expected word counts: `micro-chore.md` 741, `fast-track.md` 756, `attach.md` 737, `artifact-review.md` 1458, `blockers.md` 1899, `code-review.md` 1569, `fd-close.md` 667, `design-writeback.md` 1082, `autonomous.md` 457. `SKILL.md` is still Part 2's monolith.

- [x] **Step 7: Check them.**

  Run: `pnpm noldor checks skill-portability && pnpm noldor validate skill-catalog && pnpm noldor checks template-sync .claude/skills/noldor-gate/artifact-review.md`

  Expected: all exit 0 — the catalog still counts 15 skills (a branch file is not a skill).

- [x] **Step 8: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  docs(features:gate-skill-loads-only-the-branch-a-session-takes): move the gate skill's branches into their own files

  Adds nine branch files beside the gate SKILL.md — micro-chore, fast-track, attach, artifact-review, blockers, code-review, fd-close, design-writeback and autonomous — each assembled from the pre-split text at c7bc4bc and finished by one patch that adds its header and read-now lines, drops the incident history and tightens the wording. The router that sends sessions to them lands next.

  Noldor-FD: gate-skill-loads-only-the-branch-a-session-takes
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add .claude/skills/noldor-gate templates/.claude/skills/noldor-gate
  NOLDOR_ALLOW_SHARED=1 git commit -F "$msg"
  ```

  Expected: the commit lands.

---

## Task 7: Turn SKILL.md into the router

**Files:**
- Test: `src/checks/__tests__/gate-skill-layout.test.ts`
- Modify: `.claude/skills/noldor-gate/SKILL.md`, `templates/.claude/skills/noldor-gate/SKILL.md`

- [x] **Step 1: Brief the rules.**

  Run: `pnpm noldor rules brief --file .claude/skills/noldor-gate/SKILL.md --file src/checks/__tests__/gate-skill-layout.test.ts --stage code`

- [x] **Step 2: Write the failing test.** Create `src/checks/__tests__/gate-skill-layout.test.ts`:

  ```ts
  // @tests: gate-skill-loads-only-the-branch-a-session-takes
  import { existsSync, readFileSync, readdirSync } from 'node:fs';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';

  import { countWords } from '../../utils/word-count.js';

  const ROOT = join(__dirname, '..', '..', '..');
  const GATE_DIR = join(ROOT, '.claude', 'skills', 'noldor-gate');
  /** `.claude/skills/noldor-gate/SKILL.md` at c7bc4bc, the tree the split was designed against. */
  const PRE_SPLIT_WORDS = 13_690;

  const gateFile = (name: string): string => readFileSync(join(GATE_DIR, name), 'utf8');
  const wordsIn = (path: string): number => countWords(readFileSync(path, 'utf8'));
  /** A bare name sits beside `SKILL.md`; a path with a slash is repo-relative. */
  const resolveLoadFile = (name: string): string =>
    name.includes('/') ? join(ROOT, name) : join(GATE_DIR, name);

  interface LoadRow {
    session: string;
    everyRun: string[];
    onlyWhen: string[];
  }

  /** The router's load table, one row per session. */
  function loadTable(): LoadRow[] {
    const lines = gateFile('SKILL.md').split('\n');
    const head = lines.findIndex((line) => line.startsWith('| Session |'));
    if (head < 0) throw new Error('SKILL.md has no load table');
    const mdFiles = (cell: string): string[] =>
      [...cell.matchAll(/`([^`]+\.md)`/g)].map((m) => m[1]!);
    const rows: LoadRow[] = [];
    for (const line of lines.slice(head + 2)) {
      if (!line.startsWith('|')) break;
      const [session = '', everyRun = '', onlyWhen = ''] = line
        .slice(1, -1)
        .split(' | ')
        .map((cell) => cell.trim());
      rows.push({ session, everyRun: mdFiles(everyRun), onlyWhen: mdFiles(onlyWhen) });
    }
    return rows;
  }

  describe('the gate skill loads only the branch a session takes', () => {
    it('keeps the router at or under 3,000 words', () => {
      expect(wordsIn(join(GATE_DIR, 'SKILL.md'))).toBeLessThanOrEqual(3000);
    });

    it('has a load-table row for every path and mode, naming only files that exist', () => {
      const rows = loadTable();
      expect(rows.map((r) => r.session)).toEqual([
        '`micro-chore`',
        '`fast-track`',
        '`specs-only-new`',
        '`specs-only-attach`',
        '`full-new`',
        '`full-attach`',
        '`--drain <slug>`',
        '`--drain <slug> --finish`',
        '`--resume <slug>` under `NOLDOR_DRAIN=1`',
        '`--resume <slug>`',
      ]);
      for (const row of rows) {
        for (const file of [...row.everyRun, ...row.onlyWhen]) {
          expect(existsSync(resolveLoadFile(file)), `${row.session} → ${file}`).toBe(true);
        }
      }
    });

    it('loads a clean specs-only-new run in under half the pre-split skill', () => {
      const row = loadTable().find((r) => r.session === '`specs-only-new`');
      expect(row?.everyRun).toEqual(['artifact-review.md', 'fd-close.md', 'code-review.md']);
      const load = [join(GATE_DIR, 'SKILL.md'), ...(row?.everyRun ?? []).map(resolveLoadFile)]
        .map(wordsIn)
        .reduce((sum, n) => sum + n, 0);
      expect(load).toBeLessThan(PRE_SPLIT_WORDS / 2);
    });

    it('carries no incident-history ids in any gate skill file', () => {
      for (const file of readdirSync(GATE_DIR).filter((f) => f.endsWith('.md'))) {
        expect(gateFile(file), file).not.toMatch(/Q-\d{4}|PR #\d+/);
      }
    });

    it('closes the FD on the drain Resume path with every noldor command fd-close.md runs', () => {
      const page = readFileSync(join(ROOT, 'docs', 'noldor', 'drain-mode.md'), 'utf8');
      const start = page.indexOf('\n## Resume path');
      const resume = page.slice(start, page.indexOf('\n## ', start + 1));
      const commands = new Set(
        [...gateFile('fd-close.md').matchAll(/pnpm noldor [a-z-]+ [a-z-]+/g)].map((m) => m[0]),
      );
      expect([...commands].toSorted()).toEqual([
        'pnpm noldor cr bootstrap',
        'pnpm noldor design archive',
        'pnpm noldor features phase-flip-done',
      ]);
      for (const command of commands) expect(resume, command).toContain(command);
    });
  });
  ```

- [x] **Step 3: Run to verify FAIL.**

  Run: `pnpm vitest run src/checks/__tests__/gate-skill-layout.test.ts`

  Expected: 4 of 5 fail — the monolith is over 3,000 words, has no load table, and still carries `Q-`/`PR #` ids; the Resume-path parity case already passes (Part 2 gave the page the close-out, Task 6 gave `fd-close.md` its commands).

- [x] **Step 4: Assemble the router verbatim, then finish it with its patch.**

  Run: `node /tmp/gate-assemble.mjs '{"SKILL.md":[[1,9,0],[19,19,0],[23,23,0],[25,59,0],[77,77,3],[79,79,3],[214,224,0],[394,420,0]]}'`

  Then apply:

~~~diff
--- a/.claude/skills/noldor-gate/SKILL.md
+++ b/.claude/skills/noldor-gate/SKILL.md
@@ -9,10 +9,35 @@
 
+## Parameters
 
+- `--resume <slug>` — resume an in-progress FD; skips the path picker (see **--resume mode** at the end).
+- `--drain <slug>` — **headless drain entry, supervisor-only.** The autonomous queue-drain supervisor passes it on every spawned `claude --print`; never for interactive use.
+- `--finish` — **only with `--drain <slug>`, supervisor-only.** The branch already carries committed work that a prior child never delivered.
+- Every other invocation is interactive.
+
+## How this skill loads
+
+This file is a router. It holds what every session runs; each branch lives in its own file beside it, in the skill's base directory (the path printed when the skill loaded). A fork carries one line of the form **Read now:** [`<file>`](<file>). That line is part of its step: read the named file in full at that point, before acting on the branch, and read it again if the context was compacted since. Never act on a fork from memory — its rules live only in that file.
+
+| Session | Reads on every run | Reads only when |
+| --- | --- | --- |
+| `micro-chore` | `micro-chore.md` | — |
+| `fast-track` | `fast-track.md`, `code-review.md` | `blockers.md` on a red round; `design-writeback.md` when `checks arch-baseline` reports findings |
+| `specs-only-new` | `artifact-review.md`, `fd-close.md`, `code-review.md` | `blockers.md` on a red round; `design-writeback.md` for a UI or architecture design, or when `checks arch-baseline` reports findings |
+| `specs-only-attach` | `attach.md`, `artifact-review.md`, `fd-close.md`, `code-review.md` | as `specs-only-new` |
+| `full-new` | `artifact-review.md`, `fd-close.md`, `code-review.md` | as `specs-only-new`; `autonomous.md` after `proceed-autonomous` |
+| `full-attach` | `attach.md`, `artifact-review.md`, `fd-close.md`, `code-review.md` | as `full-new` |
+| `--drain <slug>` | `docs/noldor/drain-mode.md` | — |
+| `--drain <slug> --finish` | `docs/noldor/drain-mode.md` | — |
+| `--resume <slug>` under `NOLDOR_DRAIN=1` | `docs/noldor/drain-mode.md` | — |
+| `--resume <slug>` | the row of the path it resumes | — |
+
+For the three drain rows the page is the whole contract: no step of this router after the entry check runs.
+
 ## Flow
 
+**Entry check — before Step 0.** `/noldor-gate --drain <slug>` is an unattended drain child: the supervisor sets `NOLDOR_DRAIN=1` and disallows `AskUserQuestion`, so any interactive step would stall the iteration until its timeout. Run neither Step 0 nor Step 1. **Read now:** [`docs/noldor/drain-mode.md`](../../../docs/noldor/drain-mode.md) — and follow it end to end for that exact `<slug>`: its Finish path when `--finish` rides the invocation or `printenv NOLDOR_DRAIN_FINISH` shows `1`, its Resume path for `--resume <slug>` under `NOLDOR_DRAIN=1`. When `--drain` is absent but `printenv NOLDOR_DRAIN` shows `1`, it is still a drain run: take the slug from `NOLDOR_DRAIN_SLUG` when set, else from the page's fallback. An interactive `--resume <slug>` goes to **--resume mode** at the end of this file; every other interactive run continues at Step 0.
+
 **Reading an exit code through `pnpm`.** `pnpm` reports every failing script as exit 1, so every "exit 2 / 3 / 4 / 10 / 11" branch in this skill reads as 1 when the command runs as `pnpm noldor …`. The CLI restates the real code on stderr as `noldor: exit code <n>` whenever it is 2 or higher — capture stderr along with stdout, and when that line is present, branch on its `<n>`, not on the shell's exit status. No line and a non-zero status means the real code is 1.
 
-0. **Priority pickup.** Run `pnpm noldor next-priority --suggestions --json` and capture stdout + exit code.
-   - **Skipped entirely when `/noldor-gate --resume <slug>` is invoked** (`--resume` short-circuits to the `--resume mode` section at the bottom of this skill — it does not pass through Step 0 or Step 1).
-   - **Skipped entirely when `/noldor-gate --drain <slug>` is invoked** (headless drain) — short-circuits to the **Drain mode** section at the bottom and ships `<slug>` via `fast-track`; it does not pass through Step 0 or Step 1.
+0. **Priority pickup.** Run `pnpm noldor next-priority --suggestions --json` and capture stdout + exit code. The entry check has already routed `--resume` and `--drain` runs, so they never reach this step.
    - Exit code 2 → no in-progress FDs AND no roadmap entries. Proceed to Step 1 (path picker).
@@ -30,5 +55,3 @@
    - **On `Top priority` bucket pick:** if `topPriority.length === 1`, use that entry directly. Otherwise, fire a second `AskUserQuestion` with up to 4 options: `topPriority[0]`, `topPriority[1]` (if present), `topPriority[2]` (if present), `Back`. On entry pick: use `entry.slug` (carried in the JSON by `BacklogEntry.slug`) and `entry.suggestedPath` (stamped by `getSuggestions` per the size→path policy — see the `suggestedPath` handling below), then fall through to Step 1 with that path pre-filled.
-   - **On `Quick win` bucket pick:** if `smallHighImpact.length === 1`, use that entry directly. Otherwise, second question with both entries + `Back`. Same `suggestedPath` handling.
-   - **On `Bugfix` bucket pick:** if `bugfixes.length === 1`, use that entry directly. Otherwise, second question with up to 3 entries + `Back`. Same `suggestedPath` handling.
-   - **On `Milestone-aligned` bucket pick:** use `milestoneAligned` directly (always a single entry by construction — `BacklogEntry | null`, never a list). Same `suggestedPath` handling.
+   - **On `Quick win` or `Bugfix` bucket pick:** a single entry is used directly; otherwise a second question offers the bucket's entries (both quick wins, up to 3 bugfixes) + `Back`. **On `Milestone-aligned` pick:** use `milestoneAligned` directly — always a single entry (`BacklogEntry | null`, never a list). Same `suggestedPath` handling for all three.
    - **On `Path picker` bucket pick:** fast-track straight to Step 1 — no intermediate confirmation. To cancel, escape the path-picker prompt.
@@ -37,4 +60,4 @@
    **`suggestedPath` handling for the prefill.** Every surfaced entry carries `suggestedPath`, computed by `entryToPath(size, hasParent, touches)` in [`src/core/size-routing.ts`](../../../src/core/size-routing.ts) — the single source of truth for the size→path policy (XS/S → `fast-track`, or `micro-chore` when every path the entry's `Touches:` clause declares is on that lane; M → `specs-only-*`; L/XL → `full-*`; the `-attach` variant when the entry declares a `parent`). On pick:
-   - `fast-track` (size XS/S) → **no `/noldor-promote`** (no FD, no spec). Carry `entry.slug` forward and go straight to Step 1 with `fast-track` pre-filled; the fast-track scaffold records the slug in the session marker so the source roadmap block is retired (see "Roadmap-entry retirement" under Step 2). An entry with no `Touches:` clause is routed by size alone, so the downgrade is still a judgment call: pick `micro-chore` instead when the diff will be pure-doc or `.claude/**` prose — `checks shared-files` refuses `.claude/skills/**` from a fast-track worktree.
-   - `micro-chore` (size XS/S, every `Touches:` path on the micro-chore lane — `MICRO_CHORE_GLOBS` in [`src/core/allowlist.ts`](../../../src/core/allowlist.ts)) → **no `/noldor-promote`, no worktree.** Carry `entry.slug` forward and go straight to Step 1 with `micro-chore` pre-filled. This is where a skill edit belongs: `checks shared-files` refuses `.claude/skills/**` from a `.worktrees/` checkout, so a fast-track session would build its worktree and retire the block before the real commit is refused. The block is retired inside the micro-chore commit itself (see "Roadmap-entry retirement" under Step 2).
+   - `fast-track` (size XS/S) → **no `/noldor-promote`** (no FD, no spec). Carry `entry.slug` forward and go straight to Step 1 with `fast-track` pre-filled; the scaffold records the slug in the session marker so the source roadmap block is retired (`fast-track.md`). An entry with no `Touches:` clause is routed by size alone, so the downgrade is still a judgment call: pick `micro-chore` instead when the diff will be pure-doc or `.claude/**` prose — `checks shared-files` refuses `.claude/skills/**` from a fast-track worktree.
+   - `micro-chore` (size XS/S, every `Touches:` path on the micro-chore lane — `MICRO_CHORE_GLOBS` in [`src/core/allowlist.ts`](../../../src/core/allowlist.ts)) → **no `/noldor-promote`, no worktree.** Carry `entry.slug` forward and go straight to Step 1 with `micro-chore` pre-filled. This is where a skill edit belongs: `checks shared-files` refuses `.claude/skills/**` from a `.worktrees/` checkout, so a fast-track session would build its worktree and retire the block before the real commit is refused. The block is retired inside the micro-chore commit itself (`micro-chore.md`).
    - `specs-only-new` / `specs-only-attach` (size M) → `/noldor-promote <slug> --tier=specs-only`, then prefill that path.
@@ -50,5 +73,10 @@
 
-- `specs-only-new`: Prompt slug + category. **Create the worktree first** via `pnpm noldor worktrees create <slug>` (creates `.worktrees/<slug>` on `feat/<slug>` and runs the install; see `docs/noldor/worktree-discipline.md`). Write session marker `{ path, slug, startedAt, markerVersion: 2 }` _inside_ the worktree's `.noldor/session.json`. **Then** invoke `/noldor-promote <slug> --tier=specs-only` (or `/noldor-new-feature <slug> --tier=specs-only` when slug isn't in roadmap/backlog). Then the `noldor-spec` skill to produce the spec at `docs/design/specs/<date>-<slug>-design.md`. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, advance directly to implementation (no plan stage).
+2. **Path-specific scaffold.**
+   - `micro-chore` — **Read now:** [`micro-chore.md`](micro-chore.md) — its scaffold, the temp-branch handoff, roadmap-entry retirement and merge cleanup.
+   - `fast-track` — **Read now:** [`fast-track.md`](fast-track.md) — worktree, session marker and roadmap-entry retirement.
+   - `specs-only-new`: Prompt slug + category. **Create the worktree first** via `pnpm noldor worktrees create <slug>` (creates `.worktrees/<slug>` on `feat/<slug>` and runs the install; see `docs/noldor/worktree-discipline.md`). Write session marker `{ path, slug, startedAt, markerVersion: 2 }` _inside_ the worktree's `.noldor/session.json`. **Then** invoke `/noldor-promote <slug> --tier=specs-only` (or `/noldor-new-feature <slug> --tier=specs-only` when slug isn't in roadmap/backlog). Then the `noldor-spec` skill to produce the spec at `docs/design/specs/<date>-<slug>-design.md`. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, advance directly to implementation (no plan stage).
+   - `full-new`: Prompt slug + category. **Create the worktree first** via `pnpm noldor worktrees create <slug>` (creates `.worktrees/<slug>` on `feat/<slug>` and runs the install). Write session marker `{ path, slug, startedAt }` inside the worktree. **Then** invoke `/noldor-promote <slug> --tier=full` (or `/noldor-new-feature <slug> --tier=full` when slug isn't in roadmap/backlog). Then the `noldor-spec` skill to produce the spec. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, continue: `/noldor-draft-feature-md <slug> --from-spec` (writes FD body stubs from the spec). Then the `noldor-plan` skill. **After plan returns, run Step 2.5 with `--kind plan` again.**
+   - `specs-only-attach`, `full-attach` — **Read now:** [`attach.md`](attach.md) — the parent and enhancement prompts, the scaffold and the phase-revert lifecycle.
 
-- `full-new`: Prompt slug + category. **Create the worktree first** via `pnpm noldor worktrees create <slug>` (creates `.worktrees/<slug>` on `feat/<slug>` and runs the install). Write session marker `{ path, slug, startedAt }` inside the worktree. **Then** invoke `/noldor-promote <slug> --tier=full` (or `/noldor-new-feature <slug> --tier=full` when slug isn't in roadmap/backlog). Then the `noldor-spec` skill to produce the spec. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, continue: `/noldor-draft-feature-md <slug> --from-spec` (writes FD body stubs from the spec). Then the `noldor-plan` skill. **After plan returns, run Step 2.5 with `--kind plan` again.**
+2.5. **Multi-reviewer CR gate (mandatory pause after every spec/plan artifact).** On `specs-only-*` and `full-*` paths, every spec and every plan stops here before the next skill runs. **Read now:** [`artifact-review.md`](artifact-review.md) — lint, commit, review lanes and the continue dialog.
 
@@ -66,2 +94,15 @@
 
+4. **End-of-flow (PR flow).** When the user signals "ready to ship", run these in order. Each line names the sessions it applies to and the file that holds its steps; skip a line that does not apply. A `micro-chore` runs only lines 10 and 11.
+   1. **Refresh the FD body** — FD-carrying paths (`specs-only-*`, `full-*`). **Read now:** [`fd-close.md`](fd-close.md); on attach paths the scope comes from `attach.md`. Fast-track and micro-chore skip it — neither has an FD of its own.
+   2. **Doc-impact check** — `fast-track` only, per `fast-track.md`, before the push-gate preflight.
+   3. **Archive this session's design artifacts** — FD-carrying paths, per `fd-close.md`.
+   4. **UI baseline write-back** — UI-bearing sessions, including one whose UI emerged during implementation. **Read now:** [`design-writeback.md`](design-writeback.md).
+   5. **Architecture baseline write-back** — every path, when `docs/design/architecture/baseline.pen` exists: run `pnpm noldor checks arch-baseline`. When the session approved an architecture `.pen`, or the check reports findings, **Read now:** [`design-writeback.md`](design-writeback.md). Its exit code never blocks `pr-flow`.
+   6. **Flip FD `phase: in-progress → done`** — FD-carrying paths, per `fd-close.md`. That one commit carries the refreshed body, the archive moves, any baseline write-back and the flip.
+   7. **UI freshness (advisory)** — run `pnpm noldor checks ui-design-freshness` after the flip commit (it reads committed history, so staged edits are invisible to it) and print its per-surface rows. A red is baseline debt: surface it with the `pnpm noldor design ui-sync` remedy and continue. The blocking point is release preflight, never `pr-flow`.
+   8. **Code-stage review** — `fast-track`, `specs-only-*`, `full-*`. **Read now:** [`code-review.md`](code-review.md) — wait for artifact lanes, preflight the push gates, orchestrate, aggregate, clean up. A red aggregate goes on to `blockers.md` from there.
+   9. **Bootstrap immunity** — FD-carrying paths, per `fd-close.md`, after the green code-stage review and before `pr-flow`.
+   10. **`pnpm noldor pr-flow`** — every path. The CLI ([`src/core/pr-flow-cli.ts`](../../../src/core/pr-flow-cli.ts)) reads `.noldor/session.json`, derives its input from the session, the FD frontmatter, the `Noldor-Reviewed-Subagent` trailer and the branch's spec/plan paths, then runs preflight `gh` → `git push --force-with-lease --set-upstream origin <branch>` → `gh pr create` → `gh pr merge --auto --squash` → poll until merged. Flow diagram, push runbook and failure runbook: [`docs/noldor/pr-flow.md`](../../../docs/noldor/pr-flow.md).
+   11. **On merged, clean up** — scripted, no interactive finishing skill. **Worktree-backed paths** (`fast-track`, `specs-only-*`, `full-*`): from the **main workspace** run `git worktree remove [--force] .worktrees/<name>` then `git branch -D feat/<name>`. Do NOT use the `ExitWorktree` native tool: the framework creates worktrees with `git worktree add`, so `ExitWorktree` is a no-op that leaves the worktree and branch on disk. `-D` (force) is required because the squash merge leaves the branch's commits off `main`, so `-d` rejects them as not fully merged; `--force` on the remove only when the worktree has uncommitted changes (it should not). **Then sync local `main`: `git fetch origin main && git checkout main && git merge --ff-only origin/main`** — a PR is not finished until local `main` matches `origin/main`. If `--ff-only` rejects, stop and surface the divergence; never force it. **Micro-chore:** per `micro-chore.md`. Print `gh pr view <pr-url>` for the operator, then Step 5.
+
 5. **Next-priority handoff (always-clear).** After Step 4's PR merges and cleanup completes:
@@ -86,3 +127,3 @@
 
-**Do NOT name, summarize, paraphrase, or otherwise leak the top entry in the current session.** Even read-only mention biases the operator's framing with stale-context residue from the just-shipped work — exactly the drift the always-clear policy closes. The top entry surfaces ONLY in a fresh `/noldor-gate` Step 0 invocation (per the [`feedback-auto-clear-between-features`] memory + the 2026-05-13 incident where the controller leaked the entry name at handoff). Same rule applies if the operator asks "what's next?" in the dirty session — answer: "the roadmap holds it; /clear + /noldor-gate to see."
+**Do NOT name, summarize, paraphrase, or otherwise leak the top entry in the current session.** Even read-only mention biases the operator's framing with stale-context residue from the just-shipped work — exactly the drift the always-clear policy closes. The top entry surfaces ONLY in a fresh `/noldor-gate` Step 0 invocation. Same rule applies if the operator asks "what's next?" in the dirty session — answer: "the roadmap holds it; /clear + /noldor-gate to see."
 
@@ -92,2 +133,2 @@
 
-Re-establish session marker for an existing in-progress FD. Reads tier from FD frontmatter, infers path (`specs-only-new` or `full-new` based on tier; user can override to `*-attach` if extending an existing FD). Advances straight to the Step 2 scaffold.
+Re-establish session marker for an existing in-progress FD. Reads tier from FD frontmatter, infers path (`specs-only-new` or `full-new` based on tier; user can override to `*-attach` if extending an existing FD). Advances straight to the Step 2 scaffold. Under `NOLDOR_DRAIN=1` the entry check has already sent the run to `docs/noldor/drain-mode.md`.
~~~

  And mirror: `cp .claude/skills/noldor-gate/SKILL.md templates/.claude/skills/noldor-gate/SKILL.md`.

- [x] **Step 5: Run to verify PASS.**

  Run: `pnpm vitest run src/checks/__tests__/gate-skill-layout.test.ts src/checks/__tests__/gate-skill-drain-contract.test.ts`

  Expected: `Tests  9 passed (9)`.

- [x] **Step 6: Check the router.**

  Run: `wc -w .claude/skills/noldor-gate/SKILL.md && pnpm noldor checks skill-portability && pnpm noldor validate skill-catalog && pnpm noldor checks template-sync .claude/skills/noldor-gate/SKILL.md`

  Expected: `2701`; all checks exit 0.

- [x] **Step 7: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  docs(features:gate-skill-loads-only-the-branch-a-session-takes): turn the gate SKILL.md into a router

  SKILL.md now holds what every session runs — the entry check, Steps 0, 1, 3, 3.5 and 5, and Step 4 as an ordered checklist — plus a load table and a read-now line at each fork, in 2,701 words. A clean specs-only-new run loads 6,395 words, under half of the 13,690 it loaded before, and gate-skill-layout.test.ts holds the budget, the table and the Resume-path parity.

  Noldor-FD: gate-skill-loads-only-the-branch-a-session-takes
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/checks/__tests__/gate-skill-layout.test.ts .claude/skills/noldor-gate/SKILL.md templates/.claude/skills/noldor-gate/SKILL.md
  NOLDOR_ALLOW_SHARED=1 git commit -F "$msg"
  ```

  Expected: the commit lands.

---

## Task 8: Give the history its homes and repoint moved sections

**Files:**
- Modify: `docs/noldor/cr-pipeline.md`, `docs/noldor/pr-flow.md`, `docs/noldor/gotchas.md`, `docs/noldor/complexity-gating.md` and their `templates/docs/noldor/` twins

- [x] **Step 1: Brief the rules.**

  Run: `pnpm noldor rules brief --file docs/noldor/gotchas.md --stage code`

- [x] **Step 2: Apply the four page changes.** `cr-pipeline.md` gains why the round budget is three and the `--unresolved-only` story; `pr-flow.md` gains the push-gate re-earn story and repoints its two section links to `fast-track.md` and `attach.md`; `gotchas.md` gains § Gate sessions (the Step 5 leak and the micro-chore reset); `complexity-gating.md` repoints its retirement link.

~~~diff
--- a/docs/noldor/cr-pipeline.md
+++ b/docs/noldor/cr-pipeline.md
@@ -597,2 +597,8 @@
 
+- **A spec or plan round closed at the re-round cap leaves its sink red by
+  design, so the gate's Step 4 wait for artifact lanes passes
+  `--unresolved-only`.** Without the flag the kind-less aggregate re-redded on
+  findings already fixed in commits, and each such session proceeded by hand
+  on the Q-0069 precedent (a green code stage earns the receipt) — Q-0154, hit
+  on Q-0131 and again on Q-0092.
 - **Never comma-join `--artifact` for `--kind code`.** `cr orchestrate --kind code
@@ -815,2 +821,9 @@
 
+Why three: before the cap, an operator loop fed itself — every fix is new
+prose, so a delta review of it near-guarantees a new finding. Q-0073 ran 14
+rounds, Q-0078 11 and Q-0124 10; in Q-0112, rounds 1–3 caught real design
+flaws while rounds 4–11 were self-consistency findings seeded by the previous
+round's fix. Three rounds is the span in which every real design flaw on
+record surfaced.
+
 So the dispatch count and the red count are different numbers, and a series can
~~~

~~~diff
--- a/docs/noldor/pr-flow.md
+++ b/docs/noldor/pr-flow.md
@@ -34,3 +34,3 @@
 
-That predicate exists because `/noldor-gate` retires an entry's roadmap block *before* implementing it (skill Step 2, "Roadmap-entry retirement"), so the oldest commit on a drained fast-track branch is bookkeeping. Sourcing the title from the first commit put `docs(roadmap): retire <slug> — shipped via fast-track (no FD)` on every drained PR and never named the change that shipped.
+That predicate exists because `/noldor-gate` retires an entry's roadmap block *before* implementing it (skill Step 2 → [`fast-track.md`](../../.claude/skills/noldor-gate/fast-track.md), "Roadmap-entry retirement"), so the oldest commit on a drained fast-track branch is bookkeeping. Sourcing the title from the first commit put `docs(roadmap): retire <slug> — shipped via fast-track (no FD)` on every drained PR and never named the change that shipped.
 
@@ -109,2 +109,4 @@
 
+The gate preflights the push gates before its code-stage review (`pnpm noldor checks push-gates`) for a related reason: a gate that refuses the push only after the review forces a fix commit, which changes the tree, invalidates the `Noldor-Reviewed-Subagent` receipt and buys a full re-review with no review value. Q-0112 lost 2 of its 6 code-stage dispatches and 3 failed pushes that way.
+
 ### `pnpm noldor pr-flow` recovery — when the CLI itself is broken
@@ -176,3 +178,3 @@
 
-These commits are written by `/noldor-gate` Step 2 scaffolding (see [`.claude/skills/noldor-gate/SKILL.md`](../../.claude/skills/noldor-gate/SKILL.md) "Phase-revert lifecycle (attach paths)").
+These commits are written by `/noldor-gate` Step 2 scaffolding (see [`.claude/skills/noldor-gate/attach.md`](../../.claude/skills/noldor-gate/attach.md) "Phase-revert lifecycle").
 
~~~

~~~diff
--- a/docs/noldor/gotchas.md
+++ b/docs/noldor/gotchas.md
@@ -182,2 +182,18 @@
   real installed Chrome. (Q-0231)
+
+## Gate sessions
+
+- **Naming the next roadmap entry at the gate's Step 5 handoff biases the next
+  session.** On 2026-05-13 the controller leaked the top entry's name while
+  handing off, and the next session's framing carried the shipped work's context
+  into it. That is why Step 5 prints only that the queue is non-empty and
+  never names, summarizes or paraphrases the entry — even when the operator
+  asks what is next.
+- **A micro-chore's `git reset --hard origin/main` once wiped uncommitted
+  `ideas.md` edits.** A drain's micro-chore iteration rewound local `main`
+  under another process's in-flight edits, and uncommitted content never
+  enters git's object store, so nothing could recover it. That is why the
+  micro-chore handoff stashes unrelated edits (`git stash push
+  --include-untracked -m noldor-microchore`) before the reset and pops them
+  after.
 
~~~

~~~diff
--- a/docs/noldor/complexity-gating.md
+++ b/docs/noldor/complexity-gating.md
@@ -38,3 +38,3 @@
 
-The mapping is encoded once in [`sizeToPath()`](../../src/core/size-routing.ts) (with `sizeToTier()` and `sizeSkipsSpec()`); `getSuggestions()` stamps each entry surfaced at `/noldor-gate` Step 0 with a `suggestedPath` so the gate reads the verdict instead of re-deriving it in prose. Because XS/S route to `fast-track` (no FD, no `/noldor-promote`), `/noldor-gate` retires the source roadmap block itself when the fast-track ships — see the gate skill's "Roadmap-entry retirement" step.
+The mapping is encoded once in [`sizeToPath()`](../../src/core/size-routing.ts) (with `sizeToTier()` and `sizeSkipsSpec()`); `getSuggestions()` stamps each entry surfaced at `/noldor-gate` Step 0 with a `suggestedPath` so the gate reads the verdict instead of re-deriving it in prose. Because XS/S route to `fast-track` (no FD, no `/noldor-promote`), `/noldor-gate` retires the source roadmap block itself when the fast-track ships — see the gate skill's [`fast-track.md`](../../.claude/skills/noldor-gate/fast-track.md) "Roadmap-entry retirement" step.
 
~~~

- [x] **Step 3: Mirror the twins and check.**

  Run:

  ```bash
  for p in cr-pipeline pr-flow gotchas complexity-gating; do cp "docs/noldor/$p.md" "templates/docs/noldor/$p.md"; done
  pnpm noldor validate noldor && pnpm noldor checks template-sync docs/noldor/cr-pipeline.md docs/noldor/pr-flow.md docs/noldor/gotchas.md docs/noldor/complexity-gating.md
  ```

  Expected: both exit 0.

- [x] **Step 4: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  docs(noldor): move the gate skill's incident history into the runbooks

  The round counts behind the re-round cap go to cr-pipeline.md's round budget, the --unresolved-only story to its review gotchas, the push-gate re-earn story to pr-flow.md's push runbook, and the Step 5 leak and the micro-chore reset to a new gotchas.md section. pr-flow.md and complexity-gating.md point at the branch files that now hold the retirement and phase-revert steps.

  Noldor-FD: gate-skill-loads-only-the-branch-a-session-takes
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add docs/noldor/cr-pipeline.md docs/noldor/pr-flow.md docs/noldor/gotchas.md docs/noldor/complexity-gating.md templates/docs/noldor/cr-pipeline.md templates/docs/noldor/pr-flow.md templates/docs/noldor/gotchas.md templates/docs/noldor/complexity-gating.md
  git commit -F "$msg"
  ```

  Expected: the commit lands (`docs(noldor)` covers every staged page).

---

## Task 9: Re-record the skill-size baseline and verify the split

**Files:**
- Modify: `.noldor/skill-size-baseline.json`

- [ ] **Step 1: Watch the ratchet refuse the new files.**

  Run: `pnpm noldor skill-size check`

  Expected: exit 1, naming the nine branch files as `no baseline entry`; `SKILL.md` is within its baseline (it fell).

- [ ] **Step 2: Re-record.**

  Run: `pnpm noldor skill-size baseline && pnpm noldor skill-size check`

  Expected: `lowered .claude/skills/noldor-gate/SKILL.md — 2701 words, baseline 13690 (-10989)` and nine `new` lines; then `skill-size: 24 skill files within their baseline`.

- [ ] **Step 3: Verify the whole split.**

  Run: `pnpm vitest run src/checks && pnpm noldor checks skill-portability && pnpm noldor validate skill-catalog && pnpm noldor validate noldor && pnpm noldor checks template-sync`

  Expected: all exit 0.

- [ ] **Step 4: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  chore(features:gate-skill-loads-only-the-branch-a-session-takes): re-record the skill-size baseline after the gate split

  The router is recorded at 2,701 words and each branch file at its own count, so the ratchet now holds the split.

  Noldor-FD: gate-skill-loads-only-the-branch-a-session-takes
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add .noldor/skill-size-baseline.json
  git commit -F "$msg"
  ```

  Expected: the commit lands.
