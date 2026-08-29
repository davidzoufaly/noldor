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

- **The invariant:** every FD produced by a supported scaffold carries a `## Diagram`
  section holding either a completed diagram or a reasoned cut — at `noldor-tier: full`
  and `specs-only` alike. It is deliberately *not* "every file under `docs/features/`":
  presence-gating (D2) exempts anything the scaffolds did not write, which is what makes
  the requirement non-retrospective. `docs/noldor/feature-md-schema.md` records the
  section and its position as convention; the detector enforces neither presence nor
  ordering, only the content of a section that exists.
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

It exports `FD_DIAGRAM_HEADING = 'Diagram'`, `FD_DIAGRAM_PLACEHOLDER` (the exact block
below, so the one TypeScript writer emits what the Markdown templates hand-copy) and
`MIN_FD_DIAGRAM_PROSE_CHARS = 24`. It does **not** re-declare the placeholder *marker*:
that is `PLACEHOLDER_MARKER` from `src/docs/architecture-schema.ts`, already `<!-- TODO:`
and already meaning "scaffolded but untouched". Nor does it re-declare `CUT_MARKER`.
Three Markdown twins cannot import a TypeScript constant, so the templates carry the
block as literal text and `pnpm noldor doctor` is what keeps them equal to each other —
the constant is the authority for `scaffoldFd` and for placeholder detection.

It exports no floor constant of any kind: D2 makes
scope a property of the document (does it carry the heading?) rather than of a stamped
version or date, which removes the class of bug `ADR_FLOOR_NUMBER`'s docstring warns
about — there is nothing here that could be recomputed wrongly. `CUT_MARKER` is re-used
from `structural-context-contract.ts` rather than re-declared: this is an ordinary
ladder cut, not a section decline, so the `noldor:cut-section` fork that
`architecture-form.ts` needed does not arise here.

### What "C4" means here

The entry asks for "a mermaid diagram at the C4 level that fits it", and that phrase is
about **level of abstraction, not notation**. An FD picks the altitude its feature is
legible at — the context around it, the containers it spans, or the components inside it
— and draws that. Which mermaid keyword expresses it is free: a `flowchart` of modules,
a `sequenceDiagram` of one runtime flow and a `C4Component` fence are all acceptable
answers, and the detector reads only that *some* kind is declared (D10).

This is a deliberate departure from `ARCHITECTURE_PAGES`, where each of the four
registry pages constrains `allowedKinds` because each answers one fixed C4 question. No
fixed question exists per FD, so a constrained set here would be the framework guessing
at a feature's shape. Nothing requires C4 notation, and no fidelity metadata is written
or checked — the surface asserts that the question is answered, exactly as
`assessPageForm` does for registry sections.

### Where the section lives in the FD body

`## Diagram`, placed immediately after `## Summary` and before `## User Story`. Shape
before story: a reader who has just read one paragraph of what the feature *is* is
exactly the reader the diagram serves, and the ordering matches how the registry pages
read (fence first, prose beside it). `docs/noldor/feature-md-schema.md` §Body sections
gains it as a fourth required entry, at both tiers.

### The scaffolded block

Every writer emits exactly this, verbatim:

```markdown
## Diagram

<!-- TODO: one mermaid fence at the C4 level that fits this feature, and a sentence or
     two beside it for readers that do not render mermaid. No shape worth drawing?
     Replace this comment with: noldor:cut <reason> -->
```

The marker is `PLACEHOLDER_MARKER` from `src/docs/architecture-schema.ts` — the literal
`<!-- TODO:` the architecture surface already uses for the same purpose, reused rather
than re-declared so the two scaffolds cannot drift into two spellings of "untouched".
**The detector imports it, not the contract module:** nothing under `src/core` imports
`src/docs` today (the edge runs the other way, `docs-architecture.ts` → `core/doc-roots`),
and `core-is-foundation` in `.noldor/config.json` does not list `docs`, so an inverted
import would ship unflagged by dependency-cruiser. `src/garden/detectors/` already imports
from `src/docs` (`structural-context.ts` → `docs/adr-schema.js`), so the detector is the
right altitude for that edge.

Detection is **substring on the marker**, not exact-block matching against
`FD_DIAGRAM_PLACEHOLDER`. The block's wording is prose that will be improved, and an exact
match would stop recognising the placeholder the first time someone reworded it. The
constant is therefore the authority for what `scaffoldFd` *writes*, and the marker is the
authority for what the detector *reads* — two jobs, deliberately not one. Nothing verifies
that the three Markdown twins equal the TypeScript constant character-for-character;
`doctor` keeps the twins equal to each other, and a test asserts `FD_DIAGRAM_PLACEHOLDER`
contains `PLACEHOLDER_MARKER`, which is the only property either side actually depends on.

Because the block is an HTML comment it contributes nothing to prose density (below), so
a scaffolded-but-untouched section measures as empty — which is what makes
`placeholder-only` distinguishable from a section someone deleted the comment from and
then abandoned.

### What counts as filled

Two conditions, both required, mirroring the parent surface's own doctrine that a
diagram without prose beside it is not a documented shape:

1. **`hasFence`** — the comment-stripped section carries at least one mermaid fence whose
   declared kind is non-empty, read with `fenceKinds` from `src/docs/docs-architecture.ts` (it already
   handles YAML front-matter blocks, `%%` comments and unterminated fences). Several
   fences satisfy it as one: `fenceKinds` returns every kind it finds and the test is
   that the list is non-empty, so a page may carry extra diagrams — the same rule
   `ArchitecturePage.allowedKinds` states for the registry.
2. **`density ≥ MIN_FD_DIAGRAM_PROSE_CHARS`** — prose beside the diagram, at 24
   non-whitespace characters (D9).

**The comment strip runs first, and governs every test.** HTML comments are removed from
the section body *before* `hasFence`, the cut scan and `density` are computed — not just
before `density`. A `noldor:cut` line or a whole ```` ```mermaid ```` fence can sit inside
a multiline `<!-- … -->`, render as nothing, and would otherwise clear the section. An
unterminated `<!--` swallows the remainder of the section, which is the safe direction: it
measures as empty and reports a stub.

**What `density` counts.** The comment-stripped section with three further things removed:
fenced regions, any line matching the cut grammar below, and heading lines. What remains
is counted in non-whitespace characters — 23 is a stub, 24 is clean.

Fence removal comes from `locateSection`'s existing `scanned` view, **not** from
`stripCodeRegions`. `src/docs/docs-check.ts` also blanks *inline code spans*
(`` /`[^`\n]+`/ ``) and uses a naive tilde-blind `` /```[\s\S]*?```/ ``, so ordinary FD
prose — ``the `supervisor` spawns a `child` per entry`` — would lose most of its
characters to backticks and report a false `stub-section` on exactly the writing style
this repo uses. `scanned` also comes from the same single pass that found the section
boundaries, which `structural-context.ts:225-231` warns is the only safe way to read
them.

**Cut grammar.** Same as `structural-context.ts`: a line, outside any fence and outside
any HTML comment, inside this section, whose trimmed text is `noldor:cut` followed by whitespace or end-of-line. Not an
HTML comment — a decline should be visible in the rendered FD. The reason is the
remainder of the line and must itself reach 24 non-whitespace characters, so a bare
marker declines nothing. When several markers appear, the first well-formed one wins; if
none is well-formed the section is treated as uncut and classified normally.

**The decision table.** Evaluated in order, at most one row per FD:

| # | Condition | Result |
|---|---|---|
| 1 | no `## Diagram` H2 | not in scope — no row (D2) |
| 2 | a well-formed cut is present | clean |
| 3 | `hasFence` and `density ≥ 24` | clean |
| 4 | `hasFence` and `density < 24` | `stub-section` |
| 5 | no fence, `density ≥ 24` | `no-fence` |
| 6 | no fence, `density < 24`, `PLACEHOLDER_MARKER` present | `placeholder-only` |
| 7 | no fence, `density < 24`, no marker | `stub-section` |

Row 3 before rows 6 and 7 is what makes a leftover `<!-- TODO:` beside a real diagram and
real prose harmless: the placeholder is only ever *reported* when nothing else is there.
An empty section falls to row 7. A section holding only the scaffolded block falls to
row 6.

### The shared section scanner

`detectStructuralContextStubs` already owns fence-aware markdown section location, and
its ~120 lines encode CommonMark fixes found the hard way: a fence closes only on the
same character at least as long as the opener, an info string can open a fence but never
close one, and only unfenced lines may open or close a section. This detector needs all
of it and differs only in the arguments it would pass.

So `tagLines`, `locateSection`, `ancestorOk`, `density` — and the two private file
helpers `listMd` and `readText`, which this detector needs verbatim for discovery — move
to a shared `src/core` module and both detectors import them (D4). Leaving the last two
behind would re-copy them into `fd-diagram.ts`, which is the fork this lift exists to
avoid and which `clones check` would flag anyway. The move is behaviour-preserving: the two
call sites differ only in the parameters `locateSection` already takes — depth 3 with
`requireAncestor: '## Design'` for a spec's unit, depth 2 with no ancestor for an FD's
`## Diagram`. `structural-context.ts`'s existing tests are the regression proof and must
pass unchanged.

The cost is deliberate: this is a docs feature editing a detector that shipped
2026-08-28. Copying instead would fork those edge-case fixes into two files, and
`clones check` would flag it regardless.

### The detector

`src/garden/detectors/fd-diagram.ts`, exporting `detectFdDiagramStubs(repo)` →
`FdDiagramStub[]`, structurally parallel to
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

**Discovery.** `*.md` directly inside `loadDocRoots(repo).features` (`docs/features/`),
non-recursive and unsorted-then-`toSorted()`, exactly as `listMd` does for specs. A file
that cannot be read is skipped rather than reported — the same fail-open `readText`
already applies, and reporting a file the detector could not open would produce a row
nobody can clear. Frontmatter is not parsed: neither `noldor-tier` nor `introduced` is
consulted (D1, D2).

**Heading match.** Exact, case-sensitive `## Diagram` on a trimmed unfenced line — the
`locateSection` contract. A second `## Diagram` at the same depth *terminates* the first
section rather than opening a rival one, so the classified section is always the first,
and a valid duplicate lower down cannot hide a stub above it. That is the conservative
direction: the reader's eye lands on the first one too.

**Exact API.**

```ts
export type FdDiagramRule = 'placeholder-only' | 'no-fence' | 'stub-section';

export interface FdDiagramStub {
  /** Repo-relative POSIX path, e.g. `docs/features/plan-runner.md`. */
  readonly file: string;
  readonly rule: FdDiagramRule;
  readonly message: string;
}

export function detectFdDiagramStubs(repo: string): Promise<FdDiagramStub[]>;
```

`repo` is an absolute repository root, as every sibling detector takes.

**No `toGaps`.** `GardenFindings.fdDiagramStubs` carries the raw `FdDiagramStub[]`,
matching `structuralContextStubs`, so a `Gap` projection would have no caller — and
`structural-context.ts`'s own exported `toGaps` is already dead code today, which is the
mistake worth not repeating. Add one when a consumer exists; the `<file>#<rule>` itemId
shape is recorded here so that consumer has a stable identity to adopt.

The key is deliberately absent from `FINDING_CATEGORIES` in `garden-detect-runner.ts`
for the reason its siblings document: that list gates the garden auto-restamp, an
unstamped receipt is a blocking release row, and an undrawn diagram must never stop a
ship.

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
10. `garden detect`'s JSON payload carries `fdDiagramStubs`; `FINDING_CATEGORIES` does not, so a stub never fails the runner and never blocks a release.
11. `structural-context.ts`'s existing test suite passes unchanged after the scanner moves to its shared module.
12. A mermaid fence declaring any kind satisfies the fence condition, and two fences satisfy it as one; the detector never rejects a kind.
13. Each of the four writers — `scaffoldFd`, both skill templates and the schema doc — emits the section, and `pnpm noldor doctor` is green across all three `templates/` twins.
14. Prose of 23 non-whitespace characters beside a valid fence yields `stub-section`; 24 yields no row.
15. A section holding a valid fence, sufficient prose and a leftover `<!-- TODO:` comment yields no row.
16. An FD carrying two `## Diagram` headings is classified on the first; a filled second one does not clear a stub in the first.

## Risks / trade-offs

- **An unreadable FD reports clean.** Discovery skips a file it cannot read rather than
  reporting it, matching `structural-context.ts`. On an advisory channel that is a false
  negative, not a false alarm: an enrolled FD whose permissions broke silently leaves the
  set. Accepted because the alternative — a row naming a file the detector could not open
  — is one no author can clear, and because the failure is loud everywhere else in the
  toolchain that reads `docs/features/`.
- **A deleted heading is an invisible escape.** Presence-gating buys a floor-free,
  git-free, zero-retro scope rule at the price of the `missing-section` rule. An author
  who removes the scaffolded section is indistinguishable from an FD that predates the
  contract. O1.
- **Advisory that nobody reads.** `structuralContextStubs` and `architectureAdvisories`
  both ride `garden detect`'s JSON payload, and `/noldor-garden`'s step-4 checklist
  renders a hand-maintained subset of them — `structuralContextStubs` has a row,
  `architectureAdvisories` does not. A third key lands in the same hole; O3.
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

- `pnpm noldor garden detect` carries `fdDiagramStubs[]` in its JSON payload, each row
  naming the FD, the rule, and the remediation. There is no `--json` flag — the command's
  stdout is always JSON by contract, which `/noldor-garden` step 1 parses.
- Nothing blocks. Not `pnpm noldor commit`, not the pre-push chain, not `pnpm release`.
- An FD that carries no `## Diagram` heading is never reported — that is how the 83
  existing FDs stay out of it.

**Agent/Programmatic API**

- `detectFdDiagramStubs(repo)` → `FdDiagramStub[]` — `{ file, rule, message }`.
- No `Gap` projection ships until a consumer needs one; see *The detector*.

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

3. *Should this feature also fix how the advisory keys reach the operator?*
   -> **No — scope it out and emit it as residue.** (D8) The defect is not a missing
   renderer: `/noldor-garden` step 1 already parses every key, and step 4 renders a
   hand-maintained checklist that happens to include `structuralContextStubs` and to omit
   `architectureAdvisories`. `fdDiagramStubs` will land in the same hole. That is a
   contradiction between two steps of one skill, not a surface this feature should build,
   so it ships as sibling entry Q-0197.

4. *What prose floor beside the fence?*
   -> **24 non-whitespace characters, as its own `MIN_FD_DIAGRAM_PROSE_CHARS`.** (D9)
   Same value and same reasoning as `MIN_STRUCTURAL_CONTEXT_CHARS` — long enough to
   reject a two-word gesture, short enough not to punish an honest one-liner. A separate
   constant so the two contracts may diverge, matching how `structural-context-contract.ts`
   deliberately forked from `summary-body-contract.ts`.

5. *Which mermaid kinds are allowed in the fence?*
   -> **Any kind, so long as one is declared.** (D10) The four registry pages constrain
   kinds because each answers a fixed C4 question; an FD picks its own level, so
   constraining the set here would be the framework guessing at a feature's shape. "C4"
   names the altitude, not the notation — see *What "C4" means here*.

6. *Should the `## Diagram` heading itself be validator-enforced, since the schema doc
   will call it required?*
   -> **No.** (D11) `validate features` checks frontmatter only; `docs/noldor/feature-md-schema.md`
   already records `Summary` / `User Story` / `Usage` as required body sections with no
   validator behind them, and adding one here would turn presence-gating's grandfathering
   into 83 hard failures. The schema doc states convention; the detector reports content.
