---
noldor-page: versioning
introduced: 0.4.0
---

# Versioning

The consumer repo follows [semantic versioning](https://semver.org/). Every
package listed in the consumer config's `lockstepPackages` (plus the app, if
any) ships in **lockstep** — a single version advances every release. A
single-package repo simply lists one package; a monorepo lists several.

## Conventional Commits → bump level

Bump level is auto-derived by `pnpm release` from commit subjects and bodies
since the previous `v*` tag.

| Commit marker                                                                       | Bump                  |
| ----------------------------------------------------------------------------------- | --------------------- |
| `BREAKING CHANGE:` footer OR `type!:` prefix (e.g. `feat!:`)                        | major                 |
| `feat:` (without `!`)                                                               | minor                 |
| `fix:`, `refactor:`, `chore:`, `docs:`, `perf:`, `test:`, `style:`, `ci:`, `build:` | patch                 |
| No commits since previous tag                                                       | `pnpm release` aborts |

Breaking API changes MUST use `!` or a `BREAKING CHANGE:` footer. Never hide
a breaking change inside a regular `feat:` or `fix:`.

## Pre-release sweep — mandatory

Before invoking `pnpm release` for any minor or major bump, run
[`/noldor-release-sweep`](../../.claude/skills/noldor-release-sweep/SKILL.md). The sweep:

1. `/graphify` + `pnpm toon` — fresh structural snapshot of the codebase.
2. `/noldor-refactor` against the new `GRAPH_REPORT.md` — fix god nodes,
   low-cohesion communities, dead exports flagged by the audit.
3. README drift check.
4. `/graphify` + `pnpm toon` again — capture the post-refactor graph.
5. **Drift pre-empt** (step 5.5) — `pnpm docs:build` + `pnpm noldor garden sdd-report --release`. Commit any drift on the sweep branch. The release script's existing dirty-tree checks (`src/release/index.ts:132-138` and `:140-146`) then no-op when the sweep already committed the regen output. See [release-sweep-process-hardening](../features/release-sweep-process-hardening.md) §3.1.
6. Single `chore(release): pre-release graphify + refactor sweep` commit (plus any drift-pre-empt commits from step 5).
7. `pnpm verify` final gate, then explicit `release now` confirmation.

The sweep is the structural counterpart to `pnpm release`'s mechanical
checks — `pnpm release` verifies the tree is green and tag-able; the
sweep verifies the codebase is structurally healthy enough to tag. Patch
hotfixes where structural drift is impossible (one-line bug fixes) MAY
skip the sweep; minor and major bumps MUST NOT.

## Release flow

`pnpm release` orchestrates:

1. **Preconditions** — on `main`, clean tree, synced with `origin`, `gh` CLI
   available, graph fresh (`ensureGraphFresh` — **optional**: skipped when the
   consumer tracks no `graphify-out/graph.json`; otherwise the graph must
   postdate the latest commit under the configured `scanPaths`), garden fresh
   (`ensureGardenFresh` — `.noldor/garden-receipt` must postdate the latest
   commit under the configured `scanPaths`; stamped by `pnpm noldor garden
   receipt` at the end of every `/noldor-garden` flow). Bypass with
   `RELEASE_SKIP_GARDEN_GATE=1 pnpm release` for bootstrap commits that
   predate this gate's existence — same escape-hatch discipline as the
   other `RELEASE_SKIP_*` env vars. The following must pass:

   **Framework checks (always run, via the `noldor` CLI):**
   - `pnpm noldor garden detect --gate-compliance` — zero override-tier-mismatch
     findings required; aborts if any gate-compliance findings exist.
     Expected self-host override noise is declared per-entry in
     `garden.overrideAudit.expected` (`.noldor/config.json`) so it stops
     counting toward the override-audit WARN threshold — see
     [`cr-pipeline.md`](cr-pipeline.md). `RELEASE_SKIP_GATE_COMPLIANCE=1
     pnpm release` remains a logged break-glass hatch for findings that
     can't be fixed without rewriting public history, not the norm.
   - `pnpm noldor garden sdd-report --release` — and `docs/sdd-report.md` must have no
     resulting diff (un-committed report regen aborts). The `--release`
     flag includes the Gate compliance section (tier distribution,
     override usage, review-skip counter).
   - `pnpm noldor validate features`
   - `checkCrGate(prev-tag..HEAD)` — every code-touching commit must
     show review evidence: a `Noldor-Reviewed(-Subagent|-Codex)` receipt
     or a non-empty override trailer, scanned across the whole squash
     commit body. See [`cr-pipeline.md`](cr-pipeline.md). Individual
     receipt-less historical commits are acknowledged per-SHA in
     `release.crGateExemptCommits` (`.noldor/config.json`) with a
     required reason, instead of skipping the whole check.
     `RELEASE_SKIP_CR_GATE=1 pnpm release` remains a logged break-glass
     hatch (e.g. a transition release where the CR pipeline itself was
     added mid-cycle). Same escape-hatch discipline as
     `RELEASE_SKIP_GATE_COMPLIANCE`; all three skips — the garden gate
     included — append a `(release)`-tagged line to
     `.noldor/overrides.log`.

   **Consumer quality gates (run only if declared in the consumer's
   `package.json`; a repo without one skips it loudly):** `pnpm typecheck`,
   `pnpm test`, `pnpm test:smoke`, `pnpm test:e2e`, `pnpm build`, and
   `pnpm docs:build` (when present, `docs/user/` must have no resulting diff —
   un-committed regenerated docs abort). This is what keeps the pipeline
   portable: a single-package repo with only `typecheck`/`test`/`build` runs
   exactly those; a monorepo that defines smoke/e2e/docs:build runs them too.
2. **Derive new version** — find previous `v*` tag, scan commits, apply bump.
3. **Generate per-FD changelogs.** For each FD with at least one
   `<package>:<slug>` (or `Noldor-FD:` trailer) commit in the release
   range, render a block under the FD's `## Changelog`:
   - `phase: done` + `introduced` unset → `### Initial Release (v<newVersion>)`
     block covering ALL slug-matching PRs since FD inception (first
     `(#N)`-tagged commit; falls back to repo-start if no PR refs exist).
     This is the only heading that includes the `v` prefix.
   - `phase: in-progress` → `### <newVersion> (in-progress)` block covering
     `prevTag..HEAD` PRs.
   - `phase: done` + `introduced` set (maintenance / enhancement) →
     `### <newVersion>` block (no suffix) covering `prevTag..HEAD` PRs.
   - `phase: proposed` → skipped.
     Block contents: `#### Summary` (LLM-polished prose from filtered commit
     subjects) + optional `#### PRs` (bullet list of `(#N)`-attached commits;
     omitted when no commits carry PR refs).
4. **Set release markers.** Run `fillMarkers` over each FD with four
   mutually-exclusive cases:
   - `phase: done` + `introduced` unset → set `introduced = newVersion`.
   - `phase: in-progress` + `introduced` set + had changelog block →
     auto-restore `phase: done` + set `updated = newVersion`
     (enhancement-cycle restore — completes the asymmetric phase-revert
     state machine driven from `/noldor-gate`; see
     `docs/superpowers/specs/2026-05-15-framework-pr-flow-agent-auto-merge-changelog-pr-flow-integration-design.md` §3).
   - `phase: done` + `introduced` set + `introduced !== newVersion` + had
     changelog block → set `updated = newVersion` (maintenance update;
     the guard prevents release-replay from re-writing `updated`).
   - Otherwise (fresh in-progress, done without block, release replay,
     proposed) → no-op.
5. **Bump all `package.json` files in lockstep.**
6. **Write `CHANGELOG.md` entry** — grouped by feat / fix / other.
7. **Write `docs/release-notes.md` entry** — per-feature Summary paragraphs
   from feature MDs where `introduced == newVersion` OR
   `updated == newVersion`.
8. **Commit + tag** `chore(release): v<newVersion>` + annotated `v<newVersion>`
   tag.
9. **Push + GitHub Release** — `git push --follow-tags` then
   `gh release create --latest`.

Preconditions failing aborts before any writes. A failed push or GitHub
Release creation leaves the local tag/commit in place; the error message
prints the one-line recovery command.

## Release-day operational traps

Hit repeatedly on live releases (v0.4.0–v0.5.1); each aborts `pnpm release`
until handled:

- **Clear the gate session marker BEFORE `pnpm release`.** Release refuses to
  start while `.noldor/session.json` exists — including the release-sweep's own
  marker. Delete it first (the sweep is merged by then; the marker's job is
  done), then run release.
- **`ensureCleanTreeOnMain` counts `??` untracked lines.** Stash or move
  uncommitted operator files (`ideas.md` edits, stray root MDs) before the run:
  `git stash push -u -- ideas.md`. Dry-run first with
  `NOLDOR_RELEASE_DRY_RUN=1` to surface every gate blocker without writing.
- **`introduced`-fill twin drift.** Release stamps `introduced: <v>` into
  `docs/noldor/*.md` pages but NOT their `templates/docs/noldor/` twins, and it
  refuses to fold template paths into the release commit. Pre-empt any unset
  pages in a separate PR that mirrors the fill onto BOTH copies.
- **sdd-report drift loop.** Each merged PR re-drifts `docs/sdd-report.md`;
  commit the substantive regen once (release-sweep path), after which the
  residual count-line-only diff is tolerated (`onlyReviewSkipCountChanged`)
  and folds into the release commit.
- **The final registry poll can 401/403 locally — AFTER tag+push+publish.** The
  local token usually lacks `read:packages`; the actual publish runs in CI.
  Confirm via `gh run list --workflow=publish.yml` (not the release exit code),
  then remove the leftover `.noldor/release-state.json`.

## Registry publishing

The framework package itself ships to **private GitHub Packages** as
`@davidzoufaly/noldor`. Every release tag `vX.Y.Z` maps 1:1 to version
`X.Y.Z`; `latest` is the only dist-tag pre-1.0. The publish executor is the
tag-triggered `.github/workflows/publish.yml` workflow, authed with the
built-in `GITHUB_TOKEN` (`packages: write`) — a scoped package defaults to
restricted access, so the readable `src/` in the tarball never lands on a
public registry. The local `pnpm release` pipeline only polls the registry
until the new version is visible, and the `.noldor/release-state.json` resume
token is cleared only after that (interruption → `pnpm release --resume`,
rung 7). That poll needs a `read:packages` token in the release environment to
see the private package; a 401 is surfaced as a missing-token error, not a
failed publish. Publishing is opt-in via `release.publish.enabled` in
`.noldor/config.json` (default `false`), so consumer repos running this same
vendored pipeline never touch the registry. Emergency hatch:
`pnpm noldor release publish --wait <version>` re-attaches to an in-flight
publish; `--local` publishes from a workstation (bypassing the workflow) and
logs to `.noldor/overrides.log`.

Consumer upgrade flow is unchanged: `pnpm up @davidzoufaly/noldor && pnpm
noldor doctor && pnpm noldor upgrade` (see
[Version-aware upgrade](#version-aware-upgrade)).

Packaging note: the published bin runs `src/` through tsx at runtime, so
`src` must stay in the package.json `files` whitelist — dropping it breaks
every registry install.

## Who owns `introduced` / `updated`?

The release script. Authors never set these fields manually. Normal flow:

- Ship a new feature → flip `phase: done` in the shipping commit, leave
  `introduced` absent.
- Modify a shipped feature → leave frontmatter alone.
- Next `pnpm release` fills `introduced` on pending-done MDs and `updated`
  on MDs that receive a changelog block (i.e. have at least one qualifying
  `<package>:<slug>` commit since the previous tag).

This keeps authoring simple — no predicting the next version number — and
gives the release script a single job.

## Version-aware upgrade

Each consumer records the framework version its tree was last migrated to in
`.noldor/config.json` `consumer.frameworkVersion` — written by `noldor init`
(fresh scaffold = current) and `noldor upgrade` (after a migration chain).

`noldor upgrade` resolves the ordered chain from the anchored version to the
installed framework version (`src/migrations/<version>.ts` modules) and runs
each migration as a pure file transform:

- `noldor upgrade --dry-run` prints per-step diffs and touches nothing.
- `noldor upgrade` applies the chain and advances the anchor **only after the
  full chain succeeds**. It refuses on a dirty git tree (use a fresh branch).
- Re-running is a no-op once the anchor equals the installed version.
- `noldor upgrade --from <version>` bootstraps a tree scaffolded before the
  anchor existed.

**Downgrade is unsupported** — `installed < anchored` errors out. Reverting
framework versions is a git operation, not a codemod concern.

**Authoring discipline:** a PR that edits a consumer-facing schema surface
(`src/core/consumer-config.ts`, `docs/noldor/feature-md-schema.md`) MUST ship a
matching version-named `src/migrations/<x.y.z>.ts` in the same PR, or
`pnpm noldor garden detect` flags `schema-changed-without-migration`.

## Extension points (deferred)

**Prerelease channels** (`0.2.0-beta.1`, `-rc.1`) — not implemented. When
added, `pnpm release --prerelease <tag>` will compute the next bump and
append `-<tag>.<N>`. GitHub Release created with `--prerelease` flag instead
of `--latest`.

**Feature-flag-aware release notes.** When feature flags arrive, feature MD
frontmatter will gain:

- `flag: <flag-name>` — optional gating flag
- `flag-default: off | on` — default state at the release
- `ga-in: <version>` — release where the flag was removed or defaulted on

Release notes will then render two events per flag-gated feature: introduced
(code shipped, flag-state noted) and GA (flag lifted). The semantic anchor
is fixed now: **`phase: done` means code shipped in a release, regardless of
flag state.** Users experience the feature only when `ga-in` is set.
