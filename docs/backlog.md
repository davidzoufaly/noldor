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

### Memory-Intake / Lessons-Learned Pipeline

- id: Q-0026
- area: tooling
- type: feat
- since: 2026-07-07
- size: M
- impact: med
- parent: noldor
- confidence: low

Systemic self-capture so the framework routinely absorbs ephemeral operator/agent knowledge into itself instead of depending on an out-of-repo assistant memory (the 2026-07-07 audit that produced Q-0019..Q-0025 was a one-time manual sweep). Design a lightweight intake: a place to drop a lesson/gotcha, a classifier (shipped-historical drop / gotcha → docs / actionable → roadmap-backlog / feedback → docs), and a `noldor` command that files it. Goal: framework stays self-aware and self-owned with zero dependency on any single assistant's private memory. Speculative — validate the manual sweep pays off before automating.

