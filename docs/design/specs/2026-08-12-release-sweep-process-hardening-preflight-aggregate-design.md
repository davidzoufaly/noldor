# Release Preflight Aggregate — Design

**Slug:** release-sweep-process-hardening-preflight-aggregate
**FD:** docs/features/release-sweep-process-hardening.md (attach — parent FD; no child FD)
**Date:** 2026-08-12
**Tier:** specs-only
**Entry:** Q-0068 (`release-preflight-aggregate`)
**Deps:** none

## Problem

Release prep aborts one gate at a time. The precondition ladder in
[`src/release/index.ts:330-393`](../../../src/release/index.ts) is a sequence of throwing guards:

```
assertNoInProgressRelease → ensureCleanTreeOnMain → ensureGhAvailable
→ ensureGraphFresh → autoStampOnCleanDetect → ensureGardenFresh
→ (consumer scripts) → sdd-report regen + dirty check
→ validate features → garden detect --gate-compliance → CR gate
```

Every one of them `throw`s on the first problem it finds, so an operator with four independent
staleness problems — a leftover `.noldor/session.json`, a stale `graphify-out/graph.json`, a stale
`.noldor/garden-receipt`, and a drifted `docs/sdd-report.md` — discovers exactly one per full
pipeline re-run. That is the friction that dominated PRs #230-#237: four aborts, four remediation
loops, four re-runs, before the release even reached version derivation.

`NOLDOR_RELEASE_DRY_RUN=1` ([`index.ts:439`](../../../src/release/index.ts)) already runs the
preconditions and stops before mutation, but it inherits the same fail-fast abort — it tells the
operator *a* gate is red, never *which* gates are red.

The same release also taught a second lesson with no gate at all: npm's new-package moderation
rejected the unscoped name `noldor` as "too similar to `color`", forcing `@david.zoufaly/noldor`.
`noldor init` and the adoption docs promise a package name that nothing verifies.

## Goals

- One invocation reports **every** failing release gate at once, each with a copy-pasteable remedy.
- The real release pipeline uses the **same** gate evaluations — no second copy of the conditions to
  drift out of sync.
- The three genuinely mechanical remedies can be applied automatically on request.
- The npm package name is probed before tagging, with an honest verdict about what can and cannot
  be checked ahead of a publish.

## Non-goals

- **Running the consumer's expensive scripts.** `typecheck`, `test`, `test:smoke`, `test:e2e`,
  `build`, `docs:build` and the `docs/user/` drift check that follows `docs:build` stay exactly
  where they are in the pipeline (after the aggregate) and are not run by preflight (D1). Running
  the suite twice doubles release wall-clock for no new signal; a test red is already loud and
  locally reproducible with `pnpm test`.
- **Predicting npm moderation.** npm's similarity rule is undisclosed; a heuristic that reports
  "looks fine" and is then overruled at publish is worse than an honest warning (D8).
- **Replacing `NOLDOR_RELEASE_DRY_RUN=1`.** Dry-run additionally derives the previous tag, bump
  level and next version. It stays as-is.
- **Auto-committing anything.** No remedy in this feature writes git history.

## Design

### Unit 1 — `PreflightRow` and the probe contract (`src/release/preflight.ts`)

The report row is the whole interface. It borrows the shape already proven by
[`PrereqCheck`](../../../src/core/prerequisites.ts) (`src/core/prerequisites.ts:77`), which
`noldor doctor` uses to print every prerequisite, drift and runner failure before exiting 1:

```ts
export type PreflightStatus = 'ok' | 'blocking' | 'warn' | 'skipped';

/** Closed set — one id per probe in Unit 2. A union, not string, so a typo is a type error. */
export type PreflightRowId =
  | 'session-marker' | 'release-state' | 'branch' | 'tree-clean' | 'origin-sync'
  | 'gh-auth' | 'graph-freshness' | 'garden-receipt' | 'sdd-report'
  | 'validate-features' | 'gate-compliance' | 'cr-gate' | 'npm-name';

export interface PreflightRow {
  /** Stable, unique row id — 'session-marker', 'graph-freshness', … */
  id: PreflightRowId;
  status: PreflightStatus;
  /** What was observed. Always populated, including on 'ok'. */
  detail: string;
  /** Copy-pasteable operator remedy. Present on every 'blocking' and 'warn' row. */
  fix?: string;
}
```

`blocking` aborts a release. `warn` never does. `skipped` records a check that did not apply
(feature untracked, override env set, publish disabled) and carries the reason in `detail` — a
silently absent row would read as a pass.

### Unit 2 — the probes (`src/release/preflight-probes.ts`)

One function per row, each returning a `PreflightRow` and each taking its inputs explicitly so it is
unit-testable without a live repo. Wherever a pure evaluator already exists, the probe wraps it
rather than re-deriving the condition:

| Row id | Source of truth | Notes |
| --- | --- | --- |
| `session-marker` | `readSession` + `isSessionStale` + `resolveSessionTtlHours` | Reads the marker **before** `withReleaseSession` can overwrite it (D3). A `path: 'release-automation'` marker is **not** foreign — `withReleaseSession` deliberately falls through on it today (a crashed prior release) — so it maps to `warn` pointing at the `release-state` row and `--resume`, never to a generic foreign-marker `blocking` |
| `release-state` | `readReleaseState` | Replaces `assertNoInProgressRelease`; fix names `--resume` and the discard pair |
| `branch` / `tree-clean` / `origin-sync` | new `inspectTreeState()` in `clean-tree.ts` | Three rows from what is today one throw with three causes |
| `gh-auth` | `gh --version` + `gh auth status` | Replaces index-local `ensureGhAvailable` |
| `graph-freshness` | `graph-freshness.ts` freshness comparison | `skipped` when `graphify-out/graph.json` is untracked, as today |
| `garden-receipt` | `evaluateGardenFreshness` (already pure, returns `{ok, reason}`) | No refactor needed |
| `sdd-report` | regen to a temp path + `onlyVolatileSectionsChanged` | See Unit 4 |
| `validate-features` | `noldor validate features` exit code | |
| `gate-compliance` | `noldor garden detect --gate-compliance` exit code | `skipped` + `appendOverrideLog` under `RELEASE_SKIP_GATE_COMPLIANCE=1` |
| `cr-gate` | `checkCrGate` (already returns `{ok, reason, offenders}`) | `skipped` when `previousTag === 'v0.0.0'` or `RELEASE_SKIP_CR_GATE=1` |
| `npm-name` | `npm view` probe | See Unit 5 |

Three call sites are refactored, not duplicated:

- `clean-tree.ts` gains `inspectTreeState(): Promise<{branch, dirty, aheadBehind}>`;
  `ensureCleanTreeOnMain` becomes a thin throwing wrapper over it, because
  [`release-publish.ts:159`](../../../src/release/release-publish.ts) (`--local` emergency publish)
  still needs the throwing form.
- `graph-freshness.ts` gains `evaluateGraphFreshness()` returning a verdict; the throwing
  `ensureGraphFresh` is **deleted** — `index.ts` was its only non-test caller.
- `ensureGardenFresh` is **deleted** from the release path; the pure `evaluateGardenFreshness` it
  wrapped is what the probe calls. (`garden-receipt.ts` keeps the pure function for other callers.)

`findPreviousTag()` is called **inside** `runPreflight`, not hoisted into `main()`: `cr-gate` and
`npm-name` both need it, and a fast-forward applied by `--fix` can bring new tags with it, so it must
be read after the fix pass (see Unit 3). Its existing `v0.0.0` fallback for a tagless repo is
preserved.

### Unit 3 — orchestration, rendering, fixes

```ts
// preflight.ts
export interface PreflightInput {
  cwd: string;
  scanPaths: string[];
  sessionAtEntry: SessionMarker | null;
  nowMs: number;
  sddReportOut: 'canonical' | 'temp';   // see Unit 4
  fixes: ReadonlySet<PreflightRowId>;   // rows to auto-remediate; empty = report-only
}
export async function runPreflight(input: PreflightInput): Promise<PreflightRow[]>;
export function hasBlocking(rows: readonly PreflightRow[]): boolean;
export function blockingIds(rows: readonly PreflightRow[]): PreflightRowId[];
export function countBlocking(rows: readonly PreflightRow[]): number;

// preflight-render.ts
export function renderPreflight(rows: readonly PreflightRow[]): string;

// preflight-fix.ts
/** Ordered: ref-moving fixes first, so pass 2 evaluates against the final tree. */
export const SAFE_FIXES: readonly PreflightRowId[];    // ['origin-sync', 'session-marker', 'garden-receipt']
export async function applyFix(id: PreflightRowId, cwd: string): Promise<string | null>;
```

**Two passes, never a partial re-probe.** Report-only is the default — with `fixes` empty there is a
single evaluation pass and nothing is mutated (D5). When `fixes` is non-empty, `runPreflight` runs:

- **Pass 1 (fix pass)** — evaluate *only* the ids in `fixes`, in `SAFE_FIXES` order, and apply each
  guarded remedy, echoing what it did. `origin-sync` is deliberately first because it is the only
  remedy that moves refs.
- **Pass 2 (report pass)** — evaluate **every** row from scratch against the post-fix tree, including
  `findPreviousTag()`. Pass 2's rows are the ones rendered and returned.

Re-probing only the fixed row would be wrong: an `origin-sync` fast-forward can pull commits that
invalidate `graph-freshness`, `sdd-report`, `validate-features` and `cr-gate`, and can bring new tags
that change `previousTag` — so a row evaluated before the merge could be reported green when it is no
longer true. A full second pass costs one extra evaluation of cheap probes and is bounded at exactly
two passes; there is no fix→re-probe loop.

`SAFE_FIXES` is exactly three, and each is guarded so it cannot destroy operator state:

1. `session-marker` — remove `.noldor/session.json` **only** when `isSessionStale` says it is past
   the TTL. A live gate session is never deleted; it stays `blocking` with the `rm` in its `fix`.
2. `origin-sync` — `git merge --ff-only origin/main` **only** when local main is strictly behind and
   the tree is clean. Diverged or dirty stays `blocking`.
3. `garden-receipt` — delegate to the existing
   [`autoStampOnCleanDetect`](../../../src/release/auto-restamp.ts), which already stamps only when
   `garden detect` comes back clean.

Everything else carries a `fix` line the operator runs. Nothing regenerates the graph, nothing
commits, nothing touches a dirty tree.

`renderPreflight` orders rows `blocking → warn → ok → skipped`, then closes with a counts line and a
literal `not run (not covered by preflight): typecheck test test:smoke test:e2e build docs:build`
line — so the actionable part is read first, and the coverage gap from D1 is stated on screen rather
than left for the operator to infer from a green report.

### Unit 4 — wiring into `index.ts`

```ts
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const resume = argv.includes('--resume');
  const preflightOnly = argv.includes('--preflight');
  const wantFix = argv.includes('--fix');

  // Read the marker BEFORE withReleaseSession can overwrite it (D3).
  const sessionAtEntry = readSession(process.cwd());
  const { lockstepPackages, name: cfgName, scanPaths } = loadConsumerConfig();

  // --- preflight-only: report and exit, writing no tracked file ---
  if (preflightOnly) {
    const rows = await runPreflight({
      cwd: process.cwd(), scanPaths, sessionAtEntry,
      nowMs: Date.now(), sddReportOut: 'temp',
      fixes: wantFix ? SAFE_FIXES : new Set(),
    });
    console.log(renderPreflight(rows));
    process.exitCode = hasBlocking(rows) ? 1 : 0;
    return;                          // never enters withReleaseSession
  }

  // --- resume: the aggregate is SKIPPED entirely (see below) ---
  if (resume) {
    await withReleaseSession(process.cwd(), () =>
      resumeRelease(process.cwd(), { lockstepPackages, name: cfgName }));
    return;
  }

  // --- normal release: the aggregate IS the first rung, ahead of the wrapper ---
  const rows = await runPreflight({
    cwd: process.cwd(), scanPaths, sessionAtEntry,
    nowMs: Date.now(), sddReportOut: 'canonical',
    fixes: new Set(['garden-receipt']),
  });
  console.log(renderPreflight(rows));
  if (hasBlocking(rows)) {
    throw new Error(
      `Release preflight found ${countBlocking(rows)} blocking gate(s): ` +
      `${blockingIds(rows).join(', ')}. See the report above for each remedy.`,
    );
  }

  await withReleaseSession(process.cwd(), async () => { /* … consumer scripts,
    version derivation, mutation, commit, tag, push … exactly as today … */ });
}
```

`findPreviousTag()` is **not** hoisted into `main()`: `runPreflight` calls it itself, after any
tree-mutating fix has been applied, because a fast-forward can bring new tags with it. `cr-gate` and
`npm-name` both read it from there.

Three wiring decisions carry the design:

**`--resume` skips the aggregate entirely.** A resumable run has `.noldor/release-state.json` present
*by definition*, so the `release-state` row would be `blocking` and `pnpm release --resume` would
abort on the very token that authorizes it. That preserves today's contract at
[`index.ts:324-328`](../../../src/release/index.ts) — resume "skips every precondition, check, and
version derivation" and trusts only the state file, whose own shape and version cross-checks are its
guard. `--preflight --resume` is not a meaningful combination; `--resume` wins.

**The aggregate runs ahead of `withReleaseSession`, not inside it.** `withReleaseSession`
([`release-session.ts:14`](../../../src/release/release-session.ts)) overwrites
`.noldor/session.json` with `path: 'release-automation'` and its `finally` clears it. A
`session-marker` row evaluated inside that wrapper could never be `blocking` — and making the
wrapper non-asserting so the row *could* fire would let it overwrite-then-delete a live gate
session on a run that aborts anyway. Running the aggregate first keeps the marker intact and
readable, and `withReleaseSession`'s own throw stays untouched **behind** the aggregate as the writer
protecting its own invariant — it can now only fire on a marker that appears in the window between
the aggregate finishing and the wrapper starting.

**The real release passes `sddReportOut: 'canonical'` and `fixes: new Set(['garden-receipt'])`.**
Both preserve today's behaviour exactly:

- `canonical` means the release still regenerates `docs/sdd-report.md` in place, so volatile-only
  drift is still folded into the release commit by the existing `git add` list — a temp-file regen
  there would silently let the committed report go stale. `--preflight` passes `temp`, so it detects
  the same drift through the same `onlyVolatileSectionsChanged` tolerance while leaving the working
  copy byte-identical. One knob, no double regen, no behaviour lost.
- `{'garden-receipt'}` is the auto-restamp the pipeline already performs today. The release does
  **not** inherit the marker-removal or ff-merge remedies: a release run must never delete a session
  marker or move the branch pointer on its own.

On any blocking row the release prints the full report and aborts once, so its abort message names
every blocking gate rather than the first.

### Unit 5 — the `npm-name` probe

It runs one `npm view` against the configured registry — the same unauthenticated read
[`isVersionOnRegistry`](../../../src/release/release-publish.ts) already relies on — and maps the
result with no similarity guessing (D8):

| Registry result | This repo has released before (`previousTag !== 'v0.0.0'`) | Row |
| --- | --- | --- |
| `release.publish.enabled` is false | — | `skipped` — publish disabled, the name is never used |
| name resolves | yes | `ok` — "name resolves; N version(s) published" |
| name resolves | no | `blocking` — name exists on the registry but this repo has never released; pick another name or add a scope |
| clean `E404`, name unscoped | — | `warn` — new-package moderation may reject a name similar to a popular package (unscoped `noldor` → "too similar to `color`"); prefer `@scope/name` |
| clean `E404`, name scoped | — | `ok` — scoped, moderation is not a factor |
| any other failure — network error, non-404 registry status, `npm` binary missing | — | `warn` — could not reach the registry; detail names the error, `fix` is `npm view <name> --registry <cfg>` |

The failure row is `warn`, not `blocking`: an unreachable registry is not a reason to refuse a
release — the publish rung and `awaitPublish`'s own timeout still fail loudly if the name is really a
problem — and reporting `ok` on an unanswered question would be worse than an admitted unknown.

Implementation note: [`isVersionOnRegistry`](../../../src/release/release-publish.ts) collapses
*every* `npm view` failure to `false`, which is correct for its own "not visible yet, keep polling"
purpose but loses the distinction this probe needs. The probe therefore uses its own exec and
classifies `E404` (npm's not-found code) apart from everything else.

"Ours" is operationalized as "this repo has released before" because `npm view` exposes no
ownership signal to an unauthenticated read. The limitation is recorded under Risks.

### Cuts

- `noldor:cut no --json output — text report only; upgrade path: add --json mirroring
  garden detect --json when a programmatic consumer (e.g. the release-sweep skill) actually needs it.`
- `noldor:cut single CLI spelling — pnpm release --preflight only, no separate
  noldor release preflight subcommand; upgrade path: add the subcommand as an alias if operators
  reach for it, but two spellings of one gate is drift.`

## Acceptance criteria

1. `runPreflight` returns exactly one row per registered check id; ids are unique and stable.
2. **The core regression test:** with a foreign session marker, a stale graph, a stale garden
   receipt and a drifted `docs/sdd-report.md` all present, a single `runPreflight` returns four
   `blocking` rows.
3. Every `blocking` and every `warn` row carries a non-empty `fix`.
4. A foreign session marker yields `session-marker: blocking`, and the marker file is unmodified
   when `fixes` is empty.
5. With `fixes = SAFE_FIXES`: a marker past its TTL is removed and the row re-probes `ok`; a marker
   inside its TTL is left on disk and stays `blocking`.
6. With `fixes = SAFE_FIXES`: strictly-behind main + clean tree ff-merges and re-probes `ok`;
   a dirty tree does not merge and stays `blocking`; diverged history does not merge.
7. With `fixes` non-empty, **every** row is re-evaluated after the fix pass: given a stale
   `graph-freshness` that an `origin-sync` fast-forward resolves, the reported row is `ok`; given one
   the fast-forward *creates*, the reported row is `blocking`. A single-row re-probe would report the
   pre-merge verdict for both.
8. With `fixes` empty there is exactly one evaluation pass and no remedy runs.
9. `previousTag` used by `cr-gate` and `npm-name` is read after the fix pass: a tag arriving with the
   fast-forward is reflected in those rows.
10. The `sdd-report` probe with `sddReportOut: 'temp'` leaves `docs/sdd-report.md` byte-identical.
11. The `sdd-report` probe reports `ok` when the regen differs only in volatile sections
    (`onlyVolatileSectionsChanged` tolerance preserved) and `blocking` otherwise.
12. `graph-freshness` is `skipped` when `graphify-out/graph.json` is untracked.
13. `RELEASE_SKIP_GATE_COMPLIANCE=1` and `RELEASE_SKIP_CR_GATE=1` each produce a `skipped` row and
    still append to `.noldor/overrides.log`.
14. `cr-gate` is `skipped` when `previousTag === 'v0.0.0'`.
15. `npm-name` returns each of the six rows of the Unit 5 table under a stubbed exec — including the
    `skipped` row when `release.publish.enabled` is false, and `warn` when the exec fails with
    anything other than a clean `E404`.
16. `renderPreflight` orders rows `blocking → warn → ok → skipped` and ends with the counts line.
17. `pnpm release --preflight` exits 1 with the report on any blocking row, 0 otherwise, and writes
    no tracked file — no session marker, no `docs/sdd-report.md` change. (The `temp` sdd-report probe
    writes an untracked temp file by design.)
18. `pnpm release --resume` does not run the aggregate: with a release-state file present it reaches
    `resumeRelease` rather than aborting on its own `release-state` row.
19. A `path: 'release-automation'` marker yields `session-marker: warn` (not `blocking`), matching
    `withReleaseSession`'s existing fall-through.
20. A real release with a stale receipt and a clean `garden detect` still auto-stamps and proceeds —
    today's behaviour, unchanged.
21. A real release with two blocking rows aborts once and its output names both.
22. `pnpm noldor validate script-catalog` passes with the new flag documented in
    `docs/noldor/script-catalog.md`.

## Risks / trade-offs

- **A green preflight is not a green release.** Consumer scripts are out of scope by D1, so
  `test`/`build` can still fail afterwards. The render contract's trailing `not run` line names them
  explicitly so the gap is visible rather than implied.
- **`withReleaseSession` keeps its own throw behind the aggregate.** It can only fire on a marker
  that appears in the window between the aggregate finishing and the wrapper starting, but it means
  one gate condition is evaluated in two places. Accepted deliberately: the alternative — a
  non-asserting wrapper — risks overwriting and then clearing a live gate session on a run that
  aborts anyway.
- **The sdd-report regen moves earlier in the pipeline.** Today `garden sdd-report --release` runs at
  [`index.ts:355`](../../../src/release/index.ts), *after* the consumer scripts; as the aggregate's
  `sdd-report` row it runs *before* them. The report reads feature MDs and `.noldor` state, not build
  output, so the move is expected to be inert — but it is a real ordering change, called out here
  rather than discovered later.
- **`npm-name` infers ownership from release history.** A repo that published under a different
  name, or a fresh fork of a released repo, can get a wrong verdict. The row is cheap to override
  by turning `release.publish.enabled` off, and the warn text is explicit that moderation is only
  decided at publish time.
- **Deleting the throwing wrappers touches existing tests.** `graph-freshness.test.ts` asserts
  `ensureGraphFresh` throws; those expectations move to `evaluateGraphFreshness`.
- **The aggregate runs the CLI-spawn probes serially**, so preflight wall-clock is roughly the sum
  of `validate features` + `garden detect --gate-compliance` + one `sdd-report` regen. Acceptable
  for a pre-release command; parallelising is available later if it becomes annoying.

## User Story

As an operator preparing a release, I want `pnpm release --preflight` to report every failing
release gate at once with a copy-pasteable remedy for each — and to clear the safe ones with
`--fix` — so that I stop discovering one blocker per full pipeline re-run.

## Usage

**CLI**

1. Before tagging, from a clean `main`: `pnpm release --preflight`. Every state gate is evaluated
   and reported; exit 1 if anything is blocking, 0 otherwise. Nothing is written.
2. Read the report top-down — blocking rows first, each with its `fix:` line.
3. To clear the mechanical ones: `pnpm release --preflight --fix`. Applies only a stale session
   marker removal, a fast-forward of a strictly-behind main, and a garden re-stamp when
   `garden detect` is clean. Each action is echoed, then the whole aggregate is re-evaluated against
   the post-fix tree so no row can be reported from a pre-fix observation.
4. Fix the remaining rows by hand using their `fix:` lines, then re-run step 1 until green.
5. Run `pnpm release`. It re-evaluates the same aggregate as its first rung and, on a blocking row,
   prints the same report and aborts naming every failure.

**Agent API**

- No `window.charuy.*` surface — operator-facing release tooling.

**Keyboard shortcut**

- _none_ — CLI only.

## Open questions (resolved)

1. *Does the real release pipeline get `--fix` behaviour too, or is `--fix` preflight-only?*
   → The fix set is a parameter, and the release passes `{'garden-receipt'}` only. Rationale: that
   is precisely the auto-restamp the pipeline already does today, while auto-deleting a session
   marker or moving the branch pointer mid-release would be new and surprising (D5).
2. *Should preflight emit `--json`?*
   → No, cut with an upgrade path. Rationale: no programmatic consumer exists yet; the
   release-sweep skill reads prose.
3. *Should there be a second spelling, `noldor release preflight`?*
   → No. Rationale: one gate with two CLI spellings is a drift surface;
   `pnpm release --preflight` mirrors the existing `--resume` flag.
4. *Does this replace `NOLDOR_RELEASE_DRY_RUN=1`?*
   → No. Rationale: dry-run also derives the previous tag, bump level and next version — a
   different question ("what would this release be?") from preflight's ("what is blocking it?").
5. *Should `/noldor-release-sweep` call preflight?*
   → Yes, one line in the skill before its `pnpm release` confirmation prompt. Rationale: the sweep
   is exactly where the four-abort loop was paid for, and the aggregate is only useful if something
   routinely runs it.
