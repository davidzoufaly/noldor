# Backlog

Parking lot for items not on the roadmap. Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and the roadmap ↔ backlog move, so references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

Dependencies are declared with a `- blocked-by: <slug|Q-id, …>` bullet (the entries this work waits on); `- deps:` is the legacy alias, still accepted and unioned with `blocked-by:` during the migration window. Prefer `blocked-by:` in new entries.

### Graph-Freshness / Fmt-Collision Follow-Ups

- id: Q-0011
- area: tooling
- type: fix
- since: 2026-07-01
- size: S
- impact: low
- confidence: med
- parent: noldor

Residual design follow-ups from the v0.4.0 near-miss (`pnpm release` hard-gates on committed-fresh `graphify-out/graph.json` vs fmt lefthook erroring on an all-ignored file set; immediate fix PR #114, broader all-ignored no-op guard shipped as `noldor fmt` in PR #184). Trigger: pick up only if the fmt/graph gate collision class recurs despite the PR #184 guard.

- (b) ~~have the release-sweep own the graph commit end-to-end so the two gates can't deadlock~~ — DONE: release-sweep step 6 commits `graphify-out/` before `pnpm release`.
- (c) reconsider whether `graph.json` should be tracked at all vs regenerated in a release-time step. Still parked.

Verified 2026-07-14 (gate pickup): trigger not fired — `src/core/fmt-guard.ts` maps all-ignored→exit 0 + release-sweep pre-commits graph; no collision recurrence since PR #184. Remaining scope = (c) only.

### Real-Codex Integration Smoke Test

- id: Q-0005
- area: tooling
- type: test
- since: 2026-05-10
- size: M
- impact: low
- parent: noldor

`src/cr/__tests__/codex.test.ts` mocks the `Spawn` function, so all CI runs of the codex lane validate the wiring without ever invoking the real `codex` binary. The first real-codex run will surface integration bugs the mocked tests can't catch (codex CLI flag drift, JSON schema variance, stdin-pipe encoding edge cases). Add a manual / opt-in smoke test (`pnpm noldor cr codex --dry-run` against a fixture worktree, gated behind `NOLDOR_RUN_REAL_CODEX=1`) plus a documented operator-side pre-release dogfood step in `docs/noldor/cr-pipeline.md`. Trigger: when codex CLI grows a stable `cr --json` subcommand (currently absent).

### Does SQL in a Framework Make Sense?

- id: Q-0007
- area: tooling
- type: feat
- since: 2026-06-12
- size: M
- impact: low
- confidence: low

Open question — does it make sense to introduce SQL into the framework? Explore use cases (dashboard queries, metrics, entry indexing) before committing.

### Embeddings Infra for the Framework

- id: Q-0032
- area: tooling
- type: feat
- since: 2026-07-11
- size: L
- impact: low
- confidence: low

One shared vector-embedding capability with two consumers: (a) FD/feature-description similarity (the semantic idea-merge path detector-5 dropped because "AST graph has no feature embeddings"), and (b) semantic (Type-4) code-duplicate detection — same-behavior/different-code clones the token/AST clone detector can't catch. Build once: an embed step over FD prose + code units, a vector store, and cosine-similarity queries feeding both the `/triage` merge shortlist and the clone signal. Speculative — no active trigger; revisit if deterministic token/AST clone detection proves insufficient or triage-merge noise justifies semantic ranking.

### E2E Test Support

- id: Q-0034
- area: testing
- type: test
- since: 2026-07-11
- size: M
- impact: med
- confidence: low

Add end-to-end test support to the framework. Fuzzy one-liner — needs a spike to define scope (consumer-facing e2e harness vs self-host e2e coverage) before promotion.

- Deep-audit 2026-07-13 (batch `.noldor/research/2026-07-13-184850`) sharpens the scope: a cold-consumer e2e — scripted `noldor init` on an empty repo, per runner (claude/codex/opencode), in the contract-CI harness (PR #99) — would have caught every consumer-facing finding of the audit (broken `../superpowers/specs/` template links, missing pre-edit-guard hook wiring, codex CR lane reading `.claude/engineering-rules.md`).

### Design Prior-Art Seeder

- id: Q-0070
- area: tooling
- type: feat
- since: 2026-08-05
- size: M
- impact: med
- confidence: low
- parent: de-superpowers-vendor-spec-plan-and-worktree-flows

`/noldor-spec` step 3 leaves prior-art discovery to agent discretion — "one `--support` per anchor you found while grounding" — which is unauditable: nothing distinguishes a thorough search from no search at all. A `pnpm noldor design prior-art --slug <s> --query "<description>"` subcommand would seed `--support` entries deterministically by unioning three substrates that already exist: FD `links.code` reverse lookup via `buildFileToFdsMap`, graphify community membership plus export names, and clone-corpus near-signature matching via `src/clones/tokenize.ts`. Parked rather than queued because the ranking quality of that union is unproven — spike it before committing. Trigger: pick up once Q-0067 (spec-lint prior-art requirement) is shipped and the manual `--support` path proves too noisy or too easily satisfied.

### Better Unit-Test Rules

- id: Q-0071
- area: testing
- type: docs
- since: 2026-08-05
- size: S
- impact: low
- confidence: low

Extend the project's unit-testing rules beyond what `docs/noldor/testing-principles.md` and the Tests section of `.claude/engineering-rules.md` cover today, using the review discussion on `gooddata/gdc-mastercard-panther#2542` as the source material. Fuzzy one-liner — the linked PR sits in a private repo and has not been read, so the actual delta is unknown. Trigger: read the PR and extract the concrete rules before promoting; without that, there is nothing to implement.

### Milestone-Queue Linking

- id: Q-0083
- area: tooling
- type: feat
- since: 2026-08-10
- size: M
- impact: med
- confidence: low
- parent: decouple-milestones-from-semver

Milestones (`docs/milestones/<slug>.md`) currently live independent of the queue — no way to say which roadmap/backlog entries belong to which milestone, or see milestone progress from the queue side. Link entries to a milestone (e.g. add a `milestone:` field to the schema-C parser — feature-MD frontmatter has one, but `BacklogEntry` in `src/utils/parse-blocks.ts` does not — or have the milestone doc list entry IDs) and add the reverse roll-up: dashboard/status compute milestone completion from its tasks.

### CR-Autofix Polish Residue

- id: Q-0084
- area: tooling
- type: fix
- since: 2026-08-10
- size: S
- impact: low
- confidence: med
- parent: specs-cr-gate-multi-reviewer

Residue from the Q-0075 ship (PR #276, CR rounds 9–16): (a) `DecideResult.baseSha` doc overstates its invariant — it is empty on ANY decline with git unreachable, not only `no-base-sha`; say "non-empty whenever verdict is auto-fix". (b) `no-base-sha` fires before `next` is known, so a MIXED round with git unreachable declines to operator even though `apply-then-stop` never needs a base-sha — forfeits an applicable mechanical subset on an unrelated failure. (c) `round: 3/2` prints on the round-cap decline (`priorRounds.length + 1` unconditionally) — clamp or relabel. (d) `prior-deferred` scanning every round leaves the seam dead for the rest of the session after one MIXED round, including the operator's own full-review follow-up where the laundering path cannot occur; the only reset is session end — deliberate, but say so in the docs or narrow it. (e) drain-mode/SKILL twins mention `record` without naming the exit-2 `--deferred` cross-check. All in `src/cr/autofix.ts` / `autofix-cli.ts`.

### Upgrade Empty-Chain Dirty-Tree Guard

- id: Q-0085
- area: tooling
- type: chore
- since: 2026-08-10
- size: XS
- impact: low
- confidence: med
- parent: version-aware-upgrade-and-migration-chain

`noldor upgrade` writes the framework anchor on the empty-chain path before the dirty-tree guard (`src/cli/commands/upgrade.ts:90` vs the `isDirty` check below it), so a dirty tree silently gets `.noldor/config.json` mutated while the non-empty-chain path refuses with `refusing to upgrade on a dirty git tree`. Pre-existing for the bootstrap case, broadened to the stale-advance case by Q-0076; deliberately left as-is because hoisting `isDirty` would make a pure `nothing to do` invocation throw on any dirty tree, and gating only the write would re-strand the very consumer Q-0076 unstrands. Decide whether the asymmetry is intended and say so in the code, or gate the write with a narrower guard. (surfaced in the code-stage CR of Q-0076, PR #270)

### Skill-Surface Pruning Audit

- id: Q-0086
- area: tooling
- type: chore
- since: 2026-08-10
- size: S
- impact: low
- confidence: low

Evaluate removing vendored skills whose value is unclear — candidates raised so far: `noldor-absorb` (lessons intake; overlaps `/noldor-triage` + manual filing?) and `noldor-new-feature` (blank-FD scaffold; overlaps `/noldor-promote`?). For each: measure actual usage, list what breaks without it, and either retire the skill (+ template twins + catalog entries) or document why it stays.

### Spec Brainstorming Depth Parity

- id: Q-0092
- area: tooling
- type: feat
- since: 2026-08-11
- size: M
- impact: med
- confidence: low
- parent: de-superpowers-vendor-spec-plan-and-worktree-flows

Brainstorming through the vendored `/noldor-spec` question-first loop does not reach the depth the superpowers `brainstorming` skill gets to — the de-superpowers vendoring preserved the flow's shape but apparently not its interrogative pressure. Fuzzy one-liner: the actual delta between the two prompts has not been diffed, so there is nothing concrete to implement yet. Trigger: run both over the same idea, diff the transcripts, and extract the specific moves the vendored version drops before promoting.

### Consumer Architecture Doc Surface

- id: Q-0093
- area: docs
- type: feat
- since: 2026-08-11
- size: M
- impact: med
- confidence: low

Consumers get feature MDs, specs, and plans but no architecture surface — no place that answers "how is this system shaped" above the per-feature level. Idea: a dedicated folder of architecture file(s) in the consumer doc tree, with diagramming. Needs a scoping spike before promotion: whether the content is hand-authored or derived from the graphify AST graph (which already has communities and edges), whether the diagrams are generated or drawn, and how the surface avoids becoming the stalest page in the tree.

- The same gap holds for Noldor itself, and the scoping spike should decide whether one surface serves both or whether framework-internal architecture is a separate promotable item. The repo has rich feature docs and 107 design artifacts but no root `CONTEXT.md`, no module map and no `docs/adr/`, so maintainers and agents infer current architecture and rationale from 47k runtime LOC plus historical specs whose links are already stale (Q-0098). That makes unusual but intentional constraints — source-at-runtime packaging, adoption-safe advisories, sequential queue writes, graph fallbacks — read as accidental bugs, while genuine cross-module seams such as repository mutation (Q-0109) and snapshot ownership (Q-0110) stay implicit. Wanted: a concise current map in the project's own domain vocabulary showing major modules, dependency direction, durable state, entry points, and where each decision record lives, plus ADRs for active consequential choices rather than backfilled history. Deletion test: a new reader should not have to traverse archived plans to answer "which module owns repository paths, writes, and review completion?" (architecture candidate, Worth exploring from the read-only audit 2026-08-12)

### Multiagent Parallel Session Visibility

- id: Q-0114
- area: tooling
- type: feat
- since: 2026-08-12
- size: L
- impact: med
- confidence: low
- parent: parallel-worktree-workflow

Multiagent operation already works in practice — several branches, several worktrees, several terminal tabs at once — but nothing surfaces it: the dashboard and the agents tab still describe a single-session world, so the operator cannot see which agent holds which worktree or branch. Make that state visible and keep it model-agnostic, so a claude, codex or opencode session all register the same way. Parked at the operator's explicit request rather than on score.

### CLI Command Definitions and Trusted-Input Adapters

- id: Q-0115
- area: tooling
- type: refactor
- since: 2026-08-12
- size: L
- impact: med
- confidence: low

`src/cli/manifest.ts` knows dispatch targets and one-line descriptions, while individual handlers separately own detailed usage, flags, defaults, capabilities and validation. The dispatcher intercepts subcommand `--help`, which makes handler usage strings unreachable and breaks the base-SHA probe (Q-0112); ad-hoc argv loops differ silently; several path-building commands omit the shared slug guard (Q-0097). Move enough metadata and parse policy into a single command definition that help, dispatch, capability introspection and validation cannot drift, keeping implementation modules behind a stable seam, and route every external slug-shaped value through the same canonical adapter before any IO regardless of whether the caller is the packaged CLI or a library consumer. Deletion test: handler-local usage copies, copied slug regexes, `process.argv.find` loops and self-shelling help probes all go. Avoid a framework-heavy parser dependency unless the current manifest cannot generate the required behaviour with less code. (architecture candidate, Worth exploring from the read-only audit 2026-08-12)

### Design-Artifact Detector Module

- id: Q-0116
- area: tooling
- type: refactor
- since: 2026-08-12
- size: S
- impact: low
- confidence: med
- parent: doc-gardening-skill

The largest clone in the repository sits wholly inside `src/garden/garden-detect.ts`: 388 tokens across 107 lines between stale-plan and stale-spec detection. Both implementations enumerate dated markdown, derive a slug, resolve ownership by feature filename then `links.*` then graph adjacency, then apply feature-phase and age policy and emit an archive finding; they differ only in artifact kind, path resolver, link relation and wording. Express those differences as small adapters around one ownership-and-age implementation, so archive-policy fixes and graph-fallback changes stay identical for specs and plans and adding a third design-artifact kind becomes deliberate rather than copied. Deletion test: two 100-plus-line functions collapse to one loop and two shallow strategies, while specific exported result types survive if callers benefit. Run the same behavioural matrix against both kinds: live owner, done owner, attach-name link owner, graph-only owner, stale orphan, recent orphan, missing directory. (architecture candidate, Worth exploring from the read-only audit 2026-08-12)

### Package Runtime Representation ADR

- id: Q-0117
- area: tooling
- type: chore
- since: 2026-08-12
- size: M
- impact: low
- confidence: low
- parent: noldor-package-lift

The published package ships two full runtime representations plus development-only tests and fixtures: `package.json.files` includes both `dist` and `src`, and `bin/noldor.mjs` registers `tsx/esm/api` and executes `src/cli/index.ts`, so compiled `dist` is not the active runtime while the source inclusion also captures test suites. Measured with `npm pack --dry-run --json --ignore-scripts` on an isolated cache: 2,531 entries, 2.12 MB compressed, 11.26 MB unpacked, both trees present. Not automatically a bug — the archived package-lift design deliberately chose source-at-runtime, and compiled manifest strings still reference `.ts` paths — but it is measurable install, bandwidth and attack-surface waste plus two representations that can drift. Revisit the distribution decision as an explicit ADR rather than an opportunistic cleanup, comparing three approaches with packed-consumer smoke tests: (1) keep the TypeScript runtime but publish only runtime source, templates and bin, excluding tests, fixtures and dist; (2) make dist canonical, rewrite manifest and module resolution for `.js`, and drop tsx and source from the package; (3) keep both only if a real supported import or debug workflow requires it, and enforce build/source parity. Explore (1) first — smallest migration, behaviour preserved — then quantify cold-start, install and security differences before considering (2). Deletion test: one complete runtime tree and one module-resolution policy remain in the tarball. Risk: package-lift chose the current shape for portability, so any change needs clean `npm pack` install, CLI, hook and dashboard tests plus a compatibility statement for consumers importing undocumented source paths. (architecture candidate, Speculative because it conflicts with archived design, read-only audit 2026-08-12)

### Portable Timeout Audit for Supervisor Loops

- id: Q-0120
- area: tooling
- type: chore
- since: 2026-08-12
- size: XS
- impact: low
- confidence: med

macOS ships no `timeout` and no `gtimeout` unless coreutils is installed, so any hand-written supervisor loop that copies the drain's per-iteration timeout gets `command not found` and — with `set -uo pipefail` but no `-e` — silently runs its children UNBOUNDED. The portable shape is to background the child, background a `( sleep N; kill -0 $child && pkill -P $child; kill -TERM $child )` watchdog, `wait $child`, then kill the watchdog. Two deliverables: audit whether `src/autonomous` (or any shipped script, hook or template) depends on a GNU-only binary for the same reason, and record the portable watchdog recipe in `docs/noldor/gotchas.md` so the next hand-rolled runner starts from it. Parked rather than queued because no framework code path is confirmed affected — the failure was in an ad-hoc runner. (surfaced draining the 2026-08-12 XS batch)

### Caveman Output Mode in Noldor

- id: Q-0128
- area: tooling
- type: feat
- since: 2026-08-14
- size: S
- impact: low
- confidence: low

Open question — should the terse, article-free "caveman" response style become a Noldor-owned concern rather than one operator's user-level global skill? The argument for is reproducibility: the token-compression posture would survive a fresh machine, apply to any consumer, and hold across claude, codex and opencode instead of depending on private config. The argument against is that Noldor's posture is about discipline and traceability, not about an agent's voice, and presentation policy inside the framework invites every consumer to want their own. Speculative with no trigger — park until a consumer actually asks for it, or until the global-skill version demonstrably fails to carry into an autonomous drain.
