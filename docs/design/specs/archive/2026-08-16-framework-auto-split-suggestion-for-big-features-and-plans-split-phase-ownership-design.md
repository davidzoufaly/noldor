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
- **No new hard blocks.** The headless drain remains the only place a signal stops work; every operator-present surface stays advisory, including the post-carve re-check in U6.
- **No shared `roadmap carve` CLI.** Sibling bodies are authored, not derived, so the write-back stays skill prose in this slice — recorded as a follow-up in Open questions (5).

## Design

### U1 — The phase-ownership policy (`docs/noldor/complexity-gating.md`)

The "Split suggestion" subsection gains the policy the rules table implies but never states. Three claims:

**Owner: `/noldor-promote` step 1.7.** Promote is the queue→FD boundary. Before it, a split is a roadmap edit and costs nothing; after it, a split means unwinding an FD scaffold, a category pick, a phase-revert and a retired-ID record. Promote is therefore the last point where splitting is free, and it already carries the remedy.

**Product: sibling roadmap entries, always.** Every scope split — whoever notices it — produces `### ` blocks in `docs/roadmap.md`. There is one shape to learn and one to document.

**Scope-split vs document-split.** A *scope split* moves scope out of the FD and produces queue siblings. A *document split* moves no scope: `-part<N>` plan files reorganize one FD's plan and stay local. `-part<N>` therefore does not violate the single-product rule — it is not a scope split.

The resulting phase table replaces the "Informational vs drain" paragraph's implicit ordering. It is deliberately **role-only** — which rules fire where already lives in the rules table's "Surfaces at" column directly above it, and restating that mapping in the same section would make the authoritative doc its own drift source:

| Phase | Role | On trip |
| --- | --- | --- |
| triage | pre-warn | report signals; operator may split rows before writing blocks |
| promote 1.7 | **owner** | split-first → sibling roadmap entries |
| drain Step 0 | hard stop | exit unscaffolded → escalation (unchanged) |
| gate 2.5 spec | bounce | `split-back` → carve siblings, narrow the spec |
| `noldor-plan` post-save | bounce or document-split | diagnose scope vs verbosity |
| gate 2.5 plan | bounce or document-split | same diagnosis, at the review pause |

The rules table gains `triage` to its E1/E2/E3 "Surfaces at" cells; no other cell changes.

### U2 — `split-from` and `recovered` become parsed fields ([`src/utils/parse-blocks.ts`](../../../src/utils/parse-blocks.ts))

`FIELD_KEYS` gains `split-from` and `recovered`. The file's header note says a new field key is *"added here once"*, but that holds only for the stripping half: there are **two** independent field-harvest sites, so the change is four coordinated edits.

| # | Site | Edit |
| --- | --- | --- |
| 1 | `FIELD_KEYS` (line 216) | add `split-from` and `recovered` to the alternation |
| 2 | `BacklogEntry` (line 21) | add `splitFrom?: string`, `recovered?: string` |
| 3 | `parseBlockBody` (lines 244–301) | local + key dispatch + return shape — feeds `parseRoadmap` |
| 4 | `parseEntries` (lines 303–357) | `splitFrom: fields['split-from']`, `recovered: fields.recovered` in the entry literal — feeds `parseBacklog` |

Edit 4 is the one that is easy to miss. `parseBacklog` ([`:103`](../../../src/utils/parse-blocks.ts#L103)) does **not** call `parseBlockBody`; it delegates to `parseEntries`, which harvests into its own `fields` record and builds the entry object explicitly. The two sites share only the `FIELD_KEYS` regex, so widening it strips the bullets from `description` on both paths for free — but a field left out of the `parseEntries` literal silently stays `undefined` on every backlog block.

That duplication is pre-existing and out of scope here; unifying the two harvest sites is noted as a follow-up in Open questions (10).

Two effects. The bullets stop landing in `description`, so E1's word count and E2's `- ` line count no longer charge an entry for its own provenance. And `- split-from: Q-0108` becomes readable structured data rather than prose an agent has to notice.

Blast radius in this repo is nil: `grep -c '^- recovered:'` returns 0 for both `docs/roadmap.md` and `docs/backlog.md`. The change is forward-looking; consumer repos carrying the bullet gain the corrected counts on upgrade.

### U3 — Split recording via `remove-block --split-into` ([`src/triage/remove-block-cli.ts`](../../../src/triage/remove-block-cli.ts), [`src/triage/retired-ids.ts`](../../../src/triage/retired-ids.ts))

`RetiredIdRecord` gains `splitInto?: string[]`, the sibling of the existing `retiredInto`. `roadmap remove-block <slug> --split-into <slug>,<slug>` removes the source block — which is what replacing it with siblings does anyway — and records `{ slug, splitInto, retiredAt }` through the existing `recordRetiredId`, whose first-write-wins idempotence makes re-runs safe.

Reusing this CLI rather than adding one is the whole point: it already removes blocks, already writes the map through `recordRetiredId`, and [`allowlist.ts:66`](../../../src/core/allowlist.ts#L66) `RETIREMENT_GLOBS` already covers `docs/roadmap.md` plus the map file, so a split commits under the existing retirement scope.

**Comma-list parsing is new work.** `remove-block` today parses `--retired-into` as a scalar and has no list handling; [`parseRefList`](../../../src/utils/parse-blocks.ts#L222) is a non-exported local of `parse-blocks.ts` serving field bullets. Export it and call it from `remove-block-cli.ts` — `--split-into a,b` and `- blocked-by: a, b` should agree on what a comma list means, and one exported splitter is cheaper than a second convention.

**Argument parsing needs two fixes, not one flag.** `parseRemoveBlockArgs` ([`remove-block-cli.ts:37`](../../../src/triage/remove-block-cli.ts#L37)) finds the positional slug with `argv.find((a, i) => !a.startsWith('--') && !(flagIndex >= 0 && i === flagIndex + 1))` — an exclusion hard-coded to the single token after `--retired-into`:

- **Flag-before-slug ordering.** `remove-block --split-into a,b my-slug` would bind `slug = 'a,b'`, which resolves to no block and exits 0 with "nothing to do" — a silent no-op that gate and drain flows read as success. The exclusion must cover the token after either flag.
- **Presence vs value.** The existing drop-empty / drop-flag-following logic collapses a valueless flag to `undefined`, so `--split-into --backlog --retired-into x` would slip past a mutual-exclusion check written against the parsed values. Exclusivity is decided on flag *presence* in `argv`, before value extraction. "Present" means a token that **equals `--flag` or starts with `--flag=`** — `parseRemoveBlockArgs` already accepts the inline form for `--retired-into` ([`:30`](../../../src/triage/remove-block-cli.ts#L30)), so a bare `argv.includes('--retired-into')` test would let `--split-into a,b --retired-into=x` through, which is the exact bypass this fix exists to close. `--split-into=a,b` is supported for parity.

`--split-into` and `--retired-into` are mutually exclusive: an entry is either absorbed into a parent FD or divided into siblings. Supplying both is a usage error.

No change is needed in `validate-triage` or `score.ts`. [`retiredRefs()`](../../../src/triage/retired-ids.ts#L62) already unions the map's `Q-NNNN` keys with each record's slug and is the single source of truth for both the known-ref set (`validate-triage.ts:400`) and the shipped oracle (`score.ts:96`). Recording the ID *at all* is what restores `blocked-by:` resolution; `splitInto` is provenance — it answers *where the work went*, exactly as `retiredInto` does.

### U4 — Triage measurement (`.claude/skills/noldor-triage/SKILL.md`)

Step 8 already runs a fixed command chain after inserting blocks. It gains `pnpm noldor noldor split-check --entry <slug>` per newly-inserted roadmap block, using the existing `--entry` mode. Exit 2 reports the signals and the operator may split the row before it travels further; exit 1 and 2 both leave the triage run successful — this is a pre-warning, not a gate, and triage must never fail on checker infra.

No new `--text` / `--bullet` CLI mode. Measuring after the block is written is still two phases earlier than today's earliest catch, which is the whole gap being closed; a pre-write mode is a separable follow-up.

### U5 — Promote, as the named owner (`.claude/skills/noldor-promote/SKILL.md`)

Step 1.7's option (b) and step 6.5's option (b) share one write-back recipe. Both gain `- split-from: <source-id>` on each emitted sibling alongside the existing carried bullets. Prose states that promote is the owner, so an operator reading option (b) knows it is the canonical remedy rather than one of several.

**The emitted block must satisfy `validate triage` outright.** Step 6.5(b) today carries `- area:` / `- type:` / `- size:` / `- impact:` / `- recovered:`, which is short of what the validator requires at **error** level on two counts:

- `REQUIRED_FIELDS_ROADMAP = ['area', 'type', 'since', 'size', 'impact']` ([`validate-triage.ts:77`](../../../src/triage/validate-triage.ts#L77)) — `since` is missing from the recipe, and it is required on backlog too.
- `missing-entry-id` fires for any entry whose `id` is undefined once `.noldor/id-counter.json` exists ([`:259`](../../../src/triage/validate-triage.ts#L259)) — it does in this repo — and the recipe mints no `- id:`.

Both gaps are pre-existing in the shipped skill rather than introduced here, and both become load-bearing the moment splitting is the named remedy, so both write-back sites are fixed. IDs are minted, never hand-written — one call, exactly as `/noldor-triage` step 6 does:

```
pnpm noldor triage mint-id --count <n>
```

Each sibling carries, in order: `- id:` (minted) first, then `- area:`, `- type:`, `- since:` (the split date), `- size:`, `- impact:`, `- split-from: <source-id>`, `- recovered:`. The minted ID is what makes a sibling addressable by `blocked-by:` in its own right; `- split-from:` records where it came from.

**Siblings are written before the source block is removed.** The inherited mechanics place each sibling "immediately after the original block's position" ([`noldor-promote/SKILL.md:139`](../../../.claude/skills/noldor-promote/SKILL.md#L139)), and `docs/roadmap.md` is priority-ordered by file position — removing the source first destroys the anchor and the slices land wherever the writer guesses rather than at the queue position the work already earned. So step 1.7(b) writes the siblings first, then calls `remove-block --split-into` to drop the source and record the ID. Removal is safe at that point: `remove-block` takes the block up to the next `### ` heading, and the first sibling is exactly that boundary.

### U6 — Gate Step 2.5 `split-back` (`.claude/skills/noldor-gate/SKILL.md`)

**`split-back` is not a new top-level option.** The continue-dialog is already at the four-option ceiling `AskUserQuestion` enforces — at `--kind plan` it carries `proceed-autonomous / proceed / address-blockers / abort` — so a fifth cannot be built. `split-back` is reached as a **second question under `address-blockers`**, which is also where it belongs: an S1/P1 signal is a blocker, and carving is one way to address it. When the round's findings include a live split signal, picking `address-blockers` asks a follow-up:

```
fix-in-place / split-back / back
```

`fix-in-place` is the existing autofix-then-operator path, unchanged. Neither kind exceeds four top-level options — `plan` stays at its existing four, `spec` at its existing three — and no existing option is dropped on a heuristic trip.

`split-back` is non-destructive — the FD, the session marker and the worktree all survive:

1. Operator names the scope that leaves.
2. Sibling roadmap blocks are written per U5's recipe — minted `- id:` first, then `- area:` / `- type:` / `- since:` / `- size:` / `- impact:`, with `- split-from: <entry-id>` read from the FD's `entry-id:` frontmatter.
3. The artifact is narrowed to slice 1 on disk.
4. A **follow-up commit** lands the narrowed artifact plus the roadmap blocks — never an amend. At Step 2.5 the artifact commit carries no review receipt, but an amend would still move the tree under any artifact-stage lane sink already written; a follow-up keeps those sinks' base valid and lets a re-round use `--base-sha`.
5. `split-check` re-runs on the narrowed artifact and its result is **reported, not enforced**. The operator may proceed whether or not the signal cleared.

Step 5 is advisory on purpose. Requiring a clean re-run would make this the framework's second hard stop, contradicting the standing rule that every operator-present surface stays advisory and only the headless drain blocks. It would also wedge the session: `split-back` counts as an operator re-round against the existing cap of 2 per artifact kind per session — not exempt, since an unbounded carve loop is the self-feeding failure the cap exists to stop — so at the cap, with the signal still tripping, a required-clean re-run would leave neither `proceed` nor another carve legal. **`proceed` is always available**, at the cap and below it. An operator who carves twice and still trips a threshold has a judgment call to make, not a locked door.

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
6. `remove-block --split-into a,b my-slug` (flag before the positional) removes the block for `my-slug` — the slug does not bind to `a,b`.
7. Passing both `--split-into` and `--retired-into` exits non-zero without modifying the roadmap or the map — in every combination of the spaced, inline-`=`, and valueless forms (exclusivity is decided on flag presence, not on parsed values). `--split-into=a,b` behaves identically to `--split-into a,b`.
8. With a split recorded, `pnpm noldor validate triage` reports no `unknown-blocked-by-ref` for a `blocked-by:` naming either the source entry ID or the source slug.
9. `pnpm noldor checks template-sync` exits 0 — every edited `.claude/skills/**` and `docs/noldor/**` file matches its `templates/` twin.
10. `docs/noldor/complexity-gating.md` carries a phase-ownership statement naming promote as the owner, sibling roadmap entries as the single scope-split product, and defining scope-split vs document-split.
11. `.claude/skills/noldor-promote/SKILL.md` steps 1.7(b) and 6.5(b) mint entry IDs via `triage mint-id --count <n>` and stamp `- id:` first plus `- split-from: <source-id>` on each emitted sibling; 1.7(b) writes the siblings before calling `remove-block --split-into`, so the source block's queue position anchors them.
12. A roadmap block emitted by that recipe passes `pnpm noldor validate triage` with `.noldor/id-counter.json` present — **zero errors**, not merely no `missing-entry-id`.
13. `.claude/skills/noldor-triage/SKILL.md` step 8 invokes `split-check --entry` per newly-inserted roadmap block, and states that a non-zero exit does not fail the triage run.
14. `.claude/skills/noldor-gate/SKILL.md` Step 2.5 reaches `split-back` at both artifact kinds via a second question under `address-blockers`, with no single `AskUserQuestion` exceeding four options; specifies a follow-up commit rather than an amend; counts the round against the existing re-round cap; and leaves `proceed` available regardless of whether the post-carve `split-check` cleared.
15. `.claude/skills/noldor-plan/SKILL.md` step 6 asks the scope-vs-document diagnosis before any `-part<N>` restructure.

## Risks / trade-offs

**The write-back recipe stays duplicated.** Three skills plus three template twins will describe the same sibling-block emission. This is the clone shape the repo otherwise gates on, accepted here because sibling bodies are authored rather than derived, so a CLI cannot own the interesting half. Follow-up in Open questions (5).

**Widening `FIELD_KEYS` changes existing descriptions.** Any consumer entry already carrying `- recovered:` will see that line leave its rendered `description` and its E1/E2 counts drop. This is the intended correction, and the blast radius here is zero blocks, but it is a behaviour change on upgrade rather than a pure addition.

**Ownership is prose, not code.** Nothing prevents an operator from splitting at plan stage instead of promote. That is deliberate — the framework's posture is that operator judgment is the ceiling — but it means the policy's effect is measured in habit, not in exit codes.

**`split-back` competes with the re-round cap.** Folding carve rounds into the same budget as blocker rounds means a session that legitimately needs both may hit the cap. The alternative — an exempt carve budget — reintroduces the unbounded loop the cap was written to stop, so the shared budget is the safer default. Because the post-carve re-check is advisory, hitting the cap costs momentum, not a wedged session.

**`split-back` is one level deeper than the signal that triggers it.** Nesting under `address-blockers` is what keeps the dialog inside the four-option ceiling, but it also means an operator who reads a split signal and wants to carve must first pick an option that does not name carving. The alternative was dropping `proceed-autonomous` from the plan-kind dialog whenever a split signal fires, which removes an unrelated capability on a heuristic trip.

## User Story

As an operator or agent moving work through the queue, I want one stated owner for oversize splits and a real remedy at every later phase, so that scope gets divided while it is still a roadmap edit instead of after an FD, a spec and a plan have been built around it.

## Usage

**Triage — pre-warning (automatic).** `/noldor-triage` step 8 reports split signals per newly-inserted roadmap block. Nothing fails; the operator may split the row on the spot.

**Promote — the owner (automatic).** `/noldor-promote <slug>` step 1.7 offers proceed / split-first / abort-and-re-size as today. Picking split-first now records the source ID and stamps provenance:

```
pnpm noldor roadmap remove-block <slug> --split-into <slice-a>,<slice-b>
```

Each sibling block carries `- split-from: Q-0108` beside its `- area:` / `- size:` / `- impact:` bullets.

**Gate Step 2.5 — split-back.** When S1/S2 or P1 trips, pick `address-blockers`; the follow-up question offers `fix-in-place / split-back / back`. `split-back` carves siblings to the roadmap, narrows the artifact, commits the pair as a follow-up, and re-runs the check for information — the same session continues either way.

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

8. *Must the post-carve `split-check` re-run come back clean before the session proceeds?*
   -> No — report it, never enforce it. Enforcing would create the framework's second hard stop on an operator-present surface, and combined with the shared re-round cap it would wedge a session that carved twice and still trips. `proceed` stays legal at every point.

9. *How does `split-back` fit a dialog already at the four-option `AskUserQuestion` ceiling?*
   -> As a second question under `address-blockers`, not as a top-level option. A split signal *is* a blocker, so the nesting is semantically right, and it avoids dropping `proceed-autonomous` from the plan-kind dialog on a heuristic trip.

10. *Should the two field-harvest sites in `parse-blocks.ts` be unified while adding fields to both?*
   -> Not here. `parseBlockBody` and `parseEntries` duplicate the harvest for pre-existing reasons (line-number tracking vs split-based parsing), and unifying them would put a parser refactor inside a policy slice. Add the fields to both, and file the unification separately — the file's "added here once" note is already inaccurate and should be corrected with the refactor, not before it.
