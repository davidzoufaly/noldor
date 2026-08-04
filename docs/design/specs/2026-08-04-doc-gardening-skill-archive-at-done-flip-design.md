# Archive Spec/Plan at Done-Flip, Not Release-Sweep — Design

**Slug:** `doc-gardening-skill-archive-at-done-flip`
**FD:** [`docs/features/doc-gardening-skill.md`](../../features/doc-gardening-skill.md)
**Date:** 2026-08-04
**Tier:** specs-only
**Deps:** none

## Problem

When a feature ships, gate Step 4 end-of-flow flips the FD `phase: in-progress → done`
(`pnpm noldor features phase-flip-done` → [`src/core/phase-flip-done.ts`](../../../src/core/phase-flip-done.ts))
and refreshes the FD body, but nothing moves the design artifacts that fed the work. The spec
(`docs/design/specs/<date>-<slug>-design.md`) and plan (`docs/design/plans/<date>-<slug>.md`)
stay in the live directories.

Archival is deferred entirely to the garden/release-sweep pass:
[`detectStaleSpecs`](../../../src/garden/garden-detect.ts) and `detectStalePlans` flag every
artifact whose owner FD is `phase: done` with `reason: 'feature-done'`, and the
[`/noldor-garden`](../../../.claude/skills/noldor-garden/SKILL.md) skill batch-`git mv`s them into
the sibling `archive/` directory. Consequences:

- **Batching.** Every release dumps the accumulated archival of all features shipped since the last
  sweep in one commit (the v1.1.0 sweep archived 10 artifacts). The move is divorced from the PR
  whose work made it correct.
- **Noise floor.** `feature-done` findings dominate garden output, so genuine exceptions (orphans,
  age-outs, skipped flips) are hard to spot.
- **Review gap.** A rename that belongs to the feature diff never appears in the feature's
  code-stage CR.

The move should ride the same commit that writes `phase: done`, so it lands atomically inside the
feature PR and garden only ever catches exceptions.

## Goals

1. The design artifacts owned by *this* gate session move into their sibling `archive/`
   directory in the same commit that writes `phase: done`.
2. Selection is **session-scoped**, so a parent FD that stays `done` across many `*-attach`
   enhancements never sweeps a sibling enhancement's still-live spec.
3. The FD's `links.spec` / `links.plan` keep resolving after the move.
4. Portable: works from a consumer repo with no `./src/` tree, and from a prose-dispatch runner
   (codex/opencode) that shells CLIs rather than running Claude skills.
5. Idempotent: re-running after a partial or repeated end-of-flow is a no-op.

## Non-goals

- **Backfill.** Pre-existing un-archived artifacts stay garden's job; this spec adds no sweep mode.
- **Detector changes.** `detectStaleSpecs` / `detectStalePlans` keep both reasons (D5).
- **Un-archive / restore.** Reverting a bad move is `git mv` by hand.
- **Fast-track / micro-chore paths.** They carry no FD and no design artifacts — no-op by design.
- **Changing the archive convention.** Still `<dir>/archive/<basename>`, same as the garden skill.
- **Archiving anything else** (escalation contexts, CR sinks, design ledgers under `.noldor/`).

## Design

### Unit 1 — `src/core/design-artifact-names.ts` (new, pure)

The filename→slug parsers currently live inside
[`src/garden/garden-detect.ts`](../../../src/garden/garden-detect.ts) as `specSlugFromFilename`
(`/^\d{4}-\d{2}-\d{2}-(.+?)-design\.md$/`) and `planSlugFromFilename`
(`/^\d{4}-\d{2}-\d{2}-(.+?)(?:-part\d+)?\.md$/`). Both are needed by the new resolver, and
`src/design → src/garden` would be a fresh cross-domain edge. Move the two regexes + functions to
`src/core/design-artifact-names.ts` (core is foundation: every domain module may import it, and
`core-is-foundation` in `.noldor/config.json:consumer.boundaries` forbids the reverse), and
re-export them from `garden-detect.ts` so existing imports and tests keep working:

```ts
export function specSlugFromFilename(filename: string): string | null;
export function planSlugFromFilename(filename: string): string | null;
```

No behaviour change; `garden-detect.ts` keeps its public surface via `export { … } from`, so its own
tests and callers are untouched. One caller does move:
[`src/graphify/enrich-doc-nodes.ts:8`](../../../src/graphify/enrich-doc-nodes.ts) imports both parsers
through `garden-detect` today (used at line 121) — repoint that import at
`src/core/design-artifact-names.js`, which deletes a `graphify → garden` cross-domain edge for a
one-line change.

### Unit 2 — `src/design/archive-resolve.ts` (new, pure)

Sits beside the existing design-ledger modules (`ledger.ts`, `render.ts`, `context-cli.ts`,
`log-cli.ts`). No git, no process spawn — fs reads only, through injectable seams matching the
house style in [`src/garden/plan-resolution.ts`](../../../src/garden/plan-resolution.ts).

```ts
/** Which dialogue key owns this session's artifacts, or null when the path carries none. */
export function dialogueKeyFromSession(m: SessionMarker): string | null;

export interface ArchiveMove {
  readonly kind: 'spec' | 'plan';
  readonly from: string; // repo-relative, e.g. docs/design/specs/<date>-<key>-design.md
  readonly to: string;   // repo-relative, e.g. docs/design/specs/archive/<basename>
}

export interface ArchivePlan {
  readonly key: string;
  readonly moves: readonly ArchiveMove[];
  readonly skipped: readonly { readonly from: string; readonly reason: 'collision' }[];
}

export async function resolveArchivePlan(opts: {
  repo: string;
  session: SessionMarker;
  /** Repo-relative paths ADDED on this branch (origin/main..HEAD). Ownership gate — see below. */
  branchAdded: readonly string[];
}): Promise<ArchivePlan | null>; // null when dialogueKeyFromSession returns null
```

`dialogueKeyFromSession` maps the session marker written by the gate
([`src/core/session.ts`](../../../src/core/session.ts) `SessionMarker`; `PATHS` at
`src/core/session.ts:6-15` is the exhaustive list):

| `path`                                          | key                       |
| ----------------------------------------------- | ------------------------- |
| `specs-only-new`, `full-new`                    | `slug`                    |
| `specs-only-attach`, `full-attach`              | `<parent>-<enhancement>`  |
| `fast-track`, `micro-chore`                     | `null`                    |
| `release-sweep`, `release-automation`            | `null`                    |

The table covers every member of `PATHS`; the implementation switches exhaustively over the union so
a future path addition is a type error rather than silent fallthrough. `release-sweep` /
`release-automation` run no design dialogue, so they key `null` exactly like `fast-track`. A marker
missing `parent`/`enhancement` (or `slug`) for its path also yields `null` rather than a partial key.

The key is exactly what named the spec file at Step 2.5 (`<date>-<slug>-design.md` /
`<date>-<parent>-<enhancement>-design.md`), which is why filename matching is the *first* filter.
It is not sufficient on its own: the concat `<parent>-<enhancement>` is not injective (it can
string-equal an unrelated `*-new` feature's slug, or a different parent/enhancement split), and the
parsers ignore the date prefix entirely, so a filename-only match could move a foreign, still-live
feature's spec. Hence the **ownership gate**: an artifact is eligible only if it is also in
`branchAdded` — the set of files *added on this branch since its merge base with `origin/main`*
(Unit 3a). A foreign feature's live spec was added on some other branch and merged before this
branch's base, so it cannot be in this branch's added set; this session's spec always is (Step 2.5
committed it here). The same gate also disarms the `-partN` aliasing case (key `foo` vs a feature
literally slugged `foo-part1`) and makes the date-agnostic parsers safe.

**Merge-base semantics are load-bearing.** `git diff-tree ... origin/main..HEAD` compares the two
*endpoint trees*, so any path `origin/main` deleted or moved after the branch point shows up as `A`
on HEAD's side. This feature mass-produces exactly that situation — once flip-commits start moving
specs into `archive/` on `main`, a stale branch would see every such foreign live spec as
"branch-added", with no collision skip (its `archive/<basename>` is absent in the stale tree). So the
range must be the merge base, not the endpoint: `git merge-base origin/main HEAD`, then
`git diff-tree --diff-filter=A --name-only -r <base> HEAD`.

### Unit 3a — `src/core/branch-added.ts` (new, extracted)

[`src/core/pr-flow-cli.ts:144`](../../../src/core/pr-flow-cli.ts) already inlines this query as the
private `discoverAddedFiles(prefix)` — with the two-dot range. Extract it to
`src/core/branch-added.ts` (core, so both `src/core/pr-flow-cli.ts` and `src/design` may import it),
fix the range to merge-base, and have `pr-flow-cli.ts` call the shared helper instead of its private
copy:

```ts
/** Repo-relative paths added between merge-base(origin/main, HEAD) and HEAD. */
export function discoverAddedFiles(prefix?: string, cwd?: string): string[];
```

Paths from `diff-tree` are repo-root-relative, so the helper resolves the root with
`git rev-parse --show-toplevel` and callers compare root-relative paths — otherwise a subdir `cwd`
would fail the gate for every artifact and report a confusing `nothing to do`.

`git merge-base origin/main HEAD` returns a single (arbitrary) base on a criss-cross history. Left
as-is: the repo's squash-merge, short-lived-branch flow does not produce criss-cross merges, and
`--all` handling would buy nothing here. Noted in Risks.

Side effect on `pr-flow`: its spec/plan discovery gains merge-base semantics too. That is strictly
more correct (a stale branch no longer mis-attributes a spec `main` archived after the branch point),
and one helper is the only place range semantics are decided.

`resolveArchivePlan` reads `loadDocRoots(repo).specs` and `.plans`
([`src/core/doc-roots.ts`](../../../src/core/doc-roots.ts)), skips the nested `archive/` entry and
any non-`.md` file, parses each basename with the Unit-1 parsers, and keeps entries where parsed
slug `=== key` **and** the repo-relative path is in `branchAdded`. Plans match `-partN` variants
(the parser strips the suffix), so a multi-part plan archives as a set. For every kept entry: if
`<dir>/archive/<basename>` already exists, it goes to `skipped` with `reason: 'collision'`;
otherwise to `moves`. A missing `specs`/`plans` directory or zero matches yields an empty list,
never a throw — that is the idempotent re-run and the specs-only (no plan) case.

### Unit 3 — `src/design/archive-cli.ts` (new) → `noldor design archive`

```
noldor design archive [--dry-run] [--slug <key>]
```

1. `--slug <key>` overrides the *session-derived key only* — the ownership gate still applies, so it
   cannot reach an artifact this branch did not add. It exists for a same-branch manual run (session
   marker missing or mis-keyed) and as the seam the CLI tests use. It is explicitly **not** a
   backfill lever: artifacts merged long ago are never in `branchAdded`, and backfill stays garden's
   job (Non-goals). Otherwise `readSession(process.cwd())`:
   - `null` → stderr `design archive: no .noldor/session.json — did you skip the gate scaffold?`,
     exit 1. (Same hint shape Q-0055 wants elsewhere.)
   - key `null` → stdout `design archive: path <path> carries no design artifacts — skipped`,
     exit 0.
2. Compute `branchAdded` via Unit 3a's `discoverAddedFiles()` (merge-base range, root-relative paths).
   If it throws (no `origin/main` ref, no merge base, shallow clone, non-git fixture), **fail
   closed**:
   stderr `design archive: cannot determine branch-added artifacts — skipped (garden will catch it)`,
   exit 0. Archiving without the ownership gate is the one outcome worth refusing; garden remains the
   backstop (D5).
3. `resolveArchivePlan`. Empty `moves` + empty `skipped` → `design archive: no artifacts matching
   <key> — nothing to do`, exit 0.
4. `--dry-run` → print one `would archive: <from> → <to>` per move plus collision warnings, exit 0,
   touch nothing.
5. Otherwise per move: `mkdirSync(dirname(to), { recursive: true })`, then decide the mechanism by
   *probing* trackedness rather than parsing git's (i18n'd, locale-dependent) error text —
   `git ls-files --error-unmatch <from>` exits 0 for a tracked file. Tracked →
   `execFileSync('git', ['mv', from, to])`, which preserves rename detection and stages the change.
   Untracked → `renameSync(from, to)` followed by `git add -- <to>` (the destination only: an
   untracked `<from>` is neither in the index nor still on disk, so including it makes git abort the
   whole `git add` with `fatal: pathspec … did not match any files`). Either way the CLI leaves every
   move staged. A `git mv` failure on a file that probed as tracked is fatal (exit 1, stderr
   passthrough) — a half-moved set must be visible, not swallowed.

   <a id="no-directory-literal"></a>**Why the CLI stages, and not the gate** (canonical statement;
   later sections reference this): `loadDocRoots` resolves `plans`/`specs` through the 1.0.0
   transition alias ([`src/core/doc-roots.ts:26-32`](../../../src/core/doc-roots.ts)), so on a
   consumer that bumped the package without running `noldor upgrade` the moves land under
   `docs/superpowers/*/archive/`. Any hardcoded `docs/design` pathspec in the gate would miss those
   moves entirely (and `git add docs/design` would fail `pathspec did not match` on a repo without
   that dir). The CLI knows the resolved roots; the gate must not have to.
6. Collisions print `skipped (exists in archive): <from>` and never overwrite; exit stays 0 —
   mirrors the garden skill's row-level collision behaviour.
7. Final line: `archived: <n> artifact(s)`.

Registered in [`src/cli/manifest.ts`](../../../src/cli/manifest.ts) under the existing `design`
group (`{ src: 'design/archive-cli.ts', desc: 'Archive this session's spec/plan into
docs/design/*/archive/' }`), which the `validate-script-catalog` gate then requires be reflected in
`docs/noldor/script-catalog.md`.

### Unit 4 — `links.plan` repoint in `src/sync/sync-fd-resources.ts`

[`sync-fd-resources.ts`](../../../src/sync/sync-fd-resources.ts) already repoints a moved spec:
`resolveSpecPath(currentPath, exists)` returns `<dirname>/archive/<basename>` when the original is
gone and the archived variant exists, and `syncFile` writes it back to `links.spec`. Because
`lefthook/noldor.yml:24-26` runs `pnpm noldor sync fd-resources` pre-commit on staged
`docs/features/**/*.md`, the spec repoint happens *for free* inside the flip commit once Unit 3 has
moved the file.

`links.plan` gets no such treatment today, and its schema allows both forms
(`z.union([z.string(), z.array(z.string())])` in
[`src/core/feature-schema.ts`](../../../src/core/feature-schema.ts)). Changes:

- Rename `resolveSpecPath` → `resolveArchivedPath` (behaviour identical; name no longer lies). Its
  only importer outside the module is `src/sync/__tests__/sync-fd-resources.test.ts`, so the rename
  is a two-file change with no prod call-site churn.
- Add `resolveArchivedPathList(value: string | string[] | undefined, exists)` returning the
  rewritten value or `null` when nothing changed — per-element for the array form, so a partially
  archived multi-part plan repoints only the moved elements.
- In `syncFile`, apply both to `links.spec` and `links.plan`, setting `frontmatterChanged` when
  either produced a rewrite. The existing `LOST_SENTINEL` handling is untouched (sentinels never
  resolve to a path).

### Unit 5 — gate Step 4 wiring

In [`.claude/skills/noldor-gate/SKILL.md`](../../../.claude/skills/noldor-gate/SKILL.md) Step 4,
between the `/noldor-draft-feature-md --refresh` bullet and the phase-flip bullet, insert the
archive call for FD-carrying paths only — preceded by a clean-index assertion, because the flip
commit records the index:

```
git diff --cached --quiet || { echo "index not empty before flip — resolve by hand"; exit 1; }
pnpm noldor design archive
```

The flip bullet then stages only the FD and commits whatever the index holds (FD + the moves the CLI
staged):

```
pnpm noldor features phase-flip-done <slug>
git add docs/features/<slug>.md
git diff --cached --quiet || git commit -m "docs(features:<slug>): mark phase=done + archive design artifacts" -m "Noldor-FD: <slug>"
```

Three properties fall out of this shape:

- **No directory literal.** Unit 3 stages its own moves, so the gate never names an artifact
  directory — see [Unit 3's canonical rationale](#no-directory-literal) (1.0.0 transition alias).
- **No stranger rides in.** The precondition asserts an empty index *before* anything is staged, so
  committing the index is exactly FD + moves. This replaces the earlier pathspec-limited `git commit
  -- <paths>` idea, which also refuses to run mid-merge/cherry-pick (`cannot do a partial commit
  during a merge`). The precondition is in fact what forecloses that state: `git diff --cached
  --quiet` also exits non-zero on unmerged index entries, so a mid-merge/cherry-pick tree halts at
  the assertion — before any question of what a bare `git commit` would record.
- **Move-only changes still commit.** The `--cached` emptiness check replaces today's `git diff
  --quiet <fd>`, so an unchanged FD body plus a staged rename still produces the commit.

Order matters: archive **before** the flip commit, so move + `phase: done` + refreshed FD are one
commit, and that commit rides the `origin/main..HEAD` range the code-stage CR reviews. Fast-track /
micro-chore keep skipping this seam entirely.

Ordering note: the archive runs *before* `sync fd-resources` fires (pre-commit), which is exactly
what makes the Unit-4 repoint see the file already in `archive/`.

### Unit 6 — garden detectors: unchanged

`detectStaleSpecs` / `detectStalePlans` keep both `feature-done` and `age-no-feature` reasons and
the full three-tier owner resolution (filename slug → `links.*` → graph adjacency). They now fire
only on exceptions: pre-flip-era debt, manual/skipped flips, orphans, age-outs. Zero detector diff
is the point — flip-time archival is an optimisation of *when*, not a replacement for the safety
net (D5).

### Data flow

```
gate Step 4 (FD path)
  ├─ /noldor-draft-feature-md --refresh        (FD body)
  ├─ assert empty index
  ├─ noldor design archive                     (git mv spec+plan → archive/, left STAGED)
  ├─ noldor features phase-flip-done <slug>    (phase: done)
  └─ git add docs/features/<slug>.md && git commit   (index = FD + moves)
         └─ pre-commit: sync fd-resources → links.spec/.plan repointed to archive/
```

### Error handling

| Condition                              | Behaviour                                                    |
| -------------------------------------- | ------------------------------------------------------------ |
| No session marker                      | exit 1 + "did you skip the gate scaffold?" hint              |
| Path carries no artifacts (fast-track, micro-chore, release-*) | exit 0, explanatory line          |
| `origin/main..HEAD` query fails        | fail closed: exit 0, "skipped — garden will catch it"        |
| No matching artifacts / already moved  | exit 0, "nothing to do" (idempotent)                         |
| `archive/<basename>` exists            | skip that artifact, warn, exit 0                             |
| Artifact untracked (`ls-files` probe)  | fs `renameSync` + `git add -- <to>` (destination only)        |
| `git mv` fails on a tracked artifact   | exit 1, stderr passthrough                                   |
| `specs/` or `plans/` dir missing       | treated as empty, exit 0                                     |

## Acceptance criteria

- `dialogueKeyFromSession` returns `slug` for `*-new`, `<parent>-<enhancement>` for `*-attach`,
  and `null` for `fast-track`, `micro-chore`, `release-sweep`, `release-automation`, and for markers
  missing the fields their path needs. A test enumerates `PATHS` so a new path cannot be left
  unhandled.
- `resolveArchivePlan` for an `*-attach` session keyed `<parent>-<enh-a>` selects
  `<date>-<parent>-<enh-a>-design.md` and does **not** select `<date>-<parent>-<enh-b>-design.md`
  or `<date>-<parent>-design.md`.
- `resolveArchivePlan` does **not** select a filename-matching artifact absent from `branchAdded`
  — pinned by two cases: a foreign feature whose slug equals the `<parent>-<enhancement>` concat,
  and a feature literally slugged `<key>-part1` whose plan the `-partN` parser aliases to `<key>`.
- `resolveArchivePlan` selects every `-partN` plan whose stripped slug equals the key **and** is in
  `branchAdded`.
- Entries already inside `archive/` are never re-selected; a name collision lands in `skipped`
  with `reason: 'collision'` and the file is not moved.
- `noldor design archive` in a temp git repo moves a tracked spec + plan with `git mv`, leaves them
  staged, and prints one `archived:` line per artifact; a second run exits 0 with `nothing to do`.
- `noldor design archive` moves an **untracked** spec via the fs fallback (exit 0) and leaves the
  file at the archive path — the mechanism is chosen by the `git ls-files --error-unmatch` probe,
  not by matching git's error text.
- `noldor design archive` in a repo with no resolvable `origin/main` (or no merge base) exits 0,
  moves nothing, and its stderr names the fail-closed reason.
- `discoverAddedFiles` uses the merge base, pinned by a fixture where `main` deleted a file *after*
  the branch point: the deleted path must NOT appear in the result (it does under the old two-dot
  range). `pr-flow`'s discovery goes through the same helper — one range, one test.
- `noldor design archive --slug <key>` run from a repo subdirectory resolves the same moves as from
  the repo root (root-relative path comparison), and still refuses an artifact absent from
  `branchAdded`.
- `noldor design archive` leaves every move **staged**: `git diff --cached --name-status` shows a
  rename (or delete+add) pair for the tracked `git mv` case, and a single `A <to>` for the untracked
  fs-rename case — the CLI must not pass the vanished `<from>` to `git add`, which would abort the
  whole staging call.
- With the artifacts resolving under legacy `docs/superpowers/{specs,plans}` (new dirs absent), the
  CLI still moves them into `docs/superpowers/*/archive/` and stages them; the gate's commit picks
  them up with no directory literal involved.
- The gate's clean-index precondition fails loudly (non-zero, explanatory message) when the index is
  non-empty before archive, and no commit is produced.
- `noldor design archive --dry-run` prints the moves and mutates nothing on disk or in the index.
- `noldor design archive` with no `.noldor/session.json` exits 1 and its stderr contains
  `no .noldor/session.json`.
- `noldor design archive` with a `fast-track` marker exits 0 and moves nothing.
- `syncFile` repoints `links.plan` when the plan lives in `archive/`, for both the string form and
  the array form (array: only moved elements rewritten, others byte-identical).
- `sync fd-resources` still repoints `links.spec` (existing behaviour preserved under the renamed
  `resolveArchivedPath`).
- `specSlugFromFilename` / `planSlugFromFilename` remain importable from `src/garden/garden-detect.ts`
  and behave identically; garden detector tests pass unchanged.
- `pnpm noldor invariants run` boundaries check stays green: `src/design` imports only `src/core`,
  and the `graphify → garden` edge from `enrich-doc-nodes.ts` is gone.
- Every new `src/` file carries a `// @tests:` tag; `pnpm noldor sync test-links` and the
  `validate-script-catalog` gate pass with the new `design archive` manifest entry documented in
  `docs/noldor/script-catalog.md`.

## Risks / trade-offs

- **Attach parent, concurrent enhancements.** The whole reason selection is session-scoped. Two
  enhancements on the same parent each archive only their own dated spec. A same-day, same-parent,
  same-enhancement-slug collision is impossible (the enhancement slug is what disambiguates).
- **Session marker as the authority.** A hand-written or corrupted marker mis-keys the move. Impact
  is bounded twice over: a wrong key usually matches nothing (exit 0, garden catches the artifact
  later), and even a key that *does* collide with a foreign feature's filename cannot move it,
  because the artifact must also be in this branch's added set. The residual case is a marker that
  mis-keys an artifact this branch itself added — self-inflicted and visible in the flip commit.
- **Ownership gate depends on `origin/main` + a merge base.** `branchAdded` needs a resolvable
  `origin/main` ref and a merge base with it. A detached/shallow/offline tree skips archival entirely
  (fail-closed) rather than archiving blind, so the failure mode is "garden does it later", i.e.
  today's behaviour.
- **Branch-added, not branch-modified.** `--diff-filter=A` misses an artifact that existed on `main`
  and was only edited on this branch (e.g. a spec revised by a later enhancement without a new
  file). Such an artifact is deliberately *not* archived here — it is not this session's to file —
  and garden still owns it.
- **Changing `pr-flow`'s range.** Extracting `discoverAddedFiles` fixes `pr-flow`'s spec/plan
  discovery to merge-base semantics as a side effect. Strictly more correct, but it does alter an
  existing shipped behaviour; a stale branch's PR body may now cite a different (correct) spec path.
- **Inbound doc links to the moved path.** Any prose elsewhere linking the live spec path breaks on
  the move. Same exposure garden archival already has today; the pre-commit `sync doc-links` check
  runs on the same commit and surfaces it. Not solved here.
- **Fewer garden auto-actions.** `/noldor-garden` output gets much quieter for `feature-done`;
  operators used to that batch will see it only for exceptions. Intended, but it is a behaviour
  change to the sweep ritual.
- **Rename in the CR diff.** Code-stage CR (`--base-sha origin/main`) now sees a rename pair for
  the spec it also reviewed at Step 2.5. Cosmetic noise, and arguably correct: the move is part of
  the feature.
- **Clean-index precondition can halt end-of-flow.** Committing the index (rather than a pathspec)
  is what keeps the gate free of directory literals, but it means a non-empty index at Step 4 aborts
  with a manual-resolution message instead of proceeding. At end-of-flow the index is expected empty;
  when it isn't, something unmodelled happened and stopping is the right call. In autonomous/drain
  mode this surfaces as a failed iteration → retry-from-clean, not a silent bad commit.
- **Multiple merge bases.** `git merge-base origin/main HEAD` returns one arbitrary base on a
  criss-cross history, so `branchAdded` could vary there. The repo's squash-merge, short-branch flow
  makes criss-cross effectively unreachable; accepted rather than handled with `--all`.
- **Two owners of the archive convention.** The garden skill's `git mv` prose and Unit 3 both
  encode `<dir>/archive/<basename>`. Drift is possible; the convention is one line in each and
  Unit 3's tests pin it.

## User Story

As a Noldor operator, I want a shipped feature's spec and plan to be archived by the same commit
that marks the feature done, so that design artifacts are filed atomically inside the feature PR
and the release-sweep garden pass only reports genuine exceptions instead of a batch of routine
moves.

## Usage

```bash
# End-of-flow, run by /noldor-gate Step 4 on FD-carrying paths (reads .noldor/session.json):
pnpm noldor design archive
# archived: docs/design/specs/2026-08-04-doc-gardening-skill-archive-at-done-flip-design.md
#        → docs/design/specs/archive/2026-08-04-doc-gardening-skill-archive-at-done-flip-design.md
# archived: 1 artifact(s)

# Preview without touching disk or index:
pnpm noldor design archive --dry-run

# Same-branch manual run when the session marker is missing or mis-keyed.
# Overrides the key only — the branch-added ownership gate still applies, so this
# cannot reach artifacts merged on an earlier branch (backfill stays /noldor-garden's job):
pnpm noldor design archive --slug some-parent-some-enhancement

# No-op paths (fast-track, micro-chore) and re-runs are safe:
pnpm noldor design archive
# design archive: path fast-track carries no design artifacts — skipped
```

Agent surface: the gate calls the CLI between `/noldor-draft-feature-md --refresh` and
`pnpm noldor features phase-flip-done <slug>`, having asserted an empty index first; the CLI leaves
its moves staged, the gate adds `docs/features/<slug>.md`, and one commit carries both. Nothing else
in the flow changes.

## Open questions (resolved)

1. *What signal selects which artifacts move — the session, or the FD's phase?*
   → **Session-scoped dialogue key** (`slug` on `*-new`, `<parent>-<enhancement>` on `*-attach`),
   filename-matched **and** gated on branch-added membership — `git diff-tree --diff-filter=A
   --name-only -r <merge-base origin/main HEAD> HEAD`, merge-base and not two-dot (D7). FD phase is
   never consulted for the move. (D1)
   Rationale: a parent FD re-flipping `done` for each attach enhancement would otherwise sweep a
   sibling enhancement's still-live spec; and because the concat key is not injective and the
   filename parsers ignore the date, the branch-added gate is what makes "foreign spec is
   unreachable" true rather than merely likely.

2. *Where does the move live — inside `phase-flip-done`, a new CLI, or gate prose?*
   → **New portable CLI `noldor design archive`** with the resolution logic in a pure module;
   `phase-flip-done.ts` stays pure md→md. (D2)
   Rationale: keeps a testable seam, works from consumer repos and prose-dispatch runners, and
   matches the `phase-revert` / `roadmap remove-block` precedent.

3. *`git mv` or fs rename, and who stages?*
   → **`git mv`, falling back to fs `renameSync` only when a `git ls-files --error-unmatch` probe
   says the artifact is untracked**; the gate owns the commit, the CLI never commits. (D3)
   Rationale: rename detection plus automatic staging for the normal case, without failing on the
   anomalous untracked one — and probing beats parsing git's localized error text.

4. *How do `links.spec` / `links.plan` survive the move?*
   → **Generalise `resolveSpecPath` → `resolveArchivedPath` in `sync-fd-resources.ts` and apply it
   to `links.plan` too** (string and array forms); the existing pre-commit `fd-resources` hook then
   repoints both inside the flip commit. (D4)
   Rationale: reuses machinery that already solves this for `links.spec`; closes a real pre-existing
   `links.plan` rot gap for one small diff.

5. *Do the garden detectors change?*
   → **No.** Both reasons and all three resolution tiers stay; they become the exception backstop.
   (D5)
   Rationale: flip-time archival changes *when* the routine case is handled, not whether the
   safety net exists — skipped flips and pre-flip debt still need catching.

6. *Collision when `archive/<basename>` already exists?*
   → **Skip that artifact with a warning, exit 0, never overwrite.** (D6)
   Rationale: matches the garden skill's row-level collision rule; an archived artifact is history
   and must not be clobbered by a same-named newcomer.

7. *Should this backfill the artifacts already sitting un-archived in the live directories?*
   → **No** — out of scope; the next `/noldor-garden` pass drains them exactly as today. `--slug` is
   not a backfill lever either: the ownership gate applies to it too. (D8)
   Rationale: backfill is a one-shot doc chore with no code surface, and keeping it out keeps this
   diff reviewable.

8. *Two-dot or merge-base range for the ownership gate?*
   → **Merge-base**, and the query is extracted to `src/core/branch-added.ts` so `pr-flow` and this
   CLI share one definition. (D7)
   Rationale: `diff-tree A..B` diffs endpoint trees, so anything `main` deleted or moved after the
   branch point reads as added on HEAD — and this very feature will start moving specs on `main`,
   manufacturing that case. Merge-base makes "a foreign live spec is unreachable" an invariant rather
   than a race with the archive convention.

9. *How does the flip commit capture the moves without naming a directory?*
   → **The CLI stages its own moves; the gate asserts an empty index beforehand and commits the
   index.** No directory literal, no pathspec-limited commit. (D9)
   Rationale: two problems, one shape — the transition-alias hazard
   ([canonical statement in Unit 3](#no-directory-literal)) and the fact that a pathspec-limited
   `git commit -- <paths>` is a partial commit, which git refuses mid-merge/cherry-pick. Staging in
   the CLI + an empty-index precondition gives the same "no stranger rides in" guarantee without
   either failure mode.
