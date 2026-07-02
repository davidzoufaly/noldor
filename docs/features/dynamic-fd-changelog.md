---
name: Dynamic FD Changelog
phase: done
area: tooling
category: Tooling
packages:
  - scripts
deps: []
links:
  code:
    - src/dashboard/data.ts
    - src/features/migrate-changelog-unreleased.ts
    - src/release/index.ts
    - src/release/llm-polish-summary.ts
    - src/release/release-changelog.ts
    - src/release/release-dry-run.ts
    - src/release/release-fd-changelog.ts
    - src/release/release-fd-commits.ts
    - src/release/release-notes.ts
  tests:
    - src/dashboard/__tests__/dashboard-data.test.ts
    - src/features/__tests__/migrate-changelog-unreleased.test.ts
    - src/release/__tests__/llm-polish-summary.test.ts
    - src/release/__tests__/release-fd-changelog.test.ts
  spec: lost-pre-extraction
noldor-tier: full
introduced: 0.4.0
---

## Summary

Per-feature changelog now splits across two surfaces with no duplication. The FD body's `## Changelog` section holds only `### <version> > #### Summary` blocks (polished prose, written once at release time and rarely re-edited). The dashboard FD detail page injects everything else live: an `### Unreleased > #### Commits` block at the top, plus a `#### Commits` subsection under each released version, all sourced from a scope-filtered `git log` on every page render. `### Unreleased` is never written to FD bodies; `#### Commits` is never written either.

At release time, `pnpm release` calls `polishSummary(commits)` to rewrite the filtered commit subjects as a single readable paragraph via `claude -p`, with a deterministic `joinSubjectsDeterministic` fallback under `NOLDOR_NO_LLM=1` or subprocess failure. The operator no longer stages release prose ahead of time — auto-polish is the source of truth, and post-release Summary edits land in the FD body directly.

## User Story

As a developer or agent reading an FD detail page, I want to see every commit attributed to this feature — split into Unreleased (since the last tag) and per-version buckets — without that data living statically in the FD MD where it would drift, duplicate the git history, and bloat the file. As an operator running `pnpm release`, I want per-version Summary copy authored from commit subjects automatically, so I don't have to stage release-note copy by hand for every FD that ships.

## Usage

**Reading an FD on the dashboard.** Visit `/features/<slug>`. The `## Changelog` section is auto-merged at request time:

- `### Unreleased` appears at the top whenever there are post-last-tag commits matching `<area>:<slug>` scope. No Summary, just `#### Commits`.
- Each historical `### <version>` block in the FD body is preserved verbatim; a `#### Commits` subsection is appended live for any version whose commit bucket is non-empty.
- Versions whose commit bucket has commits but no static `### <version>` block in the body get a synthesized heading with `_(no summary on file)_` placeholder.

**Authoring Summary copy.** Don't. Run `pnpm release` and let `polishSummary` author it. To override the auto-polished prose post-release, edit the relevant `### <version> > #### Summary` in the FD body and commit — it surfaces on `/release-notes` and `/features/<slug>` immediately.

**Forcing offline mode.** Set `NOLDOR_NO_LLM=1` in the environment when running release scripts to skip the `claude -p` subprocess and use the deterministic subject-join fallback. Useful in CI or when working offline.

**Migrating an existing FD.** Already done for all 48 FDs that existed at adoption time. For new FDs, scaffold without `### Unreleased` — leave `## Changelog` empty until first release, when `pnpm release` populates `### <version> > #### Summary`.

## Resources

- **Plan:** [`docs/superpowers/plans/archive/2026-05-09-dynamic-fd-changelog.md`](../superpowers/plans/archive/2026-05-09-dynamic-fd-changelog.md)
- **Framework page:** [`docs/noldor/feature-md-schema.md`](../noldor/feature-md-schema.md) — see the "`## Changelog` (Summary in body, Commits live)" section

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/plans/archive/2026-05-09-dynamic-fd-changelog.md`](../../docs/superpowers/plans/archive/2026-05-09-dynamic-fd-changelog.md)
- **Code:**
  - [`src/dashboard/data.ts`](../../src/dashboard/data.ts)
  - [`src/features/migrate-changelog-unreleased.ts`](../../src/features/migrate-changelog-unreleased.ts)
  - [`src/release/index.ts`](../../src/release/index.ts)
  - [`src/release/llm-polish-summary.ts`](../../src/release/llm-polish-summary.ts)
  - [`src/release/release-changelog.ts`](../../src/release/release-changelog.ts)
  - [`src/release/release-dry-run.ts`](../../src/release/release-dry-run.ts)
  - [`src/release/release-fd-changelog.ts`](../../src/release/release-fd-changelog.ts)
  - [`src/release/release-fd-commits.ts`](../../src/release/release-fd-commits.ts)
  - [`src/release/release-notes.ts`](../../src/release/release-notes.ts)
- **Tests:**
  - [`src/dashboard/__tests__/dashboard-data.test.ts`](../../src/dashboard/__tests__/dashboard-data.test.ts)
  - [`src/features/__tests__/migrate-changelog-unreleased.test.ts`](../../src/features/__tests__/migrate-changelog-unreleased.test.ts)
  - [`src/release/__tests__/llm-polish-summary.test.ts`](../../src/release/__tests__/llm-polish-summary.test.ts)
  - [`src/release/__tests__/release-fd-changelog.test.ts`](../../src/release/__tests__/release-fd-changelog.test.ts)

<!-- /generated: resources -->

## Changelog

### 0.4.0

#### Summary

Added `migrate-changelog-unreleased`, introduced polished release Summary generation via `claude -p`, and enabled live commit lookup on the FD detail page.
