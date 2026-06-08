# Trailer Scope-Alias Map — Design

**Date:** 2026-06-08
**FD:** `trailer-scope-alias-map`
**Tier:** specs-only

## Problem

`src/garden/detectors/trailer-scope-mismatch.ts` flags any commit whose
Conventional-Commit scope does not equal the `Noldor-FD:` slug or end with
`:<slug>`. The originating incident was an upstream (Charuy) v0.4.0 release that
surfaced ~24 such mismatches because the team had informally adopted shorter
scope tokens (`feat(sdd):` for FD `sdd-co-tag-detector`, `feat(cr):` for FD
`noldor`, …); shipping required the `RELEASE_SKIP_GATE_COMPLIANCE=1` bypass.

That incident is the *motivation*, not a reproducible repo state. In this
self-host repo, a full-history scan finds only a handful of mismatches and they
have a different shape (e.g. `noldor → noldor-package-lift`, plus null-scope
commits an alias map cannot help). The 24-token Charuy set is not present here
and must not be hardcoded.

The standing need is forward-looking: as the team keeps committing with short
scopes, each release window will re-accumulate the same wall. Demanding
artificial scope expansion (`feat(sdd-co-tag-detector):`) fights actual usage.
Instead, let the detector accept an **operator-curated** set of short-token →
FD-slug aliases that encode the team's real convention.

## Solution

A config-driven alias map in `.noldor/config.json` consumer block. The detector
accepts a commit when its scope's last segment is registered as an alias for
that commit's FD slug. The map is operator-curated team convention — it ships
with an empty (valid) default and is seeded with the agreed entries during
implementation (see Deliverables).

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

Example (shown in its real nesting under the `consumer:` block, sibling of
`areaCategories`):

```json
{
  "consumer": {
    "areaCategories": { "...": "..." },
    "scopeAliases": {
      "cr": ["noldor"],
      "sdd": ["sdd-co-tag-detector"]
    }
  }
}
```

A token may front multiple FDs (array value) — informal tokens like `cr` can be
shared across several FDs without a future schema migration. (The `sdd`/`cr`
entries are illustrative of the *shape*; the actual seed for this repo is
derived per Deliverables, not copied from the Charuy example.)

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
// pop() on a non-empty array is always a string; split() never yields []
const lastSegment = scope === null ? null : scope.split(':').pop()!;
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

## Deliverables (this closes the bypass)

The mechanism alone ships inert — the bypass only goes away once
`.noldor/config.json` carries the team's real aliases. Both land in this FD:

1. **Mechanism** — schema field, accessor, detector change, tests (above).
2. **Seed the map** — during implementation:
   a. Run the detector over the current scan window
      (`detectTrailerScopeMismatch({ cwd })`) to list live `scope → fdSlug`
      mismatches.
   b. Filter to genuine team-convention cases (a non-null short scope that
      *should* be accepted for that FD). Discard noise — e.g. null-scope
      commits (no alias can help; see below) and one-off wrong-FD taggings.
   c. Present the candidate `token → [slugs]` set to the operator for
      confirmation.
   d. Write the confirmed entries into `.noldor/config.json` `consumer.scopeAliases`.
   If the confirmed set is empty in this repo, that is a legitimate outcome —
   the field ships as `{}` and the detector behaviour is unchanged until the
   team adds tokens. The mechanism is still complete and the next release no
   longer needs a code change to register a token.

## Why no commit rewrite is needed

The rollout marker (`readRolloutMarker`) advances to the release commit each
release, so the scan window is `<last-release>..HEAD`. Pre-marker historical
mismatches (including the original Charuy 24) are never re-walked and need no
retroactive scope rewrite. The alias map's job is forward-looking: it stops
*future* in-window commits using standing team tokens from being flagged.

Note: a commit with **no scope at all** (`docs: …`, scope `null`) is not
addressable by an alias map — there is no token to alias — and remains flagged
by design. Such commits are a separate gate-discipline concern, not part of this
FD.

## Out of scope (YAGNI)

- Validating that alias target slugs reference real FDs — separate concern; the
  detector only decides scope acceptance.
- Auto-deriving the alias set without operator confirmation — the map encodes
  team convention, which is a human decision, not a mechanical scan output.

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
