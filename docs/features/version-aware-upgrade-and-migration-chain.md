---
area: tooling
category: Tooling
deps:
  - registry-distribution
links:
  code:
    - src/migrations/
    - src/cli/manifest.ts
    - src/cli/commands/init.ts
    - src/cli/commands/upgrade.ts
    - src/core/consumer-config.ts
    - docs/noldor/adoption-guide.md
    - docs/noldor/versioning.md
  docs: []
  tests:
    - src/cli/commands/__tests__/upgrade.test.ts
    - src/core/__tests__/consumer-config.test.ts
    - src/core/__tests__/framework-version.test.ts
    - src/migrations/__tests__/chain.test.ts
    - src/migrations/__tests__/pkg-version.test.ts
    - src/migrations/__tests__/semver.test.ts
    - src/release/__tests__/release-config-flow.test.ts
    - src/testing/__tests__/consumer-fixture.test.ts
  spec: >-
    docs/superpowers/specs/archive/2026-06-13-version-aware-upgrade-and-migration-chain-design.md
  plan: >-
    docs/superpowers/plans/archive/2026-06-13-version-aware-upgrade-and-migration-chain.md
name: Version-Aware Upgrade and Migration Chain
packages:
  - scripts
phase: done
noldor-tier: full
introduced: 0.4.0
---

## Summary

`noldor init --update` re-pulls current templates, but nothing handles *schema* evolution between framework versions: FD frontmatter shape changes, `consumer:` config field renames, skill-twin contract changes, trailer-format changes. With one consumer that's hand-migration; with N consumers on mixed pinned versions it's the biggest structural risk of the multi-project goal. Build `noldor upgrade`: a version-aware chain that takes a consumer from its current framework version to the installed one by running ordered codemods.

**What to do:**

- Version anchoring: record the framework version a consumer was last migrated to — `.noldor/config.json` `frameworkVersion:` field (written by `init` and `upgrade`), compared against the installed package version. `doctor` gains a skew check: installed ≠ migrated → warn, point at `upgrade`.
- Migration registry: `src/migrations/<version>.ts` modules, each exporting `{ from, to, description, migrate(cwd, config), dryRun(cwd, config) }`. Migrations are pure file transforms over the consumer tree (FD frontmatter rewrites, config key renames, template re-syncs with content-preserving merges) — same codemod discipline the Charuy→standalone extract used by hand.
- `noldor upgrade` command: resolves the chain `frameworkVersion → installed`, runs each migration sequentially, `--dry-run` prints the planned diffs per step, writes `frameworkVersion` only after the full chain succeeds. Refuses on dirty git tree; recommends a branch.
- Authoring discipline: a framework PR that changes any consumer-facing schema MUST ship the matching migration in the same PR — enforce via a `/garden` detector or a release gate that diffs `feature-md-schema.md` / `consumer-config.ts` against `src/migrations/` coverage.
- Codemod tests: fixture consumer trees per from-version under `src/migrations/__tests__/fixtures/`, snapshot the post-migration tree. The [consumer-contract-ci](#consumer-contract-ci-and-headless-gate-e2e-harness) fixture doubles as the live test bed.

**What it enables:** the framework can keep evolving its schemas without freezing or hand-walking every consumer; consumers upgrade with one command and a reviewable diff; removes the "Charuy is three versions behind and nobody dares sync it" failure mode before it exists.

**Open questions:** migration granularity — per release version vs per schema-change id (lean per-release, matches semver discipline in `versioning.md`); downgrade support (no — document as unsupported); how template re-sync merges consumer-local edits to twin files (three-way merge vs ours/theirs prompt — connects to the existing skill-twin drift pain).

** **Acceptance sketch:** fixture consumer pinned at v0.2.0 shape + installed v0.4.0 → `noldor upgrade --dry-run` lists 2 steps with diffs; `noldor upgrade` lands both; `doctor` green; re-run is a no-op.

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

## PRs

<!-- @prs-since-last-release: version-aware-upgrade-and-migration-chain -->

## Changelog

### Initial Release (v0.4.0)

#### Summary

Added semver parse and compare helpers (#104).

#### PRs

- #104: add semver parse + compare helpers ([link](https://github.com/davidzoufaly/noldor/pull/104))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-06-13-version-aware-upgrade-and-migration-chain-design.md`](../../docs/superpowers/specs/archive/2026-06-13-version-aware-upgrade-and-migration-chain-design.md)
- **Plan:**
  - [`docs/superpowers/plans/archive/2026-06-13-version-aware-upgrade-and-migration-chain.md`](../../docs/superpowers/plans/archive/2026-06-13-version-aware-upgrade-and-migration-chain.md)
- **Code:**
  - [`src/migrations/`](../../src/migrations/)
  - [`src/cli/manifest.ts`](../../src/cli/manifest.ts)
  - [`src/cli/commands/init.ts`](../../src/cli/commands/init.ts)
  - [`src/core/consumer-config.ts`](../../src/core/consumer-config.ts)
  - [`docs/noldor/adoption-guide.md`](../../docs/noldor/adoption-guide.md)
  - [`docs/noldor/versioning.md`](../../docs/noldor/versioning.md)
- **Tests:**
  - [`src/cli/commands/__tests__/upgrade.test.ts`](../../src/cli/commands/__tests__/upgrade.test.ts)
  - [`src/core/__tests__/consumer-config.test.ts`](../../src/core/__tests__/consumer-config.test.ts)
  - [`src/core/__tests__/framework-version.test.ts`](../../src/core/__tests__/framework-version.test.ts)
  - [`src/migrations/__tests__/chain.test.ts`](../../src/migrations/__tests__/chain.test.ts)
  - [`src/migrations/__tests__/pkg-version.test.ts`](../../src/migrations/__tests__/pkg-version.test.ts)
  - [`src/migrations/__tests__/semver.test.ts`](../../src/migrations/__tests__/semver.test.ts)
  - [`src/release/__tests__/release-config-flow.test.ts`](../../src/release/__tests__/release-config-flow.test.ts)
  - [`src/testing/__tests__/consumer-fixture.test.ts`](../../src/testing/__tests__/consumer-fixture.test.ts)

<!-- /generated: resources -->
