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
    - scripts/checks/check-feature-slug-scope.ts
    - scripts/features/feature-schema.ts
    - scripts/features/fill-links-code-gaps.ts
    - scripts/features/migrate-features.ts
    - scripts/features/validate-features.ts
    - scripts/garden/sdd-report.ts
    - scripts/release/release-commits.ts
    - scripts/sync/sync-spec-links.ts
    - scripts/sync/sync-test-links.ts
  tests:
    - packages/noldor/src/checks/__tests__/check-feature-slug-scope.test.ts
    - packages/noldor/src/features/__tests__/feature-schema.test.ts
    - packages/noldor/src/features/__tests__/fill-links-code-gaps.test.ts
    - packages/noldor/src/features/__tests__/migrate-features.test.ts
    - packages/noldor/src/features/__tests__/validate-features.test.ts
    - packages/noldor/src/garden/__tests__/sdd-report.test.ts
    - packages/noldor/src/core/__tests__/extract-touches.test.ts
    - packages/noldor/src/release/__tests__/release-fd-commits.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-05-05-feature-md-links-overhaul-design.md
introduced: 0.3.0
noldor-tier: full
updated: 0.4.0
---

## Summary

Cleans up the `links.*` fields on feature MDs so `pnpm sdd:report` produces actionable signal instead of 90+ lines of noise. Five coupled changes shipped:

1. **`links.prs` → `links.commits`** (12-char hex sha array). The PR field was always empty — we fast-forward worktree branches to `main` per CLAUDE.md "Finishing a worktree" and never open PRs. Schema renamed in [`scripts/features/feature-schema.ts`](../../scripts/features/feature-schema.ts), all 45 FD MDs migrated via [`scripts/features/migrate-features.ts`](../../scripts/features/migrate-features.ts), [`scripts/release/release-notes.ts`](../../scripts/release/release-notes.ts) + [`scripts/dashboard/views.ts`](../../scripts/dashboard/views.ts) render commit links with lazy `git show` for subjects, [`scripts/backfill-pr-links.ts`](../../scripts) retired.
2. **`links.code` heuristic backfill** via new [`scripts/features/fill-links-code-gaps.ts`](../../scripts/features/fill-links-code-gaps.ts). Hybrid resolver: path-only first (single-package candidate or slug-substring match), `claude -p` LLM-fallback for ambiguous multi-candidate cases. Batch dry-run UX writes proposal markdown for operator review; `--apply` writes `links.code` arrays via gray-matter with timestamped backup at `.cache/backfill-backups/`. Cross-area FDs are first-class — when an `apps/web/`-prefixed file is being attributed and the candidate FD's `area` isn't `web`/`viewport`/`ui` but its `packages` array contains `web`, the resolver still considers it (catches `export-import-charuy-file` style ownership where `area: format` but the user-facing surface is on web).
3. **SDD infra-file allowlist** in [`scripts/garden/sdd-report.ts`](../../scripts/garden/sdd-report.ts). Filters `*.config.{ts,js,mjs,cjs}`, `-env.d.ts`, `tsconfig*.json`, `lefthook.{yml,yaml}` from "code files not referenced" gap detection. The orphan detector also normalizes `links.code` directory entries (`packages/sample-scenes` covers every nested file regardless of depth, with or without trailing slash) so package-level attribution doesn't leak per-file orphans.
4. **`/promote` `attach:<parent>` mode** + CLAUDE.md complexity-gate fourth tier (in [`.claude/skills/promote/SKILL.md`](../../.claude/skills/promote/SKILL.md) and [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md)) + commit attribution in `pnpm release` via new [`scripts/release/release-commits.ts`](../../scripts/release/release-commits.ts). `attach:<parent>` lets small enhancements piggyback on an existing FD without scaffolding a sibling MD; release script walks `git log <last-tag>..HEAD` and appends each commit's 12-char sha to FDs whose `links.code` overlaps the touched files.
5. **`validatePackagesField` cross-check** in [`scripts/features/validate-features.ts`](../../scripts/features/validate-features.ts). Walks every `links.code` entry, extracts package names from `packages/<name>/*` paths, and compares against the FD's declared `packages` frontmatter (normalizing `@charuy/<name>`, `packages/<name>`, and `apps/<name>` to short form). Wired into `pnpm validate:features` so the pre-commit hook surfaces drift before it reaches the SDD orphan run.

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

- **Spec:** [`docs/superpowers/specs/archive/2026-05-05-feature-md-links-overhaul-design.md`](../../docs/superpowers/specs/archive/2026-05-05-feature-md-links-overhaul-design.md)
- **Code:**
  - [`scripts/checks/check-feature-slug-scope.ts`](../../scripts/checks/check-feature-slug-scope.ts)
  - [`scripts/features/feature-schema.ts`](../../scripts/features/feature-schema.ts)
  - [`scripts/features/fill-links-code-gaps.ts`](../../scripts/features/fill-links-code-gaps.ts)
  - [`scripts/features/migrate-features.ts`](../../scripts/features/migrate-features.ts)
  - [`scripts/features/validate-features.ts`](../../scripts/features/validate-features.ts)
  - [`scripts/garden/sdd-report.ts`](../../scripts/garden/sdd-report.ts)
  - [`scripts/release/release-commits.ts`](../../scripts/release/release-commits.ts)
  - [`scripts/sync/sync-spec-links.ts`](../../scripts/sync/sync-spec-links.ts)
  - [`scripts/sync/sync-test-links.ts`](../../scripts/sync/sync-test-links.ts)
- **Tests:**
  - [`scripts/checks/__tests__/check-feature-slug-scope.test.ts`](../../scripts/checks/__tests__/check-feature-slug-scope.test.ts)
  - [`scripts/features/__tests__/feature-schema.test.ts`](../../scripts/features/__tests__/feature-schema.test.ts)
  - [`scripts/features/__tests__/fill-links-code-gaps.test.ts`](../../scripts/features/__tests__/fill-links-code-gaps.test.ts)
  - [`scripts/features/__tests__/migrate-features.test.ts`](../../scripts/features/__tests__/migrate-features.test.ts)
  - [`scripts/features/__tests__/validate-features.test.ts`](../../scripts/features/__tests__/validate-features.test.ts)
  - [`scripts/garden/__tests__/sdd-report.test.ts`](../../scripts/garden/__tests__/sdd-report.test.ts)
  - [`scripts/noldor/__tests__/extract-touches.test.ts`](../../scripts/noldor/__tests__/extract-touches.test.ts)
  - [`scripts/release/__tests__/release-fd-commits.test.ts`](../../scripts/release/__tests__/release-fd-commits.test.ts)

<!-- /generated: resources -->

## Changelog

### 0.4.0

#### Summary

Extended `gaps:links-code` walk and resolver to cover `scripts/`, dropped commits fallback in release-notes so the first paragraph of the FD `## Summary` is used instead, enforced phase/introduced/updated consistency, and split the FD Changelog into separate Summary and Commits sub-sections.

### in-progress

#### Summary

Closed three follow-up bugs surfaced by the 2026-05-22 audit of the FD `Touches:` leak. (1) `sync-fd-resources.ts:buildResourcesBlock` now renders `links.plan` (string or array) in section order Spec → Plan → Code → Tests → Docs. (2) `/promote` extracts the trailing `Touches: <paths>` clause from the source roadmap/backlog block, lifts the paths into `links.code`, and feeds the stripped body to the FD Summary template. (3) `feature-schema.ts` accepts `phase=in-progress + introduced` to honour the attach-revert lifecycle that `release-markers.ts:fillMarkers` already contracts to restore on the next release. The 5 historically-affected FDs were backfilled in the same change.
