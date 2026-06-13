---
noldor-page: script-catalog
introduced: 0.4.0
---

# Script Catalog

Noldor ships its implementation under `src/<group>/`, surfaced through the `noldor` CLI (`pnpm noldor <group> <subcommand>`) that backs the framework's pre-commit hooks, garden audits, and release pipeline. This page is the canonical reference — one section per command, grouped by concern. Source paths are cited per command. Flat `pnpm <alias>` forms shown below are consumer-defined conveniences; the framework only guarantees the `noldor` CLI.

> **Note.** Strict `validate:script-catalog` drift gate is not yet implemented; treat this page as advisory until it lands. Backlog entry tracks the gate parallel to `validate:skill-catalog`.

## Validation

### `validate:features`

- **Trigger:** `pnpm noldor validate features`. Runs in `pre-commit` (`validate.features` job).
- **Inputs:** every `docs/features/*.md` (frontmatter via gray-matter, body via raw read).
- **Outputs:** exit 0 when all FDs satisfy `FeatureFrontmatterSchema` (Zod) + cross-checks (`packages` matches `links.code`, `category` is one of `consumer.categories` in `.noldor/config.json`, `phase: in-progress` carries no `introduced`); also checks tier-vs-spec drift (`noldor-tier == full` but `links.spec` empty surfaces as a warning); exit 1 + per-file error list otherwise.
- **When to use:** automatically on every commit. Run by hand after bulk-editing FDs to fail fast before staging.
- **Source:** [`src/features/validate-features.ts`](../../src/features/validate-features.ts)

### `validate:feature-slug-scope`

- **Trigger:** `pnpm noldor validate feature-slug-scope <commit-msg-file>`. Runs in `commit-msg` (`feature-slug-scope` job).
- **Inputs:** commit message file path; `docs/features/*.md` filenames for the slug allowlist.
- **Outputs:** exit 0 when scope is empty, lacks `:`, or carries a known FD slug (`type(area:slug)`); exit 1 with the offending scope when the slug is unknown.
- **When to use:** automatic gate on every commit. Prevents typos from orphaning live commit attribution.
- **Source:** [`src/checks/check-feature-slug-scope.ts`](../../src/checks/check-feature-slug-scope.ts)

### `validate:noldor`

- **Trigger:** `pnpm noldor validate noldor`.
- **Inputs:** every `docs/noldor/*.md` (frontmatter only).
- **Outputs:** exit 0 when each non-`README.md` page carries a `noldor-page: <slug>` frontmatter matching its filename stem; exit 1 with mismatched files listed.
- **When to use:** ad hoc — confirms the framework page set is consistent. Not currently in `pre-commit`.
- **Source:** [`src/core/validate-noldor.ts`](../../src/core/validate-noldor.ts)

### `validate:noldor-scope`

- **Trigger:** `pnpm noldor validate noldor-scope <commit-msg-file>`. Runs in `commit-msg` (`noldor-scope` job).
- **Inputs:** commit message file path; staged file list (`git diff --cached --name-only`); `docs/noldor/*.md` slug set.
- **Outputs:** exit 0 unless the commit touches `docs/noldor/*.md` without a `noldor` or `noldor:<slug>` scope, where `<slug>` matches an existing page.
- **When to use:** automatic gate on every commit that touches framework pages.
- **Source:** [`src/core/validate-noldor-scope.ts`](../../src/core/validate-noldor-scope.ts)

### `validate:skill-catalog`

- **Trigger:** `pnpm noldor validate skill-catalog`.
- **Inputs:** `.claude/skills/*` filenames; [`docs/noldor/skill-catalog.md`](skill-catalog.md) `## /<slug>` headings.
- **Outputs:** exit 0 when every skill file maps 1:1 to a heading and vice versa; exit 1 with missing/orphan entries listed.
- **When to use:** automatic gate when skill source or the catalog page changes. See [`garden-and-drift.md`](garden-and-drift.md).
- **Source:** [`src/core/validate-skill-catalog.ts`](../../src/core/validate-skill-catalog.ts)

### `check:invariants`

- **Trigger:** `pnpm noldor checks invariants`. Runs in `pre-commit` (`validate.invariants` job).
- **Inputs:** rule definitions in `src/invariants/`.
- **Outputs:** exit 0 when every invariant passes (rule conflicts, keyboard-binding collisions, public-API tsdoc coverage, package boundaries); exit 1 with the violating rule named.
- **When to use:** automatic on every commit. Fast (~1s).
- **Source:** [`src/checks/check-invariants.ts`](../../src/checks/check-invariants.ts)

### `check:shared-files`

- **Trigger:** `pnpm noldor checks shared-files`. Runs in `pre-commit` (`validate.shared-files` job).
- **Inputs:** staged file list; the cwd; the shared-root allowlist (`CLAUDE.md`, `.claude/engineering-rules.md`, `package.json`, `pnpm-lock.yaml`, `.claude/skills/**`, `.claude/commands/**`).
- **Outputs:** exit 0 from main worktree always; from a `.worktrees/*` tree, exit 1 listing shared files unless `NOLDOR_ALLOW_SHARED=1`.
- **When to use:** automatic. Forces shared-file edits onto main where they are visible to other worktrees.
- **Source:** [`src/checks/check-shared-files.ts`](../../src/checks/check-shared-files.ts)

### `check:template-sync`

- **Trigger:** `pnpm noldor checks template-sync [files…]`. Runs in both `pre-commit` (staged files) and `pre-push` (whole tree).
- **Inputs:** files Noldor ships from [`templates/`](../../templates/) into the consumer repo (e.g. `templates/.claude/engineering-rules.md`, `templates/lefthook/noldor.yml`) + their landed copies.
- **Outputs:** exit 0 when each templated file matches its `templates/` source; exit 1 listing files that have drifted. Keeps the baseline rules + hook config a consumer receives identical to the framework's tested copy.
- **When to use:** automatic on commit and push. See [`rules.md`](rules.md) § Template sync.
- **Source:** [`src/checks/check-template-sync.ts`](../../src/checks/check-template-sync.ts)

### Other validators

| Command                              | Source                                                            | Purpose                                                                    |
| ------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `pnpm noldor validate noldor-config` | [`src/validate/noldor-config.ts`](../../src/validate/noldor-config.ts) | Validate `.noldor/config.json` shape (categories, scanPaths, crLanes, …).  |
| `pnpm noldor validate milestones`    | [`src/milestones/validate-milestones.ts`](../../src/milestones/validate-milestones.ts) | Validate `docs/milestones/*.md` + vision's `current-milestone:` pointer.   |
| `pnpm noldor validate triage`        | [`src/triage/validate-triage.ts`](../../src/triage/validate-triage.ts) | Validate roadmap/backlog schema-C blocks.                                  |

## Gate hooks

These scripts implement the hook stack for the 6-path gate model. They run automatically via Lefthook; the `pnpm noldor hooks *` aliases let you invoke them directly for debugging.

### `hook:noldor:pre-commit`

- **Trigger:** `pnpm noldor hooks pre-commit`. Runs in `pre-commit` (`noldor-pre-commit` job).
- **Inputs:** `.noldor/session.json` (session marker); staged diff.
- **Outputs:** If session path is `micro-chore`, validates the staged diff matches the allowlist (`docs/**/*.md`, `.claude/**`, root `*.md`); rejects if any diff escapes. Other paths: no diff-level check at this stage. Rejects commits that lack a session marker when edits touch non-allowlisted files.
- **Source:** [`src/hooks/noldor-pre-commit.ts`](../../src/hooks/noldor-pre-commit.ts)

### `hook:noldor:inject-trailers`

- **Trigger:** `pnpm noldor hooks inject-trailers <commit-msg-file>`. Runs in `prepare-commit-msg` (`noldor-inject-trailers` job).
- **Inputs:** `.noldor/session.json`; commit message file path.
- **Outputs:** injects `Noldor-Path`, `Noldor-FD` (if applicable), and (post-review) `Noldor-Reviewed` into the commit message via `git interpret-trailers --in-place`. Authors don't hand-type trailers when going through `/gate`.
- **Source:** [`src/hooks/noldor-inject-trailers.ts`](../../src/hooks/noldor-inject-trailers.ts)

### `hook:noldor:validate-trailer`

- **Trigger:** `pnpm noldor hooks validate-trailer <commit-msg-file>`. Runs in `commit-msg` (`noldor-validate-trailer` job).
- **Inputs:** commit message file path.
- **Outputs:** parses trailers via `git interpret-trailers --parse`. Rejects the commit when a `Noldor-*` trailer-shaped line in the final paragraph is invisible to git (a value wrapped to an unindented continuation line invalidates the whole trailer block — keep values single-line or indent continuations). Validates schema and trailer-vs-FD consistency. Accepts `Noldor-Path-Override: <reason>` (logs to `.noldor/overrides.log`); accepts `Noldor-Path: release-automation` unconditionally; otherwise requires a valid path trailer + per-path checks (FD existence, tier match, review receipt, spec existence). Exit 1 on invalid.
- **Source:** [`src/hooks/noldor-validate-trailer.ts`](../../src/hooks/noldor-validate-trailer.ts)

### `hook:noldor:enforce-review-receipt`

- **Trigger:** `pnpm noldor hooks enforce-review-receipt`. Runs in `pre-push` (`noldor-enforce-review-receipt` job).
- **Inputs:** tip commit trailers; `git rev-parse HEAD^{tree}`.
- **Outputs:** for any tip commit on paths 2–6, validates `Noldor-Reviewed: <tree-hash>` equals `HEAD^{tree}`. Rejects the push when the tree hash mismatches (new code committed after the review receipt). Tip commits carrying `Noldor-Path-Override: <reason>` skip the check entirely (escape hatch wins over auto-injected `Noldor-Path`). Exit 1 with instructions to re-run review.
- **Source:** [`src/hooks/noldor-enforce-review-receipt.ts`](../../src/hooks/noldor-enforce-review-receipt.ts)

### `hook:noldor:pre-push`

- **Trigger:** `pnpm noldor hooks pre-push`. Runs in `pre-push` (`noldor-pre-push` job).
- **Inputs:** the push ref lines (stdin), remote name, env.
- **Outputs:** blocks any direct push to `origin/main` — all paths must land via PR through the gate end-of-flow. Bypass for the release script only via `NOLDOR_RELEASE_PUSH=1`. Exit 1 with PR-flow instructions otherwise.
- **Source:** [`src/hooks/noldor-pre-push.ts`](../../src/hooks/noldor-pre-push.ts)

### `hook:noldor:pre-edit-guard`

- **Trigger:** `pnpm noldor hooks pre-edit-guard`. Intended as a Claude Code **PreToolUse** guard (settings.json), not a git hook — it is **not** wired into `lefthook/noldor.yml`.
- **Inputs:** the rollout marker + `.noldor/session.json` + the target file path.
- **Outputs:** in soft mode (pre-rollout marker absent) it always passes; once the rollout marker exists, it blocks edits to tracked files unless a `/gate` session marker is present. Enforces "no edit without `/gate`".
- **Source:** [`src/hooks/noldor-pre-edit-guard.ts`](../../src/hooks/noldor-pre-edit-guard.ts)

## Sync (FD link populators)

### `sync:test-links`

- **Trigger:** `pnpm noldor sync test-links`. Runs in `pre-commit` (`sync.test-links` job, `glob: '**/*.test.ts'`).
- **Inputs:** every test file matching `**/*.{test,spec}.{ts,tsx}` under the configured `scanPaths`. Reads `// @tests: <slug>` directives.
- **Outputs:** writes `links.tests` arrays on the matching FD frontmatter. Stages modified FDs.
- **When to use:** automatic on test-file commits. Run manually after adding/moving tests so the FD index stays current.
- **Source:** [`src/sync/sync-test-links.ts`](../../src/sync/sync-test-links.ts)

### `sync:doc-links`

- **Trigger:** `pnpm noldor sync doc-links`. Runs in `pre-commit` (`sync.doc-links` job, `glob: 'docs/**/*.md'`).
- **Inputs:** every `docs/user/**/*.md`. Reads `<!-- @feature: <slug> -->` directives.
- **Outputs:** writes `links.docs` arrays on the matching FD frontmatter. Stages modified FDs.
- **When to use:** automatic on doc commits. Run manually when reorganising user docs.
- **Source:** [`src/sync/sync-doc-links.ts`](../../src/sync/sync-doc-links.ts)

### `sync:spec-links`

- **Trigger:** `pnpm noldor sync spec-links`. Runs in `pre-commit` (`sync.spec-links` job, `glob: 'docs/superpowers/specs/**/*.md'`).
- **Inputs:** every `docs/superpowers/specs/*.md`. Reads spec frontmatter.
- **Outputs:** writes `links.spec` on the matching FD frontmatter. Stages modified FDs.
- **When to use:** automatic on spec commits.
- **Source:** [`src/sync/sync-spec-links.ts`](../../src/sync/sync-spec-links.ts)

### `sync:fd-resources`

- **Trigger:** `pnpm noldor sync fd-resources`. Runs in `pre-commit` (`fd-resources` job, `glob: 'docs/features/**/*.md'`).
- **Inputs:** FD frontmatter `links.{code,docs,tests}` arrays + `links.spec` string. Reads filesystem to verify whether `links.spec` points at an existing file.
- **Outputs:** rewrites the FD body's auto-generated `<!-- generated: resources -->` Resources block in place. Additionally auto-rewrites `links.spec` to its `archive/` variant when the original spec file is missing on disk AND `<dirname>/archive/<basename>` exists (see [`resolveSpecPath`](../../src/sync/sync-fd-resources.ts)) — this closes the drift loop where `/garden`'s `git mv <spec> archive/` step used to leave FDs pointing at the old path. Stages modified FDs.
- **When to use:** automatic when an FD frontmatter changes or after `/garden` archives a spec. Run manually if the body's Resources block drifts from frontmatter or if a hand-run `git mv` archived a spec.
- **Source:** [`src/sync/sync-fd-resources.ts`](../../src/sync/sync-fd-resources.ts)

## Audit

### `garden:detect`

- **Trigger:** `pnpm noldor garden detect`. Backs the `/garden` skill. Accepts `--gate-compliance` flag.
- **Inputs:** `docs/features/*.md`, `docs/superpowers/{specs,plans}/*.md`, `docs/{roadmap,backlog,vision}.md`, `package.json` workspaces, `.noldor/overrides.log`, optionally `graphify-out/graph.json`.
- **Outputs:** JSON report with `category`, `itemId`, `message` per gap across the 19 numbered detectors (plus the 4 doc-maintenance signals when run via `/garden`). With `--gate-compliance`: runs the override-audit, tier-mismatch, allowlist-drift, trailer-scope-mismatch, plan-without-fd, and fd-without-plan detectors; exit 1 if any findings. See [`garden-and-drift.md`](garden-and-drift.md) for the full detector list.
- **When to use:** through `/garden` for interactive maintenance; `--gate-compliance` as a `pnpm release` precondition; ad hoc `--json` for scripted automation. See [`garden-and-drift.md`](garden-and-drift.md).
- **Source:** [`src/garden/garden-detect.ts`](../../src/garden/garden-detect.ts)

### `sdd:report`

- **Trigger:** `pnpm noldor garden sdd-report` (add `--json` for machine-readable output, `--release` to include the Gate compliance section). Regenerated by `pnpm release` precondition (which always passes `--release`).
- **Inputs:** same substrate as `garden:detect`, narrowed to the 14 SDD categories (slots 1-13 + 19).
- **Outputs:** writes `docs/sdd-report.md` (committed) plus stdout per-category counts. Gate compliance section (tier distribution, override usage, review-skip counter) is rendered **only with `--release`**, so routine ad-hoc runs don't pollute the committed markdown with per-commit counter drift.
- **When to use:** ad hoc to surface gaps; release script auto-runs it for trend visibility.
- **Source:** [`src/garden/sdd-report.ts`](../../src/garden/sdd-report.ts)

### `gaps:links-code`

- **Trigger:** `pnpm noldor features fill-links-code-gaps` with `--dry-run | --apply | --auto-high`. `--auto-high` runs in `pre-commit` (`code-links-auto-high` job).
- **Inputs:** code files under the configured `scanPaths`; existing FD `links.code`; an LLM (`claude -p`) for ambiguous resolutions in interactive mode.
- **Outputs:** `--dry-run` writes `docs/.backfill-links-code.proposal.md`; `--apply` mutates FD `links.code`; `--auto-high` applies only deterministic high-confidence single-match assignments and stages the FDs.
- **When to use:** automatic via the pre-commit gate. Interactive mode for the SDD "code files not referenced" detector via `/garden` step 7.5.
- **Source:** [`src/features/fill-links-code-gaps.ts`](../../src/features/fill-links-code-gaps.ts)

### `triage:list-untriaged`

- **Trigger:** `pnpm noldor triage list-untriaged`. Backs the `/triage` skill.
- **Inputs:** `ideas.md`. Reads top-level bullets and existing `[triaged …]` markers.
- **Outputs:** JSON of bullets without a triage marker.
- **When to use:** via `/triage`; ad hoc to count untagged items before deciding to run triage.
- **Source:** [`src/triage/triage-list-untriaged.ts`](../../src/triage/triage-list-untriaged.ts)

### `triage:score`

- **Trigger:** `pnpm noldor triage score`. Backs the `/triage` skill's scoring step.
- **Inputs:** a backlog/roadmap entry's effort / impact / confidence / dependency signals.
- **Outputs:** a numeric priority score used to order roadmap entries. See [`triage.md`](triage.md).
- **Source:** [`src/triage/score.ts`](../../src/triage/score.ts)

### `garden:receipt`

- **Trigger:** `pnpm noldor garden receipt`.
- **Inputs:** the current `/garden` pass result.
- **Outputs:** writes a garden receipt recording what the pass detected/actioned (audit trail for gardening runs).
- **Source:** [`src/garden/garden-receipt.ts`](../../src/garden/garden-receipt.ts)

## Rules

The engineering-rules cascade. Full model in [`rules.md`](rules.md).

### `rules:resolve` / `rules:list` / `rules:validate`

- **Trigger:** `pnpm noldor rules resolve --file <path> --stage <stage>` (JSON `{ injected, enforce }`); `pnpm noldor rules list` (tab-separated rule table); `pnpm noldor rules validate` (store integrity gate).
- **Inputs:** the `.noldor/rules/<id>.md` store (frontmatter: `id`, `applies-to` globs, `stage`, `enforce`, `links`).
- **Outputs:** `resolve` returns the file/stage-scoped rules split into inject (advisory) and enforce buckets, ordered by glob specificity; `list` dumps the store; `validate` exits non-zero on schema / id-filename / parse errors.
- **When to use:** `validate` as the store integrity check; `resolve` to surface rules relevant to a given edit; `list` to inspect the store.
- **Source:** [`src/rules/cli-resolve.ts`](../../src/rules/cli-resolve.ts), [`src/rules/cli-list.ts`](../../src/rules/cli-list.ts), [`src/rules/cli-validate.ts`](../../src/rules/cli-validate.ts)

## Code review (CR)

Subagent / codex / standalone review lane orchestration. Full pipeline in [`cr-pipeline.md`](cr-pipeline.md).

### `cr:orchestrate` / `cr:aggregate` / `cr:codex` / `cr:escalate`

- **Trigger:** `pnpm noldor cr orchestrate --slug <slug> --artifact <path> --kind <spec\|plan\|code> --lanes <list>` (run lanes for an artifact); `pnpm noldor cr aggregate --slug <slug> [--kind <kind>] [--wait-ms <n>]` (collapse lane sinks into one verdict); `pnpm noldor cr codex` (codex second-opinion pass); `pnpm noldor cr escalate --slug <slug> --reason <cr-red\|test-red> --context-file <path>` (escalation dialog on red).
- **Inputs:** the artifact diff/file, lane config (`crLanes.<kind>` in `.noldor/config.json`), per-lane sinks at `.noldor/cr/<slug>-<kind>-<lane>.json`.
- **Outputs:** lane sinks + an aggregate verdict (exit 0 clean / exit 1 blockers). `escalate` drives retry / spawn-deep-review / override / abort. Driven by `/gate` Step 2.5 + Step 4.
- **Source:** [`src/cr/orchestrate.ts`](../../src/cr/orchestrate.ts), [`src/cr/aggregate-cli.ts`](../../src/cr/aggregate-cli.ts), [`src/cr/codex.ts`](../../src/cr/codex.ts), [`src/cr/escalate-cli.ts`](../../src/cr/escalate-cli.ts)

## Worktree

### `worktree:status`

- **Trigger:** `pnpm noldor worktrees status` from any tree.
- **Inputs:** `git worktree list`, per-tree `.env.local` ports, ahead/behind counts vs main, dirty file list, last-commit metadata.
- **Outputs:** stdout table (path, branch, port, ahead/behind, dirty, last commit) + warnings (cap exceeded, drift > 12, stale dirty changes, file overlap across trees).
- **When to use:** start of session, before kicking off another parallel worktree, before `pnpm noldor worktrees launch`.
- **Source:** [`src/worktrees/worktree-status.ts`](../../src/worktrees/worktree-status.ts)

### `worktree:conflicts`

- **Trigger:** `pnpm noldor worktrees conflicts` from any tree.
- **Inputs:** `git worktree list`, per-tree `git diff main...<branch> --name-only` touch sets, and (optional) `graphify-out/graph.json` for community membership.
- **Outputs:** stdout report of scored pairwise conflicts — `HARD` (two trees touch the same file → merge conflict) ranked above `soft` (two trees touch *different* files in the same graphify community → likely semantic interaction). Exits non-zero only on a HARD conflict. Falls back to direct-only scoring when the graph is absent.
- **When to use:** pre-flight before merging or rebasing parallel worktrees, when the inline overlap warning in `worktrees status` is too coarse (3+ active trees).
- **Source:** [`src/worktrees/worktree-conflicts.ts`](../../src/worktrees/worktree-conflicts.ts)

### `worktree:launch`

- **Trigger:** `pnpm noldor worktrees launch` from any tree.
- **Inputs:** non-main worktree list; the launch-prompt template at `.claude/launch-prompt.md`.
- **Outputs:** spawns one iTerm2 window per non-main worktree, each running `claude` with the templated initial prompt (substitutes `{{slug}}` / `{{branch}}` / `{{path}}`).
- **When to use:** when you have 2-3 unrelated features set up across worktrees and want one Claude session per tree. See [`worktree-discipline.md`](worktree-discipline.md).
- **Source:** [`src/worktrees/launch-worktrees.ts`](../../src/worktrees/launch-worktrees.ts)

## Release

### `release`

- **Trigger:** `pnpm release` — **explicit user confirmation only** (irreversible: pushes a `v*` tag and creates a public GitHub Release).
- **Inputs:** previous tag (`findPreviousTag`), new version (semver bump or operator-supplied), origin remote URL, commits since previous tag, `docs/features/*.md` for FD attribution, `graphify-out/graph.json` for freshness gating, the working tree (must be clean).
- **Outputs:** writes per-FD `### <version> > #### Summary` blocks (auto-polished via `claude -p`, see [`feature-md-schema.md`](feature-md-schema.md)); prepends a `## v<version>` block to `docs/release-notes.md`; writes a `## v<version>` `CHANGELOG.md` entry; bumps `package.json` versions; runs the release pipeline (build, tag, push, create GH Release).
- **When to use:** end of milestone or when a user explicitly confirms a release. The pre-release sweep (`/graphify` → `/refactor` → README check → `/graphify` again) is non-negotiable; see project root `CLAUDE.md`.
- **Source:** [`src/release/index.ts`](../../src/release/index.ts)

### `noldor:changelog`

- **Trigger:** `pnpm noldor changelog`.
- **Inputs:** git log filtered to commits whose scope is `noldor` or `noldor:<slug>`.
- **Outputs:** stdout markdown changelog, grouped by page.
- **When to use:** ad hoc to inspect framework-rule churn over a release window.
- **Source:** [`src/core/changelog.ts`](../../src/core/changelog.ts)

## Autonomous

| Command                         | Source                                                                 | Purpose                                                                          |
| ------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm noldor autonomous run`    | [`src/autonomous/queue-drain.ts`](../../src/autonomous/queue-drain.ts)   | One-shot queue drain (`--source roadmap\|plans`, `--max-features`, `--dry-run`).    |
| `pnpm noldor autonomous watch`  | [`src/autonomous/watch.ts`](../../src/autonomous/watch.ts)               | Continuous drain daemon; `--once` = cron mode, `--detach` = unattended. See [`autonomy.md`](autonomy.md).    |
| `pnpm noldor autonomous inbox`  | [`src/autonomous/inbox-cli.ts`](../../src/autonomous/inbox-cli.ts)       | List open escalations (parked slugs) with evidence + suggested action.              |
| `pnpm noldor autonomous unpark` | [`src/autonomous/unpark-cli.ts`](../../src/autonomous/unpark-cli.ts)     | Resolve an escalation: `unpark <slug> [--source <id>]`.                             |

## Utilities

Leaf commands (flags land directly after the group name, e.g. `pnpm noldor init --update`) and `noldor`-group helpers used by `/gate` and the skills.

| Command                                  | Source                                                          | Purpose                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm noldor next-priority`              | [`src/core/next-priority.ts`](../../src/core/next-priority.ts)   | Print the top roadmap priority. `--suggestions --json` powers `/gate` Step 0 pickup.          |
| `pnpm noldor pr-flow`                    | [`src/core/pr-flow-cli.ts`](../../src/core/pr-flow-cli.ts)       | Push + open PR + auto-merge + poll. `/gate` Step 4 end-of-flow. See [`pr-flow.md`](pr-flow.md). |
| `pnpm noldor init [--update\|--adopt]`   | [`src/cli/commands/init.ts`](../../src/cli/commands/init.ts)     | Scaffold framework files into a consumer repo.                                                 |
| `pnpm noldor doctor`                     | [`src/cli/commands/doctor.ts`](../../src/cli/commands/doctor.ts) | Diff consumer files against shipped `templates/`; non-zero exit on drift.                      |
| `pnpm noldor noldor bump-session-marker` | [`src/core/bump-session-marker.ts`](../../src/core/bump-session-marker.ts) | Bump the session marker `markerVersion`.                                                    |
| `pnpm noldor noldor set-autonomous`      | [`src/core/set-autonomous.ts`](../../src/core/set-autonomous.ts) | Set `session.autonomous = true` (autonomous gate mode).                                        |
| `pnpm noldor noldor lint-plan-snippets`  | [`src/core/lint-plan-snippets.ts`](../../src/core/lint-plan-snippets.ts) | Lint code snippets inside a plan MD (advisory; `/gate` Step 2.5).                           |
| `pnpm noldor noldor rename-plan-only-tier` | [`src/core/rename-plan-only-tier.ts`](../../src/core/rename-plan-only-tier.ts) | One-off: rename legacy `plan-only` tier docs to `specs-only`.                              |

## Docs build

### `docs:api`

- **Trigger:** `pnpm noldor docs api`. Part of `pnpm docs:build`.
- **Inputs:** TypeScript public API surface declared in the consumer's public API surface.
- **Outputs:** writes `docs/user/reference/api/` typedoc HTML + markdown.
- **When to use:** before `pnpm noldor docs check`; usually via `pnpm docs:build`.
- **Source:** [`src/docs/docs-api.ts`](../../src/docs/docs-api.ts)

### `docs:howto`

- **Trigger:** `pnpm noldor docs howto`. Part of `pnpm docs:build`.
- **Inputs:** every `docs/user/how-to/*.md` (excluding the index itself).
- **Outputs:** rewrites `docs/user/how-to/index.md` as a generated table of contents with feature-MD cross-links.
- **When to use:** when how-to entries change; usually via `pnpm docs:build`.
- **Source:** [`src/docs/docs-howto.ts`](../../src/docs/docs-howto.ts)

### `docs:transclude`

- **Trigger:** `pnpm noldor docs transclude`. Part of `pnpm docs:build`.
- **Inputs:** any `docs/**/*.md` carrying `<!-- transclude: <path> -->` markers.
- **Outputs:** rewrites the marker block with the transcluded source content.
- **When to use:** via `pnpm docs:build`. See [`doc-conventions.md`](doc-conventions.md).
- **Source:** [`src/docs/docs-transclude.ts`](../../src/docs/docs-transclude.ts)

### `docs:check`

- **Trigger:** `pnpm noldor docs check`. Part of `pnpm docs:build`.
- **Inputs:** the `docs/` tree post-build.
- **Outputs:** exit 0 when no broken transclusion, no orphaned `@feature:`/`@tests:` tags, no dangling links; exit 1 with the offence listed.
- **When to use:** via `pnpm docs:build`; ad hoc before committing user-doc changes.
- **Source:** [`src/docs/docs-check.ts`](../../src/docs/docs-check.ts)

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
- **Source:** [`src/features/migrate-features.ts`](../../src/features/migrate-features.ts)

### `migrate:fd-commits-to-prs`

- **Trigger:** `pnpm noldor features migrate-fd-commits-to-prs`. One-shot.
- **Inputs:** FD changelog blocks carrying bare commit refs.
- **Outputs:** rewrites FD commit references to PR references (post PR-flow adoption). Idempotent.
- **Source:** [`src/features/migrate-fd-commits-to-prs.ts`](../../src/features/migrate-fd-commits-to-prs.ts)

## Dev surfaces

### `dashboard`

- **Trigger:** `pnpm dashboard`. Long-running watch server.
- **Inputs:** `docs/features/*.md`, `docs/roadmap.md`, `docs/backlog.md`, `git log` (per-FD scope filter), `graphify-out/graph.json` when present.
- **Outputs:** local HTTP server rendering FD pages, release-notes preview, per-feature live commit lists, untriaged-ideas count. Routes: `/features/<slug>`, `/release-notes`, `/`.
- **When to use:** local browsing of the framework state during dev. Not part of any hook or release pipeline.
- **Source:** [`src/dashboard/server.ts`](../../src/dashboard/server.ts)

### `toon`

- **Trigger:** `pnpm toon`.
- **Inputs:** `graphify-out/graph.json` (produced by `/graphify` skill).
- **Outputs:** stdout TOON-formatted graph view (compact textual graph for context-window inclusion).
- **When to use:** ad hoc when feeding the project graph to an agent. The `/graphify` skill itself is documented in [`skill-catalog.md`](skill-catalog.md); `src/graphify/` only hosts this post-processor.
- **Source:** [`src/graphify/graph-to-toon.ts`](../../src/graphify/graph-to-toon.ts)

### `metrics:compute`

- **Trigger:** `pnpm noldor metrics compute` (`--json <path>` to redirect the JSON artifact, `--metric <id>` to filter the stdout table).
- **Inputs:** git history (commits + trailers + tags), `docs/features/*.md` frontmatter, roadmap/backlog git history, `.noldor/cr/*.json`, `.noldor/agent-events.jsonl`, `.noldor/escalations.jsonl`, `.noldor/drain-state.json`.
- **Outputs:** stdout table (one block per metric with formula + blind spots) plus `metrics.json` (gitignored derived artifact). Exit 0 even with source warnings; exit 1 only on fatal (non-git cwd).
- **When to use:** ad hoc framework-effectiveness checks; the dashboard `/metrics` page and the sdd-report `## Metrics` section call the same `compute()`. Formulas documented in [`metrics.md`](metrics.md).
- **Source:** [`src/metrics/compute-cli.ts`](../../src/metrics/compute-cli.ts)

## Test fixtures (not pnpm scripts)

`src/fixtures/` is test data for the validator unit tests under `src/{features,docs,checks}/__tests__/` — sample valid and invalid FD frontmatters, doc tag fixtures, etc. Not invoked directly. Source-of-truth lookup point when extending validator coverage.

## Verify (local CI smoke)

### `verify`

- **Trigger:** `pnpm verify`. Consumer-defined composite local gate — noldor's own is `lint && fmt:check && typecheck && test`. A consumer adds whatever pre-push gate fits its stack.
- **Inputs:** the working tree.
- **Outputs:** non-zero on any failing step.
- **When to use:** local pre-push smoke; hooks already cover much of this on commit.
- **Source:** consumer `package.json` composite.
