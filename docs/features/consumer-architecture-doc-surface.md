---
area: docs
category: Tooling
deps: []
entry-id: Q-0093
links:
  code:
    - src/docs/architecture-schema.ts
    - src/docs/docs-architecture.ts
    - src/garden/detectors/architecture.ts
  tests:
    - src/docs/__tests__/docs-architecture.test.ts
    - src/garden/detectors/__tests__/architecture.test.ts
name: Consumer Architecture Doc Surface
packages:
  - noldor
phase: done
since: 2026-08-11T00:00:00.000Z
noldor-tier: specs-only
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
   into a repo that has none. The scaffold is inert: until you edit a page, the
   surface reports as absent everywhere and blocks nothing.
2. Replace each page's placeholder mermaid fence with a real diagram, and delete
   the `<!-- TODO:` line. Write a prose paragraph beside each diagram — it is the
   textual equivalent for readers and agents that do not render mermaid.
3. `noldor docs architecture --check` (or the bare `noldor docs architecture`)
   reports what is missing. Exit 0 when the pages are complete or the surface is
   absent; exit 1 when a page is missing, carries no mermaid fence, declares a
   diagram kind outside the registry's `allowedKinds`, still holds a placeholder,
   or cannot be read.
4. Module advisories print alongside, naming any directory one level inside a
   scan root that `modules.md` never mentions. They never change the exit code.

**Agent/Programmatic API**

- `checkArchitecture(cwd)` → `{ status: 'absent' | 'ok' | 'incomplete', findings, advisories }`.
  Every filesystem failure is caught and returned as a finding, so it never throws.
- `listModuleDirs(cwd)` → sorted repo-relative module paths, one level inside each
  existing scan root.
- `fenceKinds(body)` and `mentionsModule(body, modulePath)` are the pure helpers
  behind the two checks.
- `detectArchitectureFindings(repo)` → `Gap[]` for the blocking class, run inside
  `collectGaps` so it reaches `docs/sdd-report.md`, `garden detect` and the
  dashboard alike.
- `detectArchitectureAdvisories(repo)` → `Gap[]` for the module advisories, which
  ride garden's own `architectureAdvisories` key and never gate a release.

**Release**

- `pnpm release` reports an `architecture` preflight row: `skipped` when the
  surface is absent, `blocking` when incomplete, `ok` when complete.
- `RELEASE_SKIP_ARCHITECTURE=1` forces that row to `skipped` and records the
  override in the audit log.

## PRs

<!-- @prs-since-last-release: consumer-architecture-doc-surface -->

## Changelog
