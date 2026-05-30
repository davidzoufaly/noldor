---
area: tooling
category: Docs
deps: []
links:
  code:
    - src/docs/docs-howto.ts
    - src/docs/howto-schema.ts
  tests:
    - src/docs/__tests__/docs-howto.test.ts
    - src/docs/__tests__/howto-schema.test.ts
name: How-To Index Pipeline
packages:
  - noldor
phase: done
noldor-tier: specs-only
---

## Summary

Generates `docs/user/how-to/index.md` from the frontmatter of every how-to MD under `docs/user/how-to/`. Each how-to declares validated frontmatter (`howtoFrontmatterSchema` — `category` constrained to the shared `CATEGORIES` enum); the pipeline parses them, groups by category, and renders an index whose bullets pair each guide's title with its first body paragraph as a one-liner. Run via `pnpm noldor docs howto`. Empty input degrades to a `_No how-to guides yet._` placeholder rather than an empty file.

## User Story

As a docs maintainer (human or agent), I want the how-to index regenerated from the how-to guides themselves rather than hand-maintained, so that adding or renaming a guide can't drift the index out of sync — the index is a pure function of the guides' frontmatter.

## Usage

**UI**

_none_ — the pipeline writes a markdown file consumed by the dashboard's `/docs` surface; it has no UI of its own.

**Keyboard shortcut**

_none_ — invoked as a CLI build step.

**Agent API**

1. Run `pnpm noldor docs howto` to regenerate `docs/user/how-to/index.md`.
2. The command walks `docs/user/how-to/`, skips `index.md` itself, validates each guide's frontmatter against `howtoFrontmatterSchema`, and rewrites the index grouped by `category`.
3. Importable surface: `renderHowToIndex(howtos)` returns the index body string from an array of parsed `Howto` records, for callers that want the rendering without the filesystem walk.

## Changelog

<!-- generated: resources -->
