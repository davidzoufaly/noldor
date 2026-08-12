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

Six units. The first three are new and live in `src/clones/diff-scope.ts` — two pure, with git I/O
isolated behind the `RunGit` seam already used by `src/core/branch-added.ts`. The last three are
wiring: the CLI, the config schema, and the lefthook job.

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
3. ```
   git -c core.quotepath=false -c diff.relative=false \
       diff -U0 --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ -M <mergeBase>
   ```
   `git diff` is porcelain and honours consumer config, and this parser is fail-open — a header shape
   it does not recognize yields zero files, which the design defines as a legitimate green. So every
   config that can reshape the output is pinned rather than trusted:
   - `core.quotepath=false` — otherwise non-ASCII paths arrive C-quoted (`"src/caf\303\251.ts"`) and
     never match a `loadCorpus` key.
   - `diff.relative=false` — otherwise paths are emitted relative to `cwd`, not the repo root.
   - `--src-prefix=a/ --dst-prefix=b/` — otherwise the header is `+++ <path>` (`diff.noprefix`),
     `+++ w/<path>` (`diff.mnemonicPrefix`), or anything at all (`diff.srcPrefix` / `diff.dstPrefix`,
     git ≥ 2.45), and Unit 1's `+++ b/<path>` match parses nothing. Explicit command-line options
     override all four settings, so no `-c diff.*prefix` pins are needed — the flags subsume them.
   - `--no-ext-diff` — otherwise `diff.external` replaces the output wholesale.

   `renameDestExists` (`src/core/branch-added.ts:216-227`) already pins the first two for exactly this
   reason; this call extends the same guard.

   **One ref, no `..HEAD`.** With a single ref the
   post-image is the *working tree*, which is exactly what `loadCorpus`
   (`src/clones/clones-cli.ts:53-65`) reads off disk. A `<mergeBase>...HEAD` range would compare
   against `HEAD` instead, so every uncommitted edit would shift the corpus's real line numbers away
   from the parsed ranges and the overlap test would compare two different files.
4. Every git failure reaching *this* unit — no upstream and no origin, no merge base, not a repo, git
   absent — returns `null`, not an empty map. `null` means "unknown": the caller skips the diff-scoped
   verdict with a stderr note and stays green. An empty map means "nothing changed" and is a legitimate
   green. Conflating them would turn a broken git into a silent pass claiming it had checked.

   An unresolvable *explicit* ref never reaches here — Unit 4's `validateAgainstRef` runs first and
   returns 3. So this unit keeps a single return contract and no CLI-layer error type leaks into it.
   A ref that resolves but has no merge base with `HEAD` (shallow clone, unrelated history) *does*
   reach here and is green: the caller's base was usable, the repository just cannot relate it to
   `HEAD`.

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

**Explicit-ref validation runs first** — `validateAgainstRef`, before the `diffScope` gate and before
any detection work. When `args.against` is set and
`git rev-parse --verify --end-of-options <ref>^{commit}` fails, `runClones` writes the reason to
stderr and returns **3**. (`--end-of-options` so a value starting with `-` is read as a ref, not an
option.) When `--against` is absent, nothing here runs.

The rule is **who chose the base**, and nothing else:

- **The caller named a base** → that base must be usable. Whether it is unusable because the name is
  wrong, because the clone is shallow, or because a `--single-branch` / narrowed refspec never fetched
  it makes no difference: all three are caller-side configuration the caller can fix, and the fix is
  named in the error (`check the ref name; for CI use fetch-depth: 0 and an unrestricted refspec`).
  Staying green here is the failure mode D1 exists to kill — a CI job wired to a base it cannot see,
  reporting success forever.
- **Nobody named a base** → the gate resolved one on its own, so it owns the failure. Every git
  problem downstream is fail-open green with a stderr note. A repo with no upstream and no origin is a
  normal state, not an error, and the pre-push job runs with no flags.

An earlier revision tried to soften the first case by probing
`git rev-parse --is-shallow-repository` and going green when shallow. Dropped: a full-depth
`--single-branch` clone is not shallow yet equally cannot resolve the ref, so the probe answered a
question ("is this a typo?") that is not locally decidable, and split one rule into three branches to
do it. Strictness keyed on an explicit flag needs no such inference.

Three things make this seam the right one. It lives in the CLI layer, where exit 3 already lives — the
existing `try/catch` at `src/clones/clones-cli.ts:79-85` wraps `parseClonesArgs` *only*, so an error
thrown later from `resolveChangedRanges` would fall through to the direct-invocation `.catch` and exit
**1**, merging "could not look" with "found duplication". It runs ahead of the `clones.diffScope`
check, so `--against <typo>` still exits 3 in a repo that has diff-scoping switched off — a flag the
caller passed is never silently ignored. And it separates *ref resolution* from *merge-base
resolution*: a resolvable ref whose merge-base fails is Unit 2's fail-open green, not a usage error.

`UsageError` stays module-private (`src/clones/clones-cli.ts:27`); nothing new needs to throw it, and
`diff-scope.ts` never imports a CLI error type.

The `check` branch then becomes a **union** of two independent verdicts; exit 1 if either is red:

- **Diff-scoped** — skipped when `clones.diffScope === false` or when `resolveChangedRanges` returned
  `null` (stderr note names the reason). Otherwise red when `flaggedGroups` is non-empty, printing one
  line per group in the existing `renderSummary` span format
  (`file:start-end and file:start-end (N tokens)`) — **every** flagged group, uncapped. The 10-group
  cap in `renderSummary` (`src/clones/clones-cli.ts:71`) exists because a whole-corpus report is
  unbounded; a diff-scoped list is bounded by what the author just wrote, and truncating it would hide
  a blocker the push must fix.
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

Every *discovered* failure mode degrades to green with a stderr note, never a throw: a clone gate that
crashes a push is worse than one that misses a clone. This mirrors `check-template-sync`'s `catch` and
the `loadConfig(...).catch(() => null)` already in `runClones` (`src/clones/clones-cli.ts:87`).

The one carve-out is an **explicit `--against <ref>` that does not resolve**, which exits 3 from
`validateAgainstRef`. That is not a discovered failure — it is the caller's own argument being
unusable, the same class as an unknown flag, and the only case where staying green would mean
honouring an instruction nobody can execute. Everything reached *after* that check — including a
resolvable base with no merge base — is discovered, and stays green.

### Testing

`src/clones/__tests__/diff-scope.test.ts`, tagged `// @tests: code-clone-detector`:

- `parseUnifiedDiffRanges`: multi-hunk single file; multi-file; the count-omitted `@@ -1 +1 @@` form;
  deletion-only `+12,0` contributing nothing; a `/dev/null` post-image contributing nothing; a rename
  header keying on the new path.
- `resolveChangedRanges` with a fake `RunGit`: `--against` honoured verbatim; `@{upstream}` preferred
  when it resolves; `resolveDefaultBase` used when it does not; `null` on a failing `merge-base`
  (whatever the ref's origin); and an argv assertion that the diff call pins `core.quotepath=false`
  and `diff.relative=false` and passes `--no-ext-diff --src-prefix=a/ --dst-prefix=b/` — the guard is
  invisible at runtime (it prevents a silent green), so only a test keeps it from being dropped.
- `validateAgainstRef` with a fake `RunGit`: unresolvable `--against` → exit 3, with `clones.diffScope`
  on **and** off; resolvable `--against` → validation passes through; no `--against` → the verify call
  is never made at all; and an argv assertion that the verify call carries `--end-of-options` (a
  ref beginning with `-` must reach git as a ref).
- `flaggedGroups`: instance inside → flagged; wholly outside → not; straddling → flagged; all-inside →
  flagged; overlap at exactly one shared line (boundary) → flagged; same line numbers in a *different*
  file → not.

`src/clones/__tests__/clones-cli.test.ts` extends its existing `fixtureRepo` harness with real `git
init` cases (precedent: `src/garden/detectors/__tests__/allowlist-drift.test.ts`,
`src/prep/__tests__/prep-promote.test.ts`): committed baseline plus an added duplicate → exit 1 naming
both spans; `clones.diffScope: false` → exit 0; a non-git directory → exit 0 with the stderr note; a
tuned `thresholdPct` still red on its own. Plus the two fail-open shapes, which must never exit 3: a
resolvable `--against` whose `merge-base` fails, and no `--against` with no resolvable base.

## Acceptance criteria

- `noldor clones check --against <ref>` exits 1 when a clone group has an instance overlapping a line
  changed since `merge-base(<ref>, HEAD)`, and prints every offending group's spans.
- `noldor clones check` with no flags resolves the base itself (`@{upstream}`, else `origin/HEAD`,
  else `origin/main`) and behaves identically.
- A clone group entirely outside the changed lines does not fail the check.
- A group whose instances are all inside the changed lines fails the check.
- Uncommitted edits to **tracked** files are covered: line numbers in the verdict match the files on
  disk. (An untracked new file has no post-image in `git diff`, so a clone pasted there is reachable
  only through its other instance — moot at pre-push, where it is committed.)
- `clones.diffScope: false` disables the diff-scoped verdict; the corpus threshold still applies.
- With `clones.thresholdPct` unset and no clone touching the diff, `check` exits 0 and still prints the
  `no clones.thresholdPct configured - green` line.
- Outside a git repo, or with no *auto-resolvable* base, `check` exits 0 and writes the reason to
  stderr.
- An explicit `--against <ref>` that does not resolve exits **3** (usage error), never a silent green
  — including when `clones.diffScope` is `false`, and whatever the cause (wrong name, shallow clone,
  narrowed refspec). The message names all three fixes.
- An explicit `--against <ref>` that resolves but has no merge base with `HEAD` exits 0 with the
  stderr note, not 3.
- The diff invocation pins `core.quotepath=false` and `diff.relative=false` and passes
  `--no-ext-diff --src-prefix=a/ --dst-prefix=b/`, so a consumer's git config cannot reshape the
  output into a silent green.
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
- **A narrow clone is usually un-gated, and the failure shape depends on which half breaks.** CI with
  `fetch-depth: 1` or `--single-branch` can fail two different ways. If the base ref itself is absent,
  an explicit `--against` exits 3 and a resolved base exits 0 with a note. If the ref is present but
  history is truncated (`fetch-depth: 50`), it *resolves*, so `merge-base` is what fails — and that is
  green with a note on **both** paths, flag or no flag. So the loud failure covers only the
  ref-missing-and-named case; every other narrow-clone shape is a silent-but-noted skip. A consumer
  who wants this gate meaningful in CI needs `fetch-depth: 0` and an unrestricted refspec regardless.
- **A dirty working tree can red a push of clean commits.** D6's post-image is the working tree, so
  uncommitted local edits count as "your diff" even though they are not being pushed. Consistent with
  the corpus `loadCorpus` reads — the alternative misaligns line numbers — but it is a consumer-facing
  surprise worth naming.
- **`cwd` must be the repo root.** Corpus keys are `cwd`-relative (`src/clones/clones-cli.ts:58`,
  `abs.slice(cwd.length + 1)`) while pinned `diff.relative=false` makes diff paths repo-root-relative.
  Run from a subdirectory the two never match and the gate is a silent green. Moot in practice — pnpm
  scripts and lefthook both run at the root — so this slice documents the assumption rather than
  adding a `rev-parse --show-toplevel` normalization nobody exercises.
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

Exit codes: **0** green (or skipped with a stderr reason), **1** duplication found, **3** a usage error
— today an unknown flag or a non-numeric `--min-tokens` (`src/clones/clones-cli.ts:79-85`), and now
also an explicit `--against <ref>` that does not resolve.

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
   -> **Split by who chose the base** (D2, D8, D9, D10). Exactly one case exits 3: an explicit
   `--against <ref>` that does not resolve. Cause is irrelevant — wrong name, shallow clone, narrowed
   refspec are all caller-side configuration, and the error names all three fixes. Every other failure
   — no upstream, no origin, no merge base, not a repo — belongs to a base the gate picked for itself,
   so `resolveChangedRanges` returns `null` (distinct from an empty map) and the check exits green with
   a stderr note; "unknown" is never rendered as "checked and clean". An earlier revision probed
   `--is-shallow-repository` to spare shallow CI; dropped, because a full-depth `--single-branch` clone
   defeats it and the question it asked ("typo or absence?") is not locally decidable.
