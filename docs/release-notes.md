# Release Notes

## v0.5.1 — 2026-07-11

### Tooling

#### `/noldor-triage` Scoring Rubric (effort × impact × confidence × dependency)

Replace the now/next/later bucket heuristic in `/noldor-triage` with a derived integer score from an `effort × impact × confidence × dependency-weight` matrix. Effort = build cost (S/M/L or 1-5; mirrors existing `- size:` field). Impact = user usefulness / strategic value (mirrors existing `- impact:` field). Confidence = how sure we are about effort + impact at triage time. Dependency-weight discounts items blocked on unshipped work. `/noldor-triage` proposes the score, operator confirms; the score feeds priority — either ordering the file directly (current Path 1 convention) or filling the explicit `- priority:` field if Path 2 lands. Folds in the former `Multi-Factor Triage Value Scoring` entry (was `## Later → Tooling`, since 2026-04-28, dropped on 2026-05-11 fold).

[Feature page](/features/triage-scoring-rubric-effort-impact-confidence-dependency)

#### Dashboard Roadmap/Backlog View Polish

Bundle of five polish items on the dashboard `/roadmap` and `/backlog` surfaces — surfacing size + impact columns, surfacing category on backlog, auto-scrolling during drag-and-drop, truncating long descriptions with click-to-expand, and unifying filter apply-on-change vs apply-button behavior.

[Feature page](/features/dashboard-roadmap-backlog-polish)

#### Framework PR Flow + Agent Auto-Merge

Add first-class PR support to Noldor: feature work on a worktree branch lands via PR rather than direct merge to main. Agent-side question: can the controlling agent open the PR, run the CR pipeline (Claude + Codex), and auto-merge once green? Today merge is a manual operator step. Encode the GitHub PR flow in the framework (separate from `/noldor-gate`'s commit gating) and explore agent permissions for `gh pr create` + `gh pr merge --auto`. Pairs with the existing CR pipeline — review gate becomes the merge gate.

[Feature page](/features/framework-pr-flow-agent-auto-merge)

#### Noldor-Native Wait Primitive

Runner-agnostic alternative to the harness `Monitor` tool, consumer side only: `noldor wait <state-file> --until <terminal-cond> [--emit <jsonpath>]` that polls until a job reaches a terminal state and surfaces progress. Do NOT invent a new progress format — reuse the existing producer-side state files (`.noldor/drain-state.json` heartbeat, `.noldor/cr/<slug>-<kind>-<lane>.json` sinks). The "write one side / read other" channel already exists; the gap is a portable wait/poll the controller calls instead of the host harness's Monitor (which can be blocked + isn't cross-runner). Parked: background-task completion notifications already cover most waiting.

[Feature page](/features/noldor-native-wait-primitive)

#### Prefix Skills with noldor-

Prefix the framework's skill names with `noldor-` to namespace them and avoid collisions with consumer-side or vendored skills. Parked 2026-07-02, re-sized S→L: a 2026-06-13 drain attempt revealed this is a self-referential mega-rename — 9 unprefixed skills (`gate`, `garden`, `triage`, `promote`, `milestone`, `new-feature`, `draft-feature-md`, `refactor`, `release-sweep`) plus template twins, the drain's `gatePrompt` in `src/autonomous/drain-source.ts`, and back-compat aliases for consumer repos that already vendored the old names. Only `noldor-spec` / `noldor-plan` / `noldor-research` were born prefixed. Needs the full spec+plan path if picked up; never fast-track.

[Feature page](/features/prefix-skills-with-noldor)

#### Release-Sweep Process Hardening

Six-part overhaul of the pre-release sweep flow, surfaced during the v0.5.0 release where ~80% of operator time went into friction rather than the sweep itself. (a) **New `release-sweep` gate path** — add to `PATHS` in [src/core/session.ts](../../src/core/session.ts); allowlist `graphify-out/**`, `docs/sdd-report.md`, `docs/release-notes.md`, `docs/user/reference/api/**`, `docs/**/*.md`, `docs/superpowers/{plans,specs}/**`; multi-commit; auto-write session at skill start, auto-clear at end; skip Step 0 priority pickup. Replaces hand-written session marker + manual `Noldor-Path-Override` trailer on every sweep commit. (b) **Pre-empt release-script drift** — sweep step 6 runs `pnpm docs:build` + `pnpm sdd:report --release` and commits any drift before invoking release. Eliminates the 2 mid-release follow-up PRs the v0.5.0 sweep needed (broken-link drift + sdd-report regen drift). (c) **Path-Override trailer placement guardrail** — either `noldor-inject-trailers` moves `Noldor-Path-Override:` into the trailer block if found out-of-block, or `enforce-review-receipt` parses with `git interpret-trailers --parse` instead of regex on raw message. Closes the silent footgun where an override above `Co-Authored-By:` doesn't register. (d) **Auto re-stamp garden receipt** — release script auto-stamps at start when `garden:detect` was clean within a recent window; eliminates the manual 3× re-stamp loop after each follow-up PR merge. (e) **Garden manual-sweep detector smarter** — extend `garden-detect.ts` plan-staleness check to fall back to FD frontmatter `links.plan` and `graphify-out/graph.json` adjacency for multi-feature plans, infra plans, and `<parent>-partN` splits that today land in the manual sweep bucket (14 of 20 plans were unflagged in v0.5.0 sweep). (f) **Release-sweep skill automates PR-flow** — skill commits land on `release-sweep/<ts>` branch, pushed + auto-merged + ff-pulled before the release-confirmation prompt; folds the 4× manual temp-branch + PR dance into the skill.

[Feature page](/features/release-sweep-process-hardening)

## v0.5.0 — 2026-07-07

### Tooling

#### `pnpm release --resume`

Release-state persistence added so interrupted releases can resume (#132).

[Feature page](/features/pnpm-release-resume)

#### Agent-Events Phase Tracking, Run IDs and `/agents` Dashboard Page

Agent-event vocabulary now emits paired spawned/exited rows linked by a shared `spawnId` (#150).

[Feature page](/features/agent-events-phase-tracking-run-ids-and-agents-dashboard-page)

#### Dashboard Roadmap & Backlog Drag-and-Drop

Drag-and-drop UI on the dashboard's `/roadmap` and `/backlog` pages, plus per-row "Promote ↑" / "Demote ↓" buttons for cross-section moves. Sits on top of the shipped Path 1 schema (file-order = priority); does NOT introduce an explicit `- priority: <int>` bullet — the explicit-field path was considered and dropped in brainstorming. Dashboard server gains its first write surface: POST endpoints that rewrite `docs/roadmap.md` / `docs/backlog.md` with per-file atomic tmp+rename writes, protected by ETag / If-Match concurrency. Drag is enabled only when the table renders in source-file order (no filters, no non-priority sort); filtered/sorted views show dimmed handles with a tooltip pointing at the activation rule. Trigger: hand-editing priorities in markdown is the friction point most worth automating now.

[Feature page](/features/dashboard-roadmap-drag-drop)

#### Decouple Milestones from Semver

`docs/vision.md`'s `current-milestone: 1.0.0` ties milestone identity to semver. The two have different cadences: a milestone is a strategic gate ("public release with house-modeling agent"); semver tracks API/format compatibility. Conflating them forces premature version commitments and leaks strategic naming into the changelog. Proposal: introduce a separate milestone-naming taxonomy (codenames? phases?) and a new skill (`/milestone` or similar) for crafting milestone definitions independent of releases. Vision keeps a milestone reference; release notes keep semver. Trigger: live now — milestone vs version drift already confuses `/triage` decisions ("is this v1.0 or post-MVP?").

[Feature page](/features/decouple-milestones-from-semver)

#### Doc Gardening Skill *(updated)*

A `/garden` skill that bundles the recurring doc-cleanup pass into a single operator-confirmed checklist. Runs deterministic detectors (`src/garden/garden-detect.ts`) to surface stale superpowers plans, unused backlog entries, rule contradictions, SDD gaps, and architecture invariant violations, then executes safe auto-actions (archive, drop) on confirmation.

[Feature page](/features/doc-gardening-skill)

#### Framework Auto-Split Suggestion for Big Features and Plans

Added split-suggestion oversize heuristics covering E1-E3, F1, and P1 (#155).

[Feature page](/features/framework-auto-split-suggestion-for-big-features-and-plans)

#### Framework Script + Test Migration Cleanup

Audit `scripts/` and the framework's test corpus to identify scripts/tests that were only needed during migration (FD frontmatter shape changes, gate path additions, garden detector rollouts) and can now be deleted. Conversely, identify gaps where shipped framework features lack test coverage. The 2026-07 audit's cruft inventory is the shopping list: dead `cr-retry.ts`, `src/graphify-out/junk.ts` litter, empty `src/index.ts` as package main, duplicate semver impls (`src/migrations/semver.ts` vs npm `semver` in release), stale `packages/noldor/` + `scripts/release/` path comments (`src/core/consumer-config.ts:7`, `src/core/release-markers.ts:9`), `ideas.md` at repo root while `src/core/doc-roots.ts:28` expects `docs/ideas.md`. One-pass sweep — possibly a `/garden` detector that flags scripts referenced only in migration-era commits and not in any current pipeline.

[Feature page](/features/framework-script-test-migration-cleanup)

#### Gate Flow Rework

Three-part rework of `/gate` flow combining tightly coupled changes to the gate-step ordering. (1) Step 0 priority pickup checks in-progress FDs first (FDs with `phase: in-progress` in frontmatter); if none, surface a structured suggestion set: 3 top-of-roadmap entries + 2 small×high-impact entries (XS/S size, high/critical impact) + 1 milestone-aligned high-impact entry (matches `docs/milestones/<active>.md` gate criteria) + an explicit "other" / free-form option. Today Step 0 surfaces only the single top-of-roadmap entry, which biases against quick wins and milestone alignment. (2) Every non-`micro-chore` path requires explicit confirmation after the path picker (today `AskUserQuestion` selection is implicit OK — operator sees no "are you sure?" beat before the heavy scaffolding starts; `full-new` in particular kicks off `/promote` + worktree + spec brainstorm in sequence and is expensive to abort). (3) Move worktree creation BEFORE FD scaffold (today `/promote` or `/new-feature` runs first inside `/gate` Step 2, then the worktree — an aborted gate leaves an orphaned FD on main with no worktree to host follow-up work). Bundled into one FD because all three changes touch the same gate-step ordering and a single PR is cheaper than three independent reviews.

[Feature page](/features/gate-flow-rework)

#### Noldor Framework *(updated)*

Noldor is the Charuy-internal dev-loop framework extracted into a
dedicated `docs/noldor/` folder so the project-agnostic rules
(complexity gating, worktree discipline, /promote /triage /garden,
SDD audit, graphify integration, FD schema, doc & test conventions,
engineering principles) live separately from Charuy's product-specific
overlays. Tracked as a single FD with all 17 framework pages in
`links.docs`; per-page change history is recovered via
`pnpm noldor:changelog` walking commit scopes
(`noldor:<slug>` / `noldor`).

[Feature page](/features/noldor)

#### Parallel-Agent Dispatch for Research Jobs

Noldor can fan out parallel _build_ agents (the K-concurrent drain) but has no first-class primitive for fanning out parallel _read/research_ agents — codebase research, multi-subsystem investigation, cross-file audits, "understand X before we spec it." Today an operator (or a gate/spec/plan flow) investigates these sequentially in one context: wastes wall-clock and pollutes the driving session's context. Inspired by `superpowers:dispatching-parallel-agents` — dispatch one context-isolated subagent per independent problem domain, each with focused scope + self-contained context (never inherits session history) + a required structured return, then synthesize and integrate.

[Feature page](/features/parallel-agent-dispatch-for-research-jobs)

#### Portable Gate Entrypoint for Non-Claude Runners

This release adds the `promptDispatch` runner capability (#151).

[Feature page](/features/portable-gate-entrypoint-for-non-claude-runners)

#### Project Tracking Dashboard *(updated)*

Internal-only browser dashboard for project tracking. Live Node server reads filesystem per request — feature MDs (counts, drill-down with frontmatter table + rendered markdown body), roadmap (Now/Next/Later, full block detail with name + category + area + type badge + since + paragraph per entry), backlog (full block detail with name + area + type badge + since + paragraph), SDD gaps (13 detector categories including spec/plan orphans, plans without spec, features without spec), plus filesystem-derived counts (skills, scripts) and realtime git velocity stats (commits 7d/30d/90d, by type, by scope, releases timeline), and a test-pyramid page (per-module source/test/case counts with test-to-code ratio, worst-covered modules first). Overview KPIs split into Project / Activity / Health sections, with Health surfacing stale WIP and worktree drift. Routes (`/`, `/roadmap`, `/backlog`, `/features`, `/features/:slug`, `/gaps`, `/velocity`, `/hot-zones`, `/wip-age`, `/test-pyramid`, `/worktrees`) with querystring filters. Implemented as a single tsx script in `scripts/dashboard/`. Zero hardcoded data — HTML shell + per-request renders. Promoted 2026-05-04 once read-only project visibility outgrew the markdown SDD report.

[Feature page](/features/project-tracking-dashboard)

#### Registry Distribution for the Noldor Package

Added a `release.publish` config block that ships default-off for consumer safety (#139).

[Feature page](/features/registry-distribution-for-the-noldor-package)

#### Release Bypass Retirement

Added a `release.crGateExemptCommits` config schema (#133).

[Feature page](/features/release-bypass-retirement)

#### Replace Roadmap Buckets with Flat Priority Order

Drop the `## Now / ## Next / ## Later` section split from `docs/roadmap.md` in favor of a single flat priority-ordered list. File order = priority already lives in `docs/noldor/triage.md:38`; the remaining buckets are vestigial — `## Now` is empty (the `/promote` skill suspended Now-entry creation per step 8 pending this restructure), and the Next/Later split duplicates milestone semantics that `vision.md`'s current-milestone field already carries. In-progress work is discoverable via `phase: in-progress` in FD frontmatter; milestone bucketing belongs in a future `milestone:` FD field (see `Framework Milestones Support` entry below).

[Feature page](/features/replace-roadmap-buckets-with-flat-priority-order)

#### Roadmap Priority Ordering

Add a framework-level priority for roadmap and backlog items: file-order = priority. Before the 2026-05-13 restructure (`replace-roadmap-buckets-with-flat-priority-order`) this FD shipped against per-section scopes (`## Now` / `## Next` / `## Later`) on the roadmap; that section split was later retired in favor of a single whole-file flat list. The current contract is: priority is whole-file (no sub-buckets), and cross-file moves between roadmap ↔ backlog are first-class and bidirectional (a backlog item promotes onto the roadmap, a roadmap item demotes back to the parking lot). The move preserves the body and re-derives priority from the new location.

[Feature page](/features/roadmap-priority-ordering)

#### Scan-Roots Repo-Paths Provider

Added a repo-paths provider exposing `scanRoots` and `actualPackageNames` (#144).

[Feature page](/features/scan-roots-repo-paths-provider)

#### Scope Sibling Trailer for Doc-Sync Commits

`noldor-scope` validation now accepts the `Noldor-Sibling-Scope` trailer (#158).

[Feature page](/features/scope-sibling-trailer-for-doc-sync-commits)

#### SDD Detector 5 — Idea-Merge Semantic Similarity

When `/triage` proposes targets for ideas in `ideas.md`, a `triage merge-candidates` CLI emits the full merge-candidate corpus — every FD, roadmap block, and backlog block — as structured JSON, and `/triage`'s LLM ranks the top-3 `merge:<slug>` hosts per idea and surfaces them in the confirmation table. Reduces hand-judgment burden in `/triage` and biases toward merging into existing host FDs (per CLAUDE.md `/triage` rubric). The original "semantic similarity via graphify / community labels" framing was dropped at spec time — graphify's AST graph carries no feature-level embeddings, and Noldor's offline/deterministic posture rules out an external embedding model; ranking is deterministic-corpus + in-skill LLM judgment, no embeddings or network (see the linked spec). Trigger: when next batch of ideas accumulates and triage feels noisy.

[Feature page](/features/sdd-detector-5-idea-merge-semantic-similarity)

#### Self-Boundaries Declaration and Cycle Break

refactor relocating repo config loader, review profiles, and stdin prompts out of `src/cr` (#156).

[Feature page](/features/self-boundaries-declaration-and-cycle-break)

#### Stable Entry IDs for Roadmap + Backlog

Introduces stable entry IDs (Q-NNNN) for roadmap + backlog (#157).

[Feature page](/features/stable-entry-ids-for-roadmap-backlog)

## v0.4.0 — 2026-07-01

### Tooling

#### Acceptance-Verify Lane

Autonomous paths merge on tests + CR. Both have a structural blind spot: the implementer agent writes the code _and_ the tests, so a misunderstood requirement produces tests that assert the misunderstanding — green suite, wrong feature. CR reads diffs and can ratify the same error. Nobody runs the artifact and checks it against what the FD/entry actually promised. Add a `verify` lane: an independent agent that boots the real artifact and judges the shipped behavior against the acceptance text.

[Feature page](/features/acceptance-verify-lane)

#### Bootstrap-Immunity for Self-Gating Features

This release adds bootstrap-immunity for self-gating features (#110), allowing features that gate themselves to bypass the gate during initial bootstrap.

[Feature page](/features/bootstrap-immunity-for-self-gating-features)

#### Code Reviewer 2.0

Added a review-profile schema along with built-in profiles (#98).

[Feature page](/features/code-reviewer-20)

#### Consumer-Contract CI and Headless Gate E2E Harness

Hermetic stub runner now register in agent registry (#99).

[Feature page](/features/consumer-contract-ci-and-headless-gate-e2e-harness)

#### De-Superpowers: Vendor Spec, Plan and Worktree Flows

The framework's core flows depend on the third-party `superpowers` Claude Code plugin. Four load-bearing uses: `superpowers:brainstorming` produces every spec (gate SKILL.md Steps for all spec paths), `superpowers:writing-plans` produces every plan, `superpowers:using-git-worktrees` does worktree creation, and — worst — `src/prep/draft.ts:18` bakes a "REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans" blockquote **into every generated plan**, so the dependency propagates into consumer repos at plan-execution time. Everything else is path naming (`docs/superpowers/specs|plans`). A consumer without the plugin cannot run the gate's spec/plan paths; an upstream plugin edit can silently change framework behavior. Vendor the flows.

[Feature page](/features/de-superpowers-vendor-spec-plan-and-worktree-flows)

#### Drain Startup Reconciliation of a Prior Dead Run

Reconcile a prior dead drain run at startup (#107).

[Feature page](/features/drain-startup-reconciliation-of-a-prior-dead-run)

#### Dynamic FD ↔ File Pointers via Frontmatter

feat tag parser for `// @fd:` code tags plus a slug→code map (#100).

[Feature page](/features/dynamic-fd-file-pointers-via-frontmatter)

#### Dynamic FD Changelog

Per-feature changelog now splits across two surfaces with no duplication. The FD body's `## Changelog` section holds only `### <version> > #### Summary` blocks (polished prose, written once at release time and rarely re-edited). The dashboard FD detail page injects everything else live: an `### Unreleased > #### Commits` block at the top, plus a `#### Commits` subsection under each released version, all sourced from a scope-filtered `git log` on every page render. `### Unreleased` is never written to FD bodies; `#### Commits` is never written either.

[Feature page](/features/dynamic-fd-changelog)

#### Feature MD Links Overhaul *(updated)*

Cleans up the `links.*` fields on feature MDs so `pnpm sdd:report` produces actionable signal instead of 90+ lines of noise. Five coupled changes shipped:

[Feature page](/features/feature-md-links-overhaul)

#### Framework Milestones Support (POC / MVP / 1.0.0)

feat: connect features to milestones across schema, garden, and dashboard (#108) — wire features to milestones spanning the schema, garden, and dashboard.

[Feature page](/features/framework-milestones-support-poc-mvp-100)

#### Graphify `plan-of` edges + nodes for plans/specs

fd nodes + plan-of/spec-of edges added to graph, plus graph-adjacency stale fallback (#109).

[Feature page](/features/graphify-plan-of-edges-nodes-for-plans-specs)

#### Noldor Framework

Noldor is the Charuy-internal dev-loop framework extracted into a
dedicated `docs/noldor/` folder so the project-agnostic rules
(complexity gating, worktree discipline, /promote /triage /garden,
SDD audit, graphify integration, FD schema, doc & test conventions,
engineering principles) live separately from Charuy's product-specific
overlays. Tracked as a single FD with all 17 framework pages in
`links.docs`; per-page change history is recovered via
`pnpm noldor:changelog` walking commit scopes
(`noldor:<slug>` / `noldor`).

[Feature page](/features/noldor)

#### Outcome Telemetry and Effectiveness Metrics

The framework enforces process and never measures whether the process works. Every tuning decision (gate strictness, size-routing thresholds, CR lane composition, drain retry caps) is currently vibes. The raw data already exists — git trailers, FD frontmatter (`since` / `introduced` / `phase`), PR history, drain logs, and (once shipped) agent-events. Build the derivation layer.

[Feature page](/features/outcome-telemetry-and-effectiveness-metrics)

#### Parallel-Drain `roadmap.md` Conflict Auto-Resolution

K>1 drain now auto-resolves adjacent `roadmap.md` block conflicts (#106).

[Feature page](/features/parallel-drain-roadmapmd-conflict-auto-resolution)

#### Per-Task Dev Environment Bootstrap

Add a `consumer.dev` surface config block (#103).

[Feature page](/features/per-task-dev-environment-bootstrap)

#### SDD Co-Tag Detector *(updated)*

13th SDD detector flagging tests whose `// @tests:` tag list is incomplete given the FDs that own the source files the test imports. Today silent: `sample-gallery.spec.ts` tagged only `sample-scene-gallery` despite exercising `empty-scene-state`; `tree.test.ts` tagged only `zod-scene-schema` despite covering `group-node`; engine tests tagged only their primary FD without `manifold-wasm-integration`. Detector reads `graphify-out/graph.json` `imports_from` edges (graphify v0.7.8+, with the v0.4.20 path-normalization fix), maps target source files to owning FDs via `links.code`, diffs against declared tags. Staleness gate: graph mtime vs MAX(mtime) of `packages/ apps/ scripts/`; on stale, emits one meta-gap with regen instructions. Substrate (`loadFreshGraphOrWarn`, `buildFileToFdsMap`, `getFdOwnersForFile`) lives in `scripts/garden/graph-fd-lookup.ts`; reused by detectors 9 and 10 below.

[Feature page](/features/sdd-co-tag-detector)

#### Version-Aware Upgrade and Migration Chain

Added semver parse and compare helpers (#104).

[Feature page](/features/version-aware-upgrade-and-migration-chain)

### Agents

#### Continuous Drain Daemon and Escalation Inbox

Every autonomous stage is one-shot and operator-fired: someone types `noldor autonomous run`, watches (or returns later), handles failures by reading logs, salvages stale bases by hand from a memory recipe. The vision sentence — agents ship unsupervised — currently means "unsupervised per invocation". Make autonomy *continuous*: a long-running (or cron-fired) mode that keeps draining the queue, repairs its own known failure modes, and escalates the rest to a structured inbox instead of dying or blocking.

[Feature page](/features/continuous-drain-daemon-and-escalation-inbox)

#### Make Noldor Agent-Agnostic

Noldor today assumes Claude Code as the operating agent (skill names, hook patterns, transcript layout). Lift the assumptions so Codex, Gemini, or other agents can drive the same framework with equivalent gates. Concrete asks: (1) abstract skill invocation (`Skill` tool vs `activate_skill` vs raw markdown read), (2) abstract hook triggers (the `lefthook` pre-commit chain works for all, but the auto-gate behavior is Claude-only), (3) document the agent-equivalence matrix in `docs/noldor/`. Trigger: when a second agent adopts Noldor in earnest (today's automated-cr-pipeline already runs Codex as a reviewer; controller is still Claude).

[Feature page](/features/make-noldor-agent-agnostic)

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
