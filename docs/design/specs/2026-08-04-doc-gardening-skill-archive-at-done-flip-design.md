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

No behaviour change; `garden-detect.ts` keeps its public surface via `export { … } from`.

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
}): Promise<ArchivePlan | null>; // null when dialogueKeyFromSession returns null
```

`dialogueKeyFromSession` maps the session marker written by the gate
([`src/core/session.ts`](../../../src/core/session.ts) `SessionMarker`):

| `path`                                | key                       |
| ------------------------------------- | ------------------------- |
| `specs-only-new`, `full-new`          | `slug`                    |
| `specs-only-attach`, `full-attach`    | `<parent>-<enhancement>`  |
| `fast-track`, `micro-chore`           | `null`                    |

This is exactly the key that named the spec file at Step 2.5
(`<date>-<slug>-design.md` / `<date>-<parent>-<enhancement>-design.md`), which is why filename
matching is sufficient and the FD's `phase` is deliberately *not* consulted. A marker missing
`parent`/`enhancement` (or `slug`) for its path yields `null` rather than a partial key.

`resolveArchivePlan` reads `loadDocRoots(repo).specs` and `.plans`
([`src/core/doc-roots.ts`](../../../src/core/doc-roots.ts)), skips the nested `archive/` entry and
any non-`.md` file, parses each basename with the Unit-1 parsers, and keeps entries whose parsed
slug `=== key`. Plans match `-partN` variants (the parser strips the suffix), so a multi-part plan
archives as a set. For every kept entry: if `<dir>/archive/<basename>` already exists, it goes to
`skipped` with `reason: 'collision'`; otherwise to `moves`. A missing `specs`/`plans` directory or
zero matches yields an empty list, never a throw — that is the idempotent re-run and the
specs-only (no plan) case.

### Unit 3 — `src/design/archive-cli.ts` (new) → `noldor design archive`

```
noldor design archive [--dry-run] [--slug <key>]
```

1. `--slug <key>` overrides session-derived key (manual/backfill escape hatch, and the seam the
   tests use). Otherwise `readSession(process.cwd())`:
   - `null` → stderr `design archive: no .noldor/session.json — did you skip the gate scaffold?`,
     exit 1. (Same hint shape Q-0055 wants elsewhere.)
   - key `null` → stdout `design archive: path <path> carries no design artifacts — skipped`,
     exit 0.
2. `resolveArchivePlan`. Empty `moves` + empty `skipped` → `design archive: no artifacts matching
   <key> — nothing to do`, exit 0.
3. `--dry-run` → print one `would archive: <from> → <to>` per move plus collision warnings, exit 0,
   touch nothing.
4. Otherwise per move: `mkdirSync(dirname(to), { recursive: true })`, then
   `execFileSync('git', ['mv', from, to])`. `git mv` preserves rename detection and stages the
   change. If it fails **because the artifact is untracked** (git's `not under version control`
   error), fall back to `renameSync(from, to)` and let the gate's `git add` pick it up; any other
   `git mv` failure is fatal (exit 1, stderr passthrough) — a half-moved set must be visible, not
   swallowed.
5. Collisions print `skipped (exists in archive): <from>` and never overwrite; exit stays 0 —
   mirrors the garden skill's row-level collision behaviour.
6. Final line: `archived: <n> artifact(s)`.

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
archive call for FD-carrying paths only:

```
pnpm noldor design archive
```

The flip bullet then stages the moved artifacts alongside the FD:

```
pnpm noldor features phase-flip-done <slug>
git add docs/features/<slug>.md docs/design
git diff --cached --quiet || git commit -m "docs(features:<slug>): mark phase=done + archive design artifacts" -m "Noldor-FD: <slug>"
```

`git add docs/design` covers the fs-rename fallback and the deletion half of any rename `git mv`
already staged; the `--cached` emptiness check replaces today's `git diff --quiet <fd>` so a
move-only change (FD body unchanged) still commits. Order matters: archive **before** the flip
commit, so move + `phase: done` + refreshed FD are one commit, and that commit rides the
`origin/main..HEAD` range the code-stage CR reviews. Fast-track / micro-chore keep skipping this
seam entirely.

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
  ├─ noldor design archive                     (git mv spec+plan → archive/)
  ├─ noldor features phase-flip-done <slug>    (phase: done)
  └─ git add docs/features/<slug>.md docs/design && git commit
         └─ pre-commit: sync fd-resources → links.spec/.plan repointed to archive/
```

### Error handling

| Condition                              | Behaviour                                                    |
| -------------------------------------- | ------------------------------------------------------------ |
| No session marker                      | exit 1 + "did you skip the gate scaffold?" hint              |
| Path carries no artifacts (fast-track) | exit 0, explanatory line                                     |
| No matching artifacts / already moved  | exit 0, "nothing to do" (idempotent)                         |
| `archive/<basename>` exists            | skip that artifact, warn, exit 0                             |
| `git mv` fails: untracked artifact     | fs `renameSync` fallback, continue                           |
| `git mv` fails: any other reason       | exit 1, stderr passthrough                                   |
| `specs/` or `plans/` dir missing       | treated as empty, exit 0                                     |

## Acceptance criteria

- `dialogueKeyFromSession` returns `slug` for `*-new`, `<parent>-<enhancement>` for `*-attach`,
  and `null` for `fast-track` / `micro-chore` and for markers missing the fields their path needs.
- `resolveArchivePlan` for an `*-attach` session keyed `<parent>-<enh-a>` selects
  `<date>-<parent>-<enh-a>-design.md` and does **not** select `<date>-<parent>-<enh-b>-design.md`
  or `<date>-<parent>-design.md`.
- `resolveArchivePlan` selects every `-partN` plan whose stripped slug equals the key.
- Entries already inside `archive/` are never re-selected; a name collision lands in `skipped`
  with `reason: 'collision'` and the file is not moved.
- `noldor design archive` in a temp git repo moves a tracked spec + plan with `git mv`, leaves them
  staged, and prints one `archived:` line per artifact; a second run exits 0 with `nothing to do`.
- `noldor design archive` moves an **untracked** spec via the fs fallback (exit 0) and leaves the
  file at the archive path.
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
- `pnpm noldor invariants run` boundaries check stays green (no new cross-domain edge:
  `src/design` imports only `src/core`).
- Every new `src/` file carries a `// @tests:` tag; `pnpm noldor sync test-links` and the
  `validate-script-catalog` gate pass with the new `design archive` manifest entry documented in
  `docs/noldor/script-catalog.md`.

## Risks / trade-offs

- **Attach parent, concurrent enhancements.** The whole reason selection is session-scoped. Two
  enhancements on the same parent each archive only their own dated spec. A same-day, same-parent,
  same-enhancement-slug collision is impossible (the enhancement slug is what disambiguates).
- **Session marker as the authority.** A hand-written or corrupted marker mis-keys the move. Impact
  is bounded: a wrong key matches nothing (exit 0, garden still catches the artifact later). It
  cannot archive a *foreign* feature's spec unless the marker literally names it.
- **Inbound doc links to the moved path.** Any prose elsewhere linking the live spec path breaks on
  the move. Same exposure garden archival already has today; the pre-commit `sync doc-links` check
  runs on the same commit and surfaces it. Not solved here.
- **Fewer garden auto-actions.** `/noldor-garden` output gets much quieter for `feature-done`;
  operators used to that batch will see it only for exceptions. Intended, but it is a behaviour
  change to the sweep ritual.
- **Rename in the CR diff.** Code-stage CR (`--base-sha origin/main`) now sees a rename pair for
  the spec it also reviewed at Step 2.5. Cosmetic noise, and arguably correct: the move is part of
  the feature.
- **`git add docs/design` breadth.** The flip step stages the whole `docs/design` tree, so an
  unrelated dirty artifact under it would be swept into the flip commit. Accepted: at end-of-flow
  the tree is expected clean apart from this session's work, and the alternative (enumerating
  resolved paths through shell) is fragile in the skill prose.
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

# Manual / backfill: archive a specific dialogue key regardless of session marker:
pnpm noldor design archive --slug some-parent-some-enhancement

# No-op paths (fast-track, micro-chore) and re-runs are safe:
pnpm noldor design archive
# design archive: path fast-track carries no design artifacts — skipped
```

Agent surface: the gate calls the CLI between `/noldor-draft-feature-md --refresh` and
`pnpm noldor features phase-flip-done <slug>`, then stages `docs/features/<slug>.md` + `docs/design`
into the single flip commit. Nothing else in the flow changes.

## Open questions (resolved)

1. *What signal selects which artifacts move — the session, or the FD's phase?*
   → **Session-scoped dialogue key** (`slug` on `*-new`, `<parent>-<enhancement>` on `*-attach`),
   filename-matched. FD phase is never consulted for the move. (D1)
   Rationale: a parent FD re-flipping `done` for each attach enhancement would otherwise sweep a
   sibling enhancement's still-live spec.

2. *Where does the move live — inside `phase-flip-done`, a new CLI, or gate prose?*
   → **New portable CLI `noldor design archive`** with the resolution logic in a pure module;
   `phase-flip-done.ts` stays pure md→md. (D2)
   Rationale: keeps a testable seam, works from consumer repos and prose-dispatch runners, and
   matches the `phase-revert` / `roadmap remove-block` precedent.

3. *`git mv` or fs rename, and who stages?*
   → **`git mv`, falling back to fs `renameSync` only when the artifact is untracked**; the gate
   owns the commit, the CLI never commits. (D3)
   Rationale: rename detection plus automatic staging for the normal case, without failing on the
   anomalous untracked one.

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
   → **No** — out of scope; the next `/noldor-garden` pass drains them exactly as today.
   Rationale: backfill is a one-shot doc chore with no code surface, and keeping it out keeps this
   diff reviewable.
