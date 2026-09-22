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

Modelled on `/Users/davidzoufaly/code/gdc-mastercard-panther/.github/workflows/update-knowledge-graphs.yaml`, minus its domain matrix (noldor has one graph, not two). It triggers on a merged PR into the default branch, installs Python plus `graphifyy`, regenerates the graph, runs `graph-to-toon`, and verifies the outputs exist and that `graph.json` parses.

It then commits to a bot branch, opens a PR and auto-merges it — it does **not** push to the default branch. That is not a stylistic preference: `src/hooks/noldor-pre-push.ts` blocks `refs/heads/main` outright to enforce "all paths land on main via PR", and no hook honours a `CI` or `GITHUB_ACTIONS` escape. Since `postinstall` runs `lefthook install`, any job that installs dependencies has live hooks, so a direct push would need `--no-verify` or `LEFTHOOK=0` baked into a template noldor ships to every consumer — teaching them to bypass the gate the framework exists to enforce. Panther's regenerate-and-retry loop is kept in spirit: when the branch has moved, it re-fetches and rebuilds rather than force-pushing, so a graph is never computed against one tree and committed against another.

That posture binds every CI file noldor ships from here on, not just this one, so it is recorded as [ADR 0002](../../adr/0002-shipped-ci-templates-route-through-pr.md).

Auto-merge is not available on every repository — charuy is one where it is not — so the workflow needs a documented fallback for that case (D6).

The trigger mirrors panther's: a merged PR whose title carries a `feat`, `fix` or `refactor` prefix. Panther's label-driven domain matrix is the one part dropped, since noldor has a single graph rather than `fi` and `mic`. Over noldor's last 200 commits that filter runs on 121 (fix 73, feat 43, refactor 5) and skips 77 (docs 46, chore 31). Skipping is safe because the filter is self-healing: a `chore` that did move the graph is picked up by the next qualifying merge, so the failure mode is a graph that is late, never one that is wrong.

### U3 — Making the emitter testable

`src/graphify/graph-to-toon.ts` has **zero tests**, and the reason is structural rather than negligent: the file is a script, `main()` runs at module scope (line 452), and every code path ends in `writeFileSync`. Nothing can be asserted without touching the disk. The rewrite therefore splits rendering from I/O — pure functions that take a parsed graph and return the `.toon` text, plus a thin CLI that reads, calls, writes. Tests then assert on returned strings. This is a precondition for U4, not a nice-to-have: a format rewrite with no test net is how the silent regressions in U4 happen.

### U4 — v3 compaction, without losing what noldor has

The format gains, ported from panther's `graph_to_brainstorm.ts`: a TOC of per-community start–end line ranges so a reader can `Read offset/limit` one section; nodes addressed by per-community integer index instead of repeated labels; a prefix-factored path table; single-letter relation codes; edges collapsed to adjacency lists (`<rel> <src>><t1,t2,…>`); a `sig hubs=` line per community; and `## features` in the summary. Panther also ships `validateToc`, which re-reads the emitted file and throws if a TOC line number does not land on its `## ` header — that self-check comes along, since hand-computed line arithmetic is exactly the kind of thing that silently drifts.

On noldor's real graph, `REL_OMIT` — dropping `contains` and `imports_from` as derivable — removes **4479 of 9461 edges, 47%**.

The larger risk in this unit is what panther's script *lacks*, because noldor's graph is not panther's:

- **`deriveCommunityLabels` is load-bearing here.** noldor's `graph.json` carries no `community_labels` key. Panther's script falls back to `?? {}`, which would degrade every label to `Community 85`. noldor's derivation must be kept.
- **Hyperedge support must be kept.** noldor's emitter renders `hyperedges` in both files; panther's has no notion of them. Today's committed graph has zero, so this is dormant, not dead — dropping it would be a silent capability loss that only bites when someone runs graphify in semantic mode.
- **`docs/` belongs in `PATH_STRIP_PREFIXES`.** noldor's list includes it and panther's does not, because noldor's `graphify enrich-docs` adds plan/spec/FD nodes.
- **`plan-of` and `spec-of` need relation codes.** They are not in panther's `REL_CODE`, so they would render as `?`. Today's graph has none — `enrich-docs` was not run — but the feature exists and the map should cover it.
- **`sanitizeLine` is a gain worth calling out.** noldor's current emitter does not strip newlines or tabs from labels, so a multi-line label would corrupt a line-oriented format. Panther's does.
- **The collator gets pinned here.** Line 248 of the current file sorts community nodes with a bare `a.label.localeCompare(b.label)`, which resolves against the machine locale. Under `cs_CZ` — Czech collates `ch` after `h` — the same graph emits a different node order than an `en` CI runner would, so every CI regeneration would churn against every local one. Pinning it is in scope precisely because U1 makes both producers real.

## Acceptance criteria

1. `templates/.github/workflows/update-knowledge-graph.yml` exists and is listed by `templateFiles()`.
2. The new template path is in `SCAFFOLD_ONLY_TEMPLATES`; `check-template-sync` reports no drift for a consumer whose copy differs.
3. `noldor init` into a fresh consumer writes the workflow; `init --update` does not overwrite a consumer's modified copy.
4. The workflow's YAML parses; its job triggers only on a merged PR into the default branch whose title carries a `feat`, `fix` or `refactor` prefix.
5. The workflow reaches the default branch by opening a PR — no step in it pushes to `refs/heads/main`, and no step passes `--no-verify` or sets `LEFTHOOK=0`.
6. Rendering is reachable as a pure function: given a parsed graph object, it returns the `.toon` text without writing a file.
7. The emitted brainstorm `.toon` begins with a `toc` block naming one entry per community plus `cross`.
8. Every TOC line number lands on that section's `## ` header line — asserted by a test, not only by the runtime self-check.
9. Edges with relation `contains` or `imports_from` do not appear in the emitted body.
10. A graph carrying no `community_labels` still emits derived labels, not `Community <n>`.
11. A graph carrying hyperedges emits them in both files.
12. Node ordering within a community is identical under `LANG=cs_CZ.UTF-8` and `LANG=en_US.UTF-8`.
13. Regenerating twice from the same `graph.json` produces byte-identical output.

## Risks / trade-offs

- **The format change is a one-time large diff in every consumer.** Both `.toon` files are tracked in noldor and in charuy. The first regeneration after this ships rewrites them wholesale. Unavoidable for a format change; worth timing with a release rather than mid-sprint.
- **Anything reading the old format breaks.** `/noldor-refactor` reads `GRAPH_REPORT.md` and `graph.json`, not the `.toon`, so it is unaffected. The known `.toon` readers are agents following skill prose. Whether the header needs a machine-readable version marker is D4.
- **The bot's commit carries no `Noldor-FD:` trailer and no review receipt**, so it uses the established escape: a `Noldor-Path-Override:` trailer naming the reason. That is not a new hole — `src/prep/prep-promote.ts:447` already ships exactly this shape for machine-written commits approved at a different stage, and `src/garden/detectors/override-audit.ts` counts every override into the SDD report, so the bot's use stays visible rather than silent. The residual risk is volume: one override per qualifying merge could drown the audit signal it lands in, which is a second argument for filtering (D3).
- **`deriveCommunityLabel` degrades on `src/`-only repos.** It keys on `packages/` and `apps/` prefixes, so in noldor most communities fall back to a list of node labels (`architecture-schema.ts · pageFilename() · data.ts`). v3's `sig hubs=` line softens this by naming the real hubs, but the underlying weakness is out of scope and worth its own entry.
- **Metered Actions minutes.** On a private repo a per-merge graph rebuild is billable. Scope filtering (D3) is the lever.

## User Story

As an agent reading a repo I did not write, I want the committed knowledge graph to be fresh and to carry a table of contents, so that I can load one community's topology instead of a 697 KB file or, worse, reason from a graph that no longer matches the code.

## Usage

Consumers get the workflow from `noldor init` (or `init --update`) and own the copy afterwards — editing runner labels and the `graphifyy` pin to suit. After the first merge to the default branch, the workflow regenerates `graphify-out/` and pushes; nothing else is needed.

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
-> Yes, minimally: the panther header line already says `(v3 — compact)`, which is human-readable only. A `version: 3` line costs one line and lets a future reader branch. Nothing consumes it yet, so this is cheap insurance rather than a migration plan.

**D5.** *Should the summary keep the `community index (top 20 by size)` block that panther dropped?*
-> Keep it. Panther dropped it because its TOC serves the same purpose, but noldor has 206 communities against panther's 233 with far weaker labels, so a size-ranked index is the only place a reader sees which communities are worth opening.
