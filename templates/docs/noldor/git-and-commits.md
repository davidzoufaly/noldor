---
noldor-page: git-and-commits
introduced: 0.4.0
---

# Git and Commits

## Conventional Commits

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Conventional Commits scope: either `<package>` (e.g. `feat(engine): ...`) or `<package>:<slug>` (e.g. `feat(engine:boolean-operations): ...`)
- Use the slug form whenever the commit maps cleanly to one feature MD. Cross-cutting commits drop the slug.
- The slug after `:` MUST resolve to an existing `docs/features/<slug>.md`. The `feature-slug-scope` commit-msg hook enforces this.

### Sibling doc-sync commits (`Noldor-Sibling-Scope`)

A commit that changes code **and** syncs `docs/noldor/` pages would otherwise fail the `noldor-scope` commit-msg gate — the subject carries the code scope, not `noldor`. Keep the real scope and declare the doc pages as siblings via a trailer:

```
feat(prep): add dispatch runner

Noldor-Sibling-Scope: noldor:workflow, noldor:script-catalog
Noldor-Path: fast-track
```

- Honored only on **mixed diffs** — at least one staged file outside `docs/noldor/`. On a doc-only commit the trailer is rejected: put the scope in the subject instead.
- Tokens are `noldor` (any page set) or `noldor:<slug>` with `<slug>` an existing page; every staged page must be covered by a token. Prefer the precise slug form.
- Unknown slugs and malformed tokens fail the commit, same as subject scopes.
- Page changelog derivation (`pnpm noldor changelog`) reads the trailer, so sibling pages keep their history.
- Never auto-injected — add it deliberately; the `noldor-scope` failure message prints the exact trailer line to add.

## Integration — direct-to-main or PR flow

- The consumer chooses the integration model. **Trunk-based**: every commit lands directly on `main`, no PRs. **PR flow**: short-lived branches open a PR with agent auto-merge — see [`pr-flow.md`](pr-flow.md). The hook stack is the gate in both models.
- Worktrees use short-lived branches (`feat/<slug>`, `fix/<slug>`) that integrate into `main` once tests pass — see [`worktree-discipline.md`](worktree-discipline.md).

## Commit gates (pre-commit, not PR review)

The lefthook `pre-commit` hook is the gate. Every commit on `main` must pass:

- `pnpm noldor validate features` — FD schema + cross-checks
- `pnpm noldor checks invariants` — rule-conflict, keybind-collision, package-boundary
- `pnpm noldor checks shared-files` — worktrees forbidden from editing shared files
- `pnpm noldor sync test-links` / `sync:doc-links` / `sync:spec-links` / `sync:fd-resources` — auto-stage modified FDs
- `pnpm typecheck` + `pnpm test` (run by `pnpm verify`; not in pre-commit yet — run before push)

Commit-msg hook also enforces `validate:feature-slug-scope` and `validate:noldor-scope`.

## Granular commits — one per logical change

- **Granular commits** — one commit per logical change. Never squash into a single commit
- **Commit at every confirmed checkpoint.** On paths that produce a spec or plan artifact, `/noldor-gate` commits the artifact at the Step 2.5 review-handoff confirmation (before the next skill runs) — see [`gate/SKILL.md`](../../.claude/skills/noldor-gate/SKILL.md) Step 2.5 and [`complexity-gating.md`](complexity-gating.md) "Review handoff after spec/plan". A worktree branch thus contains spec, then plan, then implementation as separate commits; rolling back to a prior checkpoint is a single `git reset`.

## Never amend; always create a new commit

- **Always create NEW commits rather than amending**, unless the user explicitly requests a git amend. When a pre-commit hook fails, the commit did NOT happen — so `--amend` would modify the PREVIOUS commit, which may result in destroying work or losing previous changes. Instead, after hook failure, fix the issue, re-stage, and create a NEW commit.
- Never skip hooks (`--no-verify`) or bypass signing (`--no-gpg-sign`, `-c commit.gpgsign=false`) unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue.

## Conventional Commits semver discipline

- **Conventional Commits semver discipline** — `feat:` = minor bump, `fix:`/`refactor:`/`chore:`/`docs:`/`perf:`/`test:`/`style:`/`ci:`/`build:` = patch bump, `BREAKING CHANGE:` footer or `type!:` prefix = major bump. Never label a breaking API change as `feat:` — always `feat!:` or add a `BREAKING CHANGE:` footer. `pnpm release` derives the bump from these markers

## Release trigger is explicit

- **Release trigger is explicit** — never run `pnpm release` without explicit user confirmation. It pushes a `v*` tag and creates a public GitHub Release — irreversible and externally visible

## Gate trailers

Every commit (post-rollout — the `.noldor/rollout-marker` is live in this repo) must carry `Noldor-*` trailers. The `commit-msg` hook (`src/hooks/noldor-validate-trailer.ts`) validates them.

### Trailer schema

```
Noldor-Path: micro-chore | fast-track | specs-only-new | specs-only-attach | full-new | full-attach | release-sweep | release-automation
Noldor-FD: <slug>                        # required for specs-only-* / full-* paths
Noldor-Enhancement: <slug>               # required for attach paths (specs-only-attach, full-attach)
Noldor-Reviewed-Subagent: <tree-hash>    # amended on the tip commit at gate Step 4 — validated pre-push, NOT at commit-msg
Noldor-Phase-Revert: 1                   # phase-revert scaffold commits — bypasses the spec-file existence check (attach paths and specs-only-new)
Noldor-Sibling-Scope: <noldor scope-list>  # optional; mixed code+doc-sync commits — see "Sibling doc-sync commits"
```

Per-path `commit-msg` validation (what the hook actually checks):

- `micro-chore` / `release-sweep` — re-validates the staged diff against the matching allowlist (`src/core/allowlist.ts`), so a hand-typed trailer can't launder a code change.
- `fast-track` — path trailer only; no FD, no review receipt at commit time.
- `specs-only-new` / `full-new` — `Noldor-FD` must resolve to an existing FD whose `noldor-tier` matches the path; `full-new` additionally requires `links.spec` in the FD frontmatter; `specs-only-new` requires a spec file on disk at `docs/superpowers/specs/<date>-<slug>-design.md` (existence check only — the hook doesn't verify it's committed). `Noldor-Phase-Revert: 1` bypasses the spec check on `specs-only-new`.
- `specs-only-attach` / `full-attach` — require `Noldor-Enhancement` and a spec file on disk at `docs/superpowers/specs/<date>-<parent>-<enhancement>-design.md`. A `Noldor-Phase-Revert: 1` commit bypasses both (the revert scaffold commits before the spec exists).
- `release-automation` — validated separately (release pipeline commits).

Overrides (emergency bypass — both append to an audit log surfaced by `/noldor-garden`):

```
Noldor-Path-Override: <human-readable reason>        # → .noldor/overrides.log
Noldor-CR-Override-Codex: <human-readable reason>    # → .noldor/cr-overrides.log
```

### Examples

`micro-chore` — no FD, no review required:

```
docs(noldor): fix typo in lifecycle.md

Noldor-Path: micro-chore
```

`fast-track` — small code fix, no FD. The review receipt is amended onto the tip commit at gate Step 4 (after the code-stage CR), so the pushed tip looks like:

```
fix(engine): correct off-by-one in triangulation loop

Noldor-Path: fast-track
Noldor-Reviewed-Subagent: 4a2f9c1e8d3b7f6a0e5c2d1b9a8f7e4c3d2b1a0f
```

`full-new` — new FD, spec, plan; receipt amended on the tip at Step 4:

```
feat(engine:boolean-operations): implement union operator

Noldor-Path: full-new
Noldor-FD: boolean-operations
Noldor-Reviewed-Subagent: 7f3e2a1b9c8d4e5f6a7b8c9d0e1f2a3b4c5d6e7f
```

### Auto-injection

The `prepare-commit-msg` hook (`src/hooks/noldor-inject-trailers.ts`) reads `.noldor/session.json` and injects `Noldor-Path`, `Noldor-FD` (from `slug` or `parent`), and `Noldor-Enhancement` automatically. Authors don't type them by hand when going through `/noldor-gate`.

### Pre-push hook

`src/hooks/noldor-enforce-review-receipt.ts` validates the review receipt on the **tip commit** for review-requiring paths (`fast-track`, `specs-only-*`, `full-*`): the trailer's tree hash must match `git rev-parse HEAD^{tree}`. Both trailer names are accepted — `Noldor-Reviewed-Subagent` (multi-reviewer gate Step 4, current) and `Noldor-Reviewed` (legacy single-reviewer). If new code was committed after the review receipt, the tree hash mismatches and the push is rejected — re-run review. Interim commits don't need a receipt; only the tip is checked.

### Scripted commits: one `-m` paragraph for all trailers

When any script or tool composes a commit message, put **all** `Noldor-*`
trailers in a SINGLE `-m` paragraph. `git interpret-trailers --parse` reads only
the final paragraph, so splitting trailers across separate `-m` args silently
drops them and fails the commit-msg validator (this was the latent PR #129 bug).
