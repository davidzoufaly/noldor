# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); every entry is a `### <Entry Name>` heading at one fixed level — never a `### <Category>` container (`validate:triage` errors on `empty-group-heading`)

## Notes

## Priority

## Not groomed

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

- **`pnpm noldor <cmd>` collapses a meaningful exit code to 1.** `split-check` and `lint-plan-snippets` document 0 = clean, 2 = signals present, 1 = infra error. `/noldor-gate` Step 0/2.5 and `/noldor-promote` step 1.7 tell the controller to run them through `pnpm noldor …` and branch on that code. But pnpm reports any failing script as exit 1: an oversized entry returned exit 1 through pnpm and exit 2 through `node bin/noldor.mjs noldor split-check --entry <slug>` (2026-09-22, Q-0250 promote). A controller that follows the prose reads "signals present" as "checker infra error, continue silently", which skips the split prompt the step exists for. Either run exit-code-bearing checks through `node bin/noldor.mjs`, or switch the contract to something pnpm cannot flatten, such as a stdout verdict line.
- **The spec structural-read step leaves a regenerated graph on the feature branch.** `noldor-spec` step 1.7 says to regenerate a stale graph (`/graphify --ast-only`, then `pnpm toon`) and retry. That rewrites the tracked `graphify-out/graph.json`, `GRAPH_REPORT.md`, `manifest.json` and both `.toon` files inside the feature worktree. On 2026-09-22, `graphify update .` (package 0.7.8) turned a 3,578-node graph into 10,562 nodes, a large unrelated diff that any later `git add -A` would carry into the PR. After the read, run `git checkout -- graphify-out/` and remove the untracked `graphify-out/.graphify_root`, or have the step write its regenerated graph somewhere untracked.

## Verticals

### Core Product

#### Now

#### Next

#### Later

## Triaged
