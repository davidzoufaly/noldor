# Version-Aware Upgrade and Migration Chain — Design

**Slug:** version-aware-upgrade-and-migration-chain
**FD:** docs/features/version-aware-upgrade-and-migration-chain.md
**Date:** 2026-06-13
**Tier:** full
**Deps:** registry-distribution

## Problem

`noldor init --update` (`src/cli/commands/init.ts`) re-copies templates and
overwrites drifted consumer files (`copyTemplate`, `src/templates/copy.ts`).
That handles *content* drift in template-managed files. It does **not** handle
*schema* evolution between framework versions: FD frontmatter shape changes
(`docs/noldor/feature-md-schema.md`), `consumer:` config field renames
(`ConsumerConfigSchema`, `src/core/consumer-config.ts:46`), skill-twin contract
changes, trailer-format changes. Today there is exactly one self-host consumer,
so schema evolution is hand-migration. The multi-project goal (see
[noldor.md](../../docs/features/noldor.md) + `docs/noldor/adoption-guide.md`)
means N consumers on mixed pinned versions — at which point hand-migration is
the single biggest structural risk: "Charuy is three versions behind and nobody
dares sync it."

There is no record of *which framework version a consumer was last migrated to*
— `.noldor/config.json` carries the `consumer:` identity block but no version
anchor — so nothing can compute "what schema changes does this consumer still
owe."

## Goals

- Anchor each consumer to the framework version its tree was last migrated to,
  stored in `.noldor/config.json`, written by `init` and `upgrade`.
- `noldor upgrade`: resolve the ordered migration chain `anchored → installed`,
  run each migration as a pure file transform over the consumer tree, print
  per-step diffs under `--dry-run`, and advance the anchor only after the full
  chain succeeds. Idempotent re-run (no-op when already current). Refuses on a
  dirty git tree.
- A migration registry (`src/migrations/<version>.ts`) with a uniform
  `Migration` contract, resolved/run by **pure** functions over an injected
  migration array (testable without faking production migrations).
- `doctor` skew check: anchored ≠ installed → warn, point at `upgrade`.
- Authoring discipline enforced by a garden detector: a PR that changes a
  consumer-facing schema surface without shipping a matching migration is a
  drift finding.
- Codemod tests: fixture consumer trees + post-migration snapshot.

## Non-goals

- **Downgrade.** `installed < anchored` errors out; documented as unsupported.
- **Auto-resolving consumer-local edits to twin files.** The seed migrations use
  content-preserving merges where mechanical; genuine three-way conflicts are
  surfaced as a step the operator resolves, not silently overwritten (D3).
- **A new CI harness.** The garden detector rides the existing
  `pnpm noldor garden detect` flow; the consumer-contract-ci fixture (separate
  roadmap entry) doubles as the live test bed but is not built here.
- **Networked version discovery.** "Installed" = the framework package's own
  `package.json` version on disk; registry-distribution (dep) governs how that
  package arrives.

## Design

### Unit 1 — Migration contract + pure chain engine (`src/migrations/`)

`src/migrations/types.ts` — the contract every per-version module exports:

```ts
import type { ConsumerConfig } from '../core/consumer-config.js';

/** One file the migration would change. `before === ''` means create. */
export interface MigrationStep {
  readonly path: string; // consumer-relative
  readonly before: string;
  readonly after: string;
}

export interface Migration {
  /** Anchor version this migration applies FROM (exclusive lower bound). */
  readonly from: string;
  /** Anchor version this migration brings the consumer TO. */
  readonly to: string;
  readonly description: string;
  /** Compute steps without touching disk. */
  dryRun(cwd: string, config: ConsumerConfig): MigrationStep[];
  /** Apply steps to disk; returns the steps applied. */
  migrate(cwd: string, config: ConsumerConfig): MigrationStep[];
}
```

`src/migrations/semver.ts` — `parseSemver` / `compareSemver` (no new dep; the
repo treats versions as plain `x.y.z` per `docs/noldor/versioning.md`).

`src/migrations/chain.ts` — pure over an injected array:
- `resolveChain(migrations, from, to): Migration[]` — selects `m.to > from &&
  m.to <= to`, sorts ascending by `m.to`, asserts contiguity (each `m.from`
  equals the running cursor), throws on downgrade or chain gap.
- `runChain(chain, cwd, config, { dryRun }): ChainResult[]` — runs each
  migration's `dryRun`/`migrate`, collecting steps.
- `renderSteps(steps): string` — a deterministic in-process diff for the
  `--dry-run` printout (per-file `--- path` header + changed-line markers).

`src/migrations/registry.ts` — `export const MIGRATIONS: Migration[]` importing
each `<version>.ts` module. Production wiring only; engine functions never read
this directly (they take the array), so tests pass synthetic migrations.

`src/migrations/pkg-version.ts` — `installedFrameworkVersion()` reads
`join(TEMPLATES_ROOT, '..', 'package.json')` `.version` (same package-asset
resolution as `src/templates/manifest.ts:12`; matches the
`require('./package.json').version` idiom at `src/hooks/noldor-pre-push.ts:87`).

### Unit 2 — Version anchor in consumer config (`src/core/consumer-config.ts`)

Add to `ConsumerConfigSchema`:

```ts
/** Framework version this consumer tree was last migrated to (set by
 * init/upgrade). Absent on a tree scaffolded before this feature. */
frameworkVersion: z.string().regex(/^\d+\.\d+\.\d+/).optional(),
```

Add two helpers beside the existing tolerant loaders:
- `loadFrameworkVersion(cwd): string | null` — returns the field or `null`
  (tolerant, mirrors `loadScopeAliases`).
- `writeFrameworkVersion(cwd, version)` — JSON round-trips `.noldor/config.json`,
  sets `consumer.frameworkVersion`, re-serializes with 2-space indent + trailing
  newline. Lives in the consumer block (not top-level) so the single
  `loadConsumerConfig` parse and the strict schema both cover it (D4).

### Unit 3 — `noldor upgrade` command (`src/cli/commands/upgrade.ts` + manifest)

Flow:
1. `config = loadConsumerConfig(cwd)`.
2. `from = loadFrameworkVersion(cwd)` — if `null`, error: anchor unset, run
   `noldor init` (or pass `--from <v>` to bootstrap an existing tree).
3. `to = installedFrameworkVersion()`.
4. `compareSemver(from, to) === 0` → print "already at `<to>`" and exit 0
   (idempotent).
5. `chain = resolveChain(MIGRATIONS, from, to)` — empty chain → no-op exit 0.
6. Dirty-tree guard (skipped under `--dry-run`): `git status --porcelain`
   non-empty and no `--force` → refuse, recommend a branch.
7. `runChain(chain, cwd, config, { dryRun })`; print each migration's
   description + `renderSteps`.
8. On a real run, `writeFrameworkVersion(cwd, to)` only after the whole chain
   applied; print summary (`N steps across M migrations; anchor → <to>`).

Manifest: add a leaf group (`''` sub, like `init`/`doctor`) in
`src/cli/manifest.ts`:

```ts
upgrade: {
  desc: 'Run version-aware migration chain (anchored → installed framework version)',
  subs: { '': { src: 'cli/commands/upgrade.ts', desc: 'Run upgrade (--dry-run / --from <v> / --force)' } },
},
```

### Unit 4 — `init` writes the anchor (`src/cli/commands/init.ts`)

After the successful `copyTemplate` block (before `process.exit(0)`), and only
when `.noldor/config.json` exists, call
`writeFrameworkVersion(consumer, installedFrameworkVersion())`. A fresh scaffold
is by definition current, so it never owes migrations.

### Unit 5 — `doctor` skew check (`src/cli/commands/doctor.ts`)

After the runner checks, compare `loadFrameworkVersion(cwd)` to
`installedFrameworkVersion()`:
- equal → silent.
- differ (or anchor `null`) → print a `warn` line
  (`framework skew: anchored <a> ≠ installed <b> — run 'noldor upgrade'`).
- **Exit code unaffected** — skew is advisory, not drift, so a consumer that
  has synced templates but not yet migrated still passes `doctor` green after
  `upgrade` (D2).

### Unit 6 — Migration-coverage garden detector (`src/garden/detectors/migration-coverage.ts`)

Mirrors the existing range-based detectors. Over `prevTag..HEAD`:
- `SCHEMA_SURFACE = ['src/core/consumer-config.ts',
  'docs/noldor/feature-md-schema.md', 'templates/.noldor/config.json']`.
- If any surface file changed in range AND no
  `src/migrations/<version>.ts` (non-test) file was added/modified in the same
  range → emit a finding (`schema-changed-without-migration`).
- Wired into `src/garden/garden-detect.ts` alongside `detectTierMismatch` etc.

### Unit 7 — Seed migration + codemod fixtures (`src/migrations/0.4.0.ts`, fixtures)

`0.4.0.ts` is the **anchor migration**: `{ from: '0.3.0', to: '0.4.0',
description: 'baseline anchor', dryRun: () => [], migrate: () => [] }`. It
establishes the floor honestly — no fictitious transform. The machinery's value
is proven by tests using synthetic migrations against
`src/migrations/__tests__/fixtures/<from-version>/` consumer trees; a snapshot
asserts the post-`migrate` tree. When the first real schema change lands, its PR
adds `<version>.ts` with a genuine transform + fixture (enforced by Unit 6).

## Acceptance criteria

- `resolveChain` returns the contiguous ascending slice for `from < to`; throws
  on downgrade and on a chain gap; empty for `from === to`.
- `installedFrameworkVersion()` returns the framework package's own
  `package.json` version.
- Fixture consumer anchored at `0.2.0` + two synthetic migrations (`→0.3.0`,
  `→0.4.0`): `runChain(..., { dryRun: true })` reports 2 steps with diffs and
  touches no disk; `runChain(..., { dryRun: false })` lands both and the tree
  snapshot matches; the anchor is written only after both succeed.
- `noldor upgrade` on a tree already at the installed version is a no-op exit 0
  (idempotent re-run).
- `noldor upgrade` refuses on a dirty git tree without `--force`.
- `init` writes `consumer.frameworkVersion = installed` into a scaffolded
  `.noldor/config.json`.
- `doctor` prints a skew `warn` when anchored ≠ installed and stays green (exit
  unaffected) once templates are in sync.
- The migration-coverage detector fires when a `SCHEMA_SURFACE` file changes in
  range with no migration file added; silent otherwise.

## Risks / trade-offs

- **In-process diff vs `git diff`.** `renderSteps` is a deterministic
  hand-rolled line diff (testable, no temp files) rather than shelling to
  `git diff --no-index`. Trade richer hunks for determinism + no I/O in the
  pure layer.
- **Anchor on a pre-feature tree.** A consumer scaffolded before this ships has
  no anchor; `upgrade --from <v>` bootstraps it. Documented in the
  adoption/versioning docs.
- **Coverage detector false-negatives.** A schema change expressed only in a
  skill-twin or template *other* than the three `SCHEMA_SURFACE` paths slips
  through. The surface list is explicit and grows as new schema homes appear —
  logged, not silently broad.
- **Migration correctness is unbounded.** The engine guarantees ordering +
  atomic anchor advance; it cannot guarantee a hand-written migrate() is
  correct. Per-migration fixture snapshots are the backstop (Unit 7).

## User Story

As an operator maintaining one or more Noldor consumer repos on mixed pinned
framework versions, I want a single `noldor upgrade` command that walks my repo
from its anchored framework version to the installed one through ordered,
reviewable codemods, so that I can adopt schema evolution with one command and a
diff instead of hand-walking every consumer and praying.

## Usage

**Upgrade a consumer**

1. `noldor doctor` — surfaces `framework skew: anchored <a> ≠ installed <b>`.
2. `git switch -c chore/noldor-upgrade` (upgrade refuses on a dirty tree).
3. `noldor upgrade --dry-run` — prints each migration's description + per-file
   diffs; touches nothing.
4. `noldor upgrade` — applies the chain, advances
   `.noldor/config.json` `consumer.frameworkVersion` after the full chain.
5. `noldor doctor` — green; re-running `noldor upgrade` is a no-op.

**Bootstrap a pre-feature tree:** `noldor upgrade --from <last-known-version>`.

**Author a schema change (framework dev):** in the same PR that edits a
`SCHEMA_SURFACE` file, add `src/migrations/<new-version>.ts` (a `Migration`)
plus a fixture under `src/migrations/__tests__/fixtures/`, or
`pnpm noldor garden detect` flags `schema-changed-without-migration`.

**Agent API / keyboard:** _none — CLI + git + garden detector only; no
`window.*` surface._

## Open questions (resolved)

1. *Migration granularity — per release version vs per schema-change id?*
   -> Per release version (`<version>.ts`, `from`/`to` semver). Matches the
   semver discipline already in `docs/noldor/versioning.md` and lets the
   coverage detector key off the version bump (D1).
2. *Should `doctor` fail on skew or only warn?*
   -> Warn only; exit code unaffected. Skew is "you owe a migration," not
   broken state — failing would block unrelated `pnpm verify` runs and
   contradicts the "green after upgrade" acceptance (D2).
3. *How do template re-syncs merge consumer-local edits to twin files —
   three-way merge vs ours/theirs prompt?*
   -> Content-preserving where mechanical (the migration computes the new
   content from the old); genuine conflicts surface as a `MigrationStep` the
   operator reviews in the diff and resolves — never silent overwrite. Defers
   full three-way to the existing skill-twin drift work rather than reinventing
   it here (D3).
4. *Where does `frameworkVersion` live — top-level of `.noldor/config.json` or
   inside the `consumer:` block?*
   -> Inside the `consumer:` block. The single `loadConsumerConfig` parse and
   the strict schema already cover that block; a top-level field would need a
   second parse path and escape strict validation (D4).
5. *Downgrade support?*
   -> Unsupported — `installed < anchored` throws with a clear message;
   documented in `versioning.md`. Reverting framework versions is a git
   operation, not a codemod concern (D5).
