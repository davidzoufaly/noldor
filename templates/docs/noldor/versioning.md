---
noldor-page: versioning
introduced: 0.4.0
---

# Versioning

Charuy follows [semantic versioning](https://semver.org/) across the monorepo.
All packages (`@charuy/format`, `@charuy/engine`, `@charuy/viewport`,
`@charuy/test-fixtures`) and the web app ship in **lockstep** — a single
version advances every release.

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
[`/release-sweep`](../../.claude/skills/release-sweep/SKILL.md). The sweep:

1. `/graphify` + `pnpm toon` — fresh structural snapshot of the codebase.
2. `/refactor` against the new `GRAPH_REPORT.md` — fix god nodes,
   low-cohesion communities, dead exports flagged by the audit.
3. README drift check.
4. `/graphify` + `pnpm toon` again — capture the post-refactor graph.
5. **Drift pre-empt** (step 5.5) — `pnpm docs:build` + `pnpm noldor garden sdd-report --release`. Commit any drift on the sweep branch. The release script's existing dirty-tree checks (`scripts/release/index.ts:132-138` and `:140-146`) then no-op when the sweep already committed the regen output. See [release-sweep-process-hardening](../features/release-sweep-process-hardening.md) §3.1.
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
   available, graph fresh (`ensureGraphFresh`), garden fresh
   (`ensureGardenFresh` — `.noldor/garden-receipt` must postdate the
   latest commit under `apps/ packages/ scripts/`; stamped by
   `pnpm noldor garden receipt` at the end of every `/garden` flow). Bypass with
   `RELEASE_SKIP_GARDEN_GATE=1 pnpm release` for bootstrap commits that
   predate this gate's existence — same escape-hatch discipline as the
   other `RELEASE_SKIP_*` env vars. All of the following must pass:
   - `pnpm noldor garden detect --gate-compliance` — zero override-tier-mismatch
     findings required; aborts if any gate-compliance findings exist.
     Bypass with `RELEASE_SKIP_GATE_COMPLIANCE=1 pnpm release` when a
     release cycle ends with known scope-vs-FD-slug drift that can't be
     fixed without rewriting public history. The bypass is loud (printed
     in release output) and is intended as an escape hatch, not the norm.
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm test:smoke`
   - `pnpm test:e2e`
   - `pnpm docs:build` — and `docs/user/` must have no resulting diff (any
     un-committed regenerated docs aborts)
   - `pnpm noldor garden sdd-report --release` — and `docs/sdd-report.md` must have no
     resulting diff (un-committed report regen aborts). The `--release`
     flag includes the Gate compliance section (tier distribution,
     override usage, review-skip counter).
   - `pnpm build`
   - `pnpm noldor validate features`
   - `checkCrGate(prev-tag..HEAD)` — every code-touching commit must
     carry tree-matched `Noldor-Reviewed` AND
     `Noldor-Reviewed-Codex` trailers (or matching overrides). See
     [`cr-pipeline.md`](cr-pipeline.md). Bypass with
     `RELEASE_SKIP_CR_GATE=1 pnpm release` when shipping a transition
     release where the CR pipeline itself was added during the cycle and
     pre-cycle commits never had a chance to carry the trailers. Same
     escape-hatch discipline as `RELEASE_SKIP_GATE_COMPLIANCE`.
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
     state machine driven from `/gate`; see
     [`docs/superpowers/specs/2026-05-15-framework-pr-flow-agent-auto-merge-changelog-pr-flow-integration-design.md`](../superpowers/specs/2026-05-15-framework-pr-flow-agent-auto-merge-changelog-pr-flow-integration-design.md) §3).
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

## Product version vs scene format version

Charuy has **two orthogonal semver axes**:

- **Product version** — the `version` field in all `package.json` files; the
  `v<x.y.z>` git tag; what's in `CHANGELOG.md`. Bumps per the rules above.
- **Scene format version** — the `charuy` field in the scene JSON envelope,
  managed inside `@charuy/format`. Bumps only when the persisted-scene schema
  changes.

A product-version bump does NOT imply a scene-format bump, and vice versa.

| Scene format change                                 | Action                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Purely additive (new optional field, new node type) | Bump scene format minor, no migration                                                                 |
| Backward-incompatible rename or removal             | Bump scene format major, add explicit migration in `@charuy/format`, tests for before/after hydration |
| Wire-format change (serialization layout)           | Treat as major; affects `deserialize`                                                                 |

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
