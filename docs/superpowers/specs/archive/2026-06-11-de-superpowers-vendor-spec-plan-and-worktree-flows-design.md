# De-Superpowers: Vendor Spec, Plan and Worktree Flows — Design

**Slug:** de-superpowers-vendor-spec-plan-and-worktree-flows
**FD:** docs/features/de-superpowers-vendor-spec-plan-and-worktree-flows.md
**Date:** 2026-06-11
**Tier:** full
**Deps:** none

## Problem

The framework's core flows depend on the third-party `superpowers` Claude Code plugin. Four load-bearing uses:

1. `superpowers:brainstorming` produces every spec — invoked by `/gate` on all four spec-carrying paths (`specs-only-new`, `specs-only-attach`, `full-new`, `full-attach`).
2. `superpowers:writing-plans` produces every plan — invoked by `/gate` on `full-*` paths.
3. `superpowers:using-git-worktrees` does worktree creation — invoked by `/gate` on every worktree-backed path.
4. `src/prep/draft.ts:18` bakes a `REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans` blockquote into every generated plan, so the dependency propagates into consumer repos at plan-execution time.
5. Gate prose describes the Step 2.5 CR lane `subagent` as "`superpowers:code-reviewer` subagent over the artifact diff" — prose-only coupling: the implementation (`src/cr/lanes/subagent-dispatch.ts`) is already self-contained (`claude -p` with an inline senior-reviewer prompt, no plugin reference). The stale description still blocks the zero-references goal and misdocuments the lane.

A consumer without the plugin cannot run the gate's spec/plan paths; an upstream plugin edit can silently change framework behavior. Secondary drift: `docs/noldor/lifecycle.md` still references `superpowers:requesting-code-review` and `superpowers:finishing-a-development-branch`, both already obsolete (CR runs via `noldor cr orchestrate`; gate Step 4 explicitly forbids the finishing skill). `docs/noldor/worktree-discipline.md` claims worktree `pnpm install` "re-installs lefthook hooks via postinstall" — false: `lefthook install` exits non-zero in a fresh worktree because `core.hooksPath` is already set to the shared `.git/hooks` (reproduced live 2026-06-11).

## Goals

- `/gate` spec, plan, and worktree stages run with zero references to the `superpowers` plugin.
- One canonical source for the spec/plan format contract, consumable from skills, from `src/prep/draft.ts`, and from consumer repos (which have no noldor `src/`).
- Generated plans are self-contained artifacts any agent can execute (inline task-by-task execution is the canonical documented mode, interactive and autonomous alike).
- Worktree creation is code, not prose: a CLI command implementing `docs/noldor/worktree-discipline.md` mechanics, including the lefthook-postinstall failure absorbed as a tolerated case.
- All prose references to `superpowers:*` skill invocations in live framework surfaces (skills, twins, `docs/noldor/`, engineering rules) are gone.

## Non-goals

- Path rename `docs/superpowers/` → `docs/design/{specs,plans}` — split back to the roadmap at promotion (`Path Rename: docs/superpowers to docs/design` entry, recovered 2026-06-11). All `docs/superpowers/` path strings stay valid.
- Historical artifacts: existing specs/plans under `docs/superpowers/`, FD body prose, archived refactor-workspace fixtures keep their `superpowers` mentions.
- Uninstalling the plugin from the operator's machine — the framework merely stops requiring it.
- Multi-runner shims (`.opencode/command/`, Codex prompts) — `multi-runner-agent-runtime-claude-code-codex-opencode` roadmap entry's territory; this feature is its dependency.

## Design

### Unit 1 — `src/prep/formats.ts` (canonical format contract)

Extract `SPEC_FORMAT` and `PLAN_FORMAT` const strings out of `src/prep/draft.ts` into a new `src/prep/formats.ts`, exported. `draft.ts` imports both; its local consts are deleted. Prompt text is byte-identical except one line: the plan-header blockquote.

Old (PLAN_FORMAT, `draft.ts:18`):

> blockquote: "> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking."

New:

> blockquote: "> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor."

PLAN_FORMAT's framing line `(full tier only — mirror superpowers:writing-plans)` becomes `(full tier only)`.

### Unit 2 — `noldor prep format <spec|plan>` (CLI print command)

New `src/prep/print-format.ts`: resolves the kind argument, prints the matching const verbatim + trailing newline to stdout, exit 0. Unknown/missing kind → usage line on stderr, exit 2. Registered in `src/cli/manifest.ts` under the existing `prep` group as `format`.

This is the single-sourcing mechanism (decision D1): skills instruct the agent to run `pnpm noldor prep format spec` (or `plan`) and follow the printed contract; `draft.ts` imports the const in-process; consumer repos get it through the installed package — no noldor `src/` checkout needed, no duplicated prose to drift.

### Unit 3 — `.claude/skills/noldor-spec/SKILL.md` (+ template twin)

Vendored brainstorming flow, noldor-owned. Frontmatter: `name: noldor-spec`, `user_invocable: true`, description triggering on spec/design-dialog work.

Kept from upstream: explore-project-context-first; one-question-per-message dialog (multiple-choice preferred); scope check with decomposition guidance for multi-subsystem asks; 2-3 approaches with trade-offs and a recommendation; sectioned design presentation with per-section approval; YAGNI; spec self-review (placeholder scan, internal consistency, scope, ambiguity — fix inline); write the spec to `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md`.

Format contract by reference, not duplication: the skill says "run `pnpm noldor prep format spec` and structure the document per the printed contract" — which carries the User Story / Usage / Open-questions-resolved sections the FD pipeline (`/draft-feature-md`, prep promote) lifts.

Dropped: visual companion (browser machinery); HARD-GATE / anti-pattern essays (condensed to one rule: no implementation action before operator approves the design); the "invoke writing-plans" terminal step; announce lines; commit instructions. **The skill ends by reporting the artifact path — `/gate` owns sequencing** because Step 2.5 (lint → commit → CR lanes → continue dialog) interleaves between spec and plan; a skill that self-chains would skip the CR gate.

### Unit 4 — `.claude/skills/noldor-plan/SKILL.md` (+ template twin)

Vendored writing-plans, noldor-owned. Frontmatter: `name: noldor-plan`, `user_invocable: true`.

Kept: zero-context-engineer stance ("assume a skilled developer who knows nothing about this codebase or toolset"); file-structure-before-tasks decomposition; bite-size steps (one 2-5 minute action each); per-task TDD order (failing test → run to verify FAIL → implement → run to verify PASS → commit); the no-placeholders "plan failures" list (TBD/TODO, "add error handling", tests without code, "similar to Task N", steps without code blocks, references to undefined symbols); exact paths, exact commands with expected output; save to `docs/superpowers/plans/YYYY-MM-DD-<slug>.md`.

Header contract by reference: "run `pnpm noldor prep format plan` and follow the printed contract" — the same rewritten inline-execution blockquote from Unit 1, so skill-authored and prep-generated plans carry identical headers.

Dropped: worktree-creation context note (gate created the worktree before any plan exists); subagent-dispatch references; announce line. Ends by reporting the plan path; gate sequences into Step 2.5 `--kind plan`.

### Unit 5 — `noldor worktrees create <slug>` (CLI worktree mechanics)

New `src/worktrees/create-worktree.ts`, registered in the manifest's existing `worktrees` group as `create`. Implements the mechanical steps of `docs/noldor/worktree-discipline.md`:

1. **Preflight:** must run from the main workspace (refuse when cwd is inside `.worktrees/` — checked via `git rev-parse --git-common-dir` vs `--git-dir` divergence); slug must be kebab-case; `.worktrees/<slug>` and branch `feat/<slug>` must both be absent.
2. **Create:** `git worktree add .worktrees/<slug> -b feat/<slug>` (base = current HEAD of the main checkout; gate Step 4 cleanup guarantees main is ff-synced between features).
3. **Install:** run `pnpm install` inside the new tree, with **lefthook tolerance**: when install exits non-zero AND `node_modules/.bin` is populated AND stderr matches the lefthook `core.hooksPath` complaint, emit a warning and continue — the hooks are already active for the worktree because `core.hooksPath` is an absolute path into the shared `.git/hooks`. Any other install failure is a hard error. The install runner is injectable (DI, mirroring `DrainDeps` style) so the tolerance branch is unit-testable without a real pnpm run.
4. **Port:** reuse `allocatePorts` from `src/worktrees/worktree-status.ts` to stamp `.env.local` in the new tree (parity with `worktrees status` auto-assignment).
5. **Report:** print worktree path, branch name, and the next-step hint (run baseline tests). Flag `--no-install` skips step 3 (restore case: `node_modules` already present).

Not absorbed (stays in `/gate`): session-marker write (path-specific shape) and the baseline test run (gate's verification step, path-dependent).

### Unit 6 — Prose sweep (each file + its template twin where one exists)

| File | Change |
| --- | --- |
| `.claude/skills/gate/SKILL.md` | all 11 colon-form references: `superpowers:brainstorming` → `noldor-spec` (5×); `superpowers:writing-plans` → `noldor-plan` (4× incl. the line-281 autonomous-mode sentence naming both); `superpowers:using-git-worktrees` → `pnpm noldor worktrees create <slug>`; Step 2.5 lane description "`superpowers:code-reviewer` subagent over the artifact diff" → "senior-reviewer subagent (self-contained `claude -p` prompt, `src/cr/lanes/subagent-dispatch.ts`)"; autonomous-mode executor prohibition reworded plugin-free ("do not delegate plan execution to subagent executors — execute inline per the plan header"); Step 4 "do NOT call superpowers:finishing-a-development-branch" reworded ("no interactive finishing flow — cleanup is scripted below"); line-235 historical note ("Earlier revisions… invoked `superpowers:requesting-code-review`") reworded without the colon-form token |
| `.claude/skills/draft-feature-md/SKILL.md` | both `superpowers:writing-plans` mentions → `noldor-plan` |
| `.claude/engineering-rules.md` | scope-guard intro genericized: "When dispatching an implementer subagent to execute a plan task" (drop the parenthetical plugin example) |
| `docs/noldor/complexity-gating.md` | "produced by `superpowers:brainstorming`" → `noldor-spec`; `superpowers:writing-plans` → `noldor-plan` in tier definitions + path walkthroughs |
| `docs/noldor/workflow.md` | §"Use /draft-feature-md" swap to noldor skill names |
| `docs/noldor/lifecycle.md` | mermaid nodes swap (brainstorming/writing-plans → noldor-spec/noldor-plan); stale `superpowers:requesting-code-review` node → `noldor cr orchestrate`; stale `superpowers:finishing-a-development-branch` paragraph → gate Step 4/5 scripted-cleanup prose |
| `docs/noldor/pr-flow.md` | line 14 flow-diagram stale `superpowers:requesting-code-review` → `noldor cr orchestrate --kind code` |
| `docs/noldor/worktree-discipline.md` | command table gains `pnpm noldor worktrees create <slug>` row; both colon-form references (`superpowers:using-git-worktrees`, `superpowers:subagent-driven-development` in the parallel-dev bullet) reworded to noldor equivalents; false "re-installs lefthook hooks via postinstall" claim corrected to describe the tolerated-failure behavior |
| `docs/noldor/skill-catalog.md` | +`## /noldor-spec`, +`## /noldor-plan` entries; "ships 9 user-invocable skills" → 11; line-38 "`before invoking superpowers:writing-plans`" → `noldor-plan` |

Template twins under `templates/.claude/skills/` and `templates/docs/noldor/` receive identical edits in the same commit (template-sync pre-commit gate enforces). New skill dirs get twins created.

### Unit 7 — Validators and distribution

- `pnpm noldor validate skill-catalog` (strict bidirectional gate) demands the catalog entries land in the same commit as the new skill dirs.
- Template-sync demands twins in the same commit.
- Shared-files pre-commit guard blocks `.claude/skills/**` edits from a worktree — implementation commits touching skills/twins use `NOLDOR_ALLOW_SHARED=1` (documented worktree-discipline override; this is the named legitimate case).

### Error handling

- `prep format`: unknown kind → stderr usage + exit 2 (matches CLI convention of non-zero structured failures).
- `worktrees create`: every preflight violation is a distinct, single-line hard error (wrong cwd, bad slug, existing tree, existing branch); install hard-fails on anything but the recognized lefthook-hooksPath case; `git worktree add` failure surfaces git's stderr verbatim.
- Vendored skills: self-review step catches placeholder/contradiction issues before the operator review; gate Step 2.5 CR lanes remain the backstop.

### Testing

- `src/prep/__tests__/formats.test.ts`: exports contain required section tokens (H1 shapes, `## Open questions (resolved)`, checkbox/TDD lines); regression guard `expect(SPEC_FORMAT + PLAN_FORMAT).not.toMatch(/superpowers/)`.
- `src/prep/__tests__/scaffold.test.ts` (existing): updated snapshot/assertions — built prompt carries the new blockquote, no plugin token.
- `src/prep/__tests__/print-format.test.ts`: kind dispatch, exit codes.
- `src/worktrees/__tests__/create-worktree.test.ts`: fixture tmp repo — creates tree + branch; refuses duplicate slug, existing branch, non-main cwd, bad slug; lefthook tolerance branch via injected install runner (recognized failure → warn+continue; unrecognized → throw); port stamped into `.env.local`; `--no-install` skips runner.
- Validators green: `validate skill-catalog` (11 entries), template-sync (twins), `validate features`.

## Acceptance criteria

- `grep -rn "superpowers:" .claude/skills templates/.claude templates/docs src docs/noldor .claude/engineering-rules.md` → zero hits (56 colon-form hits exist there today, verified 2026-06-11; `.claude/skills/garden/` and refactor-workspace fixtures carry only path-form mentions, which stay).
- `pnpm noldor prep format spec` and `... format plan` print the contracts; `pnpm noldor prep format bogus` exits 2.
- `noldor worktrees create <slug>` from main produces `.worktrees/<slug>` on `feat/<slug>` with `node_modules` populated and `.env.local` port stamped, surviving the lefthook postinstall failure with a warning.
- A full `/gate` `full-new` cycle (worktree → spec → plan → implementation) completes with the superpowers plugin absent from the machine.
- Generated plans (skill-authored and prep-generated) carry the identical inline-execution header; no `REQUIRED SUB-SKILL` line anywhere.
- All existing tests pass; new tests above pass; pre-commit validator chain green.

## Risks / trade-offs

- **Vendored skills freeze against upstream improvements.** Accepted — immunity to upstream drift is the feature's point; future upstream ideas get cherry-picked deliberately.
- **Dialog-discipline fidelity.** The vendored noldor-spec is a distillation; if it under-specifies the question loop, spec quality drops silently. Mitigation: keep the question-first loop text close to verbatim; gate Step 2.5 CR lanes review every spec anyway.
- **Gate-flow regression risk at the worktree stage.** The command replaces a battle-tested skill across all worktree paths. Mitigation: command's report mirrors the skill's report lines (path, branch, ready-state) so gate prose needs no structural change; fixture tests cover the refusal matrix.
- **`prep format` adds a CLI hop for agents.** One extra Bash call per artifact; negligible against zero-drift single-sourcing.

## User Story

As a framework adopter (human or agent) without the superpowers Claude Code plugin, I want the gate's spec, plan, and worktree stages to run on noldor-owned skills and CLI commands, so that I can drive the full feature lifecycle in my repo with no third-party plugin prerequisite and no upstream-drift exposure.

## Usage

- Spec stage (gate-invoked or standalone): invoke the `noldor-spec` skill; it dialogues to a design, then writes `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` per `pnpm noldor prep format spec`.
- Plan stage: invoke the `noldor-plan` skill; it writes `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` per `pnpm noldor prep format plan`.
- Worktree: `pnpm noldor worktrees create <slug>` from the main workspace (flags: `--no-install`).
- Format contract inspection (any agent, any repo with noldor installed): `pnpm noldor prep format <spec|plan>`.
- Plan execution (interactive and autonomous alike): follow the plan header — execute tasks inline, commit per task, tick checkboxes.

## Open questions (resolved)

1. _How should the format contract be single-sourced across skills, prep prompts, and consumer repos?_
   -> CLI print command (`noldor prep format <kind>`) backed by `src/prep/formats.ts` consts; skills reference the command, draft.ts imports the consts. (D1) Rationale: consumer repos lack noldor `src/`, package-shipped code is the only universally present carrier; zero duplicated prose.
2. _How much of brainstorming's dialog discipline survives the distillation?_
   -> Keep the question-first loop (one question per message, multiple-choice preferred), approaches stage, sectioned approval, self-review; drop visual companion and plugin meta. (D2) Rationale: the entry's own lean; the loop is the value, the machinery is not.
3. _Does the gate or the skill own stage sequencing?_
   -> Gate. Vendored skills end at the artifact path. (D3) Rationale: Step 2.5 CR gate interleaves between artifacts; self-chaining skills would bypass it (upstream brainstorming's "invoke writing-plans" terminal step is exactly the behavior being removed).
4. _Does `worktrees create` absorb the session-marker write or baseline test run?_
   -> No. Marker shape is gate-path-specific; baseline verification is the gate's step. Command = mechanics only. (D4) Rationale: keeps the command reusable outside gate flows (manual parallel worktrees per worktree-discipline).
5. _What happens to the known lefthook postinstall failure in fresh worktrees?_
   -> `worktrees create` tolerates exactly that failure signature (warn + continue, hooks verified active via shared `core.hooksPath`); `worktree-discipline.md`'s false claim is corrected. (D5) Rationale: reproduced live 2026-06-11; absorbing it in code removes a per-worktree operator confusion.
6. _Are the new skills user-invocable or gate-internal?_
   -> `user_invocable: true`, with skill-catalog entries (the strict catalog gate forces entries either way). (D6) Rationale: standalone spec/plan dialogs are legitimate (exploration without a gate session); zero extra cost.
