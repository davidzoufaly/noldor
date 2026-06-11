# Release Script: skip-if-only-count-line-changed — Design

- **FD:** `release-script-sddreport-skip-if-only-count-line-changed`
- **Tier:** specs-only
- **Date:** 2026-06-07
- **Area:** tooling

## Problem

`src/release/index.ts` (lines 172-179) regenerates `docs/sdd-report.md` via
`noldor garden sdd-report --release`, then aborts the release if the file is
dirty:

```ts
await runCliCheck('noldor garden sdd-report --release', ['garden', 'sdd-report', '--release']);
const dirtyReport = await run('git', ['status', '--porcelain', 'docs/sdd-report.md']);
if (dirtyReport.length > 0) {
  throw new Error(
    'docs/sdd-report.md has uncommitted changes after sdd-report regen. ' +
      'Commit the regenerated report before releasing.',
  );
}
```

The report's `Review-skip count (last 30 days)` line
(`src/garden/sdd-report.ts:1061-1065`) renders:

```
### Review-skip count (last 30 days)

Gated commits missing `Noldor-Reviewed` trailer: <n>
```

`<n>` counts gated commits in the trailing 30 days with no `Noldor-Reviewed`
trailer. Each in-flight branch commit (sweep regen, release-sweep chore, etc.)
bumps the count. So the release-time regen **always** produces a +1 diff against
the last committed report — even when `/release-sweep` step 5.5 pre-emptively
commits a regen — and the guard aborts. The operator hits one forced
`pnpm release` retry every cycle. Discovered 2026-05-17 during
`release-sweep-process-hardening` part 2.

## Approach

Candidate (a) from the FD, plus fold-into-release-commit: abort only on a
**substantive** report diff. When the sole change is the review-skip count line,
proceed and stage the regenerated report into the `chore(release)` commit so the
accurate count lands on `main` and the working tree ends clean.

Candidate (b) (a `sdd:report` flag that excludes in-flight commits from the
count) is **out of scope** — it changes the report's semantics globally
(dashboard + report meaning shift) to fix a release-only ergonomics gap.

**Scope: narrows, not removes, the forced retry.** This guard only short-circuits
the abort when the review-skip count line is the *sole* delta. Other sections of
`docs/sdd-report.md` can also go dirty between `/release-sweep` step 5.5 and the
release-time regen — `## Gap details` shifts if a sweep commit touches
`docs/features`, and `### Override usage` shifts if a commit carries a
`Noldor-Override` trailer. Either re-triggers the same abort. The count line is
the dominant real-world case (it bumps on *every* in-flight commit, the others
only on specific commit shapes — FD evidence: the +1-per-commit drift is what
made the retry deterministic), so killing it removes the recurring failure; the
non-count cases remain a genuine "operator must review + commit" signal and keep
the existing abort.

## Units

### 1. `src/release/sdd-report-diff.ts` (new, pure, unit-tested)

```ts
export function onlyReviewSkipCountChanged(head: string, working: string): boolean;
```

Returns `true` when `head` and `working` are identical **or** differ *only* in
the review-skip count line; `false` on any other delta.

Implementation: mask the count line in both strings, then strict-equal.

```ts
const COUNT_LINE_RE = /^Gated commits missing `Noldor-Reviewed` trailer: \d+$/m;
const MASK = 'Gated commits missing `Noldor-Reviewed` trailer: <count>';
export function onlyReviewSkipCountChanged(head: string, working: string): boolean {
  return head.replace(COUNT_LINE_RE, MASK) === working.replace(COUNT_LINE_RE, MASK);
}
```

The regex is anchored to the exact line emitted by `sdd-report.ts`. If the line
format ever changes, the mask no-ops on the side missing the pattern → the
strings won't equal → `false` (substantive) — fail-safe toward the existing
abort behavior.

### 2. `src/release/index.ts` guard rewrite (lines 172-179)

After the regen `runCliCheck`:

1. `git status --porcelain docs/sdd-report.md` → clean? proceed (no-op).
2. Dirty: read baseline `git show HEAD:docs/sdd-report.md` and the working file
   from disk.
   - If the baseline read fails (first release / file untracked, no committed
     baseline to compare against) → keep the **existing abort** behavior.
   - Else if `onlyReviewSkipCountChanged(head, working)` → `console.log` a
     "sdd-report differs only in review-skip count; folding regen into release
     commit" note, proceed.
   - Else → abort with the existing error message (real content drift still
     needs operator review).

### 3. Release commit add-list (lines 289-296)

Append `'docs/sdd-report.md'` to the `git add` argument list:

```ts
await run('git', [
  'add',
  'CHANGELOG.md',
  'docs/release-notes.md',
  'docs/sdd-report.md',
  'docs/features',
  'docs/noldor',
  ...lockstepPackages,
]);
```

Unconditional and safe: by the time control reaches the commit, the report is
either clean (`git add` of an unchanged file is a no-op) or count-only-dirty
(rides into the release commit). Substantive diffs already aborted in unit 2.

## Testing

Vitest over `onlyReviewSkipCountChanged`:

| Case | Expected |
| --- | --- |
| identical strings | `true` |
| only the count number differs (`: 8` → `: 9`) | `true` |
| a gap line added/removed | `false` |
| count number **and** a gap both change | `false` |
| count line absent or format-shifted on one side | `false` |

The guard wiring in `index.ts` is exercised end-to-end by the existing release
flow; no new integration test is added for it (matches current `index.ts`
coverage convention — pure helpers are unit-tested, the orchestration is not).

**Known coverage gap:** the actual release-blocking logic lives in the `index.ts`
wiring (the `git show HEAD:` baseline read, the fail-on-missing-baseline →
keep-abort branch, the disk read of the working file), and the unit-only
convention leaves that branch unverified — the risk concentrates in the
orchestration, not the pure helper. Accepted for this slice (the helper carries
the only non-trivial decision; the wiring is straight-line glue), but flagged so
a later integration-test pass over `index.ts` has the entry point.

## Risk / trade-off

The count committed to `main` may be off by the few in-flight commits made after
the release commit itself — but the metric is a rolling 30-day window where
±a-few is noise, and the next release's regen self-corrects. Net: one fewer
forced retry per release, accurate baseline carried forward, clean working tree.
