---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/cr/config.ts
    - src/release/release-cr-gate.ts
    - src/release/index.ts
    - src/garden/detectors/override-audit.ts
    - src/garden/garden-detect.ts
    - src/garden/sdd-report.ts
    - src/garden/garden-receipt.ts
  docs:
    - docs/noldor/cr-pipeline.md
    - docs/noldor/versioning.md
  tests:
    - src/cr/__tests__/config.test.ts
    - src/release/__tests__/release-cr-gate.test.ts
    - src/garden/detectors/__tests__/override-audit.test.ts
    - src/garden/__tests__/garden-detect.test.ts
    - src/garden/__tests__/sdd-report.test.ts
    - src/garden/__tests__/garden-receipt.test.ts
  spec: docs/superpowers/specs/2026-07-02-release-bypass-retirement-design.md
  plan: docs/superpowers/plans/2026-07-02-release-bypass-retirement.md
name: Release Bypass Retirement
packages:
  - scripts
phase: done
noldor-tier: specs-only
introduced: 0.5.0
---
## Summary

Every release still requires `RELEASE_SKIP_GATE_COMPLIANCE=1` + `RELEASE_SKIP_CR_GATE=1` (`src/release/index.ts:178,193`) — "goes away once X ships" for several releases now. Two root causes: (a) the CR gate is unsatisfiable by design — `src/release/release-cr-gate.ts` checks squash commits on main for review receipts that squash-merge strips; rework it to check PR-branch commits or PR-body trailers instead. (b) Gate-compliance trips on historical short-scope trailers + the framework's own expected override usage; make the self-host expected-noise allowlist first-class instead of env-skipping the whole check. Also: write `RELEASE_SKIP_*` uses to `.noldor/overrides.log` the way `src/hooks/noldor-pre-commit.ts:33-42` logs overrides, so bypasses leave an audit trail. Acceptance: a clean `pnpm release` needs zero env bypasses.

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

## PRs

<!-- @prs-since-last-release: release-bypass-retirement -->

## Changelog

### Initial Release (v0.5.0)

#### Summary

Added a `release.crGateExemptCommits` config schema (#133).

#### PRs

- #133: add release.crGateExemptCommits config schema ([link](https://github.com/davidzoufaly/noldor/pull/133))

