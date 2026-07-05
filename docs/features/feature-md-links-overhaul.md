---
name: Feature MD Links Overhaul
phase: done
area: tooling
category: Tooling
packages:
  - scripts
deps: []
links:
  code:
    - src/checks/check-feature-slug-scope.ts
    - src/core/extract-touches.ts
    - src/features/feature-schema.ts
    - src/features/fill-links-code-gaps.ts
    - src/features/migrate-features.ts
    - src/features/validate-features.ts
    - src/garden/sdd-report.ts
    - src/release/release-commits.ts
    - src/sync/sync-spec-links.ts
    - src/sync/sync-test-links.ts
  tests:
    - src/checks/__tests__/check-feature-slug-scope.test.ts
    - src/core/__tests__/extract-touches.test.ts
    - src/core/__tests__/feature-schema-since.test.ts
    - src/core/__tests__/feature-schema.test.ts
    - src/features/__tests__/feature-milestone.test.ts
    - src/features/__tests__/fill-links-code-gaps.test.ts
    - src/features/__tests__/migrate-features.test.ts
    - src/features/__tests__/validate-features.test.ts
    - src/garden/__tests__/graph-fd-lookup.test.ts
    - src/garden/__tests__/sdd-report.test.ts
    - src/release/__tests__/release-changelog.test.ts
    - src/release/__tests__/release-commits.test.ts
    - src/release/__tests__/release-fd-commits.test.ts
    - src/sync/__tests__/sync-spec-links.test.ts
    - src/sync/__tests__/sync-test-links.test.ts
  spec: lost-pre-extraction
introduced: 0.3.0
noldor-tier: full
updated: 0.4.0
---
## Summary

Cleans up the `links.*` fields on feature MDs so `pnpm sdd:report` produces actionable signal instead of 90+ lines of noise. Five coupled changes shipped:

1. **`links.prs` → `links.commits`** (12-char hex sha array). The PR field was always empty — we fast-forward worktree branches to `main` per CLAUDE.md "Finishing a worktree" and never open PRs. Schema renamed in [`src/features/feature-schema.ts`](../../src/features/feature-schema.ts), all 45 FD MDs migrated via [`src/features/migrate-features.ts`](../../src/features/migrate-features.ts), [`src/release/release-notes.ts`](../../src/release/release-notes.ts) + [`src/dashboard/views.ts`](../../src/dashboard/views.ts) render commit links with lazy `git show` for subjects, [`scripts/backfill-pr-links.ts`](../../scripts) retired.
2. **`links.code` heuristic backfill** via new [`src/features/fill-links-code-gaps.ts`](../../src/features/fill-links-code-gaps.ts). Hybrid resolver: path-only first (single-package candidate or slug-substring match), `claude -p` LLM-fallback for ambiguous multi-candidate cases. Batch dry-run UX writes proposal markdown for operator review; `--apply` writes `links.code` arrays via gray-matter with timestamped backup at `.cache/backfill-backups/`. Cross-area FDs are first-class — when an `apps/web/`-prefixed file is being attributed and the candidate FD's `area` isn't `web`/`viewport`/`ui` but its `packages` array contains `web`, the resolver still considers it (catches `export-import-charuy-file` style ownership where `area: format` but the user-facing surface is on web).
3. **SDD infra-file allowlist** in [`src/garden/sdd-report.ts`](../../src/garden/sdd-report.ts). Filters `*.config.{ts,js,mjs,cjs}`, `-env.d.ts`, `tsconfig*.json`, `lefthook.{yml,yaml}` from "code files not referenced" gap detection. The orphan detector also normalizes `links.code` directory entries (`packages/sample-scenes` covers every nested file regardless of depth, with or without trailing slash) so package-level attribution doesn't leak per-file orphans.
4. **`/promote` `attach:<parent>` mode** + CLAUDE.md complexity-gate fourth tier (in [`.claude/skills/promote/SKILL.md`](../../.claude/skills/promote/SKILL.md) and [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md)) + commit attribution in `pnpm release` via new [`src/release/release-commits.ts`](../../src/release/release-commits.ts). `attach:<parent>` lets small enhancements piggyback on an existing FD without scaffolding a sibling MD; release script walks `git log <last-tag>..HEAD` and appends each commit's 12-char sha to FDs whose `links.code` overlaps the touched files.
5. **`validatePackagesField` cross-check** in [`src/features/validate-features.ts`](../../src/features/validate-features.ts). Walks every `links.code` entry, extracts package names from `packages/<name>/*` paths, and compares against the FD's declared `packages` frontmatter (normalizing `@charuy/<name>`, `packages/<name>`, and `apps/<name>` to short form). Wired into `pnpm validate:features` so the pre-commit hook surfaces drift before it reaches the SDD orphan run.

Net effect: SDD "code files not referenced" gaps dropped from 98 → 12 after the first operator backfill run, then to 4 after the hardening pass that fixed the orphan-detector directory-walk bug, the resolver's cross-area blind spot, and three FDs whose `packages` field didn't reflect their `links.code`. Future commits are auto-attributed at release time.

## User Story

As a developer or agent shipping work on this codebase, I want `pnpm sdd:report` to surface only real gaps so that I can fix what actually needs fixing, instead of wading through 80+ stale entries from never-populated link arrays. As an operator deciding whether a small piece of work earns its own FD MD, I want `/promote` to suggest attaching to an existing parent FD when the work is enhancement-shaped, so that the feature index doesn't bloat with sub-features.

## Usage

**Operator / agent — backfill links.code gaps on demand:**

```bash
pnpm gaps:links-code --dry-run    # writes docs/.backfill-links-code.proposal.md
# review/edit the proposal
pnpm gaps:links-code --apply      # writes links.code on FD MDs, removes proposal
```

The proposal groups files by FD slug. Lines prefixed `#` are skipped on apply. The `## UNASSIGNED` section is for files the resolver couldn't confidently place — operator moves them under the right FD heading or leaves them flagged for the next SDD report.

**Automatic — `--auto-high` runs in pre-commit.** When any `docs/features/**/*.md` is staged, the lefthook chain runs `pnpm gaps:links-code --auto-high` followed by `pnpm sync:fd-resources`. The auto-high mode applies only deterministic single-match high-confidence assignments from `resolveByPath` (no LLM, no proposal file, no operator prompt). Ambiguous candidates are skipped silently and surface in `/garden` step 7.5 for interactive resolution. Net: new FDs get unambiguous code links populated automatically; remaining gaps stay visible.

**`/promote <slug>` attach mode** — when a backlog block carries `parent: <existing-fd-slug>` (or `/promote`'s LLM-judgment scan finds a strong match), the skill offers an attach option. Picking it removes the source block without scaffolding a new MD — the parent FD's `phase: in-progress` frontmatter is the canonical in-progress signal. At end of implementation, edit the parent FD's body inline + run `/draft-feature-md <parent-slug> --refresh`. (Before the 2026-05-13 restructure attach mode also wrote a `## Now` entry to the roadmap; the `## Now` / `## Next` / `## Later` section split was retired in `replace-roadmap-buckets-with-flat-priority-order` and the roadmap-side tracker went with it.)

**Commit attribution** — automatic during `pnpm release`. Reads `git log <last-tag>..HEAD`, attributes each commit to FDs by `links.code` overlap, appends 12-char sha to each match's `links.commits`. Release notes render commit links with subjects fetched lazily via `git show`.

**Release-notes Summary fallback** — `docs/release-notes.md` shows curated prose, never raw commit bullets. For `updated` features, the renderer prefers the per-version `## Changelog > ### <version> > #### Summary` block from the FD; if that's empty or still placeholder, it falls back to the FD's `## Summary` first paragraph. Commit hashes never appear in user-facing release notes — they live in git log + GitHub release pages.

<!-- generated: resources -->

## Resources

- **Spec:** _lost-pre-extraction_
- **Code:**
  - [`src/checks/check-feature-slug-scope.ts`](../../src/checks/check-feature-slug-scope.ts)
  - [`src/features/feature-schema.ts`](../../src/features/feature-schema.ts)
  - [`src/features/fill-links-code-gaps.ts`](../../src/features/fill-links-code-gaps.ts)
  - [`src/features/migrate-features.ts`](../../src/features/migrate-features.ts)
  - [`src/features/validate-features.ts`](../../src/features/validate-features.ts)
  - [`src/garden/sdd-report.ts`](../../src/garden/sdd-report.ts)
  - [`src/release/release-commits.ts`](../../src/release/release-commits.ts)
  - [`src/sync/sync-spec-links.ts`](../../src/sync/sync-spec-links.ts)
  - [`src/sync/sync-test-links.ts`](../../src/sync/sync-test-links.ts)
- **Tests:**
  - [`src/checks/__tests__/check-feature-slug-scope.test.ts`](../../src/checks/__tests__/check-feature-slug-scope.test.ts)
  - [`src/core/__tests__/extract-touches.test.ts`](../../src/core/__tests__/extract-touches.test.ts)
  - [`src/features/__tests__/feature-milestone.test.ts`](../../src/features/__tests__/feature-milestone.test.ts)
  - [`src/features/__tests__/feature-schema-since.test.ts`](../../src/features/__tests__/feature-schema-since.test.ts)
  - [`src/features/__tests__/feature-schema.test.ts`](../../src/features/__tests__/feature-schema.test.ts)
  - [`src/features/__tests__/fill-links-code-gaps.test.ts`](../../src/features/__tests__/fill-links-code-gaps.test.ts)
  - [`src/features/__tests__/migrate-features.test.ts`](../../src/features/__tests__/migrate-features.test.ts)
  - [`src/features/__tests__/validate-features.test.ts`](../../src/features/__tests__/validate-features.test.ts)
  - [`src/garden/__tests__/graph-fd-lookup.test.ts`](../../src/garden/__tests__/graph-fd-lookup.test.ts)
  - [`src/garden/__tests__/sdd-report.test.ts`](../../src/garden/__tests__/sdd-report.test.ts)
  - [`src/release/__tests__/release-changelog.test.ts`](../../src/release/__tests__/release-changelog.test.ts)
  - [`src/release/__tests__/release-commits.test.ts`](../../src/release/__tests__/release-commits.test.ts)
  - [`src/release/__tests__/release-fd-commits.test.ts`](../../src/release/__tests__/release-fd-commits.test.ts)
  - [`src/sync/__tests__/sync-spec-links.test.ts`](../../src/sync/__tests__/sync-spec-links.test.ts)
  - [`src/sync/__tests__/sync-test-links.test.ts`](../../src/sync/__tests__/sync-test-links.test.ts)

<!-- /generated: resources -->

## Changelog

### 0.4.0

#### Summary

Extended `gaps:links-code` walk and resolver to cover `scripts/`, dropped commits fallback in release-notes so the first paragraph of the FD `## Summary` is used instead, enforced phase/introduced/updated consistency, and split the FD Changelog into separate Summary and Commits sub-sections.

### in-progress

#### Summary

Closed three follow-up bugs surfaced by the 2026-05-22 audit of the FD `Touches:` leak. (1) `sync-fd-resources.ts:buildResourcesBlock` now renders `links.plan` (string or array) in section order Spec → Plan → Code → Tests → Docs. (2) `/promote` extracts the trailing `Touches: <paths>` clause from the source roadmap/backlog block, lifts the paths into `links.code`, and feeds the stripped body to the FD Summary template. (3) `feature-schema.ts` accepts `phase=in-progress + introduced` to honour the attach-revert lifecycle that `release-markers.ts:fillMarkers` already contracts to restore on the next release. The 5 historically-affected FDs were backfilled in the same change.
