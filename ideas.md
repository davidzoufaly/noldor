# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); H3 categories group related entries

## Notes

## Priority

## Not groomed

- Remaining hardcoded Charuy-layout scan roots (`packages`/`apps`/`scripts`) outside sdd-report — `src/features/fill-links-code-gaps.ts` (walkRepo x2) and `src/dashboard/data.ts` (walkRepo + packages readdir) still walk the monorepo trio instead of consumer `scanPaths`, so on a standalone `src/` repo they see nothing. Mirror the `scanRoots()` (src/sync/sync-code-links.ts) fix shipped for sdd-report (co-tag detector); also still hardcoded: `readdir('packages')` for actualPackages in both sdd-report main() and dashboard data, and `src/features/propose-pointers.ts` reimplements the scanPaths fallback inline. Root-resolution fallbacks now diverge (`resolveGardenScanPaths` → `['src']` vs `scanRoots` → 4-dir union) — unify into one repo-paths provider. Also: sdd-report untagged/not-referenced backfill — the scanPaths fix surfaced 29 test files without `@tests:` tag (no import-owner hint derivable) and 51 src files unreferenced by any FD `links.code` (detector-9 probable-owner hints in report); both need a judgment pass, not mechanical apply. Touches: `src/features/fill-links-code-gaps.ts`, `src/dashboard/data.ts`, test files, FD `links.code` arrays. [triaged 2026-07-02 → scan-roots-repo-paths-provider]
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

- Dashboard `blocked-by` dependency-graph view — surface the roadmap+backlog `blocked-by` graph as a visual dependency view on the tracking dashboard (nodes = entries, edges = blocked-by; highlight cycles flagged by the `circular-blocked-by` garden detector). Split out of the shipped `first-class-blocked-by-field` entry (the data model, validation, and cycle detector landed; the dashboard visualization was deferred as its own larger piece).

### Core Product

#### Now


#### Next


#### Later
