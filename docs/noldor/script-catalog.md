---
noldor-page: script-catalog
introduced: 0.4.0
---

# Script Catalog

Noldor ships a `scripts/` tree of pnpm-invocable utilities that back the framework's pre-commit hooks, garden audits, and release pipeline. This page is the canonical reference — one section per pnpm script, grouped by concern. Source lives under `scripts/<group>/` (paths cited per script).

> **Note.** Strict `validate:script-catalog` drift gate is not yet implemented; treat this page as advisory until it lands. Backlog entry tracks the gate parallel to `validate:skill-catalog`.

## Validation

### `validate:features`

- **Trigger:** `pnpm noldor validate features`. Runs in `pre-commit` (`validate.features` job).
- **Inputs:** every `docs/features/*.md` (frontmatter via gray-matter, body via raw read).
- **Outputs:** exit 0 when all FDs satisfy `FeatureFrontmatterSchema` (Zod) + cross-checks (`packages` matches `links.code`, `category` is in the canonical enum, `phase: in-progress` carries no `introduced`); also checks tier-vs-spec drift (`noldor-tier == full` but `links.spec` empty surfaces as a warning); exit 1 + per-file error list otherwise.
- **When to use:** automatically on every commit. Run by hand after bulk-editing FDs to fail fast before staging.
- **Source:** [`scripts/features/validate-features.ts`](../../scripts/features/validate-features.ts)

### `validate:feature-slug-scope`

- **Trigger:** `pnpm noldor validate feature-slug-scope <commit-msg-file>`. Runs in `commit-msg` (`feature-slug-scope` job).
- **Inputs:** commit message file path; `docs/features/*.md` filenames for the slug allowlist.
- **Outputs:** exit 0 when scope is empty, lacks `:`, or carries a known FD slug (`type(area:slug)`); exit 1 with the offending scope when the slug is unknown.
- **When to use:** automatic gate on every commit. Prevents typos from orphaning live commit attribution.
- **Source:** [`scripts/checks/check-feature-slug-scope.ts`](../../scripts/checks/check-feature-slug-scope.ts)

### `validate:noldor`

- **Trigger:** `pnpm noldor validate noldor`.
- **Inputs:** every `docs/noldor/*.md` (frontmatter only).
- **Outputs:** exit 0 when each non-`README.md` page carries a `noldor-page: <slug>` frontmatter matching its filename stem; exit 1 with mismatched files listed.
- **When to use:** ad hoc — confirms the framework page set is consistent. Not currently in `pre-commit`.
- **Source:** [`scripts/noldor/validate-noldor.ts`](../../scripts/noldor/validate-noldor.ts)

### `validate:noldor-scope`

- **Trigger:** `pnpm noldor validate noldor-scope <commit-msg-file>`. Runs in `commit-msg` (`noldor-scope` job).
- **Inputs:** commit message file path; staged file list (`git diff --cached --name-only`); `docs/noldor/*.md` slug set.
- **Outputs:** exit 0 unless the commit touches `docs/noldor/*.md` without a `noldor` or `noldor:<slug>` scope, where `<slug>` matches an existing page.
- **When to use:** automatic gate on every commit that touches framework pages.
- **Source:** [`scripts/noldor/validate-noldor-scope.ts`](../../scripts/noldor/validate-noldor-scope.ts)

### `validate:skill-catalog`

- **Trigger:** `pnpm noldor validate skill-catalog`.
- **Inputs:** `.claude/skills/*` filenames; [`docs/noldor/skill-catalog.md`](skill-catalog.md) `## /<slug>` headings.
- **Outputs:** exit 0 when every skill file maps 1:1 to a heading and vice versa; exit 1 with missing/orphan entries listed.
- **When to use:** automatic gate when skill source or the catalog page changes. See [`garden-and-drift.md`](garden-and-drift.md) Detector 16.
- **Source:** [`scripts/noldor/validate-skill-catalog.ts`](../../scripts/noldor/validate-skill-catalog.ts)

### `check:invariants`

- **Trigger:** `pnpm noldor checks invariants`. Runs in `pre-commit` (`validate.invariants` job).
- **Inputs:** rule definitions in `scripts/invariants/`.
- **Outputs:** exit 0 when every invariant passes (rule conflicts, keyboard-binding collisions, public-API tsdoc coverage, package boundaries); exit 1 with the violating rule named.
- **When to use:** automatic on every commit. Fast (~1s).
- **Source:** [`scripts/checks/check-invariants.ts`](../../scripts/checks/check-invariants.ts)

### `check:shared-files`

- **Trigger:** `pnpm noldor checks shared-files`. Runs in `pre-commit` (`validate.shared-files` job).
- **Inputs:** staged file list; the cwd; the shared-root allowlist (`CLAUDE.md`, `.claude/engineering-rules.md`, `package.json`, `pnpm-lock.yaml`, `.claude/skills/**`, `.claude/commands/**`).
- **Outputs:** exit 0 from main worktree always; from a `.worktrees/*` tree, exit 1 listing shared files unless `CHARUY_ALLOW_SHARED=1`.
- **When to use:** automatic. Forces shared-file edits onto main where they are visible to other worktrees.
- **Source:** [`scripts/checks/check-shared-files.ts`](../../scripts/checks/check-shared-files.ts)

## Gate hooks

These four scripts implement the 4-stage hook stack for the 6-path gate model. They run automatically via Lefthook; the `pnpm noldor hooks *` aliases let you invoke them directly for debugging.

### `hook:noldor:pre-commit`

- **Trigger:** `pnpm noldor hooks pre-commit`. Runs in `pre-commit` (`noldor-pre-commit` job).
- **Inputs:** `.noldor/session.json` (session marker); staged diff.
- **Outputs:** If session path is `micro-chore`, validates the staged diff matches the allowlist (`docs/**/*.md`, `.claude/**`, root `*.md`); rejects if any diff escapes. Other paths: no diff-level check at this stage. Rejects commits that lack a session marker when edits touch non-allowlisted files.
- **Source:** [`scripts/hooks/noldor-pre-commit.ts`](../../scripts/hooks/noldor-pre-commit.ts)

### `hook:noldor:inject-trailers`

- **Trigger:** `pnpm noldor hooks inject-trailers <commit-msg-file>`. Runs in `prepare-commit-msg` (`noldor-inject-trailers` job).
- **Inputs:** `.noldor/session.json`; commit message file path.
- **Outputs:** injects `Noldor-Path`, `Noldor-FD` (if applicable), and (post-review) `Noldor-Reviewed` into the commit message via `git interpret-trailers --in-place`. Authors don't hand-type trailers when going through `/gate`.
- **Source:** [`scripts/hooks/noldor-inject-trailers.ts`](../../scripts/hooks/noldor-inject-trailers.ts)

### `hook:noldor:validate-trailer`

- **Trigger:** `pnpm noldor hooks validate-trailer <commit-msg-file>`. Runs in `commit-msg` (`noldor-validate-trailer` job).
- **Inputs:** commit message file path.
- **Outputs:** parses trailers via `git interpret-trailers --parse`. Validates schema and trailer-vs-FD consistency. Accepts `Noldor-Path-Override: <reason>` (logs to `.noldor/overrides.log`); accepts `Noldor-Path: release-automation` unconditionally; otherwise requires a valid path trailer + per-path checks (FD existence, tier match, review receipt, spec existence). Exit 1 on invalid.
- **Source:** [`scripts/hooks/noldor-validate-trailer.ts`](../../scripts/hooks/noldor-validate-trailer.ts)

### `hook:noldor:enforce-review-receipt`

- **Trigger:** `pnpm noldor hooks enforce-review-receipt`. Runs in `pre-push` (`noldor-enforce-review-receipt` job).
- **Inputs:** tip commit trailers; `git rev-parse HEAD^{tree}`.
- **Outputs:** for any tip commit on paths 2–6, validates `Noldor-Reviewed: <tree-hash>` equals `HEAD^{tree}`. Rejects the push when the tree hash mismatches (new code committed after the review receipt). Tip commits carrying `Noldor-Path-Override: <reason>` skip the check entirely (escape hatch wins over auto-injected `Noldor-Path`). Exit 1 with instructions to re-run review.
- **Source:** [`scripts/hooks/noldor-enforce-review-receipt.ts`](../../scripts/hooks/noldor-enforce-review-receipt.ts)

## Sync (FD link populators)

### `sync:test-links`

- **Trigger:** `pnpm noldor sync test-links`. Runs in `pre-commit` (`sync.test-links` job, `glob: '**/*.test.ts'`).
- **Inputs:** every test file matching `**/*.{test,spec}.{ts,tsx}` under `packages/`, `apps/`, `scripts/`. Reads `// @tests: <slug>` directives.
- **Outputs:** writes `links.tests` arrays on the matching FD frontmatter. Stages modified FDs.
- **When to use:** automatic on test-file commits. Run manually after adding/moving tests so the FD index stays current.
- **Source:** [`scripts/sync/sync-test-links.ts`](../../scripts/sync/sync-test-links.ts)

### `sync:doc-links`

- **Trigger:** `pnpm noldor sync doc-links`. Runs in `pre-commit` (`sync.doc-links` job, `glob: 'docs/**/*.md'`).
- **Inputs:** every `docs/user/**/*.md`. Reads `<!-- @feature: <slug> -->` directives.
- **Outputs:** writes `links.docs` arrays on the matching FD frontmatter. Stages modified FDs.
- **When to use:** automatic on doc commits. Run manually when reorganising user docs.
- **Source:** [`scripts/sync/sync-doc-links.ts`](../../scripts/sync/sync-doc-links.ts)

### `sync:spec-links`

- **Trigger:** `pnpm noldor sync spec-links`. Runs in `pre-commit` (`sync.spec-links` job, `glob: 'docs/superpowers/specs/**/*.md'`).
- **Inputs:** every `docs/superpowers/specs/*.md`. Reads spec frontmatter.
- **Outputs:** writes `links.spec` on the matching FD frontmatter. Stages modified FDs.
- **When to use:** automatic on spec commits.
- **Source:** [`scripts/sync/sync-spec-links.ts`](../../scripts/sync/sync-spec-links.ts)

### `sync:fd-resources`

- **Trigger:** `pnpm noldor sync fd-resources`. Runs in `pre-commit` (`fd-resources` job, `glob: 'docs/features/**/*.md'`).
- **Inputs:** FD frontmatter `links.{code,docs,tests}` arrays + `links.spec` string. Reads filesystem to verify whether `links.spec` points at an existing file.
- **Outputs:** rewrites the FD body's auto-generated `<!-- generated: resources -->` Resources block in place. Additionally auto-rewrites `links.spec` to its `archive/` variant when the original spec file is missing on disk AND `<dirname>/archive/<basename>` exists (see [`resolveSpecPath`](../../scripts/sync/sync-fd-resources.ts)) — this closes the drift loop where `/garden`'s `git mv <spec> archive/` step used to leave FDs pointing at the old path. Stages modified FDs.
- **When to use:** automatic when an FD frontmatter changes or after `/garden` archives a spec. Run manually if the body's Resources block drifts from frontmatter or if a hand-run `git mv` archived a spec.
- **Source:** [`scripts/sync/sync-fd-resources.ts`](../../scripts/sync/sync-fd-resources.ts)

## Audit

### `garden:detect`

- **Trigger:** `pnpm noldor garden detect`. Backs the `/garden` skill. Accepts `--gate-compliance` flag.
- **Inputs:** `docs/features/*.md`, `docs/superpowers/{specs,plans}/*.md`, `docs/{roadmap,backlog,vision}.md`, `package.json` workspaces, `.noldor/overrides.log`, optionally `graphify-out/graph.json`.
- **Outputs:** JSON report with `category`, `itemId`, `message` per gap across the 18 detectors (14 SDD — slots 1-13 + 19 — + 3 doc-maintenance + detectors 16–17). With `--gate-compliance`: runs the override-audit, tier-mismatch, allowlist-drift, trailer-scope-mismatch, plan-without-fd, and fd-without-plan detectors; exit 1 if any findings.
- **When to use:** through `/garden` for interactive maintenance; `--gate-compliance` as a `pnpm release` precondition; ad hoc `--json` for scripted automation. See [`garden-and-drift.md`](garden-and-drift.md).
- **Source:** [`scripts/garden/garden-detect.ts`](../../scripts/garden/garden-detect.ts)

### `sdd:report`

- **Trigger:** `pnpm noldor garden sdd-report` (add `--json` for machine-readable output, `--release` to include the Gate compliance section). Regenerated by `pnpm release` precondition (which always passes `--release`).
- **Inputs:** same substrate as `garden:detect`, narrowed to the 14 SDD categories (slots 1-13 + 19).
- **Outputs:** writes `docs/sdd-report.md` (committed) plus stdout per-category counts. Gate compliance section (tier distribution, override usage, review-skip counter) is rendered **only with `--release`**, so routine ad-hoc runs don't pollute the committed markdown with per-commit counter drift.
- **When to use:** ad hoc to surface gaps; release script auto-runs it for trend visibility.
- **Source:** [`scripts/garden/sdd-report.ts`](../../scripts/garden/sdd-report.ts)

### `gaps:links-code`

- **Trigger:** `pnpm noldor features fill-links-code-gaps` with `--dry-run | --apply | --auto-high`. `--auto-high` runs in `pre-commit` (`code-links-auto-high` job).
- **Inputs:** code files under `packages/`, `apps/`, `scripts/`; existing FD `links.code`; an LLM (`claude -p`) for ambiguous resolutions in interactive mode.
- **Outputs:** `--dry-run` writes `docs/.backfill-links-code.proposal.md`; `--apply` mutates FD `links.code`; `--auto-high` applies only deterministic high-confidence single-match assignments and stages the FDs.
- **When to use:** automatic via the pre-commit gate. Interactive mode for the SDD "code files not referenced" detector via `/garden` step 7.5.
- **Source:** [`scripts/features/fill-links-code-gaps.ts`](../../scripts/features/fill-links-code-gaps.ts)

### `triage:list-untriaged`

- **Trigger:** `pnpm noldor triage list-untriaged`. Backs the `/triage` skill.
- **Inputs:** `ideas.md`. Reads top-level bullets and existing `[triaged …]` markers.
- **Outputs:** JSON of bullets without a triage marker.
- **When to use:** via `/triage`; ad hoc to count untagged items before deciding to run triage.
- **Source:** [`scripts/triage/triage-list-untriaged.ts`](../../scripts/triage/triage-list-untriaged.ts)

## Worktree

### `worktree:status`

- **Trigger:** `pnpm noldor worktrees status` from any tree.
- **Inputs:** `git worktree list`, per-tree `.env.local` ports, ahead/behind counts vs main, dirty file list, last-commit metadata.
- **Outputs:** stdout table (path, branch, port, ahead/behind, dirty, last commit) + warnings (cap exceeded, drift > 12, stale dirty changes, file overlap across trees).
- **When to use:** start of session, before kicking off another parallel worktree, before `pnpm noldor worktrees launch`.
- **Source:** [`scripts/worktrees/worktree-status.ts`](../../scripts/worktrees/worktree-status.ts)

### `worktree:launch`

- **Trigger:** `pnpm noldor worktrees launch` from any tree.
- **Inputs:** non-main worktree list; the launch-prompt template at `.claude/launch-prompt.md`.
- **Outputs:** spawns one iTerm2 window per non-main worktree, each running `claude` with the templated initial prompt (substitutes `{{slug}}` / `{{branch}}` / `{{path}}`).
- **When to use:** when you have 2-3 unrelated features set up across worktrees and want one Claude session per tree. See [`worktree-discipline.md`](worktree-discipline.md).
- **Source:** [`scripts/worktrees/launch-worktrees.ts`](../../scripts/worktrees/launch-worktrees.ts)

## Release

### `release`

- **Trigger:** `pnpm release` — **explicit user confirmation only** (irreversible: pushes a `v*` tag and creates a public GitHub Release).
- **Inputs:** previous tag (`findPreviousTag`), new version (semver bump or operator-supplied), origin remote URL, commits since previous tag, `docs/features/*.md` for FD attribution, `graphify-out/graph.json` for freshness gating, the working tree (must be clean).
- **Outputs:** writes per-FD `### <version> > #### Summary` blocks (auto-polished via `claude -p`, see [`feature-md-schema.md`](feature-md-schema.md)); prepends a `## v<version>` block to `docs/release-notes.md`; writes a `## v<version>` `CHANGELOG.md` entry; bumps `package.json` versions; runs the release pipeline (build, tag, push, create GH Release).
- **When to use:** end of milestone or when a user explicitly confirms a release. The pre-release sweep (`/graphify` → `/refactor` → README check → `/graphify` again) is non-negotiable; see project root `CLAUDE.md`.
- **Source:** [`scripts/release/index.ts`](../../scripts/release/index.ts)

### `noldor:changelog`

- **Trigger:** `pnpm noldor changelog`.
- **Inputs:** git log filtered to commits whose scope is `noldor` or `noldor:<slug>`.
- **Outputs:** stdout markdown changelog, grouped by page.
- **When to use:** ad hoc to inspect framework-rule churn over a release window.
- **Source:** [`scripts/noldor/changelog.ts`](../../scripts/noldor/changelog.ts)

## Docs build

### `docs:api`

- **Trigger:** `pnpm noldor docs api`. Part of `pnpm docs:build`.
- **Inputs:** TypeScript public API surface declared in `apps/web/src/api/`.
- **Outputs:** writes `docs/user/reference/api/` typedoc HTML + markdown.
- **When to use:** before `pnpm noldor docs check`; usually via `pnpm docs:build`.
- **Source:** [`scripts/docs/docs-api.ts`](../../scripts/docs/docs-api.ts)

### `docs:howto`

- **Trigger:** `pnpm noldor docs howto`. Part of `pnpm docs:build`.
- **Inputs:** every `docs/user/how-to/*.md` (excluding the index itself).
- **Outputs:** rewrites `docs/user/how-to/index.md` as a generated table of contents with feature-MD cross-links.
- **When to use:** when how-to entries change; usually via `pnpm docs:build`.
- **Source:** [`scripts/docs/docs-howto.ts`](../../scripts/docs/docs-howto.ts)

### `docs:transclude`

- **Trigger:** `pnpm noldor docs transclude`. Part of `pnpm docs:build`.
- **Inputs:** any `docs/**/*.md` carrying `<!-- transclude: <path> -->` markers.
- **Outputs:** rewrites the marker block with the transcluded source content.
- **When to use:** via `pnpm docs:build`. See [`doc-conventions.md`](doc-conventions.md).
- **Source:** [`scripts/docs/docs-transclude.ts`](../../scripts/docs/docs-transclude.ts)

### `docs:check`

- **Trigger:** `pnpm noldor docs check`. Part of `pnpm docs:build`.
- **Inputs:** the `docs/` tree post-build.
- **Outputs:** exit 0 when no broken transclusion, no orphaned `@feature:`/`@tests:` tags, no dangling links; exit 1 with the offence listed.
- **When to use:** via `pnpm docs:build`; ad hoc before committing user-doc changes.
- **Source:** [`scripts/docs/docs-check.ts`](../../scripts/docs/docs-check.ts)

### `docs:build`

- **Trigger:** `pnpm docs:build`. Composite — runs `docs:api && docs:howto && docs:transclude && sync:doc-links && docs:check && fmt`.
- **Inputs:** the doc tree.
- **Outputs:** post-build doc tree + a clean `docs:check` pass.
- **When to use:** before any commit touching user docs.
- **Source:** see component scripts above.

## Migration

### `migrate:features`

- **Trigger:** `pnpm noldor features migrate-features`. One-shot. Accepts `--infer-tier` and `--dry-run` flags.
- **Inputs:** every `docs/features/*.md`.
- **Outputs:** rewrites FD frontmatter to the latest schema shape (legacy field renames, default-fill, ordering normalisation). With `--infer-tier`: backfills `noldor-tier` — assigns `full` when `links.spec` is present, `specs-only` otherwise. `--dry-run` shows proposed changes without writing.
- **When to use:** after a breaking schema change in `feature-schema.ts`. Run `--infer-tier` once at rollout time to backfill the tier field on existing FDs. Idempotent — safe to re-run.
- **Source:** [`scripts/features/migrate-features.ts`](../../scripts/features/migrate-features.ts)

## Dev surfaces

### `dashboard`

- **Trigger:** `pnpm dashboard`. Long-running watch server.
- **Inputs:** `docs/features/*.md`, `docs/roadmap.md`, `docs/backlog.md`, `git log` (per-FD scope filter), `graphify-out/graph.json` when present.
- **Outputs:** local HTTP server rendering FD pages, release-notes preview, per-feature live commit lists, untriaged-ideas count. Routes: `/features/<slug>`, `/release-notes`, `/`.
- **When to use:** local browsing of the framework state during dev. Not part of any hook or release pipeline.
- **Source:** [`scripts/dashboard/server.ts`](../../scripts/dashboard/server.ts)

### `build:samples`

- **Trigger:** `pnpm build:samples`. Runs in `pnpm verify`.
- **Inputs:** sample scene definitions under `scripts/samples/`.
- **Outputs:** writes pre-rendered sample scene assets (JSON + thumbnails) into `apps/web/public/samples/` for the web app's first-load demos.
- **When to use:** automatic via `pnpm verify` (pre-push); ad hoc after editing samples.
- **Source:** [`scripts/samples/build-samples.ts`](../../scripts/samples/build-samples.ts)

### `toon`

- **Trigger:** `pnpm toon`.
- **Inputs:** `graphify-out/graph.json` (produced by `/graphify` skill).
- **Outputs:** stdout TOON-formatted graph view (compact textual graph for context-window inclusion).
- **When to use:** ad hoc when feeding the project graph to an agent. The `/graphify` skill itself is documented in [`skill-catalog.md`](skill-catalog.md); `scripts/graphify/` only hosts this post-processor.
- **Source:** [`scripts/graphify/graph-to-toon.ts`](../../scripts/graphify/graph-to-toon.ts)

## Test fixtures (not pnpm scripts)

`scripts/fixtures/` is test data for the validator unit tests under `scripts/{features,docs,checks}/__tests__/` — sample valid and invalid FD frontmatters, doc tag fixtures, etc. Not invoked directly. Source-of-truth lookup point when extending validator coverage.

## Verify (local CI smoke)

### `verify`

- **Trigger:** `pnpm verify`. Composite: `lint && fmt:check && typecheck && build:samples && test`.
- **Inputs:** the working tree.
- **Outputs:** non-zero on any failing step.
- **When to use:** local pre-push smoke; hooks already cover much of this on commit.
- **Source:** package.json composite.
