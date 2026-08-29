# Mandatory C4 Diagram for New Feature MDs — Design

**Slug:** consumer-architecture-doc-surface-fd-c4-diagram
**FD:** docs/features/consumer-architecture-doc-surface.md
**Date:** 2026-08-29
**Tier:** specs-only
**Deps:** none

## Problem

`docs/architecture/` answers "how is this system shaped" above the feature level, and
Q-0178 prescribed the *form* of those four registry pages. Nothing does the same one
level down. A feature MD carries `## Summary`, `## User Story` and `## Usage` — all
prose — so the shape of the thing stays implicit until a reader reconstructs it from
`links.code`. `docs/features/autonomous-queue-drain-runner.md` describes a supervisor,
a child, a lock and a merge coordinator entirely in sentences; the reader who wants to
know which of those talks to which opens four source files.

The cost lands hardest on the readers the framework is built for. An agent picking up
an unfamiliar feature has no cheap structural read: `pnpm noldor design graph-context`
answers it for a *change*, but there is no per-feature artifact that answers it for the
feature as shipped.

## Goals

- Every FD — `noldor-tier: full` and `specs-only` alike — carries one mermaid diagram at
  whatever C4 level fits it, so a reader can depend on the section being there.
- The scaffold writes the section, so the requirement is visible at creation rather than
  at review — and so that scaffolding is the whole of the enrolment mechanism (D2).
- A check reports an FD whose diagram section is still a stub, and never blocks a ship.
- A deliberate skip is recordable and carries a reason.
- Nothing is asked of the 83 FDs that exist today, ever.

## Non-goals

- No rendering, no mermaid syntax validation, no image export. `fenceKinds` already
  reads the declared kind and that is the whole of the parse.
- No retro-authoring, and no mechanism that could later become one: the check has no
  floor date and no floor version to move (D2).
- No new registry. The four `docs/architecture/` pages keep their fixed C4 levels; an
  FD picks its own.
- No blocking gate anywhere — not at commit, not at push, not at release preflight.
- `fast-track` and `micro-chore` are out of scope for free: neither produces an FD.

## Design

### Structural context

Digest from `pnpm noldor design graph-context --path src/docs/architecture-form.ts
--path src/docs/architecture-schema.ts --path src/docs/docs-architecture.ts --path
src/garden/detectors/architecture.ts` (graph regenerated `--ast-only` in-worktree to
clear a `stale` verdict; 3014 nodes / 8015 edges / 170 communities).

Three of the four candidate paths sit in **c0** ("detectors", 92 nodes), alongside
`src/docs/readme-content.ts` and `src/cli/command-registry.ts`; the community is
co-owned by `outcome-telemetry-and-effectiveness-metrics` (5 files),
`consumer-architecture-doc-surface` (2) and `root-readme-content-validator` (2). None
of the four defines a god node — this is interior territory, which is itself the
finding: the architecture surface is a leaf consumer of shared parsers, not a hub.

The load-bearing edges are outward. `docs-architecture.ts` reaches `loadDocRoots()`
[c73], `scanRoots()` [c23] and `preflight-probes.ts` [c48] — the IO boundary the pure
form rules deliberately avoid. `architecture-schema.ts` sits alone in **c141** and is
imported by `docs-architecture.ts` [c0] and `data.ts` [c5] (the dashboard loader), so
the registry is already the shared vocabulary between checker and dashboard.
`garden/detectors/architecture.ts` bridges to `garden-detect.ts` [c28] via `detectAll()`
and to `sdd-report.ts` [c10] via `collectGaps()` — the two-lane split (blocking →
`sddGaps`, advisory → own key) is visible in the edge set.

The new work lands in a *different* neighbourhood: the FD body, not the architecture
pages. `src/garden/detectors/structural-context.ts` is the nearer relative — same
advisory-with-teeth shape, same `noldor:cut` escape, same "own `GardenFindings` key,
absent from `FINDING_CATEGORIES`" routing. That is the module to mirror, and its
section-location machinery (`tagLines` / `locateSection` / `density`) is what D4 lifts
into a shared home.

### The contract module

`src/core/fd-diagram-contract.ts`, a leaf module mirroring
`src/core/structural-context-contract.ts` exactly — no IO imports, so the scaffold, the
skills' twin templates and the detector can all read the same facts without pulling the
filesystem into `prep/scaffold.ts`.

It exports `FD_DIAGRAM_HEADING = 'Diagram'`, the placeholder block the scaffold writes,
and `MIN_FD_DIAGRAM_PROSE_CHARS`. It exports no floor constant of any kind: D2 makes
scope a property of the document (does it carry the heading?) rather than of a stamped
version or date, which removes the class of bug `ADR_FLOOR_NUMBER`'s docstring warns
about — there is nothing here that could be recomputed wrongly. `CUT_MARKER` is re-used
from `structural-context-contract.ts` rather than re-declared: this is an ordinary
ladder cut, not a section decline, so the `noldor:cut-section` fork that
`architecture-form.ts` needed does not arise here.

### Where the section lives in the FD body

`## Diagram`, placed immediately after `## Summary` and before `## User Story`. Shape
before story: a reader who has just read one paragraph of what the feature *is* is
exactly the reader the diagram serves, and the ordering matches how the registry pages
read (fence first, prose beside it). `docs/noldor/feature-md-schema.md` §Body sections
gains it as a fourth required entry, at both tiers.

### What counts as filled

Two conditions, both required, mirroring the parent surface's own doctrine that a
diagram without prose beside it is not a documented shape:

1. The section carries at least one mermaid fence whose declared kind is non-empty —
   read with `fenceKinds` from `src/docs/docs-architecture.ts`, which already handles
   YAML front-matter blocks, `%%` comments and unterminated fences.
2. The section's non-fence prose passes `MIN_FD_DIAGRAM_PROSE_CHARS`, same measure
   (`density`, non-whitespace characters) and same reasoning as
   `MIN_STRUCTURAL_CONTEXT_CHARS = 24`.

A `noldor:cut <reason>` line inside the section suppresses both, provided the reason
clears the same floor. The floor value is inherited rather than measured — O4.

### The shared section scanner

`detectStructuralContextStubs` already owns fence-aware markdown section location, and
its ~120 lines encode CommonMark fixes found the hard way: a fence closes only on the
same character at least as long as the opener, an info string can open a fence but never
close one, and only unfenced lines may open or close a section. This detector needs all
of it and differs only in the arguments it would pass.

So `tagLines`, `locateSection`, `ancestorOk` and `density` move to a shared `src/core`
module and both detectors import them (D4). The move is behaviour-preserving: the two
call sites differ only in the parameters `locateSection` already takes — depth 3 with
`requireAncestor: '## Design'` for a spec's unit, depth 2 with no ancestor for an FD's
`## Diagram`. `structural-context.ts`'s existing tests are the regression proof and must
pass unchanged.

The cost is deliberate: this is a docs feature editing a detector that shipped
2026-08-28. Copying instead would fork those edge-case fixes into two files, and
`clones check` would flag it regardless.

### The detector

`src/garden/detectors/fd-diagram.ts`, exporting `detectFdDiagramStubs(repo)` →
`FdDiagramStub[]` and `toGaps()`, structurally parallel to
`detectStructuralContextStubs` and importing the same scanner (D4). Rules:
`placeholder-only` / `no-fence` / `stub-section`.

**Scope is presence-gated (D2).** An FD with no `## Diagram` H2 is not in scope — no
row, no message, nothing. That single rule is what delivers "nothing retrospective":
the 83 FDs that exist today carry no such heading and are therefore permanently silent,
while every FD the scaffold writes from here on arrives carrying the placeholder and is
in scope from its first commit. There is no floor constant, no date comparison and no
git read anywhere in the detector. Tier is not consulted either — both `full` and
`specs-only` FDs are scaffolded with the section, so the heading's presence already
encodes the tier decision made at scaffold time.

The trade the gating makes: `missing-section` cannot exist as a rule, so an author who
deletes the scaffolded heading escapes the check silently. O1 answers that.

It rides a new `GardenFindings` key `fdDiagramStubs`, deliberately absent from
`FINDING_CATEGORIES` in `garden-detect-runner.ts` for the reason that key's siblings
document: that list gates the garden auto-restamp, an unstamped receipt is a blocking
release row, and an undrawn diagram must never stop a ship.

### The scaffold sites

Four writers emit the FD body and all four must gain the section — and under D2 this is
load-bearing rather than cosmetic: a writer that omits it silently exempts every FD it
creates, because scope *is* presence. There is no tier condition at any of them.

- `scaffoldFd` in `src/prep/scaffold.ts` (the prep pipeline)
- `/noldor-promote` step 6 template + its `templates/` twin
- `/noldor-new-feature` template + its `templates/` twin
- `docs/noldor/feature-md-schema.md` + its `templates/` twin

`pnpm noldor doctor` compares each skill against its `templates/` twin, so a one-sided
edit reds. Whether `/noldor-draft-feature-md --refresh` should also touch the section is
O2 — it currently rewrites only `User Story` and `Usage`.

## Acceptance criteria

1. `scaffoldFd` emits `## Diagram` between `## Summary` and `## User Story`, carrying the placeholder, for both `full` and `specs-only` entries.
2. `detectFdDiagramStubs` returns no row for an FD that carries no `## Diagram` heading, whatever its tier, `introduced` or age.
3. An FD whose section holds only the placeholder yields one row with rule `placeholder-only`.
4. An FD whose section holds prose but no mermaid fence yields rule `no-fence`.
5. An FD whose section holds a fence but prose below the floor yields rule `stub-section`.
6. An FD whose section holds a mermaid fence with a declared kind plus prose at or above the floor yields no row.
7. A `noldor:cut <reason>` line inside the section suppresses the row; a bare marker with no reason does not.
8. A `## Diagram` heading inside a fenced code block neither opens nor closes the section.
9. Running the detector over `docs/features/` as it stands today yields zero rows.
10. `garden detect --json` carries `fdDiagramStubs`; `FINDING_CATEGORIES` does not, so a stub never fails the runner and never blocks a release.
11. `structural-context.ts`'s existing test suite passes unchanged after the scanner moves to its shared module.
12. A mermaid fence declaring any kind satisfies condition 1; the detector never rejects a kind.

## Risks / trade-offs

- **A deleted heading is an invisible escape.** Presence-gating buys a floor-free,
  git-free, zero-retro scope rule at the price of the `missing-section` rule. An author
  who removes the scaffolded section is indistinguishable from an FD that predates the
  contract. O1.
- **Advisory that nobody reads.** `structuralContextStubs` and `architectureAdvisories`
  both ride `garden detect --json` and nothing renders them in prose today. A third
  invisible key is a real risk; O3.
- **A fence is not a diagram.** Nothing stops a two-node `graph TD`. The check asserts
  the *question* is on the page, exactly as `assessPageForm` does for registry sections —
  a check that guessed at diagram quality would be arguable precisely where it matters.
- **Two-condition fill is stricter than the sibling.** `structural-context` needs only a
  character floor. Requiring fence *and* prose may push authors to the `noldor:cut`
  escape, which would make the marker the norm rather than the exception.
- **The lift touches a module that shipped yesterday.** D6 moves ~120 lines out of
  `structural-context.ts` (2026-08-28) into a shared home, so a docs feature carries a
  refactor of live detector code and its test suite. Mitigated by the move being pure —
  no behaviour change, both callers' tests must stay green unchanged — but it is real
  CR surface that copying would not have cost.

## User Story

As a maintainer or review agent opening an unfamiliar feature, I want its FD to carry a
diagram of the feature's shape beside its prose, so that I can see which parts talk to
which without reconstructing it from `links.code`.

## Usage

**Authoring**

1. `/noldor-promote <slug>` or `/noldor-new-feature <slug>` scaffolds `## Diagram` with a
   placeholder between `## Summary` and `## User Story`, at either tier.
2. Replace the placeholder with a real mermaid diagram at whichever C4 level fits the
   feature — a `flowchart` of its modules, a `sequenceDiagram` of its one load-bearing
   flow. Write a sentence or two beside it; that prose is the textual equivalent for
   readers and agents that do not render mermaid.
3. Decline it deliberately when the feature genuinely has no shape worth drawing:
   `noldor:cut a single pure function — the signature is the shape`. The reason is
   required; a bare marker suppresses nothing.

**Reporting**

- `pnpm noldor garden detect --json` carries `fdDiagramStubs[]`, each row naming the FD,
  the rule, and the remediation.
- Nothing blocks. Not `pnpm noldor commit`, not the pre-push chain, not `pnpm release`.
- An FD that carries no `## Diagram` heading is never reported — that is how the 83
  existing FDs stay out of it.

**Agent/Programmatic API**

- `detectFdDiagramStubs(repo)` → `FdDiagramStub[]` — `{ file, rule, message }`.
- `toGaps(stubs)` → `Gap[]` for callers that want the report shape.

## Open questions (resolved)

1. *Presence-gating drops `missing-section`, so deleting the scaffolded heading escapes
   the check. Does that need a counter?*
   -> **No counter.** (D6) Every escape hatch on this surface is deliberate and
   unpoliced — `noldor:cut` needs only a reason nobody verifies, and `architecture-form`'s
   section decline works the same way. An author who deletes a heading to silence an
   advisory has made a decision the framework was never going to win by force; the
   alternatives cost either a git read or a floor constant, both rejected under D2.

2. *Should `/noldor-draft-feature-md --refresh` draft the diagram?*
   -> **No.** (D7) It refreshes `User Story` / `Usage` from spec + code + tests; a drafted
   diagram would be a generated guess at a shape the author is the authority on, and gate
   Step 4 runs it with `--yes` in autonomous mode — so a wrong guess would land unread.

3. *Should this feature also render the advisory keys in prose?*
   -> **No — scope it out and emit it as residue.** (D8) `fdDiagramStubs`,
   `structuralContextStubs` and `architectureAdvisories` share one gap: all three ride
   `garden detect --json` and nothing renders them. A renderer covering one key and not
   its two siblings is the wrong shape, so this ships as a sibling roadmap entry rather
   than as scope creep here.

4. *What prose floor beside the fence?*
   -> **24 non-whitespace characters, as its own constant.** (D9) Same value and same
   reasoning as `MIN_STRUCTURAL_CONTEXT_CHARS` — long enough to reject a two-word
   gesture, short enough not to punish an honest one-liner. A separate constant so the
   two contracts may diverge, matching how `structural-context-contract.ts` deliberately
   forked from `summary-body-contract.ts`.

5. *Which mermaid kinds are allowed in the fence?*
   -> **Any kind, so long as one is declared.** (D10) The four registry pages constrain
   kinds because each answers a fixed C4 question; an FD picks its own level, so
   constraining the set here would be the framework guessing at a feature's shape. The
   check reads that a kind exists, not which.
