---
area: tooling
category: Tooling
deps: []
links:
  spec: >-
    docs/superpowers/specs/archive/2026-05-28-framework-doc-extraction-repo-extraction-rev2-design.md
  code: []
  tests: []
name: Framework Doc Extraction
packages:
  - noldor
phase: done
noldor-tier: full
---

## Summary

Extracted the Noldor framework from the Charuy monorepo into its own standalone repository (`github.com/davidzoufaly/noldor`), preserving per-file git history via `git filter-repo`. Charuy now consumes Noldor as a `file:../noldor` sibling dependency, and all framework artifacts (FDs, roadmap, backlog, plans, specs, vision) live in this repo's `docs/`. Delivered across Phase A (de-Charuy-fication of the runtime), Phase B (doc staging), and Phase C (extract + retarget).

## User Story

As a Noldor framework maintainer, I want framework artifacts (FDs, roadmap, backlog, plans, specs, ideas, vision) physically separated from Charuy product artifacts into `packages/noldor/docs/`, so that the `noldor` package ships independently of the Charuy product on its own semver track and the dashboard / triage / release tooling can surface a framework-only or product-only view without manual filtering.

## Usage

**Operator CLI** (added across Phases 0–6):

- `pnpm noldor classify-feature-track [--apply]` — runs the Phase 0 classifier. Dry-run by default; `--apply` commits `framework.txt` / `product.txt` / `ambiguous.txt` / `cross-tree-links.txt` to `.noldor/classification/`.
- `pnpm noldor move-feature [--apply]` — Phase 2. `git mv` framework FDs into `packages/noldor/docs/features/` per the classification snapshot. Dry-run by default.
- `pnpm noldor split-roadmap [--apply]` — Phase 3. Splits `docs/roadmap.md` + `docs/backlog.md` into product-only root and framework `packages/noldor/docs/`.
- `pnpm noldor split-ideas [--apply]` — Phase 4. Two-way split of `ideas.md`.
- `pnpm noldor dashboard server --track framework|product|all` — Phase 5. Different ports per track (5173 product, 5174 framework). `--all` runs both.
- `pnpm noldor next-priority [--track framework|product]` — Phase 3. Each returned entry carries a `track:` field.
- `pnpm release --track framework|product` — Phase 6. Each track owns its semver, changelog, release-notes.

**Skill flags** (Phase 6):

- `/gate`, `/garden`, `/promote`, `/triage`, `/release-sweep` accept `--track framework|product`. Default = inferred from `area:` + slug-prefix; ambiguous cases prompt.

**No UI, no keyboard shortcut, no `window.charuy.*` agent API** — this feature is operator-tier infrastructure; consumed only via CLI + skills.

## PRs

<!-- @prs-since-last-release: framework-doc-extraction -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-05-28-framework-doc-extraction-repo-extraction-rev2-design.md`](../../docs/superpowers/specs/archive/2026-05-28-framework-doc-extraction-repo-extraction-rev2-design.md)

<!-- /generated: resources -->
