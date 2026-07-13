---
name: noldor-absorb
description: Classify and file unfiled lessons from ideas.md's ## Lessons section into framework docs. Proposes a drop | gotcha | actionable | feedback disposition per bullet; user batch-confirms; writes docs/noldor/ pages (both template twins), appends actionable items to the triage queue, and stamps [absorbed YYYY-MM-DD → dest] markers. Use when ## Lessons accumulates unfiled bullets — keeps operational knowledge in-repo instead of any assistant's private memory.
user_invocable: true
---

# Absorb lessons → framework docs

Files hard-won operational knowledge into the repo so the framework stays
self-owned (see `docs/vision.md` "self-owned" invariant). Capture is a plain
edit — anyone drops a bullet under `## Lessons` in `ideas.md`; this skill is
the classifier that empties the section.

## Inputs

- `ideas.md` `## Lessons` section — top-level `-` bullets. **Unfiled** = no `[absorbed YYYY-MM-DD → <dest>]` marker.
- `docs/noldor/*.md` — destination runbooks (each has a `templates/docs/noldor/` twin).
- `docs/release-notes.md` + git history — evidence for the `drop` class.

## Classes

Classify each unfiled bullet into exactly one:

1. **`drop`** — shipped-historical: records a completed change already captured by git history, a merged PR, or `docs/release-notes.md`. No doc write; stamp only.
2. **`gotcha`** — operational trap that costs a debugging cycle and isn't obvious from code. Destination: `docs/noldor/gotchas.md` by default, or a more specific runbook on a strong area match (`cr-pipeline.md`, `autonomy.md`, `drain-mode.md`, `worktree-discipline.md`).
3. **`actionable`** — reveals unfinished work (a bug, a missing feature, a follow-up). Destination: append the lesson as a raw bullet under `## Verticals → <vertical> → #### Later` in `ideas.md`, so it flows through the existing `/noldor-triage` seam. Never write roadmap/backlog blocks directly — one triage path, one scoring rubric.
4. **`feedback`** — guidance on how agents/operators should work (a confirmed approach, a correction). Destination: the most-specific runbook (`workflow.md`, `doc-conventions.md`, …), else `gotchas.md`.

## `<dest>` marker vocabulary (pinned)

Exactly one of:

- `drop` — no doc write
- `ideas` — actionable, appended to the triage queue
- the `noldor-page` frontmatter slug of the page written (e.g. `gotchas`, `cr-pipeline`, `workflow`, `doc-conventions`)

Not freeform — this keeps the stamps greppable and the idempotency check
unambiguous.

## Steps

1. Read `ideas.md`; collect top-level `-` bullets under `## Lessons` without an `[absorbed …]` marker. Zero unfiled → report "nothing to absorb" and stop.
2. For each bullet, propose class + destination + a one-line rationale. For `gotcha`/`feedback`, draft the destination text (match the target page's entry style — e.g. `gotchas.md` entries are bold-headline bullets naming the concrete file/command/condition).
3. **Batch-confirm** the full disposition table via AskUserQuestion before ANY write. Operator overrides per row. Nothing is written for rows the operator rejects.
4. On confirm, per bullet:
   - `drop` → no write.
   - `gotcha` / `feedback` → append the drafted entry to the destination page **AND its byte-identical `templates/docs/noldor/` twin** (see Twin discipline below).
   - `actionable` → append the bullet under `## Verticals → <best-fit vertical> → #### Later` in `ideas.md`.
   - Then stamp ` [absorbed YYYY-MM-DD → <dest>]` at the end of the source bullet in `## Lessons`.
5. Report: table of filed lessons with clickable destination links. Do not commit — staging/commit is the operator's (or the gate's).

## Idempotency

A stamped bullet is skipped on re-run (step 1 filters it). Re-invoking after a
partial confirm round only surfaces the still-unfiled tail.

## Twin discipline (critical)

Every `docs/noldor/*.md` page is a generated twin of
`templates/docs/noldor/*.md` — `check-template-sync` enforces byte-identity,
and a consumer-side-only edit **silently vanishes** when `pnpm test`
regenerates the page from its template. Always write BOTH copies for
`gotcha`/`feedback` destinations.

## Pruning

Stamped bullets may be pruned from `## Lessons` by hand — git history of
`ideas.md` is the durable audit trail (where `ideas.md` is tracked; consumers
that gitignore theirs keep the durable record in the tracked `docs/noldor/`
writes). `## Lessons` only needs to hold the unfiled tail.

## Rules

- Never write a doc without the batch-confirm (step 3) — same safety rail as `/noldor-triage`.
- Never write roadmap/backlog blocks directly; `actionable` goes through `ideas.md`.
- Never edit a `docs/noldor/` page without its template twin.
- The operator's explicit instructions always override this skill.
