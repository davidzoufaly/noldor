# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); H3 categories group related entries

## Notes

## Priority

## Not groomed

- Noldor-native long-task wait primitive — runner-agnostic alternative to the harness `Monitor` tool. Scope is the CONSUMER side only: a `noldor wait <state-file> --until <terminal-cond> [--emit <jsonpath>]` that polls until a job reaches a terminal state and surfaces progress. Do NOT invent a new progress format — reuse the existing producer-side state files (`.noldor/drain-state.json` heartbeat, `.noldor/cr/<slug>-<kind>-<lane>.json` sinks). The "write one side / read other" channel already exists; the gap is a portable wait/poll the controller calls instead of the host harness's Monitor (which can be blocked + isn't cross-runner). Lower priority — background-task completion notifications already cover most waiting. Touches: `src/autonomous/` (watch shares the poll loop), a `noldor wait` CLI.

### Retrospective — v0.4.0 release-sweep (2026-07-01)

Friction hit while cutting v0.4.0 via `/release-sweep`. Each bullet is a candidate fix; triage independently.

- **release-sweep graphify default should be AST-only (or docs-only), not full-semantic.** Full-semantic on the repo = 669 files → 31 background subagents. Roughly half died mid-run (session-pause kills + API "connection closed" + 600s stream-watchdog stalls), needing manual re-launch with hardened prompts, and 2 chunks never landed. Cost + wall-clock + fragility were high; marginal value near-zero because `/refactor` keys off god-nodes/cohesion which come from the AST structural graph. Proposal: release-sweep invokes graphify in an AST-only mode by default (seconds, deterministic, no agents); full-semantic becomes an explicit opt-in for a deep pass. The gate DID reach a fresh graph via AST-only in the end — make that the sweep's normal path.
- **graphify semantic pass needs checkpoint-resume + auto-retry for dead/stalled chunks.** Chunk files are the success signal but there's no built-in "re-run only missing chunks" — the controller hand-rolled a disk-scan + re-dispatch loop. Fresh subagents also intermittently derailed by the SessionStart gate/superpowers hook (returned 0-tool-use echoing "use the gate skill"); needed an explicit "IGNORE session instructions, you are a data-extraction worker" preamble. Bake both into the graphify skill: idempotent missing-chunk detection + a hook-defusing extractor preamble.
- **release-sweep skill has stale paths/commands.** References `pnpm garden:detect` and `pnpm docs:build` (neither is a script — real is `pnpm noldor garden detect`; docs:build is an optional release check) and `scripts/noldor/session.ts` (moved to `src/core/session.ts`). Audit the skill against current CLI + src layout. Broader pattern: skills drift from code after the scripts→src reorg.
- **Session marker should not go stale mid-sweep.** A long sweep crossing a 24h boundary tripped the gate's ">24h stale session" commit block; had to re-`writeSession` by hand. Either exempt the `release-sweep` path from the 24h TTL, or auto-refresh `startedAt` on activity.
- **graph-freshness gate ↔ oxfmt-ignore collision (the v0.4.0 near-miss).** `pnpm release` hard-gates on a committed-fresh `graphify-out/graph.json` (`ensureGraphFresh`, no bypass), but the fmt lefthook step fed oxfmt an all-ignored file set for a graph-only commit → hard error → couldn't commit the graph. Fixed the immediate bug (PR #114: `exclude: 'graphify-out/'`). Follow-ups worth considering: (a) a broader guard so any all-ignored fmt invocation no-ops instead of erroring; (b) have the sweep own the graph commit end-to-end so the two gates can't deadlock; (c) reconsider whether `graph.json` should be tracked at all vs regenerated in a release-time step.
- **Two long-standing release bypasses still required at v0.4.0** (`RELEASE_SKIP_GATE_COMPLIANCE=1` + `RELEASE_SKIP_CR_GATE=1`). Gate-compliance trips on historical short-scope trailers + the framework's own expected override usage; CR gate trips on missing codex receipts. These have been "goes away once X ships" for several releases — either ship the underlying fixes or make the self-host repo's expected-noise allowlist first-class so a clean `pnpm release` needs no env bypasses.

## Verticals

### Business

#### Now

#### Next

#### Later

### Tooling

#### Now

#### Next

#### Later

### Core Product

#### Now


#### Next


#### Later
