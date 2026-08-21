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

- Operator framing of the same want, which widens the target past prior-art seeding: graphify integration is currently good enough for auditing an existing codebase but is not reached for while a design is being written, so the graph's community structure and export names inform nothing at spec time. Prior-art `--support` seeding is the one concrete use named so far, and the substrate it needs (community membership plus export names) is already in `graphify-out/graph.json`. Worth deciding, when this entry is spiked, whether the seam is only the seeder subcommand above or a broader "graph-at-spec-time" surface — the second is a different and larger entry, and inventing it before the seeder proves its ranking would be speculative. (raised 2026-08-17)

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

### Single Static Binary Distribution

- id: Q-0133
- area: tooling
- type: chore
- since: 2026-08-17
- size: L
- impact: med
- confidence: low
- blocked-by: Q-0117

Adoption assumes a TS/JS consumer with Node already present — `pnpm add`, `npx noldor`, `engines.node >=20` — which covers the entire current market. A self-contained executable (`bun build --compile`, Node SEA, or `deno compile`) removes that floor so a Go, Python or Rust repository could adopt the framework at all, and cuts hook startup further than a `dist` entrypoint alone. This is a packaging change and not a rewrite: 100% of the TypeScript source survives. Distinct from Q-0117 because all three of that entry's options answer which TS representation ships inside the npm tarball, and every one of them still requires Node on the consumer machine; this removes the requirement. Blocked on Q-0117 because the compiled-entrypoint decision is the prerequisite — there is nothing coherent to embed while `bin/noldor.mjs` boots `src` through `tsx`. Costs to weigh before promoting: a cross-platform release matrix (darwin and linux × arm64 and amd64) with per-target smoke tests, keeping the npm package as a thin wrapper so `npx noldor` and every existing consumer keep working, and deciding what happens to the `templates/` payload and any other file the CLI reads from its own package at runtime — an embedded filesystem or an extraction step, neither free. **Explicitly not sufficient for cross-language adoption on its own:** the checks still hardcode the TypeScript toolchain (`CODE_FILE_RE = /\.(ts|tsx|js|jsx)$/` in `src/core/repo-paths.ts:63`, `**/*.tsx` in `src/core/allowlist.ts:90`, the oxlint / oxfmt / vitest / tsc wrappers, dependency-cruiser import graphs), so pluggable per-language check adapters are the separate and larger prerequisite for a non-TS consumer to get value. Park until either that adapter work is on the queue or a concrete non-Node consumer asks. (raised 2026-08-17 assessing a Go-rewrite question)

### Consumer Root README Check

- id: Q-0140
- area: tooling
- type: feat
- since: 2026-08-17
- size: S
- impact: med
- confidence: low
- blocked-by: Q-0139

An adopted consumer gets no root README scaffold and no root README validation. `templates/` ships `docs/`, `AGENTS.md`, `lefthook/`, `lefthook.yml`, `opencode.json`, `.claude/` and `.opencode/` — there is no `templates/README.md` — and `docs/noldor/doc-conventions.md` states the README carries no auto-generated listing, so the file is unmanaged by design. Of the four mechanisms that touch a root README today only two reach a consumer at all: the internal-link check and the warn-only `pnpm test` rule-pair, plus SDD detector 12 if and only if the repository is a `packages/<prefix>-*` monorepo (live in charuy with 8 packages and a `### Packages` table, dead for every single-package consumer). That leaves the first document a human or a review agent opens as the one adopted surface the framework never inspects. Wanted, without taking ownership of the prose: a structural `doctor` or garden check asserting the README exists, its links resolve, it references the framework entry point (`docs/noldor/README.md`), and it names the repository's own registered doc surfaces. This is the consumer-side generalisation of Q-0139 and should follow it — the checks there are written against this repository's README shape first, and only the ones that survive contact with a foreign README belong in a consumer-facing gate. Park until Q-0139 ships or a consumer's stale README actually costs something. (found 2026-08-17 asking why PR #333 left the root README untouched)

### Module and Plugin Extension Model

- id: Q-0141
- area: tooling
- type: refactor
- since: 2026-08-17
- size: L
- impact: med
- confidence: low

Every framework surface is baked in, and each new one costs the same hand-wired set of touchpoints. Q-0093's architecture doc surface is the measured case: it shipped a page registry in code, a presence validator, a garden detector, an SDD gap slot, a release probe, a CLI subcommand in `src/cli/manifest.ts` and a dashboard route entry (Q-0134) — seven coupled edits for one surface, with the count restated across prose in six documents plus their `templates/` twins (the four-CR-round sweep recorded in `ideas.md`). The design surface, the queue documents and the traceability kinds each carry their own copy of that wiring. Wanted: one extension contract a surface declares itself through — identity, owned paths, validators, detectors, gap channel (advisory versus blocking, per Q-0136), CLI verbs, dashboard route, release probe — so registering a surface is data plus a small adapter rather than edits fanned across the runtime, and so prose counts derive from the registry instead of being asserted by hand. Scope questions to answer before promoting: whether third-party or consumer-authored modules are in scope at all or only first-party ones (the former drags in a stability contract, versioning and a trust boundary the framework has no story for); which existing surfaces are genuinely uniform enough to migrate versus which differences must stay explicit strategy data; and whether the seam is an internal registry only, since a public plugin API is a much larger commitment than the internal deduplication that motivates it. Related but distinct: Q-0133's pluggable per-language check adapters are a parallel adapter axis over the toolchain wrappers, not this registry, and Q-0109 to Q-0113 deepen individual internal seams rather than defining how a surface plugs in. Park until a third surface addition makes the repeated wiring cost concrete or the internal registry is wanted independently. (raised 2026-08-17 from an untriaged ideas bullet)

### Infra in the Framework — Deploy, Release Channels, Rollback

- id: Q-0151
- area: tooling
- type: feat
- since: 2026-08-20
- size: XL
- impact: med
- confidence: low

Noldor today owns the change up to the merge commit — gate, spec, plan, CR lanes, receipts, `pnpm release` for its own npm package — and stops there. Nothing in the framework models what happens to a consumer app or package *after* the merge: how it deploys, to which environment, on which channel, and how a bad deploy is undone. Open question worth exploring: should the framework grow an infra surface at all, and if so how thin. Candidate scope to argue about before promoting — (a) a declared deploy target set per consumer (`noldor.config` already carries `consumers`/paths, so environments could hang off the same schema); (b) release channels beyond the current single-track semver: `alpha` / `beta` / `next` prereleases for packages, plus a hotfix path that ships a patch off a release tag rather than off `main`; (c) rollback as a first-class verb — the inverse of a release, with the same receipt discipline (what was rolled back, from which sha to which, by whom, why), which the framework's trailer/receipt machinery is already shaped for; (d) whether deploys are *executed* by Noldor or merely *recorded* by it — recording is cheap, portable across CI systems and enough to feed metrics, executing drags in per-platform credentials, an environment model and a blast radius the framework has no story for. Strong prior that (d) should land on record-only first. Overlaps deliberately with Q-0152 (DORA metrics) — a deploy event stream is the shared substrate: the metrics entry consumes what this entry would emit. Park until a consumer's deploy pain is concrete rather than hypothetical; the framework has no deployed consumer app driving requirements yet.

### DORA Metrics

- id: Q-0152
- area: tooling
- type: feat
- since: 2026-08-20
- size: L
- impact: med
- confidence: low

Implement the four DORA metrics over the data Noldor already accumulates, surfaced on the dashboard alongside the existing metrics page. Sketch of where each measure comes from — **lead time for changes**: first commit on a `fast/<slug>` branch (or the FD's spec commit) to the squash-merge on `main`, both already in git history; **deployment frequency**: needs a deploy event stream, which is exactly what Q-0151 would emit — until then the closest honest proxy is `pnpm release` tags, i.e. package releases, not deploys, and the distinction has to be labelled rather than blurred; **change failure rate**: needs a failure signal to divide by — candidates are revert commits, hotfix releases, and red CI on `main` after merge, each with different noise; **time to restore**: interval from that failure signal to the fixing merge or rollback. Two design questions decide whether this is worth building: whether the framework's own repo plus a couple of dogfood consumers is enough sample size for the numbers to mean anything (a metric computed over ten merges a week mostly measures noise), and whether the failure signal can be derived or has to be operator-declared (a `Noldor-Incident:`-style trailer or an explicit CLI verb, which shifts cost onto the operator and decays the moment someone forgets). Prefer deriving from git plus CI first and adding a declared channel only where derivation demonstrably lies. Loosely blocked by Q-0151 for the deploy-frequency half; the other three metrics are computable from git and CI alone, so a first slice need not wait.
