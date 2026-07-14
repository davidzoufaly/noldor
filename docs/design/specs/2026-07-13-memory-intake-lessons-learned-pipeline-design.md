# Memory-Intake / Lessons-Learned Pipeline — Design

**Slug:** memory-intake-lessons-learned-pipeline
**FD:** docs/features/memory-intake-lessons-learned-pipeline.md
**Date:** 2026-07-13
**Tier:** specs-only

## Problem

The framework's load-bearing operational knowledge is split between the repo and
an out-of-repo assistant memory (~90 files under
`~/.claude/projects/-Users-davidzoufaly-code-noldor/memory/`). `docs/vision.md`
§37-40 makes self-ownership a stated invariant: "every load-bearing fact lives in
this repo, not in any single assistant's private memory. Operational knowledge
that would otherwise be memory-bound belongs in
[`noldor/gotchas.md`](../../noldor/gotchas.md) and the runbooks beside it."

Today the only path from memory → repo is a manual sweep (the 2026-07-07 audit
that produced Q-0019..Q-0025). It doesn't repeat itself and depends on an
assistant remembering to do it. There is no place to drop a lesson and no
classifier to route it into the right doc. Knowledge keeps accreting in private
memory where a consumer of the framework can never see it.

## Goals

- An **in-repo capture point** for lessons, reusing the existing `ideas.md` inbox — a new `## Lessons` section — with **no new file and no new CLI**.
- A single new surface: the **`/noldor-absorb` skill**, which classifies each captured lesson and files it. Judgment lives in the skill; there is no CLI or `src/` command to add.
- A **4-way classifier**: `drop` (shipped-historical, already in git + `docs/release-notes.md`), `gotcha` (→ `docs/noldor/` docs), `actionable` (→ the existing triage queue), `feedback` (→ runbook docs).

## Non-goals

- **No dogfood memory migration in this FD.** Folding the existing ~90 memories into docs is cut from scope; a follow-up bullet is seeded in `ideas.md` (`## Verticals → ### Tooling → #### Later`) **in this same commit** so the migration work stays on a queue (D1). This FD ships the mechanism only; validating it against the real memory corpus is separate work.
- **No new `lessons.md` file.** Lessons live in the existing `ideas.md` (D2).
- **No new `noldor` CLI subcommands** and **no new `src/` module** (D4). The skill reads and writes markdown (`ideas.md`, `docs/noldor/*.md`) directly, exactly as `/noldor-triage` edits `ideas.md` markers by hand today.
- **No source-memory deletion** — out of scope entirely now that migration is cut.
- **No automation** (watcher, scheduled absorb). The entry is explicitly speculative — "validate the manual sweep pays off before automating." This ships the manual-but-mechanized loop only.

## Design

The pipeline reuses the proven **`ideas.md` → `/noldor-triage`** seam rather than
duplicating it: capture is a plain edit to `ideas.md`; a skill classifies and
files. The only structural addition is a section convention and one skill.

### Unit 1 — `## Lessons` section in `ideas.md`

A new top-level section in the existing `ideas.md`:

```markdown
## Lessons

- CR sink goes stale after `git commit --amend` — rm `.noldor/cr/<slug>-*.json` before re-orchestrating [absorbed 2026-07-13 → gotchas]
- <a raw, unfiled lesson bullet>
```

An **unfiled** lesson is a top-level `-` bullet under `## Lessons` with no
`[absorbed YYYY-MM-DD → <dest>]` marker. The marker mirrors `ideas.md`'s existing
`[triaged YYYY-MM-DD → <slug>]` convention.

**`<dest>` vocabulary (pinned).** Exactly one of: `drop` (no doc write),
`ideas` (actionable — appended to `## Verticals → #### Later`), or the
`noldor-page` slug of the doc page written for `gotcha`/`feedback` (e.g.
`gotchas`, `cr-pipeline`, `workflow`, `doc-conventions`). Not freeform — the
skill body enumerates the set, keeping the audit log greppable and the
skip-if-stamped idempotency check unambiguous.

Stamped bullets may be pruned eventually — git history of the tracked file is
the durable audit trail; `## Lessons` only needs to hold the unfiled tail. (For
a consumer that gitignores its `ideas.md`, the durable trail is instead the
tracked `docs/noldor/` write each absorb produces; only the ephemeral stamp is
lost on prune.)

**Isolation from triage — verified against live code.** Every `ideas.md` consumer
parses bullets through `extractUntriagedBullets`
(`src/triage/triage-list-untriaged.ts:31`), which walks **only** the
`## Verticals → #### Now|Next|Later` subtree. `detectUntriagedIdeas`
(`src/garden/sdd-report.ts:164`) and the dashboard's `ideasMd` input
(`src/dashboard/data.ts:1053`) both route through that same extractor. A
`## Lessons` section is therefore invisible to triage, the SDD/garden report, and
the dashboard — no false "untriaged idea" flag, no collision. This isolation is
load-bearing and gets a regression test (Unit 3).

### Unit 2 — `/noldor-absorb` skill (+ template twin)

New skill at `.claude/skills/noldor-absorb/SKILL.md` **and** its byte-identical
twin `templates/.claude/skills/noldor-absorb/SKILL.md` (skill twins are enforced
by `check-template-sync`; see the doc-conventions runbook + `NOLDOR_ALLOW_SHARED`
handling). Flow:

1. Read the unfiled bullets under `## Lessons` in `ideas.md` (bullets with no `[absorbed …]` marker).
2. Classify each into one class and propose a destination:
   - **`drop`** — shipped-historical / already in git + `docs/release-notes.md`. No doc write.
   - **`gotcha`** — operational trap → append to `docs/noldor/gotchas.md` (default) or a more specific runbook (`cr-pipeline.md`, `autonomy.md`, `drain-mode.md`, `worktree-discipline.md`) on a strong area match.
   - **`actionable`** — reveals unfinished work → append the lesson as a bullet under `## Verticals → #### Later` in `ideas.md`, so it flows through the **existing** `/noldor-triage` seam (one scoring path, no direct roadmap/backlog writer).
   - **`feedback`** — guidance on how agents should work → the most-specific runbook (`workflow.md`, `doc-conventions.md`), else `gotchas.md`.
3. Batch-confirm the full disposition table (like `/noldor-triage`); operator overrides per row.
4. On confirm: write each `gotcha`/`feedback`/`actionable` destination, then stamp `[absorbed YYYY-MM-DD → <dest>]` on the **source bullet in place**. `drop` bullets are stamped `[absorbed … → drop]` with no doc write. Idempotent: a stamped bullet is skipped on re-run. Stamped bullets may later be pruned by hand — git history is the durable audit trail (Unit 1).

**Twin discipline (critical).** Any write to a `docs/noldor/*.md` page MUST also
write the matching `templates/docs/noldor/*.md` twin — `check-template-sync`
enforces byte-identity, and a consumer-only edit "silently vanishes" when
`pnpm test` regenerates the page (documented in `gotchas.md` itself). The skill
body states this explicitly for the `gotcha`/`feedback` classes.

### Unit 3 — Isolation regression test + doc convention

- **Test** — extend `src/triage/__tests__` (the existing `extractUntriagedBullets` suite): assert a top-level bullet under a `## Lessons` section is **not** returned by `extractUntriagedBullets`. Locks in the isolation Unit 1 depends on so a future refactor can't make the extractor greedy and start swallowing lessons as triage candidates. This is the one code artifact — a guard test, not a CLI.
- **Stale-comment cleanup** — two comments claim `ideas.md` is untracked, but `git ls-files` shows it tracked in this repo: `triage-list-untriaged.ts:75` says "gitignored since PR #14"; `doc-roots.ts:17` says "the per-user untracked triage inbox". Fix both to say "tracked here; consumers may gitignore theirs" while touching the area.
- **Docs** — document the `## Lessons` convention + the absorb loop in `docs/noldor/triage.md` (and its template twin), and add a `/noldor-absorb` row to the skill catalog (`docs/noldor/skill-catalog.md` + twin). Both are `docs/noldor/*.md` twinned pages.

## Acceptance criteria

- `extractUntriagedBullets` regression test: given an `ideas.md` containing both a `## Verticals → #### Now` bullet and a `## Lessons` bullet, only the Verticals bullet is returned; the Lessons bullet is ignored.
- `.claude/skills/noldor-absorb/SKILL.md` and its `templates/` twin are byte-identical (`check-template-sync` passes).
- `/noldor-absorb` skill body specifies: the 4-class taxonomy; in-place `[absorbed YYYY-MM-DD → <dest>]` stamping with the **pinned `<dest>` vocabulary** (`drop` | `ideas` | `noldor-page` slug); both-twin edits for `gotcha`/`feedback`; append-to-`## Verticals → #### Later` for `actionable`; batch-confirm before any write; skip-if-already-stamped idempotency.
- `docs/noldor/triage.md` (+ twin) documents the `## Lessons` convention and absorb loop; `docs/noldor/skill-catalog.md` (+ twin) lists `/noldor-absorb`.
- `ideas.md` carries a `## Lessons` section (seeded empty or with one example bullet) **and** the follow-up migration bullet under `## Verticals → ### Tooling → #### Later`.
- FD Summary matches the ratified scope (no CLI, no in-FD migration).
- Stale `ideas.md`-is-gitignored comments in `src/triage/triage-list-untriaged.ts` and `src/core/doc-roots.ts` corrected.
- `pnpm verify` (typecheck + lint + tests) green on the branch.

## Risks / trade-offs

- **Classifier is LLM judgment** — a lesson can be misfiled. Mitigated by the mandatory batch-confirm before any write (same safety rail as `/noldor-triage`).
- **No CLI ⇒ thinner test surface.** The feature is mostly skill prose + doc convention. Mitigated by the `extractUntriagedBullets` isolation test (guards the one load-bearing code assumption) and `check-template-sync` (guards the twin). Everything else is prose the code-stage CR reviews.
- **`## Lessons` lives in a tracked file** — lessons are visible in diffs before they're filed. Intentional (self-ownership wants them in-repo) and short-lived (absorb stamps them). Caveat: `ideas.md` is tracked in **this** repo, but a consumer may gitignore theirs (two stale src comments still claim it's gitignored here — cleaned up in Unit 3); for such consumers the self-ownership property holds only after absorb files the lesson into tracked docs, not at capture.
- **Reusing `ideas.md` couples two concerns** (future-work ideas vs already-learned lessons) in one file. Mitigated by section isolation (verified: only `## Verticals` is scanned) — they never contend for the same bullets.
- **Speculative feature.** If the absorb loop goes unused, sunk cost is near-zero: one skill, one section convention, one guard test. No runtime surface.

## User Story

As an operator or agent, I want to drop a hard-won lesson under `## Lessons` in
`ideas.md` and run one skill to classify and file it into the framework's own
docs, so that operational knowledge lives in the repo — visible to every consumer
and future agent — without a new tool, file, or CLI to learn.

## Usage

- Capture a lesson — plain edit, add a bullet under `## Lessons` in `ideas.md`:
  ```markdown
  ## Lessons

  - CR sink goes stale after `git commit --amend` — rm `.noldor/cr/<slug>-*.json` before re-orchestrating
  ```
- File everything (LLM classifier, batch-confirmed):
  ```
  /noldor-absorb
  ```
  Reads unfiled `## Lessons` bullets, proposes a `drop | gotcha | actionable |
  feedback` disposition per bullet, files on confirm (writing `gotcha`/`feedback`
  into `docs/noldor/` twins and `actionable` into the triage queue), and stamps
  `[absorbed YYYY-MM-DD → <dest>]` back onto each source bullet.

## Open questions (resolved)

1. *Does this FD include the dogfood migration of the existing ~90 memories?* -> No — cut to a follow-up entry; this FD ships the mechanism only (D1, ratified by operator). Rationale: the pipeline is the reusable piece; a one-time bulk fold is separable and much larger.
2. *New `lessons.md` inbox, or reuse `ideas.md`?* -> Reuse `ideas.md` via a `## Lessons` section (D2, ratified by operator). Rationale: one inbox, one mental model; no new tracked file, no DocRoots/gitignore churn.
3. *Where do `actionable` lessons route?* -> Appended to `## Verticals → #### Later` in `ideas.md`, flowing through `/noldor-triage` (D3, ratified by operator). Rationale: keeps a single triage/scoring path; avoids a second, divergent roadmap writer.
4. *CLI + skill, or skill only?* -> Skill only; no `noldor lessons` group, no `src/lessons/` module (D4, ratified by operator). Rationale: capture is already "edit `ideas.md`"; a deterministic capture CLI adds surface for no gain when the section is hand-edited like the rest of `ideas.md`.
5. *How is `## Lessons` kept from colliding with triage / SDD-report / dashboard?* -> Section isolation, verified: all three read `ideas.md` only through `extractUntriagedBullets`, which walks solely `## Verticals → Now/Next/Later` (D5). A regression test locks it in. Rationale: cheapest guarantee; no new parser needed.
6. *Do consumers scaffold the `## Lessons` section?* -> It ships in this repo's `ideas.md`; `ideas.md` is not templated, so consumers add the section on first use (D6). Rationale: matches `ideas.md`'s existing non-templated status; the `/noldor-absorb` skill (which IS twinned) is the part consumers receive.
