# Oversize Task Split: Which Phase Owns It — Design

**Slug:** framework-auto-split-suggestion-for-big-features-and-plans-split-phase-ownership
**FD:** docs/features/framework-auto-split-suggestion-for-big-features-and-plans.md
**Date:** 2026-08-16
**Tier:** specs-only
**Entry:** Q-0108

## Problem

`split-check` measures oversize scope at four points and reports signals, but nothing states **which phase owns the split**. Three consequences follow.

**Triage is blind.** `/noldor-triage` assigns `size:` from bullet text (`.claude/skills/noldor-triage/SKILL.md:47`) and runs no measurement. `sizeToPath()` then routes purely on that label. The earliest and cheapest phase never looks at the body it is labelling.

**There is no precedence, so splits happen late.** An entry can trip nothing until `noldor-plan` — the point of maximum context, where an agent is holding a spec, an FD, and a 1000-row plan. The roadmap entry states the goal as the inverse: *work with the smallest context that can still ship a slice*.

**The remedies are inconsistent and unlabelled.** `/noldor-promote` step 1.7 offers proceed / split-first / abort-and-re-size and produces sibling roadmap entries. `noldor-plan` step 6 auto-restructures into `-part<N>` files. Gate Step 2.5 reports S1/S2 and P1 with no remedy at all. Three different products, no statement of which is correct when.

Traceability leaks at every split. Promote's residue write-back (`.claude/skills/noldor-promote/SKILL.md` 6.5(b)) stamps `- recovered: YYYY-MM-DD` but carries no link to the source `- id:`. Worse, a promote-1.7(b) split *replaces* the source block in place without calling `remove-block`, so the source ID vanishes with no record — and any `blocked-by:` naming it starts tripping `unknown-blocked-by-ref` ([`validate-triage.ts:229`](../../../src/triage/validate-triage.ts#L229)).

A related wart: `FIELD_KEYS` at [`parse-blocks.ts:216`](../../../src/utils/parse-blocks.ts#L216) is a deliberately-explicit allowlist, so `- recovered:` is not a field — it lands in `description` and adds +1 to the E2 scope-bullet count of every residue sibling. The provenance bullet inflates the heuristic that produced it.

## Goals

- State one authoritative phase-ownership policy, with a named owner and a single split product.
- Give the earliest phase (triage) measurement it currently lacks, at zero new CLI surface.
- Give the late phases (spec, plan) a real remedy instead of an informational line.
- Make a split traceable in both directions without breaking `blocked-by:` resolution.

## Non-goals

- **No auto-splitting and no auto-re-sizing.** The framework suggests; the operator decides. This holds unchanged (`split-suggestion.ts` header comment).
- **No threshold changes.** All seven constants stay as they are.
- **No new hard blocks.** The headless drain remains the only place a signal stops work; every operator-present surface stays advisory.
- **No shared `roadmap carve` CLI.** Sibling bodies are authored, not derived, so the write-back stays skill prose in this slice — recorded as a follow-up in Open questions (5).

## Design

### U1 — The phase-ownership policy (`docs/noldor/complexity-gating.md`)

The "Split suggestion" subsection gains the policy the rules table implies but never states. Three claims:

**Owner: `/noldor-promote` step 1.7.** Promote is the queue→FD boundary. Before it, a split is a roadmap edit and costs nothing; after it, a split means unwinding an FD scaffold, a category pick, a phase-revert and a retired-ID record. Promote is therefore the last point where splitting is free, and it already carries the remedy.

**Product: sibling roadmap entries, always.** Every scope split — whoever notices it — produces `### ` blocks in `docs/roadmap.md`. There is one shape to learn and one to document.

**Scope-split vs document-split.** A *scope split* moves scope out of the FD and produces queue siblings. A *document split* moves no scope: `-part<N>` plan files reorganize one FD's plan and stay local. `-part<N>` therefore does not violate the single-product rule — it is not a scope split.

The resulting phase table replaces the "Informational vs drain" paragraph's implicit ordering:

| Phase | Measures | Role | On trip |
| --- | --- | --- | --- |
| triage | E1/E2/E3 | pre-warn | report signals; operator may split rows before writing blocks |
| promote 1.7 | E1/E2/E3, F1 | **owner** | split-first → sibling roadmap entries |
| drain Step 0 | E1/E2/E3 | hard stop | exit unscaffolded → escalation (unchanged) |
| gate 2.5 spec | S1/S2 | bounce | `split-back` → carve siblings, narrow the spec |
| gate 2.5 plan | P1 | bounce or document-split | diagnose scope vs verbosity |

### U2 — `split-from` and `recovered` become parsed fields ([`src/utils/parse-blocks.ts`](../../../src/utils/parse-blocks.ts))

`FIELD_KEYS` gains `split-from` and `recovered`. Following the file's own note that a new field key is *"added here once"*, the change is three coordinated edits: the `FIELD_KEYS` string (line 216), the `parseBlockBody` local + key dispatch + return shape (lines 244–301), and `BacklogEntry` (line 21) with `splitFrom?: string` and `recovered?: string`. Both parsers inherit it — `parseRoadmap` and `parseBacklog` share `parseBlockBody`.

Two effects. The bullets stop landing in `description`, so E1's word count and E2's `- ` line count no longer charge an entry for its own provenance. And `- split-from: Q-0108` becomes readable structured data rather than prose an agent has to notice.

Blast radius in this repo is nil: `grep -c '^- recovered:'` returns 0 for both `docs/roadmap.md` and `docs/backlog.md`. The change is forward-looking; consumer repos carrying the bullet gain the corrected counts on upgrade.

### U3 — Split recording via `remove-block --split-into` ([`src/triage/remove-block-cli.ts`](../../../src/triage/remove-block-cli.ts), [`src/triage/retired-ids.ts`](../../../src/triage/retired-ids.ts))

`RetiredIdRecord` gains `splitInto?: string[]`, the sibling of the existing `retiredInto`. `roadmap remove-block <slug> --split-into <slug>,<slug>` removes the source block — which is what replacing it with siblings does anyway — and records `{ slug, splitInto, retiredAt }` through the existing `recordRetiredId`, whose first-write-wins idempotence makes re-runs safe.

Reusing this CLI rather than adding one is the whole point: `remove-block` already parses a comma list (`parseRefList`), already writes the map, and [`allowlist.ts:66`](../../../src/core/allowlist.ts#L66) `RETIREMENT_GLOBS` already covers `docs/roadmap.md` plus the map file, so a split commits under the existing retirement scope.

`--split-into` and `--retired-into` are mutually exclusive: an entry is either absorbed into a parent FD or divided into siblings. Supplying both is a usage error.

No change is needed in `validate-triage` or `score.ts`. [`retiredRefs()`](../../../src/triage/retired-ids.ts#L62) already unions the map's `Q-NNNN` keys with each record's slug and is the single source of truth for both the known-ref set (`validate-triage.ts:400`) and the shipped oracle (`score.ts:96`). Recording the ID *at all* is what restores `blocked-by:` resolution; `splitInto` is provenance — it answers *where the work went*, exactly as `retiredInto` does.

### U4 — Triage measurement (`.claude/skills/noldor-triage/SKILL.md`)

Step 8 already runs a fixed command chain after inserting blocks. It gains `pnpm noldor noldor split-check --entry <slug>` per newly-inserted roadmap block, using the existing `--entry` mode. Exit 2 reports the signals and the operator may split the row before it travels further; exit 1 and 2 both leave the triage run successful — this is a pre-warning, not a gate, and triage must never fail on checker infra.

No new `--text` / `--bullet` CLI mode. Measuring after the block is written is still two phases earlier than today's earliest catch, which is the whole gap being closed; a pre-write mode is a separable follow-up.

### U5 — Promote, as the named owner (`.claude/skills/noldor-promote/SKILL.md`)

Step 1.7's option (b) and step 6.5's option (b) share one write-back recipe. Both gain `- split-from: <source-id>` on each emitted sibling alongside the existing carried bullets, and step 1.7(b) gains the `remove-block --split-into` call that records the source ID before the siblings are written. Prose states that promote is the owner, so an operator reading option (b) knows it is the canonical remedy rather than one of several.

### U6 — Gate Step 2.5 `split-back` (`.claude/skills/noldor-gate/SKILL.md`)

The continue-dialog gains a fourth option at both `--kind spec` and `--kind plan`: `split-back`, alongside `proceed` / `address-blockers` / `abort`. It is non-destructive — the FD, the session marker and the worktree all survive:

1. Operator names the scope that leaves.
2. Sibling roadmap blocks are written per U5's recipe, stamped `- split-from: <entry-id>` (read from the FD's `entry-id:` frontmatter).
3. The artifact is narrowed to slice 1 on disk.
4. A **follow-up commit** lands the narrowed artifact plus the roadmap blocks — never an amend. At Step 2.5 the artifact commit carries no review receipt, but an amend would still move the tree under any artifact-stage lane sink already written; a follow-up keeps those sinks' base valid and lets a re-round use `--base-sha`.
5. `split-check` re-runs on the narrowed artifact and must exit 0 before the session proceeds.

`split-back` counts as an operator re-round against the gate's existing hard cap of 2 re-rounds per artifact kind per session. It is not exempt: an unbounded carve loop is the same self-feeding failure the cap exists to stop.

### U7 — Plan-stage diagnosis (`.claude/skills/noldor-plan/SKILL.md`)

Step 6's P1 handling currently restructures into `-part<N>` immediately. It gains the diagnosis first: is the **scope** oversized (→ `split-back` per U6), or is the scope right and the plan merely long (→ `-part<N>`)? Ask scope first — a 1000-row plan is more often too much work than too many words. The `-part<N>` mechanics are unchanged when the operator picks the document split.

### Template twins

Every edited file under `.claude/skills/` and `docs/noldor/` has a twin under `templates/`. `pnpm noldor checks template-sync` enforces byte-identity and is part of the pre-push chain, so the twins are updated in the same commit as their sources.

## Acceptance criteria

1. `parseRoadmap` / `parseBacklog` on a block carrying `- split-from: Q-0108` return `splitFrom: 'Q-0108'`, and that line is absent from the entry's `description`.
2. The same holds for `- recovered: 2026-08-16` → `recovered: '2026-08-16'`.
3. `assessEntrySplit` on a block whose body is otherwise clean does not count `- split-from:` or `- recovered:` toward the E2 scope-bullet total.
4. `roadmap remove-block <slug> --split-into a,b` removes the block and records `{ slug, splitInto: ['a','b'], retiredAt }` under the entry's ID; a second identical invocation exits 0 and leaves the map unchanged.
5. `remove-block --split-into` on a block with no `- id:` removes the block, exits 0, and writes no map record.
6. Passing both `--split-into` and `--retired-into` exits non-zero without modifying the roadmap or the map.
7. With a split recorded, `pnpm noldor validate triage` reports no `unknown-blocked-by-ref` for a `blocked-by:` naming either the source entry ID or the source slug.
8. `pnpm noldor checks template-sync` exits 0 — every edited `.claude/skills/**` and `docs/noldor/**` file matches its `templates/` twin.
9. `docs/noldor/complexity-gating.md` carries a phase-ownership statement naming promote as the owner, sibling roadmap entries as the single scope-split product, and defining scope-split vs document-split.
10. `.claude/skills/noldor-triage/SKILL.md` step 8 invokes `split-check --entry` per newly-inserted roadmap block, and states that a non-zero exit does not fail the triage run.
11. `.claude/skills/noldor-gate/SKILL.md` Step 2.5 offers `split-back` at both artifact kinds, specifies a follow-up commit rather than an amend, requires a clean `split-check` re-run before proceeding, and counts the round against the existing re-round cap.
12. `.claude/skills/noldor-plan/SKILL.md` step 6 asks the scope-vs-document diagnosis before any `-part<N>` restructure.

## Risks / trade-offs

**The write-back recipe stays duplicated.** Three skills plus three template twins will describe the same sibling-block emission. This is the clone shape the repo otherwise gates on, accepted here because sibling bodies are authored rather than derived, so a CLI cannot own the interesting half. Follow-up in Open questions (5).

**Widening `FIELD_KEYS` changes existing descriptions.** Any consumer entry already carrying `- recovered:` will see that line leave its rendered `description` and its E1/E2 counts drop. This is the intended correction, and the blast radius here is zero blocks, but it is a behaviour change on upgrade rather than a pure addition.

**Ownership is prose, not code.** Nothing prevents an operator from splitting at plan stage instead of promote. That is deliberate — the framework's posture is that operator judgment is the ceiling — but it means the policy's effect is measured in habit, not in exit codes.

**`split-back` competes with the re-round cap.** Folding carve rounds into the same budget as blocker rounds means a session that legitimately needs both may hit the cap. The alternative — an exempt carve budget — reintroduces the unbounded loop the cap was written to stop, so the shared budget is the safer default.

## User Story

As an operator or agent moving work through the queue, I want one stated owner for oversize splits and a real remedy at every later phase, so that scope gets divided while it is still a roadmap edit instead of after an FD, a spec and a plan have been built around it.

## Usage

**Triage — pre-warning (automatic).** `/noldor-triage` step 8 reports split signals per newly-inserted roadmap block. Nothing fails; the operator may split the row on the spot.

**Promote — the owner (automatic).** `/noldor-promote <slug>` step 1.7 offers proceed / split-first / abort-and-re-size as today. Picking split-first now records the source ID and stamps provenance:

```
pnpm noldor roadmap remove-block <slug> --split-into <slice-a>,<slice-b>
```

Each sibling block carries `- split-from: Q-0108` beside its `- area:` / `- size:` / `- impact:` bullets.

**Gate Step 2.5 — split-back.** When S1/S2 or P1 trips, the continue-dialog offers `split-back` alongside `proceed` / `address-blockers` / `abort`. It carves siblings to the roadmap, narrows the artifact, commits the pair as a follow-up, and re-runs the check — the same session continues.

**Plan — diagnosis.** On P1 the plan skill asks whether the scope or the document is oversized before restructuring into `-part<N>`.

**Ad-hoc.** All existing modes are unchanged:

```
pnpm noldor noldor split-check --entry <slug>
pnpm noldor noldor split-check --fd <slug> --add <path>...
pnpm noldor noldor split-check --plan <path>
pnpm noldor noldor split-check --spec <path>
```

**Keyboard shortcut** — none (CLI + skill flow).

## Open questions (resolved)

1. *What does a spec/plan-stage bounce concretely do — abort the session, park the FD, or something lighter?*
   -> Carve-and-narrow, non-destructive (U6). Unwinding a promote would force the FD scaffold, category pick, packages and phase-revert to be redone per slice, which costs more than the split saves (D2).

2. *Does the plan skill's `-part<N>` restructure survive?*
   -> Yes, reclassified as a document split. It moves no scope out of the FD, so the single-product rule does not reach it; a correctly-sized L feature can have a legitimately long plan (D3).

3. *How do siblings stay traceable — a bullet field, a map record, or both?*
   -> Both. The bullet is what a reader of the queue sees; the map record is what keeps `blocked-by:` resolving after the source block is gone (D4).

4. *Does triage need a new pre-write `split-check` mode?*
   -> No. Reusing `--entry` after the block is written is two phases earlier than today's earliest catch and costs no new CLI surface; a pre-write mode is separable (D6).

5. *Should a shared `roadmap carve` CLI own the write-back so three skills stop restating it?*
   -> Not in this slice. A CLI cannot author slice bodies, so it would own only the mechanical half while the prose stayed. Worth a follow-up entry once the policy has been exercised and the recipe has stopped moving (D5).

6. *Does `- recovered:` join `FIELD_KEYS` too, or only `- split-from:`?*
   -> Both, in the same edit. Identical wart, one-line marginal cost, and leaving two adjacent provenance bullets with different parse behaviour is a drift generator (D8).

7. *Does `split-back` amend the artifact commit?*
   -> No — a follow-up commit. An amend moves the tree under any artifact-stage lane sink already written, and the follow-up keeps `--base-sha` usable for a re-round (D7).
