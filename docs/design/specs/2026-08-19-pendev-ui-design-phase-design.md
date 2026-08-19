# pen.dev UI Design Phase — Design

**Slug:** pendev-ui-design-phase
**FD:** docs/features/pendev-ui-design-phase.md
**Date:** 2026-08-19
**Tier:** full

## Problem

The framework has no UI-design stage. `/noldor-spec` produces prose; a frontend feature's visual design is either absent from the artifact trail or pasted in as a screenshot nobody validates. Design decisions therefore happen after the spec closes — during implementation, unreviewed — and every new UI feature or redesign starts from nothing: there is no repo artifact that reflects what the shipped UI currently looks like, so iteration begins from memory or from re-reading component code.

Two consumer-blocking needs follow:

1. A design step inside the spec phase where several UI versions can be drafted and compared while the spec is still being written, converging on one final design the spec carries as its own pinned artifact.
2. A shared design baseline that reflects the **current shipped UI**, so new features and redesigns iterate from an up-to-date starting point instead of from scratch — and a mechanism that keeps that baseline from rotting.

The third surface from the roadmap entry — a review lane checking implemented UI against the chosen design — is **carved out** to sibling entry Q-0145 (`split-from: Q-0144`, deps on this feature). It lands once this stage produces artifacts to review against.

## Goals

- UI-bearing sessions produce a git-pinned design artifact (`.pen`) that the spec links and gate Step 2.5 commits alongside the spec — design adjudicated with the spec, not after it.
- A shared baseline folder mirrors the shipped UI per surface; feature design work seeds from it and the winning design merges back at ship time.
- Baseline drift is detected by code, not operator memory: a freshness check reds when UI code moved and the baseline didn't.
- Non-UI features skip the whole stage by predicate — zero new prompts, zero cost for non-UI consumers.

## Non-goals

- **UI-review CR lane** — sibling entry Q-0145.
- **Mechanical render-compare** (screenshot diff against a running app) — deferred until boot recipes exist; the whole comparison story is Q-0145's.
- **New gate path or artifact kind.** `sizeToPath()` (`src/core/size-routing.ts`) is untouched — a deliberate divergence from the roadmap entry's "sizeToPath() and the path set both move": UI-ness is orthogonal to size, so the stage triggers on a path predicate, not a size band. No `design` entry joins `artifactKindSchema` (`src/core/lanes.ts`); the `.pen` rides the existing `spec` CR round.
- **Code→`.pen` import.** No mechanical generation of designs from source; baseline sync is a process obligation enforced by check + gate step.
- **pen.dev cloud integration.** Artifacts are local files edited via the pencil MCP server; no URL, auth, or network dependency (vision's self-owned posture).

## Design

### U1 — `consumer.uiPaths` + UI predicate (`src/core/ui-predicate.ts`, new)

`ConsumerConfigSchema` (`src/core/consumer-config.ts`) gains an optional `uiPaths: string[]` — glob patterns naming the consumer's UI source (e.g. `src/dashboard/app/**`). Absent or empty ⇒ the stage never fires; non-UI consumers opt out by existing configs unchanged (strict schema: the field must be added to the schema in the same change that documents it).

New module `src/core/ui-predicate.ts` exports:

- `isUiBearing(paths: string[], uiPaths: string[]): boolean` — glob intersection (reuse the existing `minimatch` idiom in `src/core/allowlist.ts` — its paths-match-globs pattern with `{ dot: true }` at `src/core/allowlist.ts:125` — rather than minting a second matching idiom).
- `sessionUiVerdict(fd: FeatureFrontmatter | null, candidatePaths: string[], uiPaths: string[]): 'required' | 'skip'` — FD frontmatter override first (`design: required` / `design: skip`, new optional field in the features schema, `src/features/validate-features.ts`), then glob intersection, else `skip`.

Candidate paths at spec time = the roadmap entry's `Touches:` clause (already parsed by `src/core/extract-touches.ts`) plus the spec dialogue's own files-touched list; at ship time = `git diff --name-only origin/main...HEAD`.

### U2 — Artifact + baseline conventions (`docs/design/ui/`)

- **Feature design:** `docs/design/ui/<date>-<slug>.pen` (attach: `<date>-<parent>-<enhancement>.pen`) — same date-anchored naming as specs/plans, resolved by the same conventions in `src/core/design-artifact-names.ts` (extend its helpers rather than minting a second name scheme).
- **Shared baseline:** `docs/design/ui/baseline/<surface>.pen` — one file per UI surface (consumer names surfaces; e.g. `dashboard.pen`). Reflects shipped UI as-built. First adoption starts empty; the first shipped UI feature populates it.
- **Archive:** `docs/design/ui/archive/` — the feature `.pen` moves here at ship time via the existing `design archive` seam (`src/design/archive-cli.ts` + `archive-resolve.ts` extended to resolve `.pen` artifacts by the same dialogue-key rules it applies to specs/plans).
- `loadDocRoots` gains a `designUi` root beside the existing design roots so consumers on the transition alias keep resolving.

Inside one feature `.pen`: candidate variants live as separate pages/artboards; the winner is marked by page-name convention `FINAL: <name>`; losers may be pruned before the spec-approval commit. The spec's Design section records considered alternatives in prose either way. Pinning = git SHA; `.pen` is opaque to git diff, which is acceptable — the commit boundary is the version boundary.

The FD links the artifact: `links.design: docs/design/ui/<date>-<slug>.pen` — one new optional relation in the links projection engine (`sync` unification, PR #338) so `pnpm noldor sync` and the docs-link gate treat it like `links.code`/`links.tests`/`links.docs`.

### U3 — Design step inside `noldor-spec` (prose, `.claude/skills/noldor-spec/SKILL.md` + templates twin)

After grounding (skill step 1), the controller computes the UI verdict (U1). On `required`:

1. **Seed:** copy the relevant baseline pages from `docs/design/ui/baseline/*.pen` into a new feature `.pen` via pencil MCP (`get_app_state` → `execute`). Empty baseline ⇒ start blank and say so.
2. **Iterate:** draft 2–3 candidate variants as pages during the clarify dialogue; compare in-dialogue (pencil MCP screenshots/state renders); operator picks; mark winner `FINAL:`.
3. **Record:** spec's Design section names the chosen variant and the considered alternatives; spec links the `.pen` path; FD `links.design` set.

On `skip`: one line in the spec ("UI verdict: skip — no `uiPaths` intersection"), nothing else. The step adds **zero** prompts for non-UI work.

Gate Step 2.5 commits the `.pen` together with the spec (same commit; the artifact-commit bullet's pathspec covers both). The spec CR round reviews the spec prose including the recorded design decision; reviewers do not parse `.pen`.

### U4 — Ship-time baseline write-back (prose, `/noldor-gate` Step 4 + drain exemption)

New Step 4 bullet for FD-carrying paths, ordered **before** the design-archive bullet so both ride the phase-flip commit: when the session's UI verdict is `required`, merge the feature `.pen`'s `FINAL:` pages into the matching `docs/design/ui/baseline/<surface>.pen` (pencil MCP), reflecting what was **actually implemented** (implementation may have drifted from the design — the baseline records as-built, so update the pages to match reality before merging). Then the archive seam moves the feature `.pen` to `archive/`, and the flip commit carries baseline + archive + FD together.

Fast-track/micro-chore skip (no FD, and XS/S UI tweaks are exactly the mechanical band); the freshness check (U5) is the backstop that catches UI drift those paths introduce.

### U5 — Freshness check (`src/release/ui-design-freshness.ts`, new + CLI)

Mirrors `src/release/graph-freshness.ts` exactly: `evaluateUiDesignFreshness(cwd)` returns `'fresh' | 'stale' | 'skipped'` —

- `skipped` when `consumer.uiPaths` is absent/empty or `docs/design/ui/baseline/` doesn't exist (feature not adopted).
- Compare `latestCommitTs(uiPaths)` (with test/doc excludes, reusing `GRAPH_IRRELEVANT_EXCLUDES`-style pathspecs) vs `latestCommitTs(['docs/design/ui/baseline/'])`; UI newer ⇒ `stale` with the canonical message naming both commits.

Wired into: **(a)** `pnpm noldor checks ui-design-freshness` CLI for the gate Step 4 author-side preflight list; **(b)** release preflight beside graph-freshness (same blocking semantics, same skip posture); **(c)** `doctor` as advisory. Reported, never thrown.

### Data flow

Roadmap entry (`Touches:`) → promote → spec dialogue: UI verdict (U1) → seed from baseline (U3) → candidates → winner `FINAL:` → spec + `.pen` committed (Step 2.5) → spec CR round → plan → implementation → ship: write-back to baseline + archive feature `.pen` + phase-flip in one commit (U4) → freshness check green (U5). Next feature seeds from the just-updated baseline.

### Error handling

- **pencil MCP unavailable** (headless, non-Claude runner): the design step degrades loudly — print the skip reason and record the degradation rationale **in spec prose only**; the FD `design:` frontmatter field is **never** written by the degradation path (setting `design: skip` there would permanently force the ship-time verdict to `skip` and silently disable the U4 write-back for a genuinely UI-bearing feature). Never block a spec on editor availability; the freshness check still enforces eventual baseline truth.
- **Corrupt/unreadable `.pen`:** pencil MCP errors surface to the operator; the file is git-recoverable (`git checkout -- <path>`).
- **Freshness check on missing git history** (shallow clone): `latestCommitTs` returns '' ⇒ treat as `skipped` with detail, mirroring graph-freshness.
- **Baseline merge conflict** (two features shipping into one surface file): `.pen` is opaque to git merge — second PR's write-back re-runs on post-merge main state (worktree branches rebase via `--force-with-lease` push flow); a torn baseline is repaired by re-running the write-back from the archived feature `.pen`.

### Testing

- `src/core/__tests__/ui-predicate.test.ts` — glob intersection, FD override both ways, absent `uiPaths` ⇒ skip, empty candidate set ⇒ skip.
- `src/release/__tests__/ui-design-freshness.test.ts` — fresh/stale/skipped matrix over a fixture repo (same harness as graph-freshness tests).
- `src/features/__tests__` — `design:` frontmatter field accepted (`required`/`skip`), rejected on other values; `links.design` projection round-trips through the sync engine tests.
- Skill prose changes carry template twins (`templates/`), verified by `pnpm noldor checks template-sync`.

## Acceptance criteria

1. `ConsumerConfigSchema` accepts optional `uiPaths: string[]`; existing consumer configs without it keep validating.
2. `isUiBearing` / `sessionUiVerdict` exported with the override-then-intersection semantics above; unit-tested.
3. Features schema accepts optional `design: required | skip` frontmatter; any other value fails `pnpm noldor validate features`.
4. `links.design` resolves through the links projection engine and the docs-link gate like the other relations.
5. A UI-bearing spec session (predicate `required`) produces `docs/design/ui/<date>-<slug>.pen` committed in the same commit as the spec.
6. A non-UI session (predicate `skip`) reaches spec approval with zero design-stage prompts and no `.pen` file.
7. `pnpm noldor design archive` moves the session's feature `.pen` to `docs/design/ui/archive/` under the same dialogue-key + branch-added-set rules as specs/plans.
8. Gate Step 4 prose (+ templates twin) orders write-back → archive → phase-flip so baseline, archive move, and `phase: done` land in one commit.
9. `evaluateUiDesignFreshness` returns `skipped` (no `uiPaths` or no baseline dir), `fresh`, or `stale` per the commit-timestamp comparison; unit-tested for all three.
10. `pnpm noldor checks ui-design-freshness` exits 0 on fresh/skipped, non-zero on stale, printing the verdict detail.
11. Release preflight includes the freshness verdict with the same blocking/skip semantics as graph-freshness; `doctor` surfaces it as advisory.
12. Roadmap carries sibling entry Q-0145 (review lane, `split-from: Q-0144`) and `pnpm noldor validate triage` is green.

## Risks / trade-offs

- **`.pen` is opaque to review and merge.** Reviewers adjudicate the design in-dialogue and via spec prose, not by diffing the artifact; concurrent ships into one baseline surface need a re-run of write-back. Accepted: git-SHA pinning is the goal, not diffability.
- **Baseline truthfulness depends on the write-back step.** Fast-track UI edits bypass it by design; the freshness check narrows the window but a stale-yet-timestamp-fresh baseline (write-back committed but sloppy) is undetectable mechanically. Q-0145's review lane adds the judging eye.
- **Pencil MCP is a Claude-environment dependency.** Non-Claude runners degrade to skip-with-reason; the framework stays runner-neutral by never hard-requiring the editor.
- **Divergence from entry prose** (`sizeToPath()` untouched) — recorded here and in the ledger; if a future consumer needs size-coupled design routing, that's a new entry.

## User Story

As an operator shipping a UI feature through the gate, I want the spec phase to produce a pinned visual design seeded from an always-current baseline of the shipped UI, so that design decisions are adjudicated with the spec, iteration starts from reality rather than memory, and the artifact trail records what was chosen and why.

## Usage

- Consumer setup: add `"uiPaths": ["src/dashboard/app/**"]` to `consumer` in `.noldor/config.json`.
- Spec phase (automatic): on a UI-bearing entry, the design step seeds `docs/design/ui/<date>-<slug>.pen` from `docs/design/ui/baseline/`, iterates variants as pages, marks the winner `FINAL:`; the gate commits it with the spec.
- Override: set `design: required` or `design: skip` in the FD frontmatter to force either verdict.
- Freshness: `pnpm noldor checks ui-design-freshness` (author-side); release preflight and `doctor` run it automatically.

## Open questions (resolved)

1. *Where does the design artifact live and what pins it?* → Repo-committed `.pen` under `docs/design/ui/`, pinned by git SHA; no cloud dependency. (D1)
2. *All candidates or winner only?* → One `.pen` per feature; candidates as pages inside it; winner marked `FINAL:`; losers prunable; alternatives recorded in spec prose. (D2)
3. *How will the review lane compare?* → Reviewer-prompted with `.pen` structure + code diff; carved out to Q-0145; mechanical compare deferred. (D3)
4. *How does the shared baseline stay in sync?* → Ship-time write-back at gate Step 4 plus a graph-freshness-style staleness check; drift caught by code. (D5)
5. *What makes a session UI-bearing?* → `consumer.uiPaths` glob intersection with FD `design:` override; absent config means the stage never fires. (D6)
6. *One spec or split?* → Split: stage + baseline here; review lane as sibling Q-0145 with deps on this feature. (D7)
7. *New gate path / artifact kind?* → Neither: the design step lives inside `noldor-spec`, the `.pen` rides the spec CR round, `sizeToPath()` untouched — UI-ness is orthogonal to size. (D8)
