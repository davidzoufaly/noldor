# Release Notes

## v0.3.0 — 2026-06-11

### Tooling

#### Architecture Invariants *(updated)*

Four commit-blocking architecture invariants enforced at pre-commit, with advisory mirror in `/garden`:

[Feature page](/features/architecture-invariants)

#### Autonomous Queue-Drain Runner

An external supervisor that drains the roadmap's fast-track (XS/S) queue autonomously — spawning a fresh `claude --print "/gate --drain <slug>"` per entry, one auto-merged PR at a time, with retry-then-skip, a concurrency lock, and a per-iteration timeout. Each feature runs in a clean context, so always-clear is preserved without a human between features.

[Feature page](/features/autonomous-queue-drain-runner)

#### Dashboard Hot Zones Page

Top-N most-changed files in the last D days surfaced on the project tracking dashboard at `/hot-zones`. Single git call (`git log --since=Nd --no-merges --name-only`), in-process aggregation, lockfile + generated paths excluded, feature MDs cross-referenced via `links.code`. Where churn lives, bugs follow — points refactor and review attention at the right files.

[Feature page](/features/dashboard-hot-zones-page)

#### Dashboard Vision Surface

Surface `docs/vision.md` in the project-tracking dashboard. The `/` overview now opens with a milestone banner pulling `current-milestone` + `goal` from vision frontmatter (with a `read vision →` link) so every other panel renders against the strategic frame. A new `/vision` page renders the full vision body — frontmatter table on top, rendered markdown below — using the same per-request file-read + `marked` render path as the feature drill-down. Nav gains a `Vision` link between Overview and Roadmap.

[Feature page](/features/dashboard-vision-surface)

#### Dashboard WIP Age Page

For each `phase: in-progress` feature, compute days since the feature MD was first committed via `git log --diff-filter=A --format=%ct -- docs/features/<slug>.md`. Bucket each row as `fresh` (<7d), `aging` (7-13d), or `stale` (≥14d). Catches stalled work — `phase: in-progress` in FD frontmatter is the canonical signal (the roadmap carries no in-progress tracker; the `## Now / ## Next / ## Later` section split was retired 2026-05-13 in favor of a flat priority list).

[Feature page](/features/dashboard-wip-age-page)

#### Dashboard Worktree Health Page

Surface `pnpm worktree:status` output as a page — tree path, branch, port, drift, dirty, file-overlap warnings. Critical now that parallel-worktree-workflow shipped; running the script is fine, viewing it in-browser alongside the rest of project state is better.

[Feature page](/features/dashboard-worktree-health-page)

#### Feature MD Links Overhaul

Cleans up the `links.*` fields on feature MDs so `pnpm sdd:report` produces actionable signal instead of 90+ lines of noise. Five coupled changes shipped:

[Feature page](/features/feature-md-links-overhaul)

#### Parallel Drain

Generalizes the autonomous drain supervisor from sequential (one feature at a time) to K-concurrent via `--concurrency N`: up to N features build in parallel, each in its own worktree and its own PR, while merges are serialized through a single coordinator so `main` never sees an N-way conflict. `--concurrency 1` (default) is byte-for-byte today's sequential drain; concurrency is opt-in.

[Feature page](/features/parallel-drain)

#### Parallel Worktree Workflow

Tooling and rules for running up to three concurrent git worktrees on independent features. Adds `pnpm worktree:status` (status table + drift / overlap / cap warnings + auto port allocation in `5174-5179`), a lefthook pre-commit gate that blocks edits to shared root files from inside `.worktrees/`, a one-line `apps/web/vite.config.ts` change to honour `PORT` from `.env.local`, and a CLAUDE.md subsection codifying the parallel-worktree workflow.

[Feature page](/features/parallel-worktree-workflow)

#### Plan-Runner — Autonomous Plan Executor

Release-notes prose (write normal — doc artifact):

This release adds a parallel prep pipeline to the noldor CLI, introducing fanout drafts together with a promote bridge (#30).

[Feature page](/features/plan-runner)

#### Project Tracking Dashboard

Internal-only browser dashboard for project tracking. Live Node server reads filesystem per request — feature MDs (counts, drill-down with frontmatter table + rendered markdown body), roadmap (Now/Next/Later, full block detail with name + category + area + type badge + since + paragraph per entry), backlog (full block detail with name + area + type badge + since + paragraph), SDD gaps (13 detector categories including spec/plan orphans, plans without spec, features without spec), plus filesystem-derived counts (skills, scripts) and realtime git velocity stats (commits 7d/30d/90d, by type, by scope, releases timeline), and a test-pyramid page (per-module source/test/case counts with test-to-code ratio, worst-covered modules first). Overview KPIs split into Project / Activity / Health sections, with Health surfacing stale WIP and worktree drift. Routes (`/`, `/roadmap`, `/backlog`, `/features`, `/features/:slug`, `/gaps`, `/velocity`, `/hot-zones`, `/wip-age`, `/test-pyramid`, `/worktrees`) with querystring filters. Implemented as a single tsx script in `scripts/dashboard/`. Zero hardcoded data — HTML shell + per-request renders. Promoted 2026-05-04 once read-only project visibility outgrew the markdown SDD report.

[Feature page](/features/project-tracking-dashboard)

#### Release Script `sdd:report` Skip-If-Only-Count-Line-Changed

`src/release/index.ts` runs `pnpm noldor garden sdd-report --release` and aborts when `docs/sdd-report.md` is dirty. But `sdd:report` is not idempotent: the `Review-skip count (last 30 days)` line increments by 1 per commit on the active branch (each sweep commit lacks `Noldor-Reviewed` and counts as a review-skip). Even when `/release-sweep` step 5.5 pre-emptively commits the regen, the release-time re-run always produces a +1 diff and aborts. Discovered 2026-05-17 during `release-sweep-process-hardening` part 2 plan execution (idempotency verification failed). Two fix candidates: (a) release-script treats "only the review-skip count line changed" as clean and proceeds; (b) `sdd:report` gains a flag to exclude in-flight branch commits from the count. Until shipped, the release operator hits a single sdd:report-driven retry on the first `pnpm release` after sweep PR merge.

[Feature page](/features/release-script-sddreport-skip-if-only-count-line-changed)

#### Scripts Reorganization By Feature/Area

Reorganized `scripts/` from a flat ~50-file directory into per-feature subdirectories: `release/`, `sync/`, `docs/`, `checks/`, `garden/`, `triage/`, `features/`, `worktrees/`, `graphify/`, `utils/`, `samples/` plus the existing `dashboard/`. Tests moved alongside source (`<group>/__tests__/`). The orchestrator `scripts/release.ts` became `scripts/release/index.ts`. All `package.json` script paths and FD MD `links.code` references updated. Lefthook config unchanged because it routes through `package.json` scripts.

[Feature page](/features/scripts-reorganization-by-feature-area)

#### SDD Co-Tag Detector

13th SDD detector flagging tests whose `// @tests:` tag list is incomplete given the FDs that own the source files the test imports. Today silent: `sample-gallery.spec.ts` tagged only `sample-scene-gallery` despite exercising `empty-scene-state`; `tree.test.ts` tagged only `zod-scene-schema` despite covering `group-node`; engine tests tagged only their primary FD without `manifold-wasm-integration`. Detector reads `graphify-out/graph.json` `imports_from` edges (graphify v0.7.8+, with the v0.4.20 path-normalization fix), maps target source files to owning FDs via `links.code`, diffs against declared tags. Staleness gate: graph mtime vs MAX(mtime) of `packages/ apps/ scripts/`; on stale, emits one meta-gap with regen instructions. Substrate (`loadFreshGraphOrWarn`, `buildFileToFdsMap`, `getFdOwnersForFile`) lives in `scripts/garden/graph-fd-lookup.ts`; reused by detectors 9 and 10 below.

[Feature page](/features/sdd-co-tag-detector)

#### Trailer Scope-Alias Map

`scripts/garden/detectors/trailer-scope-mismatch.ts` rejects commits where the Conventional Commits scope doesn't equal (or end with `:`) the `Noldor-FD:` slug. v0.4.0 release surfaced 24 such mismatches: `feat(sdd):` commits tagged to FD `sdd-co-tag-detector`, `feat(cr):` commits tagged to FD `noldor`, etc. — the team has informally adopted shorter scope tokens. Required `RELEASE_SKIP_GATE_COMPLIANCE=1` bypass. Fix: add a config-driven alias map (`scope-aliases.json` or detector frontmatter) where `sdd → sdd-co-tag-detector`, `cr → noldor`, etc., so the detector accepts the team's actual usage instead of demanding artificial scope expansion.

[Feature page](/features/trailer-scope-alias-map)

## v0.2.0 — 2026-06-01

### Tooling

#### Framework Doc Extraction

Extracted the Noldor framework from the Charuy monorepo into its own standalone repository (`github.com/davidzoufaly/noldor`), preserving per-file git history via `git filter-repo`. Charuy now consumes Noldor as a `file:../noldor` sibling dependency, and all framework artifacts (FDs, roadmap, backlog, plans, specs, vision) live in this repo's `docs/`. Delivered across Phase A (de-Charuy-fication of the runtime), Phase B (doc staging), and Phase C (extract + retarget).

[Feature page](/features/framework-doc-extraction)

#### How-To Index Pipeline

Generates `docs/user/how-to/index.md` from the frontmatter of every how-to MD under `docs/user/how-to/`. Each how-to declares validated frontmatter (`howtoFrontmatterSchema` — `category` constrained to the shared `CATEGORIES` enum); the pipeline parses them, groups by category, and renders an index whose bullets pair each guide's title with its first body paragraph as a one-liner. Run via `pnpm noldor docs howto`. Empty input degrades to a `_No how-to guides yet._` placeholder rather than an empty file.

[Feature page](/features/howto-index-pipeline)

#### Noldor Package Lift

The framework is now lifted into a dedicated `packages/noldor` workspace package (#53).

[Feature page](/features/noldor-package-lift)
