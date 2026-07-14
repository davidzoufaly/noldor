# Framework Auto-Split Suggestion for Big Features and Plans — Design

**Slug:** framework-auto-split-suggestion-for-big-features-and-plans
**FD:** docs/features/framework-auto-split-suggestion-for-big-features-and-plans.md
**Date:** 2026-07-03
**Tier:** specs-only
**Deps:** none

## Problem

Nothing in the pipeline measures scope size at the moments where the operator commits to a path. `/promote` (`.claude/skills/promote/SKILL.md`) scaffolds an FD from any roadmap block regardless of how bloated its body is; its residue check (step 6.5) catches *unscoped sub-items* but says nothing about a single oversized scope. The `noldor-plan` skill saves a plan of any length, and gate Step 2.5's `--kind plan` lint pass runs only `pnpm noldor noldor lint-plan-snippets` (`src/core/lint-plan-snippets.ts`), which lints code fences, not plan bulk. Size labels on roadmap entries are operator estimates with no cross-check against the body they describe — `sizeToPath()` in `src/core/size-routing.ts` routes purely on the label.

Live failure: `prefix-skills-with-noldor` sat mislabeled `S` for weeks; because XS/S entries skip `/promote` entirely (routed to `fast-track` by `sizeToPath`), no artifact stage ever looked at the body. A drain attempt finally revealed an L-sized self-referential mega-rename; the entry was parked in backlog and re-sized by hand (see the retirement note at `docs/roadmap.md:13`).

## Goals

- A pure, tested oversize-assessment module with named thresholds for (a) roadmap/backlog entry bodies, (b) FD `links.code` breadth on attach, (c) plan row count (~1000 rows per the roadmap entry's stated initial heuristic).
- A `pnpm noldor noldor split-check` CLI exposing the module with the same exit-code contract as `lint-plan-snippets` (0 clean / 2 findings / 1 infra error) so skills can shell out to it uniformly.
- Suggestion surfaces at the three commit points: `/promote` before scaffold/attach, the `noldor-plan` skill after save, and gate Step 2.5 `--kind plan` alongside the existing lint pass.
- Drain-mode guard: a headless drain never ships an entry whose body trips the oversize signals — it exits and surfaces instead (the exact `prefix-skills-with-noldor` failure mode).
- Findings are informational for interactive paths — the operator decides; the framework never auto-splits.

## Non-goals

- Automatic splitting or rewriting of roadmap blocks, FDs, or plans — the suggestion names the signals; the operator (or a follow-up interactive session) performs the split.
- Automatic re-sizing of roadmap `- size:` labels.
- Triage-time enforcement — `/triage` already sizes with the operator in the loop; this feature guards the *downstream* commit points.
- Retroactive sweep over existing FDs (e.g. the deliberately catch-all `docs/features/noldor.md` with ~50 `links.code` entries) — signals fire only on the entry/plan currently being promoted/planned.
- Config-surface for thresholds (see D1).

## Design

### Unit 1 — `src/core/split-suggestion.ts` (pure module)

New module next to `size-routing.ts` (the existing size-policy home). Exports:

```ts
export interface SplitSignal {
  readonly rule: string;      // 'E1' | 'E2' | 'E3' | 'F1' | 'P1'
  readonly value: number;
  readonly threshold: number;
  readonly message: string;   // human sentence incl. suggested remedy
}

export const ENTRY_WORD_THRESHOLD = 300;
export const ENTRY_BULLET_THRESHOLD = 6;
export const ENTRY_TOUCHES_THRESHOLD = 8;
export const FD_LINKS_CODE_THRESHOLD = 30;
export const PLAN_ROW_THRESHOLD = 1000;

export function assessEntrySplit(entry: Pick<BacklogEntry, 'description'>): SplitSignal[];
export function assessFdBreadth(linksCode: readonly string[], addedTouches: readonly string[]): SplitSignal | null;
export function assessPlanSplit(planMd: string): SplitSignal[];
```

- `assessEntrySplit` runs three heuristics over `BacklogEntry.description` (the free-text body `parseRoadmap`/`parseBacklog` in `src/utils/parse-blocks.ts` already separates from the `- key: value` bullet fields):
  - **E1** — word count > `ENTRY_WORD_THRESHOLD` (whitespace-split tokens).
  - **E2** — scope-bullet count > `ENTRY_BULLET_THRESHOLD` (lines matching `/^\s*-\s+/` in the description).
  - **E3** — touches breadth: `extractTouches(description).paths.length > ENTRY_TOUCHES_THRESHOLD`, reusing `extractTouches` from `src/core/extract-touches.ts` (already the canonical `Touches:` parser used by `/promote` step 6.4).
- `assessFdBreadth` fires **F1** when `dedupe([...linksCode, ...addedTouches]).length > FD_LINKS_CODE_THRESHOLD` — the "attach would make this parent an everything-FD" signal.
- `assessPlanSplit` fires **P1** when the plan's line count (`planMd.split('\n').length`) exceeds `PLAN_ROW_THRESHOLD` — the roadmap entry's stated initial heuristic (~1000 rows, one part ≈ 1000 rows). The message includes the suggested part count: `Math.ceil(rows / PLAN_ROW_THRESHOLD)`.

Tests at `src/core/__tests__/split-suggestion.test.ts` (boundary at/over threshold per rule, empty inputs, dedupe in F1, `extractTouches` reuse in E3).

### Unit 2 — `split-check` CLI (`src/core/split-check-cli.ts`)

Registered in `src/cli/manifest.ts` under the existing `noldor` group (same block as `'lint-plan-snippets'` at `src/cli/manifest.ts:332`):

```ts
'split-check': { src: 'core/split-check-cli.ts', desc: 'Suggest a split when an entry/FD/plan exceeds size thresholds' },
```

Modes:

- `pnpm noldor noldor split-check --entry <slug>` — resolves the block by slug from `docs/roadmap.md` then `docs/backlog.md` (via `loadDocRoots` from `src/core/doc-roots.ts` + `parseRoadmap`/`parseBacklog`), runs `assessEntrySplit`.
- `pnpm noldor noldor split-check --plan <path>` — reads the file, runs `assessPlanSplit`.
- `pnpm noldor noldor split-check --fd <slug> [--add <path>...]` — reads `docs/features/<slug>.md` frontmatter `links.code` (gray-matter, as `next-priority.ts` already does for FD frontmatter), runs `assessFdBreadth` with any `--add` paths (the attach-branch pending touches).

Exit contract mirrors `lint-plan-snippets` exactly (0 = clean, 2 = signals present with one stdout line per `SplitSignal`, 1 = infra error e.g. slug not found / unreadable path) so the gate's existing "never block on linter infra" prose applies unchanged.

### Unit 3 — `/promote` integration (skill prose)

New **step 1.7** in `.claude/skills/promote/SKILL.md`, after attach detection (1.5), before block parsing (2):

- Scaffold branch: run `split-check --entry <slug>`. On exit 2, AskUserQuestion with the signals verbatim: **(a) proceed anyway**, **(b) split first** — operator splits the source block into sibling blocks using the same sibling-write-back mechanics as residue disposition 6.5(b) (H3/H4 placement, carried bullets, `- recovered:` provenance), then re-runs `/promote` on one slice, **(c) abort and re-size** — leave the block, fix `- size:`.
- Attach branch: additionally run `split-check --fd <parent-slug> --add <extracted-touches...>` (paths from step 6.4's `extractTouches`). An F1 signal is surfaced in the same prompt — the remedy offered is "scaffold a child FD instead of attaching".

### Unit 4 — plan-side integration (skill + gate prose)

- `noldor-plan` skill (`.claude/skills/noldor-plan/SKILL.md`): new step between self-review (5) and save-report (6) — after writing the file, run `split-check --plan <path>`; on exit 2, report the P1 signal and restructure into `docs/design/plans/YYYY-MM-DD-<slug>-part<N>.md` parts (each part independently shippable, per the skill's existing "one plan per subsystem" rule in step 1) before reporting done.
- Gate Step 2.5 (`.claude/skills/gate/SKILL.md`, "Lint pass first" paragraph at line ~113): for `--kind plan`, run `split-check --plan <artifact-path>` alongside `lint-plan-snippets`, append its stdout to the same AskUserQuestion description. Informational, identical semantics — Step 2.5 is the authoritative checkpoint because autonomous/plans-drain paths execute committed plans without re-invoking the skill.

### Unit 5 — drain-mode guard (skill prose)

Gate drain-mode section already exits when `suggestedPath !== 'fast-track'` (defensive check, `.claude/skills/gate/SKILL.md:352`). Add one step after that check: run `split-check --entry <slug>`; on exit 2, **exit without scaffolding** and surface the signals (the supervisor's escalation surface), instead of shipping. This is the mislabeled-`S` closure: an entry whose *label* routes to fast-track but whose *body* trips E1/E2/E3 gets bounced back to a human instead of calcifying into a doomed drain iteration.

### Docs

- `docs/noldor/complexity-gating.md` — new "Split suggestion" subsection: the five rules, thresholds, where each surfaces, informational-vs-drain semantics.
- Skill edits in Units 3–5 must land in template twins too (`src/templates/` manifest copies; `NOLDOR_ALLOW_SHARED` required for skill-twin edits per the shared-files guard).

## Acceptance criteria

- `assessEntrySplit` returns `[]` for a body at each threshold and one signal per rule for a body one unit over; E3 counts `Touches:` paths via `extractTouches` (verified with backtick + md-link forms).
- `assessPlanSplit` on a 1001-line plan returns a P1 signal whose message names 2 parts; 1000 lines → `[]`.
- `assessFdBreadth([30 paths], ['new.ts'])` fires F1; duplicate added paths do not double-count.
- `pnpm noldor noldor split-check --entry <oversized-slug>` exits 2 with one line per signal; unknown slug exits 1; clean entry exits 0.
- `pnpm noldor noldor split-check --plan <path>` honors the same 0/2/1 contract.
- `/promote` SKILL.md contains step 1.7 with the three-way disposition; gate SKILL.md Step 2.5 `--kind plan` prose names `split-check`; drain-mode section contains the exit-without-scaffolding guard; `noldor-plan` SKILL.md contains the post-save check. Template twins byte-identical to repo skills (`pnpm noldor templates diff` clean).
- `pnpm vitest run src/core/__tests__/split-suggestion.test.ts` green; `pnpm verify` green.

## Risks / trade-offs

- **Threshold miscalibration** — constants are first guesses; too low → prompt fatigue → operators reflex-pick "proceed anyway" and the signal dies. Mitigation: informational-only in interactive paths, single consolidated prompt, and constants live in one exported block so tuning is a one-line diff.
- **Word/bullet counts are crude proxies** — a terse L and a verbose S both exist. Accepted: this is a *suggestion* layer; `sizeToPath` routing is untouched.
- **Drain guard adds a new drain-refusal class** — oversized-body entries now stall in the queue until a human re-sizes. That is the intent (surface, don't ship), but queue-drain throughput drops if many entries trip it; the escalation message must name the exact signals so triage is one glance.
- **Skill-prose changes are unenforced** — Units 3–5 are LLM-followed instructions, not hooks. The CLI (Unit 2) is the testable core; prose drift is caught by the existing skill/twin diff machinery, not by CI semantics.

## User Story

As an operator promoting roadmap entries and reviewing plans, I want the framework to flag oversized scope — bloated entry bodies at `/promote`, everything-FD attaches, and plans past ~1000 rows — before I commit to a path, so that work gets split early instead of calcifying around a mislabeled entry or an unwieldy plan.

## Usage

**Ad-hoc CLI**

```
pnpm noldor noldor split-check --entry <slug>        # roadmap/backlog body heuristics (E1–E3)
pnpm noldor noldor split-check --fd <slug> --add p1.ts --add p2.ts   # attach breadth (F1)
pnpm noldor noldor split-check --plan docs/design/plans/2026-07-03-foo.md  # row count (P1)
```

Exit 0 = clean, 2 = signals on stdout (one per line), 1 = infra error.

**In-flow (no extra operator action)**

1. `/promote <slug>` — step 1.7 runs the entry check automatically; on signals, pick proceed / split-first / abort-and-re-size. Attach picks also see the F1 parent-breadth signal.
2. `noldor-plan` — post-save check; an oversized plan is restructured into `-part<N>` files before the skill reports done.
3. `/gate` Step 2.5 `--kind plan` — split findings appear alongside lint findings in the continue-dialog, informational.
4. Headless drain — an entry whose body trips the signals is bounced to the escalation surface instead of shipped.

**Keyboard shortcut** — none (CLI + skill flow).

## Open questions (resolved)

1. *Should thresholds be configurable via `.noldor/config.json`?*
   -> No — exported constants in `split-suggestion.ts`, tuned by editing the module. (D1) `docs/vision.md` posture: "opinionated, not configurable"; a config knob invites per-consumer drift before we have calibration data.
2. *Blocking or informational?*
   -> Informational everywhere an operator is present (exit 2 + prompt, mirroring the `lint-plan-snippets` "findings do not gate the choice" contract); the only hard stop is headless drain, where no operator can absorb the signal. (D2) Blocking interactive paths on crude heuristics would train operators to bypass.
3. *Where does the plan check run — the `noldor-plan` skill or gate Step 2.5?*
   -> Both; Step 2.5 is authoritative. (D3) The skill self-check fixes plans cheapest (pre-commit), but autonomous/plans-drain paths consume committed plans without the skill, so the gate pass is the one that always fires.
4. *What is a plan "row" — markdown lines or checkbox steps?*
   -> Raw markdown lines (`split('\n').length`). (D4) Matches the roadmap entry's "~1000 rows" framing directly and needs no parsing; a checkbox-step count is a later refinement if line count proves noisy.
5. *Initial threshold values?*
   -> E1=300 words, E2=6 scope bullets, E3=8 touches, F1=30 links.code, P1=1000 rows. (D5) Current roadmap bodies run well under 150 words / 4 bullets, and shipped plans cluster far below 1000 lines — these fire only on genuine outliers like the `prefix-skills-with-noldor` mega-rename.
6. *Should the entry check also run at interactive gate Step 0 pick (before `/promote`)?*
   -> No — `/promote` step 1.7 is downstream of every interactive pick and XS/S picks are covered by the drain guard's same CLI; duplicating the prompt at Step 0 adds a second interruption for zero new coverage. (D6) One prompt per commit point.
