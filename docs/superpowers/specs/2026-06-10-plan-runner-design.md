# Plan-Runner — Autonomous Plan Executor — Design

**Slug:** `plan-runner`
**FD:** [docs/features/plan-runner.md](../../features/plan-runner.md) *(scaffolded at /promote)*
**Date:** 2026-06-10
**Tier:** full
**Deps:** `autonomous-queue-drain-runner`

> Sibling to the shipped `autonomous-queue-drain-runner`. Where queue-drain ships *un-designed* fast-track (XS/S) roadmap entries, plan-runner ships *already-designed* work — in-progress FDs that carry an approved spec **and** plan — by resuming them autonomously, one auto-merged PR at a time. It is the execution end of the pipeline whose authoring end is the `prep` CLI (`noldor prep fanout` → `prep promote`).

## Problem

The shipped queue-drain runner is deliberately **fast-track-only** (XS/S): autonomous *design* stages (brainstorm → spec → plan) are unreliable, so it refuses M/L/XL and only ships entries that need no design. That leaves a capability gap: a feature that has *already* been designed by a human (spec + plan written and CR-approved, FD `phase: in-progress`) is safe to implement unattended — the risky design stage is already paid for — yet there is no runner that drains those. Today the operator must sit at each in-progress FD and run `/gate --resume <slug>` by hand, `/clear` between features. That is the same "human between every feature" cost queue-drain removed for small work, still being paid for designed work.

## Goals

- Drain the set of **in-progress, fully-designed FDs** (spec + plan present) autonomously: one `claude --print "/gate --resume <slug>"` child per FD, one auto-merged PR at a time, always-clear preserved.
- Take on the **M/L/XL** work queue-drain refuses, *because* the design risk is already retired by the committed plan.
- **Reuse** the shipped supervisor wholesale — lock, retry-then-skip, per-iteration timeout, `NOLDOR_DRAIN`, `--disallowed-tools AskUserQuestion` kill-switch, autonomous config triple, state heartbeat. No second supervisor.
- Land the source abstraction as a **clean injected seam** so `runDrain`/`decideNext`/`drain-io` stay source-agnostic and pure, with `--source roadmap` regressing queue-drain to byte-identical behavior.

## Non-goals

- **Specs-only execution (spec but no plan).** Deferred to phase 2 — it needs an autonomous `writing-plans` step, which is exactly the risky design stage the queue-drain MVP deferred. `--source specs` errors until then (see D6).
- Weakening always-clear, auto-merge, or the CR gate. Plan-runner spawns the same `/gate`; it does not bypass review.
- Authoring or promoting features. That is `prep-fanout` + the promote bridge. Plan-runner only *consumes* in-progress FDs.
- Cross-feature dependency ordering / DAG scheduling. FIFO by plan age (D2); dependency-aware ordering is future work.

## Design

### 1. Source abstraction — `src/autonomous/drain-source.ts` (new)

Today the source is hard-coded to the roadmap in exactly two closures inside `queue-drain.ts` `main()`: the `nextPriority` closure (`getSuggestions` over `loadDocRoots(cwd).roadmap`) and the `parseAll` closure (`parseRoadmap(...).map(e => e.slug)`). `drain-loop.ts` and `drain-io.ts` contain no source hard-coding. We make the source first-class:

```ts
export type SourceId = 'roadmap' | 'plans' | 'specs'

export interface DrainCandidate {
  slug: string
  description: string   // body used by eligibility; '' when N/A
  eligible: boolean      // may this slug be spawned? (replaces the fast-track literal)
  reason?: string        // why not, for the skip log
}

export interface DrainSource {
  id: SourceId
  /** next candidate not in `skip`, or null when none remain */
  nextItem(skip: Set<string>): DrainCandidate | null
  /** success-oracle universe: ALL items (unfiltered); absence === shipped */
  parseAll(): string[]
  /** prompt handed to `claude --print` for this slug */
  gatePrompt(slug: string): string
  /** branch the shipped PR lives on, for openPrExistsFor */
  branchFor(slug: string): string
}
```

Two implementations now: `roadmapSource(cwd)` and `plansSource(cwd)`. `specsSource` throws a clear "not yet implemented" (D6).

### 2. `roadmapSource` — preserves current behavior exactly

- `nextItem(skip)`: today's `getSuggestions(...).topPriority[0]`, with `eligible = suggestedPath === 'fast-track' && isDrainEligible(description)` and `reason` set when not. Returns the entry as a `DrainCandidate`.
- `parseAll()`: `parseRoadmap(read(roadmap)).map(e => e.slug)`.
- `gatePrompt()`: always `'/gate'` (drain Step 0 auto-selects `topPriority[0]`).
- `branchFor(slug)`: `'fast/' + slug` (the deterministic drain branch).

`--source roadmap` (the default) therefore reproduces queue-drain byte-for-byte — existing `run-drain.test.ts` / `queue-drain-cli.test.ts` must pass unchanged.

### 3. `plansSource` — the new capability

- `nextItem(skip)`: read every `docs/features/*.md`; keep FDs with `phase: in-progress`; for each, check a spec (`docs/superpowers/specs/*-<slug>-design.md`) **and** a plan (`docs/superpowers/plans/*-<slug>.md`) exist. Order by ascending plan-file date-prefix (FIFO — oldest designed work first, D2). Drop slugs in `skip`. Return the first as a `DrainCandidate` with `eligible: true`. An in-progress FD missing a plan is **not eligible** (`reason: 'no plan — specs source (phase 2)'`) so it is skipped, not failed.
- `parseAll()`: all `phase: in-progress` FD slugs (the universe). A slug is **shipped** iff it is absent on the post-spawn re-read — i.e. the gate flipped `phase: in-progress → done` and merged. This reuses the oracle contract: absence === shipped; the gate child's exit status is never trusted.
- `gatePrompt(slug)`: `'/gate --resume ' + slug`.
- `branchFor(slug)`: `'feat/' + slug` (full-path worktree branch, not `fast/`).

### 4. Loop + IO changes (small, pure)

- `drain-loop.ts` `decideNext`: replace the `entry.suggestedPath !== 'fast-track'` / `isDrainEligible(entry.description)` checks with a single `if (!candidate.eligible) return 'skip-out-of-scope'`. Caps (`shipped >= maxFeatures`, `spawns >= maxSpawns`) still fire first. The fast-track/eligibility logic moves *into* `roadmapSource`, keeping `decideNext` source-agnostic.
- `runDrain`: take `source: DrainSource` (via `DrainDeps` or a new field). Replace the `nextPriority` dep call with `source.nextItem(skip)`; the `parseAll` dep with `source.parseAll()`; pass `source.gatePrompt(slug)` to `spawnGate`; pass `source.branchFor(slug)` to `openPrExistsFor`.
- `drain-io.ts`: `spawnGate(env, timeoutMs, prompt = '/gate')` — thread the prompt into `['--print', prompt, '--disallowed-tools', 'AskUserQuestion', '--permission-mode', 'bypassPermissions']` (kill-switch + bypass retained). `openPrExistsFor(slug, branch)` — accept the branch instead of assuming `fast/<slug>`.

### 5. Gate drain-resume branch — `.claude/skills/gate/SKILL.md`

`/gate --resume <slug>` already short-circuits Step 0 + Step 1 and re-establishes the marker for an in-progress FD. New behavior **only under `NOLDOR_DRAIN=1`**:

1. After re-establishing the marker and creating the worktree, detect that the FD already has a **committed spec and plan** on `origin/main`.
2. When both are present, set `session.autonomous = true` (`pnpm noldor noldor set-autonomous`) and advance **directly to inline implementation** — do NOT re-invoke `superpowers:brainstorming` or `superpowers:writing-plans` (the design is done) and do NOT pause at a Step 2.5 continue-dialog (zero AskUserQuestion under drain).
3. Implementation runs inline (gate autonomous-mode rules — read plan MD, execute task-by-task, commit at each boundary, tick `- [x]`), then Step 4 autonomous end-of-flow ships the PR, Step 5 exits clean.

This is the one gate-skill addition; everything else is supervisor-side. The interactive (`NOLDOR_DRAIN` unset) `--resume` path is unchanged.

### 6. CLI — `src/autonomous/queue-drain.ts` + `src/cli/manifest.ts`

Generalize the command to a source-parameterized runner (D1):

- `pnpm noldor autonomous run --source roadmap|plans` (default `roadmap`). Builds the matching `DrainSource`, then the identical `runDrain`.
- `pnpm noldor autonomous queue-drain` retained as an **alias** for `run --source roadmap` (back-compat; existing docs/tests/muscle-memory keep working).
- All other flags unchanged: `--dry-run`, `--max-features` (20), `--max-retries` (2), `--iteration-timeout` (30 min), `--json`. `--source specs` parses but `specsSource` throws → exit 1 with the phase-2 message.

`assertConfig` is unchanged — the same headless-safe triple (`autonomous.onFailure: 'abort'`, `skipLanePicker: true`, `requireHumanPrApproval: false`) gates every source.

## Acceptance criteria

- `pnpm noldor autonomous run --source roadmap` and `pnpm noldor autonomous queue-drain` produce identical behavior; all existing `src/autonomous/__tests__` pass with no edits beyond the injected-source wiring.
- `--source plans --dry-run` lists, in FIFO plan-age order, every in-progress full-tier FD (spec + plan present), and skips in-progress FDs that lack a plan with reason `no plan — specs source (phase 2)`.
- `--source plans` (live) spawns `claude --print "/gate --resume <slug>"` per eligible FD, ships each as one auto-merged PR on branch `feat/<slug>`, and counts a slug shipped iff its FD is absent from the post-spawn in-progress set (phase flipped to done).
- Retry-then-skip, lock, per-iteration timeout, SIGINT/`.noldor/drain-stop` kill switch, and the `--disallowed-tools AskUserQuestion` backstop all function identically across sources.
- Under `NOLDOR_DRAIN=1`, `/gate --resume <slug>` on an FD with committed spec+plan implements autonomously with zero AskUserQuestion and ships — it does not re-run brainstorm/writing-plans.
- `--source specs` exits 1 with a clear "not yet implemented (phase 2)" message.
- `decideNext` and `runDrain` contain no source/path literals (`'fast-track'`, `'roadmap'`, `'feat/'`, `'fast/'`); all such knowledge lives in `drain-source.ts`.

## Risks / trade-offs

- **Gate drain-resume is new gate behavior.** Risk: a resume re-enters a design stage and either prompts (hangs, caught by the kill-switch → iteration-timeout → skip) or redoes work. Mitigation: gate detects committed spec+plan and jumps straight to implementation; covered by an integration test on a seeded in-progress FD.
- **Partial-plan resume.** A plan with some `- [x]` tasks must continue from the first unchecked task, not restart. Mitigation: autonomous implementation reads checkbox state; the phase-flip oracle only fires on full completion + merge, so an incomplete resume that errors is retried/skipped, never falsely "shipped".
- **Branch-prefix divergence** (`fast/` vs `feat/`). If `openPrExistsFor` kept assuming `fast/<slug>` it would never find a plan-runner PR and could double-spawn. Mitigation: `branchFor` is source-owned and threaded through (D4); restart-safety test covers it.
- **FD ordering is FIFO-by-plan-age, not priority** (FDs leave the roadmap at promote, losing priority rank). Acceptable for designed work; dependency-aware ordering is explicit future work.
- **Larger blast radius per iteration** (M/L/XL vs XS/S). Mitigation: `--max-features` defaults low, `--iteration-timeout` bounds each, and a failed implementation aborts that iteration (retry-then-skip), never the whole drain unless systemic.

## User Story

As an operator with a stack of already-designed in-progress FDs (each carrying a CR-approved spec and plan), I want one command — `pnpm noldor autonomous run --source plans` — that resumes and ships them autonomously, one auto-merged PR at a time in a fresh always-cleared context, so that I drain my designed backlog without sitting at every feature to `/gate --resume` and `/clear` between them.

## Usage

**CLI**

1. Ensure in-progress FDs you want shipped each have a committed spec (`docs/superpowers/specs/*-<slug>-design.md`) and plan (`docs/superpowers/plans/*-<slug>.md`) — the output of `noldor prep fanout` + `noldor prep promote`.
2. Ensure `.noldor/config.json` sets `autonomous: { "onFailure": "abort", "skipLanePicker": true, "requireHumanPrApproval": false }` (same precondition as queue-drain; the runner refuses to start otherwise).
3. From a clean, synced `main`, preview: `pnpm noldor autonomous run --source plans --dry-run` (lists eligible FDs in FIFO plan-age order, plus skip reasons).
4. Run live: `pnpm noldor autonomous run --source plans`. Tune with `--max-features N` (default 20), `--max-retries N` (default 2), `--iteration-timeout MS` (default 30 min); add `--json` for a machine summary.
5. Stop cleanly between iterations with SIGINT (Ctrl-C) or `touch .noldor/drain-stop` (exit 130).

**Aliases / sources**

- `pnpm noldor autonomous queue-drain` == `autonomous run --source roadmap` (fast-track XS/S roadmap entries — the shipped behavior).
- `--source specs` is reserved (phase 2) and currently exits 1.

**Exit codes**

- `0` completed (drained / all-skipped / `--max-features` reached) · `1` aborted (config/lock/parse/`gh`/git-sync, or `--source specs`) · `130` stopped via kill switch.

## Open questions (resolved)

1. *One command with `--source`, or a separate `plan-runner` subcommand?* → Generalize to `autonomous run --source roadmap|plans|specs`; keep `queue-drain` as an alias for `run --source roadmap` (D1). The loop is identical across sources, so a second subcommand would duplicate wiring; an alias preserves back-compat and discoverability.
2. *How are plans-source FDs ordered (they have no roadmap priority)?* → Ascending plan-file date-prefix, i.e. FIFO oldest-designed-first (D2). Deterministic, no extra metadata, and ships the longest-waiting designed work first.
3. *Does plans-source require both spec and plan, or plan alone?* → Require both; an in-progress FD with a spec but no plan is **skipped** (specs-source territory, phase 2), not failed (D3). Keeps plans-source strictly "fully designed."
4. *How does PR-exists restart-safety work when the branch is `feat/<slug>` not `fast/<slug>`?* → `DrainSource.branchFor(slug)` owns the prefix; `openPrExistsFor(slug, branch)` takes it as an argument (D4). No source literal leaks into the loop.
5. *Where does autonomous mode get enabled on a resumed FD?* → In the gate drain-resume branch: under `NOLDOR_DRAIN=1`, when the FD has a committed spec+plan, gate sets `session.autonomous = true` and skips the Step 2.5 continue-dialog, going straight to inline implementation (D5).
6. *Build specs-source now or defer?* → Defer to phase 2 (D6). It requires an autonomous `writing-plans` step — the risky design stage the queue-drain MVP deliberately omitted. `--source specs` errors with a phase-2 message until a separate FD takes it on.

## Out of scope (YAGNI)

- A `DrainSource` registry / plugin system — two static constructors (`roadmapSource`, `plansSource`) suffice; do not build the abstraction past what the third source (`specs`, phase 2) needs.
- Dependency-aware ordering, parallel multi-PR drains, and per-FD config overrides.

## Files touched (proposed)

- `src/autonomous/drain-source.ts` *(new)* — `DrainSource` interface, `roadmapSource`, `plansSource`, `specsSource` (throws).
- `src/autonomous/drain-loop.ts` — `decideNext` consumes `candidate.eligible`; `runDrain` takes + drives a `DrainSource`.
- `src/autonomous/drain-io.ts` — `spawnGate(env, timeoutMs, prompt)`; `openPrExistsFor(slug, branch)`.
- `src/autonomous/queue-drain.ts` — parse `--source`; build the source; `run` command + `queue-drain` alias.
- `src/cli/manifest.ts` — register `autonomous run` (+ keep `queue-drain`).
- `.claude/skills/gate/SKILL.md` — drain-resume autonomous-from-plan branch (Step 2 / resume section).
- Tests: `drain-source.test.ts` (new), updated `run-drain.test.ts` / `queue-drain-cli.test.ts`, an integration test for gate drain-resume on a seeded in-progress FD.

## Related

- Deps / parent: [autonomous-queue-drain-runner](../../features/autonomous-queue-drain-runner.md) — the supervisor this reuses.
- Sibling: the `prep` CLI — `noldor prep fanout` (`src/prep/prep-fanout.ts`) drafts the spec+plan and `noldor prep promote` (`src/prep/prep-promote.ts`) produces the in-progress FDs plan-runner consumes. Together: prep fanout drafts → operator ratifies → prep promote → **plan-runner ships**.
- Origin: operator-floated during the queue-drain gate (2026-06-10); the "separate FD, reuse the supervisor, plans-first, specs-source deferred" cut matches that analysis.
