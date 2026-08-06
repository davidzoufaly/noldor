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

### Dashboard Port Collision Detection Across Projects

- id: Q-0057
- area: dashboard
- type: feat
- since: 2026-07-25
- size: S
- impact: high
- confidence: high
- parent: noldor

Multi-project dev setups (the framework repo plus consumer repos like charuy) each run their own `noldor dashboard server`, all defaulting to port 4321. The second server dies with `EADDRINUSE` and gives no signal whether the occupying process is *this* project's dashboard (safe to reuse) or a *different* project's (needs another port) — the agent has to `lsof -i :4321` and inspect the process cwd by hand to tell them apart. Fix: `dashboard server` / `dashboard ensure` probe the target port on startup, fetch a small identity payload from the running server (project root path or name), and compare against the current repo root. Match → treat as already running, no-op with a reuse message. Mismatch → auto-pick the next free port (4322, 4323, …) instead of crashing, and print which project owns the conflicting one. Also worth a `noldor dashboard status` that reports port + owning project without trying to bind.

### CR Review-Dimension Coverage

- id: Q-0060
- area: tooling
- type: feat
- since: 2026-08-05
- size: S
- impact: med
- confidence: high
- parent: code-reviewer-20

The CR review-dimension set has two coverage gaps. First, the built-in `fast-track` profile is `['correctness','security']` — fast-track is the XS/S no-FD lane, exactly where copy-paste lands, and it is the one lane with no `reuse` review at all; adding the dimension costs one entry in a low-effort pass. Second, side-effect/purity discipline is React-only prose in the engineering baseline and concurrency survives as a single clause inside the `correctness` guide string, despite the parallel drain running locks, PID liveness, and worktree contention. Both changes land in the same two files, so they ship as one entry rather than two conflicting fast-track PRs.

- add `concurrency` and `effects` to `reviewDimensionSchema` (`src/core/review-profile.ts`) plus one `DIMENSION_GUIDE` line each in `src/cr/lanes/subagent-dispatch.ts` — `ALL_DIMENSIONS` derives from the enum, so the `default` profile picks new dimensions up automatically.

### Checked-In Oxlint Config

- id: Q-0061
- area: tooling
- type: fix
- since: 2026-08-05
- size: S
- impact: med
- confidence: high
- parent: noldor

`.claude/engineering-rules.md` opens by claiming alignment with `.oxlintrc.json`, but no such file exists in this repo or in `templates/` — `pnpm lint` is a bare `oxlint --deny-warnings` running on defaults, so the documented contract is unenforced. Ship a checked-in config (self-host + template twin) with the `correctness` / `suspicious` / `perf` categories explicit. A real config also buys free machine coverage for two dimensions that are prose-only today: error flow (`no-empty` catch blocks) and concurrency (`no-async-promise-executor`, `require-atomic-updates`).

### Graph Staleness Gate Loud in CI

- id: Q-0062
- area: tooling
- type: fix
- since: 2026-08-05
- size: S
- impact: med
- confidence: high
- parent: doc-gardening-skill

Graph-consuming detectors skip with a single meta-gap when `graphify-out/graph.json` is older than the newest source file. Interactively that is the right call; in an autonomous drain nobody reads meta-gaps, so the detectors silently contribute nothing and the run still reports green. At minimum `garden-detect` should exit non-zero on the staleness meta-gap in CI mode; auto-regen is the stronger option if the regen cost is acceptable in that context.

### `noldor commit` Wrapper

- id: Q-0063
- area: tooling
- type: feat
- since: 2026-08-05
- size: S
- impact: med
- confidence: high
- parent: noldor

`$?` after `git commit ... | tail` is `tail`'s exit code, not git's, so a failed commit reads as successful and the files silently stay staged. The trap is documented in `docs/noldor/git-and-commits.md`, but documentation does not remove a foot-gun that fires during unattended drains. Ship a `noldor commit` wrapper that runs the commit and surfaces the real git exit code plus post-commit status. (surfaced PR #216)

### Publish `--access public` Invariant

- id: Q-0064
- area: tooling
- type: fix
- since: 2026-08-05
- size: S
- impact: med
- confidence: high
- parent: registry-distribution-for-the-noldor-package

npm `--provenance` on a never-published package requires `--access public`, even for an unscoped name — omitting it fails with EUSAGE "Can't generate provenance for new or private package". The publish spec and its test wrongly asserted the flag absent. Assert `--access public` as a publish-workflow invariant, and consider a CI dry-run publish on the release PR so the failure surfaces before a real `v*` tag is cut. (surfaced v1.0.1 publish)

### pr-flow Worktree Checkout Skip

- id: Q-0065
- area: tooling
- type: fix
- since: 2026-08-05
- size: XS
- impact: low
- confidence: high
- parent: framework-pr-flow-agent-auto-merge

Run from a feature worktree, pr-flow's post-merge `git checkout main` sync fails with `fatal: 'main' is already used by worktree at <main-workspace>`. The PR still merges, so the damage is cosmetic — but the error is noisy and local main is left unsynced. pr-flow should detect worktree context and skip or redirect the sync. (surfaced repeatedly, PRs #230-#237)

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
