# Roadmap

Flat priority-ordered list (file order = priority). Every entry is a `### <Entry Name>` heading — **one fixed level, no grouping categories**. Writers (`/noldor-triage`, `/noldor-promote` residue, the dashboard add API) may never mint an `### <Category>` container with `#### <Entry>` children; a group heading carrying no entry is a `validate:triage` error (`empty-group-heading`).

Each entry carries a `- id: Q-NNNN` bullet — a stable ID minted at triage and never rewritten; it survives heading renames and roadmap ↔ backlog moves, so `blocked-by:` references target it, not the rename-fragile slug (the slug is a human-readable alias). See [triage.md → Stable entry IDs](noldor/triage.md#stable-entry-ids).

An entry may declare dependencies with a `- blocked-by: <slug|Q-id, …>` bullet (comma-separated) — the entries this work waits on. It feeds dependency-weight scoring, and `validate:triage` flags refs that resolve to no known entry (`unknown-blocked-by-ref`; advisory, error under `--strict`) while `/noldor-garden` flags circular chains. `- deps:` is the legacy alias, still accepted during the migration window and unioned with `blocked-by:`; prefer `blocked-by:` in new entries.

> **Routing policy — prep scales with `size:`. Don't spec the small ones.**
>
> - **XS / S** → no spec, no plan. `/noldor-gate` routes these to `fast-track` (code) or `micro-chore` (pure-doc) and retires the entry on ship — the drain-runner's bread and butter.
> - **M** → `specs-only` (spec, no plan).
> - **L / XL** → `full` (spec + plan), and only when there's real design risk — a mechanical L can still fast-track.
>
> Encoded once in [`sizeToPath()`](../src/core/size-routing.ts); `/noldor-gate` Step 0 surfaces the verdict as each entry's `suggestedPath`. Full matrix in [complexity-gating.md](noldor/complexity-gating.md).

### Release Preflight Aggregate

- id: Q-0068
- area: tooling
- type: feat
- since: 2026-08-05
- size: M
- impact: high
- confidence: med
- parent: release-sweep-process-hardening

Release prep aborts one gate at a time — stale `.noldor/session.json`, then stale graph, then stale garden receipt, then stale `docs/sdd-report.md` — and each abort costs a full re-run to discover the next one. Add a `release --preflight` first-rung aggregate that reports every failing gate at once and offers auto-remediation. (surfaced open-source publish, PRs #230-#237)

- probe npm name availability + moderation early, before tagging: npm new-package moderation blocks unscoped names too similar to popular packages (unscoped `noldor` was rejected as "too similar to `color`", forcing `@david.zoufaly/noldor`), so `noldor doctor` / preflight must check rather than let init and the docs promise a name nobody verified.

### Diff-Scoped Clone Gate

- id: Q-0066
- area: tooling
- type: feat
- since: 2026-08-05
- size: M
- impact: high
- confidence: med
- parent: code-clone-detector

`clones check` gates on whole-corpus `clones.thresholdPct`, which is unusable for consumers: the percentage drifts as the repo grows, nobody tunes it, so it stays unset and the check is permanently green. Add `noldor clones check --against <base-sha>` — fail only on clone groups with at least one instance inside the diff and at least one outside it, reporting the duplicated span (`src/foo.ts:12-40`). Diff-scoping needs zero tuning and is safe to default-on in `templates/lefthook.yml` pre-push.

- clone-duplication ratchet as an alternative or complement: record a baseline in `.noldor/clones-baseline.json` and fail only on an increase, so consumers adopt the gate with no tuning and the number can only go down.

### Spec-Lint Prior-Art Requirement

- id: Q-0067
- area: tooling
- type: feat
- since: 2026-08-05
- size: S
- impact: med
- confidence: med
- parent: de-superpowers-vendor-spec-plan-and-worktree-flows

`pnpm noldor design log --support` (Q-0053) already captures prior art into the design ledger, but nothing enforces that it was used — a spec whose ledger renders `Existing support (0) - (none recorded)` passes silently, which means the reuse question was never asked. Spec-lint should reject an approved spec with zero support anchors unless the operator records an explicit `--support "none: <reason>"`. The side benefit is that the CR `reuse` dimension gains a falsifiable claim to check against instead of reviewing in the dark.

### Prose Rules → Enforce Cascade Rules

- id: Q-0069
- area: tooling
- type: refactor
- since: 2026-08-05
- size: M
- impact: med
- confidence: med
- parent: rules-cascade-v1

The dimensions that are prose-only today sit buried in a 181-line baseline: error flow (result types, throw only for programmer errors, catch external at the boundary, never swallow) is at line 137 and is machine-unchecked. Migrate them into scoped rule files — `.noldor/rules/error-result-types.md` with `applies-to: ["src/**/*.ts"]`, `stage: [code]`, `enforce: true` — so the rule lands in the enforce bucket exactly on the files being edited rather than in a wall of text the author has to filter mentally. Same treatment for state discipline and concurrency.
