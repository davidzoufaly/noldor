# Release Bypass Retirement — Design

**Slug:** release-bypass-retirement
**FD:** docs/features/release-bypass-retirement.md
**Date:** 2026-07-02
**Tier:** specs-only

## Problem

Every release run has been prefixed with `RELEASE_SKIP_GATE_COMPLIANCE=1 RELEASE_SKIP_CR_GATE=1` for several releases — the framework's own release gates are routinely bypassed on the framework's own repo, which is the worst possible dogfood signal.

The roadmap entry's premises were verified against live code (2026-07-02) and are **partly stale** — PR #118 (`18050da`) already fixed much of this:

- **CR gate is no longer "unsatisfiable by design."** `checkCrGate` in `src/release/release-cr-gate.ts` already scans the *whole* squash-commit message for embedded `Noldor-*` trailer lines (`collectNoldorTrailerLines`, `release-cr-gate.ts:112`) precisely because squash-merge moves PR-branch trailers into the body. A live run of `checkCrGate({from: 'v0.4.0', to: 'HEAD'})` returns exactly **one** offender: `19a74a10` (`chore(ci): run pnpm verify on pull requests (#117)`), a pre-rollout-marker fast-track squash whose body carries `Noldor-Path: fast-track` but no review receipt. One receipt-less historical commit anywhere in the tag range makes the whole release fail, and the *only* remedy today is skipping the entire check via env var.
- **Gate compliance currently passes.** `pnpm noldor garden detect --gate-compliance` exits 0 today: `trailerScopeMismatch` is empty (post-#118 it scans `rolloutMarker..HEAD` and skips root commits — `src/garden/detectors/trailer-scope-mismatch.ts:60,87`), and `overrideAudit` is `INFO` (1 override in 30 days, threshold 3). The residual risk is structural: `auditOverrides` (`src/garden/detectors/override-audit.ts:60`) WARNs — and `hasBlockingFindings` (`src/garden/garden-detect.ts:805`) then blocks the release — whenever >3 `Noldor-Path-Override` commits land in a 30-day window. Heavy self-host dogfood weeks (the 2026-06 drain sprints produced far more than 3 legitimate, operator-approved overrides) push it over, and the only remedy is again the whole-check env skip.
- **The audit-trail ask is mostly shipped.** `src/release/index.ts:179,194` already call `appendOverrideLog(cwd, 'RELEASE_SKIP_…=1', 'release')` for both env skips. The one remaining unlogged bypass is `RELEASE_SKIP_GARDEN_GATE=1` in `ensureGardenFresh` (`src/garden/garden-receipt.ts:125-127`), whose own JSDoc admits "no persistent audit ledger today … candidate follow-up."

So the real work is not a gate rework — it is giving both gates a **first-class, per-item acknowledgment mechanism** so the operator never needs the whole-check env skip, plus closing the one audit-trail gap, plus retiring the skip-vars from the documented release recipe.

## Goals

1. A clean `pnpm release` (and `NOLDOR_RELEASE_DRY_RUN=1 pnpm release`) passes with **zero** `RELEASE_SKIP_*` env vars set on this repo.
2. Individual known-bad historical commits can be acknowledged per-SHA in committed config, with a required reason — instead of skipping the whole CR gate.
3. Expected self-host override noise can be declared in committed config so it stops counting toward the override-audit WARN threshold — instead of skipping the whole gate-compliance check.
4. Every remaining env bypass (`RELEASE_SKIP_GARDEN_GATE` included) writes a `.noldor/overrides.log` breadcrumb via `appendOverrideLog`.
5. The release-sweep skill and docs stop prescribing the skip-vars as the normal recipe.

## Non-goals

- Removing the `RELEASE_SKIP_*` env vars. They stay as logged break-glass hatches (bootstrap of new consumers, gate-introducing cycles — see `src/cr/bootstrap-immunity.ts:16`).
- Reworking `checkCrGate`'s trailer-scan strategy (PR-branch commit walking, GitHub API lookups). The whole-message scan shipped in #118 works; verified live.
- Changing `hasBlockingFindings` semantics or the WARN threshold default.
- Touching the pre-commit / pre-push hook layers.

## Design

### U1 — `release.crGateExemptCommits` config + `checkCrGate` exemptions

Extend `noldorConfigSchema` in `src/cr/config.ts` with a `release` block:

```ts
export const crGateExemptionSchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{7,40}$/),
  reason: z.string().min(1),
});
export const releaseConfigSchema = z.object({
  crGateExemptCommits: z.array(crGateExemptionSchema).default([]),
});
// noldorConfigSchema gains: release: releaseConfigSchema.optional()
```

`CrGateInput` in `src/release/release-cr-gate.ts` gains `exemptions?: ReadonlyArray<{sha: string; reason: string}>`. Inside the per-SHA loop (`release-cr-gate.ts:56`), after the exempt-path check: a commit whose full SHA starts with an exemption's `sha` (min 7 chars, schema-enforced) is skipped and collected into a new `exempted: CrGateOffender[]` field on `CrGateResult` so the release log prints what was waved through and why.

`src/release/index.ts:197` loads the config (`loadConfigSync` from `src/cr/config.ts`, already imported by the pre-commit hook the same way) and passes `config?.release?.crGateExemptCommits`. Each *applied* exemption is echoed to stdout (`→ CR gate: exempted 19a74a10 — <reason>`); the exemption list itself is committed config, so git history is the audit trail — no per-use overrides.log spam.

Seed `.noldor/config.json` with the one live offender:

```json
"release": {
  "crGateExemptCommits": [
    { "sha": "19a74a10e8e844e021b08fe616992eae1b56f977",
      "reason": "pre-rollout-marker CI-workflow fast-track (#117); shipped before receipt enforcement armed" }
  ]
}
```

### U2 — `garden.overrideAudit.expected` config + expected-noise exclusion

Extend `noldorConfigSchema` with a `garden` block:

```ts
export const expectedOverrideSchema = z.object({
  shaPrefix: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
  reasonIncludes: z.string().min(1).optional(),
  note: z.string().min(1),
}).refine((e) => e.shaPrefix || e.reasonIncludes, 'need shaPrefix or reasonIncludes');
export const gardenConfigSchema = z.object({
  overrideAudit: z.object({
    threshold: z.number().int().positive().optional(),
    expected: z.array(expectedOverrideSchema).default([]),
  }).optional(),
});
```

`auditOverrides` (`src/garden/detectors/override-audit.ts:60`) gains `opts.expected` and marks each collected `OverrideEntry` with `expected: boolean` (matched by SHA prefix or reason substring). Severity is computed from **unexpected** entries only; `count` splits into `count` (unexpected) + `expectedCount`. All entries stay in the returned list so `/garden` and `sdd-report.ts:1046-1054` still surface them (rendered with an `(expected)` suffix — one-line change in `buildGateComplianceSection`'s renderer).

`detectGateCompliance` (`src/garden/garden-detect.ts:622`) loads the config once and threads `expected` + `threshold` into `auditOverrides`. `detectAll` gets the same wiring. `hasBlockingFindings` is untouched — expected entries simply never push severity to WARN.

### U3 — log the garden-gate bypass

`ensureGardenFresh` (`src/garden/garden-receipt.ts:124`) adds `appendOverrideLog(cwd, 'RELEASE_SKIP_GARDEN_GATE=1', 'release')` inside the skip branch, mirroring `src/release/index.ts:179` exactly, and the JSDoc's "no persistent audit ledger today" paragraph is deleted. `appendOverrideLog` already swallows write failures (`src/core/overrides-log.ts:15`), so the fail-open contract holds.

### U4 — retire the skip-vars from the documented recipe

- `.claude/skills/release-sweep/SKILL.md` **and its template twin** (skill twins live under the init templates — edit needs `NOLDOR_ALLOW_SHARED`, per the shared-files guard): replace the "prefix release with RELEASE_SKIP_…" step with "release runs clean; on a new offender, add a `release.crGateExemptCommits` entry / `garden.overrideAudit.expected` entry with a reason".
- `docs/noldor/cr-pipeline.md:202` area: document the exemption config next to the existing skip-var audit-trail paragraph (generated page — change the template source, scope `noldor:page`).

### U5 — acceptance verification

`NOLDOR_RELEASE_DRY_RUN=1 pnpm release` with a clean env is the end-to-end proof: the dry-run short-circuit (`src/release/index.ts:224`) sits *after* both the gate-compliance step (line 178) and the CR gate (line 193), so a green dry run demonstrates zero-bypass viability without tagging.

### Tests

- `src/release/__tests__/release-cr-gate.test.ts` (existing suite, injected `runGit`): exempted SHA skipped + reported in `exempted`; non-matching exemption still offends; prefix shorter than 7 rejected at schema layer (config test).
- `src/garden/detectors/__tests__/override-audit.test.ts`: expected-by-reason and expected-by-sha entries excluded from severity; 4 overrides with 2 expected → INFO not WARN; entries still listed with `expected: true`.
- `src/garden/__tests__/garden-receipt.test.ts`: skip branch appends the `(release)`-tagged overrides.log line.
- `src/cr/__tests__` config tests: new `release` / `garden` blocks parse; absent blocks default sanely; unknown keys still stripped (zod non-strict) so older CLIs reading a newer config don't break.

## Acceptance criteria

- `NOLDOR_RELEASE_DRY_RUN=1 pnpm release` exits green on this repo with no `RELEASE_SKIP_*` env vars set.
- `checkCrGate` with the seeded exemption returns `ok: true` for `v0.4.0..HEAD` and lists `19a74a10…` under `exempted`.
- Removing the seeded exemption makes the same range fail again (gate not weakened).
- `auditOverrides` with 4 overrides of which 2 match `expected` returns severity `INFO`, `count: 2`, `expectedCount: 2`.
- `RELEASE_SKIP_GARDEN_GATE=1` produces a `(release)`-tagged line in `.noldor/overrides.log`.
- release-sweep skill + twin no longer instruct setting `RELEASE_SKIP_*`; exemption workflow documented instead.
- All existing release + garden test suites stay green.

## Risks / trade-offs

- **Exemption list as dumping ground.** A lazy operator could exempt every new offender instead of fixing process. Mitigation: `reason` is schema-required, entries are committed (reviewable in PR diff), and `/garden`'s override surfaces keep showing them. Deliberately *not* adding expiry/TTL — offenders are rare (1 in 14 commits since v0.4.0) and complexity isn't warranted yet.
- **`expected` matching by reason substring can over-match.** A broad `reasonIncludes` could silently absorb genuinely new overrides. Mitigation: entries still rendered in sdd-report/garden output with the `(expected)` marker, so over-absorption is visible, and the audit stays INFO-visible rather than disappearing.
- **Config-schema growth.** Two new optional top-level blocks in `noldorConfigSchema`; zod's default non-strict parse keeps forward/backward compatibility with consumers on older CLI versions.
- **Premise drift already bit this entry once.** Half the roadmap body described pre-#118 reality. The spec re-verified every claim live; implementer should re-run `checkCrGate` and `garden detect --gate-compliance` at build time in case new offenders landed since.

## User Story

As a release operator, I want a clean `pnpm release` to pass all framework gates without `RELEASE_SKIP_*` env bypasses, so that gate skips become rare, per-item, committed-and-audited exceptions instead of a routine ritual that trains me to ignore the gates.

## Usage

Normal release (the whole point — no env prefix):

```bash
pnpm release            # or NOLDOR_RELEASE_DRY_RUN=1 pnpm release to verify gates only
```

Acknowledge a specific receipt-less historical commit (instead of `RELEASE_SKIP_CR_GATE=1`):

```jsonc
// .noldor/config.json
"release": {
  "crGateExemptCommits": [
    { "sha": "19a74a10e8", "reason": "pre-rollout-marker CI chore (#117)" }
  ]
}
```

Declare expected self-host override noise (instead of `RELEASE_SKIP_GATE_COMPLIANCE=1`):

```jsonc
"garden": {
  "overrideAudit": {
    "expected": [
      { "reasonIncludes": "cr-red override acceptance-verify-lane", "note": "operator-accepted residual risk, 2026-06" }
    ]
  }
}
```

Break-glass (still works, now always audited):

```bash
RELEASE_SKIP_CR_GATE=1 pnpm release        # appends to .noldor/overrides.log
RELEASE_SKIP_GARDEN_GATE=1 pnpm release    # now also appends (U3)
```

## Open questions (resolved)

1. *Should the `RELEASE_SKIP_*` env vars be deleted outright, since the entry is called "retirement"?*
   -> No — keep them as logged break-glass hatches; retirement means the routine need dies, not the mechanism. (D1) New-consumer bootstrap and gate-introducing cycles (`bootstrap-immunity.ts`) legitimately need a hatch, and both paths already write audit breadcrumbs.

2. *Exempt historical CR-gate offenders by SHA list, by date range, or by "everything before the rollout marker"?*
   -> Per-SHA list with required reason. (D2) Offenders are rare (exactly 1 live), a marker-relative blanket would silently launder any pre-marker commit, and an explicit SHA+reason line is the cheapest reviewable artifact.

3. *Where should the new config live — inside the `consumer:` block or top-level in `.noldor/config.json`?*
   -> Top-level `release:` and `garden:` blocks beside `crLanes`/`autonomous`/`gate` in `noldorConfigSchema` (`src/cr/config.ts:64`). (D3) These tune framework enforcement behavior, not consumer identity; the `consumer:` block is parsed by a different schema (`src/core/consumer-config.ts`) and vision says consumer values only there.

4. *Should expected overrides just raise `overrideAudit`'s WARN threshold instead of per-entry matching?*
   -> No — keep threshold at 3, exclude matched entries. (D4) A raised global threshold hides *new, unexpected* noise exactly when the detector matters; per-entry matching keeps the WARN sensitivity for everything undeclared.

5. *Does the CR-gate rework proposed in the roadmap body (check PR-branch commits / PR-body trailers) still need doing?*
   -> No — verified shipped in #118: `checkCrGate` already scans whole squash bodies for embedded trailers, and a live run shows 1 offender, not "all commits". (D5) The spec narrows scope to the actually-missing acknowledgment mechanisms; re-verify at build time.
