# Graph Evidence in Specs and ADRs — Design

**Slug:** graphify-plan-of-edges-nodes-for-plans-specs-graph-evidence-in-specs-and-adrs
**FD:** docs/features/graphify-plan-of-edges-nodes-for-plans-specs.md
**Date:** 2026-08-28
**Tier:** specs-only
**Deps:** none

UI verdict: skip — `consumer.uiPaths` / `consumer.uiSurfaces` are unset in `.noldor/config.json`, and every candidate path is skill prose, a format-contract constant, or a garden detector.

## Problem

[`docs/noldor/graph-integration.md`](../../noldor/graph-integration.md) tells every reader — agents included — to open `graphify-out/graph.brainstorm-summary.toon` before any codebase exploration. Exactly one stage honours it: [`/noldor-refactor`](../../../.claude/skills/noldor-refactor/SKILL.md) reads `GRAPH_REPORT.md` for god nodes and cohesion before it restructures anything. By the time a refactor runs, the structural decision has already been made and shipped.

The two surfaces where architecture decisions actually get written never mention the graph. `SPEC_FORMAT` in [`src/prep/formats.ts`](../../../src/prep/formats.ts) asks for named units referencing real files; `renderAdrTemplate` in [`src/docs/adr-schema.ts`](../../../src/docs/adr-schema.ts) asks for Context / Decision / Consequences. Neither asks *where in the structure* the change lands, so nothing records whether the structure was consulted. A reader of a shipped spec cannot tell whether its author knew they were reshaping a god node, and a reader of a decision record cannot tell which part of the system the decision moved.

The gap is not a missing document — it is a missing *step* and a missing *unit*. The step reads the graph at the moment the decision is still cheap; the unit is where the reading lands so it survives the session.

## Goals

- A spec authored on a `specs-only-*` or `full-*` path reads the graph before `## Design` is drafted, through a real freshness gate rather than by trusting that a file exists on disk.
- The author can name the communities, god nodes, and cross-package bridges *their own change* lands in — not the repo-wide top-20 the summary toon happens to list.
- A spec and a newly minted ADR each carry a short, honest **Structural context** unit, with a recorded deliberate skip as a first-class outcome rather than a silent omission.
- A garden detector reports artifacts whose unit is still a stub: advisory-with-teeth — visible in `garden detect`, never gating a release.
- A repo with no graph skips cleanly at every one of those points. graphify is optional and must stay optional.

## Non-goals

- No blocking anywhere: no release preflight row, no push gate, no `sddGaps` entry. `graph-context` does exit non-zero on a stale graph, but that code is read by the skill step, which never halts a session on it — no gate consumes it.
- No new graph analysis. This reads what graphify already emits — no new edge kinds, no semantic pass, no change to the graphify pipeline.
- No retrofit. The twelve specs already under `docs/design/specs/` and `docs/adr/0001` predate the contract and are out of scope by construction.
- No change to `/noldor-plan` or the FD template. The per-feature diagram counterpart is Q-0185's.

## Design

### Structural context

The change lands in the design-artifact authoring surface rather than in any single community. Its four touch points sit in distinct places: the `prep` format contract ([`src/prep/formats.ts`](../../../src/prep/formats.ts), a pure string module with no imports beyond `summary-body-contract`), the ADR generator ([`src/docs/adr-schema.ts`](../../../src/docs/adr-schema.ts)), the `garden/detectors` family (community `c0`/`c3`/`c12`/`c17`, all labelled `detectors` in the summary toon), and a new `src/design/` CLI. The one structural fact that matters: [`src/garden/graph-fd-lookup.ts`](../../../src/garden/graph-fd-lookup.ts) currently has a single class of consumer — garden detectors — and this feature adds a second, on the CLI side, so its exports stop being detector-private. `loadDocRoots()` is the repo's top god node (76 edges) and every unit here reaches it; none of them reshapes it, they only add call sites.

### U1 — `noldor design graph-context`

A new subcommand under the existing `design` group ([`src/cli/manifest.ts`](../../../src/cli/manifest.ts), alongside `design context`, `design archive`, `design pen-bridge`), implemented as `src/design/graph-context.ts` plus a thin `graph-context-cli.ts` in the shape [`src/design/archive-cli.ts`](../../../src/design/archive-cli.ts) already uses. It owns the freshness decision so skill prose never has to, and it answers *where in the structure a set of paths sits*.

The freshness verdict comes from `evaluateGraphFreshness` in [`src/release/graph-freshness.ts`](../../../src/release/graph-freshness.ts), not from `loadFreshGraphOrWarn`. This deviates from the roadmap entry, which named the latter. The reason is measurable: `loadFreshGraphOrWarn` compares mtimes, and a `git worktree add` stamps every file at the same instant, so it returns not-fresh in the exact environment every feature session runs in — probed in this worktree, it reported `regen 2026-08-28, latest source mtime 2026-08-28` and refused. Its gap message is also hardcoded co-tag wording that would print nonsense from a spec step. `evaluateGraphFreshness` compares commit timestamps, is worktree-stable, already drops test-only and doc-only commits through `GRAPH_IRRELEVANT_EXCLUDES`, and already returns `skipped` when no graph is tracked — which is precisely the clean skip this feature needs. Its three statuses map straight onto the command's three outcomes:

- **skipped** — no `graphify-out/graph.json` tracked, or the consumer declares no `scanPaths`. Prints one line saying the graph is not in use and exits 0. A missing graph is not a failure.
- **stale** — graph-relevant source was committed after the graph. Prints the verdict and the exact remediation, and exits non-zero. The command never shells a regen itself: graphify's CLI exposes no build command at all (extraction is driven by the `/graphify` skill, an agent workflow), the locally installed binary is version-skewed against its own skill, and a consumer may not have it. Keeping the command shell-free also keeps it unit-testable.
- **fresh** — prints the summary-toon path, then a per-path digest for every `--path` given.

The per-path digest is what makes the unit writable. `graph.brainstorm-summary.toon` is 2.4 KB describing the top 20 of 150 communities, so an author cannot resolve their own files from it. The digest resolves them from `graph.json` directly and reports, per path:

- **Community** — the file's `L1` node `community`, its most frequent co-members, and the FD slugs dominating that community via `getCommunityOwners`, already exported from `graph-fd-lookup.ts` for detector 9.
- **God-node proximity** — the degree rank and edge count of any symbol the path defines. `GRAPH_REPORT.md` defines a god node as nothing more than "most connected" (`loadDocRoots()` 76 edges, `loadConsumerConfig()` 39, and so on), so a degree tally over `graph.links` reproduces graphify's own ranking and no threshold has to be invented. Reporting rank and count rather than a boolean lets the author judge.
- **Cross-package bridges** — edges from the path's nodes whose target sits in a different community: the same signal the summary toon's "cross-community edges" block gives globally, scoped to the change.

A path absent from the graph reports as such rather than as an empty result — a file too new to be in the graph is itself structural information.

### U2 — the `/noldor-spec` structural-read step

A new step in both skill twins — [`.claude/skills/noldor-spec/SKILL.md`](../../../.claude/skills/noldor-spec/SKILL.md) and its `templates/` copy, which must move together or `doctor` reds — placed after grounding and before the strawman of step 2.5 is written, so the reading informs `## Design` instead of decorating it afterwards. It is gated on the session marker's `path` being `specs-only-*` or `full-*`; `fast-track` and `micro-chore` never run it, mirroring Q-0185's tier scoping so the XS drain is untaxed.

The step runs `graph-context` over the candidate paths (the FD's `links.code` plus the roadmap entry's `Touches:` values — the same candidate set the UI predicate already derives), and branches on the verdict. On `skipped` it writes one line saying the repo tracks no graph and moves on. On `stale` it invokes `/graphify --ast-only` and retries once; if the graph still is not fresh — the tool is absent, the regen failed, whatever — it writes the unit from what is available and records a `noldor:cut` naming the staleness, rather than blocking the dialogue. On `fresh` it reads the summary toon and the digest and writes `### Structural context`. Advisory-with-teeth applies to the step as much as to the detector: the one thing it may never do is stop a session.

### U3 — the contract additions

`SPEC_FORMAT` gains one line prescribing a `### Structural context` H3 inside `## Design` — inside, not beside it, because `## Design` is the H2 the format already fixes and the skill's own dialogue loop addresses H3s. `renderAdrTemplate` gains a `## Structural context` section between Context and Decision, where it reads as evidence for the decision rather than as an afterthought. Both name the same three things and both accept a recorded skip in place of content.

The ADR change is additive and safe by construction: `checkAdr` in [`src/docs/docs-adr.ts`](../../../src/docs/docs-adr.ts) validates filenames, frontmatter, and the supersede chain, never body sections, so no existing record can be invalidated by a template that grew. `renderAdrTemplate` is deliberately a code-embedded generator rather than a `templates/` file, so `init` and `template-sync` are unaffected.

### U4 — `detectStructuralContextStubs`

A detector in `src/garden/detectors/` reporting artifacts whose unit is missing or unfilled. It follows the `architectureAdvisories` wiring exactly: computed in `detectAll` ([`src/garden/garden-detect.ts`](../../../src/garden/garden-detect.ts):802), surfaced on its own `GardenFindings` key, and deliberately **absent** from `FINDING_CATEGORIES` in [`src/garden/garden-detect-runner.ts`](../../../src/garden/garden-detect-runner.ts). That absence is the whole non-blocking guarantee: that list gates the garden auto-restamp, and an unstamped receipt is a blocking release row, so anything routed through it blocks a release.

A unit counts as a stub when the section is absent, when its body falls under a non-whitespace character floor, or when it still matches the scaffold placeholder verbatim. The floor reuses the rationale already settled in [`src/core/summary-body-contract.ts`](../../../src/core/summary-body-contract.ts) (`MIN_SECTION_CHARS = 24` — "long enough to reject `Why — x`, short enough never to block an honest one-line reason"); the technique is borrowed, not the module, which is PR-summary-specific. A line beginning `noldor:cut ` anywhere inside the section suppresses the finding at any length — the same bare spelling `/noldor-refactor` already greps for, so a doc marker and a code marker stay one convention.

Scope is floored so day-one findings are zero. Specs: non-archive only, and only those whose `**Date:**` is on or after a `FLOOR_DATE` constant stamped when this ships. ADRs: only numbers above the highest existing at ship time. The corpus is thirteen live specs dated 2026-06-07 through 2026-08-21 and `docs/adr/0001` (2026-08-19), none of which could have complied with a contract that did not exist; flagging them would produce thirteen rows clearable only by retro-authoring or by pasting thirteen markers, which trains operators to ignore the channel. This is [`docs/adr/0001`](../../adr/0001-absent-doc-surfaces-skip-release-gates.md)'s posture — opt-in is an affirmative authoring act — applied to artifacts instead of surfaces. Plans are out of scope entirely: a plan decomposes an already-approved spec, so the evidence belongs one level up and repeating it would be transcription.

## Acceptance criteria

- `noldor design graph-context` exits 0 and reports the graph is not in use when no `graphify-out/graph.json` is tracked.
- It exits non-zero and names a remediation when the commit-timestamp gate reports the graph stale.
- It never invokes graphify in any of its three outcomes. (It does shell `git log` — that is `evaluateGraphFreshness`'s own mechanism, not a regen.)
- On a fresh graph it prints the summary-toon path plus, per `--path`, the file's community, its dominant FD owners, its symbols' degree rank, and its cross-community edges.
- A `--path` absent from the graph is reported as absent rather than as an empty digest.
- `pnpm noldor prep format spec` output prescribes the `Structural context` unit.
- `noldor adr new <slug>` writes a record containing a `## Structural context` section, and `checkAdr` reports no finding against records written before this change.
- The detector reports a spec whose unit is absent, under the character floor, or still the placeholder.
- The detector reports nothing for a unit containing a `noldor:cut ` line, at any length.
- The detector reports nothing for any spec dated before the floor, any archived spec, any plan, or any ADR numbered at or below the pre-existing maximum.
- The detector's findings appear on their own `garden detect` key and never in `sddGaps`, so no release preflight verdict changes.
- A repo with no `graphify-out/` produces no findings and no errors from any of the above.

## Risks / trade-offs

**Deviating from the entry's prescribed gate.** The entry named `loadFreshGraphOrWarn`; this uses `evaluateGraphFreshness`. The deviation is evidence-backed rather than stylistic — the mtime gate cannot return fresh inside a worktree — but it does mean two freshness gates now exist with different semantics, and a future reader may reasonably ask which is canonical. The mitigation is that each is used where its input is meaningful: mtime for detectors running against a working tree, commit timestamps for anything reasoning about what was actually shipped.

**A required section invites boilerplate.** The failure mode of any prose contract is a paragraph written to satisfy the check. The `noldor:cut` escape hatch is the mitigation and it is deliberately cheap to use: an honest recorded skip is worth more than a fabricated paragraph, and the detector treats it as a full pass rather than as a lesser one.

**The floor is a constant.** A hardcoded `FLOOR_DATE` is inelegant and will look arbitrary in a year. The alternatives were worse: no floor floods the channel on day one, and a git-birth floor shells git per artifact and breaks in shallow clones and fresh worktrees. The constant is one line and cheap to revise.

**Digest cost.** `graph.json` is 3.1 MB and the digest walks its nodes and edges per invocation. That is well inside a CLI's budget for a once-per-session call, but it rules out calling this per file in a loop.

## User Story

As a spec author (human or agent), I want the knowledge graph read before I draft the design and its findings recorded in the spec and in any decision record, so that a later reader can tell which part of the system's structure a decision moved.

## Usage

```bash
# During /noldor-spec, before drafting ## Design (specs-only-* and full-* paths)
pnpm noldor design graph-context --path src/prep/formats.ts --path src/docs/adr-schema.ts

# exit 0, "graph not in use"      -> write the skip line, continue
# exit non-zero, "stale"          -> /graphify --ast-only, pnpm toon, retry once
# exit 0 with digest              -> write ### Structural context from it

# Stub report — advisory, never blocking
pnpm noldor garden detect
```

An author who deliberately skips the unit writes, inside the section:

```
noldor:cut graph not consulted — <reason> · <what would change the answer>
```

## Open questions (resolved)

1. *Should `graph-context` cache its digest across invocations in a session?* -> No. (D1) One call per session is the design; a cache would add invalidation for no measured gain.
2. *Should the detector also flag a unit that names communities no longer present in the graph?* -> No, not in this slice. (D2) It is a genuine drift signal but needs the graph at detect time, which would make an optional dependency load-bearing for a garden run.
3. *Does the gate's Step 2.5 lint pass learn about the unit?* -> No. (D3) `lint-plan-snippets` and `split-check` are size and snippet checks; adding a content rule there duplicates the detector on a surface that already has enough signals.
4. *Should `FLOOR_DATE` be config rather than a constant?* -> A constant. (D4) A consumer-tunable floor is a knob nobody would turn, and the value is meaningful only relative to when the framework version shipped.
