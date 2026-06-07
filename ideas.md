# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); H3 categories group related entries

## Notes

## Priority

## Not groomed

## Verticals

### Business

#### Now

#### Next

#### Later

### Tooling

#### Now

- ať se to neptá na potvrzení cesty a na commitnutí specu -> automatish
- release pushes log -> gitignore?
- po vyběru cesty -> zbytečná otázka pro potvrzení
- next priority -> be able to dispatch next priority via agent window
- when checking FD also consider checking backlog/if there might be other candidates for the same FD so it can suggest new FD with higher confidence so it will be usefull also later
- milestones to dashboard web
- where are milestones documented?
- is gate function properly documented
- roadmap nové akce -> top and bottom
- add "remove" button from backlog and roadmap to action column rename it to "actions"

^^^^

- code reviewer 2.0 -> inspiration from MC Code Reviwer 
- code reviewer configuration for fast-track

release hardening (found shipping v0.2.0, 2026-06-01):
- codex CR gate unsatisfiable — 18 commits since v0.1.0 lack codex receipts; release needs RELEASE_SKIP_CR_GATE=1 until codex CR operationalized or pre-v0.1.0 grandfathered
- graphify writes cache to src/graphify-out/ when scanned on src -> breaks fmt:check every run (had to mv to /tmp 3x); make it write under graphify-out/ or exclude from fmt
- GARDEN_SRC_PATHS = apps/packages/scripts/ (not src/) -> garden-receipt freshness doesn't track this repo's source; mirror scanPaths
- every src-touching fast-track re-stales the graph (scanPaths=src) -> forces a graph-refresh sweep before each release; consider auto-regen in release or relax freshness for test-only diffs
- pnpm toon script omits required graph.json arg (bare `pnpm toon` fails; src/garden/graph-fd-lookup.ts tells users to run it)
- README Status section stale -> claims pre-extract, lives in Charuy monorepo; we're standalone now
- graphify-out/graph.html oxfmt churn ~41k lines/sweep -> gitignore graph.html or exclude from fmt
- .noldor/release-pushes.log not gitignored (operator-local release audit, like garden-receipt)
- sdd-report review-skip count non-idempotent: bumps per fast-track commit, re-fires release gate once (roadmap: skip-if-only-count-line-changed)

^^^

- de-claudification
- get rid of superpowers -> and disable them + other skills (consider handoff to autonomous mode)
- paraler development
    - agents monitoring ???
- top ten items roadmap / backlog items noldor
- agents foder -> agent rules, commands,..

#### Next

- still does it make sense to introduce SQL into a framework?
- CLI standalone tool

#### Later

### Core Product

#### Now


#### Next


#### Later
