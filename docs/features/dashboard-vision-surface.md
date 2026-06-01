---
name: Dashboard Vision Surface
phase: done
area: tooling
category: Tooling
packages:
  - scripts
deps: []
links:
  code:
    - scripts/dashboard/data.ts
    - scripts/dashboard/views.ts
    - scripts/dashboard/server.ts
    - scripts/dashboard/layout.ts
  tests:
    - src/dashboard/__tests__/dashboard-data.test.ts
    - src/dashboard/__tests__/dashboard-server.test.ts
    - src/dashboard/__tests__/dashboard-views.test.ts
introduced: 0.3.0
noldor-tier: specs-only
---

## Summary

Surface `docs/vision.md` in the project-tracking dashboard. The `/` overview now opens with a milestone banner pulling `current-milestone` + `goal` from vision frontmatter (with a `read vision →` link) so every other panel renders against the strategic frame. A new `/vision` page renders the full vision body — frontmatter table on top, rendered markdown below — using the same per-request file-read + `marked` render path as the feature drill-down. Nav gains a `Vision` link between Overview and Roadmap.

## User Story

As a maintainer (human or agent), I want the dashboard to open with the current milestone goal in view and to drill into the full vision without leaving the browser, so that I can keep gaps and roadmap entries calibrated against the strategic frame without context-switching to `docs/vision.md`.

## Usage

**UI**

1. Run `pnpm dashboard` from the repo root and open `http://localhost:4321`.
2. The overview page renders a banner directly under the heading: "Current milestone: \<version\> — \<goal\> · read vision →". The link jumps to `/vision`.
3. Click `Vision` in the top nav (between Overview and Roadmap), or hit `/vision` directly, to see the full body — frontmatter table (current milestone, goal) followed by the rendered markdown (North Star, Posture, The Gate, Success Criteria).
4. Edit `docs/vision.md` and refresh — there is no cache; the dashboard re-reads the file per request.

**Keyboard shortcut**

- _none_ — navigated via top-nav link or URL only.

**Agent API**

- _none new_ — agents `fetch http://localhost:4321/vision` to read the rendered HTML; the underlying source remains `docs/vision.md` and is the canonical machine-readable form.

<!-- generated: resources -->

## Resources

- **Code:**
  - [`scripts/dashboard/data.ts`](../../scripts/dashboard/data.ts)
  - [`scripts/dashboard/views.ts`](../../scripts/dashboard/views.ts)
  - [`scripts/dashboard/server.ts`](../../scripts/dashboard/server.ts)
  - [`scripts/dashboard/layout.ts`](../../scripts/dashboard/layout.ts)
- **Tests:**
  - [`src/dashboard/__tests__/dashboard-data.test.ts`](../../src/dashboard/__tests__/dashboard-data.test.ts)
  - [`src/dashboard/__tests__/dashboard-server.test.ts`](../../src/dashboard/__tests__/dashboard-server.test.ts)
  - [`src/dashboard/__tests__/dashboard-views.test.ts`](../../src/dashboard/__tests__/dashboard-views.test.ts)

<!-- /generated: resources -->

## Changelog
