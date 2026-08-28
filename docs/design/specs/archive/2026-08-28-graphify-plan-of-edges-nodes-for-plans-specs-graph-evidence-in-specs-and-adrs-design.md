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
  /** co-members of that community, degree desc then label asc, capped at 5 */
  coMembers: string[];
  /** FD slugs owning that community's files, via getCommunityOwners, capped at 3 */
  owners: CommunityOwnerSuggestion[];
  /** symbols this path defines that rank in the top 10 by degree */
  topDegreeSymbols: { label: string; degree: number; rank: number }[];
  /** incident edges whose other endpoint sits in another community, capped at 10 */
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
  /** already-validated repo-relative POSIX paths; may be empty (verdict-only) */
  paths: readonly string[];
}): Promise<GraphContextResult>;
```

**The freshness verdict is a union of two legs**, and that union is the correction that makes this feature possible at all:

Both legs read their roots from `scanRoots(cwd)` ([`src/core/repo-paths.ts`](../../../src/core/repo-paths.ts):26), the documented single source of truth, which falls back to `DEFAULT_SCAN_ROOTS` (`['packages', 'apps', 'scripts', 'src']`) when the consumer configures none. Reading raw `loadConsumerConfig(cwd).scanPaths` instead would break both legs in opposite directions: it defaults to `[]` ([`src/core/consumer-config.ts`](../../../src/core/consumer-config.ts):187), which makes `evaluateGraphFreshness` return `skipped` so the committed leg is permanently dead, while an empty root list gives the mtime comparison no file to lose to and reports fresh vacuously.

- **committed leg** — `evaluateGraphFreshness(scanRoots(cwd), cwd)` from [`src/release/graph-freshness.ts`](../../../src/release/graph-freshness.ts) returns `fresh`, **and** the on-disk `graphify-out/graph.json` is clean relative to `HEAD` — tested with `git status --porcelain -- graphify-out/graph.json` returning no output, *not* with `git diff --quiet HEAD --`, which ignores untracked files entirely (measured: exit 0 for a file git has never seen) and would therefore bless an untracked graph as matching content that does not exist. The content guard is what keeps the verdict honest about the file the digest actually parses: without it, a working tree whose graph was replaced with older content would inherit its committed version's freshness.
- **working-tree leg** — `graphify-out/graph.json`'s mtime is newer than every file under `scanRoots(cwd)`.

  This comparison exists inside `loadFreshGraphOrWarn` but is **not reachable from it**: `newestMtimeInRoots` ([`src/garden/graph-fd-lookup.ts`](../../../src/garden/graph-fd-lookup.ts):125) and its `walkSync` (:143) are module-private, and the one exported entry point parses the graph and returns a co-tag-flavoured `Gap` this command cannot consume. So the unit **lifts both helpers to [`src/core/repo-paths.ts`](../../../src/core/repo-paths.ts), beside `scanRoots`**, and `graph-fd-lookup.ts` imports them from there. Naming the lift matters twice over: an implementer told merely to "reuse the comparison" copies the walker, and the clones ratchet reds that.

  The lift also has to fix a latent cwd bug, or U1's injectable `cwd` is a lie. Today `newestMtimeInRoots` calls `loadConsumerConfig()` with no argument — defaulting to `process.cwd()` — and hands `walkSync` each root as a bare relative path, so `graphContext({ cwd: tmpdir })` would walk the *process* tree and report freshness from an unrelated repo. The lifted signature therefore takes `cwd` explicitly, joins every root against it, and passes `cwd` through to `loadConsumerConfig(cwd)`. `loadFreshGraphOrWarn`'s existing call site keeps today's behaviour by passing `process.cwd()`.

`fresh` when **either** leg passes; `stale` when neither. Each leg alone is a dead end, and their failures are complementary. The committed leg cannot see an uncommitted regeneration, so on its own the stale → regen → retry loop can never clear: measured in this repo, `graphify-out/graph.json` was last committed `2026-08-23` (`4c1f680`) while `src` has commits through `2026-08-28` (`366cb50`), and `/graphify` writes an uncommitted artifact, so the verdict would stay `stale` forever and the digest path would be unreachable by construction. The working-tree leg cannot return fresh right after `git worktree add`, which stamps every file at one instant. Together: a regeneration rewrites `graph.json` and immediately satisfies the working-tree leg, while a clean tree with a committed-fresh graph satisfies the committed one. The union also removes a data-source split — the verdict and the digest now both key on the working-tree file the digest actually parses.

`skipped` requires `graphify-out/graph.json` to be **both** absent from disk and untracked. Keying on tracked-ness alone would skip a consumer who gitignores `graphify-out/` but regenerates locally; keying on disk presence alone would misreport a consumer who tracks the graph but has not checked it out.

**Precedence.** Resolution is ordered, not simultaneous: presence (→ `skipped`), then parse, then the freshness legs. An unreadable or unparseable `graph.json` — or one that parses but lacks the `nodes`/`links` arrays — is `stale` regardless of either leg, because a graph that cannot be read cannot be fresh. Individual malformed rows (an edge whose endpoint is missing, a node with no `community`) are dropped from the digest rather than failing the verdict; the count of dropped rows lands in `detail`.

**Usage errors live at the CLI, not in the result type.** `graph-context` validates `--path` arguments — normalizing to repo-relative POSIX form, rejecting anything that escapes the repo — and exits 2 before calling `graphContext`, so `GraphContextStatus` needs no error member and a direct API caller passes already-validated paths. Zero paths is **valid**, not an error: the call returns the verdict with an empty `digests` array. That matters because the skill must always get a verdict to write an honest unit, even for a change whose candidate set is empty.

**Outcomes.** `skipped` prints one line and exits 0 — a missing graph is not a failure. `stale` prints the verdict plus the exact remediation (`/graphify --ast-only`, then `pnpm toon`) and exits non-zero; the command never runs a regeneration itself, because graphify's CLI exposes no build command (extraction is the `/graphify` skill, an agent workflow), the locally installed binary is version-skewed against its own skill, and a consumer may not have it — the command's only shell-outs are git ones, each named where it is used: `evaluateGraphFreshness`'s own `git log`, the committed leg's `git status --porcelain`, and the presence step's tracked-ness probe (`git ls-files --error-unmatch`, which is what answers "untracked" — `evaluateGraphFreshness`'s `skipped` detail cannot, because precedence puts presence before the legs). Running no *graphify* subprocess is what keeps it unit-testable. `fresh` prints the summary-toon path and the per-path digest, and exits 0.

The summary toon is advisory **within** `fresh`, reported as `usable: false` when it is missing or older than `graph.json` rather than demoting the verdict. The digest is what the unit needs; the toon is orientation, and only `pnpm toon` regenerates it, so gating the load-bearing path on it would add a failure state carrying no independent signal.

**Digest rules.** `--path` is repeatable; paths are deduplicated after normalization. A path with no `L1` node reports `inGraph: false` and a null community rather than an empty digest. When a file carries several `L1` nodes the first in graph order wins and the rest are ignored, matching `getCommunityOwners`, which already reads only the file-level node.

Degree is undirected — the graph declares `directed: false` — counting each `source`/`target` pair once so duplicate rows cannot inflate a rank, with ties broken by label ascending. The ranking population is every node in the graph and the cap is the **top 10**, which is exactly the length of `GRAPH_REPORT.md`'s "God Nodes (most connected)" list, so the cap is graphify's own and no threshold is invented. (The 20 in the summary toon is `community index (top 20 by size)` — a different list of a different thing.)

Every other list is ordered before it is capped, so two implementations agree: `coMembers` by degree descending then label ascending; `owners` by `getCommunityOwners`'s existing count-descending, slug-ascending order; `crossCommunityEdges` by other-endpoint degree descending then label ascending. Cross-community traversal is undirected — every edge *incident* to one of the path's nodes whose other endpoint sits in a different community qualifies, and `from`/`to` are oriented with the path's own node first for readability, not to assert direction. An endpoint whose node carries no numeric `community` is excluded rather than coerced, which is what keeps `toCommunity: number` truthful.

### U2 — the `/noldor-spec` structural-read step

A new step in both skill twins — [`.claude/skills/noldor-spec/SKILL.md`](../../../.claude/skills/noldor-spec/SKILL.md) and its `templates/` copy, which must move together or `doctor` reds — placed after the UI-verdict step 1.5 and before the step-2.5 strawman, so the reading informs `## Design` instead of decorating it afterwards. It is gated on the session marker's `path` being `specs-only-*` or `full-*`; `fast-track` and `micro-chore` never run it, mirroring Q-0185's tier scoping so the XS drain is untaxed.

Candidate paths come from a **new** session-marker key, `candidatePaths`: the pre-filter set (`links.code` ∪ the entry's `Touches:`) that step 1.5 derives on its way to the UI verdict, persisted alongside it. The existing `uiVerdictPaths` is emphatically *not* that set — [`src/core/session.ts`](../../../src/core/session.ts):32 documents it as "the candidate paths that **matched** `uiPaths`", and `sessionUiVerdict` persists `candidatePaths.filter(...)` — so it holds the matched subset and is empty for every session in a repo where `consumer.uiPaths` is unset, as it is here. Reading it would hand `graph-context` zero paths on every run.

Persisting the pre-filter set costs one optional schema field and keeps one derivation feeding both consumers; the alternative, re-deriving in U2's prose, creates a second copy that can drift from step 1.5 and from the UI predicate. Because zero paths is a valid verdict-only call, a feature whose candidate set really is empty still gets a verdict and still writes an honest unit.

Branching on the verdict: on `skipped`, write the unit as a `noldor:cut` recording that the repo tracks no graph — not a bare prose line, which the detector this feature introduces would itself flag as a stub. On `stale`, run `/graphify --ast-only` **then `pnpm toon`** and retry exactly once — the working-tree leg is what that regeneration satisfies. If the retry still is not `fresh` (graphify absent, regeneration failed), write the unit from what is available plus a `noldor:cut` naming the staleness. On `fresh`, read the summary toon when `usable`, read the digest, and write `### Structural context`. The step may never stop a session; advisory-with-teeth applies here as much as to the detector.

### U3 — the contract additions

`SPEC_FORMAT` gains one line prescribing a `### Structural context` H3 inside `## Design` — inside, not beside, because `## Design` is the H2 the format already fixes and the skill's dialogue loop addresses H3s. `renderAdrTemplate` gains a `## Structural context` section between Context and Decision — where it reads as evidence for the decision rather than as an afterthought — carrying the single placeholder line "Which communities, god nodes, and cross-community edges does this decision move?", which is the exact literal U4's ADR stub clause matches. Both name the same three things — communities, god nodes, cross-community edges — and both accept a recorded skip in place of content.

The ADR change is additive and safe by construction: `checkAdr` in [`src/docs/docs-adr.ts`](../../../src/docs/docs-adr.ts) validates filenames, frontmatter, and the supersede chain, never body sections, so no existing record can be invalidated by a template that grew. `renderAdrTemplate` is deliberately a code-embedded generator rather than a `templates/` file, so `init` and `template-sync` are unaffected. Per Non-goals, nothing automates the ADR-side read.

### U4 — `detectStructuralContextStubs`

A detector in `src/garden/detectors/structural-context.ts` reporting artifacts whose unit is missing or unfilled. It follows the `architectureAdvisories` wiring exactly: computed in `detectAll` ([`src/garden/garden-detect.ts`](../../../src/garden/garden-detect.ts):802), surfaced on its own `GardenFindings` key named `structuralContextStubs`, and deliberately **absent** from `FINDING_CATEGORIES` in [`src/garden/garden-detect-runner.ts`](../../../src/garden/garden-detect-runner.ts). That absence is the entire non-blocking guarantee: the list gates the garden auto-restamp, and an unstamped receipt is a blocking release row, so anything routed through it blocks a release. Finding shape is `SddGap` — `{ category: 'structural-context', itemId: '<file>#<rule>', message }` — matching the architecture detector's stable-identity convention so repeated runs never duplicate.

The detector reads only the artifacts. It never opens the graph, so it behaves identically in a repo with no `graphify-out/` — reporting a stub there is correct, because the unit's honest content in that repo is a `noldor:cut` saying no graph is tracked.

**Matching semantics.** The heading is the exact case-sensitive text `Structural context`, at H3 in a spec and H2 in an ADR. Fenced regions are stripped for **scanning only** — heading detection, section termination, and `noldor:cut` detection all run over the stripped text, so neither a heading nor a marker inside a fence can classify an artifact (otherwise this spec's own fenced examples would). The character floor, by contrast, measures the section body **unstripped**: a unit whose evidence is a fenced digest excerpt has done the work, and zeroing those characters would call it a stub.

**Stub rule.** A unit is a stub when the section heading is absent, when its body falls under a non-whitespace character floor, or — ADRs only — when the trimmed body is *nothing but* `renderAdrTemplate`'s placeholder sentence. Requiring the body to be only the placeholder is what stops an ADR that kept the sentence and added real prose beneath it from failing. The placeholder clause is ADR-only because there is no spec scaffold: [`src/prep/scaffold.ts`](../../../src/prep/scaffold.ts) scaffolds the FD alone, and specs are agent-authored from `SPEC_FORMAT` prose, so no placeholder string exists to match. The floor reuses the rationale settled in [`src/core/summary-body-contract.ts`](../../../src/core/summary-body-contract.ts) (`MIN_SECTION_CHARS = 24` — "long enough to reject `Why — x`, short enough never to block an honest one-line reason"); the technique is borrowed, not the module, which is PR-summary-specific. Section body means everything from the heading to the next heading of the same or shallower depth in the stripped text; a duplicate heading takes the first occurrence.

**Skip marker.** A line whose first non-whitespace token is `noldor:cut`, **inside the unit's own section body**, suppresses the finding — a marker elsewhere in the artifact suppresses nothing, and an absent heading therefore cannot be suppressed at all (there is no section to carry the marker; write the heading with the marker under it). — the same bare spelling `/noldor-refactor` already greps for, so a doc marker and a code marker stay one convention. It must carry a reason: the marker line needs the character floor's worth of text after the token, so a bare `noldor:cut` is still a stub. That closes the gap between this rule and Usage, which asks for a reason and a condition.

**Floor.** Specs: non-archive only, and only those whose filename date prefix is on or after `SPEC_FLOOR_DATE = '2026-08-28'` — this spec's own date, so this spec is the first artifact in scope. The date is read by a new exported `specDateFromFilename()` in [`src/core/design-artifact-names.ts`](../../../src/core/design-artifact-names.ts), added because the module's `SPEC_FILE_RE` is private and captures only the slug (its exports are `ARCHIVE_DIR`, `UI_BASELINE_DIR`, and the three `*SlugFromFilename` helpers), and `detectStaleDesignArtifacts` consumes it solely through `specSlugFromFilename` and never reads a date. The new helper reuses that one regex to confirm the shape and returns the leading ten characters, so the filename contract keeps a single definition. Keying on the filename rather than the author-typed `**Date:**` line keeps a field no validator enforces out of the trust path; a filename that fails the regex is skipped, fail-open.

ADRs: only numbers strictly above `ADR_FLOOR_NUMBER = '0001'`, the highest record present today. Both are literal constants stamped now — `ADR_FLOOR_NUMBER` is emphatically *not* recomputed at detect time, which would make the ADR half never fire. The clause matches exactly one literal: the placeholder U3 adds for the new section, which is **"Which communities, god nodes, and cross-community edges does this decision move?"**. `renderAdrTemplate`'s three existing sentences ([`src/docs/adr-schema.ts`](../../../src/docs/adr-schema.ts):139-147) are context for the template's house style, not match targets — the detector never reads them.

Day-one findings are therefore zero. The corpus is twelve pre-existing live specs dated 2026-06-07 through 2026-08-21 (thirteen counting this spec, which does carry the unit) and `docs/adr/0001` (2026-08-19), none of which could have complied with a contract that did not exist; flagging them yields rows clearable only by retro-authoring or by pasting markers, which trains operators to ignore the channel. This is [`docs/adr/0001`](../../adr/0001-absent-doc-surfaces-skip-release-gates.md)'s posture — opt-in is an affirmative authoring act — applied to artifacts instead of surfaces. Plans are out of scope: a plan decomposes an already-approved spec, so the evidence belongs one level up and repeating it is transcription.

### U5 — the `/noldor-garden` operator surface

Both `/noldor-garden` twins gate on emptiness and then enumerate named categories, so a new `GardenFindings` key rides the JSON while staying invisible to the operator. The skill's step-1 emptiness test grows the new key and its checklist grows a row for it, rendered as advisory — reported, never auto-actioned. Wiring alone does not meet the Goal; this is what does.

## Acceptance criteria

- `graph-context` reports the graph not in use only when `graphify-out/graph.json` is both absent from disk and untracked; both freshness legs read `scanRoots()`, so a consumer configuring no `scanPaths` still gets a live verdict rather than a dead committed leg or a vacuous working-tree one.
- The verdict is `fresh` when either leg passes and `stale` when neither does; a regeneration that rewrites an uncommitted `graph.json` moves `stale` → `fresh`, and a working tree whose `graph.json` differs from its committed content cannot pass the committed leg.
- Presence, then parse, then freshness: an unreadable or structurally invalid `graph.json` is `stale` whichever leg would otherwise pass, and is never thrown. Individual malformed rows are dropped from the digest instead.
- `graph-context` never invokes graphify. Its only shell-outs are git: `git log`, `git status --porcelain` for the content guard, and `git ls-files --error-unmatch` for tracked-ness.
- An untracked on-disk `graph.json` cannot pass the committed leg's content guard.
- On `fresh` the summary toon is reported as unusable — not as a stale or absent verdict — when it is missing or older than `graph.json`.
- On `fresh` each path reports community, dominant FD owners, top-10 degree symbols with rank, and cross-community edges, every list deterministically ordered before it is capped, so two implementations agree on the same graph.
- A path with no `L1` node is reported as absent from the graph; zero paths returns a verdict with no digests; a path escaping the repo exits 2 before any verdict is computed.
- The read step runs on `specs-only-*` and `full-*`, never on `fast-track` or `micro-chore`, and sources its paths from the marker's pre-filter `candidatePaths` — so it works in a repo where `consumer.uiPaths` is unset.
- The working-tree leg reports on the injected `cwd`, not on `process.cwd()`, and the lifted mtime helper has exactly one definition in the tree (`clones check` green).
- The read step retries at most once after a regeneration, and every branch it can take — `skipped`, exhausted-retry, `fresh` — writes a unit the detector accepts, so the step can never author its own stub.
- Both `noldor-spec` twins and both `noldor-garden` twins carry identical step text (`checks template-sync` green).
- `pnpm noldor prep format spec` prescribes the unit; `noldor adr new <slug>` writes a record containing it; `checkAdr` reports no new finding against records written before this change.
- The detector reports a spec or ADR whose unit is absent or under the floor, and an ADR whose unit is nothing but the template placeholder — but not one that keeps the placeholder and adds real prose beneath it.
- Suppression requires a `noldor:cut` line inside the unit's own section carrying a reason past the floor; a bare marker, or a marker elsewhere in the artifact, is still a stub.
- A heading or marker inside a fenced block is ignored for detection and suppression, while the character floor still counts fenced evidence inside the section body.
- The detector reports nothing for a spec dated before `SPEC_FLOOR_DATE`, a filename failing the date regex, an archived spec, a plan, or an ADR numbered at or below `ADR_FLOOR_NUMBER` — so day-one findings are zero.
- The detector never opens the graph: it produces findings in a repo with no `graphify-out/` exactly as in one with a graph.
- Findings appear under `structuralContextStubs`, never in `sddGaps`, and change no release preflight verdict; `/noldor-garden` still surfaces them when that key is the only non-empty category.

## Risks / trade-offs

**Two freshness legs, one verdict.** The union is more machinery than either leg alone and a reader may ask which is canonical. The honest answer is that neither is: each is a *sufficient* condition, chosen because their blind spots do not overlap. The cost is that a pathological case — a regeneration older than an uncommitted source edit — reports fresh on the committed leg. That is the pre-existing behaviour of the release gate, and this feature is advisory, so it is not worth a third leg.

**A required section invites boilerplate.** The failure mode of any prose contract is a paragraph written to satisfy the check. The `noldor:cut` hatch is the mitigation and is deliberately cheap: an honest recorded skip is worth more than a fabricated paragraph, and the detector treats it as a full pass. The reason requirement is what stops the hatch from becoming a rubber stamp.

**Two stamped constants.** `SPEC_FLOOR_DATE = '2026-08-28'` and `ADR_FLOOR_NUMBER = '0001'` will look arbitrary in a year. The alternatives were worse: no floor floods the channel on day one, and a git-birth floor shells git per artifact and breaks in shallow clones and fresh worktrees. Two lines, cheap to revise.

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
