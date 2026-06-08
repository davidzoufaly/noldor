# Trailer Scope-Alias Map — Design

**Date:** 2026-06-08
**FD:** `trailer-scope-alias-map`
**Tier:** specs-only

## Problem

`src/garden/detectors/trailer-scope-mismatch.ts` flags any commit whose
Conventional-Commit scope does not equal the `Noldor-FD:` slug or end with
`:<slug>`. The v0.4.0 release surfaced 24 such mismatches: the team has
informally adopted shorter scope tokens (`feat(sdd):` for FD
`sdd-co-tag-detector`, `feat(cr):` for FD `noldor`, …). Shipping required the
`RELEASE_SKIP_GATE_COMPLIANCE=1` bypass.

Demanding artificial scope expansion (`feat(sdd-co-tag-detector):`) fights the
team's actual usage. Instead, let the detector accept a configured set of
short-token → FD-slug aliases.

## Solution

A config-driven alias map in `.noldor/config.json` consumer block. The detector
accepts a commit when its scope's last segment is registered as an alias for
that commit's FD slug.

### 1. Config schema

Extend `ConsumerConfigSchema` in `src/core/consumer-config.ts`:

```ts
/**
 * Maps a short Conventional-Commit scope token to the FD slug(s) it may
 * legitimately front. Lets the team use informal scopes (`feat(cr):`) without
 * tripping the trailer-scope-mismatch detector. Key = scope token; value = FD
 * slugs that token is allowed to represent.
 */
scopeAliases: z.record(z.string(), z.array(z.string().min(1))).default({}),
```

Example:

```json
"scopeAliases": {
  "sdd": ["sdd-co-tag-detector"],
  "cr": ["noldor"]
}
```

A token may front multiple FDs (array value) — informal tokens like `cr` can be
shared across several FDs without a future schema migration.

### 2. Tolerant accessor

Add `loadScopeAliases(cwd)` mirroring the existing `loadAreaCategories` helper:

```ts
/** The consumer's scope-token → FD-slug(s) alias map (empty when no config). */
export function loadScopeAliases(cwd: string = process.cwd()): Record<string, string[]> {
  try {
    return loadConsumerConfig(cwd).scopeAliases;
  } catch {
    return {};
  }
}
```

Tolerant by design: a missing config (bootstrap / temp-repo unit tests) yields
`{}`, so detector behaviour is unchanged when no aliases are declared.

### 3. Detector change

In `src/garden/detectors/trailer-scope-mismatch.ts`, widen the acceptance rule.
Today:

```ts
const scopeContainsSlug = scope !== null && (scope === fdSlug || scope.endsWith(`:${fdSlug}`));
```

New:

```ts
const lastSegment = scope === null ? null : (scope.split(':').pop() ?? scope);
const aliasAccepts = lastSegment !== null && (aliases[lastSegment]?.includes(fdSlug) ?? false);
const accepted =
  scope !== null && (scope === fdSlug || scope.endsWith(`:${fdSlug}`) || aliasAccepts);

if (!accepted) {
  findings.push({ /* unchanged */ });
}
```

`lastSegment` handles bare `cr` and multi-level `garden:cr` uniformly (a
single-segment scope is its own last segment), mirroring the existing
`endsWith(':<slug>')` sub-scope leniency.

Signature gains an optional override so unit tests need no on-disk config:

```ts
export async function detectTrailerScopeMismatch(opts: {
  cwd: string;
  scopeAliases?: Record<string, string[]>;
}): Promise<TrailerScopeMismatchFinding[]> {
  const { cwd } = opts;
  const aliases = opts.scopeAliases ?? loadScopeAliases(cwd);
  // …
}
```

`undefined` → load from `cwd`. The caller `src/garden/garden-detect.ts` keeps
its two `{ cwd: repo }` call sites unchanged (override defaults to a real load).

### 4. Finding shape

`TrailerScopeMismatchFinding` is unchanged. Aliased commits simply produce no
finding.

## Edge cases

- `scope === null` (no parenthesised scope) → no alias lookup, still flagged.
- Empty or missing alias array for a token → no match, flagged as today.
- Unknown token (not in map) → flagged as today.
- Alias registered for a different FD than the commit carries → no match.

## Out of scope (YAGNI)

- Validating that alias target slugs reference real FDs — separate concern; the
  detector only decides scope acceptance.
- Migrating the 24 historical mismatches — the rollout marker
  (`readRolloutMarker`) already bounds the scan window, so pre-marker commits
  are never walked.

## Testing

Unit tests in `src/garden/detectors/__tests__/trailer-scope-mismatch.test.ts`,
passing `scopeAliases` via the override param:

- alias accepts a bare short token (`feat(cr):` + `Noldor-FD: noldor`, alias `cr → [noldor]`) → 0 findings.
- alias accepts a multi-level scope (`feat(garden:cr):` + `Noldor-FD: noldor`) → 0 findings.
- one token mapped to multiple slugs accepts each.
- unknown token still flagged.
- token registered for a different FD still flagged.
- `null` scope still flagged.
- no aliases (`{}`) → existing behaviour preserved (regression of current suite).

Plus a config-layer test in `src/core/__tests__/` (or existing consumer-config
test) that `loadScopeAliases` returns `{}` on missing config and the parsed map
otherwise.

## Docs

The zod schema is the authoritative field documentation per the existing
`ConsumerConfigSchema` comment convention. Add one note for the `scopeAliases`
field wherever `.noldor/config.json` consumer fields are described (verify the
canonical location during implementation; do not invent a new doc page).
