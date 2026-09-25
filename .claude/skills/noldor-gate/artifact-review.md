# /noldor-gate — artifact review (Step 2.5)

Read by `specs-only-*` and `full-*` sessions after each spec and each plan. **Multi-reviewer CR gate — a mandatory pause.** Don't auto-chain into the next skill (implementation, draft-feature-md, etc.).

## Lint pass first

Run `pnpm noldor noldor lint-plan-snippets <artifact-path>` and capture stdout + exit code. When the artifact kind is `plan`, also run `pnpm noldor noldor split-check --plan <artifact-path>` (same 0/2/1 exit contract) and append its stdout to the captured lint output; when the kind is `spec`, do the same with `pnpm noldor noldor split-check --spec <artifact-path>` (S1 word bulk / S2 criteria bloat — informational, never blocks). Exit code 0 = clean; exit code 2 = findings present (include the captured stdout verbatim in the AskUserQuestion description so the operator sees them before choosing); exit code 1 = script error (mention the error in the description but still proceed to the prompt — never block on linter infra). Findings are informational; they do not gate the choice. This pass is the authoritative split checkpoint: autonomous/plans-drain paths execute committed plans without re-invoking the `noldor-plan` skill, so its post-save self-check may never have run.

## Commit the artifact first

Surface the artifact path in one sentence, then stage + commit it (no confirm — recoverable via `git reset --soft HEAD~1` if the round needs unwinding) before any lane runs — subagent needs a `BASE_SHA..HEAD_SHA` range, standalone needs the file on disk, and every lane needs the artifact at a stable `HEAD`.

When surfacing that path, **paste the link the auto-open hook supplied** in its `additionalContext`; never build one from the repo-relative path. A markdown link resolves against the editor's workspace folder, the path against this session's checkout, and the two diverge in every `.worktrees/<slug>/` session — a hand-built link renders and does nothing. (The hook opens a tab only when the repo sets `design.autoOpen: true`, off by default so no editor window is raised mid-task.) No hook output to hand (not wired, or `code` absent)? Run `pnpm noldor design open <artifact-path>` once and use its `link:` line; `NOLDOR_WORKSPACE_ROOT` overrides the resolved root when the ladder guesses wrong.

- After spec: `docs(features:<slug>): add spec for <slug>` (attach paths scope on the parent slug + name the enhancement in the subject)
- After plan: `docs(features:<slug>): add plan for <slug>`

The `prepare-commit-msg` hook injects `Noldor-Path` and `Noldor-FD` from `.noldor/session.json`. The end-of-flow review receipt (`Noldor-Reviewed-Subagent`) is amended only on the tip commit at Step 4; intermediate spec/plan commits don't need it. Committing at each confirmed checkpoint keeps the worktree branch self-documenting (spec → plan → implementation, each its own commit).

## Lanes

After the artifact commits, fire `AskUserQuestion` with multi-select on these options:

- `manual` — operator reads the artifact, returns blockers/notes via stdin prompt in the CLI
- `codex` — `pnpm noldor cr codex` second-opinion pass on the artifact (disabled inline with reason when `codex --plan-mode-probe` fails, e.g. "codex — disabled until `codex-cr-plan-review-mode` lands"). **Mandatory at `--kind spec` on `specs-only-*` / `full-*` paths (entry size M/L/XL)** — orchestrate unions it in (`withMandatoryCodex`, [`src/core/lanes.ts`](../../../src/core/lanes.ts)) even when the pick omits it, so present it pre-selected on those paths
- `reviewer` — senior-reviewer subagent over the artifact diff (self-contained `claude -p` prompt, `src/cr/lanes/subagent-dispatch.ts`). **Always-on — see below.** Present it as the pre-selected option; never offer a lane set that omits it.
- `standalone` — spawn `claude --max-thinking` in a fresh iTerm2 window for deep review (disabled inline when `fix-multiterminal-dev-flow-bug` is not at `phase: done`, e.g. "standalone — disabled until `fix-multiterminal-dev-flow-bug` lands")

The operator picks one or several. The selected list becomes the `--lanes` argument. When `.noldor/config.json` has `autonomous.skipLanePicker: true`, skip the prompt and invoke orchestrate with `--autonomous` and no `--lanes` flag (orchestrate reads lanes from `crLanes.<kind>` in config, falling back to the built-in `reviewer`-only defaults when that block is absent — a configured block overrides the defaults).

**The `reviewer` lane is mandatory at `--kind spec` and `--kind plan`, and there is no skip option.** No spec or plan reaches implementation unreviewed, so this stage offers **no `proceed-without-review`**: the only way past it is a green (or explicitly-addressed) reviewer pass. Once orchestrate runs, code enforces it — `withMandatoryReviewer` ([`src/core/lanes.ts`](../../../src/core/lanes.ts)) unions `reviewer` into every spec/plan lane set, from `--lanes` or `crLanes.<kind>` alike, and says so when it adds it; `pnpm noldor validate noldor-config` refuses a `crLanes.spec` / `crLanes.plan` block without `reviewer`; the overwrite guard withholds `keep-and-skip` for that lane, so a stale or red prior sink cannot stand in for the review. `--kind code` is exempt from the union — the `Noldor-Reviewed-Subagent` receipt the pre-push hook validates enforces it there. What code cannot enforce is a controller that never invokes orchestrate at all; the missing `proceed-without-review` option is what closes that hole.

## Invoke orchestrate

```
pnpm noldor cr orchestrate --slug <slug> --artifact <artifact-path> --kind <spec|plan> --lanes <list>
```

(Or `--autonomous` w/o `--lanes` per above.) On `address-blockers` re-rounds, also pass `--base-sha` as printed by `pnpm noldor cr autofix plan` (its `base-sha:` line — the authoritative value) so subagent + codex review only the diff; `--full-review` overrides back to whole-artifact. Do not try to read a prior artifact SHA out of a lane sink: `LaneFindings` carries `baseSha` only, never an `artifactSha`.

**Summary table.** Read orchestrate stdout and surface the per-lane summary in chat: lanes that ran, synthetic-OK lanes (empty-delta short-circuit), skipped pre-dep lanes, and per-lane sink paths at `.noldor/cr/<slug>-<kind>-<lane>.json`. Exit 0 = all sync lanes clean; exit 1 = blockers somewhere; exit 4 = refused before dispatch because a prior sink is unusable — repair or remove the file it names, then re-run.

**UI- or architecture-bearing session** (marker `uiVerdict: required` with no `uiWaiver`, or `archVerdict: required` with no `archWaiver`): **Read now:** [`design-writeback.md`](design-writeback.md) — its design-approval drift check runs before the continue dialog.

**Detailed spec summary (specs-only handoff).** When `kind === 'spec'` on a `specs-only-*` path, print a detailed summary of the committed spec to chat BEFORE the continue dialog — this pause is the last review surface before implementation (no plan stage follows), so a minimal "spec written, proceed?" prompt is not enough. Render four sections, each sourced from the spec body:

- **Scope** — what will be built, as bullets
- **Files touched** — code/test/doc paths the spec expects to change
- **Acceptance criteria** — verifiable outcomes the implementation must satisfy
- **Deferred risks / open questions** — what the spec explicitly postpones or leaves undecided

Mark any section the spec doesn't cover as `(not specified in spec)` rather than omitting it — a visible gap is itself review signal. The operator must be able to pick `proceed` / `address-blockers` without opening the spec file. `full-*` paths get their detailed review surface at the kind=plan pause; this summary targets the path that otherwise has none.

## Continue dialog

**Lead with the artifact link.** Open the message carrying this `AskUserQuestion` with the artifact's clickable link, re-pasted **verbatim** from what the auto-open hook supplied (the link rule above). The summaries *describe* the artifact; only the link *addresses* it — without one the operator scrolls back for the path or approves prose they did not re-read, and spec approval is the one gate whose whole value is that a human read the thing. Both kinds get it. No hook string to hand? Run `pnpm noldor design open <artifact-path>` and use its `link:` line.

Then surface `AskUserQuestion`. When `kind === 'plan'`, options are: `proceed-autonomous / proceed / address-blockers / abort`. When `kind === 'spec'`, the autonomous option is omitted (autonomous mode triggers on plan-confirm, not spec-confirm).

For `specs-only-*` paths, the kind=spec continue-dialog has no `proceed-autonomous` option — these paths have no plan stage. Operators wanting autonomous flows should use `full-*` paths. The `proceed` option at kind=spec advances:

- For `specs-only-*` → directly to implementation (no `/noldor-draft-feature-md`, no plan stage).
- For `full-*` → `/noldor-draft-feature-md <slug> --from-spec` + the `noldor-plan` skill + a second Step 2.5 at `--kind plan`.

- `proceed-autonomous` (kind=plan only) → run `pnpm noldor noldor set-autonomous` to set `session.autonomous = true`, then advance to implementation. All remaining seams between this point and PR-merge run without prompts. **Read now:** [`autonomous.md`](autonomous.md).
- `proceed` → advance to next skill in the path (interactive, today's behavior).
- `address-blockers` → **Read now:** [`blockers.md`](blockers.md) — the split-back question, the auto-fix seam and the round cap.
- `abort` → halt the path. Because the artifact was already committed at the top of Step 2.5, document `git reset --soft HEAD~1` in chat so the operator can unstage cleanly. **Abort does NOT remove `.noldor/cr/<slug>-<kind>-*.json` sinks** — on the next gate session the priors remain and `guardLaneOverwrite` catches them. State this explicitly so the operator knows the next round will prompt for overwrite/archive/keep.

This pause is the cheapest place to catch architectural drift, missing edge cases, or scope misalignment — far cheaper than fixing it post-implementation in the end-of-flow code review (Step 4).
