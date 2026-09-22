# Self-Refreshing, Compact Knowledge Graph — Design

**Slug:** self-refreshing-compact-knowledge-graph
**FD:** docs/features/self-refreshing-compact-knowledge-graph.md
**Date:** 2026-09-22
**Tier:** full
**Deps:** none

## Problem

The committed knowledge graph is stale, and the thing that keeps it stale is the cost of refreshing it. `pnpm noldor design graph-context` returns `status: stale` on this very branch, which is how this spec's own structural-context step was blocked. The remedy the message prints — `/graphify --ast-only` then `pnpm toon` — rewrites `graphify-out/graph.json` (4.1 MB), both `.toon` files and `manifest.json`, all five of which are tracked. Landing that inside an unrelated feature PR buries the reviewable diff, so the rational move for any individual PR is to skip it. Every PR making that rational choice is why the graph drifts, and a stale graph silently degrades every consumer that reads it: `graph-context`, the garden staleness detectors, and `/noldor-refactor`.

The second cost is per-read rather than per-write. `graphify-out/graph.brainstorm.toon` is 697 KB for 3578 nodes, in a format with no table of contents, so an agent wanting one community's topology has no way to fetch less than the whole file. Both costs point the same way: the graph should refresh itself where the diff is nobody's review burden, and should be cheap enough to read that agents actually read it.

Whether the two halves genuinely belong in one change, or whether the CI half should ship alone first, is an open question (D1).

## Goals

- Regenerating the committed graph is not a human's job and does not appear in a feature PR's diff.
- An agent can read one community's topology without loading the whole `.toon` file.
- The `.toon` output gets materially smaller at the same information content — the measured target is roughly a 60% reduction (697 KB → ~270 KB), inferred from panther's v3 output holding 3492 nodes in 269 KB.
- Regenerating on CI and regenerating locally produce the same bytes, so the two never fight each other.

## Non-goals

- Per-domain or per-package graphs. One whole-repo graph stays the shape; the root `graphify-out/graph.json` path is load-bearing for `graph-context`, the garden detectors and `/noldor-refactor`.
- The repo-wide `localeCompare` locale sweep (filed separately in `ideas.md`). This spec pins the collator **only** in the file it rewrites, because CI-vs-local ordering churn would defeat the feature outright; the other 43 call sites are someone else's change.
- Changing `graph.json`'s schema, or anything about how graphify extracts it. This feature reads that file and writes text.
- Fixing `deriveCommunityLabel`'s poor showing on `src/`-only repos beyond what U4 needs (see Risks).

## Design

### Structural context

`src/graphify/graph-to-toon.ts` sits in **community 85** (17 nodes), whose label is `graph-to-toon.ts · hyperedgeMembers() · shortenPath()` — the file's own functions and nothing else. It defines no god node and sits on no cross-community edge in the committed graph's top-25 list. It is interior, which is the good case for a rewrite: the blast radius is the file plus its one CLI entry point. `src/templates/manifest.ts` sits in **community 32** alongside `templateFiles()`.

noldor:cut the digest above is read from the committed `graphify-out/graph.brainstorm.toon`, which `graph-context` reports as stale; regenerating it here would put a 4 MB diff in this feature's PR, which is the exact cost this feature exists to remove. A fresh reading would change the answer only if `graph-to-toon.ts` has gained cross-community edges since the last sweep.

### U1 — The workflow template

A new `templates/.github/workflows/update-knowledge-graph.yml`. Two mechanical facts make this cheap: `templateFiles()` in `src/templates/manifest.ts` is a plain recursive directory walk, so a new file under `templates/` is picked up by `init`, `doctor` and `check-template-sync` with no registry edit; and dotfile directories under `templates/` do ship through npm (verified — `templates/.claude`, `.opencode` and `.noldor` all arrive in a consumer's `node_modules`). This is the first `.github` file noldor has ever shipped, which is a deliberate posture change.

The path is added to `SCAFFOLD_ONLY_TEMPLATES`, joining `lefthook.yml` and `.oxlintrc.json`. A CI workflow carries repo-specific values — runner labels, the Python and Node versions, whether a bot token is needed — so noldor writes it once and the consumer owns it afterwards. Scaffold-only also stops `init --adopt` from snapshotting noldor's *own* `.github/workflows/` back into the template directory.

### U2 — What the workflow does

Modelled on `gdc-mastercard-panther/.github/workflows/update-knowledge-graphs.yaml` at revision `02f3541`, minus its domain matrix (noldor has one graph, not two). It triggers on a merged PR into the default branch, installs Python plus a pinned `graphifyy`, regenerates the graph, runs `graph-to-toon`, and verifies the outputs exist and that `graph.json` parses.

It then commits, opens a PR and auto-merges it — it does **not** push to the default branch. That is not a stylistic preference: `src/hooks/noldor-pre-push.ts` blocks `refs/heads/main` outright to enforce "all paths land on main via PR", and no hook honours a `CI` or `GITHUB_ACTIONS` escape. Since `postinstall` runs `lefthook install`, any job that installs dependencies has live hooks, so a direct push would need `--no-verify` or `LEFTHOOK=0` baked into a template noldor ships to every consumer — teaching them to bypass the gate the framework exists to enforce. That posture binds every CI file noldor ships from here on, not just this one, so it is recorded as [ADR 0002](../../adr/0002-shipped-ci-templates-route-through-pr.md).

**One branch, one PR, one run at a time.** The workflow declares `concurrency: { group: knowledge-graph, cancel-in-progress: true }` and always targets a single fixed branch, `noldor/graph-refresh`, force-updating it rather than branching per run. Three problems collapse into that one choice. Two merges landing close together cannot open two PRs, because there is only ever one branch and therefore at most one open graph PR, force-updated in place. A superseded run is cancelled rather than left to race, which is safe because the run's only side effect is the final push — everything before it is computation against a checkout. And where auto-merge is unavailable (D6) the pending PR count is bounded at one instead of growing per merge.

**The graph is generated from the tree it is committed against.** The job checks out the merge commit by explicit sha rather than by branch name, and records it. Before pushing it re-reads `origin/main`; if the tip has moved past the recorded sha, the run restarts from the new tip instead of pushing. The invariant is that `noldor/graph-refresh` is always exactly one commit ahead of some real `origin/main` sha, carrying output generated from that same sha. Panther's re-fetch-and-rebuild loop is the same idea, adapted: its version re-pushes to `main`, this one force-updates a branch.

**Permissions are declared and minimal:** `contents: write` to push the bot branch and `pull-requests: write` to open and merge the PR. Two repository-level facts the template cannot set for the consumer, and must therefore document: auto-merge has to be enabled in repository settings for `gh pr merge --auto` to work at all, and a PR opened with the default `GITHUB_TOKEN` does not trigger other workflows — so a consumer whose required checks must run on the graph PR needs a PAT or an app token instead. Where neither is configured, the PR simply waits — bounded at one, by the single-branch rule above (D6).

The trigger mirrors panther's: a merged PR whose title carries a `feat`, `fix` or `refactor` prefix. Panther's label-driven domain matrix is the one part dropped, since noldor has a single graph rather than `fi` and `mic`. Over noldor's last 200 commits that filter runs on 121 (fix 73, feat 43, refactor 5) and skips 77 (docs 46, chore 31). Skipping is safe because the filter is self-healing: a `chore` that did move the graph is picked up by the next qualifying merge, so the failure mode is a graph that is late, never one that is wrong.

### U3 — Making the emitter testable

`src/graphify/graph-to-toon.ts` has **zero tests**, and the reason is structural rather than negligent: the file is a script, `main()` runs at module scope (line 452), and every code path ends in `writeFileSync`. Nothing can be asserted without touching the disk. The rewrite therefore splits rendering from I/O — pure functions that take a parsed graph and return the `.toon` text, plus a thin CLI that reads, calls, writes. Tests then assert on returned strings. This is a precondition for U4, not a nice-to-have: a format rewrite with no test net is how the silent regressions in U4 happen.

### U4 — v3 compaction, without losing what noldor has

The format gains, ported from panther's `graph_to_brainstorm.ts` at revision `c1ee126` and pinned line-by-line in U5: a TOC of per-community start–end line ranges so a reader can `Read offset/limit` one section; nodes addressed by per-community integer index instead of repeated labels; a prefix-factored path table; single-letter relation codes; edges collapsed to adjacency lists (`<rel> <src>><t1,t2,…>`); a `sig hubs=` line per community; and `## features` in the summary. Panther also ships `validateToc`, which re-reads the emitted file and throws if a TOC line number does not land on its `## ` header — that self-check comes along, since hand-computed line arithmetic is exactly the kind of thing that silently drifts.

On noldor's real graph, `REL_OMIT` — dropping `contains` and `imports_from` as derivable — removes **4479 of 9461 edges, 47%**.

The larger risk in this unit is what panther's script *lacks*, because noldor's graph is not panther's:

- **`deriveCommunityLabels` is load-bearing here.** noldor's `graph.json` carries no `community_labels` key. Panther's script falls back to `?? {}`, which would degrade every label to `Community 85`. noldor's derivation must be kept.
- **Hyperedge support must be kept.** noldor's emitter renders `hyperedges` in both files; panther's has no notion of them. Today's committed graph has zero, so this is dormant, not dead — dropping it would be a silent capability loss that only bites when someone runs graphify in semantic mode.
- **`docs/` belongs in `PATH_STRIP_PREFIXES`.** noldor's list includes it and panther's does not, because noldor's `graphify enrich-docs` adds plan/spec/FD nodes.
- **`plan-of` and `spec-of` need relation codes.** They are not in panther's `REL_CODE`, so they would render as `?`. Today's graph has none — `enrich-docs` was not run — but the feature exists and the map should cover it.
- **`sanitizeLine` is a gain worth calling out.** noldor's current emitter does not strip newlines or tabs from labels, so a multi-line label would corrupt a line-oriented format. Panther's does.
- **The collator gets pinned here.** Line 248 of the current file sorts community nodes with a bare `a.label.localeCompare(b.label)`, which resolves against the machine locale. Under `cs_CZ` — Czech collates `ch` after `h` — the same graph emits a different node order than an `en` CI runner would, so every CI regeneration would churn against every local one. Pinning it is in scope precisely because U1 makes both producers real.

### U5 — The v3 format contract

The reference is `gdc-mastercard-panther/scripts/graphify/graph_to_brainstorm.ts` at revision **`c1ee126`** ("feat(graphify): compact v3 brainstorm TOON with TOC", 2026-05-29). Prose below is normative; where the two disagree, this spec wins.

`graph.brainstorm.toon` is a header, then a `toc` block, then one block per community in ascending community id, then an optional `## cross` block. Lines are `\n`-joined; the file ends with a trailing newline.

```
# Domain Knowledge Graph (v3 — compact)
# version: 3
# <N> nodes, <E> edges (contains/imports_from omitted), <C> communities, directed=<bool>
# …four further comment lines documenting the row grammar…

toc
  c<id>: <startLine>-<endLine>
  cross: <startLine>-<endLine>

## c<id> (<nodeCount>) <label>
sig hubs=<label>(<fanIn>/<fanOut>) …
p[<pathCount>] prefix=<commonPrefix>
  <pathIdx>=<pathSuffix>
n
  <nodeIdx> <label> @<pathIdx>
e
  <relCode> <srcIdx>><tgtIdx>,<tgtIdx>,…
```

The parts that must be pinned because they are not inferable from the shape:

- **Indices are community-local and 0-based.** `<nodeIdx>` indexes that community's nodes after sorting; `<pathIdx>` indexes that community's sorted unique path set. An index in a `c7` block means nothing in a `c8` block. Cross-community edges therefore cannot use indices, which is why `## cross` carries full labels plus `@c<id>`.
- **Sort order is a pinned-locale comparator**, not `localeCompare` against the ambient locale (see U4). Node order and path order both depend on it, and both feed the indices above, so an unpinned comparator changes every index in the file.
- **`sig` is emitted only** when the community has ≥3 nodes, has at least one surviving edge, and at least one node reaches degree ≥2; at most 5 hubs, ordered by `fanIn + fanOut` descending. Absent under any of those conditions — its absence carries no meaning.
- **`prefix=` is emitted only** when the community has ≥2 distinct paths and their common prefix, truncated at the last `/`, is ≥4 characters. Otherwise the `p[<n>]` line carries no `prefix=` and the listed paths are unstripped.
- **A trailing `!` on a label** means the source label ended in `()` — a function — and those two characters are stripped. A label that genuinely ends in `!` is indistinguishable; accepted, since graphify labels do not.
- **Labels are sanitized**: `[\r\n\t]+` collapses to a single space, runs of two or more spaces collapse to one, then trimmed. There is no escaping beyond this. A label containing `@` or `>` could in principle be misread by a strict parser; graphify does not emit such labels, and the format's audience is a model reading for orientation rather than a parser, so this is recorded as a known limitation rather than solved.
- **`e` is omitted entirely** for a community with no surviving edges. Edges group by relation code, then by source index ascending, with target indices ascending and comma-joined.
- **`<relCode>`** is `i` imports, `f` calls, `e` re_exports, `r` references, `m` method, plus `p` plan-of and `s` spec-of for `enrich-docs` output. Any unmapped relation renders `?`.
- **TOC line numbers are 1-based and absolute** in the finished file. They are computed by emitting the body first, then prepending a header whose own length is known, then shifting. `validateToc` re-reads the assembled lines and throws if a TOC entry does not land on its `## ` header.

**Why dropping `contains` and `imports_from` preserves information.** `contains` links a file node to the symbols declared in it — already carried by every node row's `@<pathIdx>`. `imports_from` is the file-level projection of symbol-level `imports` — recoverable by mapping each `i` edge's endpoints through their path indices. Neither is a fact the reader loses; both are a fact the reader was being told twice.

## Acceptance criteria

1. `templates/.github/workflows/update-knowledge-graph.yml` exists and is listed by `templateFiles()`.
2. The new template path is in `SCAFFOLD_ONLY_TEMPLATES`; `check-template-sync` reports no drift for a consumer whose copy differs.
3. `noldor init` into a fresh consumer writes the workflow; `init --update` does not overwrite a consumer's modified copy.
4. The workflow's YAML parses; its job triggers only on a merged PR into the default branch whose title carries a `feat`, `fix` or `refactor` prefix.
5. The workflow reaches the default branch by opening a PR — no step in it pushes to `refs/heads/main`, and no step passes `--no-verify` or sets `LEFTHOOK=0`.
6. The workflow declares a `concurrency` group, a single fixed bot branch, and a `permissions` block no broader than `contents: write` + `pull-requests: write`.
7. Two qualifying merges in quick succession leave at most one open graph PR.
8. The regenerated output a commit carries is produced from the same sha that commit's parent names — a run whose base moved before pushing restarts rather than pushing.
9. Rendering is reachable as a pure function: given a parsed graph object, it returns the `.toon` text without writing a file.
10. The emitted brainstorm `.toon` begins with a `toc` block naming one entry per community plus `cross`.
11. Every TOC line number lands on that section's `## ` header line — asserted by a test, not only by the runtime self-check.
12. Edges with relation `contains` or `imports_from` do not appear in the emitted body.
13. Node and path indices are community-local: the same index in two community blocks resolves to different nodes.
14. `sig` and `prefix=` appear exactly under the conditions U5 states, and are absent otherwise.
15. A graph carrying no `community_labels` still emits derived labels, not `Community <n>`.
16. A graph carrying hyperedges emits them in both files.
17. Node ordering within a community is identical under `LANG=cs_CZ.UTF-8` and `LANG=en_US.UTF-8`.
18. Regenerating twice from the same `graph.json` produces byte-identical output.

## Risks / trade-offs

- **The format change is a one-time large diff in every consumer.** Both `.toon` files are tracked in noldor and in charuy. The first regeneration after this ships rewrites them wholesale. Unavoidable for a format change; worth timing with a release rather than mid-sprint.
- **Anything reading the old format breaks.** `/noldor-refactor` reads `GRAPH_REPORT.md` and `graph.json`, not the `.toon`, so it is unaffected. The known `.toon` readers are agents following skill prose. Whether the header needs a machine-readable version marker is D4.
- **The bot's commit carries no `Noldor-FD:` trailer and no review receipt**, so it uses the established escape: a `Noldor-Path-Override:` trailer naming the reason. That is not a new hole — `src/prep/prep-promote.ts:447` already ships exactly this shape for machine-written commits approved at a different stage, and `src/garden/detectors/override-audit.ts` counts every override into the SDD report, so the bot's use stays visible rather than silent. The residual risk is volume: one override per qualifying merge could drown the audit signal it lands in, which is a second argument for filtering (D3).
- **`deriveCommunityLabel` degrades on `src/`-only repos.** It keys on `packages/` and `apps/` prefixes, so in noldor most communities fall back to a list of node labels (`architecture-schema.ts · pageFilename() · data.ts`). v3's `sig hubs=` line softens this by naming the real hubs, but the underlying weakness is out of scope and worth its own entry.
- **Metered Actions minutes.** On a private repo a per-merge graph rebuild is billable. Scope filtering (D3) is the lever.

## User Story

As an agent reading a repo I did not write, I want the committed knowledge graph to be fresh and to carry a table of contents, so that I can load one community's topology instead of a 697 KB file or, worse, reason from a graph that no longer matches the code.

## Usage

Consumers get the workflow from `noldor init` (or `init --update`) and own the copy afterwards — editing runner labels and the `graphifyy` pin to suit. After a qualifying merge (a PR titled `feat`, `fix` or `refactor`), the workflow regenerates `graphify-out/` onto the `noldor/graph-refresh` branch and opens a pull request.

What happens next depends on the repository. Where auto-merge is enabled, the PR merges itself and there is nothing further to do. Where it is not — charuy today — the PR waits for someone to merge it. It is always the same single PR, force-updated by each later run, so the queue never grows past one. Two settings are worth checking on adoption: auto-merge must be enabled in repository settings, and a PR opened with the default `GITHUB_TOKEN` will not trigger other workflows, so required checks on the graph PR need a PAT or app token.

Locally, nothing changes: `pnpm noldor graphify graph-to-toon graphify-out/graph.json` still renders both files, now in v3. Reading one community means finding its line range in the `toc` block at the top of `graph.brainstorm.toon` and passing that range as `Read offset/limit`.

## Open questions (resolved)

**D1.** *Should the CI half and the TOON half ship as one change, or should CI land alone first?*
-> Ship together. The operator chose one release so the consumer dep-bump ritual is paid once, and the two are genuinely coupled: U1 creates a second producer of the `.toon`, which is what makes U4's pinned collator necessary rather than pedantic.

**D2.** *Does the workflow push straight to the default branch, or open a PR?* — **resolved: PR + auto-merge.**
-> Open a PR and auto-merge it. `src/hooks/noldor-pre-push.ts` blocks `refs/heads/main` and no hook honours a CI escape hatch, so a direct push would require shipping `--no-verify` or `LEFTHOOK=0` inside a consumer-facing template. Rejected alternatives: pushing straight like panther (needs that bypass), and skipping `lefthook install` in CI (the bot commit still reaches main unreviewed and untrailered).

**D3.** *Does the workflow run on every merge, or filter?* — **resolved: panther's title-prefix filter.**
-> Filter on PR title prefix (`feat|fix|refactor`), exactly as panther does, since that shape is already proven in production CI there. Dropped alternatives: always-run with an empty-diff no-op (correct, but spends CI minutes on every doc-only merge), and a YAML `paths-ignore` mirroring `GRAPH_IRRELEVANT_EXCLUDES` (`src/release/graph-freshness.ts`), which would drift silently the moment that constant changed.

**D6.** *What happens when the consumer's repository has no auto-merge?*
-> The workflow opens the PR and stops, leaving it for the operator; it must not fall back to a direct push, which the pre-push guard blocks anyway. charuy is a live instance of this case. The PR title should make the pending state self-explanatory so an unmerged graph PR is not mistaken for review work.

**D4.** *Does the v3 header need a machine-readable version marker?*
-> Yes. Panther's header says `(v3 — compact)`, which is prose. A `# version: 3` line (U5) costs one line and lets a future reader branch on it. Nothing consumes it yet — cheap insurance, not a migration plan.

**D5.** *Should the summary keep the `community index (top 20 by size)` block that panther dropped?*
-> Keep it. Panther dropped it because its TOC serves the same purpose, but noldor has 206 communities against panther's 233 with far weaker labels, so a size-ranked index is the only place a reader sees which communities are worth opening.
