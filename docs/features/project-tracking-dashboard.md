---
name: Project Tracking Dashboard
phase: done
area: tooling
category: Tooling
packages:
  - scripts
deps: []
links:
  code:
    - scripts/dashboard/server.ts
    - scripts/dashboard/data.ts
    - scripts/dashboard/views.ts
    - scripts/dashboard/layout.ts
  tests:
    - src/dashboard/__tests__/dashboard-data.test.ts
    - src/dashboard/__tests__/dashboard-doc-surfaces.test.ts
    - src/dashboard/__tests__/dashboard-layout-body-styles.test.ts
    - src/dashboard/__tests__/dashboard-layout-style-polish.test.ts
    - src/dashboard/__tests__/dashboard-mermaid.test.ts
    - src/dashboard/__tests__/dashboard-release-notes.test.ts
    - src/dashboard/__tests__/dashboard-render-markdown.test.ts
    - src/dashboard/__tests__/dashboard-server.test.ts
    - src/dashboard/__tests__/dashboard-skills.test.ts
    - src/dashboard/__tests__/dashboard-test-pyramid.test.ts
    - src/dashboard/__tests__/dashboard-views.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-05-04-project-tracking-dashboard-design.md
introduced: 0.3.0
noldor-tier: full
updated: 0.5.0
---
## Summary

Internal-only browser dashboard for project tracking. Live Node server reads filesystem per request — feature MDs (counts, drill-down with frontmatter table + rendered markdown body), roadmap (Now/Next/Later, full block detail with name + category + area + type badge + since + paragraph per entry), backlog (full block detail with name + area + type badge + since + paragraph), SDD gaps (13 detector categories including spec/plan orphans, plans without spec, features without spec), plus filesystem-derived counts (skills, scripts) and realtime git velocity stats (commits 7d/30d/90d, by type, by scope, releases timeline), and a test-pyramid page (per-module source/test/case counts with test-to-code ratio, worst-covered modules first). Overview KPIs split into Project / Activity / Health sections, with Health surfacing stale WIP and worktree drift. Routes (`/`, `/roadmap`, `/backlog`, `/features`, `/features/:slug`, `/gaps`, `/velocity`, `/hot-zones`, `/wip-age`, `/test-pyramid`, `/worktrees`) with querystring filters. Implemented as a single tsx script in `scripts/dashboard/`. Zero hardcoded data — HTML shell + per-request renders. Promoted 2026-05-04 once read-only project visibility outgrew the markdown SDD report.

## User Story

As a maintainer (human or agent), I want to see live, filterable project state in a browser without grep-jumping between markdown files — and to read rendered vision / feature-drill-down / framework / user-docs bodies with proper typography, code surfaces, tables, and blockquotes — so that I can answer "what's in flight, where are the gaps, how fast are we shipping, and what does the framework / docs say?" in one glance.

## Usage

**UI**

1. Run `pnpm dashboard` from the repo root.
2. Open `http://localhost:4321` in a browser (override with `PORT=<n> pnpm dashboard`).
3. Click any nav link — Overview, Vision, Framework, Docs, Releases, Roadmap, Backlog, Features, Gaps, Velocity, Hot zones, WIP age, Worktrees. Spec / plan / feature orphans now surface as gap categories on `/gaps` rather than a dedicated page.
4. The Overview page groups KPIs into three sections: **Project** (features / in-progress / done / gaps / backlog / skills / scripts), **Activity** (commits 7d/30d/90d, days since release, active branches), and **Health** (stale WIP ≥14d, dirty worktrees, behind worktrees, worktree warnings).
5. On Features / Backlog / Roadmap / Gaps, use the filter `<select>` controls to narrow by `phase`, `category`, `area`, or `type`. Roadmap filters narrow rows across the flat priority list. The URL captures filters for deep linking. (Before the 2026-05-13 restructure the roadmap was split into `## Now` / `## Next` / `## Later` sections and filters spanned all three in lock-step; the single flat list replaced that split.)
6. `/roadmap` and `/backlog` accept multi-select chip filters on `size` + `impact` plus a sort dropdown (size / impact / since / area / type). URL params: `?size=XS,S&impact=high,critical&sort=size-desc`. Reset link clears all filter state.
7. On the Features list, click a slug to drill into the feature MD: frontmatter table on top, rendered markdown body below (scoped `.body` stylesheet — heading hierarchy, accent-tinted inline-code chip + bordered fenced-block surface with subtle shadow, GFM table grid + zebra, blockquote accent, list rhythm), link sections (code / PRs / docs / tests / spec) on the side. The same `.body` styling applies to `/vision`, `/framework/<slug>`, and `/docs/<category>/<slug>`. Every tabular page (Backlog, Roadmap, Features list, Worktrees, etc.) shares a sticky-header (solid background, sits below the nav at `top: 3rem`) + zebra-row + hover-tint table style for legibility on long lists. Backlog and Roadmap **Description** columns now render as parsed markdown (paragraphs, lists, inline code, fenced code blocks), and fenced code blocks pick up syntax highlighting via `highlight.js` (TypeScript / TSX / JavaScript / JSON / Bash / CSS / etc.) — both surfaces share the dashboard's accent-tinted code chip and the `.hljs-*` token palette. Fenced ` ```mermaid ` blocks render as live SVG diagrams via mermaid.js (loaded from CDN), with theme following `prefers-color-scheme` so they match the rest of the dashboard.
8. On `/framework`, see all 15 Noldor framework pages (`docs/noldor/*.md` excluding `README.md`) listed in route-table reading order — `lifecycle` → `complexity-gating` → `feature-md-schema` → … → `engineering-principles`. Click any slug to drill into the page body. Inter-page links (`[lifecycle](lifecycle.md)`) and cross-corpus links (`../user/...`, `../../features/...`) rewrite to dashboard routes so navigation stays internal; anchor-only links (`#section`) and external `https?://` URLs pass through.
9. On `/docs`, see all user docs as a single flat list grouped by Diátaxis category (tutorials, how-to, reference, explanation) with a category filter `<select>` for narrowing. Click any doc to drill into its body (`/docs/<category>/<slug>`). Same link-rewriting as `/framework`. The typedoc-generated `docs/user/reference/api/` subtree is excluded for v1 (tracked in backlog as `Dashboard Reference API Subtree`).
10. On `/release-notes`, see the full `docs/release-notes.md` body rendered with `.body` styling — chronologically ordered version sections (newest first) with per-category feature blocks. The source markdown is already a structured timeline, so this is a single-file view rather than a parsed-version timeline UI. "Feature page" links emitted by the release script as absolute GitHub blob URLs (e.g. `https://github.com/davidzoufaly/charuy/blob/main/docs/features/auto-save.md`) get rewritten to internal `/features/<slug>` routes by `rewriteDocLinks`, so navigation stays inside the dashboard. Other absolute URLs (non-GitHub or non-features paths) pass through unchanged.
11. Refresh the browser to see fresh data after any MD edit or commit — there is no cache.
12. `Ctrl+C` in the terminal to stop the server.

**Keyboard shortcut**

- _none for v1_ — runs in a browser tab, not inside the editor app.

**Agent API**

- _none_ — the dashboard is a read-only HTTP surface (`/`, `/vision`, `/framework`, `/framework/:slug`, `/docs`, `/docs/:category`, `/docs/:category/:slug`, `/release-notes`, `/roadmap`, `/backlog`, `/features`, `/features/:slug`, `/gaps`, `/velocity`, `/hot-zones`, `/wip-age`, `/worktrees`, `/health`). Agents `fetch` these endpoints directly when programmatic introspection of project state is useful.

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-05-04-project-tracking-dashboard-design.md`](../../docs/superpowers/specs/archive/2026-05-04-project-tracking-dashboard-design.md)
- **Code:**
  - [`scripts/dashboard/server.ts`](../../scripts/dashboard/server.ts)
  - [`scripts/dashboard/data.ts`](../../scripts/dashboard/data.ts)
  - [`scripts/dashboard/views.ts`](../../scripts/dashboard/views.ts)
  - [`scripts/dashboard/layout.ts`](../../scripts/dashboard/layout.ts)
- **Tests:**
  - [`src/dashboard/__tests__/dashboard-data.test.ts`](../../src/dashboard/__tests__/dashboard-data.test.ts)
  - [`src/dashboard/__tests__/dashboard-doc-surfaces.test.ts`](../../src/dashboard/__tests__/dashboard-doc-surfaces.test.ts)
  - [`src/dashboard/__tests__/dashboard-layout-body-styles.test.ts`](../../src/dashboard/__tests__/dashboard-layout-body-styles.test.ts)
  - [`src/dashboard/__tests__/dashboard-layout-style-polish.test.ts`](../../src/dashboard/__tests__/dashboard-layout-style-polish.test.ts)
  - [`src/dashboard/__tests__/dashboard-mermaid.test.ts`](../../src/dashboard/__tests__/dashboard-mermaid.test.ts)
  - [`src/dashboard/__tests__/dashboard-release-notes.test.ts`](../../src/dashboard/__tests__/dashboard-release-notes.test.ts)
  - [`src/dashboard/__tests__/dashboard-render-markdown.test.ts`](../../src/dashboard/__tests__/dashboard-render-markdown.test.ts)
  - [`src/dashboard/__tests__/dashboard-server.test.ts`](../../src/dashboard/__tests__/dashboard-server.test.ts)
  - [`src/dashboard/__tests__/dashboard-views.test.ts`](../../src/dashboard/__tests__/dashboard-views.test.ts)

<!-- /generated: resources -->

## Changelog

### 0.5.0

#### Summary

This release surfaces size and impact on the RoadmapEntry schema and adds chip-based size + impact filters with sort to both /roadmap and /backlog, backed by a new sortEntries helper with size + impact ordinal ordering, a renderChipRow helper plus chip styles, and parseMultiParam + toggleMultiParam URL helpers, alongside a roadmap total counter. A refactor pass reuses SIZE_ORDER + IMPACT_ORDER, adds a .reset CSS rule, and fixes a stale chip-test comment. Bug fixes address dark-mode chip contrast, the selected-hover state, and hidden-input cardinality test.

### 0.4.0

#### Summary

Dropped redundant headings on `/vision` and collapsed `/docs` nav to 2 levels. `/docs` now flat grouped list with category filter, slug code suffix removed from list items. Release notes emit dashboard `/features/<slug>` (existing entries migrated) and GitHub feature URLs rewrite to `/features/<slug>` across `.body` surfaces. `/release-notes` renders `docs/release-notes.md` body. Injected mermaid script plus `prefers-color-scheme` theme, post-process mermaid fences to `<div class="mermaid">`. Added Framework and Docs to main nav: `/framework` index lists noldor pages via new `loadFrameworkPages` walking `docs/noldor/` in route-table order, `/framework/<slug>` renders noldor body with internal link rewrites; `/docs` index lists Diátaxis categories, `/docs/<category>` lists category contents, `/docs/<category>/<slug>` renders user doc body with cross-corpus link rewrites.
