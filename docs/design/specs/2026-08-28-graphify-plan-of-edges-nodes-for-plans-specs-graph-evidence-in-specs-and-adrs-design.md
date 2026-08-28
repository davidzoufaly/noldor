# Graph Evidence in Specs and ADRs — Design

**Slug:** graphify-plan-of-edges-nodes-for-plans-specs-graph-evidence-in-specs-and-adrs
**FD:** docs/features/graphify-plan-of-edges-nodes-for-plans-specs.md
**Date:** 2026-08-28
**Tier:** specs-only
**Deps:** none

UI verdict: skip — `consumer.uiPaths` / `consumer.uiSurfaces` are unset in `.noldor/config.json`, and every candidate path is skill prose, a format-contract constant, or a garden detector.

## Problem

[`docs/noldor/graph-integration.md`](../../noldor/graph-integration.md) tells every reader — agents included — to open `graphify-out/graph.brainstorm-summary.toon` before any codebase exploration. Exactly one stage honours it: [`/noldor-refactor`](../../../.claude/skills/noldor-refactor/SKILL.md) reads `GRAPH_REPORT.md` for god nodes and cohesion before it restructures anything. By then the structural decision has already been made and shipped.

The two surfaces where architecture decisions actually get written never mention the graph. `SPEC_FORMAT` in [`src/prep/formats.ts`](../../../src/prep/formats.ts) asks for named units referencing real files; `renderAdrTemplate` in [`src/docs/adr-schema.ts`](../../../src/docs/adr-schema.ts) asks for Context / Decision / Consequences. Neither asks *where in the structure* the change lands, so nothing records whether the structure was consulted. A reader of a shipped spec cannot tell whether its author knew they were reshaping a god node; a reader of a decision record cannot tell which part of the system the decision moved.

The gap is a missing *step* and a missing *unit*. The step reads the graph while the decision is still cheap; the unit is where the reading lands so it survives the session.

## Goals

- A spec authored on a `specs-only-*` or `full-*` path reads the graph before `## Design` is drafted, through a freshness gate that a regeneration can actually clear.
- The author can name the communities, god nodes, and cross-community edges *their own change* lands in — not the repo-wide top-20 the summary toon happens to list.
- A spec and a newly minted ADR each prescribe a **Structural context** unit, with a recorded deliberate skip as a first-class outcome rather than a silent omission.
- A garden detector reports artifacts whose unit is a stub, and that report is visible on the `/noldor-garden` operator surface — not merely present in the JSON.
- A repo with no graph skips cleanly. graphify is optional and must stay optional.

## Non-goals

- No blocking anywhere: no release preflight row, no push gate, no `sddGaps` entry. `graph-context` does exit non-zero on a stale graph, but only the skill step reads that code and it never halts a session — no gate consumes it.
- No new graph analysis: no new edge kinds, no semantic pass, no change to the graphify pipeline.
- **No automated graph read on the ADR path.** `adr new` is a standalone CLI with no session marker and ADRs are minted outside every gate stage, so there is no seam to hang an automated read on. The ADR half is template plus detector; the author runs `graph-context` by hand from Usage. Automating it needs an ADR authoring stage, which is a separate feature.
- No retrofit: the twelve pre-existing live specs and `docs/adr/0001` are out of scope by construction (see U4's floor).
- No change to `/noldor-plan` or the FD template. The per-feature diagram counterpart is Q-0185's.

## Design

### Structural context

The change lands in the design-artifact authoring surface rather than in one community. Its touch points sit in distinct places: the `prep` format contract ([`src/prep/formats.ts`](../../../src/prep/formats.ts), a pure string module importing only `summary-body-contract`), the ADR generator ([`src/docs/adr-schema.ts`](../../../src/docs/adr-schema.ts)), the `garden/detectors` family (communities `c0`/`c3`/`c12`/`c17`, all labelled `detectors` in the summary toon), a new `src/design/` CLI, and two skill twins. The structural fact that matters: [`src/garden/graph-fd-lookup.ts`](../../../src/garden/graph-fd-lookup.ts) currently has one class of consumer — garden detectors — and this feature adds a second on the CLI side, so its exports stop being detector-private. `loadDocRoots()` is the repo's top god node (76 edges) and every unit here reaches it; none reshapes it, they only add call sites. Communities are graphify's clustering, *not* package boundaries — the two axes are unrelated here and this spec never treats a cross-community edge as a cross-package one.

### U1 — `noldor design graph-context`

A new subcommand under the existing `design` group ([`src/cli/manifest.ts`](../../../src/cli/manifest.ts), alongside `design context`, `design archive`, `design pen-bridge`), implemented as `src/design/graph-context.ts` plus a thin `graph-context-cli.ts` in the shape [`src/design/archive-cli.ts`](../../../src/design/archive-cli.ts) uses. It owns the freshness decision so skill prose never has to, and answers *where in the structure a set of paths sits*.

**Signature.**

```ts
export type GraphContextStatus = 'skipped' | 'stale' | 'fresh';

export interface PathDigest {
  path: string;
  /** absent from the graph entirely — itself structural information */
  inGraph: boolean;
  community: number | null;
  /** most frequent co-members of that community, capped at 5 */
  coMembers: string[];
  /** FD slugs owning that community's files, via getCommunityOwners, capped at 3 */
  owners: CommunityOwnerSuggestion[];
  /** symbols this path defines that rank in the top 20 by degree */
  topDegreeSymbols: { label: string; degree: number; rank: number }[];
  /** edges from this path's nodes whose target sits in another community, capped at 10 */
  crossCommunityEdges: { from: string; to: string; relation: string; toCommunity: number }[];
}

export interface GraphContextResult {
  status: GraphContextStatus;
  detail: string;
  /** null on skipped/stale */
  summaryToon: { path: string; usable: boolean } | null;
  digests: PathDigest[];
}

export async function graphContext(opts: {
  cwd: string;
  paths: readonly string[];
}): Promise<GraphContextResult>;
```

**The freshness verdict is a union of two legs**, and that union is the correction that makes this feature possible at all:

- **committed leg** — `evaluateGraphFreshness(scanPaths, cwd)` from [`src/release/graph-freshness.ts`](../../../src/release/graph-freshness.ts) returns `fresh`. Commit timestamps, already dropping test-only and doc-only commits via `GRAPH_IRRELEVANT_EXCLUDES`.
- **working-tree leg** — `graphify-out/graph.json`'s mtime is newer than every file under `scanPaths`. This is `loadFreshGraphOrWarn`'s comparison, reused for its own leg only.

`fresh` when **either** leg passes; `stale` when neither. Each leg alone is a dead end, and their failures are complementary. The committed leg cannot see an uncommitted regeneration, so on its own the stale → regen → retry loop can never clear: measured in this repo, `graphify-out/graph.json` was last committed `2026-08-23` (`4c1f680`) while `src` has commits through `2026-08-28` (`366cb50`), and `/graphify` writes an uncommitted artifact, so the verdict would stay `stale` forever and the digest path would be unreachable by construction. The working-tree leg cannot return fresh right after `git worktree add`, which stamps every file at one instant. Together: a regeneration rewrites `graph.json` and immediately satisfies the working-tree leg, while a clean tree with a committed-fresh graph satisfies the committed one. The union also removes a data-source split — the verdict and the digest now both key on the working-tree file the digest actually parses.

`skipped` requires `graphify-out/graph.json` to be **both** absent from disk and untracked. Keying on tracked-ness alone would skip a consumer who gitignores `graphify-out/` but regenerates locally; keying on disk presence alone would misreport a consumer who tracks the graph but has not checked it out.

**Outcomes.** `skipped` prints one line and exits 0 — a missing graph is not a failure. `stale` prints the verdict plus the exact remediation (`/graphify --ast-only`, then `pnpm toon`) and exits non-zero; the command never runs a regeneration itself, because graphify's CLI exposes no build command (extraction is the `/graphify` skill, an agent workflow), the locally installed binary is version-skewed against its own skill, and a consumer may not have it — keeping the command subprocess-free apart from `evaluateGraphFreshness`'s own `git log` also keeps it unit-testable. `fresh` prints the summary-toon path and the per-path digest, and exits 0.

The summary toon is advisory **within** `fresh`, reported as `usable: false` when it is missing or older than `graph.json` rather than demoting the verdict. The digest is what the unit needs; the toon is orientation, and only `pnpm toon` regenerates it, so gating the load-bearing path on it would add a failure state carrying no independent signal.

**Digest rules.** `--path` is repeatable and required (zero paths is a usage error, exit 2). Paths are normalized to repo-relative POSIX form and deduplicated; a path outside the repo, or absolute after normalization, is a usage error. A path with no `L1` node reports `inGraph: false` and null community rather than an empty digest. When a file somehow carries several `L1` nodes, the first in graph order wins and the rest are ignored — matching `getCommunityOwners`, which already reads only the file-level node. Degree is computed undirected (the graph declares `directed: false`), counting each `source`/`target` pair once so duplicate edge rows cannot inflate a rank; ties break by label ascending. Ranking population is every node in the graph, and only a path's symbols inside the top 20 are reported — the same "most connected" definition `GRAPH_REPORT.md` uses, so no threshold is invented. Every list is capped as the signature states, and an unreadable or unparseable `graph.json` is reported as `stale` with the parse error in `detail`, never thrown.

### U2 — the `/noldor-spec` structural-read step

A new step in both skill twins — [`.claude/skills/noldor-spec/SKILL.md`](../../../.claude/skills/noldor-spec/SKILL.md) and its `templates/` copy, which must move together or `doctor` reds — placed after the UI-verdict step 1.5 and before the step-2.5 strawman, so the reading informs `## Design` instead of decorating it afterwards. It is gated on the session marker's `path` being `specs-only-*` or `full-*`; `fast-track` and `micro-chore` never run it, mirroring Q-0185's tier scoping so the XS drain is untaxed.

Candidate paths come from the session marker's `uiVerdictPaths` ([`src/core/session.ts`](../../../src/core/session.ts):32), which step 1.5 already computed and persisted from `links.code` ∪ the entry's `Touches:`. The step reads that key rather than re-deriving the same set, so the two prose copies cannot drift from each other or from the UI predicate.

Branching on the verdict: on `skipped`, write one line saying the repo tracks no graph and move on. On `stale`, run `/graphify --ast-only` **then `pnpm toon`** and retry exactly once — the working-tree leg is what that regeneration satisfies. If the retry still is not `fresh` (graphify absent, regeneration failed), write the unit from what is available plus a `noldor:cut` naming the staleness. On `fresh`, read the summary toon when `usable`, read the digest, and write `### Structural context`. The step may never stop a session; advisory-with-teeth applies here as much as to the detector.

### U3 — the contract additions

`SPEC_FORMAT` gains one line prescribing a `### Structural context` H3 inside `## Design` — inside, not beside, because `## Design` is the H2 the format already fixes and the skill's dialogue loop addresses H3s. `renderAdrTemplate` gains a `## Structural context` section between Context and Decision, where it reads as evidence for the decision rather than as an afterthought. Both name the same three things — communities, god nodes, cross-community edges — and both accept a recorded skip in place of content.

The ADR change is additive and safe by construction: `checkAdr` in [`src/docs/docs-adr.ts`](../../../src/docs/docs-adr.ts) validates filenames, frontmatter, and the supersede chain, never body sections, so no existing record can be invalidated by a template that grew. `renderAdrTemplate` is deliberately a code-embedded generator rather than a `templates/` file, so `init` and `template-sync` are unaffected. Per Non-goals, nothing automates the ADR-side read.

### U4 — `detectStructuralContextStubs`

A detector in `src/garden/detectors/structural-context.ts` reporting artifacts whose unit is missing or unfilled. It follows the `architectureAdvisories` wiring exactly: computed in `detectAll` ([`src/garden/garden-detect.ts`](../../../src/garden/garden-detect.ts):802), surfaced on its own `GardenFindings` key named `structuralContextStubs`, and deliberately **absent** from `FINDING_CATEGORIES` in [`src/garden/garden-detect-runner.ts`](../../../src/garden/garden-detect-runner.ts). That absence is the entire non-blocking guarantee: the list gates the garden auto-restamp, and an unstamped receipt is a blocking release row, so anything routed through it blocks a release. Finding shape is `SddGap` — `{ category: 'structural-context', itemId: '<file>#<rule>', message }` — matching the architecture detector's stable-identity convention so repeated runs never duplicate.

The detector reads only the artifacts. It never opens the graph, so it behaves identically in a repo with no `graphify-out/` — reporting a stub there is correct, because the unit's honest content in that repo is a `noldor:cut` saying no graph is tracked.

**Stub rule.** A unit is a stub when the section heading is absent, when its body falls under a non-whitespace character floor, or — ADRs only — when the body still matches `renderAdrTemplate`'s placeholder sentence verbatim. The placeholder clause is ADR-only because there is no spec scaffold: [`src/prep/scaffold.ts`](../../../src/prep/scaffold.ts) scaffolds the FD alone, and specs are agent-authored from `SPEC_FORMAT` prose, so no placeholder string exists to match. The floor reuses the rationale settled in [`src/core/summary-body-contract.ts`](../../../src/core/summary-body-contract.ts) (`MIN_SECTION_CHARS = 24` — "long enough to reject `Why — x`, short enough never to block an honest one-line reason"); the technique is borrowed, not the module, which is PR-summary-specific. Section body means everything from the heading to the next heading of the same or shallower depth; a duplicate heading takes the first occurrence; fenced code inside the section counts toward the floor like any other text.

**Skip marker.** A line whose first non-whitespace token is `noldor:cut` suppresses the finding — the same bare spelling `/noldor-refactor` already greps for, so a doc marker and a code marker stay one convention. It must carry a reason: the marker line needs the character floor's worth of text after the token, so a bare `noldor:cut` is still a stub. That closes the gap between this rule and Usage, which asks for a reason and a condition.

**Floor.** Specs: non-archive only, and only those whose filename date prefix — parsed with `SPEC_FILE_RE` from [`src/core/design-artifact-names.ts`](../../../src/core/design-artifact-names.ts):8, the anchor `detectStaleDesignArtifacts` already relies on — is on or after `SPEC_FLOOR_DATE`. Keying on the filename rather than the author-typed `**Date:**` line keeps a field no validator enforces out of the trust path; a filename that does not match the regex is skipped, fail-open. ADRs: only numbers strictly above `ADR_FLOOR_NUMBER`. Both are named constants stamped when this ships — `ADR_FLOOR_NUMBER` is emphatically *not* recomputed at detect time, which would make the ADR half never fire.

Day-one findings are therefore zero. The corpus is twelve pre-existing live specs dated 2026-06-07 through 2026-08-21 (thirteen counting this spec, which does carry the unit) and `docs/adr/0001` (2026-08-19), none of which could have complied with a contract that did not exist; flagging them yields rows clearable only by retro-authoring or by pasting markers, which trains operators to ignore the channel. This is [`docs/adr/0001`](../../adr/0001-absent-doc-surfaces-skip-release-gates.md)'s posture — opt-in is an affirmative authoring act — applied to artifacts instead of surfaces. Plans are out of scope: a plan decomposes an already-approved spec, so the evidence belongs one level up and repeating it is transcription.

### U5 — the `/noldor-garden` operator surface

Both `/noldor-garden` twins gate on emptiness and then enumerate named categories, so a new `GardenFindings` key rides the JSON while staying invisible to the operator. The skill's step-1 emptiness test grows the new key and its checklist grows a row for it, rendered as advisory — reported, never auto-actioned. Wiring alone does not meet the Goal; this is what does.

## Acceptance criteria

- `graph-context` exits 0 and reports the graph is not in use only when `graphify-out/graph.json` is both absent from disk and untracked.
- It returns `fresh` when either the committed leg or the working-tree leg passes, and `stale` only when neither does.
- A regeneration that rewrites an uncommitted `graphify-out/graph.json` moves the verdict from `stale` to `fresh`.
- It never invokes graphify. (It does shell `git log` — `evaluateGraphFreshness`'s own mechanism, not a regeneration.)
- On `fresh` it reports the summary toon as unusable, rather than as stale or absent overall, when the toon is missing or older than `graph.json`.
- On `fresh` it reports per path: community, dominant FD owners, top-20 degree symbols with rank, and cross-community edges — each capped as specified.
- A `--path` with no `L1` node is reported as absent from the graph; zero paths, or a path outside the repo, is a usage error; an unparseable `graph.json` is reported as `stale`, never thrown.
- The read step runs on `specs-only-*` and `full-*` and does not run on `fast-track` or `micro-chore`.
- The read step sources its candidate paths from the session marker's `uiVerdictPaths` rather than re-deriving them.
- The read step retries at most once after a regeneration, and falls back to writing the unit with a `noldor:cut` when the retry is still not `fresh`.
- Both `noldor-spec` twins and both `noldor-garden` twins carry identical step text (`checks template-sync` green).
- `pnpm noldor prep format spec` prescribes the `Structural context` unit, and `noldor adr new <slug>` writes a record containing it.
- `checkAdr` reports no new finding against records written before this change.
- The detector reports a spec whose unit is absent or under the floor, and an ADR whose unit still carries the template placeholder.
- The detector reports nothing for a unit whose `noldor:cut` line carries a reason, and still reports a bare `noldor:cut`.
- The detector reports nothing for any spec dated before `SPEC_FLOOR_DATE`, any archived spec, any plan, or any ADR numbered at or below `ADR_FLOOR_NUMBER`.
- The detector's findings appear under `structuralContextStubs`, never in `sddGaps`, and change no release preflight verdict; it produces findings in a repo with no `graphify-out/` exactly as in one with a graph.

## Risks / trade-offs

**Two freshness legs, one verdict.** The union is more machinery than either leg alone and a reader may ask which is canonical. The honest answer is that neither is: each is a *sufficient* condition, chosen because their blind spots do not overlap. The cost is that a pathological case — a regeneration older than an uncommitted source edit — reports fresh on the committed leg. That is the pre-existing behaviour of the release gate, and this feature is advisory, so it is not worth a third leg.

**A required section invites boilerplate.** The failure mode of any prose contract is a paragraph written to satisfy the check. The `noldor:cut` hatch is the mitigation and is deliberately cheap: an honest recorded skip is worth more than a fabricated paragraph, and the detector treats it as a full pass. The reason requirement is what stops the hatch from becoming a rubber stamp.

**Two stamped constants.** `SPEC_FLOOR_DATE` and `ADR_FLOOR_NUMBER` will look arbitrary in a year. The alternatives were worse: no floor floods the channel on day one, and a git-birth floor shells git per artifact and breaks in shallow clones and fresh worktrees. Two lines, cheap to revise.

**The ADR half is prescription without automation.** `adr new` prompts for the unit and the detector reports it unfilled, but nothing hands the author a digest. An author who ignores both writes a stub and gets one advisory row. Accepted for this slice, and stated in Non-goals rather than implied.

**Digest cost.** `graph.json` is 3.1 MB and the digest walks its nodes and edges per invocation. Fine for a once-per-session call; it rules out calling this per file in a loop.

## User Story

As a spec author (human or agent), I want the knowledge graph read before I draft the design and its findings recorded in the spec and in any decision record, so that a later reader can tell which part of the system's structure a decision moved.

## Usage

```bash
# During /noldor-spec, after the UI verdict and before drafting ## Design
# (specs-only-* and full-* paths only)
pnpm noldor design graph-context --path src/prep/formats.ts --path src/docs/adr-schema.ts

# exit 0, "graph not in use"  -> write the skip line, continue
# exit non-zero, "stale"      -> /graphify --ast-only && pnpm toon, then retry ONCE
# exit 0 with digest          -> write ### Structural context from it

# Same command by hand when authoring a decision record
pnpm noldor adr new my-decision
pnpm noldor design graph-context --path <the paths the decision moves>

# Stub report — advisory, never blocking
pnpm noldor garden detect
```

An author who deliberately skips the unit writes, inside the section:

```
noldor:cut graph not consulted — <reason> · <what would change the answer>
```

## Open questions (resolved)

1. *Should `graph-context` cache its digest across invocations in a session?* -> No. (D1) One call per session is the design; a cache adds invalidation for no measured gain.
2. *Should the detector flag a unit naming communities no longer present in the graph?* -> No, not in this slice. (D2) A genuine drift signal, but it needs the graph at detect time, which would make an optional dependency load-bearing for a garden run — and U4 is deliberately graph-free.
3. *Does the gate's Step 2.5 lint pass learn about the unit?* -> No. (D3) `lint-plan-snippets` and `split-check` are size and snippet checks; a content rule there duplicates the detector on a surface that already has enough signals.
4. *Should the floors be config rather than constants?* -> Constants. (D4) A consumer-tunable floor is a knob nobody would turn, and both values are meaningful only relative to the framework version that shipped them.
5. *Should the working-tree leg also consider uncommitted source edits newer than the graph?* -> No. (D5) It already does by construction — it compares against every file under `scanPaths` on disk. The committed leg is the one that ignores them, and that is the pre-existing release-gate behaviour this feature declines to change.
