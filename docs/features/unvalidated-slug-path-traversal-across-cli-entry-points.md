---
area: tooling
category: Tooling
deps: []
entry-id: Q-0097
links:
  code:
    - src/core/slug.ts
    - src/core/slug-paths.ts
    - src/core/doc-roots.ts
    - src/worktrees/worktree-paths.ts
    - src/worktrees/up-worktree.ts
    - src/worktrees/down-worktree.ts
    - src/worktrees/create-worktree.ts
    - src/features/phase-flip-done-cli.ts
    - src/features/phase-revert-cli.ts
    - src/milestones/lib.ts
    - src/cr/filename.ts
    - src/design/ledger.ts
    - src/invariants/slug-path-choke-point.ts
  tests:
    - src/core/__tests__/slug-guards.test.ts
    - src/core/__tests__/slug-paths.test.ts
    - src/core/__tests__/slug-traversal.cli.test.ts
    - src/cr/__tests__/expected-lanes-guard.test.ts
    - src/invariants/__tests__/slug-path-choke-point.test.ts
    - src/worktrees/__tests__/down-worktree-traversal.test.ts
name: Unvalidated Slug Path Traversal Across CLI Entry Points
packages:
  - scripts
phase: done
since: 2026-08-12T00:00:00.000Z
noldor-tier: specs-only
---
## Summary

Three command families build filesystem paths from an unchecked positional argument, giving a local path-traversal read/write primitive in commands that automated gate flows invoke routinely. `src/core/slug.ts` already states that every external path-building entry point must use the canonical validator; these call sites do not. Validate at the start of each exported library function — not only in argv parsing — before any `exists`, read, process launch, kill, or git call, and return the same invalid-slug diagnostic worktree creation already uses. Then audit every other CLI that forms a path from argv, so the fix is not a three-call-site patch around a shared policy failure. Subprocess tests: slash, dot-dot, leading/trailing/doubled hyphens, uppercase, Unicode — assert no read or write spy fires and an outside sentinel file stays byte-identical.

- `worktrees up` / `worktrees down`: `upWorktree()` computes `join(opts.cwd, '.worktrees', opts.slug)` before validation and only calls the validating `createWorktree()` when that path does not already exist, so an existing outside directory — or `--no-create` — bypasses the sole guard, after which Noldor can open an editor, launch an agent, and boot configured commands there. `downWorktree()` builds the pid-file path the same way and, with `--remove`, hands `join('.worktrees', opts.slug)` to `git worktree remove --force`. A deep enough value in the prefixed pid filename also escapes `.noldor`, letting the command read a foreign `.pids` file and treat its second column as process-group IDs.
- `features phase-flip-done` / `features phase-revert`: both take the first non-flag token straight into `join(process.cwd(), 'docs', 'features', slug + '.md')` without importing the shared validator. From a consumer root `/consumer`, `../../../escape` resolves to `/escape.md`, and the command rewrites that file if it exists and contains the expected phase text.
- Milestone draft/load/activate: `src/milestones/lib.ts:55-76` and `:90-99` interpolate the slug into `docs/milestones/<slug>.md` and the CLI forwards `rest[0]` verbatim, so `draft` can create an outside file when its parent exists and `activate` can read and rewrite one carrying milestone-shaped frontmatter. `FeatureFrontmatterSchema.milestone` and vision's `current-milestone` are only non-empty strings, so repository-authored references feed non-slugs deeper into milestone readers — encode the slug schema in milestone, feature and vision validation so invalid state cannot load at all.

(all three confirmed by static path-resolution probe in the read-only audit 2026-08-12)

## User Story

As an operator or an autonomous agent running Noldor commands, I want every command that builds a path from a slug to reject a traversing value before it touches the filesystem, so that a malformed or hostile slug cannot read, rewrite, or delete files outside the repository.

## Usage

**CLI**

Nothing new to invoke — existing commands gain a refusal. A slug that is not kebab-case, or whose path would leave the repository, is rejected before any read, write, process launch, kill, or git call:

```
$ noldor features phase-flip-done -- ../../../escape
invalid slug '../../../escape': expected kebab-case ([a-z0-9-])
$ echo $?
1
```

The same refusal covers `worktrees up` (including `--no-create`, and when a directory already sits at the traversed path), `worktrees down` (with and without `--remove`), `features phase-revert`, the milestone `draft` / `activate` / load entry points, and every CLI taking a `--slug` or `--slugs` flag. Commands that accept a slug without building a path from it — `design archive`'s resolver matches it as an equality key, `prep discover` filters a set with it — are deliberately out of scope.

`pnpm noldor checks invariants` gains an advisory `slug-path-choke-point` row listing slug-rooted joins outside the guarded builders. It warns; it never blocks.

**Programmatic API**

- `parseSlug(value)` — the one trust boundary. Returns `{ ok: true, slug }` with a branded `Slug`, or `{ ok: false, error }`. Call it wherever untrusted text arrives.
- `slugPath(anchor, relRoot, slug, { prefix, suffix })` — the one guarded join. Takes a branded `Slug`, composes the root from the anchor, and refuses `escapes-root`, `unsafe-symlink`, or `uninspectable` when it cannot `lstat` the target at all.
- `readFileNoFollow(path)` / `readFileNoFollowAsync(path)` — reads for a vetted path. They open with `O_NOFOLLOW`, so a symlink planted between the guard and the read is refused by the kernel rather than followed, and a platform that cannot offer the flag is detected rather than silently degraded.
- Writes use the existing `atomicWriteFileSync` / `atomicWriteFile`: a temp-file-then-rename replaces a planted symlink instead of following it, and keeps the atomicity other readers of these docs depend on.
- `featurePath(cwd, slug)` / `milestonePath(cwd, slug)` / `worktreePath(cwd, slug)` / `worktreePidsPath(cwd, slug)` — per-family builders over `slugPath`.
- `slugSchema` — a zod schema producing the brand, used by the frontmatter fields that carry repository-authored slugs.

Path-building functions take `Slug`, not `string`, so passing raw argv text to one is a compile error rather than a review finding.

## PRs

<!-- @prs-since-last-release: unvalidated-slug-path-traversal-across-cli-entry-points -->

## Changelog

- 2026-08-28 — shipped under `Noldor-Path-Override` after 8 code-stage CR rounds. Rounds 1–7's security findings are all fixed and probe-verified (a deletion test on every guard); round 8 contradicted round 7 on the same lines — `skipIf(root)` was demanded by round 7 citing the dashboard-data house pattern, then flagged by round 8; the chmod fixture was reviewed clean in round 7, then flagged in round 8. Residual round-8 items deliberately deferred, all pre-existing-behaviour or platform-policy questions rather than regressions of this change: `--` terminator support in the phase CLIs' first-non-flag parsers (pre-existing parser shape), `--slug` consuming a following flag as its value in `aggregate-cli` (pre-existing shape), win32 policy for `O_NOFOLLOW`-guarded reads (needs a repo-wide platform decision), the dangling-intermediate-symlink residue already documented in the spec's stated-limits section, and `resolveMilestone` re-encoding the milestones `relRoot` that `milestonePath` single-sources (cosmetic duplication, both call the same guard).
