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

### Worktree .env.local Not Ignored

- id: Q-0079
- area: tooling
- type: fix
- since: 2026-08-10
- size: XS
- impact: high
- confidence: high
- parent: per-task-dev-environment-bootstrap

`pnpm noldor worktrees create` writes an untracked `.env.local` (`PORT=<assigned>`) that is not in `.gitignore`, so every fresh worktree starts with a dirty tree: `ensureCleanTree` counts `??` entries, so `pr-flow` preflight refuses to ship until the operator deletes a file the framework itself created. Fix: add `.env.local` to `.gitignore` (self-host + `templates/`), or have `worktrees create` write it only under an already-ignored path. (surfaced shipping Q-0073, PR #268)

### CR Receipt Amend Must Replace Same-Key Trailer

- id: Q-0080
- area: tooling
- type: fix
- since: 2026-08-10
- size: S
- impact: high
- confidence: high

Repeated `cr orchestrate --kind code` runs across amend rounds APPEND a second review-receipt trailer instead of replacing the existing one — the key is `Noldor-Reviewed-Subagent`, and a commit that went through N CR rounds carries N receipts, all but the last stale (each amend changes `HEAD^{tree}`). The pre-push hook validates against the tree, so a stale receipt is noise at best and a false pass at worst. Fix: the receipt amend should replace any existing receipt of the same key. Manual cleanup meanwhile: strip the old trailer lines from `git log -1 --format=%B`, amend with the cleaned message, re-run orchestrate. (surfaced shipping Q-0073, PR #268)

### SDD-Report Quote Normalization

- id: Q-0081
- area: tooling
- type: fix
- since: 2026-08-10
- size: S
- impact: high
- confidence: high

`sdd:report` quotes untriaged idea bullets verbatim into `docs/sdd-report.md`, so idea PROSE can redden two live-tree tests in `src/garden/__tests__/sdd-report.test.ts`: non-oxfmt markdown in a bullet (e.g. star-italics) fails the "writes oxfmt-compliant markdown" test, and a bullet naming the review-receipt key followed later on the line by the word "trailer" trips the omit-gate-compliance regex. Harden the seam: fmt-normalize quoted idea text in the report generator, and scope the test's negative assertion to the Gate-compliance section heading instead of a whole-document regex. (surfaced pre-release sweep 2026-08-10 — two ideas.md bullets moved into `#### Later` by PR #279 broke `pnpm verify` on main)

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

### Doctor Ahead-Anchor Dead End

- id: Q-0082
- area: tooling
- type: fix
- since: 2026-08-10
- size: S
- impact: med
- confidence: med
- parent: version-aware-upgrade-and-migration-chain

`doctor`'s framework-skew check compares the anchor by string `!==` (`src/cli/commands/doctor.ts:63`), so an anchor _ahead_ of the installed version prints `run 'noldor upgrade'` forever while `upgrade` correctly refuses to rewrite it backwards — an advisory dead end with no CLI exit, the same shape as Q-0076 in the opposite direction. Reachable after a downgrade (`pnpm add @david.zoufaly/noldor@<older>`) or a hand-edited anchor. Fix: compare with `semver.lt(anchored, installed)` and give the ahead case its own message (`anchored <a> is ahead of installed <i> — the install is behind, not the anchor`) rather than pointing at a command that cannot help. (surfaced in the code-stage CR of Q-0076, PR #270)

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
