---
area: tooling
category: Tooling
deps: []
links:
  spec: >-
    docs/design/specs/archive/2026-05-28-framework-doc-extraction-repo-extraction-rev2-design.md
  code:
    - src/core/doc-roots.ts
    - src/hooks/noldor-validate-trailer.ts
  tests:
    - src/core/__tests__/doc-roots.test.ts
    - src/dashboard/__tests__/server-static.test.ts
name: Framework Doc Extraction
packages:
  - noldor
phase: done
noldor-tier: full
introduced: 0.2.0
---

## Summary

Extracted the Noldor framework from the Charuy monorepo into its own standalone repository (`github.com/davidzoufaly/noldor`), preserving per-file git history via `git filter-repo`. Charuy now consumes Noldor as a `file:../noldor` sibling dependency, and all framework artifacts (FDs, roadmap, backlog, plans, specs, vision) live in this repo's `docs/`. Delivered across Phase A (de-Charuy-fication of the runtime), Phase B (doc staging), and Phase C (extract + retarget).

## User Story

As a Noldor framework maintainer, I want framework artifacts (FDs, roadmap, backlog, plans, specs, ideas, vision) physically separated from Charuy product artifacts into `packages/noldor/docs/`, so that the `noldor` package ships independently of the Charuy product on its own semver track and the dashboard / triage / release tooling can surface a framework-only or product-only view without manual filtering.

## Usage

The extraction shipped as a one-shot `git filter-repo` split, not as the
phased in-monorepo `packages/noldor/` staging the spec originally proposed. The
phase-numbered operator CLIs that plan called for (`classify-feature-track`,
`move-feature`, `split-roadmap`, `split-ideas`) and the per-track `--track
framework|product` flags were never built — the repo split made a two-track
view unnecessary, because this repo now holds framework artifacts exclusively.
What the operator actually uses after the extraction:

```bash
# Doc roots resolve from this repo, not from a monorepo sub-package.
pnpm noldor validate features        # every FD under docs/features/
pnpm noldor next-priority            # top roadmap entry, single track
pnpm release                         # one semver track, this repo's

# Charuy consumes the framework as a sibling file: dependency; its own docs/
# tree stays product-only with no filtering flag needed.
```

Doc-root resolution is centralized in [`doc-roots.ts`](../../src/core/doc-roots.ts) —
the seam that made the split possible and the only surviving code deliverable of
the phased plan.

**No UI, no keyboard shortcut, no `window.charuy.*` agent API** — this feature is operator-tier infrastructure; consumed only via CLI + skills.

## PRs

<!-- @prs-since-last-release: framework-doc-extraction -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-05-28-framework-doc-extraction-repo-extraction-rev2-design.md`](../../docs/design/specs/archive/2026-05-28-framework-doc-extraction-repo-extraction-rev2-design.md)
- **Code:**
  - [`src/core/doc-roots.ts`](../../src/core/doc-roots.ts)
  - [`src/hooks/noldor-validate-trailer.ts`](../../src/hooks/noldor-validate-trailer.ts)
- **Tests:**
  - [`src/core/__tests__/doc-roots.test.ts`](../../src/core/__tests__/doc-roots.test.ts)
  - [`src/dashboard/__tests__/server-static.test.ts`](../../src/dashboard/__tests__/server-static.test.ts)

<!-- /generated: resources -->
