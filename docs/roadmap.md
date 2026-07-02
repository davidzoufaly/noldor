# Roadmap

Flat priority-ordered list (file order = priority); H3 headings group related entries.

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).
>
> Section order = execution phases from the 2026-07-02 queue verification. Retired that day: `fd-complexity-tier-field` (shipped as `noldor-tier`), `runtime-architecture-invariant-expansion` + `dashboard-reference-api-subtree` (Charuy-only premises), `dispatch-next-priority-via-agent-window` (covered by `noldor autonomous run --max-features 1` + `/gate` Step 0 priority pickup). `prefix-skills-with-noldor` re-sized S→L and parked in backlog.

### Phase 1 — Self-Truth Quick Fixes

#### README and Version Output Staleness

- area: docs
- type: fix
- since: 2026-07-01
- size: XS
- impact: med
- confidence: high

Adoption surface lies: README still says 0.3.0 and "migration chain tracked on roadmap" (shipped PR #104 — `noldor upgrade` + chain + doctor skew all live); `noldor --version` prints hardcoded `noldor v0` (`src/cli/index.ts:27-30` — derive from package.json). Same pass: `docs/noldor/testing-principles.md` claims `pnpm test:coverage` exists (it doesn't) and "pre-push runs `pnpm verify`" (false — CI runs it since PR #117, pre-push runs receipt/push-block/template-sync).

#### Prep Promote Preflight Ignores Untracked Files

- area: tooling
- type: fix
- since: 2026-06-13
- size: XS
- impact: low
- confidence: high

`prep promote`'s preflight "working tree not clean" check uses bare `git status --porcelain` (`src/prep/prep-promote.ts:80`), which lists untracked (`??`) files — so a stray untracked artifact (report file, scratch note) blocks the whole promote with a confusing message. The preflight should ignore untracked files and block only on tracked (staged or modified) changes — matching what actually threatens a clean promote commit. (Gitignored files never appear in porcelain output, so ignored artifacts like `.noldor/prep-fanout.log` are already safe.)

#### Prep Promote `--ship` Direct-Merge Fallback

- area: tooling
- type: fix
- since: 2026-06-13
- size: S
- impact: med
- confidence: high

`prep promote --ship` opens a PR then runs `gh pr merge --auto --squash` with no error handling (`src/prep/prep-promote.ts:268`), but on a repo with GitHub auto-merge disabled (`enablePullRequestAutoMerge` off) that errors and the promote PR is left open + unmerged — the operator must merge by hand. `pr-flow`'s `openAndAutoMerge` already handles this by falling back to a direct squash-merge; `prep promote --ship` should mirror that fallback so a promote batch lands the same way the drain's PRs do. Reuse the `src/core/pr-flow.ts` merge path.

### Phase 2 — Enforcement Honesty

#### Release Bypass Retirement

- area: tooling
- type: fix
- since: 2026-07-01
- size: M
- impact: high
- confidence: high

Every release still requires `RELEASE_SKIP_GATE_COMPLIANCE=1` + `RELEASE_SKIP_CR_GATE=1` (`src/release/index.ts:178,193`) — "goes away once X ships" for several releases now. Two root causes: (a) the CR gate is unsatisfiable by design — `src/release/release-cr-gate.ts` checks squash commits on main for review receipts that squash-merge strips; rework it to check PR-branch commits or PR-body trailers instead. (b) Gate-compliance trips on historical short-scope trailers + the framework's own expected override usage; make the self-host expected-noise allowlist first-class instead of env-skipping the whole check. Also: write `RELEASE_SKIP_*` uses to `.noldor/overrides.log` the way `src/hooks/noldor-pre-commit.ts:33-42` logs overrides, so bypasses leave an audit trail. Acceptance: a clean `pnpm release` needs zero env bypasses.

#### `pnpm release --resume`

- area: tooling
- type: feat
- since: 2026-05-11
- size: M
- impact: high
- parent: noldor

`pnpm release` is not idempotent when the final `git commit` step fails. v0.4.0 release hit this when the release commit's pre-commit hook rejected the diff (micro-chore session active): all package.json bumps, CHANGELOG entry, release-notes entry, FD `introduced:` markers were already written + staged, but the commit failed. Re-running the script would derive a new (wrong) version. Manual recovery required (`git reset`, fix root cause, re-run). Fix: either (a) `pnpm release --resume` flag that skips precondition + version-derive and goes straight to commit-tag-push when staged files match the in-progress release shape, or (b) wrap the file-mutation phase in a temp staging area committed atomically only after precondition success — so a failed commit leaves an empty tree.

- triage 2026-05-11: relocated from `### UI Bugs & Polish` — misfiled at intake, semantically framework-scope.

#### Audit Gate Documentation

- area: docs
- type: docs
- since: 2026-06-12
- size: S
- impact: med
- confidence: high

Promoted from backlog 2026-07-02 — no longer speculative: the 2026-07 deep audit found 15 doc-says-code-doesn't + 11 code-does-docs-don't mismatches around the gate. Known concrete items: `docs/noldor/git-and-commits.md` schema missing the `Noldor-Enhancement` trailer and `release-sweep` path; `docs/noldor/worktree-discipline.md:20` instructs a `git push origin main` that the push hook blocks; `docs/noldor/pr-flow.md:16` documents the removed `cr-retry.ts` loop; the gate skill body itself still cites pre-reorg `scripts/noldor/*` paths (allowlist, phase-revert, session, pr-flow-cli — all live in `src/` now; template twin edits in lockstep). Sweep `/gate` docs (skill + `docs/noldor/`) against code and fix both directions.

### Phase 3 — Adoption Chain

#### Registry Distribution for the Noldor Package

- area: tooling
- type: feat
- since: 2026-06-11
- size: M
- impact: high
- parent: noldor

Today a consumer installs Noldor as a `file:` dependency and must keep a clone of `noldor/` as a sibling directory of their repo. That is the single hardest blocker for any project that is not on this machine. Publish the package to a registry so adoption starts with `pnpm add -D noldor`.

Package hygiene largely shipped in PR #119 (tarball `files` filter drops the self-host `docs/` tree, tolerant postinstall for missing lefthook, config scaffold in `templates/.noldor/config.json`, `pnpmStderrPrefix` optional). Backlog entry `cli-standalone-tool` merged here 2026-07-02 — same problem, registry install IS the standalone path. Remaining:

- Decide registry: public npm vs GitHub Packages. `noldor` on npm verified unclaimed (2026-07-01 audit); claim it or pick a scope — scoped name ripples into `consumer-config` docs and `init` output, so decide before publishing anything.
- Extend `src/release/` so `pnpm release` gains a publish step (or a separate `release publish` subcommand): build → pack → publish with provenance, tag-driven, after the existing commit-tag-push succeeds (`src/release/index.ts:294-300` currently ends at git push). Must respect the existing release gates; publishing is the new last step, never runs on a dirty tree.
- Final `pnpm pack` + scratch-dir install verification (tarball mechanics already proven by contract CI, verify the published shape end-to-end).
- Docs: rewrite README Quick start and adoption-guide Bootstrap §1 for the registry path; keep `file:` documented as the contributor/dev path.

**What it enables:** any repo anywhere adopts without cloning the framework; precondition for a credible consumer-#2 dogfood on a machine that isn't this one (versions pinnable + resolvable; migration chain already shipped, PR #104).

**Open questions:** npm public vs GitHub Packages (private-first?); semver tag → npm dist-tag mapping (`latest` only pre-1.0?).

**Acceptance sketch:** fresh temp dir, `pnpm init && pnpm add -D noldor && pnpm noldor init && pnpm noldor doctor` → green, no sibling clone present.

#### Stack-Assumption Audit and Declared Prerequisites

- area: tooling
- type: chore
- since: 2026-06-11
- size: S
- impact: med
- parent: noldor

Noldor hard-assumes its home stack: pnpm, lefthook, TypeScript + vitest, Conventional Commits, `gh` CLI, Claude Code as the driving agent. Opinionated is the stated posture ("opinionated, not configurable" — vision.md), but the opinions are currently *undocumented*, so a mismatched adopter discovers them one runtime error at a time, mid-gate.

**What to do:**

- Sweep `src/` + skills + lefthook templates for every environmental assumption: package manager invocations, hook runner, test runner, formatter (oxfmt), commit-format parsing, `gh` calls, Claude-specific paths (`.claude/`, skill names, transcript layout). Output: a prerequisites matrix — tool, where assumed, hard requirement vs swappable, failure mode if absent.
- Publish the matrix as a **Prerequisites** section at the top of `docs/noldor/adoption-guide.md`: "Noldor requires: pnpm ≥X, lefthook, vitest, Conventional Commits, gh, Claude Code. Not negotiable pre-1.0."
- Teach `noldor doctor` to check each prerequisite explicitly (binary present, version floor) and fail with the matrix link — adoption failures move from mid-gate mystery to minute-one diagnosis.
- Explicitly do NOT abstract anything in this entry — abstraction decisions (other package managers, other agents) stay with `portable-gate-entrypoint-for-non-claude-runners`. This entry only makes the floor visible.

**What it enables:** honest adoption surface; failed adoptions fail fast at `doctor` with a named missing prerequisite; the matrix becomes the scoping document for any future portability work.

**Acceptance sketch:** removing `gh` from PATH → `doctor` names it + links the matrix; matrix lists ≥6 prerequisites with where-assumed pointers.

#### Real Consumer #2 Adoption Dogfood

- area: tooling
- type: chore
- since: 2026-06-11
- size: M
- impact: high
- parent: noldor

Both existing consumers are degenerate cases: Charuy is the origin monorepo Noldor was extracted from, and self-host is the framework itself. Neither exercises the adoption path the way a foreign repo would. Adopt Noldor into one real, structurally different project (single-package repo, different domain, ideally an existing repo of the operator's with live development) and drive real work through it. Template-layer blockers cleared by PR #119 (portable gate CLIs `features phase-flip-done` / `phase-revert` / `roadmap remove-block`, config scaffold, tolerant postinstall) — the documented path is now plausible end-to-end.

**What to do:**

- Pick the repo: criteria — actively developed, single package (not a monorepo, to stress the `lockstepPackages: [one]` shape), TS or close enough that stack assumptions hold (this dogfood validates the *adoption flow*, not yet stack-portability — that's `stack-assumption-audit-and-declared-prerequisites`).
- Run the documented path verbatim: install (registry if `registry-distribution-for-the-noldor-package` has shipped, `file:` otherwise), `pnpm noldor init --adopt`, fill `.noldor/config.json` `consumer:` block, `pnpm noldor doctor`. Every deviation from the adoption guide goes in the friction log — do not silently fix and move on.
- Drive ≥3 changes through the full lifecycle: one micro-chore, one fast-track, one specs-only or full feature with FD + spec. At least one of them via the autonomous drain (`noldor autonomous run --source roadmap`) end-to-end to PR merge.
- Maintain `friction.md` in the consumer repo during the run: every prompt that confused, every command that assumed Charuy/self-host context, every hard-coded path, every doc that lied. Date + exact error text.
- Close-out: `/triage` the friction log into Noldor's `ideas.md` → roadmap; fix the adoption-guide lies immediately (micro-chore class).

**What it enables:** ground-truth adoption backlog instead of speculation — this entry *generates* the precise work items for the rest of the adoption block; validates the guide line-by-line; produces the first consumer whose breakage matters for contract-CI fixture design.

**Open questions:** which repo (operator decision); whether the consumer keeps Noldor after the experiment or rolls back (rollback procedure is itself an undocumented gap — note it in the friction log).

**Acceptance sketch:** friction log exists with ≥10 dated entries; ≥3 changes shipped in consumer incl. ≥1 autonomous drain ship; ≥5 entries triaged back into Noldor's queue.

### Phase 4 — Consumer-Layout Correctness

#### Scan-Roots Repo-Paths Provider

- area: tooling
- type: fix
- since: 2026-07-02
- size: M
- impact: high
- confidence: high

Remaining hardcoded Charuy-layout scan roots (`packages`/`apps`/`scripts`) outside sdd-report: `src/features/fill-links-code-gaps.ts` (walkRepo ×2, lines 399-401 + 475-477) and `src/dashboard/data.ts` (walkRepo lines 1052-1056 + `readdir('packages')` line 1079) still walk the monorepo trio instead of consumer `scanPaths`, so on a standalone `src/` repo (self-host included) they see nothing. Also hardcoded: `readdir('packages')` for actualPackages in sdd-report main() and dashboard data. Mirror the `scanRoots()` fix shipped for sdd-report in PR #122 (`src/sync/sync-code-links.ts`), and unify the divergent fallbacks into one repo-paths provider — `src/features/propose-pointers.ts` falls back to `['src']` while `scanRoots()` falls back to the 4-dir union; the union semantics must win (PR #122 CR lesson: a `['src']` fallback regresses unconfigured monorepo consumers).

Separate operator-assisted follow-up surfaced by the PR #122 fix: 29 test files without `@tests:` tag (no import-owner hint derivable) and 51 src files unreferenced by any FD `links.code` (detector-9 probable-owner hints in sdd-report) — both need a judgment pass, not mechanical apply.

### Phase 5 — Autonomy Observability

#### Agent-Events Phase Tracking, Run IDs and `/agents` Dashboard Page

- area: tooling
- type: feat
- since: 2026-06-11
- size: M
- impact: high
- parent: project-tracking-dashboard

Delta rewrite 2026-07-02 — the original entry's data spine already shipped: `src/core/agent-events.ts` appends to `.noldor/agent-events.jsonl` (fail-open), every spawner writes exit events via the agent-runner registry, and `src/metrics/collect/drain-reliability.ts` already aggregates salvage counts + durations. Remaining delta:

- **Run IDs:** events lack a drain-run id, so per-run grouping is not derivable (noted blind spot in `drain-reliability.ts:35`); escalation rows share the gap. Mint a run id at drain start, thread it through spawn/exit events + escalations.
- **Phase events:** today only spawn/exit are recorded; add coarse phase events (gate stage, CR lane, merge) from the drain loop heartbeat.
- **Dashboard `/agents` page** (`src/dashboard/`): **Live board** — currently-running agents (spawned without exited, pid-liveness-checked): kind, slug, lane, phase, runtime, retry count; link per row to a log-tail view. **Run timeline** — per drain-run grouped history: spawned→exited bars, outcomes color-coded, shipped/skipped/escalated totals. Poll every ~2s in v1; SSE noted as follow-up.
- **Escalation inbox surface:** the CLI-only inbox (`noldor autonomous inbox`) gets a dashboard panel on the same page — escalations are the events an unattended operator most needs to see.

**Acceptance sketch:** run `noldor autonomous run --concurrency 2 --max-features 2`; `/agents` shows 2 live implementer rows with distinct lanes, then a timeline with 2 shipped outcomes grouped under one run id; events file has spawned/exited pairs for every agent incl. CR lanes.

#### `noldor autonomous status`

- area: tooling
- type: feat
- since: 2026-06-11
- size: XS
- impact: low
- parent: autonomous-queue-drain-runner

Delta rewrite 2026-07-02 — the robust-lock-read half already shipped: `liveLockPid` (`src/autonomous/drain-lock.ts:41-50`) catches empty/partial JSON and validates the pid field, and PR #120's startup reconcile + pgid heartbeat closed the incident class that motivated it. Remaining delta: the `status` subcommand itself — `noldor autonomous status` reporting liveness from the actual process (lock pid + `kill -0`) plus shipped / skip / in-flight from drain-state, so operators stop reading `.noldor/drain-state.json` + `.noldor/drain.lock` by hand. Touches: `src/cli/manifest.ts`, thin reader over `src/autonomous/drain-state.ts` + `drain-lock.ts`.

#### Portable Gate Entrypoint for Non-Claude Runners

- area: tooling
- type: feat
- since: 2026-06-12
- size: M
- impact: high
- confidence: med

The autonomous drain's spawn layer is agent-agnostic (the registry resolves bin + argv for `claude` / `codex` / `opencode`), but the *prompt* it spawns is `/gate --drain <slug>` — a Claude Code slash-command (`src/autonomous/drain-source.ts:98`). On `codex` (prompt via stdin, no slash-command system) the string is treated as literal text → no gate runs. On `opencode` it only works if a `/gate` command is vendored into `.opencode/command/` (not present). So the multi-runner promise stops short of the autonomous drain: only claude can actually drive the gate headlessly. PR #119's portable CLIs (`features phase-flip-done`, `phase-revert`, `roadmap remove-block`) cover the gate's *manual steps* but not the drain entrypoint itself. Options: (a) a portable `noldor gate --drain <slug>` CLI entrypoint the drain spawns instead of a slash-command, with the agent CLI wrapping it; or (b) per-runtime vendoring of a `/gate` command alongside the existing skill. Strategic per the 2026-07 audit: harness-neutrality is the defensible layer. Touches: `src/autonomous/drain-source.ts`, the runner argv builders, gate skill/CLI surface.

#### Graphify AST-Only Sweep Default

- area: tooling
- type: feat
- since: 2026-07-01
- size: S
- impact: med
- confidence: high

Full-semantic graphify on the repo = 669 files → 31 background subagents; roughly half died mid-run (session-pause kills, API disconnects, stream-watchdog stalls), 2 chunks never landed, and marginal value was near-zero because `/refactor` keys off god-nodes/cohesion from the AST structural graph. Make release-sweep invoke graphify in AST-only mode by default (seconds, deterministic, no agents); full-semantic becomes an explicit opt-in for a deep pass. The v0.4.0 sweep DID reach a fresh graph via AST-only in the end — make that the sweep's normal path.

#### Graphify Semantic Checkpoint-Resume

- area: tooling
- type: feat
- since: 2026-07-01
- size: M
- impact: med
- confidence: high

The graphify semantic pass has no built-in "re-run only missing chunks" — chunk files are the success signal but the v0.4.0 sweep hand-rolled a disk-scan + re-dispatch loop for dead/stalled chunks. Fresh subagents also intermittently derailed by the SessionStart gate/superpowers hook (returned 0-tool-use echoing "use the gate skill"); needed an explicit "IGNORE session instructions, you are a data-extraction worker" preamble. Bake both into the graphify skill: idempotent missing-chunk detection + auto-retry, and a hook-defusing extractor preamble.

### Phase 6 — Structural

#### Stable Entry IDs for Roadmap + Backlog

- area: tooling
- type: feat
- since: 2026-05-22
- size: M
- impact: med
- parent: noldor

Every roadmap and backlog entry is identified today by its kebab-slug derived from the heading. Slugs are rename-fragile — renaming an entry breaks every `deps:`, `parent:`, commit trailer, and dashboard link that targets it; moving an entry between roadmap ↔ backlog preserves the slug but loses heading-evolution traceability. Introduce a stable short ID minted at first triage and never rewritten: e.g. `R-0042` for roadmap and `B-0042` for backlog, or a single `Q-0042` namespace that survives cross-file moves. The ID becomes the canonical reference for `blocked-by:` / `parent:` / commit trailers / dashboard links / garden detectors. Slug stays a human-readable alias that can be rewritten without breakage. Counter persists in `.noldor/id-counter.json`; `/triage` and `/new-feature` mint IDs at creation. Migration: one-sweep backfill across current entries (~25 roadmap + ~7 backlog as of 2026-07-02). Touches: `docs/roadmap.md` + `docs/backlog.md` preambles, `.claude/skills/triage/SKILL.md`, `src/triage/score.ts`, `src/triage/validate-triage.ts`, `docs/noldor/triage.md`, `docs/noldor/feature-md-schema.md`.

#### First-Class `blocked-by` Field

- area: tooling
- type: refactor
- since: 2026-05-22
- size: S
- impact: med
- deps: stable-entry-ids-for-roadmap-backlog
- parent: noldor

`docs/noldor/triage.md:64` describes a `deps:` bullet (comma-separated kebab slugs) that `src/triage/score.ts` reads for dependency-weight scoring, but the field is silently optional in v1, undocumented in both `docs/roadmap.md` and `docs/backlog.md` preambles, and nearly unused across current entries. Promote it to a first-class `blocked-by:` field — name matches GitHub-issue + Jira convention and reads better in prose than `deps`. Document it in both file preambles, surface it on the dashboard as a dependency graph view, validate that each referenced ID exists, and have `/garden` flag circular chains. Accept `deps:` ↔ `blocked-by:` as aliases during a migration window, then deprecate `deps:`. Blocked by Stable Entry IDs — `blocked-by:` references should target stable IDs, not rename-fragile slugs. Touches: `docs/roadmap.md` + `docs/backlog.md` preambles, `.claude/skills/triage/SKILL.md`, `src/triage/validate-triage.ts`, `src/garden/detectors/*` (new circular-blocked-by detector), `docs/noldor/triage.md`.

#### Self-Boundaries Declaration and Cycle Break

- area: tooling
- type: refactor
- since: 2026-07-01
- size: M
- impact: med
- confidence: high

Replaces the retired Charuy-premise `runtime-architecture-invariant-expansion` with the noldor-native version the 2026-07 audit surfaced: `pnpm noldor invariants run` passes 4/4 but the `boundaries` check sources rules from `.noldor/config.json` = `[]` — dependency-cruiser runs with zero rules while 4 real prod cycles exist (core↔cr via `src/core/pr-flow-cli.ts` importing `cr/config` — the repo-wide config loader lives in the wrong module; features↔garden via `sdd-report.ts` doubling as shared FD-loading lib; garden↔sync; garden↔invariants). Declare real boundary rules for the framework's own module graph, then break the cycles (move the config loader out of `src/cr/`, extract the FD-loading lib from `sdd-report.ts`). The framework preaches boundary discipline; it should declare some for itself. Also retire the Charuy-inherited `keyboard-binding` invariant (slowest check, 922ms, UI concern in a CLI framework).

#### Framework Script + Test Migration Cleanup

- area: tooling
- type: chore
- since: 2026-05-10
- size: M
- impact: low
- parent: noldor

Audit `scripts/` and the framework's test corpus to identify scripts/tests that were only needed during migration (FD frontmatter shape changes, gate path additions, garden detector rollouts) and can now be deleted. Conversely, identify gaps where shipped framework features lack test coverage. The 2026-07 audit's cruft inventory is the shopping list: dead `cr-retry.ts`, `src/graphify-out/junk.ts` litter, empty `src/index.ts` as package main, duplicate semver impls (`src/migrations/semver.ts` vs npm `semver` in release), stale `packages/noldor/` + `scripts/release/` path comments (`src/core/consumer-config.ts:7`, `src/core/release-markers.ts:9`), `ideas.md` at repo root while `src/core/doc-roots.ts:28` expects `docs/ideas.md`. One-pass sweep — possibly a `/garden` detector that flags scripts referenced only in migration-era commits and not in any current pipeline.

#### Scope Sibling Trailer for Doc-Sync Commits

- area: tooling
- type: feat
- since: 2026-05-12
- size: M
- impact: med
- parent: noldor

The noldor-scope validator (`src/core/validate-noldor-scope.ts`) can force one logically-coherent change (feat in code, tests, sibling doc syncs in `docs/noldor/<page>.md` and `docs/features/<slug>.md`) to split into separate commits per scope. Mechanically correct, but the same logical change becomes 3 entries in `git log` and 3× the gate dance (session, hook, trailer). 2026-05-12 roadmap-priority follow-up hit this. Proposal: introduce a `Noldor-Sibling-Scope: <scope-list>` trailer that lets the validator accept files mapping to listed sibling scopes, keeping the work as one atomic commit. Alternative: validator auto-detects "doc-sync-for-this-feat" patterns and waives the split heuristically. **Re-verify pain before spec'ing** (2026-07-02 note): the validator moved to `src/core/` and appears laxer than this entry claims — multi-page edits pass under a plain `noldor` scope; confirm the forced-split still bites on current code before spending an M on it.

#### Framework Auto-Split Suggestion for Big Features and Plans

- area: tooling
- type: feat
- since: 2026-05-10
- size: M
- impact: med
- parent: noldor

When a feature or plan grows past size thresholds, the framework should suggest a split rather than letting work calcify around an oversized FD or unwieldy plan. Heuristics: word count, scope-bullet count, file-touch breadth (from `links.code`), or for plans the row count. The suggestion surfaces in `/promote` (feature) and the plan skill before the operator commits to the path. Today the operator is on their own to spot oversized scope — live example: `prefix-skills-with-noldor` sat mislabeled S for weeks until a drain attempt revealed an L-sized self-referential mega-rename (now parked in backlog, re-sized).

- Plan threshold — suggest split when a plan exceeds ~1000 rows (one part = ~1000 rows). Use this as the initial heuristic and tune with experience.

### Trigger-Parked (revisit when the named trigger fires)

#### SDD Detector 5 — Idea-Merge Semantic Similarity

- area: tooling
- type: feat
- since: 2026-05-07
- size: M
- impact: med

Standalone graphify enhancement (not in the substrate family). When `/triage` proposes targets for ideas in `ideas.md`, compute semantic similarity between idea text and existing FD names + community labels via graphify; surface top-3 `merge:<slug>` candidates ranked by similarity. Reduces hand-judgment burden in `/triage` and biases toward merging into existing host FDs (per CLAUDE.md `/triage` rubric). Trigger: when next batch of ideas accumulates and triage feels noisy.

- Strengthen merge-first behavior — `/triage` should propose merging into existing roadmap/backlog blocks before suggesting new entries, with the candidate-host list surfaced explicitly in the confirmation table (today the bias is implicit).
- When checking an FD, also scan backlog for other candidates for the same FD → suggest a new FD with higher confidence so it stays useful later too.

#### Noldor Section-Age Staleness Detector

- area: tooling
- type: feat
- since: 2026-05-08
- size: M
- impact: low
- parent: noldor

Was originally Detector 14 in the Noldor extraction spec (`docs/superpowers/specs/2026-05-08-noldor-framework-extraction-design.md`); deferred during review because the value depends on actual drift accumulating, and the section-boundary detection is fiddly (header renames break the heuristic). Trigger: revisit if Detectors 14 (stub regrowth) + 15 (rule contradiction) prove insufficient — i.e. if framework drift slips past both gates and shows up as user-reported confusion or `/garden` blind spots. Implementation sketch: parse CLAUDE.md / README headers, run `git log -L /^## <Section>/,/^## /` per section, compare last-touched dates between CLAUDE.md side and `noldor/<page>.md` side, flag >30 day gaps in either direction.

#### Real-Codex Integration Smoke Test

- area: tooling
- type: test
- since: 2026-05-10
- size: M
- impact: low
- parent: noldor

`src/cr/__tests__/codex.test.ts` mocks the `Spawn` function, so all CI runs of the codex lane validate the wiring without ever invoking the real `codex` binary. The first real-codex run will surface integration bugs the mocked tests can't catch (codex CLI flag drift, JSON schema variance, stdin-pipe encoding edge cases). Add a manual / opt-in smoke test (`pnpm noldor cr codex --dry-run` against a fixture worktree, gated behind `NOLDOR_RUN_REAL_CODEX=1`) plus a documented operator-side pre-release dogfood step in `docs/noldor/cr-pipeline.md`. Trigger: when codex CLI grows a stable `cr --json` subcommand (currently absent).

#### Path Rename: docs/superpowers to docs/design

- area: tooling
- type: refactor
- since: 2026-06-11
- size: S
- impact: med
- parent: noldor
- recovered: 2026-06-11

Separable last step split out of `de-superpowers-vendor-spec-plan-and-worktree-flows` at its promotion: rename `docs/superpowers/` → `docs/design/{specs,plans}`. `src/core/doc-roots.ts:30-31` is the single code seam; everything else is prose/links. Ship as a migration (via the shipped `noldor upgrade` chain) that moves files and rewrites links; keep a transition alias in doc-roots for one release. Trigger: bundle with the next migration-bearing release rather than shipping alone — the rename is cheap but touches every spec/plan link, so ride a release that already asks consumers to run `noldor upgrade`.

- Still using the superpowers worktree path → move specs/plan out of the `superpowers/` folder as part of this rename.
