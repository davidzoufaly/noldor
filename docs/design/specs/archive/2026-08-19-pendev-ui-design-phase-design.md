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
- A shared baseline folder mirrors the shipped UI per surface; feature design work seeds from it and the as-built result merges back at ship time.
- Baseline drift is detected by code, not operator memory: a per-surface freshness check reds when UI code moved and its baseline didn't, with a defined remediation for every red.
- Non-UI features skip the whole stage by predicate — zero new prompts, zero cost for non-UI consumers.

## Non-goals

- **UI-review CR lane** — sibling entry Q-0145.
- **Mechanical render-compare** (screenshot diff against a running app) — deferred until boot recipes exist; the whole comparison story is Q-0145's.
- **New gate path or artifact kind.** `sizeToPath()` (`src/core/size-routing.ts`) is untouched — a deliberate divergence from the roadmap entry's "sizeToPath() and the path set both move": UI-ness is orthogonal to size, so the stage triggers on a path predicate, not a size band. No `design` entry joins `artifactKindSchema` (`src/core/lanes.ts`); the `.pen` rides the existing `spec` CR round.
- **Code→`.pen` import.** No mechanical generation of designs from source; baseline sync is a process obligation enforced by check + gate step + a standalone remediation command.
- **pen.dev cloud integration.** Artifacts are local files edited via the pencil MCP server; no URL, auth, or network dependency (vision's self-owned posture).

## Design

### U1 — Consumer config: `uiPaths` + `uiSurfaces` (`src/core/consumer-config.ts`)

`ConsumerConfigSchema` gains two optional fields (strict schema — added in the same change that documents them; existing configs without them keep validating):

- `uiPaths: string[]` — non-empty repo-relative POSIX glob patterns naming the consumer's UI source (e.g. `src/dashboard/app/**`). Drives the UI predicate (U2). Absent or `[]` ⇒ predicate-side never fires.
- `uiSurfaces: Record<string, string[]>` — surface name → glob subset, mapping UI code to baseline files `docs/design/ui/baseline/<surface>.pen`. Optional; when absent but `uiPaths` present, a single implicit surface `app` covers all of `uiPaths`. Schema rule: every `uiSurfaces` glob list must be non-empty; surface names are slug-shaped (`[a-z0-9-]+`).

A feature's **affected surfaces** = every surface whose glob list matches ≥1 of the feature's UI-matching paths. A feature may affect multiple surfaces; each affected surface participates in seeding (U4) and write-back (U5). A path matching `uiPaths` but no `uiSurfaces` entry falls into the implicit `app` surface only when `uiSurfaces` is absent; when `uiSurfaces` is declared, such a path is a config gap the predicate reports (verdict still `required`; the design step tells the operator which paths lack a surface so the map gets extended).

**Zero-affected-surfaces rule:** a `required` verdict with zero affected surfaces (FD `design: required` with `uiPaths` absent — the new-directory case — or every matching path falling into a config gap) is an incomplete configuration, not a vacuous pass. The design step **refuses to conclude** until affected surfaces ≥ 1: the controller prompts the operator to extend `uiPaths`/`uiSurfaces` (the config edit rides the feature branch) or, when `uiSurfaces` is absent, to accept the implicit `app` surface (created on first use). Every downstream quantifier (seeding, convergence, write-back, freshness) therefore always ranges over a non-empty set in a concluded `required` session.

### U2 — UI predicate (`src/core/ui-predicate.ts`, new)

Matching reuses the existing `minimatch` idiom in `src/core/allowlist.ts` (its paths-match-globs pattern with `{ dot: true }` at `src/core/allowlist.ts:125`) — no second matching idiom. All inputs are repo-relative POSIX paths; no negation patterns in v1 (schema rejects `!`-prefixed globs).

- `isUiBearing(paths: string[], uiPaths: string[]): boolean` — true when any concrete path matches any glob.
- `sessionUiVerdict(fd, candidatePaths, config): UiVerdict` where `UiVerdict = { verdict: 'required' | 'skip'; affectedSurfaces: string[]; unmappedPaths: string[] }` — the surface set and config gaps travel with the verdict so callers never re-derive them. Verdict precedence, as a truth table:

| FD `design:` | `uiPaths` | candidate ∩ uiPaths | verdict |
|---|---|---|---|
| `skip` | any | any | `skip` |
| `required` | any (even absent) | any | `required` — the override is absolute; it exists precisely for the UI-feature-in-a-new-dir case |
| unset / no FD | absent or `[]` | — | `skip` |
| unset / no FD | present | non-empty | `required` |
| unset / no FD | present | empty (incl. empty candidate set) | `skip` |

**Candidate paths are concrete file paths only.** Sources by evaluation point:

- **Spec time** (design-step entry, after grounding): the roadmap entry's `Touches:` values (via `src/core/extract-touches.ts`) ∪ the FD's `links.code`. One pattern language everywhere: a value containing glob metacharacters (`*?[{`) is expanded by matching it as a **minimatch pattern against the `git ls-files` file list** (never git-pathspec semantics — brace expansion and the rest behave identically to the predicate's own matching); a value that is an existing directory is treated as `<value>/**`. Values that expand to nothing contribute nothing.
- **Ship time** (gate Step 4): `git diff --name-only origin/main...HEAD` — the real diff is authoritative; no expansion needed.

**Verdict persistence + reconciliation:** the spec-time verdict is written to the session marker (`session.uiVerdict: 'required' | 'skip'`, plus `uiVerdictPaths` — the matching paths, for audit). It gates only the design step. Ship time **recomputes** the verdict from the real diff (FD override still applies):

- ship-`required` + spec-`required` → write-back runs (U5).
- ship-`required` + spec-`skip` (UI emerged during implementation) → gate surfaces the mismatch; the write-back obligation stands — the operator (or, autonomous, the gate itself) runs the U6 `ui-sync` remediation to update the baseline; no design artifact exists and none is retroactively required.
- ship-`skip` + spec-`required` (designed, but no UI code landed) → write-back no-ops; the feature `.pen` still archives.

### U3 — Artifact + baseline conventions (`docs/design/ui/`)

- **Feature design:** `docs/design/ui/<date>-<slug>.pen` (attach: `<date>-<parent>-<enhancement>.pen`) — same date-anchored naming as specs/plans, extended in `src/core/design-artifact-names.ts` (one name scheme, not two).
- **Shared baseline:** `docs/design/ui/baseline/<surface>.pen`, one per configured surface (U1). Reflects shipped UI as-built. First adoption starts empty; U6 defines bootstrap.
- **Archive:** `docs/design/ui/archive/` — at ship time the feature `.pen` moves here via the existing `design archive` seam (`src/design/archive-cli.ts` + `archive-resolve.ts` extended to resolve `.pen` artifacts by the same dialogue-key + branch-added-set rules as specs/plans). **The seam also rewrites the FD's `links.design` value to the archive path in the same staged change**, so the docs-link gate never sees a dangling target (mirrors how shipped FDs carry `links.spec: docs/design/specs/archive/…`).
- `loadDocRoots` gains a `designUi` root beside the existing design roots so consumers on the transition alias keep resolving.

Inside one feature `.pen`, page names carry their surface: seeded pages are `BASE:<surface>: <name>` (collision-proof when copying from multiple baselines), candidates are free-form, and the winner per surface is `FINAL:<surface>: <name>`. **Convergence rule: exactly one `FINAL:<surface>:` page per affected surface at spec-approval** — the design step refuses to conclude with zero or multiple for any affected surface. Losers may be pruned before the spec-approval commit. The surface prefix is what lets ship-time write-back route each winner to its baseline file deterministically. The spec's Design section records considered alternatives in prose either way. Page-name convention checks happen **in-session via pencil MCP** (the only reader of `.pen` content); U6's CLI validates only what a Node process can see (existence, non-empty, staged state), and Q-0145's lane re-judges content.

**Immutability + pinning:** the approved feature `.pen` is never edited after the spec-approval commit — implementation drift is captured in the *baseline* at write-back (U5), never by rewriting the adjudicated design. The pin is the commit that introduced the artifact at its **original** path, resolved as `git log --diff-filter=A -1 --format=%H -- docs/design/ui/<date>-<slug>.pen` — resolvable even after the archive move, because git keeps the original path's history addressable and the date+slug name is never reused; never resolve the pin against the archive path (rename detection makes that ambiguous). The FD links the artifact: `links.design: docs/design/ui/<date>-<slug>.pen` — one new optional relation in the links projection engine (PR #338) so `pnpm noldor sync` and the docs-link gate treat it like `links.code`/`links.tests`/`links.docs`.

### U4 — Design step inside `noldor-spec` (prose, `.claude/skills/noldor-spec/SKILL.md` + templates twin)

After grounding (skill step 1), the controller computes the spec-time verdict (U2) and writes it to the session marker. On `required`:

1. **Seed:** for each affected surface, copy that surface's baseline pages from `docs/design/ui/baseline/<surface>.pen` into a new feature `.pen` via pencil MCP (`get_app_state` → `execute`). Missing/empty baseline ⇒ start blank and say so.
2. **Iterate:** draft 2–3 candidate variants as pages during the clarify dialogue; compare in-dialogue; operator picks; mark exactly one winner `FINAL:<surface>:` per affected surface.
3. **Record:** spec's Design section names the chosen variant and considered alternatives; spec links the `.pen` path; FD `links.design` set.

On `skip`: one line in the spec ("UI verdict: skip — <reason>"), nothing else. Zero prompts for non-UI work.

**Editor degradation:** `required` never silently degrades. If pencil MCP is unavailable in a `required` session, the design step stops for an explicit operator **waiver** (interactive prompt). The waiver is recorded machine-readably in the session marker — `session.uiWaiver: { reason, at }` — plus spec prose with the operator's rationale; the FD `design:` frontmatter is **never** written by the degradation path (setting `design: skip` there would permanently force ship-time verdicts to `skip`). A waived session ships without a feature `.pen` and without `links.design`: acceptance criterion 5 does not apply to it, U5's write-back is skipped via the marker (the U6 debt is still surfaced), and the archive seam finds nothing to move (its existing `nothing to do` posture). The marker is what lets automation distinguish an approved waiver from an accidentally missing artifact. Headless runners never reach this seam: the spec stage is interactive by construction (drain ships fast-track only; `plansSource` resumes FDs whose design stage already ran).

Gate Step 2.5 commits the `.pen` together with the spec (same commit). The spec CR round reviews the spec prose including the recorded design decision; reviewers do not parse `.pen`.

### U5 — Ship-time baseline write-back (prose, `/noldor-gate` Step 4)

New Step 4 bullet for FD-carrying paths, ordered **after** the design-archive seam (whose empty-index assertion must precede any staging) so baseline edits, archive moves, and `phase: done` ride one flip commit: when the ship-time verdict (U2) is `required`, update every affected surface's `docs/design/ui/baseline/<surface>.pen` (pencil MCP) to reflect the **as-built** UI — starting from the feature `.pen`'s `FINAL:<surface>:` pages (the prefix routes each winner to its baseline file) and adjusting for implementation drift. The approved feature `.pen` itself is not touched (U3 immutability).

If pencil MCP is unavailable at Step 4 in a `required` session, the write-back is skipped **loudly**: the gate prints the debt and the U6 remediation command; U7 turns red until it runs. Ship is not blocked — baseline sync is repayable debt, the artifact trail (feature `.pen`, archived) survives, and blocking PR delivery on editor availability would wedge non-Claude runners.

Fast-track/micro-chore skip this bullet (no FD; XS/S UI tweaks are the mechanical band). Drift they introduce is caught by U7 and repaid by U6.

### U6 — Standalone sync + bootstrap: `pnpm noldor design ui-sync` (new CLI, `src/design/ui-sync-cli.ts`)

The remediation surface for every baseline-debt path (waived sessions, MCP-less ships, fast-track drift, first adoption). Runs in any pencil-capable interactive session:

- `pnpm noldor design ui-sync [--surface <name>]` — a **report-and-validate** CLI, not an editor: it prints, per surface, the U7 verdict, the commits involved, and the edit instruction; the actual `.pen` editing happens in the interactive session via pencil MCP (the CLI cannot read `.pen` content and never pauses mid-run for an agent edit — it is invoked again after the edit). Validation covers what a Node process can see: baseline file exists, non-empty, staged. It leaves the change staged, never committing (house style: `archive-cli` precedent), and its final message states the remediation completes **only when the staged change is committed** — U7 reads committed history, so a staged-only sync stays red (a just-created staged baseline reads `uninitialized` until its commit lands; documented, not a bug).
- **Bootstrap** is the same flow on an `uninitialized` surface: the session creates the baseline file, `ui-sync` validates + stages it. First adoption = configure `uiPaths`/`uiSurfaces`, run the sync flow once per surface.

### U7 — Freshness check (`src/release/ui-design-freshness.ts`, new + CLI)

Follows the shape of `src/release/graph-freshness.ts` (reported, never thrown) but evaluates **per surface** and uses **commit ancestry**, not timestamps:

```ts
interface UiSurfaceFreshness {
  surface: string;
  status: 'fresh' | 'stale' | 'uninitialized' | 'skipped';
  uiCommit?: string;        // latest commit touching the surface's globs (test/doc-excluded)
  baselineCommit?: string;  // latest commit touching baseline/<surface>.pen
  detail: string;           // canonical human-readable reason, incl. remediation hint (U6)
}
interface UiFreshnessVerdict { overall: 'fresh' | 'stale' | 'uninitialized' | 'skipped'; surfaces: UiSurfaceFreshness[]; }
```

- `skipped` (whole check): `uiPaths` absent/empty. `skipped` (per surface): no commits ever touched its globs.
- `uninitialized`: surface globs have commits but `baseline/<surface>.pen` doesn't exist — the permanently-unadopted hole gets its own visible state instead of hiding in `skipped`.
- `fresh` / `stale`: let `U` = latest commit touching the surface's globs (with test/doc pathspec excludes, reusing the `GRAPH_IRRELEVANT_EXCLUDES` approach), `B` = latest commit touching the surface's baseline file. Decision procedure, in order: `U == B` or `git merge-base --is-ancestor U B` exits 0 ⇒ `fresh`; else `git merge-base --is-ancestor B U` exits 0 ⇒ `stale` (baseline strictly behind); else — neither is an ancestor of the other (unrelated histories, diverged branches, shallow-cut history) ⇒ per-surface `skipped` with a detail naming both commits, never a false red. Whole-repo shallow clones (`git rev-parse --is-shallow-repository` true) short-circuit the whole check to `skipped`. Ancestry, not committer timestamps, so rebases/cherry-picks/ties can't lie; every git failure is a `skipped` detail — reported, never a crash.
- `overall` = worst surface status (`stale` > `uninitialized` > `fresh` > `skipped`).

Wired into: **(a)** `pnpm noldor checks ui-design-freshness` — exits 0 on `fresh`/`skipped`, non-zero on `stale`/`uninitialized`, printing every surface row; **(b)** gate Step 4 prose runs it **after the flip commit** (the check reads committed history — staged write-back edits are invisible to it) and before `pr-flow`, **as advisory**: it prints the per-surface rows and the U6 hint but never blocks `pr-flow` — consistent with U5's decision that MCP-less write-back debt must not block shipping, and the pre-write-back staleness circularity is resolved by the ordering; **(c)** release preflight beside graph-freshness is the **blocking** enforcement point — `stale` blocks, `uninitialized` is advisory in v1 (adoption must not brick releases), both with U6 remediation in the message; **(d)** `doctor` as advisory.

### Data flow

Roadmap entry (`Touches:`) → promote → spec dialogue: spec-time verdict (U2, persisted) → seed from baseline per affected surface (U4) → candidates → one `FINAL:<surface>:` per surface → spec + `.pen` committed (Step 2.5) → spec CR round → plan → implementation → ship: ship-time verdict recomputed → archive feature `.pen` + rewrite `links.design` (index assertion first) → baseline write-back (U5) → phase-flip in one commit → freshness green (U7) → pr-flow. Next feature seeds from the just-updated baseline. Any missed write-back → U7 red → U6 `ui-sync`.

### Error handling

- **Pencil MCP unavailable:** spec time → explicit operator waiver, never a silent skip (U4); ship time → loud skip + U6 debt (U5). FD `design:` frontmatter never written by either path.
- **Corrupt/unreadable `.pen`:** pencil MCP errors surface to the operator; the file is git-recoverable (`git checkout -- <path>`); `ui-sync` validates parseability after every sync.
- **Git edge cases in U7** (shallow clone, unrelated histories, empty log): per-surface `skipped` with detail — reported, never thrown.
- **Baseline write conflict** (two features shipping into one surface): `.pen` is opaque to git merge; the second PR's write-back re-runs on post-merge state, and a torn baseline is repaired by `ui-sync` (the archived feature `.pen`s and the code are both still available as sources).

### Testing

- `src/core/__tests__/ui-predicate.test.ts` — the full U2 truth table, glob expansion of `Touches:` values, directory-value expansion, empty candidate set, config-gap reporting (path in `uiPaths` but no surface).
- `src/release/__tests__/ui-design-freshness.test.ts` — fixture-repo matrix: fresh, stale, uninitialized, per-surface skipped, whole-check skipped, rebase/cherry-pick ordering (ancestry beats timestamps), shallow-history fallback, multi-surface worst-of aggregation.
- `src/features/__tests__` — `design: required|skip` accepted, other values rejected; `links.design` projection round-trips through the sync-engine tests; archive-seam test covers the `links.design` rewrite.
- `src/design/__tests__` — `ui-sync` surface resolution + staged-never-committed behavior; archive-resolve extension for `.pen` by dialogue key.
- Skill prose changes carry template twins, verified by `pnpm noldor checks template-sync`.

## Acceptance criteria

1. `ConsumerConfigSchema` accepts optional `uiPaths` + `uiSurfaces` per U1 (non-empty globs, slug-shaped surface names, `!`-globs rejected); existing consumer configs keep validating.
2. `sessionUiVerdict` returns the `UiVerdict` record (verdict + affected surfaces + unmapped paths) implementing the U2 truth table exactly (unit-tested row by row); the spec-time verdict + matching paths persist in the session marker; a `required` session never concludes the design step with zero affected surfaces.
3. Features schema accepts optional `design: required | skip`; any other value fails `pnpm noldor validate features`; no framework code path ever writes the field.
4. `links.design` resolves through the links projection engine and docs-link gate; the archive seam rewrites it to the archive path in the same staged change that moves the artifact — no dangling link at any commit.
5. A `required` non-waived spec session commits `docs/design/ui/<date>-<slug>.pen` in the same commit as the spec, seeded from every affected surface's baseline, with exactly one `FINAL:<surface>:` page per affected surface at approval; the artifact is byte-identical from that commit until the archive move, and its pin resolves via the original path per U3.
6. A `skip` session reaches spec approval with zero design-stage prompts and no `.pen`; a `required` session with pencil MCP unavailable stops for an explicit operator waiver recorded in the session marker (`session.uiWaiver`), distinguishable by automation from a missing artifact.
7. Ship time recomputes the verdict from `origin/main...HEAD`; the U2 reconciliation matrix holds (emerged-UI ships surface the U6 debt; designed-but-no-UI ships no-op the write-back and still archive).
8. Gate Step 4 prose (+ templates twin) orders index-assertion → archive (with link rewrite) → write-back → phase-flip in one commit, and runs the freshness check advisory-only after the flip commit, before `pr-flow`; blocking enforcement lives solely in release preflight.
9. `evaluateUiDesignFreshness` returns the U7 discriminated per-surface verdict using commit ancestry; unit-tested for the full matrix including rebase/cherry-pick and shallow-history cases.
10. `pnpm noldor checks ui-design-freshness` exits 0 on `fresh`/`skipped` and non-zero on `stale`/`uninitialized`, printing per-surface rows with remediation hints; release preflight blocks on `stale` (advisory on `uninitialized`); `doctor` surfaces it as advisory.
11. `pnpm noldor design ui-sync` reports per-surface verdicts with edit instructions, validates what a Node process can see (existence, non-empty, staged), leaves changes staged without committing, and states that remediation completes at commit; `.pen` content rules (page-name convention) are validated in-session via pencil MCP.
12. Roadmap carries sibling entry Q-0145 (`split-from: Q-0144`) and `pnpm noldor validate triage` is green.

## Risks / trade-offs

- **`.pen` is opaque to review and merge.** Reviewers adjudicate the design in-dialogue and via spec prose, not by diffing the artifact; concurrent ships into one surface need a `ui-sync` repair pass. Accepted: git pinning is the goal, not diffability.
- **Baseline truthfulness is process-enforced.** U7 proves the baseline *moved after* the UI code moved, not that its content matches the code; a sloppy write-back is mechanically undetectable. Q-0145's review lane adds the judging eye.
- **Pencil MCP is a Claude-environment dependency.** Spec-time: waiver; ship-time: repayable debt via `ui-sync`. The framework stays runner-neutral by never hard-requiring the editor on a blocking path.
- **Divergence from entry prose** (`sizeToPath()` untouched) — recorded here and in the ledger; if a future consumer needs size-coupled design routing, that's a new entry.
- **`uiSurfaces` granularity is consumer judgment.** Too-coarse maps (one surface for everything) weaken per-surface freshness back to the dir-granular check this spec rejects; the adoption guide should recommend one surface per top-level UI area.

## User Story

As an operator shipping a UI feature through the gate, I want the spec phase to produce a pinned visual design seeded from an always-current baseline of the shipped UI, so that design decisions are adjudicated with the spec, iteration starts from reality rather than memory, and the artifact trail records what was chosen and why.

## Usage

- Consumer setup: add `"uiPaths": ["src/dashboard/app/**"]` (optionally `"uiSurfaces": {"dashboard": ["src/dashboard/app/**"]}`) to `consumer` in `.noldor/config.json`; run `pnpm noldor design ui-sync` once per surface to bootstrap the baseline.
- Spec phase (automatic): on a UI-bearing entry, the design step seeds `docs/design/ui/<date>-<slug>.pen` from the affected baseline surfaces, iterates variants as pages, marks one winner `FINAL:<surface>:` per surface; the gate commits it with the spec.
- Override: set `design: required` or `design: skip` in the FD frontmatter to force either verdict (operator-only field).
- Freshness: `pnpm noldor checks ui-design-freshness` any time; gate Step 4 and release preflight run it automatically; `pnpm noldor design ui-sync` repairs any red.

## Open questions (resolved)

1. *Where does the design artifact live and what pins it?* → Repo-committed `.pen` under `docs/design/ui/`, pinned by the commit that introduced it (`git log --diff-filter=A`); no cloud dependency. (D1)
2. *All candidates or winner only?* → One `.pen` per feature; candidates as pages inside it; exactly one winner `FINAL:<surface>:` per affected surface; losers prunable; alternatives recorded in spec prose. (D2)
3. *How will the review lane compare?* → Reviewer-prompted with `.pen` structure + code diff; carved out to Q-0145; mechanical compare deferred. (D3)
4. *How does the shared baseline stay in sync?* → Ship-time write-back at gate Step 4, an ancestry-based per-surface freshness check, and `design ui-sync` as the universal remediation/bootstrap surface. (D5)
5. *What makes a session UI-bearing?* → `consumer.uiPaths` intersection with an absolute FD `design:` override, per the U2 truth table; verdict persisted at spec time and recomputed at ship time. (D6)
6. *One spec or split?* → Split: stage + baseline here; review lane as sibling Q-0145 with deps on this feature. (D7)
7. *New gate path / artifact kind?* → Neither: the design step lives inside `noldor-spec`, the `.pen` rides the spec CR round, `sizeToPath()` untouched — UI-ness is orthogonal to size. (D8)
