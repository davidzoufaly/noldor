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

### Private-Package Org-Move + ps-offsite .npmrc Wiring

- id: Q-0024
- area: tooling
- type: chore
- since: 2026-07-07
- size: S
- impact: med
- parent: noldor
- confidence: low

Deferred config follow-ups from the private-GH-Packages switch (PR #168, v0.5.0 publish): (1) **Phase B** — wire the ps-offsite consumer's project `.npmrc` (`@davidzoufaly:registry=https://npm.pkg.github.com` + `//npm.pkg.github.com/:_authToken=${NPM_TOKEN}`) and a CI `NPM_TOKEN` secret with `read:packages`, then swap its dep to `@davidzoufaly/noldor` and install (blocked on a user-provided PAT with `read:packages`); (2) move the repo to the GoodData org, which re-scopes the package name and requires updating `publish.yml` scope + every consumer `.npmrc`. Both are operator/config tasks, no framework code.

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
