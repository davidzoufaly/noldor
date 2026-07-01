---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/features/migrate-code-tags.ts
    - src/features/propose-pointers.ts
    - src/garden/detectors/code-links-drift.ts
    - src/sync/sync-code-links.ts
  docs: []
  tests:
    - src/features/__tests__/migrate-code-tags.test.ts
    - src/features/__tests__/propose-pointers.test.ts
    - src/garden/detectors/__tests__/code-links-drift.test.ts
    - src/sync/__tests__/sync-code-links.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-06-13-dynamic-fd-file-pointers-via-frontmatter-design.md
  plan: >-
    docs/superpowers/plans/2026-06-13-dynamic-fd-file-pointers-via-frontmatter.md
name: Dynamic FD ↔ File Pointers via Frontmatter
packages:
  - scripts
phase: done
noldor-tier: full
---

## Summary

Replace the manual `links.code` / `links.tests` / `links.docs` arrays in FD frontmatter with dynamic frontmatter on the source files themselves — each code/test/doc file declares its FD slug, and the FD's link arrays derive from a scan. Also: brainstorm with an LLM at FD-creation time to propose initial pointers from imports + community membership. Reduces drift between FDs and their backing files. Open question: keep the FD-side arrays as a cached projection for `pnpm validate:features` speed, or always scan? Trigger: when manual FD link maintenance overtakes the value of having explicit link arrays — likely once FD count exceeds ~50 or after a refactor produces N broken links across many FDs.

## User Story

As a contributor (human or agent) maintaining feature MDs, I want each code file
to declare which FD owns it via a `// @fd: <slug>` tag — exactly as test files
already declare `// @tests:` — so that `links.code` derives from a scan instead
of hand-maintained arrays, and a refactor that moves files can't silently rot
the FD ↔ code mapping across dozens of feature MDs.

## Usage

**Tagging a code file**

```ts
// @fd: dynamic-fd-file-pointers-via-frontmatter

import { ... } from '...';
```

Place the `// @fd:` line at the top of the file (after any shebang/license
block), mirroring where `// @tests:` sits in test files. Comma-separate slugs
for a co-owned file.

**Syncing `links.code` from tags**

```bash
pnpm noldor sync code-links          # scan tagged files, write links.code on each FD
pnpm noldor sync code-links --check  # CI/pre-commit: fail if any links.code is stale
```

**One-off migration (rollout only)**

```bash
pnpm noldor features migrate-code-tags   # seed // @fd: tags from existing links.code
pnpm noldor sync code-links --check      # prove the projection reproduces prior arrays
```

**Proposing initial pointers at FD creation**

```bash
pnpm noldor features propose-pointers --slug <new-slug>
```

Invoked optionally from `/new-feature` and `/promote` after the FD is
scaffolded; reviews import + community signal, proposes `// @fd:` tags, writes
them on confirm.

**Drift surfacing** — `pnpm noldor garden detect` (and the SDD report) now
include a `code-links-drift` gap per FD whose cached `links.code` diverges from
the tag scan.

**Keyboard shortcut** — _none (CLI + agent workflow, no UI surface)._

**Agent API** — _none (operates through `pnpm noldor` scripts and git)._

## PRs

<!-- @prs-since-last-release: dynamic-fd-file-pointers-via-frontmatter -->

## Changelog

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-06-13-dynamic-fd-file-pointers-via-frontmatter-design.md`](../../docs/superpowers/specs/archive/2026-06-13-dynamic-fd-file-pointers-via-frontmatter-design.md)
- **Plan:**
  - [`docs/superpowers/plans/2026-06-13-dynamic-fd-file-pointers-via-frontmatter.md`](../../docs/superpowers/plans/2026-06-13-dynamic-fd-file-pointers-via-frontmatter.md)
- **Code:**
  - [`src/features/migrate-code-tags.ts`](../../src/features/migrate-code-tags.ts)
  - [`src/features/propose-pointers.ts`](../../src/features/propose-pointers.ts)
  - [`src/garden/detectors/code-links-drift.ts`](../../src/garden/detectors/code-links-drift.ts)
  - [`src/sync/sync-code-links.ts`](../../src/sync/sync-code-links.ts)
- **Tests:**
  - [`src/features/__tests__/migrate-code-tags.test.ts`](../../src/features/__tests__/migrate-code-tags.test.ts)
  - [`src/features/__tests__/propose-pointers.test.ts`](../../src/features/__tests__/propose-pointers.test.ts)
  - [`src/garden/detectors/__tests__/code-links-drift.test.ts`](../../src/garden/detectors/__tests__/code-links-drift.test.ts)
  - [`src/sync/__tests__/sync-code-links.test.ts`](../../src/sync/__tests__/sync-code-links.test.ts)

<!-- /generated: resources -->
