# Gate Skill Loads Only the Branch a Session Takes Implementation Plan — Part 2: one drain contract

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** every drain run — `--drain`, `--drain --finish`, and `--resume` under `NOLDOR_DRAIN=1` — follows `docs/noldor/drain-mode.md` alone, whichever runner spawned it, and the gate skill no longer restates drain mode.

**Architecture:**
- **The page absorbs what only the skill held.** The fast-track scaffold (worktree, marker, "run everything from inside it"), the retired-ID staging, the defensive `suggestedPath` check, the design-debt and review-state cleanup lines a claude child got from gate Step 4, and — per the spec's resolution of the round-1 review — the FD close-out on the Resume path, as runner-neutral commands. The retirement moves to "right after the scaffold", the order the gate already used and that `docs/noldor/pr-flow.md` describes.
- **The skill routes instead of restating.** Its entry check sends drain runs to the page, and its three drain sections go. This part edits the monolith `SKILL.md` in place with a patch; Part 3 replaces the file with the router, rebuilt from `c7bc4bc`, so this interim edit uses the router's exact text for the lines it touches.
- **Patches.** Every `~~~diff` block applies with `git apply` from the repo root: save it to a file and run `git apply <file>`.

**Tech Stack:** Markdown, vitest, the `noldor` CLI.

**Parts:** 2 of 4.

**Spec:** [`2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md`](../specs/2026-09-25-gate-skill-loads-only-the-branch-a-session-takes-design.md) — § Drain: one canonical page; acceptance criteria 5–6.

---

## File Structure

- `src/checks/__tests__/gate-skill-drain-contract.test.ts` — **Create.** Pins the one-page contract against the real files.
- `docs/noldor/drain-mode.md` + `templates/docs/noldor/drain-mode.md` — **Modify.** The whole drain contract.
- `.claude/skills/noldor-gate/SKILL.md` + `templates/.claude/skills/noldor-gate/SKILL.md` — **Modify.** Drain sections out; the entry check routes to the page.

---

## Task 5: Make drain-mode.md the only drain contract

**Files:**
- Test: `src/checks/__tests__/gate-skill-drain-contract.test.ts`
- Modify: `docs/noldor/drain-mode.md`, `templates/docs/noldor/drain-mode.md`, `.claude/skills/noldor-gate/SKILL.md`, `templates/.claude/skills/noldor-gate/SKILL.md`

- [ ] **Step 1: Brief the rules.**

  Run: `pnpm noldor rules brief --file docs/noldor/drain-mode.md --file .claude/skills/noldor-gate/SKILL.md --file src/checks/__tests__/gate-skill-drain-contract.test.ts --stage code`

  Expected: `sibling-scope-trailer` is named for the page.

- [ ] **Step 2: Write the failing test.** Create `src/checks/__tests__/gate-skill-drain-contract.test.ts`:

  ```ts
  // @tests: gate-skill-loads-only-the-branch-a-session-takes
  import { readdirSync, readFileSync } from 'node:fs';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';

  const ROOT = join(__dirname, '..', '..', '..');
  const GATE_DIR = join(ROOT, '.claude', 'skills', 'noldor-gate');
  const DRAIN_PAGE = readFileSync(join(ROOT, 'docs', 'noldor', 'drain-mode.md'), 'utf8');

  /** The `## <heading…>` section of a markdown page, up to the next H2. */
  function section(page: string, heading: string): string {
    const start = page.indexOf(`\n## ${heading}`);
    if (start < 0) throw new Error(`no "## ${heading}" section`);
    const next = page.indexOf('\n## ', start + 1);
    return page.slice(start, next < 0 ? undefined : next);
  }

  describe('the drain contract lives on one page', () => {
    it('no gate skill file carries a drain or finish mode section', () => {
      for (const file of readdirSync(GATE_DIR).filter((f) => f.endsWith('.md'))) {
        const headings = readFileSync(join(GATE_DIR, file), 'utf8')
          .split('\n')
          .filter((line) => /^#{1,6} /.test(line));
        expect(
          headings.filter((h) => /drain mode|finish mode/i.test(h)),
          file,
        ).toEqual([]);
      }
    });

    it('the gate entry check sends a drain run to drain-mode.md', () => {
      expect(readFileSync(join(GATE_DIR, 'SKILL.md'), 'utf8')).toContain(
        '**Read now:** [`docs/noldor/drain-mode.md`](../../../docs/noldor/drain-mode.md)',
      );
    });

    it('the page scaffolds the fast-track worktree and marker a claude child took from the skill', () => {
      const branch = section(DRAIN_PAGE, 'Branch discipline');
      expect(branch).toContain('pnpm noldor worktrees create <slug> --branch fast/<slug>');
      expect(branch).toContain('"path": "fast-track"');
      expect(section(DRAIN_PAGE, 'Roadmap retirement')).toContain('.noldor/retired-entry-ids.json');
      expect(section(DRAIN_PAGE, 'Autonomous end-of-flow')).toContain(
        'pnpm noldor checks arch-baseline',
      );
    });

    it('the Resume path archives, flips and bootstraps the FD', () => {
      const resume = section(DRAIN_PAGE, 'Resume path');
      for (const command of [
        'pnpm noldor design archive',
        'pnpm noldor features phase-flip-done',
        'pnpm noldor cr bootstrap',
      ]) {
        expect(resume).toContain(command);
      }
    });
  });
  ```

- [ ] **Step 3: Run to verify FAIL.**

  Run: `pnpm vitest run src/checks/__tests__/gate-skill-drain-contract.test.ts`

  Expected: `Tests  4 failed (4)` — the skill still has its `## Drain mode` and `#### Finish mode` headings and no read-now line, and the page has no Scaffold bullet, no retired-ID staging, no design-debt line and a two-command Resume path.

- [ ] **Step 4: Rewrite the page.** Apply this change to `docs/noldor/drain-mode.md`, then mirror it: `cp docs/noldor/drain-mode.md templates/docs/noldor/drain-mode.md`.

~~~diff
--- a/docs/noldor/drain-mode.md
+++ b/docs/noldor/drain-mode.md
@@ -11,8 +11,8 @@
 watch`). The supervisor owns the loop, retries, skips, and the lock; each child
-ships exactly one entry and exits. Claude children receive `/noldor-gate --drain
-<slug>` and follow the gate skill's drain-mode section; prose-dispatch runners
-(codex, opencode — see the [flag mapping](agent-runtimes.md)) receive a
-self-contained directive that points here. This page is that directive's
-canonical referent: it restates the drain contract without any slash-command
-dependency, so the prompt stays a thin pointer.
+ships exactly one entry and exits. Every runner follows this page: claude
+children receive `/noldor-gate --drain <slug>`, whose entry check sends them
+here; prose-dispatch runners (codex, opencode — see the
+[flag mapping](agent-runtimes.md)) receive a self-contained directive that
+points here. It is the whole drain contract, with no slash-command dependency,
+so the prompt stays a thin pointer and no second rendering exists to drift.
 
@@ -26,2 +26,5 @@
   skipped): never pick a listed entry.
+- The roadmap path ships `fast-track` entries only. If the entry's
+  `suggestedPath` is not `fast-track`, exit without scaffolding — the
+  supervisor pre-filters scope, so this is a defensive check.
 - **Oversize guard:** before scaffolding anything, run
@@ -76,5 +79,11 @@
   `git log origin/main..fast/<slug>` range) before discarding. This
-  per-slug removal is the only worktree a drain child deletes.
-- Do the work on that branch and run every noldor command from inside its
-  checkout/worktree.
+  per-slug removal is the only worktree a drain child deletes — the
+  supervisor never blanket-wipes `.worktrees/*`.
+- **Scaffold.** Create the worktree with
+  `pnpm noldor worktrees create <slug> --branch fast/<slug>`, change into it,
+  and write the session marker `.noldor/session.json` there:
+  `{ "path": "fast-track", "slug": "<slug>", "startedAt": "<ISO timestamp>" }`.
+  Do the work on that branch and run every noldor command — the session
+  marker, `set-autonomous` and `pr-flow` included — from inside that
+  worktree.
 
@@ -90,5 +99,5 @@
   from the changed files, so skipping it converts guidance into findings.
-- This is the runner-neutral half of rule injection: a codex/opencode
-  implementer child gets it from this page, a claude child from
-  `/noldor-gate` Step 3.5. Keep the two renderings in sync.
+- Every drain child gets rule injection from this page; an interactive gate
+  session gets it from `/noldor-gate` Step 3.5. Keep the two renderings in
+  sync.
 
@@ -96,5 +105,11 @@
 
-- Implement the entry, then remove its roadmap block **on the branch**:
-  `pnpm noldor roadmap remove-block <slug>`. Absence of the block on `main`
-  after merge is the supervisor's success oracle.
+- Right after the scaffold, remove the entry's roadmap block **on the
+  branch**: `pnpm noldor roadmap remove-block <slug>`. Absence of the block on
+  `main` after merge is the supervisor's success oracle.
+- Commit the removal with `.noldor/retired-entry-ids.json` whenever the CLI
+  wrote it: when the block carried an `- id:`, the CLI records it there so
+  `blocked-by:` references keep resolving, and an unstaged map never reaches
+  `main`. `git add .noldor/retired-entry-ids.json` exits 128 when the file
+  does not exist, so let that `add` fail and gate the commit on
+  `git diff --cached --quiet -- docs/roadmap.md .noldor/retired-entry-ids.json`.
 
@@ -112,2 +127,8 @@
   Exit 2 means the owner list could not be built, never "no owners".
+- Design debt: when `docs/design/architecture/baseline.pen` exists, run
+  `pnpm noldor checks arch-baseline`; then run
+  `pnpm noldor checks ui-design-freshness` after the last commit. Print both
+  checks' rows. A headless child cannot drive the pen.dev editor to write a
+  baseline back, so the rows are debt, never a reason to stop — release
+  preflight holds the line.
 - Preflight the push-range gates **before** the code-stage CR, while no receipt
@@ -155,2 +176,7 @@
   or `--base-sha origin/main` to review the whole branch. (Q-0292)
+- Once the code-stage aggregate is green, remove this slug's review state so
+  stale failure context cannot leak into a later retry:
+  `rm -f .noldor/cr/<slug>-escalation-context.md .noldor/cr/autofix/<slug>-{spec,plan,code}.json{,.bad} .noldor/cr/decisions/<slug>-{spec,plan,code}.json`
+  (enumerate the files; a `<slug>-*` glob would also match a sibling slug that
+  shares the prefix).
 - Ship via `pnpm noldor pr-flow` (auto-merge; polls until the PR merges).
@@ -189,3 +215,6 @@
 - Commit and push gates run unchanged: hooks inject the `Noldor-*` trailers
-  from the session marker; drain mode never bypasses them.
+  from the session marker; drain mode never bypasses them. A commit that mixes
+  code with `docs/noldor/` pages keeps its code scope only with a
+  `Noldor-Sibling-Scope: noldor:<page>, …` trailer naming every staged page
+  (see [`git-and-commits.md`](git-and-commits.md)).
 - **Never background these commands, and never end the run before the PR
@@ -259,6 +288,32 @@
   `docs/design/plans/<date>-<slug>.md` must exist. If either is missing,
-  exit non-zero immediately — never improvise a design.
-- Execute the plan task-by-task inline, then the same autonomous end-of-flow
-  as above plus the FD seams: refresh the FD's Usage section and flip the
-  phase before merge (`pnpm noldor features phase-flip-done <slug>`).
+  print the missing path to stderr and exit non-zero immediately — never
+  improvise a design.
+- Write the session marker inside the worktree:
+  `{ "path": "full-new", "slug": "<slug>", "startedAt": "<ISO timestamp>" }`
+  (an FD with a plan is full-tier).
+- Mark the session autonomous (`pnpm noldor noldor set-autonomous`), then
+  execute the plan task-by-task inline: read the plan, do each task with your
+  normal tools, commit at each task's Commit step, tick `- [ ]` → `- [x]`.
+  Never start a spec or plan dialogue, and never pause at a review
+  continue-dialog.
+- Before the push-gate preflight, close the FD, in this order:
+  1. Refresh the FD body — User Story and Usage from the spec, the code and
+     the tests (in Claude Code:
+     `/noldor-draft-feature-md <slug> --refresh --yes`; elsewhere by hand).
+     Stage nothing yet.
+  2. Assert the index is empty (`git diff --cached --quiet`), then run
+     `pnpm noldor design archive`: it moves this session's spec and plan into
+     `archive/` and leaves the moves staged.
+  3. Design write-backs: a headless child cannot drive the pen.dev editor, so
+     print the debt instead — the rows of `pnpm noldor checks arch-baseline`
+     when `docs/design/architecture/baseline.pen` exists, and the
+     `pnpm noldor design ui-sync` debt when the diff touches
+     `consumer.uiPaths`.
+  4. `pnpm noldor features phase-flip-done <slug>`, then
+     `git add docs/features/<slug>.md` and commit the index as one commit
+     (`docs(features:<slug>): mark phase=done + archive design artifacts`).
+- Then the autonomous end-of-flow above, without `--profile fast-track`. After
+  the green code-stage review and before `pr-flow`, run
+  `pnpm noldor cr bootstrap --slug <slug>` — a no-op unless the FD declares
+  `introduces-gate`.
 - Never pause for a lane picker or PR approval.
@@ -273,7 +328,7 @@
 
-Drain mode is stricter than plain autonomous mode: it requires the
+Print no next-priority handoff and ask for no `/clear`: the supervisor is the
+loop. Drain mode is stricter than plain autonomous mode: it requires the
 headless-safe config set (`autonomous.onFailure: "abort"`,
 `skipLanePicker: true`, `requireHumanPrApproval: false`) — the supervisor
-refuses to start otherwise. The Claude-path rendering of this contract lives
-in the gate skill's Drain-mode section; keep the two in sync.
+refuses to start otherwise.
 
~~~

- [ ] **Step 5: Take drain mode out of the skill.** Apply this change to `.claude/skills/noldor-gate/SKILL.md`, then mirror it: `cp .claude/skills/noldor-gate/SKILL.md templates/.claude/skills/noldor-gate/SKILL.md`. It rewrites Parameters, the entry check, Step 0's two skip bullets and `--resume mode` with the router's exact text, and deletes the `--resume` drain section and drain + finish mode:

~~~diff
--- a/.claude/skills/noldor-gate/SKILL.md
+++ b/.claude/skills/noldor-gate/SKILL.md
@@ -11,8 +11,6 @@
 
-- `--resume <slug>` — resume an in-progress FD (post-backfill); skips path picker.
-- `--drain <slug>` — **headless drain entry (supervisor-only).** Ship `<slug>` via `fast-track` with zero `AskUserQuestion`s; short-circuits the interactive Step 0 / Step 1 straight to the **Drain mode** section. The autonomous queue-drain supervisor passes this on every spawned `claude --print`; not for interactive use.
-- `--finish` — **only valid alongside `--drain <slug>` (supervisor-only).** The branch already carries
-  committed work from a prior child that never opened a PR; reuse it and run Step 4 delivery only. See
-  **Finish mode** under the Drain-mode section.
-- All other invocations are interactive.
+- `--resume <slug>` — resume an in-progress FD; skips the path picker (see **--resume mode** at the end).
+- `--drain <slug>` — **headless drain entry, supervisor-only.** The autonomous queue-drain supervisor passes it on every spawned `claude --print`; never for interactive use.
+- `--finish` — **only with `--drain <slug>`, supervisor-only.** The branch already carries committed work that a prior child never delivered.
+- Every other invocation is interactive.
 
@@ -20,3 +18,3 @@
 
-**Drain-mode entry check — do this before Step 0.** If this gate was invoked as **`/noldor-gate --drain <slug>`** (the autonomous supervisor's headless entry — it also sets `NOLDOR_DRAIN=1`), this is an unattended drain run — **do NOT execute the interactive Step 0 / Step 1 below.** Those steps fire `AskUserQuestion`, which the supervisor disallows in the headless child (`--disallowed-tools AskUserQuestion`), so any prompt stalls the iteration until its timeout. Skip straight to the **Drain mode (`NOLDOR_DRAIN=1`)** section near the end of this skill and ship **that exact `<slug>`** per its step overrides — `fast-track` path, end-of-flow autonomous, zero prompts. When `--finish` also rides the invocation (or `printenv NOLDOR_DRAIN_FINISH` shows `1`), follow the **Finish mode** sub-section instead of the from-scratch step overrides — the branch already holds the work. (Belt-and-suspenders: if `--drain` is somehow absent but `printenv NOLDOR_DRAIN` shows `1`, still treat it as a drain run — use `NOLDOR_DRAIN_SLUG` when set, else `topPriority[0]`.) Interactive invocations (no `--drain`, `NOLDOR_DRAIN` unset) fall through to Step 0 below as normal.
+**Entry check — before Step 0.** `/noldor-gate --drain <slug>` is an unattended drain child: the supervisor sets `NOLDOR_DRAIN=1` and disallows `AskUserQuestion`, so any interactive step would stall the iteration until its timeout. Run neither Step 0 nor Step 1. **Read now:** [`docs/noldor/drain-mode.md`](../../../docs/noldor/drain-mode.md) — and follow it end to end for that exact `<slug>`: its Finish path when `--finish` rides the invocation or `printenv NOLDOR_DRAIN_FINISH` shows `1`, its Resume path for `--resume <slug>` under `NOLDOR_DRAIN=1`. When `--drain` is absent but `printenv NOLDOR_DRAIN` shows `1`, it is still a drain run: take the slug from `NOLDOR_DRAIN_SLUG` when set, else from the page's fallback. An interactive `--resume <slug>` goes to **--resume mode** at the end of this file; every other interactive run continues at Step 0.
 
@@ -24,5 +22,3 @@
 
-0. **Priority pickup.** Run `pnpm noldor next-priority --suggestions --json` and capture stdout + exit code.
-   - **Skipped entirely when `/noldor-gate --resume <slug>` is invoked** (`--resume` short-circuits to the `--resume mode` section at the bottom of this skill — it does not pass through Step 0 or Step 1).
-   - **Skipped entirely when `/noldor-gate --drain <slug>` is invoked** (headless drain) — short-circuits to the **Drain mode** section at the bottom and ships `<slug>` via `fast-track`; it does not pass through Step 0 or Step 1.
+0. **Priority pickup.** Run `pnpm noldor next-priority --suggestions --json` and capture stdout + exit code. The entry check has already routed `--resume` and `--drain` runs, so they never reach this step.
    - Exit code 2 → no in-progress FDs AND no roadmap entries. Proceed to Step 1 (path picker).
@@ -418,21 +414,5 @@
 ## --resume mode
-
-Re-establish session marker for an existing in-progress FD. Reads tier from FD frontmatter, infers path (`specs-only-new` or `full-new` based on tier; user can override to `*-attach` if extending an existing FD). Advances straight to the Step 2 scaffold.
-
-### Drain mode (`NOLDOR_DRAIN=1`)
 
-When `--resume <slug>` runs under the drain supervisor (env `NOLDOR_DRAIN=1`, set by the `runDrain` loop on every spawn — source-independent), behaviour changes **only under that env var** — the interactive `--resume` path (env unset) is unchanged. This is what `plansSource` (`pnpm noldor autonomous run --source plans`) relies on to ship already-designed in-progress FDs unattended.
+Re-establish session marker for an existing in-progress FD. Reads tier from FD frontmatter, infers path (`specs-only-new` or `full-new` based on tier; user can override to `*-attach` if extending an existing FD). Advances straight to the Step 2 scaffold. Under `NOLDOR_DRAIN=1` the entry check has already sent the run to `docs/noldor/drain-mode.md`.
 
-After re-establishing the session marker and creating/force-recreating the `feat/<slug>` worktree:
-
-1. **Detect committed design.** Confirm the FD carries BOTH a spec and a plan in the worktree (they are committed on the feature branch — `plansSource` already gated on this, so this is a defensive re-check):
-   - spec: `ls docs/design/specs/*-<slug>-design.md` resolves to ≥1 file.
-   - plan: `ls docs/design/plans/*-<slug>.md` resolves to ≥1 file.
-
-   (These globs are a coarse defensive existence re-check only — `plansSource.nextItem` already applied the date-anchored `<date>-<slug>-design.md` / `<date>-<slug>.md` match before spawning, so a `runner`-vs-`plan-runner` suffix false-match here would at worst let an already-vetted FD through, never block one.)
-2. **Both present →** run `pnpm noldor noldor set-autonomous` (sets `session.autonomous = true`), then advance **directly to inline implementation** (gate autonomous-mode rules: read the plan MD, execute task-by-task, commit at each boundary, tick `- [x]`). Do **NOT** invoke `noldor-spec` or `noldor-plan`, and do **NOT** pause at any Step 2.5 continue-dialog. Zero `AskUserQuestion` — the `--disallowed-tools AskUserQuestion` backstop would otherwise hang the iteration until the per-iteration timeout.
-3. **Either missing →** this is specs-source territory (phase 2); the drain should not have spawned it. Print the missing-artifact path to stderr and exit non-zero so the supervisor's retry-then-skip handles it. Do NOT enter a design stage under drain.
-
-Step 4 autonomous end-of-flow then ships the PR on `feat/<slug>` and Step 5 exits clean, exactly as the queue-drain fast-track path does.
-
 ## Autonomous mode
@@ -469,129 +449 @@
 **Trade-off:** Autonomous mode trades operator-visibility for momentum. If the plan was wrong, the cost is felt at Step 4 code-stage CR (subagent flags blockers → escalate fires). The escape hatch is `autonomous.onFailure: 'prompt'` (default), which keeps the interactive escalate dialog and lets the operator regain control without manually clearing the session flag.
-
-## Drain mode (`NOLDOR_DRAIN=1`)
-
-Runner-neutral twin: [`docs/noldor/drain-mode.md`](../../../docs/noldor/drain-mode.md) restates
-this drain contract for prose-dispatch runners (a codex/opencode implementer child receives a
-self-contained prose directive pointing there instead of `/noldor-gate --drain <slug>`). Keep the two
-renderings in sync.
-
-The [Autonomous Queue-Drain Runner](../../../docs/features/autonomous-queue-drain-runner.md)
-(`pnpm noldor autonomous queue-drain`) is an external supervisor that spawns one fresh headless
-`claude --print "/noldor-gate --drain <slug>"` per fast-track roadmap entry, also setting `NOLDOR_DRAIN=1` in the child's
-environment. When invoked this way, this gate run takes **zero `AskUserQuestion`s** — the
-supervisor backstops a forgotten branch by spawning `claude` with `--disallowed-tools AskUserQuestion`
-(any prompt then fails fast instead of hanging) plus a per-iteration timeout. The supervisor owns the
-loop / retry / skip / lock; each gate run only ships its one entry. Step overrides:
-
-- **Step 0:** skip the bucket `AskUserQuestion`. **Ship the slug named by the `--drain <slug>`
-  argument** the supervisor passed (parallel drain, `--concurrency > 1`, assigns each concurrent child a
-  distinct slug so K near-simultaneous children don't all pick the same top entry). Fallbacks when
-  `--drain` is absent: the `NOLDOR_DRAIN_SLUG` env var if set, else `topPriority[0]`. Either way, honor
-  `NOLDOR_DRAIN_SKIP` (the comma-separated skip-set the supervisor passes through) and, if the chosen
-  entry's `suggestedPath !== 'fast-track'`, exit without scaffolding (defensive — the supervisor
-  pre-filters scope, so this should not happen). Then run
-  `pnpm noldor noldor split-check --entry <slug>` and capture stdout + exit code. On exit 2, **exit
-  without scaffolding**: echo the captured signal lines to stderr and exit non-zero so the
-  supervisor's retry-then-skip surfaces them on the escalation channel. An entry whose *label*
-  routes to fast-track but whose *body* trips the oversize signals is the mislabeled-`S` failure
-  mode (`prefix-skills-with-noldor`) — a human must re-size or split it; never ship it headless.
-  On exit 1 (checker infra error), continue — never block a drain on checker infra.
-- **Steps 1 / 1.5:** skip path-pick + path-confirm. Force `fast-track`, carrying `entry.slug`. Name
-  the branch **`fast/<slug>`** (deterministic — vs ordinary fast-track's `fast/<short-desc>`) so the
-  supervisor's `openPrExistsFor(slug)` can map slug → branch → PR exactly.
-
-  **Earn the right to destroy the branch first.** Before any `git branch -D` / `git push origin
-  --delete`, run `pnpm noldor autonomous branch-state <slug>` and branch on its exit code:
-  - **0** (`rebuild`) — nothing is ahead of `origin/main` on `fast/<slug>` or `origin/fast/<slug>`, or
-    a human closed the branch's PR unmerged (rejected work, not undelivered work): force-recreate as
-    below.
-  - **10** (`finish`) — the branch carries commits, none of its PRs was closed unmerged, and its checkout
-    is clean: **do not delete anything.** Switch to the **Finish mode** sub-section below and deliver
-    the existing work, exactly as a supervisor-sent `--finish` run would.
-  - **1** (`unknown`) — the classifier could not prove the branch is safe to discard: `git fetch
-    origin` failed, or `gh` could not say whether the PR was closed unmerged. Echo its `reason` and
-    exit non-zero; never force-recreate on an unproven branch.
-
-  The verdict mirrors both legs of the supervisor's own finish gate in `drain-loop.ts` (unshipped work
-  AND no closed-unmerged PR), substituting a clean checkout for the prior child's clean exit. Untracked
-  files are deliberately not dirt — a stray scratch file must not authorize deleting committed work.
-
-  The check exists because the finish-vs-rebuild decision otherwise lives only in the supervisor,
-  which knows whether the prior child exited 0 — a hand-invoked `/noldor-gate --drain <slug>` carries
-  no `--finish` signal and would read finished work as abandoned. On Q-0107 that branch held 7 commits
-  with green tests, and the remote-side delete is unrecoverable. A supervisor-spawned child runs the
-  same check harmlessly: the supervisor already sends `--finish` for that state, so the verdict agrees.
-
-  On verdict `rebuild`, **force-recreate** the branch (a prior interrupted run may have left it):
-  `git branch -D fast/<slug>` + `git push origin --delete fast/<slug>` (when each exists). A `rebuild`
-  verdict on a branch that *does* carry commits means its checkout had tracked uncommitted changes (a
-  half-done tree is not deliverable) or its PR was closed unmerged — the rebuild is right either way,
-  but echo the verdict's `reason` (it names the dirty path and the `git log origin/main..fast/<slug>`
-  range) before discarding. Also `git worktree remove --force`
-  its stale worktree dir first, if present, so `git branch -D` won't fail on a checked-out branch. This
-  per-slug removal is the only worktree the drain deletes — the supervisor's `syncMainCleanState` never
-  blanket-wipes `.worktrees/*`.
-- **Step 2:** the existing **Roadmap-entry retirement** sequence (above) runs unchanged — implement
-  the entry, `removeBlock` the roadmap block on the branch. `cd` into the worktree first; the session
-  marker, `set-autonomous`, and `pr-flow` all operate from there.
-- **Step 4:** run end-of-flow autonomously — `set-autonomous`, code-stage CR via `crLanes.code`,
-  `pr-flow` auto-merge, no prompts. Skip the no-FD seams (phase-flip, `draft-feature-md --refresh` —
-  fast-track carries no FD), but run the **doc-impact check** with its `--yes` refresh: the child
-  judges the candidates itself and records `Noldor-Doc-Impact:`. `pr-flow` polls until the PR actually merges — **except** under parallel
-  drain, where the supervisor sets `NOLDOR_DRAIN_OPEN_ONLY=1`: `pr-flow` then pushes + opens the PR and
-  returns at PR-open (no merge, no poll), and the supervisor's serialized merge coordinator merges it
-  one at a time. Escalation uses `cr escalate --autonomous` with `onFailure: abort` (the supervisor
-  asserts this precondition before it starts), so a red cleanly fails the iteration → the supervisor
-  retries-from-clean or skips.
-
-  **Never background the end-of-flow commands, and never end the turn before the PR exists.** Run
-  `cr orchestrate`, `cr aggregate`, and `pr-flow` in the foreground and wait for each to exit — a
-  backgrounded CR lane plus a "waiting on the reviewer lane" sign-off looks identical to a finished
-  iteration from outside (committed work, clean exit, no PR), and the supervisor reads it as a failed
-  build. Before returning, assert delivery:
-  `gh pr list --state open --head fast/<slug> --json number` must be non-empty (or, when
-  `NOLDOR_DRAIN_OPEN_ONLY` is unset, `pr-flow` must have reported the merge). If it is empty, the
-  iteration is NOT done — finish it or exit non-zero; never report success.
-- **Step 5:** exit clean — no human `/clear` + `/noldor-gate` handoff prose. The supervisor is the loop.
-
-#### Finish mode (`/noldor-gate --drain <slug> --finish`, `NOLDOR_DRAIN_FINISH=1`)
-
-The supervisor spawns this variant when a prior child for the same slug exited 0, opened no PR, and
-left `fast/<slug>` with commits ahead of `origin/main` — the assertion above having been skipped. A
-clean exit is what makes the work trustworthy: a child killed by the per-entry timeout may be
-half-done, so the supervisor rebuilds that one instead of sending it here. The work exists; only
-delivery is missing. Rebuilding it costs ~13 minutes and ~170k tokens for nothing, so this run
-delivers instead.
-
-A hand-invoked drain reaches this same mode without the flag: `pnpm noldor autonomous branch-state
-<slug>` exiting 10 at Step 1 is the equivalent verdict, derived from the branch instead of from the
-supervisor's knowledge of the prior child. It substitutes a clean checkout for the clean-exit signal —
-a dirty tree reads as half-done and routes to rebuild, matching what the supervisor would have done.
-
-- **Do NOT force-recreate the branch** and do NOT `git push origin --delete` it. Those steps exist to
-  discard *abandoned* state; here they would destroy the commits being finished. Reuse the existing
-  `.worktrees/<slug>` when present. When there is none the work may live only on the remote (a prior
-  child that pushed without opening a PR), so `git fetch origin` and resolve the branch first:
-  `git rev-parse --verify fast/<slug>` → `git worktree add .worktrees/<slug> fast/<slug>`; otherwise
-  `git worktree add -B fast/<slug> .worktrees/<slug> origin/fast/<slug>`. The plain form does not
-  resolve a remote-only branch and fails with "invalid reference" in exactly that case.
-- **Re-establish the session marker if missing.** Finish mode skips Step 1, so it assumes
-  `.noldor/session.json` survived from the prior child; on a fresh worktree it has not, and
-  `pnpm noldor noldor set-autonomous` then exits 1 (`no session marker`), after which the commit
-  hooks block delivery. Write the same fast-track marker Step 2 writes (`path: fast-track`, the
-  `slug`, `startedAt`) before continuing.
-- **Do NOT re-implement the entry.** `git log --oneline origin/main..HEAD` and
-  `git diff --stat origin/main..HEAD` show what already landed. The supervisor only sends a finish
-  run for a branch whose prior child exited cleanly — a child killed by the per-entry timeout is
-  rebuilt, not finished — so the work is complete; deliver it.
-- Re-run **Roadmap-entry retirement** — `pnpm noldor roadmap remove-block <slug>` is idempotent, so it
-  is a no-op when the prior child already retired the block and closes the gap when it did not.
-- Then **Step 4 exactly as above**, including the delivery assertion. Re-running `cr orchestrate` over
-  an existing sink is safe: `--autonomous` defaults the overwrite guard to `archive-and-overwrite`.
-- The supervisor still counts this against `--max-retries`, so a finish that fails again falls through
-  to the ordinary retry/skip path.
-
-Drain mode is orthogonal to (and stricter than) Autonomous mode: it requires the full headless-safe
-config set (`autonomous.onFailure: 'abort'`, `skipLanePicker: true`, `requireHumanPrApproval: false`)
-or the supervisor refuses to start. See the FD + its spec for the supervisor's loop, success oracle,
-and safety rails.
~~~

  The rewritten lines are verbatim from Part 3's router, so Part 3 restates nothing this step changed.

- [ ] **Step 6: Run to verify PASS.**

  Run: `pnpm vitest run src/checks/__tests__/gate-skill-drain-contract.test.ts`

  Expected: `Tests  4 passed (4)`.

- [ ] **Step 7: Check the page and the skill.**

  Run: `pnpm noldor validate noldor && pnpm noldor checks skill-portability && pnpm noldor validate skill-catalog && pnpm noldor checks template-sync docs/noldor/drain-mode.md .claude/skills/noldor-gate/SKILL.md && grep -c "^## Drain mode\|^#### Finish mode\|^### Drain mode" .claude/skills/noldor-gate/SKILL.md`

  Expected: the four checks exit 0; the grep prints `0`.

- [ ] **Step 8: Commit.**

  ```bash
  msg=$(mktemp)
  cat > "$msg" <<'EOF'
  docs(noldor:drain-mode): make drain-mode.md the only drain contract

  The gate skill's entry check now sends every drain, finish and drain-resume run to docs/noldor/drain-mode.md, and its three drain sections are gone. The page absorbs what only the skill held: the fast-track scaffold and marker, the retired-ID staging, the defensive suggestedPath check, the design-debt and review-state cleanup lines, and the FD close-out on the Resume path (refresh, archive, write-back debt, flip, bootstrap), so claude, codex and opencode children now run one contract.

  Noldor-FD: gate-skill-loads-only-the-branch-a-session-takes
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git add src/checks/__tests__/gate-skill-drain-contract.test.ts docs/noldor/drain-mode.md templates/docs/noldor/drain-mode.md .claude/skills/noldor-gate/SKILL.md templates/.claude/skills/noldor-gate/SKILL.md
  NOLDOR_ALLOW_SHARED=1 git commit -F "$msg"
  ```

  Expected: the commit lands. Without `NOLDOR_ALLOW_SHARED=1`, `checks shared-files` refuses the two skill files from this worktree (`shared-root`).
