# Architecture Page Form Contract — Design

**Slug:** consumer-architecture-doc-surface-page-form-contract
**FD:** docs/features/consumer-architecture-doc-surface.md
**Date:** 2026-08-28
**Tier:** full
**Deps:** none

UI verdict: skip — no `consumer.uiPaths` / `uiSurfaces` are configured and the FD carries no `design:` override, so no surface is affected.

## Problem

Q-0093 shipped the `docs/architecture/` registry: four pages, four blocking presence rules in
[`checkArchitecture`](../../../src/docs/docs-architecture.ts) (`missing` / `no-fence` / `bad-kind` /
`placeholder`), a module advisory, a garden detector and four scaffold-only templates. Every one of
those rules asks *does the page exist and carry a diagram*. None asks *is the page still the terse
technical reading it was meant to be*.

So the content contract is open, and the pages drift two ways. They drift into narrative prose — the
surface exists to be skimmed by a reader or an agent that needs the shape of the system in under a
minute, and a page that has grown into an essay defeats that while passing every check. And they
drift across C4 levels: nothing stops `containers.md` from explaining module dependency direction or
`context.md` from naming internal packages, so the four-page split stops carrying information and
becomes four places to look for the same thing.

This repo's own pages show the second drift in miniature while passing `--check` cleanly: their
internal headings are ad-hoc — `context.md` has none at all, `modules.md` has `## The diagram` and
`## Who owns what durable state`, `flows.md` has one H2 per flow. A reader cannot predict where on a
page an answer lives, because there is nothing to predict. On the first drift the pages are so far
healthy (172/217/87/126 prose words, no paragraph over 59), which is what makes them a usable
calibration set rather than a warning.

## Goals

- Prescribe a **fixed section structure per page**, carried in the registry and rendered by the
  four templates in `templates/docs/architecture/`, so every page of every consumer answers its own
  questions in the same order.
- State the **C4 fidelity rule per page** in the template prose: each page answers its own level and
  only that level.
- Add an **advisory bloat check** alongside the existing module advisory, so a page that has grown
  into an essay is visible without blocking anything.
- Reach an already-opted-in consumer without the framework writing into pages it does not own.
- Bring this repo's four pages into the new form, since the surface is dogfooded.

## Non-goals

- Blocking a release on form. The existing four rules stay the only blocking class.
- Changing `ARCHITECTURE_PAGES`' membership, ids, titles or `allowedKinds` — this is about what goes
  *inside* a page, not which pages exist.
- Enforcing C4 level-leakage mechanically. Whether `containers.md` has strayed into module territory
  is a judgment a reviewer makes; the framework states the rule and checks shape, not semantics.
- A dashboard surface for any of this (Q-0134 owns the route).

## Design

### D-1. Section structure lives in the registry

`ArchitecturePage` gains a `sections: readonly string[]` field: the H2 headings the page must carry.
The registry stays the single place a page is described — `purpose` and `allowedKinds` already live
there, and every validating surface reads that one list, so a section contract carried anywhere else
would be a second parallel description of the same four pages. The sets are page-specific rather
than a shared spine because that is where the information is: `Actors / Externals / Boundary` tells
a writer what `context.md` is *for*, in a way a uniform `Diagram / In prose` skeleton never can — and
a uniform skeleton's check degenerates to "the page has two headings", which no page fails.

Section names are stored **bare**, without the `## ` prefix. One representation, rendered as `## ` by
the templates and quoted bare in advisory messages and cut markers; the alternative (storing
`'## Actors'`) forces the implementation to strip the prefix at both the marker-matching site and the
message site, which is where the two drift apart.

| page | `sections` |
|---|---|
| `context` | `['Actors', 'Externals', 'Boundary']` |
| `containers` | `['Runnable units', 'Durable state', 'Topology']` |
| `modules` | `['Dependency direction', 'State ownership']` |
| `flows` | `[]` — *sentinel, see below* |

**Order is not checked.** The array's order is what the templates render, so a scaffolded page comes
out in a sensible sequence, but the check is presence-only: a page that re-orders its sections, or
carries extra H2s of its own between them, is conforming. Checking order would make a consumer's
editorial judgment a framework finding for no gain in what the page communicates.

**Presence is heading-presence, not content.** The check asks whether the H2 exists, not whether
anything was written under it, so a page that keeps the scaffolded skeleton and writes nothing
passes. That is deliberate — no string test distinguishes a real paragraph from a plausible one, and
a check that guessed would be arguable exactly where it matters. The contract's claim is that the
page's *questions* are on the page, which is what a reader needs to know is missing.

**The `flows` sentinel.** `sections: []` means "at least one H2, names unconstrained" rather than
"nothing to check": the page's natural shape is one section per flow, so no fixed set exists that
does not lie about it. The exemption is a registry value, not a page id in the checker, which is what
keeps the registry the full description of a page. The floor is one rather than two because a repo
with a single genuinely load-bearing flow is a legitimate answer, and `flows.md`'s template ships
with two H2 stubs so a scaffolded page starts conforming — the current template ships **zero** H2s,
which would have made every consumer who filled it from the scaffold trip the rule on day one.

### D-2. The `sections` rule is advisory, with teeth

`checkArchitecture` reports a page that carries neither one of its registry sections nor a written
decline for it. That row is a variant of the advisory union described below — **never a member of
`ArchitectureRule`**, which is the blocking union
([`docs-architecture.ts`](../../../src/docs/docs-architecture.ts), already five members including
`unreadable`). Rows carrying an `ArchitectureRule` land in `findings`, and `status` is literally
`findings.length > 0 ? 'incomplete' : 'ok'` — so adding `sections` there would red the release row
and `sddGaps` for a missing `## Boundary`, the exact failure the Risks section names. The `status`
formula is untouched by this change, and the blocking class stays exactly the presence rules Q-0093
shipped.

Blocking outright is not available anyway: the four pages are in `SCAFFOLD_ONLY_TEMPLATES`, so
template-sync never demands an existing page match a changed template and no consumer gets a
migration. A repo that filled its pages correctly under the old contract would go red at its next
release for prose that was right when it was written.

But a pure advisory conflates two different things. A page that has never heard of `Topology` and a
page whose author decided a single npm package has no deployment topology to draw print the same
row, so the list becomes noise the moment one page has a legitimate omission — and noise is what
makes an advisory ignorable. A page therefore declines a section in writing:

    <!-- noldor:cut-section Topology — single npm package, no deployment topology to draw -->

**The token is `noldor:cut-section`, not `noldor:cut`.** The bare token is already taken:
`CUT_MARKER_TOKEN = 'noldor:cut <ceiling> — <upgrade path>'`
([`subagent-dispatch.ts`](../../../src/cr/lanes/subagent-dispatch.ts)), pinned by a test against the
rule file, and its second field is an upgrade path rather than a reason. Reusing it would mean an
ordinary ladder cut written on an architecture page — `noldor:cut one diagram — split when the
container count passes 12` — parses as a section decline naming a non-section and emits a bogus
advisory. A distinct token keeps both conventions intact and confines this parse to its own
namespace.

Grammar: `noldor:cut-section <name> — <reason>` inside an HTML comment. The name is matched
case-insensitively against the page's registry sections, ignoring surrounding whitespace and any
`## ` the author included. A marker whose name is not one of that page's sections is itself an
advisory — a typo'd decline would otherwise silence nothing while looking to its author like it did.
That unknown-name advisory is **skipped on a page whose `sections` is empty**: `flows` has no set to
check a name against, so no marker on it can be a typo, and firing there would make every possible
decline on that page an advisory.

The advisory channel is currently typed as `ModuleAdvisory` with a `module` field a section row has
no value for. It widens to a discriminated `ArchitectureAdvisory`:

    type ArchitectureAdvisory =
      | { kind: 'module';        page: string; module: string;  message: string }
      | { kind: 'section';       page: string; section: string; message: string }
      | { kind: 'unknown-cut';   page: string; section: string; message: string }
      | { kind: 'flow-headings'; page: string; count: number;   message: string }
      | { kind: 'long-paragraph'; page: string; index: number; words: number; message: string }
      | { kind: 'page-bloat';    page: string; words: number;   message: string }

One channel, one shape, so its consumer keeps reading one array rather than enumerating a new one
per class. That consumer is [`garden-detect.ts`](../../../src/garden/garden-detect.ts) alone:
`ModuleAdvisory` has three referents, all inside `docs-architecture.ts`, and no dashboard route reads
`architectureAdvisories` today (Q-0134 owns the future one and is out of scope).

`toAdvisoryGaps` currently builds `itemId` as `` `${page}#${a.module}` ``
([`detectors/architecture.ts`](../../../src/garden/detectors/architecture.ts)), which yields
`<page>#undefined` for every row that has no `module` and collides two long-paragraph rows on one
page — breaking that file's documented promise that every row has a stable identity and a repeated
run produces no duplicates. The discriminator becomes per-variant: `module` for a module row, the
section name for `section` and `unknown-cut`, the literal `flow-headings`, the paragraph index for
`long-paragraph`, and the literal `page-bloat`. All six are prefixed by `kind` so two variants cannot
collide on one page.

### D-3. Bloat is measured per paragraph, with a page backstop

The primary check is a per-paragraph prose word budget, mirroring
[`split-suggestion.ts`](../../../src/core/split-suggestion.ts)'s shape: exported constants, a
`{ rule, value, threshold, message }` signal, strictly-greater comparison, advisory only. One
advisory per offending paragraph, naming the page and the paragraph's ordinal.

    ARCH_PARAGRAPH_WORD_THRESHOLD = 100
    ARCH_PAGE_PROSE_WORD_THRESHOLD = 600

The paragraph is the primary unit because that is what Q-0178's deletion test claims: a reader
answers "how is this system shaped" *without reading a single full paragraph*. A page total alone is
the wrong unit for that in both directions — a 400-word page of eight labelled facts passes the test
and a 250-word page that is one block fails it.

The page total is a **backstop, not a rival**: on its own the paragraph rule cannot see a page that
has become an essay in aggregate, since an arbitrarily long page built of 99-word paragraphs never
trips it, and "a page that has grown into an essay is flagged" is the entry's stated goal. 600 is set
well above any honest page — this repo's four run 172/217/87/126 prose words — so it fires only on a
page that has roughly tripled its worst current sibling, and never in place of the paragraph rule.

The paragraph threshold is set against measurement rather than guess. Every prose paragraph across
this repo's four pages runs 22–59 words (`context` 49/44/43/36, `containers` 50/45/44/31/25/22,
`modules` 51/36, `flows` 59/34/33), so 100 leaves roughly 1.7× headroom over the worst honest
paragraph.

Both counts are over **prose**: the body with mermaid fences, code fences, tables and headings
removed. Removal replaces each block with a blank line rather than deleting it, so prose on either
side of a diagram stays two paragraphs instead of merging into one. A paragraph is then a
blank-line-separated run of the remainder.

The entry also floats a prose-to-diagram ratio. It is rejected: a ratio has no defensible threshold
and scores a page that honestly merits one diagram worse than one padded with three — `modules.md`
today would rate 87 against `flows.md`'s 63 while being the terser page of the two.

### D-4. Reuse, and what runs when

Three helpers already exist and are reused rather than re-implemented — the checker would otherwise
hand-roll a third H2 scanner and a fourth code-region stripper, which the clone ratchet would decide
for us:

- [`listHeadings`](../../../src/utils/markdown-sections.ts) — the repo's one fence-aware heading
  scanner (H2/H3, tilde fences, long fence runs). Used for section presence and the `flows` count.
- [`stripCodeRegions`](../../../src/docs/docs-check.ts) — used to produce the prose body for both
  word counts and to keep cut-marker matching out of fenced blocks.
- `countWords` ([`split-suggestion.ts`](../../../src/core/split-suggestion.ts)) — currently private;
  exported so the two word budgets and the `E1`/`S1` entry heuristics cannot drift apart.

Fence-awareness is a correctness requirement, not a nicety: this spec's own D-2 grammar block and the
templates' example prose both contain a `## ` heading and a cut marker inside a fenced region, and a
naive match would read them as real.

**Advisories only run on a page the blocking rules already accept.** A page that is missing,
unreadable, still carries the placeholder or has no valid fence produces its blocking finding and no
section, paragraph or bloat rows — piling advisory noise onto a page whose real problem is that it
does not exist yet is how the channel loses its reader. A surface whose `status` is `absent` (folder
missing, or every page still exactly as scaffolded) produces no advisories at all, so `noldor init`
still hands a fresh consumer a silent surface.

### D-5. C4 fidelity is template prose, not a check

Each template gains, under its H1, one line naming the level it answers and where the adjacent level
belongs — `containers.md`: "Runnable units and what they own. Internal dependency direction belongs
on `modules.md`." Then the section skeleton from D-1, each heading followed by a one-line
HTML-comment prompt saying what goes under it.

**Those prompts must not use the `TODO:` prefix.** `PLACEHOLDER_MARKER` is `<!-- TODO:` and it is a
*blocking* rule, so a prompt written as `<!-- TODO: name each actor -->` would send an author who
wrote real prose but left the prompts in place straight to a blocking-red release. Prompts read
`<!-- what belongs here: … -->`, and each page keeps exactly one `<!-- TODO:` line — the single
opt-in marker the surface already depends on.

No new check for fidelity itself. `allowedKinds` already constrains the diagram type per page, and
level leakage past that is a semantic judgment: whether a `containers.md` paragraph has drifted into
module territory is exactly the call a reviewer makes and a string match cannot. Shipping a check
that guessed at it would produce findings a consumer has to argue with, which is how an advisory
channel loses its credibility. The exact fidelity lines and prompts are drafted at implementation
against the templates themselves; writing them verbatim here would make the spec a copy of the
artifact it describes.

### D-6. Existing consumers hear about it only through the advisory

The four pages are in `SCAFFOLD_ONLY_TEMPLATES`, and `init --update` refuses to overwrite that set
([`init.ts`](../../../src/cli/commands/init.ts)) — so a consumer already opted in never sees the new
template. That is deliberate: those pages are consumer-owned prose about the consumer's own system.

The advisory is therefore the whole propagation mechanism, and its message carries the fix:

    advisory: docs/architecture/context.md does not name section "Boundary" — add a
              `## Boundary` heading, or record why it does not apply with a
              noldor:cut-section marker.

No migration and no writer command. A migration would edit hand-written prose without being asked,
which is the thing `SCAFFOLD_ONLY_TEMPLATES` exists to prevent; a `--scaffold-sections` command would
emit empty headings a human still has to fill, so its entire output is ceremony that the templates
already provide for new consumers.

### D-7. Dogfood

The four pages in `docs/architecture/` are rewritten to the section structure in the same change.
Their content is already close and mostly needs re-heading rather than rewriting:

- `context.md` has no H2s today. Its two actor paragraphs go under `## Actors`, its externals
  paragraph under `## Externals`, and its closing "The boundary worth naming" paragraph — the page's
  best fact and currently its least findable — under `## Boundary`.
- `containers.md` gains `## Runnable units` over the CLI/hooks/dashboard paragraphs, `## Durable
  state` over the `.noldor/` paragraph, and `## Topology` over its closing "no deployment topology to
  draw" sentence, which is a legitimate answer to the section rather than an omission.
- `modules.md` renames `## The diagram` to `## Dependency direction` and `## Who owns what durable
  state` to `## State ownership`.
- `flows.md` already satisfies the sentinel with its two flow H2s and needs no change.

Every existing paragraph is under the 100-word budget and every page under the 600-word page budget,
so no prose has to be cut — the dogfood pass is a re-heading, which is itself evidence that the
section sets describe pages someone already wrote without them.

## Acceptance criteria

- `ArchitecturePage` carries `sections` holding bare names, and `ARCHITECTURE_PAGES` is declared
  `as const satisfies readonly ArchitecturePage[]` so `ArchitecturePageId` is the literal union of
  the four ids and a page-id typo in a caller is a type error. The present annotation
  (`readonly ArchitecturePage[]` with `id: string`) widens that alias to `string`, so the criterion
  is unmeetable without the declaration change.
- A page missing a registry section produces a `section` advisory and leaves `status` unchanged; a
  page carrying its sections in a different order, or with extra H2s between them, produces none.
- A `noldor:cut-section` marker naming one of the page's sections suppresses that section's advisory;
  one naming anything else produces an `unknown-cut` advisory, except on a page whose `sections` is
  empty, where no such advisory is produced.
- An ordinary `noldor:cut` marker on an architecture page produces no advisory of any kind.
- A page whose `sections` is empty produces a `flow-headings` advisory only when it carries fewer
  than one H2.
- A prose paragraph over `ARCH_PARAGRAPH_WORD_THRESHOLD` produces one `long-paragraph` advisory per
  offending paragraph; a page whose total prose exceeds `ARCH_PAGE_PROSE_WORD_THRESHOLD` produces one
  `page-bloat` advisory.
- Word counting excludes mermaid fences, code fences, tables and headings, and a removed block leaves
  the prose on either side of it as two paragraphs rather than one.
- A `## ` heading or a `noldor:cut-section` marker inside a fenced block is not matched.
- A page carrying a blocking finding (missing, unreadable, placeholder, bad or absent fence) produces
  that finding and no advisories; a surface whose `status` is `absent` produces neither.
- Every advisory variant yields a distinct garden `itemId`, so two long-paragraph rows on one page do
  not collide and no row renders as `<page>#undefined`.
- Advisories reach `garden detect` on the `architectureAdvisories` key, never `sddGaps`, and the
  release preflight `architecture` row is unaffected by any of them.
- `pnpm noldor docs architecture --check` exits 0 on a repo whose pages satisfy every blocking rule
  but carry no sections at all.
- The templates carry the section skeleton and the fidelity line, no per-heading prompt uses the
  `TODO:` prefix, and each page still carries exactly one `<!-- TODO:` marker so a fresh
  `noldor init` reports the surface as `absent`.
- This repo's four architecture pages carry their registry sections and produce no advisory.

## Risks / trade-offs

- **The section sets are a judgment call.** They are the substance of the change and there is no code
  to check them against. `## Topology` in particular may read as ceremony in a repo whose answer is
  "one npm package" — the cut marker is the escape hatch, and if it turns out most consumers cut the
  same section, that is the signal to drop it from the registry.
- **Presence is not substance.** The check confirms the questions are on the page, not that they were
  answered, so a scaffolded skeleton left unfilled passes every advisory. Narrowing to heading
  presence is deliberate (D-1), but it does mean a determined consumer can satisfy the contract
  without writing anything.
- **An advisory is still ignorable.** The cut marker makes silence mean something, but only for
  someone who reads the output at all. The check does not create a reader.
- **A second cut token is a second convention.** `noldor:cut-section` avoids colliding with the
  pinned `noldor:cut` grammar, at the cost of two markers a consumer has to tell apart.
- **`flows` remains structurally special.** `sections: []` expresses the exemption honestly, but a
  contract about structure that exempts one of its four pages is a compromise, not a clean rule — and
  a one-H2 floor is a weak check.
- **Widening `ModuleAdvisory`** touches the garden detector, whose `toAdvisoryGaps` reads the
  `module` field and must gain a per-variant discriminator. It is the only consumer — no dashboard
  route reads the channel. The blocking/advisory split must survive that edit intact: routing a
  section row into `sddGaps` would silently make a missing heading block a release.
- **Existing consumers get no migration.** Their pages stay as they are until someone reads an
  advisory and edits them by hand. That is the intended cost of leaving consumer prose alone.

## User Story

As a maintainer or review agent reading a repository for the first time, I want each architecture
page to answer its own questions under predictable headings and in short labelled facts, so that I
can tell how the system is shaped without reading four essays.

## Usage

**CLI**

- `noldor docs architecture --check` prints section, unknown-cut, flow-heading, long-paragraph and
  page-bloat advisories alongside the existing module advisories, on stdout, without changing the
  exit code. Each section advisory names the heading to add and the marker that declines it.
- `noldor garden detect` surfaces the same advisories under `architectureAdvisories`.

**Page authoring**

- Write the registry sections as H2s on each page, in any order, or decline one in place:
  `<!-- noldor:cut-section Topology — single npm package, no deployment topology to draw -->`

**Agent/Programmatic API**

- `checkArchitecture(cwd)` returns `advisories` as `ArchitectureAdvisory[]`, a discriminated union
  carrying module, section, unknown-cut, flow-heading, long-paragraph and page-bloat rows on one
  channel.

## Open questions (resolved)

1. *Blocking or advisory for the section rule?* -> Advisory with teeth (D-2): never gates a ship, but
   a declined section must be written down, so an un-annotated gap is a real gap. Blocking would red
   the next release of every repo that filled its pages correctly under the old contract.
2. *Bare names or rendered headings in the registry?* -> Bare (D-1). One representation, rendered at
   the template and message edges; storing `'## Actors'` forces the prefix to be stripped at two
   sites that then drift.
3. *Is section order checked?* -> No (D-1). Presence only. Order is what the templates render, not
   what the check enforces.
4. *Does the check see content beneath a heading?* -> No (D-1). No string test separates real prose
   from plausible prose, so the contract's claim is narrowed to "the questions are on the page".
5. *Page-total or per-paragraph bloat metric?* -> Per paragraph as primary, page total as a backstop
   (D-3). The paragraph rule is the one the deletion test names, but alone it cannot see a page of
   unlimited 99-word paragraphs, which the entry's own goal requires flagging.
6. *What thresholds?* -> 100 words per paragraph, 600 prose words per page (D-3), both measured
   against this repo's pages, whose worst honest paragraph is 59 and worst page 217.
7. *How does `flows` fit a fixed section list?* -> It does not; `sections: []` means "at least one
   H2, names free" (D-1), the template ships two stubs, and the unknown-cut rule is skipped there.
8. *Reuse `noldor:cut` or a new token?* -> A new one, `noldor:cut-section` (D-2). The bare token's
   grammar is pinned by a test and means something else, so reusing it would make an ordinary ladder
   cut emit a bogus advisory.
9. *One advisory channel or two?* -> One, widened to a discriminated `ArchitectureAdvisory` (D-2),
   with a per-variant garden discriminator so no two rows collide.
10. *Do advisories fire on a page that already has a blocking finding?* -> No (D-4). Nor on an
    `absent` surface. Advisory noise on a page that does not exist yet is how the channel loses its
    reader.
11. *Migration for existing consumers?* -> None (D-6). The advisory carries the fix; writing into
    consumer-owned prose is what `SCAFFOLD_ONLY_TEMPLATES` exists to prevent.
12. *Should the spec carry the four fidelity lines and every template prompt verbatim?* -> No (D-5).
    That text is the template; drafting it here would make the spec a copy of the artifact it
    describes, and it would then drift from the templates on the first edit.
