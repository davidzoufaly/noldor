---
name: SDD Co-Tag Detector
phase: done
area: tooling
category: Tooling
packages:
  - scripts
deps: []
links:
  spec: lost-pre-extraction
  code:
    - src/garden/graph-fd-lookup.ts
  tests:
    - src/garden/__tests__/graph-fd-lookup.test.ts
    - src/garden/__tests__/sdd-report.test.ts
    - src/sync/__tests__/sync-fd-resources.test.ts
introduced: 0.3.0
noldor-tier: full
updated: 0.4.0
---

## Summary

13th SDD detector flagging tests whose `// @tests:` tag list is incomplete given the FDs that own the source files the test imports. Today silent: `sample-gallery.spec.ts` tagged only `sample-scene-gallery` despite exercising `empty-scene-state`; `tree.test.ts` tagged only `zod-scene-schema` despite covering `group-node`; engine tests tagged only their primary FD without `manifold-wasm-integration`. Detector reads `graphify-out/graph.json` `imports_from` edges (graphify v0.7.8+, with the v0.4.20 path-normalization fix), maps target source files to owning FDs via `links.code`, diffs against declared tags. Staleness gate: graph mtime vs MAX(mtime) of `packages/ apps/ scripts/`; on stale, emits one meta-gap with regen instructions. Substrate (`loadFreshGraphOrWarn`, `buildFileToFdsMap`, `getFdOwnersForFile`) lives in `src/garden/graph-fd-lookup.ts`; reused by detectors 9 and 10 below.

Second batch (2026-05-11) — detectors 9 (orphan-owner suggestion), 10 (untagged-test slug suggestion), and 19 (done features without code, formerly tracked as "detector 14" in the roadmap; renumbered to avoid collision with the rule-contradiction detector already at slot 14) ship on the same substrate. Detector 19 is pure frontmatter (mirrors `links.docs` / `links.tests` `n/a` sentinel pattern); 9 + 10 use new helpers `getCommunityOwners` and `getImportOwnersForTest` in `src/garden/graph-fd-lookup.ts`. Both 9 and 10 fall back to the bare message in degraded mode (stale or missing graph).

## User Story

- As an operator running `pnpm sdd:report`, I want incomplete `// @tests:` tag lists surfaced as gaps so test files automatically attribute coverage to every FD whose code they import — not just the FD the author thought of first.
- As an agent triaging `docs/sdd-report.md`, I want a clear "add: `<slug-list>`" hint per test file so applying the fix is one tag edit per gap.

## Usage

```bash
pnpm sdd:report
```

Output (under `### Tests with incomplete co-tag`):

```
- packages/format/src/__tests__/tree.test.ts: imports files owned by FDs missing from @tests: tag — add: group-node
```

To resolve: open the flagged test file, append the missing slugs to its `// @tests:` line (comma-separated), then run `pnpm sync:test-links` to populate the FD `links.tests` arrays.

When the graph is stale, the detector emits a single meta-gap with a regen instruction instead of per-test gaps:

```
- graphify-out/graph.json: Co-tag detector ran in degraded mode … Run /graphify + pnpm toon …
```

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-05-07-sdd-co-tag-detector-design.md`](../../docs/superpowers/specs/archive/2026-05-07-sdd-co-tag-detector-design.md)
- **Code:**
  - [`src/garden/graph-fd-lookup.ts`](../../src/garden/graph-fd-lookup.ts)
- **Tests:**
  - [`src/garden/__tests__/graph-fd-lookup.test.ts`](../../src/garden/__tests__/graph-fd-lookup.test.ts)
  - [`src/garden/__tests__/sdd-report.test.ts`](../../src/garden/__tests__/sdd-report.test.ts)
  - [`src/sync/__tests__/sync-fd-resources.test.ts`](../../src/sync/__tests__/sync-fd-resources.test.ts)

<!-- /generated: resources -->

## Changelog

### 0.4.0

#### Summary

This release adds detector 9 for probable owner identification on code orphans, introduces the `getCommunityOwners` substrate helper, ships detector 10 to suggest slugs for untagged tests, extracts the `getImportOwnersForTest` helper via refactor, and adds detector 14 to flag done features missing code.
