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

#### Drop Branched Worktrees — Single Dev Branch Workflow

- area: tooling
- type: refactor
- since: 2026-05-10
- size: L
- impact: low
- parent: noldor

Re-evaluate the always-branch worktree discipline (per `docs/noldor/worktree-discipline.md`). Today every active task lives in its own branch worktree. The proposal: collapse to a single shared dev branch — still in worktrees for parallelism, but not separate branches — with all task work landing on one rolling branch and merging to main on release. Trade-off: simpler integration story (no per-task rebase, fewer divergent histories) at the cost of losing the per-task isolation that lets `/gate` and `/promote` reason about scope. Trigger: when per-branch overhead (rebase storms, cross-branch lint regen, merge order ambiguity) outweighs the isolation benefit.

#### Per-Task Dev Environment Bootstrap

- area: tooling
- type: feat
- since: 2026-05-10
- size: L
- impact: med
- parent: parallel-worktree-workflow

Extend the worktree workflow with full per-task environment scaffolding: open IDE on the worktree folder/file, spawn a new terminal per task (already done), boot an internal web server scoped to the task's port, and start a local Charuy app instance per task. Today only the terminal spawn is automated; IDE focus and per-task app instances are manual. Goal: a single command takes an operator from "branch checked out" to "fully usable dev surface" without manual port-juggling. Pairs with the worktree port-per-tree convention from `docs/noldor/worktree-discipline.md`.

#### Dynamic FD ↔ File Pointers via Frontmatter

- area: tooling
- type: feat
- since: 2026-05-10
- size: L
- impact: high
- parent: noldor

Replace the manual `links.code` / `links.tests` / `links.docs` arrays in FD frontmatter with dynamic frontmatter on the source files themselves — each code/test/doc file declares its FD slug, and the FD's link arrays derive from a scan. Also: brainstorm with an LLM at FD-creation time to propose initial pointers from imports + community membership. Reduces drift between FDs and their backing files. Open question: keep the FD-side arrays as a cached projection for `pnpm validate:features` speed, or always scan? Trigger: when manual FD link maintenance overtakes the value of having explicit link arrays — likely once FD count exceeds ~50 or after a refactor produces N broken links across many FDs.

#### Version-Aware Upgrade and Migration Chain

- area: tooling
- type: feat
- since: 2026-06-11
- size: L
- impact: high
- deps: registry-distribution
- parent: noldor

`noldor init --update` re-pulls current templates, but nothing handles *schema* evolution between framework versions: FD frontmatter shape changes, `consumer:` config field renames, skill-twin contract changes, trailer-format changes. With one consumer that's hand-migration; with N consumers on mixed pinned versions it's the biggest structural risk of the multi-project goal. Build `noldor upgrade`: a version-aware chain that takes a consumer from its current framework version to the installed one by running ordered codemods.

**What to do:**

- Version anchoring: record the framework version a consumer was last migrated to — `.noldor/config.json` `frameworkVersion:` field (written by `init` and `upgrade`), compared against the installed package version. `doctor` gains a skew check: installed ≠ migrated → warn, point at `upgrade`.
- Migration registry: `src/migrations/<version>.ts` modules, each exporting `{ from, to, description, migrate(cwd, config), dryRun(cwd, config) }`. Migrations are pure file transforms over the consumer tree (FD frontmatter rewrites, config key renames, template re-syncs with content-preserving merges) — same codemod discipline the Charuy→standalone extract used by hand.
- `noldor upgrade` command: resolves the chain `frameworkVersion → installed`, runs each migration sequentially, `--dry-run` prints the planned diffs per step, writes `frameworkVersion` only after the full chain succeeds. Refuses on dirty git tree; recommends a branch.
- Authoring discipline: a framework PR that changes any consumer-facing schema MUST ship the matching migration in the same PR — enforce via a `/garden` detector or a release gate that diffs `feature-md-schema.md` / `consumer-config.ts` against `src/migrations/` coverage.
- Codemod tests: fixture consumer trees per from-version under `src/migrations/__tests__/fixtures/`, snapshot the post-migration tree. The [consumer-contract-ci](#consumer-contract-ci-and-headless-gate-e2e-harness) fixture doubles as the live test bed.

**What it enables:** the framework can keep evolving its schemas without freezing or hand-walking every consumer; consumers upgrade with one command and a reviewable diff; removes the "Charuy is three versions behind and nobody dares sync it" failure mode before it exists.

**Open questions:** migration granularity — per release version vs per schema-change id (lean per-release, matches semver discipline in `versioning.md`); downgrade support (no — document as unsupported); how template re-sync merges consumer-local edits to twin files (three-way merge vs ours/theirs prompt — connects to the existing skill-twin drift pain).

**Touches:** new `src/migrations/`, `src/cli/manifest.ts` (+`upgrade` group), `src/cli/commands/init.ts` (write `frameworkVersion`), `src/core/consumer-config.ts` (schema field), doctor checks, `docs/noldor/adoption-guide.md`, `docs/noldor/versioning.md`.

**Acceptance sketch:** fixture consumer pinned at v0.2.0 shape + installed v0.4.0 → `noldor upgrade --dry-run` lists 2 steps with diffs; `noldor upgrade` lands both; `doctor` green; re-run is a no-op.

#### Framework Milestones Support (POC / MVP / 1.0.0)

- area: tooling
- type: feat
- since: 2026-05-10
- size: M
- impact: med
- parent: noldor

Add a milestones layer to Noldor — tracking which features belong to which milestone (POC / MVP / 1.0.0 today; arbitrary names if `decouple-milestones-from-semver` lands first). Surfaces in `/triage` (proposed milestone per bullet), in FD frontmatter (`milestone: <name>`), in `/garden` (flag features whose milestone has shipped but phase is not done), and in dashboard pages. Pairs with `vision.md`'s current-milestone field.

- Optional, not mandatory — apps can grow organically without a milestone plan; the framework should not force the abstraction. When milestones are declared, the rest of the wiring activates; otherwise the field stays absent and detectors stay silent.
- Surface milestones on the dashboard web UI.
- Document where milestones live (the `/milestone` skill + `docs/milestones/<slug>.md`) — answers the recurring "where are milestones documented?".

#### Parallel-Drain `roadmap.md` Conflict Auto-Resolution

- area: tooling
- type: feat
- since: 2026-06-11
- size: M
- impact: high
- parent: parallel-drain

Under `--concurrency >1`, every fast-track child removes its own block from the shared `docs/roadmap.md`; the serialized merge coordinator rebases each PR onto the prior merge, but git cannot auto-merge *adjacent* block removals → the PR goes `DIRTY`, the coordinator skips it, and the worktree + open PR are orphaned. Hit live during a 23-entry drain: ~5 of the K=3 PRs went DIRTY, forcing a fall back to `--concurrency 1` (sequential is conflict-free by construction — each merges before the next branch is cut). Block-removal is deterministic, so the coordinator should re-apply "remove `<slug>`'s block" against the freshly-rebased base (parse + drop the block, not a textual 3-way merge) rather than letting git's line-merge fail. Without this, `--concurrency >1` is effectively unusable for roadmap-source drains. Touches: `src/autonomous/drain-io.ts`, `src/autonomous/drain-loop.ts`, `src/utils/parse-blocks.ts`.

#### Drain Startup Reconciliation of a Prior Dead Run

- area: tooling
- type: feat
- since: 2026-06-11
- size: M
- impact: high
- parent: autonomous-queue-drain-runner

When a drain dies mid-run (session pause / crash / SIGKILL) it leaves orphaned `fast/<slug>` worktrees, leftover branches, open PRs (clean *and* DIRTY), and a stale `.noldor/drain.lock`. Today a fresh drain does not reconcile these — the operator must manually merge clean open PRs, close/rebuild DIRTY ones, prune worktrees, and clear the stale lock (done by hand 3× in one session). Add a startup reconciliation pass: for each in-roadmap slug with an open PR, merge it when CLEAN (advance the oracle) or close + flag-for-rebuild when DIRTY; `git worktree prune` + remove orphaned `fast/*` worktrees whose slug is already shipped; reclaim a stale lock whose pid is dead. Makes the drain crash-recoverable instead of leaving a mess. Touches: `src/autonomous/queue-drain.ts`, `src/autonomous/drain-io.ts`, `src/autonomous/drain-lock.ts`.

- Add a startup sync-check: an un-pushed local-`main`-ahead-of-`origin` commit (e.g. a triage commit on local main but not origin) blocks the whole drain — but only *after* the gate already did the work and tries to retire the entry. Pre-flight `origin/main == queue-source` before spawning the first gate, and surface the divergence loudly instead of failing deep.
- Orphan agent children survive runner SIGTERM: killing the parent (`autonomous run`/`watch`) leaves the spawned `claude --print /gate` child running and holding context. Spawn the agent in its own process group and kill the group on runner death; at startup, reconcile (kill) any dead-run agent children before acquiring the lock.

### Trailer Scope-Alias Map

- area: tooling
- type: feat
- since: 2026-05-11
- size: S
- impact: high
- parent: noldor

`scripts/garden/detectors/trailer-scope-mismatch.ts` rejects commits where the Conventional Commits scope doesn't equal (or end with `:`) the `Noldor-FD:` slug. v0.4.0 release surfaced 24 such mismatches: `feat(sdd):` commits tagged to FD `sdd-co-tag-detector`, `feat(cr):` commits tagged to FD `noldor`, etc. — the team has informally adopted shorter scope tokens. Required `RELEASE_SKIP_GATE_COMPLIANCE=1` bypass. Fix: add a config-driven alias map (`scope-aliases.json` or detector frontmatter) where `sdd → sdd-co-tag-detector`, `cr → noldor`, etc., so the detector accepts the team's actual usage instead of demanding artificial scope expansion.

- triage 2026-05-11: relocated from `### UI Bugs & Polish` — misfiled at intake, semantically framework-scope.

#### `noldor autonomous status` + Robust Lock Read

- area: tooling
- type: feat
- since: 2026-06-11
- size: XS
- impact: low
- parent: autonomous-queue-drain-runner

There is no first-class way to ask "is a drain running, and where is it?" — operators read `.noldor/drain-state.json` + `.noldor/drain.lock` by hand, and a transient empty/partial read of the lock's `pid` field reads as "dead" (caused a live drain to be misjudged dead and interfered with mid-run). Add `noldor autonomous status`: report liveness from the actual process (`pgrep` / `kill -0` on the lock pid, with a robust JSON read) plus shipped / skip / in-flight from drain-state. Cheap operator-safety win that would have prevented the worst incident of the 2026-06-11 drain. Touches: `src/autonomous/drain-state.ts`, `src/autonomous/drain-lock.ts`, `src/cli/manifest.ts`.

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
- Codex CR gate unsatisfiable — 18 commits since v0.1.0 lack codex receipts; release needs `RELEASE_SKIP_CR_GATE=1` until codex CR is operationalized or pre-v0.1.0 commits are grandfathered.

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
- When checking an FD, also scan backlog for other candidates for the same FD → suggest a new FD with higher confidence so it stays useful later too.

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

#### Portable Gate Entrypoint for Non-Claude Runners

- area: tooling
- type: feat
- since: 2026-06-12
- size: M
- impact: high
- confidence: med

The autonomous drain's spawn layer is agent-agnostic (the registry resolves bin + argv for `claude` / `codex` / `opencode`), but the *prompt* it spawns is `/gate --drain <slug>` — a Claude Code slash-command. On `codex` (prompt via stdin, no slash-command system) the string is treated as literal text → no gate runs. On `opencode` it only works if a `/gate` command is vendored into `.opencode/command/` (not present). So the multi-runner promise stops short of the autonomous drain: only claude can actually drive the gate headlessly. Options: (a) a portable `noldor gate --drain <slug>` CLI entrypoint the drain spawns instead of a slash-command, with the agent CLI wrapping it; or (b) per-runtime vendoring of a `/gate` command alongside the existing skill. Pairs with `make-noldor-agent-agnostic` (shipped) and `real-codex-integration-smoke-test`. Touches: `src/autonomous/drain-source.ts`, the runner argv builders, gate skill/CLI surface.

#### Framework Script + Test Migration Cleanup

- area: tooling
- type: chore
- since: 2026-05-10
- size: M
- impact: low
- parent: noldor

Audit `scripts/` and the framework's test corpus to identify scripts/tests that were only needed during migration (FD frontmatter shape changes, gate path additions, garden detector rollouts) and can now be deleted. Conversely, identify gaps where shipped framework features lack test coverage. The migration-only scripts add maintenance load; the gaps add risk. One-pass sweep — possibly a `/garden` detector that flags scripts referenced only in commits with `chore(framework):` or `refactor:` migration messages and not in any current pipeline.

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

### Post-Queue Opportunities — Adoption, Autonomy & Verification

Strategic cluster drafted 2026-06-11 from a framework-wide evaluation that assumes the current queue ships. The queue buys internal hygiene; these buy what it does not — **adoption by other projects** (confirmed goal), **measurement**, **continuity of autonomy**, and **independent verification**. Larger and mostly interdependent (see each `deps:`); take to `/promote` + spec/plan when picked up. File order within the section is suggested priority.

#### Registry Distribution for the Noldor Package

- area: tooling
- type: feat
- since: 2026-06-11
- size: M
- impact: high
- parent: noldor

Today a consumer installs Noldor as a `file:` dependency and must keep a clone of `noldor/` as a sibling directory of their repo (README quick-start, `docs/noldor/adoption-guide.md` Bootstrap §1). That is the single hardest blocker for any project that is not on this machine. Publish the package to a registry so adoption starts with `pnpm add -D noldor`.

**What to do:**

- Package hygiene: audit `package.json` `files` / `exports` / `bin` so the published tarball carries `dist/`, `bin/noldor.mjs`, `templates/`, and the skill bundle — everything `noldor init` scaffolds from — and nothing else (no `graphify-out/`, no `docs/features/`). Verify with `pnpm pack` + a scratch-dir install.
- Decide registry: public npm vs GitHub Packages. Check name availability (`noldor` on npm); fall back to a scoped name if taken — scoped name ripples into `consumer-config` docs and `init` output, so decide before publishing anything.
- Extend `src/release/` so `pnpm release` gains a publish step (or a separate `release publish` subcommand): build → pack → publish with provenance, tag-driven, after the existing commit-tag-push succeeds. Must respect the existing release gates; publishing is the new last step, never runs on a dirty tree.
- `postinstall` review: today `lefthook install` runs on consumer install — confirm it behaves when installed from a registry tarball (no `.git` in the package, consumer's `.git` is the target).
- Docs: rewrite README Quick start and adoption-guide Bootstrap §1 for the registry path; keep `file:` documented as the contributor/dev path.

**What it enables:** any repo anywhere adopts without cloning the framework; precondition for [version-migration-chain](#version-aware-upgrade-and-migration-chain) (versions must be pinnable and resolvable) and for a credible [consumer-two-adoption-dogfood](#real-consumer-2-adoption-dogfood) on a machine that isn't this one.

**Open questions:** npm public vs GitHub Packages (private-first?); whether `templates/` ships in the tarball or `init` downloads them; semver tag → npm dist-tag mapping (`latest` only pre-1.0?).

**Touches:** `package.json`, `src/release/`, `bin/`, `README.md`, `docs/noldor/adoption-guide.md`, `docs/noldor/versioning.md`.

**Acceptance sketch:** fresh temp dir, `pnpm init && pnpm add -D noldor && pnpm noldor init && pnpm noldor doctor` → green, no sibling clone present.

#### Real Consumer #2 Adoption Dogfood

- area: tooling
- type: chore
- since: 2026-06-11
- size: M
- impact: high
- parent: noldor

Both existing consumers are degenerate cases: Charuy is the origin monorepo Noldor was extracted from, and self-host is the framework itself. Neither exercises the adoption path the way a foreign repo would. Adopt Noldor into one real, structurally different project (single-package repo, different domain, ideally an existing repo of the operator's with live development) and drive real work through it.

**What to do:**

- Pick the repo: criteria — actively developed, single package (not a monorepo, to stress the `lockstepPackages: [one]` shape), TS or close enough that stack assumptions hold (this dogfood validates the *adoption flow*, not yet the stack-portability — that's [stack-assumption-audit](#stack-assumption-audit-and-declared-prerequisites)).
- Run the documented path verbatim: install (registry if [registry-distribution](#registry-distribution-for-the-noldor-package) has shipped, `file:` otherwise), `pnpm noldor init --adopt`, fill `.noldor/config.json` `consumer:` block, `pnpm noldor doctor`. Every deviation from the adoption guide goes in the friction log — do not silently fix and move on.
- Drive ≥3 changes through the full lifecycle: one micro-chore, one fast-track, one specs-only or full feature with FD + spec. At least one of them via the autonomous drain (`noldor autonomous run --source roadmap`) end-to-end to PR merge.
- Maintain `friction.md` in the consumer repo during the run: every prompt that confused, every command that assumed Charuy/self-host context, every hard-coded path, every doc that lied. Date + exact error text.
- Close-out: `/triage` the friction log into Noldor's `ideas.md` → roadmap; fix the adoption-guide lies immediately (micro-chore class).

**What it enables:** ground-truth adoption backlog instead of speculation — this entry *generates* the precise work items for the rest of the adoption block; validates the guide line-by-line; produces the first consumer whose breakage matters for [consumer-contract-ci](#consumer-contract-ci-and-headless-gate-e2e-harness) fixture design.

**Open questions:** which repo (operator decision); whether the consumer keeps Noldor after the experiment or rolls back (rollback procedure is itself an undocumented gap — note it in the friction log).

**Touches:** nothing in-repo up front — output is the friction log plus triaged entries; immediate doc fixes touch `docs/noldor/adoption-guide.md`, `README.md`.

**Acceptance sketch:** friction log exists with ≥10 dated entries; ≥3 changes shipped in consumer incl. ≥1 autonomous drain ship; ≥5 entries triaged back into Noldor's queue.

#### Consumer-Contract CI and Headless Gate E2E Harness

- area: tooling
- type: test
- since: 2026-06-11
- size: L
- impact: high
- parent: noldor

164 unit-test files, zero end-to-end coverage of the flows autonomy actually depends on: the skill-markdown gate paths, drain loop against a real repo, init/upgrade against a real consumer tree. The PR #33 bug class (headless gate silently ignoring env-only signals) lived exactly in this blind spot and shipped broken. Build one harness that covers both needs: a fixture consumer repo as the *contract*, and headless skill-flow runs as the *e2e layer*.

**What to do:**

- Fixture consumer: a minimal single-package TS app (`fixtures/consumer/` in-repo, or generated into a temp dir by a builder script — temp-dir generation avoids fixture rot and `.git`-in-`.git` issues; lean that way). Contains: `.noldor/config.json`, a tiny `src/`, `docs/` skeleton with vision/roadmap/ideas, one seeded roadmap entry sized XS, lefthook wired. A builder util makes it a real git repo with an initial commit.
- Contract layer: CI job — install framework *from the working tree* into the fixture (`pnpm pack` + install tarball), run `noldor init`, `noldor doctor`, `noldor validate features`, `noldor garden detect`. Assert exit codes + key artifacts. Any framework PR that breaks this fails before merge — consumers are protected without being in the loop.
- Headless flow layer: drive real flows non-interactively and assert *outcomes*, not transcripts:
  - drain a seeded XS roadmap entry: `noldor autonomous run --source roadmap --max-features 1` → assert roadmap entry retired, commit carries `Noldor-Path: fast-track` + `Noldor-Reviewed-*` trailers, branch merged, worktree cleaned.
  - micro-chore and fast-track gate sessions: marker files written, scope validator accepts/rejects per the rules.
  - failure-path probes: dirty main, locked drain (`drain.lock` present), stale `fast/<slug>` branch (the salvage case) — assert the loop surfaces/parks instead of corrupting state.
- Agent-call seam: headless runs that would spawn an LLM agent need a stub mode (deterministic canned implementer/reviewer responses keyed by slug) so CI is hermetic + free; one opt-in non-stubbed nightly/manual lane runs a real model for true end-to-end (pairs with the existing roadmap entry "Real-Codex Integration Smoke Test" — same gating pattern, `NOLDOR_RUN_REAL_*=1`).
- Wire into CI config + `script-catalog.md`; failures must print the fixture-repo git log + `.noldor/` state for debuggability.

**What it enables:** framework changes can't silently break consumers (the contract half) or the autonomous paths (the e2e half); regression net for every PR-#33-class bug; the fixture doubles as the test bed for [version-migration-chain](#version-aware-upgrade-and-migration-chain) codemods and the demo ground for adoption docs.

**Open questions:** in-repo fixture vs generated-on-the-fly (lean generated); how the agent-stub seam is injected (env var + stub binary on PATH vs a `DrainSource`-style interface — the `DrainSource` seam from plan-runner suggests the pattern); CI provider/workflow file location for the standalone repo.

**Touches:** new `fixtures/` or `src/testing/consumer-fixture.ts`, CI workflow, `src/autonomous/` (stub seam), `docs/noldor/testing-principles.md`, `docs/noldor/script-catalog.md`.

**Acceptance sketch:** `pnpm test:contract` locally green in <5 min; intentionally breaking `consumer-config.ts` field name fails the contract job; drain e2e asserts trailers + retired entry on the fixture repo.

#### Stack-Assumption Audit and Declared Prerequisites

- area: tooling
- type: chore
- since: 2026-06-11
- size: S
- impact: med
- parent: noldor

Noldor hard-assumes its home stack: pnpm (`pnpmStderrPrefix` is literally a consumer-config field), lefthook, TypeScript + vitest, Conventional Commits, `gh` CLI, Claude Code as the driving agent. Opinionated is the stated posture ("opinionated, not configurable" — vision.md), but the opinions are currently *undocumented*, so a mismatched adopter discovers them one runtime error at a time, mid-gate.

**What to do:**

- Sweep `src/` + skills + lefthook templates for every environmental assumption: package manager invocations, hook runner, test runner, formatter (oxfmt), commit-format parsing, `gh` calls, Claude-specific paths (`.claude/`, skill names, transcript layout). Output: a prerequisites matrix — tool, where assumed, hard requirement vs swappable, failure mode if absent.
- Publish the matrix as a **Prerequisites** section at the top of `docs/noldor/adoption-guide.md`: "Noldor requires: pnpm ≥X, lefthook, vitest, Conventional Commits, gh, Claude Code. Not negotiable pre-1.0."
- Teach `noldor doctor` to check each prerequisite explicitly (binary present, version floor) and fail with the matrix link — adoption failures move from mid-gate mystery to minute-one diagnosis.
- Explicitly do NOT abstract anything in this entry — abstraction decisions (other package managers, other agents) stay with the existing `make-noldor-agent-agnostic` roadmap entry. This entry only makes the floor visible.

**What it enables:** honest adoption surface; failed adoptions fail fast at `doctor` with a named missing prerequisite; the matrix becomes the scoping document for any future portability work.

**Touches:** `docs/noldor/adoption-guide.md`, `src/cli/commands/doctor` checks, possibly `README.md`.

**Acceptance sketch:** removing `gh` from PATH → `doctor` names it + links the matrix; matrix lists ≥6 prerequisites with where-assumed pointers.

#### Agent-Events Log and `/agents` Dashboard Page

- area: tooling
- type: feat
- since: 2026-06-11
- size: M
- impact: high
- parent: project-tracking-dashboard

Operator cannot see which agents are running, on what, since when. `drain-state.json` is a best-effort heartbeat with slug + coarse phase, overwritten per run; prep fanout, plan-runner and CR-lane spawns aren't tracked anywhere. The dashboard already exists and is the right surface. Build the unified event log first — it is also the data spine for [outcome-telemetry](#outcome-telemetry-and-effectiveness-metrics).

**What to do:**

- Event log: append-only `.noldor/agent-events.jsonl`. Schema per line: `{ ts, run: <drain-run-id>, event: "spawned" | "phase" | "exited", kind: "drain-implementer" | "plan-runner" | "prep-drafter" | "cr-<lane>" | "merge-coordinator", slug, lane, pid, worktree, logfile, phase?, outcome?: "shipped" | "skipped" | "retry" | "escalated" | "failed", detail? }`. Writer util in `src/core/agent-events.ts` — best-effort like `writeState` (never throws into the loop), one JSON line per write, no rotation in v1 (size-cap note in v2).
- Instrument every spawner: drain loop + parallel pool (`src/autonomous/drain-loop.ts`, `queue-drain.ts` — spawn/phase/exit + retries), plan-runner source, `src/prep/spawn.ts`, CR lane runners in `src/cr/`. Each spawn writes `spawned` with its logfile path; exits write `outcome`.
- Keep `drain-state.json` as-is (cheap current-state projection); events are the history.
- Dashboard `/agents` page (`src/dashboard/`): **Live board** — currently-running agents (spawned without exited, pid-liveness-checked): kind, slug, lane, phase, runtime, retry count, merging indicator; link per row to a log-tail view (last ~100 lines of `logfile`). **Run timeline** — per drain-run grouped history: spawned→exited bars per agent, outcomes color-coded, shipped/skipped/escalated totals.
- Transport: poll every ~2s in v1 (matches existing dashboard JS simplicity); SSE upgrade noted as follow-up, not in scope.
- MVP fallback if sequencing demands: a `/agents` page reading only `drain-state.json` + `drain-k*.log` tail ships in days (size S) — but the event log is the part that compounds; don't ship the fallback alone unless urgent.

**What it enables:** the operator ask verbatim — see which agent is spawned and working; debugging K>1 parallel drains (today: one interleaved log); post-run audit without scrolling narrative logs; the event stream [outcome-telemetry](#outcome-telemetry-and-effectiveness-metrics) aggregates and the [continuous-drain-daemon](#continuous-drain-daemon-and-escalation-inbox) inbox consumes.

**Open questions:** pid liveness vs heartbeat events for crash detection (lean pid-check in v1); whether CR-lane subagents inside a single Claude session are observable as separate "agents" or only as phases of their parent (likely phases — be honest about granularity); gitignore `.noldor/agent-events.jsonl` (yes — operator-local, like `drain-k1.log` should be).

**Touches:** new `src/core/agent-events.ts`, `src/autonomous/drain-loop.ts` + `queue-drain.ts` + `drain-source.ts`, `src/prep/spawn.ts`, `src/cr/`, `src/dashboard/` (server route, view, static JS), `.gitignore`, `docs/noldor/script-catalog.md`.

**Acceptance sketch:** run `noldor autonomous run --concurrency 2 --max-features 2`; `/agents` shows 2 live implementer rows with distinct lanes, then a timeline with 2 shipped outcomes; events file has spawned/exited pairs for every agent incl. CR lanes.

#### Path Rename: docs/superpowers to docs/design

- area: tooling
- type: refactor
- since: 2026-06-11
- size: S
- impact: med
- parent: noldor
- recovered: 2026-06-11

Separable last step split out of `de-superpowers-vendor-spec-plan-and-worktree-flows` at its promotion: rename `docs/superpowers/` → `docs/design/{specs,plans}`. `src/core/doc-roots.ts:30-31` is the single code seam; everything else is prose/links. Ship as a migration (see version-migration-chain) that moves files and rewrites links; keep a transition alias in doc-roots for one release.

Touches: src/core/doc-roots.ts, src/migrations/

- Still using the superpowers worktree path → move specs/plan out of the `superpowers/` folder as part of this rename.

### Prefix Skills with noldor-

- area: tooling
- type: refactor
- since: 2026-06-12
- size: S
- impact: low
- confidence: med

Prefix the framework's skill names with `noldor-` to namespace them and avoid collisions with consumer-side or vendored skills.

### Dispatch Next Priority via Agent Window

- area: tooling
- type: feat
- since: 2026-06-12
- size: M
- impact: med
- confidence: low

Be able to dispatch the next-priority roadmap entry directly via an agent window — one action takes the top of the queue and kicks off work without manual slug lookup + command assembly.

### Code Reviewer 2.0

- area: tooling
- type: feat
- since: 2026-06-12
- size: L
- impact: med
- confidence: low

Next-generation code reviewer, taking inspiration from the MC Code Reviewer. Raise review quality beyond the current CR lane.

- Code-reviewer configuration for fast-track — let fast-track tune/scope the CR pass.

### sdd-report Review-Skip Count Non-Idempotent

- area: tooling
- type: fix
- since: 2026-06-12
- size: S
- impact: med
- confidence: med

The sdd-report review-skip count bumps per fast-track commit and re-fires the release gate once. Make it skip when only the count line changed.
