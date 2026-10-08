# Session Retro Auto-Capture — Design

**Slug:** memory-intake-lessons-learned-pipeline / session-retro-auto-capture
**FD:** docs/features/memory-intake-lessons-learned-pipeline.md
**Date:** 2026-10-08
**Tier:** specs-only
**Entry:** Q-0340

## Problem

The `## Lessons` + `/noldor-absorb` loop shipped as a manual loop: someone has to remember to write the bullet. Nothing in the gate asks for it, so a session's follow-ups and traps leak into the assistant's private memory instead (charuy Q-0321, PR #346: the `Why:`-vs-`Why —` PR-summary trap went to memory; three follow-ups only reached `ideas.md` when the operator asked). In this repo the same leak is visible in `MEMORY.md`: dozens of "⚠ … NOT filed" and "N lessons uncommitted in main's ideas.md" notes.

The loop also does not work on consumers yet. charuy's `ideas.md` has no `## Lessons` section, and its `ideas.md` is gitignored. And a drain child — the session that most often learns something — runs inside `.worktrees/<slug>/`, so an `ideas.md` it edits there is deleted with the worktree.

## Goals

- After every merge, on every path, the agent writes what it learned into the repo's `ideas.md`: follow-ups as raw bullets, traps under `## Lessons`.
- It works on a consumer as installed: a missing file or missing section is created, a gitignored `ideas.md` is fine, and nothing is committed.
- It works headless, in a drain child, and the write lands in the main checkout, not the worktree.
- An empty retro is a valid outcome and says so.
- Always-clear stays intact: the retro never names the next roadmap entry.

## Non-goals

- Classifying or filing lessons. `/noldor-absorb` keeps that job; the retro only captures.
- Committing `ideas.md`. Tracked or not, the step writes the file and leaves it.
- Migrating existing private-memory notes into `ideas.md` (a separate follow-up already exists).
- A config knob to turn the retro off. Add one only if a consumer asks.

## Design

### Structural context

The capture writer lands next to `src/triage/triage-list-untriaged.ts` (community c182, interior: no god node, two-file community) and reads the file path through `loadDocRoots()` in `src/core/doc-roots.ts` — the repo's #1 god node (97 edges, community c42). The writer only *calls* `loadDocRoots()`; it does not change it, so the god node's contract is untouched. `src/cli/commands/doctor.ts` (c66) is touched only if the doctor row in **Consumer enablement** survives review. `.claude/skills/noldor-absorb/SKILL.md` and the gate skill files are prose and are not in the graph.

### Capture writer — `pnpm noldor triage retro`

A small CLI in `src/triage/retro-cli.ts`, registered under the existing `triage` group in `src/cli/manifest.ts` (no new group, no new directory). It is the one place that knows how to write the retro, so the gate prose and the drain page both call it instead of hand-editing the file.

```
pnpm noldor triage retro --slug <slug> --pr <n> \
  [--lesson "<text>"]... [--followup "<text>"]... [--none]
```

- **Target file.** Resolves the *main checkout's* `ideas.md`, not the cwd's: `git rev-parse --path-format=absolute --git-common-dir`, take its parent, then `loadDocRoots(<that root>).ideas`. Run from `.worktrees/<slug>/` it still writes `<repo>/ideas.md`.
- **Scaffold.** No file → create one with a `## Not groomed` and a `## Lessons` heading. File without the needed section → insert the heading before `## Verticals` when present, else at the end. Existing content is never reordered.
- **Bullet shape.** Each bullet is one top-level `-` line ending in `(<slug>, PR #<n>, <YYYY-MM-DD>)`. Lessons go under `## Lessons`; follow-ups go under `## Not groomed` (see open question 1).
- **Idempotent.** A bullet whose text is already present in the target section is skipped, so a re-run after a crash does not double-write.
- **Write.** Whole-file rewrite through `atomicWriteFileSync` (`src/core/atomic-write.ts`), under a short-lived lock file beside `ideas.md` so two drain children finishing together do not lose each other's bullets (reuse the `tryAcquire` shape from `src/autonomous/drain-lock.ts`).
- **Never stages, never commits.**
- **`--none`** writes nothing and prints `retro: nothing to capture`. Passing `--none` with any `--lesson`/`--followup` is a usage error.
- **Exit codes.** 0 written or nothing to write; 2 usage error; 1 I/O failure. The step is advisory: a non-zero exit is reported and the session still ends normally.

### Gate step — Step 4.12 retro

`.claude/skills/noldor-gate/SKILL.md` gains line 12 in Step 4, after cleanup (line 11) and before Step 5, on every path including micro-chore. The steps live in a new branch file `.claude/skills/noldor-gate/retro.md` (router pattern, keeps `SKILL.md` under its skill-size ratchet). The file tells the agent:

1. Collect follow-ups: verifier notes, deferred CR lows, spec drift, skipped or unpriced bits.
2. Collect lessons: a trap that cost a debugging cycle and is not obvious from code.
3. Call `pnpm noldor triage retro` once with all of them, or `--none`.
4. Never write them to private memory instead; never name the next roadmap entry.

The Step 5 report gains one line after `Shipped:` — `Retro: <n> lessons, <m> follow-ups → ideas.md` or `Retro: nothing to capture`.

### Drain child — headless retro

`docs/noldor/drain-mode.md` → `## Autonomous end-of-flow` gains the same step after `pr-flow` reports the merge (and in the Finish and Resume paths). Same CLI call; no prompt. The main-checkout resolution is what makes it survive the worktree removal.

### Consumer enablement

- The gate skill, its new `retro.md`, `drain-mode.md` and `workflow.md` all have shipped twins (`templates/.claude/skills/…`, `templates/docs/noldor/…`); every edit lands in both, so `noldor init --update` carries it to charuy.
- `docs/noldor/workflow.md` → `## Lessons belong in the framework, not private memory` points at the automatic step instead of asking for a manual bullet.
- `.claude/skills/noldor-absorb/SKILL.md` notes that bullets now arrive stamped with slug + PR + date and that `## Lessons` may have been scaffolded.
- No `noldor doctor` row for an `ideas.md` without `## Lessons`: the writer scaffolds the section on first use, so the row would only report a gap that fixes itself.

### Error handling

Every failure is advisory. No `ideas.md` and no write permission → exit 1 with the path; the gate prints it and finishes. Lock held past a few seconds → exit 1 naming the holder; the agent re-runs once. The step never blocks `pr-flow` (it runs after the merge) and never blocks the always-clear handoff.

### Testing

Unit tests for `retro-cli.ts` against a temp repo: scaffold from nothing, insert a missing section before `## Verticals`, idempotent re-run, worktree cwd writes to the main checkout, `--none`, `--none` + text is exit 2, concurrent writers both land. A skill-code-drift style check that the gate's `retro.md` names a real CLI verb comes for free from the existing skill checks.

UI verdict: skip — no `consumer.uiPaths` surface; the change is a CLI plus skill and doc prose.

Architecture verdict: skip — the CLI sits in the existing `src/triage/` directory under the existing `triage` group; no new package, external, or module-level import edge.

## Acceptance criteria

- `pnpm noldor triage retro --slug s --pr 1 --lesson "x"` run from `.worktrees/s/` writes `x (s, PR #1, <today>)` under `## Lessons` in the main checkout's `ideas.md`, and the worktree's `ideas.md` is unchanged.
- On a repo with no `ideas.md`, the same call creates the file with `## Not groomed` and `## Lessons`.
- On an `ideas.md` with no `## Lessons` (charuy's shape), the section is inserted before `## Verticals` and no existing line moves.
- `--followup` bullets land under `## Not groomed`.
- Running the same call twice leaves one copy of each bullet.
- `--none` exits 0, writes nothing, and prints a line saying nothing was captured; `--none` with `--lesson` exits 2.
- Two concurrent calls with different bullets both appear in the file.
- The command never stages or commits (`git status` shows `ideas.md` modified or untracked, index unchanged).
- The gate skill runs the retro after cleanup on every path, before the Step 5 handoff, and the Step 5 report carries a retro line.
- `drain-mode.md` runs the same call after merge in the normal, Finish and Resume paths.
- Every edited shipped skill or runbook matches its `templates/` twin (`checks template-sync` green).

## Risks / trade-offs

- **Padding.** An agent told "write a retro" may invent lessons. Mitigation: `--none` is a first-class answer and the prose says an empty retro is fine.
- **Noise in `## Not groomed`.** Follow-ups there are not surfaced by `triage list-untriaged` (by design, see `src/triage/triage-list-untriaged.ts`), so they need a human move. That is the point of open question 1.
- **Skill edits from a worktree.** `checks shared-files` refuses `.claude/skills/**` from `.worktrees/`; the commit needs `NOLDOR_ALLOW_SHARED=1` (precedent: PR #511).
- **Lock file left behind** by a killed process. Reuse the liveness check in `drain-lock.ts` so a dead holder's lock is taken over.

## User Story

As an agent finishing a Noldor session (interactive or drain), I want one command that records my follow-ups and lessons in the repo's `ideas.md`, so that what I learned stays with the project — on this repo and on every consumer — instead of in my private memory.

## Usage

**Agent (automatic, gate Step 4.12 / drain end-of-flow)**

```
pnpm noldor triage retro --slug <slug> --pr <n> \
  --lesson "commit-msg hook reads only the last trailer block" \
  --followup "CR low: dedupe the two section-insert helpers"
pnpm noldor triage retro --slug <slug> --pr <n> --none
```

**Operator**

1. Nothing to do at ship time — the bullets appear in `ideas.md`.
2. Later, run `/noldor-absorb` to file `## Lessons`, and move ready follow-ups for `/noldor-triage`.

## Open questions (resolved)

1. *Follow-ups go under `## Not groomed` (as the entry says) or straight under `## Verticals → #### Later` (where triage reads)?* -> `## Not groomed`. Triage deliberately ignores it, so a raw follow-up gets a human look before it enters the scored queue (D1).
2. *A CLI, or prose that tells the agent to edit `ideas.md` by hand?* -> CLI. Hand edits in a drain child land in the worktree and vanish; the main-checkout resolution and the scaffold need code (D2).
3. *Where does the step sit?* -> After cleanup, before Step 5, on every path. The PR number exists only after merge, and the always-clear rule already lives in Step 5 (D3).
4. *Should the step commit `ideas.md` when it is tracked?* -> No. Tracked here, gitignored in charuy; one rule for both is "write, never commit" (D4).
5. *Doctor row for a missing `## Lessons`?* -> No. The writer scaffolds it on first use (D5).
