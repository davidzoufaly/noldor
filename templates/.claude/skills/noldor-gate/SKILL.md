---
name: noldor-gate
description: Single mandatory entry for any code change. Picks one of 6 paths, scaffolds artifacts, sets session marker. Required before any Edit/Write to tracked files.
---

# /noldor-gate

Mandatory entry. Pick a path. Scaffold artifacts. Set session marker. Then proceed.

## Parameters

- `--resume <slug>` — resume an in-progress FD (post-backfill); skips path picker.
- `--drain <slug>` — **headless drain entry (supervisor-only).** Ship `<slug>` via `fast-track` with zero `AskUserQuestion`s; short-circuits the interactive Step 0 / Step 1 straight to the **Drain mode** section. The autonomous queue-drain supervisor passes this on every spawned `claude --print`; not for interactive use.
- `--finish` — **only valid alongside `--drain <slug>` (supervisor-only).** The branch already carries
  committed work from a prior child that never opened a PR; reuse it and run Step 4 delivery only. See
  **Finish mode** under the Drain-mode section.
- All other invocations are interactive.

## Flow

**Drain-mode entry check — do this before Step 0.** If this gate was invoked as **`/noldor-gate --drain <slug>`** (the autonomous supervisor's headless entry — it also sets `NOLDOR_DRAIN=1`), this is an unattended drain run — **do NOT execute the interactive Step 0 / Step 1 below.** Those steps fire `AskUserQuestion`, which the supervisor disallows in the headless child (`--disallowed-tools AskUserQuestion`), so any prompt stalls the iteration until its timeout. Skip straight to the **Drain mode (`NOLDOR_DRAIN=1`)** section near the end of this skill and ship **that exact `<slug>`** per its step overrides — `fast-track` path, end-of-flow autonomous, zero prompts. When `--finish` also rides the invocation (or `printenv NOLDOR_DRAIN_FINISH` shows `1`), follow the **Finish mode** sub-section instead of the from-scratch step overrides — the branch already holds the work. (Belt-and-suspenders: if `--drain` is somehow absent but `printenv NOLDOR_DRAIN` shows `1`, still treat it as a drain run — use `NOLDOR_DRAIN_SLUG` when set, else `topPriority[0]`.) Interactive invocations (no `--drain`, `NOLDOR_DRAIN` unset) fall through to Step 0 below as normal.

0. **Priority pickup.** Run `pnpm noldor next-priority --suggestions --json` and capture stdout + exit code.
   - **Skipped entirely when `/noldor-gate --resume <slug>` is invoked** (`--resume` short-circuits to the `--resume mode` section at the bottom of this skill — it does not pass through Step 0 or Step 1).
   - **Skipped entirely when `/noldor-gate --drain <slug>` is invoked** (headless drain) — short-circuits to the **Drain mode** section at the bottom and ships `<slug>` via `fast-track`; it does not pass through Step 0 or Step 1.
   - Exit code 2 → no in-progress FDs AND no roadmap entries. Proceed to Step 1 (path picker).
   - Exit code 0 → parse stdout as JSON. If the parse fails (corrupt stdout despite exit 0), treat as "any other exit code" below — don't try to recover. On success, build the **bucket question** dynamically — include only buckets that are non-empty:
     - `In-progress` (when `inProgress.length > 0`) — label `Continue in-progress (<inProgress.length>)`, description names the first FD's slug.
     - `Top priority` (when `topPriority.length > 0`) — label `Top priority: <topPriority[0].name>`, description names `topPriority[1].name` and `topPriority[2].name` for context when present.
     - `Quick win` (when `smallHighImpact.length > 0`) — label `Quick win: <smallHighImpact[0].name>`, description names `smallHighImpact[1].name` if present.
     - `Milestone-aligned` (when `milestoneAligned !== null`) — label `[milestone] <milestoneAligned.name>`.
     - `Path picker` (always present) — label `Path picker`, description `Skip priority pickup and go straight to path selection.`

     The bucket question caps at 4 options. When more than 4 buckets are non-empty (worst case: in-progress + top + quick + milestone + path picker = 5), drop `Milestone-aligned` from the question list — it's the lowest-priority bucket before the path-picker fast-track.

   - **On `In-progress` bucket pick:** if `inProgress.length === 1`, derive `slug = inProgress[0].slug` and invoke `/noldor-gate --resume <slug>`. Otherwise, fire a second `AskUserQuestion` with up to 4 options (first 4 entries of `inProgress`; if more than 4 in-progress FDs exist, the 4th option is `[more — see docs/features/]` which prints the full list to chat and exits the gate so the operator can re-invoke with `--resume <slug>` explicitly). On pick, invoke `/noldor-gate --resume <slug>`.
   - **On `Top priority` bucket pick:** if `topPriority.length === 1`, use that entry directly. Otherwise, fire a second `AskUserQuestion` with up to 4 options: `topPriority[0]`, `topPriority[1]` (if present), `topPriority[2]` (if present), `Back`. On entry pick: use `entry.slug` (carried in the JSON by `BacklogEntry.slug`) and `entry.suggestedPath` (stamped by `getSuggestions` per the size→path policy — see the `suggestedPath` handling below), then fall through to Step 1 with that path pre-filled.
   - **On `Quick win` bucket pick:** if `smallHighImpact.length === 1`, use that entry directly. Otherwise, second question with both entries + `Back`. Same `suggestedPath` handling.
   - **On `Milestone-aligned` bucket pick:** use `milestoneAligned` directly (always a single entry by construction — `BacklogEntry | null`, never a list). Same `suggestedPath` handling.
   - **On `Path picker` bucket pick:** fast-track straight to Step 1 — no intermediate confirmation. To cancel, escape the path-picker prompt.
   - Any other exit code → report the stderr message and stop (don't auto-skip; surfacing the error keeps roadmap parse bugs visible).

   **`suggestedPath` handling for the prefill.** Every surfaced entry carries `suggestedPath`, computed by `sizeToPath(size, hasParent)` in [`src/core/size-routing.ts`](../../../src/core/size-routing.ts) — the single source of truth for the size→path policy (XS/S → `fast-track`; M → `specs-only-*`; L/XL → `full-*`; the `-attach` variant when the entry declares a `parent`). On pick:
   - `fast-track` (size XS/S) → **no `/noldor-promote`** (no FD, no spec). Carry `entry.slug` forward and go straight to Step 1 with `fast-track` pre-filled; the fast-track scaffold records the slug in the session marker so the source roadmap block is retired (see "Roadmap-entry retirement" under Step 2). Downgrade to `micro-chore` only when the diff is pure-doc.
   - `specs-only-new` / `specs-only-attach` (size M) → `/noldor-promote <slug> --tier=specs-only`, then prefill that path.
   - `full-new` / `full-attach` (size L/XL) → `/noldor-promote <slug> --tier=full`, then prefill that path.

1. **Path picker.** Use AskUserQuestion to select one of:
   - `micro-chore` — doc/policy edits only (allowlisted)
   - `fast-track` — small code change, no FD
   - `specs-only-new` — new FD, no spec
   - `specs-only-attach` — attach to existing FD, no spec
   - `full-new` — new FD with spec
   - `full-attach` — attach with spec

2. **Path-specific scaffold:**

   **Input localization.** When a prompt asks for an input that resolves to an *existing* on-disk file — notably a parent slug (`docs/features/<slug>.md`) — don't ask blind. Run a read-only lookup first (`ls docs/features/`), surface the matching candidates, and echo the resolved path as a clickable link so the operator verifies against the real file instead of recalling it from memory. On a parent-slug prompt: list the existing FD slugs, and once picked echo `docs/features/<slug>.md` as a link before validating it exists.

   - `micro-chore`: Confirm diff scope (pre-commit allowlist enforces, see [`src/core/allowlist.ts`](../../../src/core/allowlist.ts)). Write session marker `{ path: 'micro-chore', startedAt }` (the `startedAt` timestamp is required by the schema and drives the 24h staleness expiry — see the Noldor FD Usage "Session-marker expiry"). No worktree — edits land on local `main`. Commit. After commit, gate scaffolds the temp-branch handoff so Step 4 can deliver the change via PR:
     1. `branch=micro/$(date -u +%s)` — epoch seconds, unique + sortable.
     2. `git branch $branch HEAD` — point temp branch at the new commit.
     3. `git stash push --include-untracked -m noldor-microchore` — park any *unrelated* uncommitted edits before the rewind. The step-1 commit already holds the micro-chore change itself; this protects every *other* dirty working-tree file (notably in-flight `ideas.md`/roadmap edits) from the `reset --hard` below. On a clean tree this no-ops and creates no stash entry.
     4. `git reset --hard origin/main` — rewind local main (keeps the PR shape: temp branch is the only commit ahead of `origin/main`). The step-3 stash means the reset can no longer silently destroy unrelated working-tree edits — closing the live data-loss hazard where a drain's micro-chore iteration wiped uncommitted `ideas.md` edits (uncommitted content never enters git's object store, so `git fsck` could not recover it).
     5. `git stash list | grep -q noldor-microchore && git stash pop` — restore the parked edits on top of the rewound main, only when step 3 actually stashed something. A pop conflict means an unrelated edit overlaps a file the micro-chore commit also touched; surface it to the operator instead of forcing.
     6. Step 4 end-of-flow takes over: `pr-flow.ts openAndAutoMerge()` pushes the temp branch, opens a PR (body = `Micro-chore: <commit subject>`), auto-merges, then `git branch -D $branch` + `git fetch origin main` refreshes the local main pointer.

     Trade-off: working tree is briefly "ahead of `origin/main`" between commit and reset (5-10s window). Multi-commit micro-chore is not supported in a single session — second commit fails the pre-commit allowlist (existing single-commit invariant).

   - `fast-track`: Create the worktree via `pnpm noldor worktrees create <short-desc> --branch fast/<short-desc>`. Write session marker `{ path: 'fast-track', startedAt }` — include `slug: <roadmap-slug>` when this fast-track was entered from a Step 0 roadmap pick (an XS/S `suggestedPath`). Branch named `fast/<short-desc>`. No FD. When the marker carries a `slug`, run the **Roadmap-entry retirement** sequence below so the shipped entry leaves the queue.
   - `specs-only-new`: Prompt slug + category. **Create the worktree first** via `pnpm noldor worktrees create <slug>` (creates `.worktrees/<slug>` on `feat/<slug>` and runs the install; see `docs/noldor/worktree-discipline.md`). Write session marker `{ path, slug, startedAt, markerVersion: 2 }` _inside_ the worktree's `.noldor/session.json`. **Then** invoke `/noldor-promote <slug> --tier=specs-only` (or `/noldor-new-feature <slug> --tier=specs-only` when slug isn't in roadmap/backlog). Then the `noldor-spec` skill to produce the spec at `docs/design/specs/<date>-<slug>-design.md`. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, advance directly to implementation (no plan stage).
   - `specs-only-attach`: Prompt parent slug (localize per the Input-localization note above). Prompt enhancement slug (`Enhancement slug (short, kebab-case, scopes the spec filename)?`). Validate parent FD exists. Worktree. Session `{ path, parent, enhancement, startedAt, markerVersion: 2 }`. Run the phase-revert sequence below if applicable. `noldor-spec` writing spec named `<date>-<parent>-<enhancement>-design.md`. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, advance directly to implementation (no plan stage).
   - `full-new`: Prompt slug + category. **Create the worktree first** via `pnpm noldor worktrees create <slug>` (creates `.worktrees/<slug>` on `feat/<slug>` and runs the install). Write session marker `{ path, slug, startedAt }` inside the worktree. **Then** invoke `/noldor-promote <slug> --tier=full` (or `/noldor-new-feature <slug> --tier=full` when slug isn't in roadmap/backlog). Then the `noldor-spec` skill to produce the spec. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, continue: `/noldor-draft-feature-md <slug> --from-spec` (writes FD body stubs from the spec). Then the `noldor-plan` skill. **After plan returns, run Step 2.5 with `--kind plan` again.**
   - `full-attach`: Prompt parent slug (localize per the Input-localization note above). Prompt enhancement slug (`Enhancement slug (short, kebab-case, scopes the spec/plan filename)?`). Worktree. Session `{ path, parent, enhancement, startedAt }`. Run the phase-revert sequence below if applicable. `noldor-spec` writing spec named `<date>-<parent>-<enhancement>-design.md`. **After spec returns, run Step 2.5 with `--kind spec`.** On operator approval, continue: the `noldor-plan` skill. **After plan returns, run Step 2.5 with `--kind plan` again.**

### Roadmap-entry retirement (fast-track from a roadmap pick)

When a `fast-track` session was entered from a Step 0 roadmap pick (XS/S `suggestedPath`), its session marker carries `slug`. Unlike `/noldor-promote` — which removes the source block as it scaffolds an FD — `fast-track` creates no FD, so the source roadmap block must be retired explicitly or the shipped entry re-surfaces at the next gate. Execute this on the worktree branch immediately after worktree creation + session-marker write (mirrors the phase-revert sequence). Skip entirely when the marker has no `slug` (ad-hoc fast-track not tied to a roadmap entry).

**Step 1 — remove the block (built-in no-op when the slug is already absent):**

`pnpm noldor roadmap remove-block <slug>`

The CLI is idempotent — an absent slug prints `nothing to do` and exits 0 (re-run safety). It works from any consumer repo; there is no `./src/` import to resolve. When the removed block carries an `- id:`, the CLI also records it in `.noldor/retired-entry-ids.json` (the retired-ID map) so `blocked-by:` references to the retired entry keep resolving.

**Step 2 — stage the roadmap + the retired-ID map (the CLI may have just created it), commit only if anything staged:**

`git add docs/roadmap.md && git add .noldor/retired-entry-ids.json 2>/dev/null; git diff --cached --quiet -- docs/roadmap.md .noldor/retired-entry-ids.json || git commit -m "docs(roadmap): retire <slug> — shipped via fast-track (no FD)"`

The second `git add` is allowed to fail silently: when the map file does not exist (the removed block carried no `- id:`, or the repo has never retired one), `git add` on that pathspec exits 128. Staging first and gating on `--cached` keeps the commit alive in every case. The `-- <paths>` limiter on the gate is what keeps the commit **scoped**: without it the gate fires on any staged content, so unrelated pre-staged work would land under a retirement subject. `git diff --cached --quiet -- <existing> <missing>` exits 0 rather than fatalling on the absent map (only the pathspec-less `git diff <path>` form exits 128), so the limiter is safe in the no-map case too.

The `prepare-commit-msg` hook injects `Noldor-Path: fast-track` from the session marker — and, when the marker carries a `slug`, a `Noldor-FD: <slug>` trailer too (the hook injects from `slug` unconditionally; the commit-msg validator ignores it on fast-track, where no FD file is required). The block is removed on the feature branch and lands on `main` when the fast-track PR merges — keeping retirement atomic with the shipped change rather than a separate edit on `main`.

### Phase-revert lifecycle (attach paths)

When `full-attach` or `specs-only-attach` runs, the parent FD's phase may need to revert `done → in-progress`. Execute this sequence on the worktree branch immediately after worktree creation and session-marker write.

**Step 1 — apply the revert (no-op when phase is already `in-progress` or `proposed`):**

`pnpm noldor features phase-revert <parent-slug>`

The CLI only writes when the phase actually changes (prevents an empty-diff commit attempt) and works from any consumer repo — no `./src/` import to resolve.

**Step 2 — stage the parent FD + the retired-ID map (`/noldor-promote` attach Step 7 may have just written it), commit only if anything staged:**

`git add docs/features/<parent-slug>.md && git add .noldor/retired-entry-ids.json 2>/dev/null; git diff --cached --quiet -- docs/features/<parent-slug>.md .noldor/retired-entry-ids.json || git commit -m "docs(features:<parent-slug>): revert phase done → in-progress for attach session" -m "Noldor-FD: <parent-slug>" -m "Noldor-Phase-Revert: 1"`

The map is staged here because attach retires its source block through `remove-block --retired-into <parent-slug>` (`/noldor-promote` Step 6.alt), which writes `.noldor/retired-entry-ids.json` but never stages or commits — and every downstream gate commit is pathspec-scoped to the artifact or the FD, so an unstaged map never reaches `main` and the retired ID dangles anyway. Gating on `git diff --cached --quiet` rather than `git diff --quiet <fd>` is what makes the map land in the common case where the phase-revert itself was a no-op (parent already `in-progress`) and the map is the only change. When that happens the subject describes a revert that didn't occur — reword it to `docs(triage): record retired entry ID absorbed into <parent-slug>` and keep both trailers. The same `2>/dev/null` + `--cached` reasoning as the fast-track retirement above applies: `git add` on an absent map exits 128, and the `-- <paths>` limiter keeps the commit scoped.

The `Noldor-Phase-Revert: 1` trailer is what [`src/hooks/noldor-validate-trailer.ts`](../../../src/hooks/noldor-validate-trailer.ts) reads to bypass the spec-file existence check on `specs-only-*` / `full-attach` paths. The subject line is informational only — it may be reworded freely without breaking the bypass.

The reverse transition `in-progress → done` is written by `/noldor-gate` Step 4 end-of-flow (see Step 4's first bullet) — `flipPhaseToDone` from `src/core/phase-flip-done.ts` flips phase back to `done` in the last commit before merge, so `phase: done` lands on `main` as part of the feature PR. `release-markers.ts:fillMarkers` remains the release-time safety net for any FD that didn't get flipped at end-of-flow.

Trade-off: the `### <version> (in-progress)` changelog label no longer renders for enhancement cycles whose Step 4 flip succeeded — the original asymmetric design from `framework-pr-flow-agent-auto-merge` spec §3 (gate writes revert; release-markers writes restore) is superseded. The label still renders for FDs caught by the safety net (Step 4 flip skipped or forgotten).

See the `framework-pr-flow-agent-auto-merge` changelog-integration spec §3 (2026-05-15; since pruned from `docs/design/specs/`) for the full asymmetric state-machine rationale.

2.5. **Multi-reviewer CR gate (mandatory pause after every spec/plan artifact).** Don't auto-chain into the next skill (implementation, draft-feature-md, etc.).

**Lint pass first.** Run `pnpm noldor noldor lint-plan-snippets <artifact-path>` and capture stdout + exit code. When the artifact kind is `plan`, also run `pnpm noldor noldor split-check --plan <artifact-path>` (same 0/2/1 exit contract) and append its stdout to the captured lint output; when the kind is `spec`, do the same with `pnpm noldor noldor split-check --spec <artifact-path>` (S1 word bulk / S2 criteria bloat — informational, never blocks). Exit code 0 = clean; exit code 2 = findings present (include the captured stdout verbatim in the AskUserQuestion description so the operator sees them before choosing); exit code 1 = script error (mention the error in the description but still proceed to the prompt — never block on linter infra). Findings are informational; they do not gate the choice. This Step 2.5 pass is the authoritative split checkpoint: autonomous/plans-drain paths execute committed plans without re-invoking the `noldor-plan` skill, so its post-save self-check may never have run.

**Commit the artifact first.** Surface the artifact path in one sentence, then stage + commit it (no confirm — recoverable via `git reset --soft HEAD~1` if the round needs unwinding) before any lane runs — subagent needs a `BASE_SHA..HEAD_SHA` range, standalone needs the file on disk, and every lane needs the artifact at a stable `HEAD`.

When surfacing that path, **paste the link the auto-open hook supplied** in its `additionalContext` rather than building one from the repo-relative path. (The hook always supplies the link; it opens a tab only when the repo sets `design.autoOpen: true`, which is off by default so a launch cannot raise a different editor window mid-task.) A markdown link resolves against the editor's workspace folder while the artifact's repo-relative path is relative to this session's checkout, and those diverge for every session running inside `.worktrees/<slug>/` — a hand-built link renders and does nothing. No hook output to hand (not wired, or `code` absent)? Run `pnpm noldor design open <artifact-path>` once and use its `link:` line; `NOLDOR_WORKSPACE_ROOT` overrides the resolved root when the ladder guesses wrong.

- After spec: `docs(features:<slug>): add spec for <slug>` (attach paths scope on the parent slug + name the enhancement in the subject)
- After plan: `docs(features:<slug>): add plan for <slug>`

The `prepare-commit-msg` hook injects `Noldor-Path` and `Noldor-FD` from `.noldor/session.json`. The end-of-flow review receipt (`Noldor-Reviewed-Subagent`) is amended only on the tip commit at Step 4; intermediate spec/plan commits don't need it. Committing at each confirmed checkpoint keeps the worktree branch self-documenting (spec → plan → implementation, each its own commit).

**Lane multi-select.** After the artifact commits, fire `AskUserQuestion` with multi-select on these options:

- `manual` — operator reads the artifact, returns blockers/notes via stdin prompt in the CLI
- `codex` — `pnpm noldor cr codex` second-opinion pass on the artifact (disabled inline with reason when `codex --plan-mode-probe` fails, e.g. "codex — disabled until `codex-cr-plan-review-mode` lands"). **Mandatory at `--kind spec` on `specs-only-*` / `full-*` paths (entry size M/L/XL)** — orchestrate unions it in (`withMandatoryCodex`, [`src/core/lanes.ts`](../../../src/core/lanes.ts)) even when the pick omits it, so present it pre-selected on those paths
- `reviewer` — senior-reviewer subagent over the artifact diff (self-contained `claude -p` prompt, `src/cr/lanes/subagent-dispatch.ts`). **Always-on — see below.** Present it as the pre-selected option; never offer a lane set that omits it.
- `standalone` — spawn `claude --max-thinking` in a fresh iTerm2 window for deep review (disabled inline when `fix-multiterminal-dev-flow-bug` is not at `phase: done`, e.g. "standalone — disabled until `fix-multiterminal-dev-flow-bug` lands")

The operator picks one or several. The selected list becomes the `--lanes` argument. When `.noldor/config.json` has `autonomous.skipLanePicker: true`, skip the prompt and invoke orchestrate with `--autonomous` and no `--lanes` flag (orchestrate reads lanes from `crLanes.<kind>` in config, falling back to the built-in `reviewer`-only defaults when that block is absent — a configured block overrides the defaults).

**The `reviewer` lane is mandatory at `--kind spec` and `--kind plan`, and there is no skip option.** No spec or plan reaches implementation unreviewed, so this stage offers **no `proceed-without-review`** — the only way past it is a green (or explicitly-addressed) reviewer pass. Enforcement, once orchestrate is invoked, is in code rather than prose: `withMandatoryReviewer` ([`src/core/lanes.ts`](../../../src/core/lanes.ts)) unions `reviewer` into every spec/plan lane set `resolveLanes` returns — whether it came from `--lanes` or from `crLanes.<kind>` — and orchestrate prints `lane 'reviewer' is mandatory for <kind> artifacts — added to the requested lanes` when it had to add it. `pnpm noldor validate noldor-config` refuses a `crLanes.spec` / `crLanes.plan` block that omits `reviewer`, so the config can't claim a review posture the runtime won't honor. The overwrite guard also withholds `keep-and-skip` for that lane, so a stale or red prior sink can't stand in for the review. `--kind code` is exempt from the union — its reviewer pass is enforced instead by the `Noldor-Reviewed-Subagent` receipt the pre-push hook validates. What code cannot enforce is a controller that never invokes orchestrate at all: dropping the `proceed-without-review` option above is what closes that hole, and it is prose.

**Invoke orchestrate.**

```
pnpm noldor cr orchestrate --slug <slug> --artifact <artifact-path> --kind <spec|plan> --lanes <list>
```

(Or `--autonomous` w/o `--lanes` per above.) On `address-blockers` re-rounds, also pass `--base-sha` as printed by `pnpm noldor cr autofix plan` (its `base-sha:` line — the authoritative value) so subagent + codex review only the diff; `--full-review` overrides back to whole-artifact. Do not try to read a prior artifact SHA out of a lane sink: `LaneFindings` carries `baseSha` only, never an `artifactSha`.

**Summary table.** Read orchestrate stdout and surface the per-lane summary in chat: lanes that ran, synthetic-OK lanes (empty-delta short-circuit), skipped pre-dep lanes, and per-lane sink paths at `.noldor/cr/<slug>-<kind>-<lane>.json`. Exit 0 = all sync lanes clean; exit 1 = blockers somewhere.

**Detailed spec summary (specs-only handoff).** When `kind === 'spec'` on a `specs-only-*` path, print a detailed summary of the committed spec to chat BEFORE the continue dialog — this pause is the last review surface before implementation (no plan stage follows), so a minimal "spec written, proceed?" prompt is not enough. Render four sections, each sourced from the spec body:

- **Scope** — what will be built, as bullets
- **Files touched** — code/test/doc paths the spec expects to change
- **Acceptance criteria** — verifiable outcomes the implementation must satisfy
- **Deferred risks / open questions** — what the spec explicitly postpones or leaves undecided

Mark any section the spec doesn't cover as `(not specified in spec)` rather than omitting it — a visible gap is itself review signal. The operator must be able to pick `proceed` / `address-blockers` without opening the spec file. `full-*` paths get their detailed review surface at the kind=plan pause; this summary targets the path that otherwise has none.

**Continue dialog.** Surface `AskUserQuestion`. When `kind === 'plan'`, options are: `proceed-autonomous / proceed / address-blockers / abort`. When `kind === 'spec'`, the autonomous option is omitted (autonomous mode triggers on plan-confirm, not spec-confirm).

For `specs-only-*` paths, the kind=spec continue-dialog has no `proceed-autonomous` option — these paths have no plan stage. Operators wanting autonomous flows should use `full-*` paths. The `proceed` option at kind=spec advances:

- For `specs-only-*` → directly to implementation (no `/noldor-draft-feature-md`, no plan stage).
- For `full-*` → `/noldor-draft-feature-md <slug> --from-spec` + the `noldor-plan` skill + a second Step 2.5 at `--kind plan`.

- `proceed-autonomous` (kind=plan only) → run `pnpm noldor noldor set-autonomous` to set `session.autonomous = true`, then advance to implementation. All remaining seams between this point and PR-merge run without prompts (see "Autonomous mode" section below).
- `proceed` → advance to next skill in the path (interactive, today's behavior).
- `address-blockers` → **when a split signal is live, ask which kind of addressing first.** If this round's findings include a `split-check` signal (`S1`/`S2` at `--kind spec`, `P1` at `--kind plan`), fire a second `AskUserQuestion`: `fix-in-place / split-back / back`. `fix-in-place` is the auto-fix-then-operator path below, unchanged; `split-back` is the carve described under "Split-back" further down; `back` returns to the continue-dialog. With no split signal in the round, skip this question and go straight to the auto-fix seam.

  The nesting is what keeps the dialog inside the four-option `AskUserQuestion` ceiling — at `kind === 'plan'` the top level is already full — and it is also where a split signal belongs: an oversized artifact *is* a blocker, and carving is one way to address it. The alternative, dropping `proceed-autonomous` whenever a threshold trips, would remove an unrelated capability on a heuristic.

  **The auto-fix seam — try it first, then fall back to the operator.** Run `pnpm noldor cr autofix plan --slug <slug> --kind <kind>` and branch on its exit code:
  - **0** (`next: reround` — auto-fix, all-mechanical) → apply the listed `M<n>` mechanical blockers yourself, commit the fix, then `pnpm noldor cr autofix record --slug <slug> --kind <kind> --applied <n> --deferred <n> --since <the printed base-sha>`, re-run orchestrate with `--base-sha <the printed base-sha>` and loop back to this branch. (`--since` is what makes the ledger's `diffStat` cover the whole fix when scope rules split it across commits.)
  - **11** (`next: apply-then-stop` — auto-fix, MIXED round) → apply the `M<n>` subset and `record` it exactly as above, then **stop**: surface the applied fix diff plus the `D<n>` design blockers verbatim at the continue-dialog. Do NOT re-round — the design blocker would just be re-reported (and under `onFailure: abort` the round aborts anyway). The exit code, not the `design:` count, is what tells the two apart.
  - **10** (`next: operator`, declined with a `reason:`), **2** (error), anything else (crash) → the operator takes the round: edit the artifact, then apply the **bounded re-round rule** below to decide whether the fix loops back to the top of Step 2.5 (lint → commit the fix → re-pick lanes) or proceeds as addressed with no re-dispatch. Surface the printed `reason:` so the operator knows why the seam declined (`knob-off` / `lanes-in-flight` / `prior-deferred` / `round-cap` / `no-progress` / `no-mechanical` / `no-base-sha`). `prior-deferred` means the previous round left a blocker unapplied, so the seam refuses to re-round it into a false green — the operator takes it from here. `lanes-in-flight` means a lane is still writing its sink (`in-flight lanes:` names them) — drain it with `pnpm noldor cr aggregate --slug <slug> --wait-ms <ms>` and re-run `plan` rather than treating it as a real decline.
  - **Any non-zero from `record` stops the loop** and falls to the same operator branch. An unrecorded round is invisible to the round cap *and* leaves the next fingerprint without a predecessor, so continuing would rest the whole loop bound on `record` having silently succeeded.

  The seam is off unless `.noldor/config.json` sets `autonomous.onBlockers: 'auto-fix'` (default `prompt` → `plan` exits 10 with `knob-off`), and it is bounded at 2 rounds per gate session plus a no-progress stop. Orchestrate's `guardLaneOverwrite` prompts overwrite / archive-and-overwrite / keep-and-skip per existing sink; in-flight standalone trips a separate `wait / kill-and-respawn / continue-without-lane` guard.

  **Bounded re-round rule (every operator-driven round).** The auto-fix seam above is bounded in code (`AUTOFIX_ROUND_CAP` in [`src/cr/autofix-ledger.ts`](../../../src/cr/autofix-ledger.ts)); the operator loop historically was not, and an unbounded loop self-feeds — every fix is fresh prose surface, so a delta review of it near-guarantees a new finding (Q-0073 ran 14 rounds, Q-0078 11, Q-0124 10; in Q-0112 rounds 1–3 caught real design flaws while rounds 4–11 were self-consistency findings seeded by the previous round's fix). Two rules terminate the loop:

  - **Only `[design]` blockers trigger a re-round.** Partition the round's blockers by the reviewer's class tag (`[mechanical]` / `[design]`; an untagged blocker reads as `design` — the same fail-safe read the autofix seam applies). A round with ≥1 design blocker earns one re-round after the operator arbitrates it: the judgment call changed the artifact, so the change gets reviewed (re-run orchestrate with `--base-sha` per the note above; mechanical fixes from the same round ride that re-round rather than earning their own). An all-mechanical round is fix-and-proceed: apply the fixes, commit, and treat the artifact as explicitly-addressed at the continue-dialog — no re-dispatch. The next stage reviews those fixes anyway (the plan-stage pass for a spec fix; the code-stage CR's `origin/main..HEAD` range for a plan fix), so a fix-seeded regression cannot reach `main` unreviewed. A design blocker the operator rejects rather than applies is also explicitly-addressed — record the rationale in chat and proceed; an unchanged artifact has nothing new to review.
  - **Hard cap: 2 re-rounds per artifact kind per gate session**, auto-fix and operator rounds combined (`AUTOFIX_ROUND_CAP = 2`; with the initial pass that is 3 total rounds — exactly the span that caught every real design flaw on record). **Enforced in code, both halves.** `cr orchestrate` appends a ledger entry for every round it resolves and refuses to dispatch past the cap (exit 3), printing the round history and the remedy; the auto-fix seam reads that same ledger, so the two draw from one budget. Only RED rounds count — a green dispatch arbitrates nothing, and a session re-mints its `HEAD^{tree}`-bound receipt after every fix commit, so those finding-nothing rounds must stay free. Past the cap a commit that changes `HEAD` earns exactly ONE closing round: green mints the receipt and the session ships, red refuses everything after. At the cap, no further dispatch. Batch every remaining blocker into ONE operator decision — `fix-and-proceed` (apply what is worth applying; addressed, not re-reviewed) or `abort` — instead of arbitrating round-by-round. A `[med]` wording nit and a design flaw no longer cost the same loop iteration; the tail collapses into a single choice.
  **Split-back (the `address-blockers` → `split-back` branch).** The artifact is oversized, not merely flawed: the remedy is to move scope out rather than to edit prose. This is a *bounce* to the phase that owns splits — `/noldor-promote` step 1.7 — but it is non-destructive: the FD, the session marker and the worktree all survive, and no promotion is unwound. See [complexity-gating.md → Which phase owns the split](../../../docs/noldor/complexity-gating.md#which-phase-owns-the-split).

  1. Operator names the scope that leaves.
  2. Write sibling roadmap blocks per the **sibling-emission recipe** in [`/noldor-promote`](../noldor-promote/SKILL.md) step 1.7 — minted `- id:` first, then `- area:` / `- type:` / `- since:` / `- size:` / `- impact:`, with `- split-from: <entry-id>` read from the FD's `entry-id:` frontmatter. No source block is removed here (there is none — it was retired at promote), so `remove-block --split-into` does not apply.
  3. Narrow the artifact to slice 1 on disk.
  4. Commit the narrowed artifact and the roadmap blocks as a **follow-up commit — never an amend.** The artifact commit carries no review receipt at this stage, but an amend still moves the tree under any lane sink already written; a follow-up keeps those sinks' base valid and lets a re-round use `--base-sha`.
  5. Re-run `pnpm noldor noldor split-check --<kind> <artifact-path>` and **report the result — it does not gate.** Return to the continue-dialog.

  Step 5 is advisory deliberately. Enforcing a clean re-run would make this the framework's second hard stop on an operator-present surface (the headless drain is the only one), and combined with the cap below it could wedge a session: at the cap with the signal still tripping, neither `proceed` nor another carve would be legal. **`proceed` stays available at every point**, cap or no cap. An operator who has carved twice and still trips a threshold has a judgment call, not a locked door.

  A `split-back` counts as an operator re-round against the cap below — it is not exempt, because an unbounded carve loop is the same self-feeding failure the cap exists to stop.

- `abort` → halt the path. Because the artifact was already committed at the top of Step 2.5, document `git reset --soft HEAD~1` in chat so the operator can unstage cleanly. **Abort does NOT remove `.noldor/cr/<slug>-<kind>-*.json` sinks** — on the next gate session the priors remain and `guardLaneOverwrite` catches them. State this explicitly so the operator knows the next round will prompt for overwrite/archive/keep.

This pause is the cheapest place to catch architectural drift, missing edge cases, or scope misalignment — far cheaper than fixing it post-implementation in the end-of-flow code review (Step 4).

3. **Session marker.** Always write `.noldor/session.json` (use `src/core/session.ts`).

3.5. **Rule brief before the first edit to a file (every path, every runner).** Before the first `Edit`/`Write` to a file in this session, run:

   `pnpm noldor rules brief --file <path> --stage code`

   Pass one `--file` per path when you already know the set (the spec's "Files touched", a plan task's file list) — repeated `--file` unions into one call. Treat the `ENFORCE` section as **binding**: it is repo policy, not preference, and the code-stage CR reviews the diff against the same rule text (Step 4 resolves it from the changed files automatically). `ADVISORY` is context.

   `--file` is required and there is no stage-only form: a file-scoped rule never matches a query without a file ([`src/rules/resolve.ts`](../../../src/rules/resolve.ts) `fileMatches`), so a stage-only brief would report "no rules match" however full the store is. The command also stamps `session.injectedRules` with what it surfaced — an exposure record, never a compliance claim.

   Re-run it when the session starts touching a file family it has not briefed on (e.g. moving from `src/**/*.ts` into `src/**/*.test.ts`, which carries its own rules). Skipping the brief does not block anything — Step 4's reviewer still holds the rule text — but then the rules arrive as findings instead of as guidance.

4. **End-of-flow (PR flow).** When the user signals "ready to ship":

- **Refresh the feature-MD body (`/noldor-draft-feature-md --refresh`)** for all FD-carrying paths, *before* the phase-flip below, so refreshed `User Story` / `Usage` ride the same commit and are seen by the code-stage CR. Resolve target + scope by path:
  - **New-FD paths** (`specs-only-new`, `full-new`): target = `slug`; full `links.code` / `links.tests`; both sections. Invoke `/noldor-draft-feature-md <slug> --refresh` (add `--yes` in autonomous mode).
  - **Attach paths** (`specs-only-attach`, `full-attach`): target = `parent`; scoped + Usage-only so a small enhancement can't rewrite the parent FD's story. Changed files = `git diff --name-only origin/main...HEAD` filtered to `/noldor-draft-feature-md`'s source-extension allowlist, excluding the target FD file and anything under `docs/design/`. **If that filter yields zero files, skip the refresh entirely** (treat as no-op — do *not* invoke `/noldor-draft-feature-md`, which aborts on empty scope; this also keeps the autonomous `--yes` pipeline from halting). Otherwise **join the surviving paths with commas** (the `git diff` output is newline-separated; `--scope` wants comma-separated) and invoke `/noldor-draft-feature-md <parent> --refresh --scope <comma-joined paths> --usage-only` (add `--yes` in autonomous mode).
  - **Fast-track / micro-chore:** skip (no FD).
  `/noldor-draft-feature-md` never stages or commits — the flip step below commits the refreshed body together with `phase: done`. In autonomous mode `--yes` runs it non-interactively (no prompt). Because the flip commits the refreshed FD onto the branch, it rides the `origin/main..HEAD` diff that the code-stage CR reviews below (that step passes `--base-sha origin/main`) — that is the mechanism behind "reviewed by the code-stage CR".

- **Archive this session's design artifacts** for all FD-carrying paths, immediately before the flip below so the move rides the same commit. The flip commit records the *index*, so assert it is empty first:

  `git diff --cached --quiet || { echo "index not empty before flip — resolve by hand"; exit 1; }`

  `pnpm noldor design archive`

  The CLI ([`src/design/archive-cli.ts`](../../../src/design/archive-cli.ts)) reads `.noldor/session.json`, resolves the artifacts this session owns (dialogue key `<slug>` on `*-new` / `<parent>-<enhancement>` on `*-attach`, gated on the branch-added set so a filename collision can never reach a foreign feature's live spec), `git mv`s them into their sibling `archive/` directory and **leaves the moves staged**. It never commits. Exit 0 with `nothing to do` on a re-run, and with an explanatory line on `fast-track` / `micro-chore` (no artifacts) — so the seam is safe to run unconditionally. Add `--dry-run` to preview.

  Do NOT pass a `docs/design` pathspec to `git add`/`git commit` here: `loadDocRoots` still resolves design subdirs through the 1.0.0 transition alias, so on a not-yet-migrated consumer the artifacts live under `docs/superpowers/*`. The CLI stages its own moves precisely for this reason.

  Garden's `detectStaleSpecs` / `detectStalePlans` remain the backstop for exceptions (pre-flip-era debt, skipped flips, orphans, age-outs).

- **UI baseline write-back (UI-bearing sessions only).** Runs AFTER the archive seam above — the empty-index assertion precedes the archive step, and the write-back's staged baselines then join the archive moves in the same flip commit below. When `session.uiWaiver` is present, skip the write-back entirely: a waived session has no feature `.pen` to start from — print the debt + `pnpm noldor design ui-sync` (the freshness check stays red until repaid) and continue. Otherwise recompute the UI verdict from the real diff: candidate paths = `git diff --name-only origin/main...HEAD`, config = `consumer.uiPaths`/`uiSurfaces`, FD `design:` override still absolute. On `skip`: continue (a spec-time `required` with no UI diff no-ops here; the feature `.pen` was already archived above). On `required`: for every affected surface, update `docs/design/ui/baseline/<surface>.pen` via pencil MCP to the as-built UI — start from the archived feature `.pen`'s `FINAL:<surface>:` pages, adjust for implementation drift; never edit the feature `.pen` itself. **Assert the write target first:** call `get_app_state` and confirm the open document is the baseline you are about to write — `execute` routes by `filePath` only while that file exists, and a path that does not silently falls back to the app's open canvas (Q-0187). Then, for each surface written, run `pnpm noldor design capture --surface <surface> --vouch-only` and stage the receipt alongside it: the hand edit changes the baseline's git blob, so without a fresh receipt the surface reads `stale` at the next check, and the only other command that clears that — a real `design capture` — would re-run the consumer's capture and overwrite the edit just made. `--vouch-only` records a receipt for the file on disk without running anything, needs no declared `uiCapture` command, and requires `--surface` so one surface's hand edit cannot vouch for another's untouched baseline. Stage the baseline files and their receipts; they ride the flip commit with the archive moves. This is the one sanctioned baseline write in the whole flow, and `checks shared-files` refuses a baseline `.pen` staged from a feature worktree, so make that commit with `NOLDOR_ALLOW_PEN_WRITE=1` set — the override is the acknowledgement that this write is deliberate, and every other baseline edit from a feature session is the wrong-canvas bug. Spec-time `skip` that turned ship-time `required` (UI emerged during implementation): same write-back via the `ui-sync` flow — no retroactive design artifact is required. Pencil MCP failing with `A file needs to be open in the editor`: that is the bridge being down, not the editor being absent — run `pnpm noldor design pen-bridge` (asks macOS to open a tracked `.pen` in the pen.dev desktop app; exit 1 = none tracked, so the app must author one; exit 3 = the app is not installed) and retry once. A still-dead bridge may also be an `--app` pin on the wrong editor — `pnpm noldor checks pen-bridge` names it. Pencil MCP still unavailable after that: skip LOUDLY — print the debt + `pnpm noldor design ui-sync`; do NOT block the ship on it.

- **Flip FD `phase: in-progress → done`** for all FD-carrying paths (`specs-only-new`, `specs-only-attach`, `full-new`, `full-attach`). Read `slug` (new-FD paths) or `parent` (attach paths) from `.noldor/session.json`. Then commit the index — FD plus the archive moves staged above:

  `pnpm noldor features phase-flip-done <slug>`

  `git add docs/features/<slug>.md`

  `git diff --cached --quiet || git commit -m "docs(features:<slug>): mark phase=done + archive design artifacts" -m "Noldor-FD: <slug>"`

  On attach paths the subject is `docs(features:<parent>): mark phase=done + archive design artifacts` (the refresh is Usage-only); mention `+ refresh User Story/Usage` instead when the refresh produced a body change and nothing was archived. `<slug>` is the new-FD slug or the parent slug per path. This single commit now carries the refreshed body, `phase: done`, and the archived spec/plan. Because the archive moves are already staged, the `--cached` check (not `git diff --quiet <fd>`) is what decides whether to commit — a move-only change with an unchanged FD body must still land.

  `release-markers.ts:fillMarkers` remains the release-time safety net for any FD that didn't get flipped at end-of-flow (forgot, manual commits, etc.) — its branches still accept `phase: in-progress + introduced` as input. Trade-off: the `### <version> (in-progress)` changelog label no longer renders for enhancement cycles whose Step 4 flip succeeded — the original asymmetric design in `framework-pr-flow-agent-auto-merge` spec §3 is superseded by this end-of-flow flip. The `(in-progress)` label still renders for FDs caught by the release-time safety net.

  Fast-track and micro-chore paths skip this step — neither carries an FD.

- **UI freshness (advisory).** Run `pnpm noldor checks ui-design-freshness` — AFTER the flip commit (the check reads committed history; staged edits are invisible to it). Print its per-surface rows. Advisory at this seam: never block `pr-flow` on its exit code — the blocking enforcement point is release preflight. A red here means baseline debt: surface it plus the `pnpm noldor design ui-sync` remediation and continue.

- **Wait for in-flight standalone from Step 2.5.** Before code-stage review starts, drain any artifact-stage lanes that are still running (a standalone-claude spawned earlier may still be writing its sink):

  ```
  pnpm noldor cr aggregate --slug <slug> --wait-ms 150000 --unresolved-only
  ```

  Polls up to 2.5 minutes for unresolved lanes. Exit 0 = every artifact-stage lane has finished writing; exit 1 = a lane is still unresolved, or a sink cannot be read/parsed/trusted (integrity) — loop back to Step 2.5 `address-blockers`.

  `--unresolved-only` is what makes this step ask the question it is here to ask. The call is kind-less on purpose (the controller cannot know which artifact kinds this session produced), so it also reads the spec/plan sinks — and a round that **fix-and-proceeded at the re-round cap leaves its sink red by design**: the findings were fixed in commits and deliberately not re-dispatched. Without the flag this step re-reds on those already-addressed findings, and the controller has to recognise the staleness by hand and proceed on the Q-0069 precedent (code-stage green earns the receipt) — a manual override on every such session (Q-0154; hit on Q-0131 and again on Q-0092). With the flag, every lane finding still prints (nothing is hidden) but only lane resolution and sink integrity set the exit code — and the `ok=` header reports that same verdict, so the output never reads `ok=false` above an exit 0. The mute covers every blocker a lane filed, a sink reporting that its own review never happened (`verdict: cannot-verify`) included; that sink was already surfaced by the artifact stage's own aggregate at Step 2.5. The artifact's verdict is not this step's business: it was settled at the Step 2.5 continue-dialog, and the code-stage aggregate below is already `--kind code`-scoped.

- **Preflight the push-range gates (before any code-stage review).** `pr-flow`'s push fires the pre-push chain (main-push block + docs/adr/ append-only scan, `template-sync`, `noldor-clones`) only after the review receipt is earned — so a gate failure at push time forces a fix commit, the tree changes, the `Noldor-Reviewed-Subagent` receipt invalidates, and a full code-stage dispatch runs purely to re-earn it (Q-0112: 2 of 6 code-stage dispatches plus 3 failed pushes were this class — zero review value). Replay the real hook author-side first, while no receipt exists to lose:

  ```
  pnpm noldor checks push-gates
  ```

  That one command hands the hook to **lefthook itself** — it synthesizes the pre-push stdin line git will send (the branch, `HEAD`, and the branch's remote-tracking sha, or zeros when the remote has no such branch yet) and runs `lefthook run pre-push origin` over it, with `LEFTHOOK_EXCLUDE=noldor-enforce-review-receipt`. So every blocking `pre-push` job runs exactly as the push will run it, and a job later added to `lefthook/noldor.yml` is preflighted with no edit to this prose. `enforce-review-receipt` is the one deliberate exclusion — the receipt is earned by the review below, so before it runs that job can only be red.

  This replaces an earlier three-command enumeration (`checks template-sync`, `clones check`, a hand-`printf`-ed `hooks pre-push`), which is why the preflight could pass while the push was refused (Q-0165): an enumeration reproduces neither lefthook's job list nor its skip/exit semantics, and it silently omits whatever the block gained since it was written.

  Exit 0 = the push will be accepted. Exit 1 = a gate refuses this tree — fix it now (mirror a template twin, re-record a clones baseline alongside the change that moved it) and land the fix as an ordinary commit, then re-run until green. Exit 3 = the replay could not run at all (detached HEAD, or no lefthook on PATH or in `node_modules/.bin`); it prints the jobs to run by hand and is never a pass. A mechanical fix landed here costs one commit; the same fix landed after a green review also costs a receipt re-earn dispatch.

  Separately, confirm the first substantive commit's body carries `Why — / How — / What —` sections (24+ non-whitespace chars each): `pr-flow` composes the PR Summary from it and `validatePrSummary` refuses delivery without them — cheaper to reword now (rebase/amend) than at PR-open.

- **Code-stage orchestrate.** Run the worktree-code lane (default `reviewer`; config `crLanes.code` can override, e.g. `['reviewer', 'codex']` to opt codex back in — and on `specs-only-*` / `full-*` paths orchestrate forces `codex` into the set regardless, so an M/L/XL feature never ships reviewed by one model family):

  ```
  pnpm noldor cr orchestrate --slug <slug> --artifact <code-paths> --kind code --lanes reviewer --base-sha origin/main
  ```

  `<code-paths>` is a representative changed path used only for labeling; the subagent lane actually reviews the **`BASE_SHA..HEAD` diff range**, so pass `--base-sha origin/main` to cover the whole feature diff — which **includes the refreshed `docs/features/<slug>.md`** from the first bullet. That range membership is what delivers the "refreshed FD is reviewed by the code-stage CR" guarantee. Omitting `--base-sha` defaults the lane to `HEAD~1..HEAD` (last commit only — usually not what you want at end-of-flow). On attach paths pass the **parent** slug for `--slug` (the lane reads `docs/features/<slug>.md` as FD context, and attach has no child FD).

  **Autonomous mode:** add `--autonomous` and omit `--lanes` (orchestrate reads `crLanes.code` from `.noldor/config.json`). The `--autonomous` flag also suppresses the overwrite-guard prompts and the standalone-in-progress prompt, so re-runs over prior sinks don't pause.

  **Fast-track profile.** When the session marker `path` is `fast-track`, append `--profile fast-track` to the orchestrate command so the CR pass is scoped (low effort, correctness+security+reuse+simplification per `crReview.profiles`). Other paths omit the flag and get the `default` profile (med effort, every dimension). For the fast-track / drain code-stage review the command is:

  ```
  pnpm noldor cr orchestrate --slug <slug> --artifact <code-paths> --kind code --lanes reviewer --base-sha origin/main --profile fast-track
  ```

  Sink: `.noldor/cr/<slug>-code-reviewer.json`. Trailer amended on tip commit: `Noldor-Reviewed-Subagent: <tree>`.

  **Delta re-earn after a post-green mechanical fix.** `--base-sha origin/main` (the full feature range) is mandatory only for the **first** code-stage pass. When a commit lands *after* the reviewer went green — a push-gate fix the preflight bullet didn't catch, a fmt-hook rewrite, a one-line message reword that still changed the tree — the receipt invalidates, but the already-reviewed range hasn't changed. Re-earn with a delta pass over just the fix instead of re-reviewing the whole feature: capture `git rev-parse HEAD` **before** committing the fix (that tip carried the green receipt), then

  ```
  pnpm noldor cr orchestrate --slug <slug> --artifact <code-paths> --kind code --lanes reviewer --base-sha <last-green-tip>
  ```

  (keep `--profile fast-track` when the first pass used it). Orchestrate already supports delta review — this is the same `--base-sha` mechanism the autofix loop uses via its printed `base-sha:` line; the skill just never prescribed it for the push-gate-failure path, which bypasses autofix. The reviewer sees only `<last-green-tip>..HEAD`, so a mechanical fix re-earns the receipt in one cheap dispatch instead of a full-range re-review.

  Recovering the green tip when it wasn't captured: only when the fix landed as a **new commit on top** is it recoverable as `git log -1 --format=%H --grep='^Noldor-Reviewed-Subagent:' origin/main..HEAD` (the receipt-carrying commit sits below the fix). Never use that grep after an amend or rebase rewrite — the rewritten commit keeps the stale trailer text in its message, so the grep returns the new HEAD itself, `<last-green-tip>..HEAD` is empty, and the prior-green gate mints a synthetic OK: a re-earned receipt whose fix was never reviewed. After a rewrite, the pre-fix sha comes from the captured value, or from the reflog — `git rev-parse HEAD@{1}` immediately after a single amend; after a rebase use the branch reflog (`git rev-parse <branch>@{1}`), because HEAD's reflog moves once per replayed commit, so `HEAD@{1}` lands on an intermediate rebase step and the delta would omit rewritten commits.

- **Aggregate code-stage.**

  ```
  pnpm noldor cr aggregate --slug <slug> --kind code
  ```

  Exit 0 → proceed to PR flow. Exit 1 → **try the auto-fix seam, then escalate**.

- **Auto-fix mechanical blockers (before escalating).** Same pair as Step 2.5, same branching:

  ```
  pnpm noldor cr autofix plan --slug <slug> --kind code
  ```

  - **0** (`next: reround`) → apply the listed `M<n>` blockers, commit, `pnpm noldor cr autofix record --slug <slug> --kind code --applied <n> --deferred <n> --since <the printed base-sha>`, then re-run the code-stage orchestrate with `--base-sha <the printed base-sha>` (that re-run is what re-earns the `Noldor-Reviewed-Subagent` receipt — orchestrate only amends it on a green reviewer run) and re-aggregate.
  - **11** (`next: apply-then-stop`) → apply + `record` the `M<n>` subset, then stop looping and **escalate** on the `D<n>` design blockers below.
  - **any other non-zero** (from `plan` or from `record`) → capture stderr/findings to a temp file and **escalate** exactly as below. On `reason: lanes-in-flight` prefer draining the lane first (`pnpm noldor cr aggregate --slug <slug> --wait-ms <ms>`) and re-running `plan`.

  Off by default (`autonomous.onBlockers`, see Step 2.5), bounded at 2 rounds per session plus a no-progress stop.

- **Escalate on cr-red.**

  ```
  pnpm noldor cr escalate --slug <slug> --reason cr-red --context-file <stderr-path>
  ```

  CLI prompts the operator interactively (`retry-implementation / spawn-deep-review / override-with-trailer / abort`); add `--autonomous` to use the config default from `autonomous.onFailure` (`abort` / `spawn-deep-review` / `prompt`). Exit codes drive the next step:
  - **0** (`spawned` / `override`) → deep-review was spawned in a fresh iTerm2 window (via `lanes/standalone.ts`) OR the operator chose `override-with-trailer`. Proceed to PR flow.
  - **1** (`abort`) → full halt. Operator manually salvages.
  - **10** (`retry-implementation`) → loop back to Step 3 (implementation). Append `## Findings to address` to the plan MD using the content from `.noldor/cr/<slug>-escalation-context.md` so the next implementation pass has the failure context inline.

- **Escalate on test-red.** Same CLI, different reason — invoked earlier in the flow when the verification step (test pass before CR) fails:

  ```
  pnpm noldor cr escalate --slug <slug> --reason test-red --context-file <test-output>
  ```

  **Autonomous mode:** same `--autonomous` flag + `autonomous.onFailure` semantics as the cr-red bullet above.

  Same exit-code semantics as above.

- **Context cleanup on clean exit.** Once all aggregates are green and the gate is about to enter PR flow, remove the escalation context file so stale failure context can't leak into a subsequent retry on the next feature, together with the auto-fix round ledgers and any quarantine remnant:

  ```
  rm -f .noldor/cr/<slug>-escalation-context.md \
        .noldor/cr/autofix/<slug>-spec.json  .noldor/cr/autofix/<slug>-spec.json.bad \
        .noldor/cr/autofix/<slug>-plan.json  .noldor/cr/autofix/<slug>-plan.json.bad \
        .noldor/cr/autofix/<slug>-code.json  .noldor/cr/autofix/<slug>-code.json.bad
  ```

  All three kinds are listed because a `full-*` session runs Step 2.5 at both `spec` and `plan` and Step 4 at `code`, so up to three ledgers exist; `rm -f` on an absent path is a no-op, so enumeration beats deriving the set from the session path. Nothing else ever removes a `.bad` file. Do **not** collapse this to `.noldor/cr/autofix/<slug>-*`: the directory is shared in the main workspace, so a slug that is a prefix of another (`foo` vs `foo-bar`) would cross-match and delete a sibling feature's ledger. In bash/zsh `rm -f .noldor/cr/autofix/<slug>-{spec,plan,code}.json{,.bad}` is an equivalent shorthand — brace expansion is deterministic expansion, not pattern matching — but the enumerated form above is the portable one.

- **Bootstrap-immunity (gate-introducing FDs only).** Run `pnpm noldor cr bootstrap --slug <slug>`. If the FD's frontmatter declares `introduces-gate`, this rewrites every commit on the worktree branch to carry the matching bootstrap override so the release gate the feature introduces can't block its own commits. No-op otherwise (`no introduces-gate — skipped`). Runs **after** the code-stage review amends `Noldor-Reviewed-Subagent` on the tip (the rewrite is message-only, tree-preserving, so review receipts stay valid) and **before** `pnpm noldor pr-flow` (so the history rewrite stays local, pre-push). Fast-track / micro-chore paths skip it (no FD).

- Invoke `pnpm noldor pr-flow` (CLI wrapper around `src/core/pr-flow.ts:openAndAutoMerge`, source at [`src/core/pr-flow-cli.ts`](../../../src/core/pr-flow-cli.ts)) — existing behavior. The CLI reads `.noldor/session.json`, derives `PrFlowInput` from session + FD frontmatter + `Noldor-Reviewed-Subagent` commit trailer + git-discovered spec/plan paths, then runs preflight `gh` → `git push --force-with-lease --set-upstream origin <branch>` → `gh pr create` → `gh pr merge --auto --squash` → poll until merged. See [`docs/noldor/pr-flow.md`](../../../docs/noldor/pr-flow.md) for the top-level flow diagram + push runbook + failure runbook.

  **The old codex retry loop is gone.** Earlier revisions of this step invoked an interactive review skill directly + ran a dedicated retry loop for up to 3 codex passes. Both are removed — the subagent now runs via `pnpm noldor cr orchestrate --kind code` (single lane), and codex at Step 4 is opt-in via config (`crLanes.code: ['reviewer', 'codex']`) rather than a forced retry loop — except on `specs-only-*` / `full-*` sessions (entry size M/L/XL), where orchestrate unions the codex lane into spec- and code-stage rounds automatically (`withMandatoryCodex`).

- On merged: explicit cleanup (no interactive finishing skill — the cleanup below is scripted and autonomous by design):
  - **Worktree-backed paths** (`fast-track`, `specs-only-*`, `full-*`): from the **main workspace** run `git worktree remove [--force] .worktrees/<name>` then `git branch -D feat/<name>` — removes the worktree directory + deletes the local feature branch. Non-interactive; no native tool. (Do NOT use the `ExitWorktree` native tool here: the framework creates worktrees via `git worktree add .worktrees/<name>`, which `ExitWorktree` did not create, so it is a no-op that silently leaves the worktree + branch on disk.) `git branch -D` (force) is required because the PR is squash-merged — the branch's commits are not ancestors of `main`, so `-d` would reject with "not fully merged" and leak the branch. Use `--force` on `git worktree remove` only if the worktree has uncommitted changes (it should not at this point). **Then sync local `main` to the merged squash commit: `git fetch origin main && git checkout main && git merge --ff-only origin/main`.** A PR is not "finished" until local `main` matches `origin/main` — the next session must start from the merged state, not a behind one. If `--ff-only` rejects (local main has commits ahead of origin), stop and surface the divergence; do not force the merge.
  - **Micro-chore path** (no worktree, see Step 2): `git branch -D <temp-branch>` + `git fetch origin main && git rebase origin/main` to refresh the local main pointer. (Same rule — local main must match origin/main before the session exits.)
- Print `gh pr view <pr-url>` confirmation for the operator. Continue to Step 5.

5. **Next-priority handoff (always-clear).** After Step 4's PR merges and cleanup completes:

- Run `pnpm noldor next-priority`. Capture only the exit code; do NOT read or echo the entry name / size / impact / parent / description from stdout in any user-facing output.
- Exit code 2 → queue empty. Print `Queue empty — ship-ready. Session may exit.` Skip the rest of this step.
- Exit code 0 → top entry exists. Print exactly:

  ```
  Queue non-empty — top priority lives in docs/roadmap.md.

  Always-clear policy: this session ends here. Continue in a fresh context.

  Operator next steps:
    1. /clear
    2. /noldor-gate

  The fresh /noldor-gate will read top-of-roadmap at Step 0 and surface the entry there.
  ```

- Any other exit code → report the stderr message and stop.

**Do NOT name, summarize, paraphrase, or otherwise leak the top entry in the current session.** Even read-only mention biases the operator's framing with stale-context residue from the just-shipped work — exactly the drift the always-clear policy closes. The top entry surfaces ONLY in a fresh `/noldor-gate` Step 0 invocation (per the [`feedback-auto-clear-between-features`] memory + the 2026-05-13 incident where the controller leaked the entry name at handoff). Same rule applies if the operator asks "what's next?" in the dirty session — answer: "the roadmap holds it; /clear + /noldor-gate to see."

**Do NOT prompt for "start now" or re-enter `/noldor-gate` inside the same conversation** for the same reason.

## --resume mode

Re-establish session marker for an existing in-progress FD. Reads tier from FD frontmatter, infers path (`specs-only-new` or `full-new` based on tier; user can override to `*-attach` if extending an existing FD). Advances straight to the Step 2 scaffold.

### Drain mode (`NOLDOR_DRAIN=1`)

When `--resume <slug>` runs under the drain supervisor (env `NOLDOR_DRAIN=1`, set by the `runDrain` loop on every spawn — source-independent), behaviour changes **only under that env var** — the interactive `--resume` path (env unset) is unchanged. This is what `plansSource` (`pnpm noldor autonomous run --source plans`) relies on to ship already-designed in-progress FDs unattended.

After re-establishing the session marker and creating/force-recreating the `feat/<slug>` worktree:

1. **Detect committed design.** Confirm the FD carries BOTH a spec and a plan in the worktree (they are committed on the feature branch — `plansSource` already gated on this, so this is a defensive re-check):
   - spec: `ls docs/design/specs/*-<slug>-design.md` resolves to ≥1 file.
   - plan: `ls docs/design/plans/*-<slug>.md` resolves to ≥1 file.

   (These globs are a coarse defensive existence re-check only — `plansSource.nextItem` already applied the date-anchored `<date>-<slug>-design.md` / `<date>-<slug>.md` match before spawning, so a `runner`-vs-`plan-runner` suffix false-match here would at worst let an already-vetted FD through, never block one.)
2. **Both present →** run `pnpm noldor noldor set-autonomous` (sets `session.autonomous = true`), then advance **directly to inline implementation** (gate autonomous-mode rules: read the plan MD, execute task-by-task, commit at each boundary, tick `- [x]`). Do **NOT** invoke `noldor-spec` or `noldor-plan`, and do **NOT** pause at any Step 2.5 continue-dialog. Zero `AskUserQuestion` — the `--disallowed-tools AskUserQuestion` backstop would otherwise hang the iteration until the per-iteration timeout.
3. **Either missing →** this is specs-source territory (phase 2); the drain should not have spawned it. Print the missing-artifact path to stderr and exit non-zero so the supervisor's retry-then-skip handles it. Do NOT enter a design stage under drain.

Step 4 autonomous end-of-flow then ships the PR on `feat/<slug>` and Step 5 exits clean, exactly as the queue-drain fast-track path does.

## Autonomous mode

Activated when the operator picks `proceed-autonomous` at the plan-stage Step 2.5 continue-dialog. Persisted as `session.autonomous = true` in `.noldor/session.json` (via `pnpm noldor noldor set-autonomous`). Stays on through PR-merge — no operator-facing "exit autonomous" command; the session marker is cleared by the post-merge cleanup like any other session.

Once autonomous:

1. **Implementation phase runs INLINE.** Do not delegate execution to a plan-executor skill — checkpoint prompts between tasks/batches would bypass autonomous mode. Instead, the gate controller (Claude in this conversation) reads the plan MD, executes each task using normal Read / Edit / Bash / Write tools, and commits at each task's "Commit" step boundary per the plan. Treat the plan as a checklist; tick `- [x]` as you go.

2. **Step 4 omits all AskUserQuestion seams.** Specifically:
   - No commit-confirm `y` prompt around phase-flip / orchestrate / aggregate / pr-flow invocations.
   - No lane multi-select. `cr:orchestrate` is invoked with `--autonomous` and reads `crLanes.<kind>` from `.noldor/config.json`, falling back to the built-in `reviewer`-only defaults when that block is absent (a configured block overrides the defaults).
   - No continue-dialog after orchestrate. Exit 0 → proceed. Exit 1 → escalate (next bullet).

3. **`cr:orchestrate --autonomous`** for both artifact-stage (Step 2.5, already committed before autonomous activated) and code-stage (Step 4). The flag flows into the overwrite-guard (defaults `archive-and-overwrite`) and the standalone-in-progress guard (defaults `drop-lane`) so neither prompts.

4. **`cr:escalate --autonomous`** on `cr-red` or `test-red`. Outcome depends on `autonomous.onFailure`:
   - `abort` → exit 1, full halt. Operator manually resumes by clearing `session.autonomous` (e.g. re-run `/noldor-gate --resume <slug>` which rewrites the marker).
   - `spawn-deep-review` → exit 0 after spawning iTerm2 standalone; proceed to PR-flow.
   - `prompt` → falls back to interactive prompt despite autonomous mode. This is the documented escape hatch; operator must explicitly opt out of autonomy here.

5. **`pnpm noldor pr-flow`** reads `session.autonomous` via `shouldPromptForPrApproval` and skips the `requireHumanPrApproval` `y` prompt regardless of `.noldor/config.json` value. Push + PR-create + auto-merge run unsupervised.

6. **Cleanup** (worktree removal, main fast-forward, next-priority handoff) is already non-interactive in `/noldor-gate` Step 4 + Step 5 prose; nothing changes.

**Safety rails preserved:**

- Red CR aggregate → `cr:escalate` fires (interactive or autonomous per config).
- Red test/typecheck → `cr:escalate --reason test-red`.
- Override audit + commit hooks still run; commits still need `Noldor-FD:` / `Noldor-Reviewed-Subagent:` trailers.
- Pre-push hook still validates the receipt trailer against `HEAD^{tree}`.

**Trade-off:** Autonomous mode trades operator-visibility for momentum. If the plan was wrong, the cost is felt at Step 4 code-stage CR (subagent flags blockers → escalate fires). The escape hatch is `autonomous.onFailure: 'prompt'` (default), which keeps the interactive escalate dialog and lets the operator regain control without manually clearing the session flag.

## Drain mode (`NOLDOR_DRAIN=1`)

Runner-neutral twin: [`docs/noldor/drain-mode.md`](../../../docs/noldor/drain-mode.md) restates
this drain contract for prose-dispatch runners (a codex/opencode implementer child receives a
self-contained prose directive pointing there instead of `/noldor-gate --drain <slug>`). Keep the two
renderings in sync.

The [Autonomous Queue-Drain Runner](../../../docs/features/autonomous-queue-drain-runner.md)
(`pnpm noldor autonomous queue-drain`) is an external supervisor that spawns one fresh headless
`claude --print "/noldor-gate --drain <slug>"` per fast-track roadmap entry, also setting `NOLDOR_DRAIN=1` in the child's
environment. When invoked this way, this gate run takes **zero `AskUserQuestion`s** — the
supervisor backstops a forgotten branch by spawning `claude` with `--disallowed-tools AskUserQuestion`
(any prompt then fails fast instead of hanging) plus a per-iteration timeout. The supervisor owns the
loop / retry / skip / lock; each gate run only ships its one entry. Step overrides:

- **Step 0:** skip the bucket `AskUserQuestion`. **Ship the slug named by the `--drain <slug>`
  argument** the supervisor passed (parallel drain, `--concurrency > 1`, assigns each concurrent child a
  distinct slug so K near-simultaneous children don't all pick the same top entry). Fallbacks when
  `--drain` is absent: the `NOLDOR_DRAIN_SLUG` env var if set, else `topPriority[0]`. Either way, honor
  `NOLDOR_DRAIN_SKIP` (the comma-separated skip-set the supervisor passes through) and, if the chosen
  entry's `suggestedPath !== 'fast-track'`, exit without scaffolding (defensive — the supervisor
  pre-filters scope, so this should not happen). Then run
  `pnpm noldor noldor split-check --entry <slug>` and capture stdout + exit code. On exit 2, **exit
  without scaffolding**: echo the captured signal lines to stderr and exit non-zero so the
  supervisor's retry-then-skip surfaces them on the escalation channel. An entry whose *label*
  routes to fast-track but whose *body* trips the oversize signals is the mislabeled-`S` failure
  mode (`prefix-skills-with-noldor`) — a human must re-size or split it; never ship it headless.
  On exit 1 (checker infra error), continue — never block a drain on checker infra.
- **Steps 1 / 1.5:** skip path-pick + path-confirm. Force `fast-track`, carrying `entry.slug`. Name
  the branch **`fast/<slug>`** (deterministic — vs ordinary fast-track's `fast/<short-desc>`) so the
  supervisor's `openPrExistsFor(slug)` can map slug → branch → PR exactly.

  **Earn the right to destroy the branch first.** Before any `git branch -D` / `git push origin
  --delete`, run `pnpm noldor autonomous branch-state <slug>` and branch on its exit code:
  - **0** (`rebuild`) — nothing is ahead of `origin/main` on `fast/<slug>` or `origin/fast/<slug>`, or
    a human closed the branch's PR unmerged (rejected work, not undelivered work): force-recreate as
    below.
  - **10** (`finish`) — the branch carries commits, none of its PRs was closed unmerged, and its checkout
    is clean: **do not delete anything.** Switch to the **Finish mode** sub-section below and deliver
    the existing work, exactly as a supervisor-sent `--finish` run would.
  - **1** (`unknown`) — the classifier could not prove the branch is safe to discard: `git fetch
    origin` failed, or `gh` could not say whether the PR was closed unmerged. Echo its `reason` and
    exit non-zero; never force-recreate on an unproven branch.

  The verdict mirrors both legs of the supervisor's own finish gate in `drain-loop.ts` (unshipped work
  AND no closed-unmerged PR), substituting a clean checkout for the prior child's clean exit. Untracked
  files are deliberately not dirt — a stray scratch file must not authorize deleting committed work.

  The check exists because the finish-vs-rebuild decision otherwise lives only in the supervisor,
  which knows whether the prior child exited 0 — a hand-invoked `/noldor-gate --drain <slug>` carries
  no `--finish` signal and would read finished work as abandoned. On Q-0107 that branch held 7 commits
  with green tests, and the remote-side delete is unrecoverable. A supervisor-spawned child runs the
  same check harmlessly: the supervisor already sends `--finish` for that state, so the verdict agrees.

  On verdict `rebuild`, **force-recreate** the branch (a prior interrupted run may have left it):
  `git branch -D fast/<slug>` + `git push origin --delete fast/<slug>` (when each exists). A `rebuild`
  verdict on a branch that *does* carry commits means its checkout had tracked uncommitted changes (a
  half-done tree is not deliverable) or its PR was closed unmerged — the rebuild is right either way,
  but echo the verdict's `reason` (it names the dirty path and the `git log origin/main..fast/<slug>`
  range) before discarding. Also `git worktree remove --force`
  its stale worktree dir first, if present, so `git branch -D` won't fail on a checked-out branch. This
  per-slug removal is the only worktree the drain deletes — the supervisor's `syncMainCleanState` never
  blanket-wipes `.worktrees/*`.
- **Step 2:** the existing **Roadmap-entry retirement** sequence (above) runs unchanged — implement
  the entry, `removeBlock` the roadmap block on the branch. `cd` into the worktree first; the session
  marker, `set-autonomous`, and `pr-flow` all operate from there.
- **Step 4:** run end-of-flow autonomously — `set-autonomous`, code-stage CR via `crLanes.code`,
  `pr-flow` auto-merge, no prompts. Skip the no-FD seams (phase-flip, `draft-feature-md --refresh` —
  fast-track carries no FD). `pr-flow` polls until the PR actually merges — **except** under parallel
  drain, where the supervisor sets `NOLDOR_DRAIN_OPEN_ONLY=1`: `pr-flow` then pushes + opens the PR and
  returns at PR-open (no merge, no poll), and the supervisor's serialized merge coordinator merges it
  one at a time. Escalation uses `cr escalate --autonomous` with `onFailure: abort` (the supervisor
  asserts this precondition before it starts), so a red cleanly fails the iteration → the supervisor
  retries-from-clean or skips.

  **Never background the end-of-flow commands, and never end the turn before the PR exists.** Run
  `cr orchestrate`, `cr aggregate`, and `pr-flow` in the foreground and wait for each to exit — a
  backgrounded CR lane plus a "waiting on the reviewer lane" sign-off looks identical to a finished
  iteration from outside (committed work, clean exit, no PR), and the supervisor reads it as a failed
  build. Before returning, assert delivery:
  `gh pr list --state open --head fast/<slug> --json number` must be non-empty (or, when
  `NOLDOR_DRAIN_OPEN_ONLY` is unset, `pr-flow` must have reported the merge). If it is empty, the
  iteration is NOT done — finish it or exit non-zero; never report success.
- **Step 5:** exit clean — no human `/clear` + `/noldor-gate` handoff prose. The supervisor is the loop.

#### Finish mode (`/noldor-gate --drain <slug> --finish`, `NOLDOR_DRAIN_FINISH=1`)

The supervisor spawns this variant when a prior child for the same slug exited 0, opened no PR, and
left `fast/<slug>` with commits ahead of `origin/main` — the assertion above having been skipped. A
clean exit is what makes the work trustworthy: a child killed by the per-entry timeout may be
half-done, so the supervisor rebuilds that one instead of sending it here. The work exists; only
delivery is missing. Rebuilding it costs ~13 minutes and ~170k tokens for nothing, so this run
delivers instead.

A hand-invoked drain reaches this same mode without the flag: `pnpm noldor autonomous branch-state
<slug>` exiting 10 at Step 1 is the equivalent verdict, derived from the branch instead of from the
supervisor's knowledge of the prior child. It substitutes a clean checkout for the clean-exit signal —
a dirty tree reads as half-done and routes to rebuild, matching what the supervisor would have done.

- **Do NOT force-recreate the branch** and do NOT `git push origin --delete` it. Those steps exist to
  discard *abandoned* state; here they would destroy the commits being finished. Reuse the existing
  `.worktrees/<slug>` when present. When there is none the work may live only on the remote (a prior
  child that pushed without opening a PR), so `git fetch origin` and resolve the branch first:
  `git rev-parse --verify fast/<slug>` → `git worktree add .worktrees/<slug> fast/<slug>`; otherwise
  `git worktree add -B fast/<slug> .worktrees/<slug> origin/fast/<slug>`. The plain form does not
  resolve a remote-only branch and fails with "invalid reference" in exactly that case.
- **Re-establish the session marker if missing.** Finish mode skips Step 1, so it assumes
  `.noldor/session.json` survived from the prior child; on a fresh worktree it has not, and
  `pnpm noldor noldor set-autonomous` then exits 1 (`no session marker`), after which the commit
  hooks block delivery. Write the same fast-track marker Step 2 writes (`path: fast-track`, the
  `slug`, `startedAt`) before continuing.
- **Do NOT re-implement the entry.** `git log --oneline origin/main..HEAD` and
  `git diff --stat origin/main..HEAD` show what already landed. The supervisor only sends a finish
  run for a branch whose prior child exited cleanly — a child killed by the per-entry timeout is
  rebuilt, not finished — so the work is complete; deliver it.
- Re-run **Roadmap-entry retirement** — `pnpm noldor roadmap remove-block <slug>` is idempotent, so it
  is a no-op when the prior child already retired the block and closes the gap when it did not.
- Then **Step 4 exactly as above**, including the delivery assertion. Re-running `cr orchestrate` over
  an existing sink is safe: `--autonomous` defaults the overwrite guard to `archive-and-overwrite`.
- The supervisor still counts this against `--max-retries`, so a finish that fails again falls through
  to the ordinary retry/skip path.

Drain mode is orthogonal to (and stricter than) Autonomous mode: it requires the full headless-safe
config set (`autonomous.onFailure: 'abort'`, `skipLanePicker: true`, `requireHumanPrApproval: false`)
or the supervisor refuses to start. See the FD + its spec for the supervisor's loop, success oracle,
and safety rails.
