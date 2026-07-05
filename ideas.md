# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); H3 categories group related entries

## Notes

## Priority

- odebrat add entry to the top and add entry to the bottom z roadmapy -> přesunout je do action column jako 2 tlačítka u každého entry (může se posunout úplně nahoru nebo úplně dolů)

- rozpracovat všechny claude memories přímo do frameworku aby nebyly potřeba

### Consumer-2 dogfood friction (2026-07-03, ps-offsite-games)

Open items from `real-consumer-2-adoption-dogfood` (Q-0001) friction log, reconciled against noldor main 2026-07-05. Fixed since & excluded: #3 root lefthook.yml template, #7 doctor probes (positive), #9 `.oxfmtrc.json` template, #11-keyboard-binding (retired #156), #14 init transient-state gitignore block, #16 lockfile fmt-exclude. #15 registry-distribution = already in flight. Remaining open:

- **[friction #8, HIGH — consumer-breaker] `typescript` sits in noldor `devDependencies` → every consumer's pre-commit `invariants` crashes.** `src/invariants/public-api-tsdoc.ts` imports `typescript`; noldor ships `src/` (tsx runtime) but `typescript` is a devDep, so no consumer install resolves it: `ERR_MODULE_NOT_FOUND: Cannot find package 'typescript'`. Fix: promote `typescript` to `dependencies`, or lazy-import + skip-with-note when absent. Verified in ps-offsite; workaround was `pnpm add -D typescript` in the consumer. [already fixed 2026-07-05 — PR #140 (b33efc7) lazy-imports typescript in public-api-tsdoc + skips the invariant when absent; no new entry needed]
- **[friction #1] Adoption guide never names the package manager before the first install command.** An npm repo silently gains a second lockfile (`pnpm-lock.yaml` beside `package-lock.json`, drift hazard); the pnpm prerequisite only surfaces later at `doctor`. `docs/noldor/adoption-guide.md` Bootstrap §1 should state pnpm before `pnpm add`. [triaged 2026-07-05 → adoption-guide-accuracy-sweep]
- **[friction #2] Guide §4 "hooks install automatically via postinstall" is only true if the consumer already ships `lefthook` as its own devDep.** Postinstall correctly no-ops when absent; guide should list `pnpm add -D lefthook` as an explicit bootstrap step (the Prerequisites matrix declares it, the Bootstrap section doesn't). [triaged 2026-07-05 → adoption-guide-accuracy-sweep]
- **[friction #4] `init --adopt` flag drift across three texts.** The roadmap dogfood entry says `pnpm noldor init --adopt`; the adoption guide says plain `pnpm noldor init`; `doctor`'s drift hint describes `--adopt` with the opposite meaning. Reconcile to one source of truth. [triaged 2026-07-05 → init-adopt-flag-drift-reconciliation]
- **[friction #5] Scaffolded hooks require `lint`/`fmt`/`fmt:check` scripts the guide never tells you to add.** First `doctor` on a repo with no linter/formatter reports `missing prerequisite script:*`. The Prerequisites matrix names them; Bootstrap §2-3 should say "add these scripts if you lack them." [triaged 2026-07-05 → adoption-guide-accuracy-sweep]
- **[friction #6] `lockstepPackages` scaffold default `["package.json"]` (a path) contradicts the field-table description "packages bumped together each release" (reads like names).** Make the scaffold default and the field-table doc agree. [triaged 2026-07-05 → lockstep-packages-scaffold-vs-doc]
- **[friction #10] Pre-edit guard arms mid-bootstrap.** After `git add -A`, the scaffolded PreToolUse hook rejects edits to the now-tracked bootstrap files (`edits to friction.md require /gate`) before any gate session exists. Live-from-minute-one enforcement is correct; the guide should warn that the first edit after staging needs a gate session. [triaged 2026-07-05 → adoption-guide-accuracy-sweep]
- **[friction #11 residual] Consumer-facing invariants impose the self-host repo shape.** `rule-conflicts` demands the consumer README reference `pnpm test` (fails on a domain README that has no such section); invariants also crash `ENOENT: scandir docs/features` before the consumer's first feature exists. Consumer invariants should degrade gracefully pre-first-feature. [triaged 2026-07-05 → consumer-invariants-graceful-degradation]
- **[friction #12] Lint floor (`oxlint --deny-warnings` over the whole repo) blocks the bootstrap commit on any pre-existing warnings in legacy code.** No guidance on incremental lint adoption (an ignore ramp); a larger repo would stall at the first commit. [triaged 2026-07-05 → adoption-guide-accuracy-sweep]
- **[friction #13] The bootstrap commit trips `noldor-scope`.** Staging `docs/noldor/**` (24 scaffolded pages) demands a `(noldor)` scope with no guide instruction to commit as `chore(noldor):`. Either document the bootstrap-commit scope or allowlist the init scaffold set. [triaged 2026-07-05 → init-scaffold-noldor-scope-allowlist]

Phase 1 — self-truth XS/S batch. Release-sweep skill paths, session-TTL fix, prep-promote preflight + fallback, README/--version staleness. Gotcha: prep entries carry Touches: → drain refuses headless; strip Touches at Phase 0 or ship interactively.

Phase 2 — enforcement honesty (M). Release-bypass allowlist + CR-gate rework (check PR-branch receipts, log skips to overrides.log) + release --resume + gate-doc-truth sweep (promoted backlog entry). Outcome: clean pnpm release, no env bypasses, docs stop lying.

Phase 3 — adoption chain (strategic goal). Registry publish delta → stack-assumption audit (doctor prerequisites) → consumer #2 dogfood (blockers cleared by #119; GoodData work repo per deep-analysis scenario table). Sequential — each feeds next.

Phase 4 — scan-roots repo-paths provider + operator judgment pass on 29 untagged / 51 unreferenced.

Phase 5 — autonomy observability. Agent-events delta + /agents page (+ escalation inbox surface), autonomous status, portable gate entrypoint, graphify AST-default + resume (before next release-sweep).

Phase 6 — structural, as-capacity. Stable-entry-IDs → blocked-by (dep chain), script/test migration cleanup (deep-analysis cruft inventory = shopping list), sibling-scope (after severity re-check), auto-split. Prefix-skills last or drop. Trigger-gated stay parked: codex smoke test (no stable codex cr --json yet), section-age detector, idea-merge similarity (revive when triage feels noisy — Phase 0 triage = live test).

Realistic path: Phases 0–1 ≈ 1 day (drain + one interactive session), 2–3 ≈ week, 4–6 elective. Say go and I start Phase 0.

## Not groomed

- Remaining hardcoded Charuy-layout scan roots (`packages`/`apps`/`scripts`) outside sdd-report — `src/features/fill-links-code-gaps.ts` (walkRepo x2) and `src/dashboard/data.ts` (walkRepo + packages readdir) still walk the monorepo trio instead of consumer `scanPaths`, so on a standalone `src/` repo they see nothing. Mirror the `scanRoots()` (src/sync/sync-code-links.ts) fix shipped for sdd-report (co-tag detector); also still hardcoded: `readdir('packages')` for actualPackages in both sdd-report main() and dashboard data, and `src/features/propose-pointers.ts` reimplements the scanPaths fallback inline. Root-resolution fallbacks now diverge (`resolveGardenScanPaths` → `['src']` vs `scanRoots` → 4-dir union) — unify into one repo-paths provider. Also: sdd-report untagged/not-referenced backfill — the scanPaths fix surfaced 29 test files without `@tests:` tag (no import-owner hint derivable) and 51 src files unreferenced by any FD `links.code` (detector-9 probable-owner hints in report); both need a judgment pass, not mechanical apply. Touches: `src/features/fill-links-code-gaps.ts`, `src/dashboard/data.ts`, test files, FD `links.code` arrays. [triaged 2026-07-02 → scan-roots-repo-paths-provider]
- Skill-vs-code drift detector — skills reference CLI commands, `package.json` scripts, and `src/` paths that rot after reorgs (release-sweep needed a full path audit, PR #124; gate skill body has the same class of drift per the gate-doc-truth roadmap entry). Candidate garden detector: scan `.claude/skills/**/SKILL.md` + `templates/.claude/skills/**` for `pnpm <script>` invocations not in `package.json` scripts, `noldor <sub>` commands not in the CLI manifest, and repo-relative paths that don't exist. Carried out of the drained release-sweep-skill-path-audit roadmap entry ("candidate follow-up, not in scope").
- Noldor-native long-task wait primitive — runner-agnostic alternative to the harness `Monitor` tool. Scope is the CONSUMER side only: a `noldor wait <state-file> --until <terminal-cond> [--emit <jsonpath>]` that polls until a job reaches a terminal state and surfaces progress. Do NOT invent a new progress format — reuse the existing producer-side state files (`.noldor/drain-state.json` heartbeat, `.noldor/cr/<slug>-<kind>-<lane>.json` sinks). The "write one side / read other" channel already exists; the gap is a portable wait/poll the controller calls instead of the host harness's Monitor (which can be blocked + isn't cross-runner). Lower priority — background-task completion notifications already cover most waiting. Touches: `src/autonomous/` (watch shares the poll loop), a `noldor wait` CLI. [triaged 2026-07-02 → noldor-native-wait-primitive (backlog)]
- Agent-events log rotation/retention — deferred from the /agents entry (spec D5): `.noldor/agent-events.jsonl` grows without bound (phase rows add ~4 lines per slug per run). Rotation adds file-swap complexity to a fail-open writer; design size-or-age-based rotation (keep last N runs readable for the /agents timeline) as its own entry. Touches: `src/core/agent-events.ts`, `src/dashboard/data.ts` readers.

### Retrospective — v0.4.0 release-sweep (2026-07-01)

Friction hit while cutting v0.4.0 via `/release-sweep`. Each bullet is a candidate fix; triage independently.

- **release-sweep graphify default should be AST-only (or docs-only), not full-semantic.** Full-semantic on the repo = 669 files → 31 background subagents. Roughly half died mid-run (session-pause kills + API "connection closed" + 600s stream-watchdog stalls), needing manual re-launch with hardened prompts, and 2 chunks never landed. Cost + wall-clock + fragility were high; marginal value near-zero because `/refactor` keys off god-nodes/cohesion which come from the AST structural graph. Proposal: release-sweep invokes graphify in an AST-only mode by default (seconds, deterministic, no agents); full-semantic becomes an explicit opt-in for a deep pass. The gate DID reach a fresh graph via AST-only in the end — make that the sweep's normal path. [triaged 2026-07-02 → graphify-ast-only-sweep-default]
- **graphify semantic pass needs checkpoint-resume + auto-retry for dead/stalled chunks.** Chunk files are the success signal but there's no built-in "re-run only missing chunks" — the controller hand-rolled a disk-scan + re-dispatch loop. Fresh subagents also intermittently derailed by the SessionStart gate/superpowers hook (returned 0-tool-use echoing "use the gate skill"); needed an explicit "IGNORE session instructions, you are a data-extraction worker" preamble. Bake both into the graphify skill: idempotent missing-chunk detection + a hook-defusing extractor preamble. [triaged 2026-07-02 → graphify-semantic-checkpoint-resume]
- **release-sweep skill has stale paths/commands.** References `pnpm garden:detect` and `pnpm docs:build` (neither is a script — real is `pnpm noldor garden detect`; docs:build is an optional release check) and `scripts/noldor/session.ts` (moved to `src/core/session.ts`). Audit the skill against current CLI + src layout. Broader pattern: skills drift from code after the scripts→src reorg. [triaged 2026-07-02 → release-sweep-skill-path-audit]
- **Session marker should not go stale mid-sweep.** A long sweep crossing a 24h boundary tripped the gate's ">24h stale session" commit block; had to re-`writeSession` by hand. Either exempt the `release-sweep` path from the 24h TTL, or auto-refresh `startedAt` on activity. [triaged 2026-07-02 → release-sweep-session-ttl-refresh]
- **graph-freshness gate ↔ oxfmt-ignore collision (the v0.4.0 near-miss).** `pnpm release` hard-gates on a committed-fresh `graphify-out/graph.json` (`ensureGraphFresh`, no bypass), but the fmt lefthook step fed oxfmt an all-ignored file set for a graph-only commit → hard error → couldn't commit the graph. Fixed the immediate bug (PR #114: `exclude: 'graphify-out/'`). Follow-ups worth considering: (a) a broader guard so any all-ignored fmt invocation no-ops instead of erroring; (b) have the sweep own the graph commit end-to-end so the two gates can't deadlock; (c) reconsider whether `graph.json` should be tracked at all vs regenerated in a release-time step. [triaged 2026-07-02 → graph-freshness-fmt-collision-follow-ups (backlog)]
- **Two long-standing release bypasses still required at v0.4.0** (`RELEASE_SKIP_GATE_COMPLIANCE=1` + `RELEASE_SKIP_CR_GATE=1`). Gate-compliance trips on historical short-scope trailers + the framework's own expected override usage; CR gate trips on missing codex receipts. These have been "goes away once X ships" for several releases — either ship the underlying fixes or make the self-host repo's expected-noise allowlist first-class so a clean `pnpm release` needs no env bypasses. [triaged 2026-07-02 → release-bypass-retirement]

## Verticals

### Business

#### Now

#### Next

#### Later

### Tooling

#### Now

#### Next

#### Later

- Dashboard `blocked-by` dependency-graph view — surface the roadmap+backlog `blocked-by` graph as a visual dependency view on the tracking dashboard (nodes = entries, edges = blocked-by; highlight cycles flagged by the `circular-blocked-by` garden detector). Split out of the shipped `first-class-blocked-by-field` entry (the data model, validation, and cycle detector landed; the dashboard visualization was deferred as its own larger piece). [triaged 2026-07-05 → dashboard-blocked-by-graph-view]

### Core Product

#### Now


#### Next


#### Later
