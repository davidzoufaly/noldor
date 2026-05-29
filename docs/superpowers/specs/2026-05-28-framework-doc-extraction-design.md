# Framework Doc Extraction — Design

**Status:** spec
**Owner:** Noldor framework
**Date:** 2026-05-28
**FD:** [docs/features/framework-doc-extraction.md](../../features/framework-doc-extraction.md)

## Problem

The Charuy repo currently mixes Noldor framework artifacts and Charuy product artifacts under a single `docs/` tree:

- `docs/features/` holds ~29 framework FDs (`area: tooling`) and ~36 product FDs side-by-side.
- `docs/roadmap.md` / `docs/backlog.md` interleave framework and product entries by priority.
- `docs/milestones/`, `docs/vision.md`, `ideas.md`, and `docs/superpowers/{plans,specs}/` mix tracks similarly.
- The dashboard surfaces the union; there is no "framework view" or "product view".

This blocks two strategic goals:

1. **Framework reusability** (linked to `project-ultimate-vision` agent-first path). Until framework artifacts live inside `packages/noldor/`, the package cannot ship as a stand-alone consumable for other repos.
2. **Clean mental model.** Operators reason about "next priority" against a mixed list; framework-only or product-only triage requires manual filtering every time.

Prerequisite shipped: PR #54 renamed `src/noldor/` → `src/core/`, disambiguating the nested bucket name before extraction.

## Goals

- Physically separate framework docs into `packages/noldor/docs/` while keeping product docs under `docs/`.
- Preserve every existing automation (gate, garden, promote, triage, release-sweep, dashboard, doctor) by parametrising it over a doc-root.
- Decouple framework + product release semver so `noldor` package ships independently of the Charuy product version.
- Land in 6–7 sessions, each session shippable on its own (incremental migration, no big-bang rewrite).

## Non-goals

- **Cross-repo framework consumption.** Wiring for other repos importing `noldor` stays out of scope. Path remains open structurally but no consumer-side work this FD.
- **Standalone framework documentation site.** Trees stay markdown-in-repo; no docs site generator.
- **Legacy redirect shim.** Grep + commit-hash audit handles any external references; no symlinks from old paths to new.
- **Dashboard merge view** (single port showing both tracks). Two separate processes; merged view is post-MVP.

## Architecture

### Two parallel doc trees

```
docs/                              # Charuy product (root)
├── features/                      # product FDs only (~36)
├── roadmap.md, backlog.md         # product entries only
├── milestones/, vision.md
├── ideas.md                       # product ideas
├── superpowers/{plans,specs}/     # product plans/specs
└── release-notes.md               # product release notes

packages/noldor/docs/              # Framework (lifted)
├── features/                      # framework FDs (~29)
├── roadmap.md, backlog.md         # framework entries
├── milestones/, vision.md
├── ideas.md                       # framework ideas
├── superpowers/{plans,specs}/     # framework plans/specs
├── release-notes.md               # framework release notes
└── noldor/                        # framework process docs (already template-managed via init --update)
```

`packages/noldor/templates/docs/noldor/*.md` remains the source-of-truth for the _consumer-facing_ `docs/noldor/*` process pages (synced to consumers via `pnpm noldor init --update`). That's unchanged.

### Categorisation heuristic

Each FD classifies as **framework** when **both** hold (AND, not OR):

1. `area: tooling` in frontmatter.
2. `slug` (canonical) OR `name` matches the regex `^(dashboard|noldor|gate|release|triage|sdd|framework|doc|fd)-`.

The two clauses are joined by AND — the `area: tooling` guard is mandatory. Without it, a product feature accidentally named `auto-save` would mis-classify; the guard blocks that.

**Tie-breaker** (when `slug` and `name` would classify differently): `slug` wins. The slug is the canonical identifier (filename stem); `name` is the human-readable label and can drift over time. The classification script reads slug first; only falls back to `name` when slug fails to match.

**Regex prefix audit (2026-05-28):** Counted matches across the 29 known framework FDs:

| Prefix       | Matched FD count | Sample slug                                                      |
| ------------ | ---------------- | ---------------------------------------------------------------- |
| `dashboard-` | 5                | `dashboard-hot-zones-page`                                       |
| `release-`   | 3                | `release-script-self-provisions-its-own-session-marker`          |
| `framework-` | 2                | `framework-pr-flow-agent-auto-merge`, `framework-doc-extraction` |
| `gate-`      | 1                | `gate-flow-rework`                                               |
| `doc-`       | 1                | `doc-gardening-skill`                                            |
| `fd-`        | 1                | `fd-prs-since-last-release-section`                              |
| `sdd-`       | 1                | `sdd-co-tag-detector`                                            |
| `triage-`    | 1                | `triage-scoring-rubric-effort-impact-confidence-dependency`      |
| `noldor-`    | 1                | `noldor-package-lift`                                            |

Remaining ~14 framework FDs (e.g. `architecture-invariants`, `autonomous-plan-to-pr-merge`, `decouple-milestones-from-semver`, `parallel-worktree-workflow`, `replace-roadmap-buckets-with-flat-priority-order`) fall through to **manual review** at Phase 0 because their slugs don't prefix-match. This is expected — the regex catches the high-density prefixes; `ambiguous.txt` catches the rest.

**Prefixes considered but excluded** (YAGNI — kept out until first match appears, regex is a one-line edit later):

- `auto-` — `autonomous-*` slugs start with `autonomous-`, not `auto-`. No current FD matches `^auto-`.
- `garden-` — no current matches; framework garden FDs use `doc-gardening-*` or `garden-and-drift` (drift detector). Add when first `garden-` slug lands.
- `specs-` — no current matches.

Else **product**. Ambiguous (mixed signals) → manual review at Phase 0.

Same heuristic applies to roadmap/backlog/ideas entries via their `area:` field and slug prefix.

### Independent release semver

- `packages/noldor/package.json` owns the framework semver (currently `0.0.0`; first independent bump on Phase 6 lands).
- Root `package.json` keeps product semver.
- `pnpm release --track framework|product` selects which track bumps. Each track owns its own CHANGELOG and release-notes.
- Trade-off accepted: two release scripts (or one with a track switch) and a version-skew matrix during CI. Mitigation: spec records a fallback path — shared semver + separate changelogs — if Phase 6 decoupling proves too disruptive.

#### Intra-repo workspace consumption (`workspace:*` interplay)

Product code today imports `noldor` via the pnpm workspace catalog. Two questions arise after decoupling: how does the product `package.json` pin `noldor` at release time, and does releasing one track force a bump of the other?

**Context:** Root `package.json` is `"private": true` — Charuy product is never published to a registry. It exists as the deployable web/desktop app and consumes `noldor` only intra-repo. Therefore there is no "publish-time rewrite" concern on the product side; `workspace:*` is purely an install-time resolution rule.

**Rule (intra-repo, this monorepo):** Product `package.json` keeps `"noldor": "workspace:*"` always. Workspace protocol resolves at install time (`pnpm install`) to the version currently in `packages/noldor/package.json`. No manual pin updates ever. Therefore:

- **Framework-only release** (`pnpm release --track framework`) bumps `packages/noldor/package.json` + cuts `noldor@<v>` for cross-repo consumers. Product `package.json` stays unchanged; the next `pnpm install` in the product workspace transparently picks up the new framework version.
- **Product-only release** (`pnpm release --track product`) bumps root `package.json` + tags a Charuy product release. Ships against whatever framework version `packages/noldor/package.json` carries at that moment.
- **Coordinated release** (rare, e.g. coupled breaking change): operator runs framework first, then product. Two PRs, two version bumps, single coordinated landing.

**Rule (cross-repo, future consumers):** Other repos consuming `noldor` as a published npm package pin via standard semver (`"noldor": "^0.x.y"`). `pnpm publish` of the framework package rewrites any internal `workspace:*` dependencies to the resolved version at publish time (standard pnpm behaviour). Consumers run `pnpm noldor init --update` to refresh their `docs/noldor/` template tree on each upgrade.

**Trade-off:** `workspace:*` means a framework patch always reaches the product tree at the next install, even when no product release happens. Desirable for development velocity (`pnpm dev` always builds against latest framework) and acceptable for release-time semantics (product release notes mention any framework bump that is behaviourally observable).

### Data-layer parametrisation

Every reader / validator / detector that today hard-codes `docs/features` (or sibling paths) gains an explicit `rootDir` argument. A new `loadDocRoots(): string[]` helper returns `[productRoot, frameworkRoot]` (and tolerates the framework root being absent, for downstream consumers that haven't extracted yet).

Concrete touch list (non-exhaustive):

- `packages/noldor/src/dashboard/data.ts` — `loadSddFeatures(rootDir)`, `readFile('docs/...')` → parametrised.
- `packages/noldor/src/garden/garden-detect.ts` and detector modules under `scripts/garden/detectors/` — iterate both roots.
- `packages/noldor/src/features/validate-features.ts` — accept `rootDir`, default to product.
- `scripts/hooks/noldor-validate-trailer.ts` — search both `docs/features/` and `packages/noldor/docs/features/` for `Noldor-FD:` trailer scope.
- `packages/noldor/src/triage/*` + `/promote` skill — `--track` arg; default = prompt.
- `packages/noldor/src/dashboard/server.ts` — `--track framework|product|all`.

## Phase breakdown

Each phase ships on its own branch, lands behind its own PR, leaves the tree green for normal operations. Phases listed in execution order.

### Phase 0 — Inventory & classification

**Goal:** Authoritative list of framework vs product FDs / roadmap entries / backlog entries / ideas / plans / specs. Zero file moves.

**Deliverables:**

- `packages/noldor/scripts/migration/classify-feature-track.ts` — classifies each `docs/features/*.md`, each roadmap/backlog schema-C block, each plan/spec by area+name regex. Emits `framework.txt`, `product.txt`, `ambiguous.txt`, `cross-tree-links.txt` to `.noldor/classification/`.
- Why `packages/noldor/scripts/migration/` (not `packages/noldor/src/`): migration scripts are operator tools, not framework runtime code. Placing them under `src/` would ship them to consumers via `pnpm publish` (everything under `src/` is in the package payload by default). The `scripts/` sibling stays outside the publish boundary. Same placement for Phase 2 (`move-feature.ts`) and Phase 3 (`split-roadmap.ts`). Belt-and-suspenders: `packages/noldor/package.json` gains the standard `"files"` field (npm-publish allowlist) during Phase 6 listing only publishable paths (e.g. `["dist", "bin", "templates", "README.md"]`); `scripts/migration/` and `docs/` are implicitly excluded. Consumers receive framework docs via `pnpm noldor init --update` syncing the `templates/docs/noldor/` tree, not through the npm tarball — so excluding `docs/` from publish is intentional.
- **`.noldor/.gitignore` whitelist additions (exact lines, appended to existing whitelist):**

  ```
  !classification/
  !classification/framework.txt
  !classification/product.txt
  !classification/ambiguous.txt
  !classification/cross-tree-links.txt
  ```

  (Pattern follows the existing `!.gitignore`, `!rollout-marker`, `!config.json` whitelist style. The classification directory needs both the dir-name unignore and per-file unignore because nested ignore re-applies inside an unignored directory.)

- Manual review of `ambiguous.txt` (operator edits the file inline; each ambiguous entry gets a `track: framework|product` decision).
- Cross-tree link audit: for each framework FD, check every `deps:` slug, every body `[[link]]`, every `links.spec` / `links.code` / `links.tests` entry. Output `cross-tree-links.txt` flagging any links that would cross tree boundaries post-split.
- Commit classification files so Phase 2 + later phases consume from a fixed snapshot. Files are intentionally ephemeral — they cease to be useful once Phase 6 lands; a follow-up task removes them and the whitelist entries.

**Done when:** Both `.txt` lists exist, sum to total FD count, `cross-tree-links.txt` reviewed.

### Phase 1 — Pkg doc home + data-layer parametrisation

**Goal:** Create empty framework tree. Parametrise every reader / detector / validator. Zero file moves of substantive content.

**Deliverables:**

- Scaffold `packages/noldor/docs/{features/,roadmap.md,backlog.md,milestones/,superpowers/{plans,specs}/,release-notes.md}/` — empty or with placeholder frontmatter. **Intentionally skip `vision.md` and `ideas.md` at this phase** — these are scheduled for `git mv` in Phase 4 to preserve history; scaffolding empty files here would force Phase 4 to either fail or overwrite the scaffold. The two skipped files are tracked in a Phase 4 prerequisite check.
- `loadDocRoots()` helper in `packages/noldor/src/lib/`.
- Refactor `dashboard/data.ts`, garden detectors, validators, hook scripts to accept `rootDir`. Behaviour-preserving: defaults route to product root (existing behaviour).
- `noldor doctor` learns to validate dual-tree presence and emits no false drift when framework tree is empty.
- Pre-commit `Noldor-FD:` trailer scope check searches both feature dirs.

**Done when:** All tests pass, `pnpm noldor doctor` green, dashboard renders identically to today. Empty-root tolerance verified: with `packages/noldor/docs/features/` empty, every reader/validator/detector emits zero false-drift and zero crashes (an empty framework root must be indistinguishable from an absent one).

### Phase 2 — Move framework FDs

**Goal:** `git mv` ~29 framework FDs into `packages/noldor/docs/features/`. Behaviour: dashboard, garden, validators continue to work over both trees.

**Deliverables:**

- `packages/noldor/scripts/migration/move-feature.ts` reads `framework.txt`, performs `git mv` for each entry. Idempotent (skips already-moved entries). Dry-run by default; operator runs `--apply` after classification review.
- For each moved FD, verify `links.code` / `links.tests` paths remain valid (they are repo-root-relative, no change required).
- **Cross-tree link resolution policy:** default = **inline downgrade**. `move-feature.ts` performs the rewrite for files moving in Phase 2 (FD MD frontmatter `deps:`, `links.spec/code/tests`, and FD body `[[…]]`). Plan and spec body links are out of scope at Phase 2 (those files don't move yet) and handled at Phase 4 by a separate pass in `split-roadmap.ts`'s sibling (`move-plans-specs.ts`, scaffolded in Phase 4). `docs/sdd-report.md` is regenerated wholesale by `pnpm sdd:report` after the migration; no script touches its body links directly. The two opt-out paths — parent FD move or extended dual-root resolver — are explicit operator overrides, recorded by editing `cross-tree-links.txt` before `--apply`. Default behaviour is deterministic and re-runnable.

  **File / field scope by phase:**

  | Phase | File class              | Fields rewritten                                                 |
  | ----- | ----------------------- | ---------------------------------------------------------------- |
  | 2     | FD MD (moving)          | `deps:`, `links.spec`, `links.code`, `links.tests`, body `[[…]]` |
  | 2     | FD MD (staying)         | `deps:` references to moved FDs (downgraded inline)              |
  | 4     | Plan / spec MD (moving) | body `[[…]]`, frontmatter `track:` added                         |
  | 4     | `ideas.md` (post-split) | bullet text references                                           |
  | 6     | `docs/sdd-report.md`    | regenerated via `pnpm sdd:report`, not edited                    |

- Update `docs/sdd-report.md` and any `pnpm noldor sync fd-resources` outputs.
- Re-run garden + validators; expect green.

**Done when:** `git ls-files docs/features/ | wc -l` matches product-only count; framework FD count matches `packages/noldor/docs/features/`.

### Phase 3 — Split roadmap + backlog

**Goal:** Each schema-C block lives in exactly one of `docs/{roadmap,backlog}.md` or `packages/noldor/docs/{roadmap,backlog}.md`.

**Deliverables:**

- `packages/noldor/scripts/migration/split-roadmap.ts` — moves framework schema-C blocks from `docs/roadmap.md` → `packages/noldor/docs/roadmap.md`. Preserves priority order within each tree. Same for backlog.
- `/triage` and `/promote` skills gain `--track framework|product`. Default behaviour: if a single track is unambiguous from area+name, use it; else prompt.
- `pnpm noldor next-priority` reads both trees, merges, sorts by priority across tracks. **Data-layer change only:** each entry in the returned JSON gains a `track: framework|product` field derived from which tree the entry was read from. CLI `--track` filter optional.
- **No `/gate` UX change at this phase.** Phase 6 (skill wiring) is the phase that actually consumes the new `track:` field in the gate Step 0 bucket dialog. Phase 3 just makes the data available; Phase 6 surfaces it.

**Done when:** Sum of priorities across both roadmaps = sum before split. No duplicate slugs across trees.

### Phase 4 — Plans + specs + ideas + vision

**Goal:** Framework plans/specs live in `packages/noldor/docs/superpowers/`. Framework ideas in `packages/noldor/docs/ideas.md`. Framework vision in `packages/noldor/docs/vision.md`.

**Deliverables:**

- Move framework plans/specs by FD parent: every spec/plan whose owning FD now lives in `packages/noldor/docs/features/` moves with it.
- Each moved spec/plan gains frontmatter `track: framework` as belt-and-suspenders against future location drift.
- `ideas.md` splits two-way using the same area+name heuristic; remaining product ideas stay at root.
- **`vision.md` mechanism:** Prerequisite check confirms `packages/noldor/docs/vision.md` does NOT exist (Phase 1 deliberately skipped it). Then `git mv docs/vision.md packages/noldor/docs/vision.md` — full history follows the framework path (the framework vision is the more interesting half to preserve historically). Then inline-prune product-only content from `packages/noldor/docs/vision.md`. Finally re-author a fresh `docs/vision.md` for the product track. Asymmetric history is accepted: framework keeps the diff lineage, product starts fresh.
- **`ideas.md` mechanism:** Same shape as vision.md, but `ideas.md` is bullet-flat (no headings to prune-around), so the script-driven version is cleaner. Step 1: prereq check `packages/noldor/docs/ideas.md` absent. Step 2: `git mv docs/ideas.md packages/noldor/docs/ideas.md` — full history under framework path. Step 3: a small migration script (`packages/noldor/scripts/migration/split-ideas.ts`) reads each bullet, classifies it via the same `area:` / slug-prefix heuristic, partitions into `framework` (stays in `packages/noldor/docs/ideas.md`) and `product` (extracted to a new `docs/ideas.md`). Ambiguous bullets stay in the framework file with a `[needs-classification]` inline tag (operator resolves manually). The product `docs/ideas.md` is a fresh file — no git history. Trade-off: framework-track keeps history, product-track starts fresh. This matches the project-tracking-dashboard memory that ideas are an ephemeral "parking lot" so history loss on the product side is acceptable.
- `/gate` end-of-flow PR-flow reads spec/plan paths from FD `links.spec`; no change needed beyond Phase 2's link-update pass.

**Done when:** `find docs/superpowers/specs -name '*.md' | xargs grep -l 'track: framework' | wc -l` = 0. `find packages/noldor/docs -name '*.md' | xargs grep -l 'track: product' | wc -l` = 0.

### Phase 5 — Two dashboards

**Goal:** Operator can run a framework-only or product-only dashboard.

**Deliverables:**

- `pnpm noldor dashboard server --track framework|product|all` (default: `product` for backwards-compat).
- Different ports per track: 5173 product, 5174 framework. `--all` runs both processes.
- Page templates already render generic schema-C blocks; only data layer needs the new `rootDir` arg (already done in Phase 1).
- Dashboard URL bar shows `[framework]` or `[product]` chip so the operator knows which track they're viewing.

**Done when:** Both ports serve unique track data; cross-clicking a feature link respects the originating track's root.

### Phase 6 — Release decoupling + skill wiring

**Goal:** `noldor` package ships independently. All skills understand dual-track context.

**Deliverables:**

- `pnpm release --track framework|product`. Each track owns its own changelog, semver, release-notes.
- `release-markers.ts:fillMarkers` reads track from FD location; writes `introduced:` against the track's package version.
- `release-sweep` skill prompts for track at session start. Sweep runs detectors against the chosen track only.
- `.claude/CLAUDE.md` updated to point operators at the new tree.
- `packages/noldor/templates/docs/noldor/workflow.md` documents track-aware flows; `pnpm noldor init --update` syncs to consumer.
- Skills updated: `gate`, `garden`, `promote`, `triage`, `release-sweep` all accept track context. Per-skill acceptance criteria:
  - **gate** — Step 0 next-priority reads both roadmaps and surfaces `track:` annotation in bucket question. New-FD paths (`full-new`, `specs-only-new`) prompt for track; default = inferred from category. Session marker gains optional `track:` field.
  - **garden** — `garden-detect` runs detectors per-root via `loadDocRoots()`. CLI gains `--track framework|product|all` (default `all`). Findings tagged with originating track.
  - **promote** — accepts `--track`; reads schema-C block from the matching roadmap; scaffolds FD into the matching `features/` dir.
  - **triage** — `--track` flag picks target file (`docs/backlog.md` or `packages/noldor/docs/backlog.md`). Default = inferred from `area:`; ambiguous bullets prompt.
  - **release-sweep** — prompts for track at session start; runs `graphify` / `refactor` / `release` against the chosen track's tree only.
- Classification cleanup: `git rm -r .noldor/classification/` (untracks the four files that were whitelisted at Phase 0) and revert the whitelist additions in `.noldor/.gitignore`. Single commit, both changes together so the gitignore + git-rm stay in sync. The Phase 0 ephemeral artifacts have served their purpose by Phase 6 close.
- First independent framework version cut (e.g. `noldor@0.1.0`) at Phase 6 close.

**Done when:** `pnpm release --track framework` and `pnpm release --track product` both run cleanly without crossing trees. `noldor@<v>` publishable. All five skill acceptance criteria pass manual smoke test (one happy-path invocation per skill against each track).

**Fallback (if Phase 6 decoupling proves too disruptive):** Ship Phase 6 as "shared semver + separate changelogs". Both tracks bump together but produce two release-notes files. Smaller win, ships faster, preserves cross-repo path for a future FD.

## Risk register

| Risk                                                            | Mitigation                                                                                                          | Phase |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----- |
| Cross-tree links break `deps:` resolution                       | Phase 0 audit; Phase 2 default policy = inline downgrade (deterministic); operator overrides recorded inline        | 0, 2  |
| Garden detectors hard-code `docs/features` → false drift        | Phase 1 `loadDocRoots()` parametrisation; detectors loop both                                                       | 1     |
| `noldor doctor` validators single-tree → false drift            | Phase 1 `--track` arg; iterate both by default                                                                      | 1     |
| Pre-commit `Noldor-FD:` trailer scope rule misses framework FDs | Phase 1 teach validator to search both feature dirs                                                                 | 1     |
| Cross-tree slug collision (same slug as framework + product FD) | Inventory script (Phase 0) flags collisions; manual rename of one before move                                       | 0     |
| Release semver coupling resolution drifts                       | Phase 6 first deliverable = decision doc; fallback path documented in this spec                                     | 6     |
| Operators confused which tree to use mid-migration              | Each phase shippable on its own; tests stay green; classify-feature-track.ts emits guidance comments in moved files | all   |

## Test strategy

- **Unit** — each parametrised reader / validator gets a test that passes `rootDir = framework` and asserts no leakage from `rootDir = product`.
- **Integration** — Phase 1 adds a fixture pair (`fixtures/dual-tree/`) representing a minimal dual-tree repo. Garden + dashboard + doctor all run against it.
- **Smoke** — after each phase, run `pnpm test`, `pnpm noldor doctor`, `pnpm dashboard` boot, `pnpm release --dry-run` against both tracks (Phase 6 only).
- **Migration safety** — Phase 2's `move-feature.ts` is idempotent + dry-run by default. Operator runs `--apply` once classification is reviewed.

## Open questions (resolved)

- **Release semver coupling:** **Independent** (decided 2026-05-28). Phase 6 owns the script split. Fallback path = shared semver + separate changelogs.
- **Intra-repo `workspace:*` interplay:** Product `package.json` keeps `workspace:*`; framework bumps auto-propagate at next install; release-time pin baked at publish (see Architecture § Intra-repo workspace consumption).
- **Cross-tree link default policy:** **Inline downgrade** (machine link → plain-text mention). Deterministic + re-runnable. Operator overrides recorded in `cross-tree-links.txt`.
- **Categorisation tie-breaker:** Manual review wins. `ambiguous.txt` is the authoritative single point of operator decision per FD.
- **Categorisation guard:** Rules joined by AND (`area: tooling` mandatory). Slug-only match without the area guard is rejected.
- **Dashboard merge view:** Out of scope. Two processes per Section 1.
- **Migration-script home:** `packages/noldor/src/migration/` (with framework code), not repo-root `scripts/`.

## Resources

- [memory: project_framework_doc_extraction](../../../../../.claude/projects/-Users-davidzoufaly-code-3d/memory/project_framework_doc_extraction.md) — locked decisions
- [feature MD](../../features/framework-doc-extraction.md)
- [project_ultimate_vision memory](../../../../../.claude/projects/-Users-davidzoufaly-code-3d/memory/project_ultimate_vision.md) — agent-first reusability path
- PR #54 (`refactor(noldor): rename src/noldor/ to src/core/`) — prerequisite shipped 2026-05-28
