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

`ArchitecturePage` gains a `sections: readonly string[]` field: the H2 headings the page must carry,
in order. The registry stays the single place a page is described — `purpose` and `allowedKinds`
already live there, and every validating surface reads that one list, so a section contract carried
anywhere else would be a second parallel description of the same four pages. The sets are
page-specific rather than a shared spine because that is where the information is: `Actors /
Externals / Boundary` tells a writer what `context.md` is *for*, in a way a uniform `Diagram / In
prose` skeleton never can — and a uniform skeleton's check degenerates to "the page has two
headings", which no page fails and which therefore checks nothing.

Section sets:

| page | sections |
|---|---|
| `context` | `## Actors`, `## Externals`, `## Boundary` |
| `containers` | `## Runnable units`, `## Durable state`, `## Topology` |
| `modules` | `## Dependency direction`, `## State ownership` |
| `flows` | *(structurally exempt — at least two H2s)* |

`flows` is exempt because its natural shape is one section per flow, so no fixed set exists that
does not lie about the page. An empty `sections` array carries that: the checker reads `[]` as "at
least two H2s, names unconstrained" rather than as "nothing to check", so the exemption is a
registry value and not a hardcoded page id in the checker.

### D-2. The `sections` rule is advisory, with teeth

`checkArchitecture` grows a fifth rule, `sections`, reported when a page carries neither one of its
registry sections nor a written decline for it. It never reaches `status`, so it never reaches the
release probe or the garden auto-restamp — the blocking class stays exactly the four presence rules
Q-0093 shipped.

Blocking outright is not available: the four pages are in `SCAFFOLD_ONLY_TEMPLATES`, so
template-sync never demands an existing page match a changed template and no consumer gets a
migration. A repo that filled its pages correctly under the old contract would simply go red at its
next release for prose that was right when it was written.

But a pure advisory conflates two different things. A page that has never heard of `## Topology` and
a page whose author decided a single npm package has no deployment topology to draw print the same
row, so the list becomes noise the moment one page has a legitimate omission — and noise is what
makes an advisory ignorable. A page therefore declines a section in writing:

```markdown
<!-- noldor:cut Topology — single npm package, no deployment topology to draw -->
```

`noldor:cut <thing> — <reason>` is already this repo's convention for a recorded deliberate limit
([`subagent-dispatch.ts`](../../../src/cr/lanes/subagent-dispatch.ts) defines the token). The
advisory fires only for sections that are neither present nor cut, so an un-annotated gap is a real
gap and a deliberate one is on the record — silence stops counting as compliance without anything
ever gating a ship.

The marker is matched case-insensitively against the section name, anywhere in the page body, and a
cut for a name that is not one of the page's registry sections is itself an advisory (a typo in a
cut would otherwise silence nothing while looking like it did).

The advisory channel is currently typed as `ModuleAdvisory` with a `module` field a section row has
no value for. It widens to a discriminated `ArchitectureAdvisory` — one channel, one shape, so
garden and the dashboard keep reading one array — rather than growing a second parallel array per
advisory class.

### D-3. Bloat is measured per paragraph, not per page

The check is a per-paragraph prose word budget, mirroring
[`split-suggestion.ts`](../../../src/core/split-suggestion.ts)'s shape: an exported constant, a
`{ rule, value, threshold, message }` signal, strictly-greater comparison, advisory only. One
advisory per offending paragraph, naming the page and the paragraph's opening words so the author
can find it.

```
ARCH_PARAGRAPH_WORD_THRESHOLD = 100
```

The unit is the paragraph because that is what Q-0178's deletion test claims: a reader answers "how
is this system shaped" *without reading a single full paragraph*. A page total is the wrong unit for
that in both directions — a 400-word page of eight labelled facts passes the test, and a 250-word
page that is one block fails it. Only the paragraph metric separates them.

The threshold is set against measurement rather than guess. Every prose paragraph across this repo's
four pages runs 22–59 words (`context` 49/44/43/36, `containers` 50/45/44/31/25/22, `modules` 51/36,
`flows` 59/34/33), so 100 leaves roughly 1.7× headroom over the worst honest paragraph and fires
only on prose that has genuinely become an essay.

A prose paragraph is a blank-line-separated run of body text with mermaid fences, code fences,
tables and headings removed first — a page may be long in diagram and table and still be terse in
prose, which is the form the contract is trying to produce.

The entry also floats a prose-to-diagram ratio. It is rejected: a ratio has no defensible threshold
and scores a page that honestly merits one diagram worse than one padded with three — `modules.md`
today would rate 87 against `flows.md`'s 63 while being the terser page of the two.

### D-4. C4 fidelity is template prose, not a check

Each template gains, under its H1, one line naming the level it answers and where the adjacent level
belongs — `containers.md`: "Runnable units and what they own. Internal dependency direction belongs
on `modules.md`." Then the section skeleton from D-1, each heading followed by a one-line HTML-comment
prompt saying what goes under it.

No new check. `allowedKinds` already constrains the diagram type per page, and level leakage past
that is a semantic judgment: whether a `containers.md` paragraph has drifted into module territory
is exactly the call a reviewer makes and a string match cannot. Shipping a check that guesses at it
would produce findings a consumer has to argue with, which is how an advisory channel loses its
credibility.

### D-5. Existing consumers hear about it only through the advisory

The four pages are in `SCAFFOLD_ONLY_TEMPLATES`, and `init --update` refuses to overwrite that set
([`init.ts`](../../../src/cli/commands/init.ts)) — so a consumer already opted in never sees the new
template. That is deliberate: those pages are consumer-owned prose about the consumer's own system.

The advisory is therefore the whole propagation mechanism, and its message carries the fix:

```
advisory: docs/architecture/context.md does not name section "Boundary" — add a
          `## Boundary` heading, or record why it does not apply:
          <!-- noldor:cut Boundary — <reason> -->
```

No migration and no writer command. A migration would edit hand-written prose without being asked,
which is the thing `SCAFFOLD_ONLY_TEMPLATES` exists to prevent; a `--scaffold-sections` command
would emit empty headings a human still has to fill, so its entire output is ceremony. There is
nothing to migrate mechanically here — a heading with no text under it is not progress, the writing
is the work, and the advisory is what names which writing is missing.

### D-6. Dogfood

The four pages in `docs/architecture/` are rewritten to the section structure in the same change.
Their content is already close and mostly needs re-heading rather than rewriting:

- `context.md` has no H2s today. Its two actor paragraphs go under `## Actors`, its externals
  paragraph under `## Externals`, and its closing "The boundary worth naming" paragraph — which is
  the page's best fact and currently its least findable — under `## Boundary`.
- `containers.md` gains `## Runnable units` over the CLI/hooks/dashboard paragraphs, `## Durable
  state` over the `.noldor/` paragraph, and `## Topology` over its closing "no deployment topology
  to draw" sentence, which is a legitimate answer to the section rather than an omission.
- `modules.md` renames `## The diagram` to `## Dependency direction` and `## Who owns what durable
  state` to `## State ownership`.
- `flows.md` already satisfies the exemption with its two flow H2s and needs no change.

Every existing paragraph is under the 100-word budget, so no prose has to be cut — the dogfood pass
is a re-heading, which is itself evidence that the section sets describe pages someone already wrote
without them.

## Acceptance criteria

- `ArchitecturePage` carries `sections`; a page id typo in a caller is a type error.
- A page missing a registry section produces an advisory, and `checkArchitecture`'s `status` is
  unchanged by it.
- A page that declines a section with a `noldor:cut` marker naming that section produces no advisory
  for it.
- A `noldor:cut` naming something outside the page's registry sections produces its own advisory.
- A page whose `sections` is empty is checked for at least two H2 headings instead, with no
  constraint on their names.
- A prose paragraph over the word budget produces one advisory per offending paragraph, naming the
  page, the count and the threshold.
- Paragraph counting excludes mermaid fences, code fences, tables and headings.
- `pnpm noldor docs architecture --check` exits 0 on a repo whose pages carry every blocking rule
  but no sections at all.
- Advisories reach `garden detect` on the `architectureAdvisories` key and do not reach `sddGaps`.
- The release preflight `architecture` row is unaffected by any section or paragraph advisory.
- A fresh `noldor init` still reports the surface as `absent`, and the templates carry the section
  skeleton and the fidelity line.
- This repo's four architecture pages carry their registry sections and produce no advisory.

## Risks / trade-offs

- **The section sets are a judgment call.** They are the substance of the change and there is no code
  to check them against. `## Topology` in particular may read as ceremony in a repo whose answer is
  "one npm package" — the `noldor:cut` marker is the escape hatch, and if it turns out most consumers
  cut the same section, that is the signal to drop it from the registry.
- **An advisory is still ignorable.** The cut marker makes silence mean something, but only for
  someone who reads the output at all. The check does not create a reader.
- **`flows` remains structurally special.** `sections: []` expresses the exemption honestly, but a
  contract about structure that exempts one of its four pages is a compromise, not a clean rule.
- **Widening `ModuleAdvisory`** touches the garden detector and the dashboard, which read its
  `module` field. The blocking/advisory split must survive that edit intact — routing a section row
  into `sddGaps` would silently make a missing heading block a release.
- **Existing consumers get no migration.** Their pages stay as they are until someone reads an
  advisory and edits them by hand. That is the intended cost of leaving consumer prose alone.

## User Story

As a maintainer or review agent reading a repository for the first time, I want each architecture
page to answer its own questions under predictable headings and in short labelled facts, so that I
can tell how the system is shaped without reading four essays.

## Usage

**CLI**

- `noldor docs architecture --check` prints section and long-paragraph advisories alongside the
  existing module advisories, on stdout, without changing the exit code. Each section advisory names
  the heading to add and the `noldor:cut` line that declines it.
- `noldor garden detect` surfaces the same advisories under `architectureAdvisories`.

**Page authoring**

- Write the registry sections as H2s on each page, or decline one in place:
  `<!-- noldor:cut Topology — single npm package, no deployment topology to draw -->`

**Agent/Programmatic API**

- `checkArchitecture(cwd)` returns `advisories` as the widened `ArchitectureAdvisory[]`, carrying
  module, section and long-paragraph rows on one channel.

## Open questions (resolved)

1. *Blocking or advisory for the section rule?* -> Advisory with teeth (D-2): never gates a ship, but
   a declined section must be written down, so an un-annotated gap is a real gap. Blocking would red
   the next release of every repo that filled its pages correctly under the old contract.
2. *Page-total or per-paragraph bloat metric?* -> Per paragraph (D-3). It is the unit the deletion
   test names, and a page total misjudges both the terse long page and the short unreadable one.
3. *What threshold?* -> 100 words (D-3). Measured against this repo's pages, whose worst honest
   paragraph is 59.
4. *How does `flows` fit a fixed section list?* -> It does not; `sections: []` means "at least two
   H2s, names free" (D-1). Expressed in the registry rather than as a page id in the checker.
5. *One advisory channel or two?* -> One, widened to a discriminated `ArchitectureAdvisory` (D-2), so
   the blocking/advisory boundary stays exactly one boundary.
6. *Migration for existing consumers?* -> None (D-5). The advisory carries the fix; writing into
   consumer-owned prose is what `SCAFFOLD_ONLY_TEMPLATES` exists to prevent.
