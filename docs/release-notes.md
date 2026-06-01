# Release Notes

## v0.2.0 — 2026-06-01

### Tooling

#### Framework Doc Extraction

Extracted the Noldor framework from the Charuy monorepo into its own standalone repository (`github.com/davidzoufaly/noldor`), preserving per-file git history via `git filter-repo`. Charuy now consumes Noldor as a `file:../noldor` sibling dependency, and all framework artifacts (FDs, roadmap, backlog, plans, specs, vision) live in this repo's `docs/`. Delivered across Phase A (de-Charuy-fication of the runtime), Phase B (doc staging), and Phase C (extract + retarget).

[Feature page](/features/framework-doc-extraction)

#### How-To Index Pipeline

Generates `docs/user/how-to/index.md` from the frontmatter of every how-to MD under `docs/user/how-to/`. Each how-to declares validated frontmatter (`howtoFrontmatterSchema` — `category` constrained to the shared `CATEGORIES` enum); the pipeline parses them, groups by category, and renders an index whose bullets pair each guide's title with its first body paragraph as a one-liner. Run via `pnpm noldor docs howto`. Empty input degrades to a `_No how-to guides yet._` placeholder rather than an empty file.

[Feature page](/features/howto-index-pipeline)

#### Noldor Package Lift

The framework is now lifted into a dedicated `packages/noldor` workspace package (#53).

[Feature page](/features/noldor-package-lift)
