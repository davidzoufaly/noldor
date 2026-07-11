# Backlog

Parking lot for items not on the roadmap. Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and the roadmap ↔ backlog move, so references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

Dependencies are declared with a `- blocked-by: <slug|Q-id, …>` bullet (the entries this work waits on); `- deps:` is the legacy alias, still accepted and unioned with `blocked-by:` during the migration window. Prefer `blocked-by:` in new entries.

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

### Non-Claude Runner Parity Follow-Ups

- id: Q-0025
- area: tooling
- type: feat
- since: 2026-07-07
- size: M
- impact: low
- parent: noldor
- confidence: med

Three deferred pieces from the make-noldor-agent-agnostic decision (PR #71, three peer runtimes: Claude Code / Codex / opencode): (a) deep skill parity for non-Claude implementers; (b) opencode `--format json` event parsing (today reserved, treated as prose v1); (c) `crLanes` → role-ref vocabulary migration. Elective — pick up only when a non-Claude implementer runtime is actually exercised end-to-end.

### Agent-Events Log Rotation

- id: Q-0031
- area: tooling
- type: chore
- since: 2026-07-11
- size: S
- impact: low
- confidence: med

`.noldor/agent-events.jsonl` grows without bound (phase rows add ~4 lines per slug per run). Deferred from the /agents entry (spec D5): rotation adds file-swap complexity to a fail-open writer, so design size-or-age-based rotation (keep last N runs readable for the /agents timeline) as its own piece. Touches `src/core/agent-events.ts` and `src/dashboard/data.ts` readers.

### Embeddings Infra for the Framework

- id: Q-0032
- area: tooling
- type: feat
- since: 2026-07-11
- size: L
- impact: low
- confidence: low

One shared vector-embedding capability with two consumers: (a) FD/feature-description similarity (the semantic idea-merge path detector-5 dropped because "AST graph has no feature embeddings"), and (b) semantic (Type-4) code-duplicate detection — same-behavior/different-code clones the token/AST clone detector can't catch. Build once: an embed step over FD prose + code units, a vector store, and cosine-similarity queries feeding both the `/triage` merge shortlist and the clone signal. Speculative — no active trigger; revisit if deterministic token/AST clone detection proves insufficient or triage-merge noise justifies semantic ranking.

### Code-Clone Detector

- id: Q-0033
- area: tooling
- type: feat
- since: 2026-07-11
- size: L
- impact: med
- confidence: med

Token/AST-based Type-1/2/3 clone detection (copy-paste dups, à la `jscpd`). Deterministic corpus over `scanPaths`, no LLM. Surface duplicate blocks as a new signal in `sdd-report` + feed `/refactor`; optional CR-gate block above a configurable clone threshold. Fits the "deterministic detector + optional LLM triage" pattern (same shape as detector-5 idea-merge). Distinct from existing pieces: `/refactor` finds consolidation opportunities from god-nodes/cohesion but doesn't do line/token clone matching; `graphify` AST graph has structural similarity signal but no clone report. Semantic (Type-4) clones out of scope — that's the embeddings-infra entry.

### E2E Test Support

- id: Q-0034
- area: testing
- type: test
- since: 2026-07-11
- size: M
- impact: med
- confidence: low

Add end-to-end test support to the framework. Fuzzy one-liner — needs a spike to define scope (consumer-facing e2e harness vs self-host e2e coverage) before promotion.

