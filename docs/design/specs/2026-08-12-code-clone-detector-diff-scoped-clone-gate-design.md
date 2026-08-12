# Diff-Scoped Clone Gate — Design

**Slug:** diff-scoped-clone-gate
**FD:** docs/features/code-clone-detector.md
**Date:** 2026-08-12
**Tier:** specs-only
**Deps:** none

## Problem

`noldor clones check` gates on `clones.thresholdPct` — a whole-corpus duplication percentage
(`src/clones/clones-cli.ts:100-114`). An unset threshold short-circuits green:

```
clones check: no clones.thresholdPct configured - green
```

That number is unusable for a consumer. It drifts as the repo grows, there is no principled value to
pick, and picking one wrong either blocks every push or blocks nothing. So nobody sets it, the branch
short-circuits, and the detector — which does find real duplication — never gates anything. The
detector is already load-bearing elsewhere (`sdd-report` surfaces its groups), so the gap is purely in
the gate.

A diff-scoped verdict needs no tuning at all: fail when *this change* introduces or touches a
duplicated span. The question "did you just write a copy of something that already exists?" has a
correct answer independent of repo size, so it can be default-on in `templates/lefthook/noldor.yml`.

## Goals

- `noldor clones check --against <ref>` fails when a clone group has at least one instance overlapping
  the lines this change wrote.
- Zero required configuration. The flag is optional; the pre-push job runs with no arguments.
- Report the duplicated spans (`src/foo.ts:12-40 and src/bar.ts:88-116`) so the failure is actionable.
- Default-on as a blocking pre-push job in the framework lefthook block.
- No behaviour change for a consumer who tuned `clones.thresholdPct`.

## Non-goals

- The clone-duplication **ratchet** (baseline in `.noldor/clones-baseline.json`, fail on increase).
  Recovered as roadmap entry `Q-0094 Clone-Duplication Ratchet` when this slice was promoted.
- Changes to detection itself (`src/clones/detect.ts`, `src/clones/tokenize.ts`). The report already
  carries per-instance `{ file, startLine, endLine }`, which is everything diff-scoping needs.
- `clones report --against`. The failing `check` prints its spans; a separate preview mode is not
  earning its keep yet.
- Type-4 (semantic) clones — out of scope for the parent FD too.

## Design

Three units, all in `src/clones/diff-scope.ts` except the wiring. Two are pure; git I/O is isolated
behind the `RunGit` seam already used by `src/core/branch-added.ts`.

### Unit 1 — `parseUnifiedDiffRanges(diff: string): Map<string, LineRange[]>` (pure)

Parses `git diff -U0` output into post-image line ranges per file.

- `+++ b/<path>` sets the current file. `/dev/null` (deletion) clears it.
- `@@ -a,b +c,d @@` contributes `{ start: c, end: c + d - 1 }`. The count is optional in the unified
  format (`@@ -1 +1 @@` means one line), so a missing `,d` reads as `1`.
- `d === 0` is a deletion-only hunk — no post-image lines exist, so it contributes nothing. Emitting
  `{ start: c, end: c - 1 }` here would be an inverted range that silently matches nothing or
  everything depending on the overlap test; dropping it is explicit.
- Files with no surviving ranges are absent from the map rather than present-and-empty.

`LineRange` is `{ readonly start: number; readonly end: number }`, both 1-based inclusive — the same
convention as `CloneInstance.startLine` / `endLine` (`src/clones/detect.ts:5-9`).

### Unit 2 — `resolveChangedRanges(opts): Map<string, LineRange[]> | null` (git I/O)

```ts
interface ResolveChangedRangesOptions {
  cwd?: string;
  against?: string;   // --against <ref>; default resolved below
  runGit?: RunGit;    // test seam, imported from ../core/branch-added.js
}
```

1. Resolve the base: `opts.against` when given; otherwise `@{upstream}` when
   `git rev-parse --abbrev-ref @{upstream}` succeeds; otherwise `resolveDefaultBase(run)`.
   `resolveDefaultBase` (`src/core/branch-added.ts:52`) reads
   `refs/remotes/origin/HEAD` and falls back to `origin/main`, so a consumer whose default branch is
   not `main` is not fail-closed. `@{upstream}` first mirrors `resolveChangedFiles`
   (`src/checks/check-template-sync.ts:59`) — on a feature branch that is the honest base.
2. `mergeBase = git merge-base <base> HEAD`.
3. `git diff -U0 --no-color -M <mergeBase>` — **one ref, no `..HEAD`**. With a single ref the
   post-image is the *working tree*, which is exactly what `loadCorpus`
   (`src/clones/clones-cli.ts:53-65`) reads off disk. A `<mergeBase>...HEAD` range would compare
   against `HEAD` instead, so every uncommitted edit would shift the corpus's real line numbers away
   from the parsed ranges and the overlap test would compare two different files.
4. Any git failure (no upstream *and* no origin, no merge base, not a repo, git absent) returns
   `null`, not an empty map. `null` means "unknown" and the caller skips the diff-scoped verdict with
   a stderr note; an empty map means "nothing changed" and is a legitimate green. Conflating them
   would turn a broken git into a silent pass claiming it had checked.

`-M` matches `discoverAddedFiles` (`src/core/branch-added.ts:88-98`): a renamed file's post-image path
is its new path, which is the key `loadCorpus` uses.

### Unit 3 — `flaggedGroups(report, ranges): readonly CloneGroup[]` (pure)

Returns groups with **at least one** instance overlapping a changed range in the same file. Overlap is
`inst.startLine <= r.end && r.start <= inst.endLine`.

The predicate is deliberately "≥ 1 inside", not the roadmap's "≥ 1 inside and ≥ 1 outside": a group
whose instances are *all* inside the diff is a block pasted twice within one change — the purest case
the gate exists to stop, and excluding it would be a hole an author can drive through.

`src/clones/detect.ts:62` has a local `overlaps` helper, but it is unexported and operates on token
indices inside the detection pipeline. Reaching into it would couple the gate to detection internals
for a one-line comparison; `flaggedGroups` states its own line-domain test.

### Unit 4 — `runClones` wiring (`src/clones/clones-cli.ts`)

`parseClonesArgs` gains `--against <ref>` → `ClonesArgs.against?: string`. `report` ignores it (a
`--against` on `report` is a usage error, consistent with how the parser rejects unknown flags).

The `check` branch becomes a **union** of two independent verdicts; exit 1 if either is red:

- **Diff-scoped** — skipped when `clones.diffScope === false` or when `resolveChangedRanges` returned
  `null` (stderr note names the reason). Otherwise red when `flaggedGroups` is non-empty, printing one
  line per group in the existing `renderSummary` span format
  (`file:start-end and file:start-end (N tokens)`), capped at the same 10 groups.
- **Corpus threshold** — today's code, unchanged, including the `no clones.thresholdPct configured -
  green` line when unset.

Both verdicts always print, so the output says which gate spoke.

### Unit 5 — config

`clonesConfigSchema` (`src/core/config.ts:182-187`) gains
`diffScope: z.boolean().optional().catch(undefined)`. Unset means **on** — the field exists only as an
escape hatch. `.catch(undefined)` keeps the block's existing property: a typo degrades the field to
unset rather than throwing out of every `loadConfig` caller.

### Unit 6 — pre-push job

`templates/lefthook/noldor.yml` and its synced twin `lefthook/noldor.yml` (byte-identical today;
`pnpm noldor checks template-sync` enforces it) gain a job in the `pre-push` block:

```yaml
    - name: noldor-clones
      run: pnpm noldor clones check
```

Measured cost of a full corpus pass on this repo: **0.48s** — affordable for a blocking pre-push job.

### Data flow

```
argv --against? ─┐
                 ├─> resolveChangedRanges ──> Map<file, LineRange[]> | null ─┐
git (merge-base, ─┘                                                          ├─> flaggedGroups ─> exit
     diff -U0)                                                               │
loadCorpus(cwd) ──> detectClones ──> CloneReport ────────────────────────────┘
```

### Error handling

Every failure mode degrades to green with a stderr note, never a throw: a clone gate that crashes a
push is worse than one that misses a clone. This mirrors `check-template-sync`'s `catch` and the
`loadConfig(...).catch(() => null)` already in `runClones` (`src/clones/clones-cli.ts:87`).

### Testing

`src/clones/__tests__/diff-scope.test.ts`, tagged `// @tests: code-clone-detector`:

- `parseUnifiedDiffRanges`: multi-hunk single file; multi-file; the count-omitted `@@ -1 +1 @@` form;
  deletion-only `+12,0` contributing nothing; a `/dev/null` post-image contributing nothing; a rename
  header keying on the new path.
- `resolveChangedRanges` with a fake `RunGit`: `--against` honoured verbatim; `@{upstream}` preferred
  when it resolves; `resolveDefaultBase` used when it does not; `null` on a failing `merge-base`.
- `flaggedGroups`: instance inside → flagged; wholly outside → not; straddling → flagged; all-inside →
  flagged; overlap at exactly one shared line (boundary) → flagged; same line numbers in a *different*
  file → not.

`src/clones/__tests__/clones-cli.test.ts` extends its existing `fixtureRepo` harness with real `git
init` cases (precedent: `src/garden/detectors/__tests__/allowlist-drift.test.ts`,
`src/prep/__tests__/prep-promote.test.ts`): committed baseline plus an added duplicate → exit 1 naming
both spans; `clones.diffScope: false` → exit 0; a non-git directory → exit 0 with the stderr note; a
tuned `thresholdPct` still red on its own.

## Acceptance criteria

- `noldor clones check --against <ref>` exits 1 when a clone group has an instance overlapping a line
  changed since `merge-base(<ref>, HEAD)`, and prints every offending group's spans.
- `noldor clones check` with no flags resolves the base itself (`@{upstream}`, else `origin/HEAD`,
  else `origin/main`) and behaves identically.
- A clone group entirely outside the changed lines does not fail the check.
- A group whose instances are all inside the changed lines fails the check.
- Uncommitted working-tree edits are covered: line numbers in the verdict match the files on disk.
- `clones.diffScope: false` disables the diff-scoped verdict; the corpus threshold still applies.
- With `clones.thresholdPct` unset and no clone touching the diff, `check` exits 0 and still prints the
  `no clones.thresholdPct configured - green` line.
- Outside a git repo, or with no resolvable base, `check` exits 0 and writes the reason to stderr.
- `noldor clones report` output is byte-identical to today's.
- `pnpm noldor checks template-sync` passes with the new pre-push job in both lefthook copies.

## Risks / trade-offs

- **A blocking default-on gate can red a consumer's first push after upgrade.** That is the intent —
  it only fires on spans they are actively editing — but the failure arrives without warning. Mitigated
  by the actionable span output and the `clones.diffScope: false` escape hatch.
- **Editing one line inside a pre-existing clone fires the gate.** The author did not create the
  duplication, only touched it. Accepted: maintaining a clone is exactly when it is cheapest to hear
  about it, and the precise alternative ("was this span *added* wholesale?") needs origin analysis this
  slice does not buy.
- **Detection tuning still matters.** `minTokens: 50` (`src/clones/detect.ts:37-41`) governs what counts
  as a clone at all. Diff-scoping removes the *gate* tuning knob, not the *detector* one.
- **Self-gating.** This repo has live clone groups today (e.g.
  `src/features/phase-flip-done-cli.ts:4-29` ↔ `src/features/phase-revert-cli.ts:4-29`, 199 tokens).
  Once the job is wired, a later change touching either span is blocked until the duplication is
  resolved. Correct behaviour; noted so it is not mistaken for a bug.
- **Whole-corpus tokenization on every push** — O(repo), 0.48s here. A consumer with a much larger
  corpus pays more. Not optimized in this slice; the fast path (skip when no code file changed) is
  deliberately deferred rather than guessed at.

## User Story

As a developer or agent pushing a change, I want the clone check to fail only on duplication my own
diff introduced or touched, so that the gate is meaningful with zero tuning and can be on by default
instead of permanently green.

## Usage

```bash
# explicit base
pnpm noldor clones check --against origin/main

# base resolved automatically (@{upstream}, else origin/HEAD, else origin/main)
pnpm noldor clones check
```

Red output:

```
clones check: 1 group(s) duplicated in this change
  src/clones/diff-scope.ts:12-40 and src/core/branch-added.ts:88-116 (207 tokens)
clones check: no clones.thresholdPct configured - green
```

Runs automatically as the `noldor-clones` pre-push job. Opt out in `.noldor/config.json`:

```json
{ "clones": { "diffScope": false } }
```

## Open questions (resolved)

1. *File granularity or changed-line granularity for "inside the diff"?*
   -> **Changed lines**, via `git diff -U0` hunk headers (D1). File-level fires on pre-existing clones
   in merely-touched files — the same untunable noise `thresholdPct` already produces.
2. *Is `--against` required, and what range semantics?*
   -> **Optional**, defaulting to `@{upstream}` then `resolveDefaultBase()` (D2, D7); the diff runs
   against `merge-base` with a single ref so the post-image is the working tree (D6). A required flag
   would keep the gate out of pre-push, which is the entry's whole payoff. D6 supersedes D2's original
   `<base>...HEAD` clause, and D7 supersedes its hardcoded `origin/main`.
3. *Does diff-scoping replace `clones.thresholdPct`?*
   -> **No — union** (D3). Both verdicts run; red if either trips. Deleting the field would break a
   consumer who tuned it, for no gain.
4. *Should a group whose instances are all inside the diff fail?*
   -> **Yes** (D5). The predicate is "≥ 1 instance inside", a deliberate relaxation of the roadmap's
   "≥ 1 in and ≥ 1 out"; a fresh copy-paste inside one change is the case the gate most wants.
5. *Blocking or warn-only in pre-push?*
   -> **Blocking**, with a `clones.diffScope: false` opt-out (D4). A non-blocking gate is one nobody
   reads, and flipping it later costs another cycle.
6. *What happens when git cannot answer?*
   -> **Skip the diff-scoped verdict, exit green, explain on stderr** (D2). `resolveChangedRanges`
   returns `null` (distinct from an empty map) so "unknown" is never rendered as "checked and clean".
