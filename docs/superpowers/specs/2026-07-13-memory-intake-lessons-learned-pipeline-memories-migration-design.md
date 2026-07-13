# Claude Memories One-Time Migration — Design

**Slug:** memory-intake-lessons-learned-pipeline (enhancement: memories-migration)
**FD:** docs/features/memory-intake-lessons-learned-pipeline.md
**Date:** 2026-07-13
**Tier:** specs-only (attach)

## Problem

The parent FD shipped the intake mechanism (`## Lessons` in `ideas.md` + `/noldor-absorb`) but explicitly split out the one-time migration of the existing Claude assistant memories: every memory file under the per-project memory dir (~95 at spec time, growing per session) (`~/.claude/projects/-Users-davidzoufaly-code-noldor/memory/`). Their live-value operational knowledge (worktree traps, commit-hook gotchas, drain recipes) exists ONLY in one assistant's private memory — the exact dependency the parent FD's vision invariant ("self-owned") closes. Until migrated, a fresh agent or non-Claude runner starts blind to ~2 months of hard-won operational lessons.

## Goals

- Every live-value gotcha/feedback item in the memory corpus lands in the appropriate `docs/noldor/` runbook (+ byte-identical `templates/docs/noldor/` twin), following `/noldor-absorb`'s class rubric and entry style.
- Shipped-historical markers ("SHIPPED PR #N; do not re-triage") classified `drop` — their anti-re-triage guard function stays in the memory system itself; git history + release notes already record the shipping facts.
- A migration report (memory file → disposition → destination) delivered in the PR body — auditable, but not a tracked repo file (one-time artifact).
- No source deletion, no memory-file edits — the memory dir is the assistant's; the entry mandates report-only redundancy.

## Non-goals

- No automation/CLI — this is a one-time editorial pass using the shipped `/noldor-absorb` rubric by hand; the parent FD deliberately keeps the loop manual until it proves out.
- No `ideas.md` `## Lessons` round-trip for the bulk — the absorb skill's source seam is for NEW lessons; migrating 96 files through it would just duplicate the corpus into a second inbox. The rubric is reused; the inbox is bypassed.
- No memory-system changes (MEMORY.md stays; stamps/markers are not written into memory files).

## Design

### Unit 1 — classification pass (rubric = `/noldor-absorb` classes, adapted to memory files)

Read every `*.md` memory file present at migration time (the `MEMORY.md` index is the map, not itself a migration subject). Classify each file:

1. **`drop` (expected majority)** — shipped-FD markers whose body is: what shipped, PR number, "do not re-triage". Redundant with git history/release notes; their residual value (re-triage guard) lives where it's consumed — the assistant's recall. Listed in the report only.
2. **`gotcha-extract`** — the file is a shipped-marker BUT carries embedded operational traps with ongoing value (e.g. `git commit | tail` masking fmt-hook red; bg-Bash cwd drift in worktree sessions; stash-pop conflict recipes). The gotcha (not the shipping fact) is extracted into a runbook.
3. **`gotcha` / `feedback` (whole-file)** — files that are purely operational (e.g. worktree edit-path trap, drain operational gotchas, CR artifact pathspec trap, always-link-artifacts feedback). Folded into the best-match runbook.
4. **`actionable`** — reveals unfinished work not already on the queue. Destination: `ideas.md` `## Verticals → … → #### Later` (the absorb seam for actionables). Expected rare — most follow-ups were already triaged into Q-ids.

### Unit 2 — destination runbooks

Per `/noldor-absorb` destination rules, most-specific page wins; candidates by corpus theme:

- `docs/noldor/worktree-discipline.md` — worktree-absolute edit paths, `git worktree list` at resume, stale `fast/<slug>` salvage.
- `docs/noldor/git-and-commits.md` — `| tail` masking hook failures, foreground-commit hangs → `run_in_background`, porcelain `??` counting, amend-invalidates-receipt.
- `docs/noldor/drain-mode.md` / `autonomy.md` — K=1 concurrency, liveness via `ps` not lock, idempotent relaunch, directive-rides-the-prompt, watch-from-main-workspace.
- `docs/noldor/cr-pipeline.md` — one-pathspec `--artifact`, stale-sink after amend, receipt-loss after post-CR commits.
- `docs/noldor/gotchas.md` — cross-cutting traps with no specific page (e.g. `**/` in JSDoc closing block comments, `??` vs `?.length` on empty arrays, release-marker-must-clear-before-release).
- Every write goes to BOTH the page and its `templates/docs/noldor/` twin (byte-identity enforced by `check-template-sync`).

Entries match each page's existing style (gotchas.md: bold-headline bullet naming concrete file/command/condition). Dedup rule: if the runbook already documents the trap (several were absorbed via PR #198's pipeline or earlier), classify the memory `drop` (redundant) and note "already in <page>" in the report.

### Unit 3 — batch-confirm + report

Following the absorb skill's safety rail, present ONE disposition table (one row per memory file: file → class → destination) in chat with a single batch-confirm before any write. After writes, the same table (plus per-row "already in <page>" notes) becomes the PR body's migration report.

### Data flow

Memory dir (read-only) → classification table → operator batch-confirm → runbook + twin appends (one commit) → PR body report.

### Error handling

- Unreadable/empty memory file → row classified `drop` with note `unreadable`; never blocks the pass.
- `check-template-sync` failure at commit = twin drift → fix before ship (hook enforces).

### Testing

No new code → no new tests. Existing `check-template-sync` + doc-links hooks validate the writes; `pnpm vitest run` must stay green (docs-only diff).

## Acceptance criteria

- Disposition table covers every `*.md` file present in the memory dir at migration time, excluding the `MEMORY.md` index (it is a generated map, not a memory), each with class + destination (or `drop` + reason).
- All `gotcha`/`feedback`/`gotcha-extract` rows produce runbook entries in both twins; template-sync green.
- Zero writes to the memory dir.
- `actionable` rows (if any) appended to `ideas.md` Verticals `#### Later`.
- Suite + typecheck green; PR body carries the full report.

## Risks / trade-offs

- **Volume vs signal** — bulk-dropping shipped markers risks losing an embedded gotcha. Mitigated by class 2 (`gotcha-extract`): every marker file is skimmed for operational content before dropping, and the batch-confirm table exposes each call for operator override.
- **Runbook bloat** — appending ~20-30 gotchas could bloat pages. Mitigated by dedup rule + folding same-theme traps into one entry where they share a root cause.
- **Report not tracked in-repo** — PR body is the audit trail; accepted for a one-time artifact (the durable outcome is the runbook content itself).

## User Story

As an agent (or new operator) working this repo without access to the original assistant's private memory, I want the accumulated operational gotchas and workflow feedback folded into the `docs/noldor/` runbooks, so that hard-won lessons are self-owned by the framework and available to every runner from the first session.

## Usage

**UI**

1. One-time: review the disposition table presented in chat; confirm (or override rows).
2. After merge: read the runbooks as usual — `docs/noldor/gotchas.md`, `worktree-discipline.md`, `git-and-commits.md`, `drain-mode.md`, `autonomy.md`, `cr-pipeline.md`.

**Agent/Programmatic API**

- _none for v1_ — docs-only migration; ongoing intake stays with `/noldor-absorb` over `ideas.md` `## Lessons`.

## Open questions (resolved)

1. *Route the corpus through `ideas.md` `## Lessons` + `/noldor-absorb` literally?*
   -> No — reuse the rubric, bypass the inbox. (D1) Copying 96 files into `## Lessons` creates a second copy of the corpus and 96 stamp edits with zero added safety; the batch-confirm table preserves the skill's actual safety rail.
2. *Track the migration report as a repo file?*
   -> No — PR body only. (D2) One-time artifact; the runbook writes are the durable outcome, and a tracked report would itself become stale doc surface.
3. *Write "absorbed" stamps into memory files?*
   -> No — memory dir is out-of-repo and owned by the assistant; the entry mandates no source mutation. (D3) Idempotency is irrelevant for a one-time pass; the PR is the record.
4. *Delete or edit redundant memories?*
   -> No — report-only, per the entry. (D4) The assistant's memory hygiene is its own concern; several "do not re-triage" guards remain functionally useful there.
