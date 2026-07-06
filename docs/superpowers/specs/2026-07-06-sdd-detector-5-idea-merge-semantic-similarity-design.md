# SDD Detector 5 — Idea-Merge Semantic Similarity — Design

**Slug:** sdd-detector-5-idea-merge-semantic-similarity
**FD:** docs/features/sdd-detector-5-idea-merge-semantic-similarity.md
**Date:** 2026-07-06
**Tier:** full
**Deps:** none

## Problem

`/triage` (`.claude/skills/triage/SKILL.md`, step 4) decides, per untriaged idea, **new entry** vs **merge into existing**. Today that decision is pure ad-hoc LLM judgment: the skill reads `docs/roadmap.md` + `docs/backlog.md` in full (step 2) and eyeballs each idea against every block. Two weaknesses:

1. **The bias is implicit.** The operator never sees *which* hosts were considered — only the single proposal the LLM landed on. Bad matches and missed merges are invisible in the confirmation table.
2. **FDs are not candidates at all.** Only roadmap/backlog schema-C blocks are scanned. An idea that overlaps an already-promoted feature (`docs/features/*.md`) gets proposed as a fresh, parent-less entry — the connection to the host FD is lost, so `/promote` never sees the attach opportunity.

The roadmap entry (Q-0003) framed this as "compute semantic similarity ... via graphify," but graphify's `graphify-out/graph.json` is an **AST graph of code files** (1656 code nodes, numeric communities, **no embeddings, no node text**); its only human-readable community labels live in `graph.brainstorm-summary.toon` and are code-cluster names (`detectors`, `runners`, `rules`) — a signal about code structure, not feature intent. There is **zero** embedding/cosine/TF-IDF infra in `src/` or `scripts/`. So the honest mechanism is not vector math over graphify — it is to **formalize the LLM judgment `/triage` already performs**: give it a complete, structured candidate corpus and surface the shortlist.

## Goals

- A deterministic, unit-tested CLI that emits the **full merge-candidate corpus** — every FD, roadmap block, and backlog block — as structured JSON.
- `/triage` step 4 consumes that corpus, ranks the **top-3** hosts per idea via LLM judgment, and **surfaces the shortlist explicitly** in the confirmation table (roadmap bullet #1).
- FDs become first-class candidates; an idea matching an FD is proposed as a **new entry carrying `parent: <fd-slug>`** (attach intent for a later `/promote`), implementing roadmap bullet #2.

## Non-goals

- **No embeddings / vectors / external model.** No networked embedding API, no cosine, no persisted numeric similarity score. Keeps the feature offline + deterministic per `docs/vision.md` ("opinionated, not configurable").
- **No graphify dependency.** Community labels are code-cluster names, the wrong signal for feature-merge intent; explicitly excluded.
- **No lexical prefilter.** The corpus (64 FDs + roadmap + backlog ≈ low hundreds of one-paragraph entries) is small enough to feed whole to the ranking LLM. If the corpus ever outgrows the prompt, a prefilter is a later slice — not built now (YAGNI).
- **No automatic merge/attach execution.** `/triage` still only *proposes*; the operator confirms every row; the actual attach happens later at `/promote` (`parent:` → `*-attach`). No behavior change to `/promote` or the attach flow.

## Design

### Unit 1 — `MergeCandidate` type + corpus builder (`src/triage/merge-candidates.ts`, new)

`async buildMergeCandidates(docRoot: string): Promise<MergeCandidate[]>` — async because `loadSddFeatures` is async and Unit 2 reads each FD body from disk. Not a pure function (it does I/O), but **deterministic** for a fixed doc tree. One purpose: enumerate every merge target with the text an LLM needs to judge overlap. Independently testable — the `docRoot` arg is injected end-to-end via `loadDocRoots(docRoot)` (no module-global state), so a test points it at a fixture dir.

```ts
export interface MergeCandidate {
  kind: 'feature' | 'roadmap' | 'backlog';
  slug: string;
  id?: string;                       // Q-NNNN when present
  name: string;                      // heading / FD frontmatter name
  summary: string;                   // one-paragraph body ('' when absent)
  phase?: string;                    // FD phase (in-progress/done); block phase when set
  disposition: 'merge' | 'parent';   // roadmap|backlog -> 'merge'; feature -> 'parent'
}
```

All paths come from `const roots = loadDocRoots(docRoot)` ([src/core/doc-roots.ts](../../../src/core/doc-roots.ts) → `{ features, roadmap, backlog, … }`, all joined off the injected `docRoot`). This is the exact primitive the cited mirror [src/triage/triage-list-untriaged.ts](../../../src/triage/triage-list-untriaged.ts) uses, keeps triage inside `core` (no dashboard-layer coupling), and honors the injected fixture root in tests. Sources, reusing existing loaders (no re-implementation of parsing):

- **Roadmap** — `parseRoadmap(await readFile(roots.roadmap, 'utf8'))` from [src/utils/parse-blocks.ts](../../../src/utils/parse-blocks.ts) → `BacklogEntry[]`. Map each: `kind:'roadmap'`, `slug`, `id`, `name`, `summary: entry.description`, `disposition:'merge'`.
- **Backlog** — `parseBacklog(await readFile(roots.backlog, 'utf8'))` (same module) → same mapping with `kind:'backlog'`, plus `phase: entry.phase`.
- **Features** — `loadSddFeatures(roots.features)` from [src/core/fd-load.ts](../../../src/core/fd-load.ts) (`loadSddFeatures(dir)` takes the **features directory**, not the repo root — mirrors `src/garden/sdd-report.ts:880`, `src/features/propose-pointers.ts:123`) → `FeatureRecord[]` gives `{slug, frontmatter}`. Map: `kind:'feature'`, `slug`, `id: frontmatter['entry-id']`, `name: frontmatter.name`, `phase: frontmatter.phase`, `disposition:'parent'`, `summary: <see Unit 2>`.

Missing `roadmap`/`backlog` file → `readFile` rejects; wrap each in a catch → `''` (empty raw → `parse*` returns `[]`), matching the tolerant "missing file = empty" pattern in `triage-list-untriaged.ts:79` and `loadSddFeatures`' own ENOENT→`[]`.

### Unit 2 — `extractSummary(md: string): string` (add to `src/core/fd-load.ts`)

`FeatureRecord` carries only `{slug, frontmatter}` — not the body. Add a **pure** `extractSummary(md: string): string` to [src/core/fd-load.ts](../../../src/core/fd-load.ts) (co-located with `loadSddFeatures`/`FeatureRecord` — the natural home for FD-body helpers): match the `## Summary` section body and return it trimmed, `''` when absent. The builder reads each FD file (`await readFile(join(roots.features, slug + '.md'), 'utf8')`) and calls `extractSummary` on it. Matching on Summary (not just the terse `name`, e.g. "SDD Detector 5 — Idea-Merge Semantic Similarity") gives the ranking LLM real signal; re-reading ≤~100 small FD files is negligible.

**Why not reuse `readFdSummary`** ([src/cr/read-fd-summary.ts:3](../../../src/cr/read-fd-summary.ts)): it has the exact regex, but lives in `src/cr` — importing it into `src/triage` creates a `triage → cr` edge that Noldor's boundary rules forbid (self-boundaries, PR #156). Placing `extractSummary` in `core` keeps the dependency `triage → core` (allowed) and, since `cr → core` is also allowed, lets `read-fd-summary.ts` optionally delegate to it later. That consolidation (removing the duplicated regex) is a **known, acknowledged** follow-up — deferred here to avoid touching the verify lane's dependency in this slice, not silently ignored.

### Unit 3 — CLI wrapper (`src/triage/merge-candidates-cli.ts`, new)

Mirrors [src/triage/triage-list-untriaged.ts](../../../src/triage/triage-list-untriaged.ts): resolves `docRoot`, calls `buildMergeCandidates`, then:

- default → human-readable table (`kind · slug · name · disposition`), for eyeballing.
- `--json` → `JSON.stringify(candidates)` to stdout, consumed by the skill.

Wired into [src/cli/manifest.ts](../../../src/cli/manifest.ts) under the existing `triage:` group as `merge-candidates: { src: 'triage/merge-candidates-cli.ts', desc: 'Emit the merge-candidate corpus (FDs + roadmap + backlog) for /triage' }`.

### Unit 4 — `/triage` skill integration (`.claude/skills/triage/SKILL.md`, step 4)

Rewrite step 4's decision procedure:

1. At step 3 (after `list-untriaged`), also run `pnpm noldor triage merge-candidates --json` once; capture the corpus.
2. For each untriaged idea, the LLM ranks the corpus and takes the **top-3** by judged overlap (name + summary). Disposition follows the candidate `kind`:
   - `kind: roadmap|backlog` → propose `merge:<slug>` (sub-bullet append — unchanged behavior).
   - `kind: feature` → propose a **new entry** (roadmap/backlog per the existing rubric) carrying `- parent: <fd-slug>`.
   - no candidate clears the bar → parent-less new entry (unchanged).
3. The confirmation table gains a `cands:` annotation per idea listing the top-3 considered slugs (e.g. `cands: relax-graph-freshness, toon-graphjson-arg, graph-freshness-scanpaths`), so the merge bias is explicit and the operator can spot a bad top pick or force a different host via `edit`.

Data flow: `list-untriaged` (ideas) + `merge-candidates --json` (corpus) → LLM per-idea ranking → confirmation table → existing write paths (merge sub-bullet / new schema-C block with optional `parent:`).

Error handling: CLI failure (non-zero exit) is surfaced by the skill and it falls back to today's implicit scan — the corpus is an *aid*, never a hard gate. Empty roadmap/backlog/features → empty corpus → every idea is a new entry (no crash).

## Acceptance criteria

- `pnpm noldor triage merge-candidates --json` prints a JSON array with one object per FD (`docs/features/*.md`), roadmap block, and backlog block; each object has `kind`, `slug`, `name`, `summary`, `disposition` (+ `id`/`phase` when present).
- `disposition` is `'parent'` for `kind:'feature'`, `'merge'` for `kind:'roadmap'|'backlog'`.
- `extractSummary` returns the trimmed `## Summary` body, and `''` when the section is absent — both covered by unit tests.
- `buildMergeCandidates` unit test: fixture docRoot with ≥1 FD + ≥1 roadmap block + ≥1 backlog block asserts count, kinds, dispositions, summary extraction, and empty-summary fallback.
- Default (non-`--json`) invocation prints a human-readable table.
- `.claude/skills/triage/SKILL.md` step 4 references the new CLI + disposition rule + `cands:` surfacing; `pnpm noldor validate skill-catalog`, `pnpm noldor sync doc-links`, and `pnpm noldor validate features` stay green.
- No new runtime dependency; no network call; output is deterministic for a fixed doc tree.

## Risks / trade-offs

- **LLM ranking is non-deterministic and not unit-tested.** Mitigation: the *corpus* is deterministic and tested; ranking quality is a prompt concern and the operator confirms every row. This matches Approach B chosen at spec time — deliberately no false-precision numeric score.
- **Pure paraphrase with zero shared vocabulary** may still be missed by the LLM. Acceptable: the operator sees the full idea text and can merge by hand; `/garden`'s duplicate detector remains the backstop.
- **Corpus size grows with the repo.** At hundreds of FDs the JSON could bloat the prompt. Mitigation noted as a future lexical-prefilter slice; not built now.
- **`extractSummary` is format-sensitive** (assumes a `## Summary` section). Mitigation: `''` fallback + match on `name` too; FD schema already standardizes the Summary section via `/promote` scaffolding.

## User Story

As an operator (or triage agent) running `/triage`, I want the merge-candidate hosts surfaced as an explicit ranked shortlist drawn from all FDs, roadmap, and backlog entries — with FD matches proposed as parent-linked new entries — so that I fold new ideas into existing work instead of scattering near-duplicate entries that `/garden` later flags.

## Usage

- `pnpm noldor triage merge-candidates` — human-readable table of every merge candidate (`kind · slug · name · disposition`).
- `pnpm noldor triage merge-candidates --json` — machine JSON; consumed by `/triage` step 4.
- Inside `/triage`: the skill calls the CLI once per run; each idea's proposal shows its disposition (`merge:<slug>` / new `+ parent:<fd-slug>` / new) plus a `cands: a, b, c` annotation of the top-3 hosts considered. Operator confirms/edits per row as today.

## Open questions (resolved)

1. *Core similarity mechanism — embeddings, lexical, or LLM judgment?* -> **LLM-judgment formalized (operator-chosen).** The CLI emits a deterministic corpus; `/triage`'s existing LLM does the ranking. No scoring math (D1).
2. *What does an FD match produce, given you can't sub-bullet-merge into an FD?* -> **A new entry carrying `parent: <fd-slug>` (operator-chosen)** — attach intent consumed later by `/promote` (`*-attach`). Reuses the existing `parent:` mechanism (D2).
3. *FD corpus text: name only, or name + Summary?* -> **name + the `## Summary` section body** (via a pure `extractSummary` in `core`; `''` fallback when absent). Richer LLM signal than the terse name; cheap re-read of each FD file (D3).
4. *Prefilter / numeric scores?* -> **Neither.** Corpus is small; Approach B has no scores. Prefilter deferred to a future slice if the corpus outgrows the prompt (D4).
5. *Use graphify community labels as a signal?* -> **No.** They are code-cluster names (wrong signal) and pulling them would couple triage to a code-AST artifact; excluded to keep the feature honest + offline (D5).
6. *Subcommand name?* -> **`triage merge-candidates`** — fits the `triage` family and names the corpus-emitter semantics (D6).
7. *How is the shortlist surfaced?* -> **A `cands:` annotation listing the top-3 considered slugs per idea** in the confirmation table, making the (previously implicit) merge bias visible — the explicit deliverable of roadmap bullet #1 (D7).
