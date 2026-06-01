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
- **Commit at every confirmed checkpoint.** On paths that produce a spec or plan artifact, `/gate` commits the artifact at the Step 2.5 review-handoff confirmation (before the next skill runs) — see [`gate/SKILL.md`](../../.claude/skills/gate/SKILL.md) Step 2.5 and [`complexity-gating.md`](complexity-gating.md) "Review handoff after spec/plan". A worktree branch thus contains spec, then plan, then implementation as separate commits; rolling back to a prior checkpoint is a single `git reset`.

## Never amend; always create a new commit

- **Always create NEW commits rather than amending**, unless the user explicitly requests a git amend. When a pre-commit hook fails, the commit did NOT happen — so `--amend` would modify the PREVIOUS commit, which may result in destroying work or losing previous changes. Instead, after hook failure, fix the issue, re-stage, and create a NEW commit.
- Never skip hooks (`--no-verify`) or bypass signing (`--no-gpg-sign`, `-c commit.gpgsign=false`) unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue.

## Conventional Commits semver discipline

- **Conventional Commits semver discipline** — `feat:` = minor bump, `fix:`/`refactor:`/`chore:`/`docs:`/`perf:`/`test:`/`style:`/`ci:`/`build:` = patch bump, `BREAKING CHANGE:` footer or `type!:` prefix = major bump. Never label a breaking API change as `feat:` — always `feat!:` or add a `BREAKING CHANGE:` footer. `pnpm release` derives the bump from these markers

## Release trigger is explicit

- **Release trigger is explicit** — never run `pnpm release` without explicit user confirmation. It pushes a `v*` tag and creates a public GitHub Release — irreversible and externally visible

## Gate trailers

Every commit on paths 2–6 (post-rollout) must carry `Noldor-*` trailers. The `commit-msg` hook (`src/hooks/noldor-validate-trailer.ts`) validates them.

### Trailer schema

```
Noldor-Path: micro-chore | fast-track | specs-only-new | specs-only-attach | full-new | full-attach | release-automation
Noldor-FD: <slug>                # required for paths 3–6
Noldor-Reviewed: <tree-hash>     # required for paths 2–6 — git tree hash of the reviewed commit
```

Override (emergency bypass — audited by `/garden`):

```
Noldor-Path-Override: <human-readable reason>
```

### Examples

`micro-chore` — no FD, no review required:

```
docs(noldor): fix typo in lifecycle.md

Noldor-Path: micro-chore
```

`fast-track` — small code fix, review required, no FD:

```
fix(engine): correct off-by-one in triangulation loop

Noldor-Path: fast-track
Noldor-Reviewed: 4a2f9c1e8d3b7f6a0e5c2d1b9a8f7e4c3d2b1a0f
```

`full-new` — new FD, spec, plan, review all required:

```
feat(engine:boolean-operations): implement union operator

Noldor-Path: full-new
Noldor-FD: boolean-operations
Noldor-Reviewed: 7f3e2a1b9c8d4e5f6a7b8c9d0e1f2a3b4c5d6e7f
```

### Auto-injection

The `prepare-commit-msg` hook (`src/hooks/noldor-inject-trailers.ts`) reads `.noldor/session.json` and injects `Noldor-Path` and `Noldor-FD` automatically. Authors don't type them by hand when going through `/gate`.

### Pre-push hook

`src/hooks/noldor-enforce-review-receipt.ts` validates `Noldor-Reviewed: <tree-hash>` against `git rev-parse HEAD^{tree}`. If new code was committed after the review receipt, the tree hash mismatches and the push is rejected — re-run review.
