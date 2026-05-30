---
noldor-page: adoption-guide
introduced: 0.4.0
---

# Adoption Guide

> **Status: not yet adoptable.** Noldor currently lives inside the Charuy repo as a single source of truth for this project's framework rules. The standalone-package lift (npx bootstrap, configurable script paths, generic-stripped testing principles, packaged skill bundle) is tracked under "Lifting Noldor into a standalone repo / npm package" in [`../backlog.md`](../backlog.md).

Until that lift lands, the framework intentionally stays Charuy-shaped — paths are hard-coded to `scripts/<group>/`, examples cite Vitest + Manifold WASM, and the lefthook config assumes the live `pnpm` script set. Generalising prematurely would force breaking-change churn on every framework iteration; the backlog item collects the open questions that need answers before a generic adoption guide is worth writing.

For the in-repo overview of how the pieces fit together, see:

- [`README.md`](README.md) — route table to every framework page.
- [`script-catalog.md`](script-catalog.md) — every pnpm script the framework relies on, grouped by concern.
- [`skill-catalog.md`](skill-catalog.md) — every user-invocable Claude Code skill.
- [`lifecycle.md`](lifecycle.md) — pipeline diagram + complexity tiers.

Once the standalone lift starts, this page hosts the bootstrap recipe: required directories, lefthook config, CLAUDE.md `@-import` chain, first-day workflow, and the open-questions list captured at lift time.
