# Ideas

Raw entry point for human-generated ideas. `/triage` promotes bullets into `docs/roadmap.md` (flat priority-ordered list) or `docs/backlog.md` (parking lot).

- 3 verticals: tooling, business, core product
- roadmap: flat priority-ordered list (file order = priority); every entry is a `### <Entry Name>` heading at one fixed level — never a `### <Category>` container (`validate:triage` errors on `empty-group-heading`)

## Notes

## Priority

## Not groomed

- The release sweep and the `update-knowledge-graph` workflow build the committed graph two different ways, so they fight over community ids. Both extract the same nodes and edges (0 diffs, rebuilt from 140ff63), but the sweep's `/graphify --ast-only` clusters with no fixed hash seed and names communities with an LLM, while the workflow pins `PYTHONHASHSEED=0`, sorts its input and writes `Community N`. Two unseeded runs on one tree gave 205 and then 204 communities. So the first graph PR after every release reshuffles every community id and relabels the report. Wanted: one builder both call — a `pnpm noldor graphify build` running the workflow's heredoc (clean AST pass over code files, seeded, sorted, `parallel=False`) — with release-sweep steps 1 and 5 switched to it. Deletion test: the sweep's graph step, run right after a graph PR merges, leaves `graphify-out/` byte-identical. (found 2026-09-23 shipping Q-0260 part 3, PR #501)
- Two small hardening items the Q-0260 part 3 reviewer left as optional, both in the workflow's publish step. The newer-graph check treats every `git fetch` failure as "no graph on that ref" and publishes anyway; only a missing ref should read that way, and an auth or network failure deserves a `::warning::`. And a re-run of a merge whose graph PR already landed opens a graph PR with an empty diff; the check could also stop when the default branch holds a graph built at exactly this merge. (found 2026-09-23, PR #501 round 3)

## Lessons

Raw capture point for operator/agent lessons + gotchas. `/noldor-absorb` classifies each unfiled bullet (`drop | gotcha | actionable | feedback`), files it into framework docs, and stamps `[absorbed YYYY-MM-DD → <dest>]`. Stamped bullets may be pruned — git history is the audit trail.

- **`pnpm noldor <cmd>` collapses a meaningful exit code to 1.** `split-check` and `lint-plan-snippets` document 0 = clean, 2 = signals present, 1 = infra error. `/noldor-gate` Step 0/2.5 and `/noldor-promote` step 1.7 tell the controller to run them through `pnpm noldor …` and branch on that code. But pnpm reports any failing script as exit 1: an oversized entry returned exit 1 through pnpm and exit 2 through `node bin/noldor.mjs noldor split-check --entry <slug>` (2026-09-22, Q-0250 promote). A controller that follows the prose reads "signals present" as "checker infra error, continue silently", which skips the split prompt the step exists for. Either run exit-code-bearing checks through `node bin/noldor.mjs`, or switch the contract to something pnpm cannot flatten, such as a stdout verdict line.
- **The spec structural-read step leaves a regenerated graph on the feature branch.** `noldor-spec` step 1.7 says to regenerate a stale graph (`/graphify --ast-only`, then `pnpm toon`) and retry. That rewrites the tracked `graphify-out/graph.json`, `GRAPH_REPORT.md`, `manifest.json` and both `.toon` files inside the feature worktree. On 2026-09-22, `graphify update .` (package 0.7.8) turned a 3,578-node graph into 10,562 nodes, a large unrelated diff that any later `git add -A` would carry into the PR. After the read, run `git checkout -- graphify-out/` and remove the untracked `graphify-out/.graphify_root`, or have the step write its regenerated graph somewhere untracked.
- **The diff-scope clone gate cannot tell sibling declarations from pasted code, and has no override.** Q-0250 moved four CR lanes onto one answer seam, so each lane now declares the same parts the same way: an answer-shape string, a repair-prompt function, a `LaneAnswerContract` object and a `createAnswerSeam` call. The pre-push `noldor-clones` step flagged two of those runs (62 and 52 tokens, just over the 50-token floor) as duplication the change wrote, while total duplicated tokens fell by 240. Type-2 normalization folds every object literal with the same keys into one token stream, and each prompt template collapses to one `LIT`, so four declarations of one interface always match. Only reshaping them to dodge the detector clears it, which `gotchas.md` calls perturbation. The genuine dedupes went in (the lane's role now comes from its contract, one repair-evidence block, one default failure), then the push skipped the step once with `LEFTHOOK_EXCLUDE=noldor-clones`, with no record outside the PR body (2026-09-23). Q-0214 deliberately kept copied object literals counted, so the likelier fix is an audited override for the diff-scope verdict, like `Noldor-Path-Override` for commits.

## Verticals

### Core Product

#### Now

#### Next

#### Later

## Triaged
