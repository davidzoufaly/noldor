---
area: docs
category: Tooling
deps: []
entry-id: Q-0093
links:
  code:
    - src/docs/architecture-form.ts
    - src/docs/architecture-schema.ts
    - src/docs/docs-architecture.ts
    - src/garden/detectors/architecture.ts
  tests:
    - src/docs/__tests__/architecture-form.test.ts
    - src/docs/__tests__/docs-architecture.test.ts
    - src/garden/detectors/__tests__/architecture.test.ts
    - src/utils/__tests__/word-count.test.ts
name: Consumer Architecture Doc Surface
packages:
  - noldor
phase: in-progress
since: 2026-08-11T00:00:00.000Z
noldor-tier: specs-only
introduced: 1.4.0
---
## Summary

A `docs/architecture/` folder holding four hand-drawn mermaid diagrams that answer "how is this system shaped" above the per-feature level: `context` (the system, its actors, the externals it talks to), `containers` (deployable and runnable units — FE app, BE service, DB, worker, CLI, infra), `modules` (internal dependency direction and which module owns which durable state) and `flows` (the load-bearing runtime flows). The framework ships the registry, a presence validator, an advisory staleness check, scaffold-only templates, a garden detector, an SDD-report gap and a release probe; consumers write the content. One surface serves both a consumer repo and Noldor itself, which fills the same four pages.

Before this, a repo documented features, designs and conventions but nothing above them, so intentional constraints — source-at-runtime packaging, adoption-safe advisories, sequential queue writes, graph fallbacks — read as accidental bugs, and cross-module seams such as repository mutation (Q-0109) and snapshot ownership (Q-0110) stayed implicit. Deletion test: a new reader should not have to traverse archived plans to answer "which module owns repository paths, writes, and review completion?"

Scoped out at design time: decision records (`docs/adr/`) are a different artifact with a different lifecycle and are not part of this surface, and a dashboard route for the folder is roadmap entry Q-0134.

## User Story

As a maintainer or review agent new to a repository, I want four current diagrams
that name its actors, runnable units, modules and load-bearing flows, so that I
can tell how the system is shaped without reading 50k lines of source or
traversing archived design artifacts.

## Usage

**CLI**

1. `noldor init` scaffolds `docs/architecture/{context,containers,modules,flows}.md`
   into a repo that has none. Each page arrives with its C4 fidelity line, its
   required H2 sections and a one-line prompt under each. The scaffold is inert:
   until you edit a page, the surface reports as absent everywhere and blocks
   nothing.
2. Replace each page's placeholder mermaid fence with a real diagram, fill in the
   sections, and delete the `<!-- TODO:` line. Write a prose paragraph beside each
   diagram — it is the textual equivalent for readers and agents that do not
   render mermaid. The per-heading `<!-- what belongs here:` prompts are not
   placeholders and never block anything.
3. `noldor docs architecture --check` (or the bare `noldor docs architecture`)
   reports what is missing. Exit 0 when the pages are complete or the surface is
   absent; exit 1 when a page is missing, carries no mermaid fence, declares a
   diagram kind outside the registry's `allowedKinds`, still holds a placeholder,
   or cannot be read.
4. Advisories print alongside and never change the exit code: modules the code
   has that `modules.md` never names; registry sections a page neither carries as
   an H2 nor declines; a `flows.md` that names no flow as a heading; prose
   paragraphs over 100 words; and a page whose total prose passes 600 words.
5. Decline a section that genuinely does not apply, rather than deleting its
   heading — `<!-- noldor:cut-section Topology — single npm package, nothing to
   deploy -->`. The reason is required: a marker without one suppresses nothing
   and is reported instead, as is one naming a section the page does not have.

**Page form contract**

- `context` answers Actors / Externals / Boundary; `containers` answers Runnable
  units / Durable state / Topology; `modules` answers Dependency direction /
  State ownership. `flows` names its own flows, so it is checked for at least one
  H2 instead of a fixed set.
- Presence is heading-presence: section order is not checked, extra headings pass,
  and nothing inspects what was written beneath a heading.

**Agent/Programmatic API**

- `checkArchitecture(cwd)` → `{ status: 'absent' | 'ok' | 'incomplete', findings, advisories }`.
  Every filesystem failure is caught and returned as a finding, so it never throws.
- `advisories` is `ArchitectureAdvisory[]`, a union discriminated on `kind`:
  `module`, `section`, `unknown-cut`, `flow-headings`, `long-paragraph`,
  `page-bloat`. Every row carries the registry `pageId` and the repo-relative
  `page`. None of them reaches `status`.
- `assessPageForm(page, body)` → `{ missing, unknownCuts, flowHeadings }` and
  `assessPageBloat(body)` → `{ longParagraphs, pageWords }` are the pure rules
  behind those rows; `parseSectionCuts(body)` and `proseParagraphs(body)` are the
  parsers beneath them.
- `listModuleDirs(cwd)` → sorted repo-relative module paths, one level inside each
  existing scan root.
- `fenceKinds(body)` and `mentionsModule(body, modulePath)` are the pure helpers
  behind the two original checks.
- `detectArchitectureFindings(repo)` → `Gap[]` for the blocking class, run inside
  `collectGaps` so it reaches `docs/sdd-report.md`, `garden detect` and the
  dashboard alike.
- `detectArchitectureAdvisories(repo)` → `Gap[]` for every advisory row, which
  ride garden's own `architectureAdvisories` key and never gate a release. Each
  row's `itemId` is `<page>#<kind>:<discriminator>`, so two rows on one page
  cannot collide.

**Release**

- `pnpm release` reports an `architecture` preflight row: `skipped` when the
  surface is absent, `blocking` when incomplete, `ok` when complete. No advisory
  affects that row.
- `RELEASE_SKIP_ARCHITECTURE=1` forces that row to `skipped` and records the
  override in the audit log.

## PRs

<!-- @prs-since-last-release: consumer-architecture-doc-surface -->

## Changelog

### Initial Release (v1.4.0)

#### Summary

This release adds the architecture doc surface (#333).

#### PRs

- #333: add the architecture doc surface ([link](https://github.com/davidzoufaly/noldor/pull/333))

<!-- generated: resources -->

## Resources

- **Code:**
  - [`src/docs/architecture-schema.ts`](../../src/docs/architecture-schema.ts)
  - [`src/docs/docs-architecture.ts`](../../src/docs/docs-architecture.ts)
  - [`src/garden/detectors/architecture.ts`](../../src/garden/detectors/architecture.ts)
- **Tests:**
  - [`src/docs/__tests__/docs-architecture.test.ts`](../../src/docs/__tests__/docs-architecture.test.ts)
  - [`src/garden/detectors/__tests__/architecture.test.ts`](../../src/garden/detectors/__tests__/architecture.test.ts)

<!-- /generated: resources -->
