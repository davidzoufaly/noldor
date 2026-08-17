# Consumer Architecture Doc Surface — Design

**Slug:** consumer-architecture-doc-surface
**FD:** docs/features/consumer-architecture-doc-surface.md
**Date:** 2026-08-17
**Tier:** specs-only

## Problem

A Noldor repo documents features (`docs/features/`, 77 files here), designs
(`docs/design/specs/` + `plans/`, 107 artifacts) and framework conventions
(`docs/noldor/`, 26 pages). None of them answers the question a new reader or a
review agent asks first: **how is this system shaped?**

Verified absent in this repo: no `CONTEXT.md`, no `docs/adr/`, no module map
(`find docs -maxdepth 2 -type d` returns only `assets`, `design`, `features`,
`noldor`, `user`). The only two diagrams in the whole doc tree are
`docs/noldor/lifecycle.md:10` and `:95`.

Two costs follow. Intentional constraints — source-at-runtime packaging,
adoption-safe advisories, sequential queue writes, graph fallbacks — read as
accidental bugs, because the reasoning survives only inside archived design
artifacts whose links are already stale (Q-0098). And genuine cross-module seams
such as repository mutation (Q-0109) and snapshot ownership (Q-0110) stay
implicit, so a reviewer re-derives them from ~50k lines of runtime source.

## Goals

- A `docs/architecture/` folder holding a small **fixed** set of hand-drawn
  mermaid diagrams that answer system shape, deployable units, internal
  dependency direction and the load-bearing runtime flows.
- The framework ships the scaffold, a validator, a drift pair, a garden
  detector, an SDD-report gap and a release gate — not the content.
- Noldor dogfoods the same four pages it prescribes.
- A repo without `docs/architecture/` is never blocked by any of it.

## Non-goals

- **ADRs.** Decision records are a different artifact (append-only, dated,
  superseded-by chains) with a different lifecycle. Carved to a sibling roadmap
  entry.
- **Deriving diagrams from the graph.** `graphify-out/graph.json` is tracked and
  has 6186 links, but its 146 communities sit at ~1:1 with files (`Core —
  Session`, `CR — Orchestrate`) — noise at architecture altitude. A seed would
  help one of four diagrams and could not be re-applied after a hand edit.
- **A configurable diagram taxonomy.** The four IDs are the framework, per the
  vision's "opinionated, not configurable" posture.
- **Rendering infrastructure.** GitHub renders ```mermaid fences natively, which
  is the whole rendering requirement. The dev dashboard has a mermaid renderer
  (`src/dashboard/data.ts:218`, `src/dashboard/layout.ts:400`) but no route
  reaches `docs/architecture/` — its GET table serves `/framework/<slug>`,
  `/skills/<slug>` and `/docs/(tutorials|how-to|reference|explanation)/<slug>`
  (`src/dashboard/server.ts`). Adding that route is a separate roadmap entry
  (Q-0134), not part of this surface.
- **An index page.** Over four fixed pages whose names come from the registry,
  a generated `index.md` adds nothing a directory listing does not, while adding
  a renderer, a CLI flag and a page nobody owns. Extra per-subsystem diagrams
  are discoverable the same way — by looking in the folder.
- **Validating extra pages.** A repo may add per-subsystem diagrams beside the
  four; only the registry pages are checked.

## Design

### U1 — Diagram registry (`src/docs/architecture-schema.ts`)

One closed list, `ARCHITECTURE_PAGES`, of four entries
`{ id, title, purpose, allowedKinds }`:

| id | purpose | allowedKinds |
|---|---|---|
| `context` | the system, its actors, and the externals it talks to | `flowchart`, `C4Context` |
| `containers` | deployable / runnable units — FE app, BE service, DB, worker, CLI, infra | `flowchart`, `C4Container` |
| `modules` | internal dependency direction + which module owns which durable state | `flowchart`, `classDiagram` |
| `flows` | the two or three load-bearing runtime flows | `sequenceDiagram` |

Every other unit reads this list, so adding a fifth page is a one-line change
that propagates to templates, validator and release probe at once.

### U2 — Page validator (`src/docs/docs-architecture.ts`)

`checkArchitecture(cwd)` returns `{ status, findings, advisories }` where
`status` is `absent | ok | incomplete`. It resolves the folder through
`loadDocRoots(cwd).architecture` rather than joining its own path string; the
`DocRoots` interface gains that field alongside the function
(`src/core/doc-roots.ts:47`).

`absent` when the folder does not exist — the single fact every caller keys its
skip on. Otherwise each registry page is checked for four things: the file
exists; it contains at least one ```mermaid fence; the fence declares a kind in
`allowedKinds`; no unresolved `<!-- TODO:` placeholder remains. Each failure
becomes one entry in `findings`, naming the file and the rule, so one pass
reports everything; a non-empty `findings` is what makes `status` `incomplete`.

`advisories` carries U3's module findings, which never affect `status`.

Reading the kind means the first token of the first **content** line inside the
fence, after skipping a leading `---` YAML block and any `%%{init: …}%%`
directive — both legal mermaid preambles that a naive first-line read would
misclassify as an unknown kind. It is a textual read, not a mermaid parse; see
Risks.

### U3 — Structural staleness check (same module)

`modules` is the one page whose subject the repo can describe itself, so it gets
a real staleness signal rather than a calendar one. `listModuleDirs(cwd)` derives
the module set, and `checkArchitecture` flags every member `modules.md` does not
name.

**The module set is one level *inside* each scan root, not the roots.**
`scanRoots()` (`src/core/repo-paths.ts:25`) returns roots — `['src']` in this
repo and in the shipped `templates/.noldor/config.json`, `['packages', 'apps',
'scripts', 'src']` when a consumer sets no `scanPaths`. Checking the roots
themselves would reduce here to "does `modules.md` contain `src`", which any
path mention satisfies, so the check would never fire. One level in is the
granularity that matches what the page draws: `src/core`, `src/cr`,
`src/garden`, … here; `packages/api`, `packages/web` for a monorepo consumer.

Three rules keep it from firing wrongly:

- **Existence filter.** Only roots that exist on disk contribute. `scanRoots()`
  returns names regardless — its own docstring notes roots that do not exist are
  ENOENT-skipped by every walker — so a standalone consumer with no config would
  otherwise get findings for `packages`, `apps` and `scripts` it never had.
- **Skip when the page is absent.** U2 already reports a missing `modules.md`;
  running the structural pass as well would either throw on the read or bury
  that one finding under a finding per module.
- **Path-token match**, not substring: a module counts as named when its path
  appears delimited by whitespace, backticks, or markdown punctuation. Substring
  matching would let a root named `app` match the word "apply".

This replaces a `SOURCE_DRIFT_PAIRS` entry. A date-based pair over whole-`src`
would flag the page on nearly every PR at the 30-day tolerance
(`src/garden/garden-detect.ts:521`), and a detector that always fires is noise.
The structural form is silent through ordinary edits and speaks when a module is
added or renamed — which is when a module diagram actually goes wrong.

**These findings are advisory.** They surface through U6 and U7 but do not make
`checkArchitecture` return `incomplete`, so they never reach U8's blocking row.
Only U2's presence, fence and placeholder rules block a release. Adding a module
should nag, not stop a release.

### U4 — CLI

`noldor docs architecture [--check]`, registered in the existing `docs` group of
`src/cli/manifest.ts` beside `api`, `howto`, `check` and `transclude`. `--check`
is the only mode and the default, so the bare invocation and the flagged one
behave identically. Exits 0 on `ok` and on `absent`, non-zero on `incomplete`,
printing findings and advisories both — advisories labelled as such, since they
are printed on a run that exits 0.

### U5 — Templates + doc root

`templates/docs/architecture/{context,containers,modules,flows}.md`, each a
short prose prompt plus one placeholder mermaid fence carrying the
`<!-- TODO:` marker U2 rejects — so a scaffolded-but-unwritten folder is
*visibly* incomplete rather than silently empty. All four paths join
`SCAFFOLD_ONLY_TEMPLATES` (`src/templates/manifest.ts:20`, which keys on
individual file paths, not directories): `init` copies each only when absent,
`init --update` never overwrites, and `template-sync` / `doctor` never report
drift — the content is consumer-owned.

`loadDocRoots` (`src/core/doc-roots.ts:47`) gains
`architecture: join(cwd, 'docs', 'architecture')`, so every caller resolves the
folder against the repo it was handed rather than `process.cwd()`.

### U6 — Garden detector

`detectArchitecture(repo)` in `src/garden/garden-detect.ts` wraps U2 and emits
one finding per entry in **both** `findings` and `advisories`, nothing on
`absent`. Garden is advisory throughout, so the two classes need no separate
treatment here. `SOURCE_DRIFT_PAIRS` is left untouched — U3 replaces the
date-based pair this design first reached for.

### U7 — SDD-report gap

`detectArchitectureGaps` in `src/garden/sdd-report.ts`, emitting `Gap` entries
(the shape imported from `src/core/fd-load.ts`) alongside the existing doc-gap
detectors, so the standing report carries the same signal without an operator
running garden. Page-scoped `findings` yield one `Gap` each, keyed on the page;
U3's `advisories` are module-scoped and yield one `Gap` per unnamed module,
keyed on `modules.md` — the same `Gap` shape either way, so the report needs no
new category.

### U8 — Release probe

A new `'architecture'` member of the `PreflightRowId` union
(`src/release/preflight-types.ts`), appended to `ALL_ROW_IDS` and `PROBES`
(`src/release/preflight-probes.ts`). `absent` maps to `skipped` with the reason
in `detail`; `incomplete` maps to `blocking` with a copy-pasteable `fix`; `ok`
maps to `ok`. `RELEASE_SKIP_ARCHITECTURE=1` routes through the existing
`overrideSkip` helper so the override is audited like every other.

The row set is pinned by a count assertion — `src/release/__tests__/preflight-probes.test.ts:31`
asserts `ALL_ROW_IDS.length` is 13. Adding the row moves it to 14 in the same
change; a probe added without touching that line fails the suite.

The absent-to-skipped mapping is what keeps a blocking gate adoption-safe: a
consumer that has never scaffolded the folder cannot be stopped by it. Scaffold
it and you have opted into finishing it.

### U9 — Noldor's own four pages

Written in this PR, from the repo as it actually is: `context` (operator and
agent → the CLI → git, `gh`, graphify), `containers` (the CLI, the lefthook
hook jobs, the dev dashboard, the `.noldor/*.json` state files), `modules`
(`src/*` dependency direction with the durable-state owner per module),
`flows` (gate → CR lanes → `pr-flow` merge).

This is what makes the release gate green on its own first run, which is why the
FD does **not** declare `introduces-gate` — there is no window in which the
feature's gate blocks the feature's own release.

## Acceptance criteria

1. `docs/architecture/` in this repo contains one page per registry id, each
   carrying at least one mermaid fence and no placeholder marker.
2. `noldor docs architecture --check` exits 0 on a complete folder, and the bare
   invocation behaves identically.
3. It exits non-zero and names every offending file when a registry page is
   missing, carries no mermaid fence, declares a fence kind outside
   `allowedKinds`, or still carries a placeholder marker.
4. It exits 0 and reports the folder as absent when `docs/architecture/` does
   not exist.
5. A fence whose graph keyword follows a `---` YAML block or a `%%{init: …}%%`
   directive is read as its real kind, not rejected.
6. It reports an advisory for every directory one level inside an existing scan
   root that `modules.md` does not name by path token, none when all are named,
   and none at all when `modules.md` is missing; a non-existent scan root
   contributes nothing. Additional `.md` files in the folder are ignored.
7. Those advisories leave the exit code at 0 and the status out of `incomplete`,
   so they never reach the release row.
8. Release preflight reports an `architecture` row: `skipped` when the folder is
   absent, `blocking` with a `fix` when incomplete, `ok` when complete.
9. `RELEASE_SKIP_ARCHITECTURE=1` forces that row to `skipped` and tags it with
   the override.
10. `garden detect` reports both findings and advisories for the folder, and
    nothing for an absent one.
11. `docs/sdd-report.md` carries an architecture gap line while the folder is
    incomplete.
12. `noldor init` scaffolds the four template pages into a repo that has none,
    and `doctor` reports no drift after the consumer edits their content.

## Risks / trade-offs

- **A blocking release gate on a docs artifact.** A consumer that scaffolds the
  folder and stalls cannot cut a release. Two escape hatches: never scaffolding
  it at all (absent → skipped), and `RELEASE_SKIP_ARCHITECTURE=1`. Accepted
  deliberately — an advisory-only check is the shape the entry warns about.
- **An empty folder is `incomplete`, not `absent`.** `mkdir docs/architecture`
  alone flips a repo straight to `blocking`, and the only ways back are removing
  the folder or setting the override. Keying on directory existence is what makes
  the skip a single unambiguous fact, so the sharp edge is accepted.
- **Hand-drawn diagrams rot.** Only `modules` has a mechanical staleness signal
  (U3); `context`, `containers` and `flows` rot unobserved, because nothing in
  the repo can tell that an actor or a runtime flow changed. The alternative —
  deriving them — cannot express the domain vocabulary and the why-intentional
  reading that is half the point.
- **The one staleness signal there is, is advisory.** U3 nags through garden and
  the SDD report but never blocks, so a repo can release with a module diagram
  that omits a module. The reverse — folding it into the blocking row — would
  stop a release on a directory rename, which is a heavier price than a stale
  diagram is worth.
- **Textual fence-kind check.** A syntactically broken mermaid diagram passes
  U2 and fails only when rendered. Parsing mermaid would pull the renderer into
  the validator; not worth it for a check whose job is presence, not beauty.
- **A mentioned-but-wrong module reads as fresh.** U3 checks that `modules.md`
  *names* each source root, not that it describes it correctly, so a renamed
  module is caught and a rewired dependency is not.
- **A fixed four-ID taxonomy will not fit every repo.** Extra pages are the
  escape hatch, but they are unvalidated, so a repo leaning on them gets less
  from the surface than one that fits.
- **Scaffold-only templates never receive framework improvements.** A later
  better prompt or a fifth page reaches existing consumers only through their own
  edit. This is the same trade every consumer-owned scaffold makes, and the
  alternative would have `template-sync` demand the consumer's architecture prose
  match a template.

## User Story

As a maintainer or review agent, I want a small fixed set of current
architecture diagrams in the repo, so that I can answer how the system is shaped
and which module owns which durable state without traversing archived design
artifacts.

## Usage

```bash
# scaffold (new consumer)
noldor init                       # writes docs/architecture/{context,containers,modules,flows}.md

# author: replace each placeholder fence with a real mermaid diagram

noldor docs architecture --check   # presence, fence kind, placeholders,
                                   # and source roots missing from modules.md

noldor garden detect               # same findings, alongside the other detectors
pnpm release                       # architecture row: ok / skipped / blocking
RELEASE_SKIP_ARCHITECTURE=1 pnpm release   # audited override
```

Rendered output: GitHub renders the fences natively. The dev dashboard does not
serve this folder — see Non-goals.

## Open questions (resolved)

1. *Does this spec cover the map, the ADR surface, or both?*
   → **Map only.** ADRs are append-only with supersede chains and a different
   lifecycle; bundling both doubles the schemas and validators and re-sizes the
   entry to L (D1).
2. *Is the content hand-authored, generated, or hybrid?*
   → **Hand-authored mermaid.** The machine half of the entry's ask (modules,
   dependency direction) is derivable; the half that makes a constraint read as
   intentional is not (D2).
3. *Which diagram set does the framework fix?*
   → **context / containers / modules / flows.** Four IDs that a product repo
   and a CLI can both fill honestly, so the framework can dogfood what it
   prescribes (D3).
4. *One surface for consumers and for Noldor, or two?*
   → **One.** A second framework-internal surface would double the machinery to
   express the same four questions (D4).
5. *What machinery ships, and does anything seed the diagrams?*
   → **Scaffold + validator + structural staleness check, no seeding.** A graph
   seed helps one of four diagrams and cannot be re-applied after a hand edit
   (D5).
6. *Folder of pages or a single file, and where?*
   → **`docs/architecture/`, page per diagram.** Peer to `docs/features/` and
   `docs/design/`; not under `docs/user/`, which is product documentation for the
   consumer's users rather than for maintainers and review agents (D6).
7. *Where does the check fire?*
   → **Garden + SDD report advisory, plus a blocking release gate**, with the
   absent-folder skip preserved at every call site (D7).
8. *Should the FD declare `introduces-gate`?*
   → **No.** U9 ships Noldor's own four pages in the same PR, so the gate is
   green on its first run and never blocks the change that introduces it.
9. *How is `modules.md` staleness detected?*
   → **Structurally, not by date, and one level inside the scan roots.** A
   `SOURCE_DRIFT_PAIRS` entry over whole-`src` fires on nearly every PR at the
   30-day tolerance and hardcodes one repo's layout. Checking the roots
   themselves is no better — `scanRoots()` is `['src']` here and in the shipped
   template, so the check would reduce to a substring test that always passes.
   The directories one level in are the modules the page actually draws.
10. *Does the surface carry a generated index page?*
    → **No.** Over four fixed pages an index adds a renderer, a CLI flag and an
    artifact no unit owns, to duplicate what a directory listing already shows.
11. *Does the dev dashboard serve the folder?*
    → **Not here.** No route reaches `docs/architecture/`; adding one is roadmap
    entry Q-0134 rather than scope creep into a docs feature.
12. *Do U3's module findings block a release?*
    → **No — advisory only.** They surface in garden and the SDD report while
    only U2's presence, fence and placeholder rules feed the blocking row.
    Adding a module should nag; stopping a release over a directory rename is a
    heavier price than a stale diagram is worth.
