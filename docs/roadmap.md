# Roadmap

Flat priority-ordered list (file order = priority); H3 headings group related entries.

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).

### Noldor Framework

#### Dynamic FD ↔ File Pointers via Frontmatter

- area: tooling
- type: feat
- since: 2026-05-10
- size: L
- impact: high
- parent: noldor

Replace the manual `links.code` / `links.tests` / `links.docs` arrays in FD frontmatter with dynamic frontmatter on the source files themselves — each code/test/doc file declares its FD slug, and the FD's link arrays derive from a scan. Also: brainstorm with an LLM at FD-creation time to propose initial pointers from imports + community membership. Reduces drift between FDs and their backing files. Open question: keep the FD-side arrays as a cached projection for `pnpm validate:features` speed, or always scan? Trigger: when manual FD link maintenance overtakes the value of having explicit link arrays — likely once FD count exceeds ~50 or after a refactor produces N broken links across many FDs.

#### Graphify `plan-of` edges + nodes for plans/specs

- area: tooling
- type: feat
- since: 2026-05-17
- size: M
- impact: med
- parent: graphify

Extend graphify to emit nodes for `docs/superpowers/plans/*.md` and `docs/superpowers/specs/*.md`, plus `plan-of` / `spec-of` relations linking them to owning FD nodes. Today's graph tracks `imports` / `imports_from` between source files only; plans/specs aren't represented. Once available, enables `scripts/garden/garden-detect.ts:detectStalePlans` graph-adjacency fallback (originally fallback B from release-sweep-process-hardening; deferred from that FD when audit confirmed the graph schema didn't support it). Touches: `scripts/graphify/**`, `scripts/garden/garden-detect.ts`, `scripts/garden/plan-resolution.ts`.

#### Bootstrap-Immunity for Self-Gating Features

- area: tooling
- type: feat
- since: 2026-05-10
- size: M
- impact: high
- parent: noldor

When a feature adds a new release-time gate, the feature's own implementation commits cannot satisfy that gate (the enforcement code didn't exist when they were authored). Hit live during automated-cr-pipeline: the new `release-cr-gate.ts` requires `Noldor-Reviewed-Codex` on every code-touching commit in the release range, but none of the 22 feature-branch commits have it because `pnpm cr:codex` was added by those very commits. Operator currently must hand-add `Noldor-CR-Override-Codex: bootstrap` to each commit before next release, or extend the gate to skip pre-feature SHAs. Framework-level fix: when a gate-introducing FD is detected (graph annotation? FD frontmatter `introduces-gate: <name>`?), `/gate` end-of-flow auto-injects matching `Noldor-<gate>-Override: bootstrap — feature added the gate that would block its own commits` on every commit on the worktree branch. Audited by `/garden`'s override detectors so it can't be silently abused on non-bootstrap work.

- v0.4.0 release shipped with `RELEASE_SKIP_CR_GATE=1` bypass for the same reason — 34 commits in `v0.3.0..v0.4.0` predate the CR pipeline. Retire the env-var bypass next cycle once bootstrap-immunity lands so v0.5.0 doesn't ship the escape hatch as routine. Track via a `chore` to verify `pnpm release` succeeds without the flag.

#### `pnpm release --resume`

- area: tooling
- type: feat
- since: 2026-05-11
- size: M
- impact: high
- parent: noldor

`pnpm release` is not idempotent when the final `git commit` step fails. v0.4.0 release hit this when the release commit's pre-commit hook rejected the diff (micro-chore session active): all package.json bumps, CHANGELOG entry, release-notes entry, FD `introduced:` markers were already written + staged, but the commit failed. Re-running the script would derive a new (wrong) version. Manual recovery required (`git reset`, fix root cause, re-run). Fix: either (a) `pnpm release --resume` flag that skips precondition + version-derive and goes straight to commit-tag-push when staged files match the in-progress release shape, or (b) wrap the file-mutation phase in a temp staging area committed atomically only after precondition success — so a failed commit leaves an empty tree.

- triage 2026-05-11: relocated from `### UI Bugs & Polish` — misfiled at intake, semantically framework-scope.

#### FD Complexity-Tier Field

- area: tooling
- type: feat
- since: 2026-05-06
- size: M
- impact: med

The `Features without spec` SDD detector flags every FD with empty `links.spec`, but the framework explicitly permits spec-less FDs in three of four complexity tiers (`skip-brainstorm`, `attach-to-parent`, and the no-MD chore — the last doesn't even produce an FD). Today three FDs are flagged as a "gap" purely because the detector has no signal for which tier the work shipped under. Proposal: add a `tier: <brainstorm-first | skip-brainstorm | attach-to-parent>` field to FD frontmatter, written by `/promote` (and required by `/new-feature`). The `Features without spec` detector then only flags `tier: brainstorm-first` FDs missing `links.spec`. Open design questions for brainstorm: (a) backfill rules for ~30 existing FDs — has-spec → `brainstorm-first`, has-`parent` → `attach-to-parent`, else → `skip-brainstorm`?; (b) is `tier` advisory or does `/promote` block save without it?; (c) does `tier: brainstorm-first` enforce `links.spec` non-empty at FD save time, or only at release?; (d) dashboard surface — per-tier pie / counts on `/features` so we see how often each path actually gets used. Trigger: live now — dashboard noise from the false-positive gap, plus the tier verdict already exists conceptually in CLAUDE.md so making it explicit unlocks per-tier metrics.

#### SDD Detector 5 — Idea-Merge Semantic Similarity

- area: tooling
- type: feat
- since: 2026-05-07
- size: M
- impact: med

Standalone graphify enhancement (not in the substrate family). When `/triage` proposes targets for ideas in `ideas.md`, compute semantic similarity between idea text and existing FD names + community labels via graphify; surface top-3 `merge:<slug>` candidates ranked by similarity. Reduces hand-judgment burden in `/triage` and biases toward merging into existing host FDs (per CLAUDE.md `/triage` rubric). Trigger: when next batch of ideas accumulates and triage feels noisy.

- Strengthen merge-first behavior — `/triage` should propose merging into existing roadmap/backlog blocks before suggesting new entries, with the candidate-host list surfaced explicitly in the confirmation table (today the bias is implicit).

#### Runtime Architecture Invariant Expansion

- area: tooling
- type: chore
- since: 2026-05-05
- size: M
- impact: med

Extend architecture invariants beyond package direction checks to catch runtime-boundary drift: production app imports from `@charuy/test-fixtures`, package consumers bypassing public `src/index.ts` exports, debug-only modules included in public builds, and agent API modules importing UI components directly. Add these as advisory `/garden` findings first, then promote the highest-signal ones to `pnpm check:invariants` once false positives are burned down.

#### Framework Auto-Split Suggestion for Big Features and Plans

- area: tooling
- type: feat
- since: 2026-05-10
- size: M
- impact: med
- parent: noldor

When a feature or plan grows past size thresholds, the framework should suggest a split rather than letting work calcify around an oversized FD or unwieldy plan. Heuristics: word count, scope-bullet count, file-touch breadth (from `links.code`), or for plans the row count. The suggestion surfaces in `/promote` (feature) and `superpowers:writing-plans` (plan) before the operator commits to the path. Today the operator is on their own to spot oversized scope.

- Plan threshold — suggest split when a plan exceeds ~1000 rows (one part = ~1000 rows). Use this as the initial heuristic and tune with experience.

#### Framework Milestones Support (POC / MVP / 1.0.0)

- area: tooling
- type: feat
- since: 2026-05-10
- size: M
- impact: med
- parent: noldor

Add a milestones layer to Noldor — tracking which features belong to which milestone (POC / MVP / 1.0.0 today; arbitrary names if `decouple-milestones-from-semver` lands first). Surfaces in `/triage` (proposed milestone per bullet), in FD frontmatter (`milestone: <name>`), in `/garden` (flag features whose milestone has shipped but phase is not done), and in dashboard pages. Pairs with `vision.md`'s current-milestone field.

- Optional, not mandatory — apps can grow organically without a milestone plan; the framework should not force the abstraction. When milestones are declared, the rest of the wiring activates; otherwise the field stays absent and detectors stay silent.

#### Per-Task Dev Environment Bootstrap

- area: tooling
- type: feat
- since: 2026-05-10
- size: L
- impact: med
- parent: parallel-worktree-workflow

Extend the worktree workflow with full per-task environment scaffolding: open IDE on the worktree folder/file, spawn a new terminal per task (already done), boot an internal web server scoped to the task's port, and start a local Charuy app instance per task. Today only the terminal spawn is automated; IDE focus and per-task app instances are manual. Goal: a single command takes an operator from "branch checked out" to "fully usable dev surface" without manual port-juggling. Pairs with the worktree port-per-tree convention from `docs/noldor/worktree-discipline.md`.

#### Make Noldor Agent-Agnostic

- area: tooling
- type: refactor
- since: 2026-05-10
- size: XL
- impact: med
- parent: noldor

Noldor today assumes Claude Code as the operating agent (skill names, hook patterns, transcript layout). Lift the assumptions so Codex, Gemini, or other agents can drive the same framework with equivalent gates. Concrete asks: (1) abstract skill invocation (`Skill` tool vs `activate_skill` vs raw markdown read), (2) abstract hook triggers (the `lefthook` pre-commit chain works for all, but the auto-gate behavior is Claude-only), (3) document the agent-equivalence matrix in `docs/noldor/`. Trigger: when a second agent adopts Noldor in earnest (today's automated-cr-pipeline already runs Codex as a reviewer; controller is still Claude).

- triage 2026-05-11: strategic but premature pre-1.0. Impact rated med (not high) because external agent adoption is not yet a live constraint.

#### Auto-Promotion of Stale Ideas

- area: tooling
- type: feat
- since: 2026-04-28
- size: S
- impact: low

Backlog entries past the stale threshold auto-demote phase to `later` (or get rejected with a marker). Demoted from roadmap 2026-05-04 — manual `/triage` is sufficient until the backlog grows past human grep capacity.

- triage 2026-05-11: demote candidate — block was already demoted but lingered in the former `## Next` section. Move back to `docs/backlog.md`.

#### E2E Tests Referenced by Multiple FDs

- area: tooling
- type: feat
- since: 2026-05-10
- size: S
- impact: low
- parent: noldor

Allow E2E test files to be referenced by multiple FDs (one E2E covers several features). Today `links.tests` is per-FD and the `@tests:` tag in test files is single-slug. Extend the schema so an E2E can declare `@tests: <slug-a>, <slug-b>, <slug-c>` and `links.tests` resolves the many-to-many fan-out. Garden detectors (untagged tests, untagged docs) need updating to handle the multi-slug case. Trigger: when the first E2E that legitimately covers 3+ features ships and the operator wants the link cardinality reflected accurately.

#### Noldor Section-Age Staleness Detector

- area: tooling
- type: feat
- since: 2026-05-08
- size: M
- impact: low
- parent: noldor

Was originally Detector 14 in the Noldor extraction spec (`docs/superpowers/specs/2026-05-08-noldor-framework-extraction-design.md`); deferred during review because the value depends on actual drift accumulating, and the section-boundary detection is fiddly (header renames break the heuristic). Trigger: revisit if Detectors 14 (stub regrowth) + 15 (rule contradiction) prove insufficient — i.e. if framework drift slips past both gates and shows up as user-reported confusion or `/garden` blind spots. Implementation sketch: parse CLAUDE.md / README headers, run `git log -L /^## <Section>/,/^## /` per section, compare last-touched dates between CLAUDE.md side and `noldor/<page>.md` side, flag >30 day gaps in either direction.

#### Dashboard Reference API Subtree

- area: tooling
- type: feat
- since: 2026-05-09
- size: M
- impact: low
- parent: project-tracking-dashboard

Render `docs/user/reference/api/` (typedoc-generated `engine` + `format` API trees) as nested dashboard pages. Deferred from the v1 doc-surface pass because the typedoc tree has its own deep-nesting + cross-link conventions that don't cleanly fit the flat `/docs/<category>/<slug>` route shape used for top-level user docs. Approach options at trigger time: (a) mount typedoc HTML output directly under `/docs/reference/api/*` as static-file pass-through; (b) parse the markdown subtree recursively into a tree-shaped surface keyed by module path. Trigger when an agent or user actually hits the API reference often enough that its absence from the dashboard is friction.

#### Real-Codex Integration Smoke Test

- area: tooling
- type: test
- since: 2026-05-10
- size: M
- impact: low
- parent: noldor

`scripts/cr/__tests__/codex.test.ts` mocks the `Spawn` function, so all CI runs of `pnpm cr:codex` validate the wiring without ever invoking the real `codex` binary. The first real-codex run will surface integration bugs the mocked tests can't catch (codex CLI flag drift, JSON schema variance, stdin-pipe encoding edge cases). Add a manual / opt-in smoke test (`pnpm cr:codex --dry-run` against a fixture worktree, gated behind `NOLDOR_RUN_REAL_CODEX=1`) plus a documented operator-side pre-release dogfood step in `docs/noldor/cr-pipeline.md`. Trigger: when codex CLI grows a stable `cr --json` subcommand (currently absent).

#### Framework Script + Test Migration Cleanup

- area: tooling
- type: chore
- since: 2026-05-10
- size: M
- impact: low
- parent: noldor

Audit `scripts/` and the framework's test corpus to identify scripts/tests that were only needed during migration (FD frontmatter shape changes, gate path additions, garden detector rollouts) and can now be deleted. Conversely, identify gaps where shipped framework features lack test coverage. The migration-only scripts add maintenance load; the gaps add risk. One-pass sweep — possibly a `/garden` detector that flags scripts referenced only in commits with `chore(framework):` or `refactor:` migration messages and not in any current pipeline.

#### Drop Branched Worktrees — Single Dev Branch Workflow

- area: tooling
- type: refactor
- since: 2026-05-10
- size: L
- impact: low
- parent: noldor

Re-evaluate the always-branch worktree discipline (per `docs/noldor/worktree-discipline.md`). Today every active task lives in its own branch worktree. The proposal: collapse to a single shared dev branch — still in worktrees for parallelism, but not separate branches — with all task work landing on one rolling branch and merging to main on release. Trade-off: simpler integration story (no per-task rebase, fewer divergent histories) at the cost of losing the per-task isolation that lets `/gate` and `/promote` reason about scope. Trigger: when per-branch overhead (rebase storms, cross-branch lint regen, merge order ambiguity) outweighs the isolation benefit.

#### Dashboard Auto-Start on Project Load

- area: tooling
- type: feat
- since: 2026-05-12
- parent: project-tracking-dashboard
- size: S
- impact: med

Boot the project-tracking dashboard server automatically when the project is loaded (IDE open, worktree spawn, or `pnpm dev`-equivalent entry point), so the operator never has to remember to start it as a separate step. Today the dashboard is a manual `pnpm` invocation in a side terminal; friction compounds across worktrees. Pairs with the per-task dev environment bootstrap entry — could share the same launcher path.

#### Specs-Only Path: Print Detailed Plan Summary to Operator

- area: tooling
- type: feat
- since: 2026-05-12
- parent: noldor
- size: S
- impact: high

When the gate flow picks a specs-only path (`specs-only-new` / `specs-only-attach`) and the spec is skipped, the framework should print a detailed summary of the plan to the operator at handoff — scope bullets, files touched, acceptance criteria, deferred risks — instead of the current minimal "plan written, proceed?" prompt. Specs-only is the path most likely to mask scope drift because there's no spec to anchor against; surfacing the plan's contents at the gate boundary gives the operator a real review surface before subagent dispatch. Trigger: live now — observed during the specs-only-attach flow that the operator is expected to open the plan file to verify it.

#### Dashboard: Filter Features Missing `introduced`

- area: tooling
- type: feat
- since: 2026-05-12
- parent: project-tracking-dashboard
- size: XS
- impact: low

Add a filter (or default-on flag column) on the dashboard's `/features` listing for FDs whose frontmatter is missing the `introduced:` version field. The SDD detector already flags this server-side, but operators want a one-click view on the dashboard to spot done features that shipped without an `introduced:` marker (release-notes drift, version-attribution gaps). Trigger: live now — surfaced during recent dashboard browsing; missing-`introduced` features are otherwise invisible until release-time SDD report.

#### Scope Sibling Trailer for Doc-Sync Commits

- area: tooling
- type: feat
- since: 2026-05-12
- size: M
- impact: med
- parent: noldor

`scripts/noldor/validate-noldor-scope.ts` rejects multi-scope commits, so one logically-coherent change (feat in `scripts/triage/`, tests in `scripts/triage/__tests__/`, sibling doc syncs in `docs/noldor/triage.md` and `docs/features/<slug>.md`) must split into separate commits per scope. Mechanically correct, but the same logical change becomes 3 entries in `git log` and 3× the gate dance (session, hook, trailer). 2026-05-12 roadmap-priority follow-up hit this — `feat(scripts:roadmap-priority-ordering)` + `docs(noldor:triage)` + `docs(features:roadmap-priority-ordering)` split forced. Proposal: introduce a `Noldor-Sibling-Scope: <scope-list>` trailer that lets the validator accept files mapping to listed sibling scopes, keeping the work as one atomic commit. Alternative: validator auto-detects "doc-sync-for-this-feat" patterns (FD doc + framework page in same commit as the code) and waives the split heuristically. Either way: a single commit makes the change easier to revert + easier to read in `git log` + cheaper to author.

#### Stable Entry IDs for Roadmap + Backlog

- area: tooling
- type: feat
- since: 2026-05-22
- size: M
- impact: med
- parent: noldor

Every roadmap and backlog entry is identified today by its kebab-slug derived from the heading. Slugs are rename-fragile — renaming an entry breaks every `deps:`, `parent:`, commit trailer, and dashboard link that targets it; moving an entry between roadmap ↔ backlog preserves the slug but loses heading-evolution traceability. Introduce a stable short ID minted at first triage and never rewritten: e.g. `R-0042` for roadmap and `B-0042` for backlog, or a single `Q-0042` namespace that survives cross-file moves. The ID becomes the canonical reference for `blocked-by:` / `parent:` / commit trailers / dashboard links / garden detectors. Slug stays a human-readable alias that can be rewritten without breakage. Counter persists in `.noldor/id-counter.json`; `/triage` and `/new-feature` mint IDs at creation. Migration: one-sweep backfill across existing ~80 backlog + ~60 roadmap entries. Touches: `docs/roadmap.md` + `docs/backlog.md` preambles, `.claude/skills/triage/SKILL.md`, `scripts/triage/score.ts`, `scripts/validate/validate-triage.ts`, `docs/noldor/triage.md`, `docs/noldor/feature-md-schema.md`.

#### First-Class `blocked-by` Field

- area: tooling
- type: refactor
- since: 2026-05-22
- size: S
- impact: med
- deps: stable-entry-ids-for-roadmap-backlog
- parent: noldor

`docs/noldor/triage.md:64` describes a `deps:` bullet (comma-separated kebab slugs) that `scripts/triage/score.ts` reads for dependency-weight scoring, but the field is silently optional in v1, undocumented in both `docs/roadmap.md` and `docs/backlog.md` preambles, and unused across every current entry. Promote it to a first-class `blocked-by:` field — name matches GitHub-issue + Jira convention and reads better in prose than `deps`. Document it in both file preambles, surface it on the dashboard as a dependency graph view, validate that each referenced ID exists, and have `/garden` flag circular chains. Accept `deps:` ↔ `blocked-by:` as aliases during a migration window, then deprecate `deps:`. Blocked by Stable Entry IDs — `blocked-by:` references should target stable IDs, not rename-fragile slugs. Touches: `docs/roadmap.md` + `docs/backlog.md` preambles, `.claude/skills/triage/SKILL.md`, `scripts/validate/validate-triage.ts`, `scripts/garden/detectors/*` (new circular-blocked-by detector), `docs/noldor/triage.md`.

### Mark FD phase=done in feature PR (not at release)

- area: tooling
- type: feat
- since: 2026-05-23
- size: S
- impact: med
- parent: noldor

Today FDs stay `phase: in-progress` from feature-branch creation through merge until `pnpm release` flips them to `phase: done` via `release-markers.ts:fillMarkers`. Result: `main` carries shipped-but-still-`in-progress` FDs for the entire window between feature-merge and the next release cut. Want: the phase-flip `in-progress → done` happens in the last commit on the feature branch **before merge** and lands on `main` as part of the feature's PR. If the feature is later reopened (attach-revert flow), flip back to `in-progress` per existing `framework-pr-flow-agent-auto-merge` asymmetric state-machine — release-time `fillMarkers` then becomes a no-op for done features and only fills `introduced` markers on FDs whose phase was already done. Trigger: live now — surfaced 2026-05-23 during release sweep when several recently-merged features remained `in-progress` on `main` until release. Heavily overlaps with roadmap entry "Drop Manual Feature MD Update Step" which already proposes flipping phase=done at `/gate` end-of-flow — merge candidate. Touches: `.claude/skills/gate/SKILL.md` Step 4, `scripts/release/release-markers.ts`, `docs/noldor/workflow.md`.

- triage 2026-05-23: round-tripped roadmap → backlog → roadmap same day. First demoted as vague (`ship-plans-specs-via-fast-track`), then UC clarified, then re-promoted with current slug + scope. Original `ideas.md:43` marker references the old slug for traceability.
