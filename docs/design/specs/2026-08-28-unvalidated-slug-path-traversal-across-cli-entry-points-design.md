# Unvalidated Slug Path Traversal Across CLI Entry Points — Design

**Slug:** unvalidated-slug-path-traversal-across-cli-entry-points
**FD:** docs/features/unvalidated-slug-path-traversal-across-cli-entry-points.md
**Date:** 2026-08-28
**Tier:** specs-only
**Deps:** none

UI verdict: skip — no `consumer.uiPaths` is configured in `.noldor/config.json` and the FD's `links.code` is empty, so the verdict has no candidate surface. This change is CLI-only.

## Problem

`src/core/slug.ts` declares the canonical slug shape and says in its own docstring that "every entry point that accepts one from outside needs the SAME check — a per-call-site copy is how one of them ends up looser than the rest". Exactly one call site honours it: `createWorktree()` at `src/worktrees/create-worktree.ts:81`. Three command families that automated gate flows invoke routinely build filesystem paths from an unchecked positional argument, which is a local path-traversal read/write primitive:

- **`worktrees up` / `worktrees down`** — `upWorktree()` computes `join(opts.cwd, '.worktrees', opts.slug)` at `src/worktrees/up-worktree.ts:60` *before* validation, and only reaches the validating `createWorktree()` when that path does not already exist. An existing outside directory, or `--no-create`, bypasses the sole guard; Noldor then opens an editor there, launches an agent there, and boots configured dev commands there. `downWorktree()` builds `join(opts.cwd, '.noldor', 'dev-<slug>.pids')` the same way and, with `--remove`, hands `join('.worktrees', slug)` to `git worktree remove --force`. A deep enough value escapes `.noldor` in the prefixed pid filename too, so the command reads a foreign `.pids` file and treats column two as process-group IDs to SIGKILL.
- **`features phase-flip-done` / `features phase-revert`** — both take the first non-flag token straight into `join(process.cwd(), 'docs', 'features', slug + '.md')` (`phase-flip-done-cli.ts:16`, `phase-revert-cli.ts:16`) with no validator import. From a consumer root, `../../../escape` resolves outside the repo and the command rewrites that file when it exists and carries the expected phase text.
- **Milestone draft / load / activate** — `src/milestones/lib.ts:59,68,101` interpolate the slug into `docs/milestones/<slug>.md` and the CLI forwards `rest[0]` verbatim, so `draft` can create a file outside the repo when its parent exists, and `activate` can read and rewrite one carrying milestone-shaped frontmatter.

Underneath all three is one policy failure, not three bugs: the check is a convention that each new path-building call site has to remember. `milestoneFrontmatterSchema` and vision's `current-milestone` are plain non-empty strings, so repository-authored references feed non-slugs deeper into the readers as well.

## Goals

- Every path built from an externally-supplied slug is validated and containment-checked before any `exists`, read, write, process launch, kill, or git call.
- Validation lives at the start of each exported library function, not only in argv parsing — a library caller gets the same guard the CLI does.
- The policy is enforced mechanically, so the next path-building call site cannot silently omit it.
- The slug shape is encoded in schemas, so invalid repository-authored state fails to load rather than flowing into readers.
- The diagnostic matches the one `createWorktree()` already emits, so operators see one message for one condition.

## Non-goals

- Hardening CLIs whose paths come from a directory listing rather than argv (`fd-load.ts`, `release-markers.ts`, `repo-paths.ts`): those names are produced by the filesystem, not an attacker.
- A general capability sandbox, a chroot, or dropping privileges. This is input validation.
- Reworking existing `throw`-based error surfaces across the repo beyond what the guard needs.
- Changing `SLUG_RE` itself. The shape is correct; only its reach is wrong.

## Design

### Unit 1 — `parseSlug` and the slug-rooted path builders (`src/core/slug.ts`, new `src/core/slug-paths.ts`)

`src/core/slug.ts` grows `parseSlug(value: string): { ok: true; slug: string } | { ok: false; reason: string }`, returning the same `invalid slug '<v>': expected kebab-case ([a-z0-9-])` text `createWorktree()` uses today. Per the `error-result-types` rule an invalid slug from argv is an expected failure at a trust boundary, so it is a result, not a throw. `isSlug()` stays as the predicate.

A new `src/core/slug-paths.ts` is the choke point. It exports one builder per slug-rooted family — `worktreePath`, `worktreePidsPath`, `featurePath`, `milestonePath` — each taking `(cwd, slug)` and returning a result. Each builder calls `parseSlug` first, then joins, then verifies the joined path is contained within its declared root. Containment is the `contained()` helper currently private to `src/design/artifact-locate.ts:80` (realpath-resolve then prefix-compare with a separator), lifted to a shared module and reused by both — it catches the symlink case the regex alone does not. Building the path *is* the first statement of each of the three families, so a builder that refuses is validation at the start of the exported function.

The builder is the guard because it is the only shape the Unit 3 invariant can actually decide: a text scan can find a slug-rooted `join` sitting outside the builder module, but it cannot find a *missing* validate call, so a per-call-site `assertSlug` convention would leave the policy unenforced — which is the failure this entry is about.

Two side effects are slug-derived without being paths, and no builder reaches them: `downWorktree()`'s `git branch -D feat/<slug>` and the `branch` argument `createWorktree()` passes to `git worktree add`. Those are git refs. Each of those two functions therefore also calls `parseSlug` at its head — a targeted exception to the choke-point rule, not a second general enforcement point.

### Unit 2 — Call-site conversion

The sweep covers every entry point that takes a slug from argv or from a `--slug` flag, not only the three families the problem statement names. A narrower scope would ship a policy check that its own repo fails.

**The three families.** `upWorktree()`, `downWorktree()`, the two phase CLIs, and `draftMilestone` / `loadMilestoneBySlug` / `preflightActivate` each replace their inline `join` with the matching builder and handle the failure branch before any side effect. The exported library functions propagate the failure to their callers rather than throwing; `main()` in each CLI writes the reason to stderr and returns a non-zero exit code. Blast radius is small: `upWorktree` and `downWorktree` have no non-test callers outside their own `main()`, and the milestone functions have four, so result types cost little here. `createWorktree()` keeps its throw — it is already safe — but sources the message from `parseSlug` so there is one string.

**The `.noldor/` path builders.** `src/cr/filename.ts:14`, `src/cr/escalate.ts:38`, `src/design/ledger.ts:181` and `:539` interpolate a `--slug` value into `.noldor/cr/…` and `.noldor/design/…`. They are the same primitive reached through a flag rather than a positional, so `slug-paths.ts` grows `crSinkPath`, `crEscalationPath` and `designLedgerPath` for them; `ledger.ts:539` joins the features root and reuses `featurePath`.

**The flag parsers.** The remaining `--slug` consumers do not build paths themselves — they parse and hand off. Each validates at parse time via `parseSlug` and reports the reason through its existing usage-error surface. Two of them are shared, so the edit count is well below the file count: `src/cr/cli-args.ts:73` is imported by `review-with-codex.ts`, `orchestrate.ts` and `codex.ts`, and `src/cr/orchestrate-args.ts:21` covers orchestrate's own path. The rest are `src/design/log-cli.ts`, `context-cli.ts`, `archive-cli.ts`, `archive-resolve.ts`, `src/prep/prep-fanout.ts`, `discover.ts`, `prep-promote.ts`, `src/cr/bootstrap-cli.ts`, `escalate-cli.ts`, `autofix-cli.ts`, `aggregate-cli.ts`, `src/features/propose-pointers.ts` and `src/autonomous/gate-prompt.ts`.

One live case is worth naming because it is not hypothetical: `src/dashboard/data.ts:804` passes vision's `current-milestone` frontmatter value straight into `loadMilestoneBySlug`, so a repository-authored string already reaches a path builder today. Unit 4 closes that at the schema; the builder closes it defensively.

### Unit 3 — `slug-path-choke-point` invariant (`src/invariants/`)

A new invariant plugin, registered in `src/invariants/index.ts` alongside `boundaries` and `toolchainFloor`, scans `src/**/*.ts` for a `join(...)` whose arguments contain a slug-rooted directory literal — `.worktrees`, `docs/features`, `docs/milestones`, `.noldor/cr`, `.noldor/design` — and flags any occurrence outside `src/core/slug-paths.ts`. This is what turns a three-call-site patch into a policy fix: the fourth call site fails `pnpm noldor checks invariants` at the commit that introduces it.

It registers at `severity: 'error'`, which is only honest because Unit 2 converts every current offender in the same change. The plugin carries no allowlist beyond the builder module itself and the test tree — an allowlist is how a policy check becomes decoration.

### Unit 4 — Schema encoding

`src/core/slug.ts` exports `slugSchema = z.string().regex(SLUG_RE, ...)`, co-located with its inferred type per the `ts-colocate-schema-type` rule. The FD frontmatter `milestone` field and vision's `current-milestone` adopt it, so a hand-edited non-slug reference fails validation instead of reaching a milestone reader — which is precisely the `src/dashboard/data.ts:804` path named in Unit 2.

Migration cost in this repo is nil: `docs/milestones/` holds no files, no FD carries a `milestone:` line, and vision has no `current-milestone`. A consumer repo that does carry a non-slug value is the case that should start failing `validate`, so the tightening needs no grandfather clause.

### Unit 5 — Tests

Two layers, split by what each can actually observe. A subprocess cannot see a spy, and an in-process call never runs `main()`, so the entry's stated assertion — "no read or write spy fires **and** an outside sentinel file stays byte-identical" — needs both.

**Subprocess layer.** `node bin/noldor.mjs <command> <hostile-slug>` against a real `mkdtemp` repo root, following the house pattern at `src/cr/__tests__/autofix-cli.test.ts:27` (which also covers the router's argv reshaping). It proves the exit code, the stderr diagnostic, that no file was created or rewritten, and that a sentinel file written *outside* the temp root is byte-identical afterwards. The hostile-input matrix — slash, `..`, leading, trailing and doubled hyphen, uppercase, Unicode — is table-driven inside the case so spawn count stays one per entry point rather than one per input.

**In-process layer.** The exported functions are called directly with hand-rolled fakes passed as parameters, using the injection seams that already exist (`UpDeps`, `DownDeps`), never `vi.mock`. This is the layer that asserts the kill seam and the git seam were never invoked, and that `createWorktreeImpl` / `openEditorImpl` / `launchTreeImpl` never fired.

Both layers use the real filesystem per `test-mocking-boundaries`. The Deletion Test holds in each: revert any builder to a bare `join` and the sentinel case, the exit-code case and the seam-never-fired case all go red.

## Acceptance criteria

1. `parseSlug` returns `{ ok: false, reason }` for any value failing `SLUG_RE` and `{ ok: true, slug }` otherwise, and the reason text is identical to the one `createWorktree()` emits today.
2. Every builder in `src/core/slug-paths.ts` refuses an invalid slug, and refuses a slug whose joined path resolves outside the builder's declared root — including via a symlink.
3. `worktrees up <bad-slug>` exits non-zero, creates no directory, opens no editor and launches no agent — including with `--no-create` and with a directory already present at the traversed path.
4. `worktrees down <bad-slug> --remove` exits non-zero and invokes neither the kill seam nor the git seam.
5. `features phase-flip-done <bad-slug>` and `features phase-revert <bad-slug>` exit non-zero and write no file.
6. `milestones draft|activate <bad-slug>` exits non-zero and creates or rewrites no file.
7. Every CLI accepting a `--slug` flag exits non-zero on an invalid value before performing any filesystem or subprocess work.
8. A sentinel file outside the repo root is byte-identical after every case in criteria 3–7.
9. The `slug-path-choke-point` invariant reports zero violations on the repo after this change, and reports one for a fixture that joins a slug-rooted directory literal outside the builder module.
10. `pnpm noldor checks invariants` exits non-zero when that invariant is violated.
11. An FD `milestone` field or a vision `current-milestone` whose value is not a slug fails validation.
12. Valid slugs continue to work end-to-end: the existing worktree, phase, milestone, cr and design suites pass unchanged.

## Risks / trade-offs

- **Size.** The source entry is labelled `M`; a full sweep across 21 files reads closer to `L`. The file count overstates the work — the two shared `--slug` parsers cover four CLIs, and thirteen of the remaining edits are a single validate-at-parse line — but this is the trade the operator accepted in exchange for shipping an invariant that is green rather than allowlisted. Re-check at the gate's `split-check --spec` pause.
- **Signature churn.** Turning library returns into result types touches callers of `upWorktree` / `downWorktree` / the milestone functions. Measured rather than assumed: `upWorktree` and `downWorktree` have zero non-test callers outside their own `main()`, and the milestone functions have four (`src/milestones/cli.ts` ×2, `src/dashboard/data.ts` ×2). The churn risk is therefore small, and only the slug-validation failure becomes a result — unrelated failure modes keep their current shape.
- **Invariant false positives.** A literal-scanning invariant will flag legitimate joins in tests and fixtures. Mitigation is the builder module plus the test tree as the only exemptions, with `severity: 'error'` earned by converting every offender in the same change; a noisy invariant gets waived and then ignored.
- **Containment cost.** `contained()` realpath-resolves, which is a syscall per build on a hot-ish path. Negligible at CLI cadence; called out so it is a decision rather than an accident.
- **Residual surface.** Slugs that reach a path from neither argv nor a flag — read out of a session marker, an FD frontmatter field, or a lane sink — are covered only by the builder they eventually call, not by an entry-point check. That is the intended depth: the builder is the last line, and Unit 4 hardens the schemas that feed it.

## User Story

As an operator or an autonomous agent running Noldor commands, I want every command that builds a path from a slug to reject a traversing value before it touches the filesystem, so that a malformed or hostile slug cannot read, rewrite, or delete files outside the repository.

## Usage

No new command. Existing commands gain a refusal:

```
$ noldor features phase-flip-done ../../../escape
invalid slug '../../../escape': expected kebab-case ([a-z0-9-])
$ echo $?
1
```

`pnpm noldor checks invariants` gains a `slug-path-choke-point` row that fails when a new call site joins a slug-rooted directory literal outside `src/core/slug-paths.ts`.

## Open questions (resolved)

1. *Result type or throw for the library-level slug failure?*
   -> Result type. (D1) The `error-result-types` rule reserves `throw` for programmer errors, and a slug arriving from argv is untrusted external input, which is the definition of an expected failure at a boundary.

2. *Does the audit sweep cover `--slug`-flag consumers (`src/cr/filename.ts`, `src/design/ledger.ts`, `src/prep/*`) in this change?*
   -> Yes — builder adoption for the four that build paths, and validate-at-parse for the rest. (D2) They are the same class of primitive and the invariant would flag them anyway; excluding them means shipping a policy fix that the policy check immediately fails.

3. *Should the invariant scan the AST or match on source text?*
   -> Source text with an allowlist. (D3) The existing `boundaries` and `toolchain-floor` plugins are text-and-config scanners; an AST pass is a heavier rung of the lazy-decision ladder than the problem needs.

4. *Should `createWorktree()` convert to a result type too?*
   -> No. (D4) It already validates, so converting it is churn with no safety delta; it only adopts the shared message string.

5. *Does containment need to reject symlinks that point outside, or only literal traversal?*
   -> Reject both, via the realpath-based `contained()`. (D5) A `.worktrees/<slug>` symlink pointing outside defeats a regex-only check, and the helper already exists.
