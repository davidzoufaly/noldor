---
area: docs
category: Tooling
deps: []
entry-id: Q-0135
links:
  code:
    - src/docs/adr-schema.ts
    - src/docs/docs-adr.ts
    - src/docs/adr-new.ts
    - src/hooks/validate-pushed-adrs.ts
    - src/garden/detectors/adr.ts
  tests:
    - src/docs/__tests__/docs-adr.test.ts
    - src/hooks/__tests__/validate-pushed-adrs.test.ts
    - src/garden/detectors/__tests__/adr.test.ts
name: Architecture Decision Record Surface
packages:
  - package.json
phase: done
since: 2026-08-17T00:00:00.000Z
noldor-tier: specs-only
---

## Summary

Q-0093 shipped `docs/architecture/` and explicitly carved decision records out of it — its Non-goals says ADRs are "a different artifact (append-only, dated, superseded-by chains) with a different lifecycle. Carved to a sibling roadmap entry" — but that sibling was never minted, so the shipped spec references an entry that does not exist. This is it. Wanted: `docs/adr/NNNN-<slug>.md` with validated frontmatter (`status: accepted | superseded`, `date`, `supersedes` / `superseded-by`), an append-only discipline the framework can check, and a `loadDocRoots` key. The demand is already concrete: `Package Runtime Representation ADR` (Q-0117) asks to record the source-at-runtime decision as an ADR and currently has nowhere to put it, and the read-only audit named source-at-runtime packaging, adoption-safe advisories, sequential queue writes and graph fallbacks as decisions whose reasoning survives only in archived specs. Deletion test: a reviewer can answer "why does this bind us today" without opening `docs/design/specs/archive/`. Decide during spec: whether a superseded record is validated for a forward pointer, and whether the surface reuses the architecture registry's opt-in rule so `noldor init` cannot block a consumer who has written no ADRs. (split from Q-0093 at design time, 2026-08-17)

## User Story

As a maintainer or review agent, I want the repository's binding decisions
recorded as append-only, dated, supersede-chained records, so that I can
answer "why does this bind us today" without excavating archived design
specs.

## Usage

**CLI**

1. `noldor adr new <slug>` mints the next `docs/adr/NNNN-<slug>.md` (creates
   the folder on first use) with `status: accepted`, today's date, and
   Context / Decision / Consequences prompts.
2. Replace a decision with `noldor adr new <new-slug> --supersedes NNNN` —
   flips the target to `status: superseded` and links both directions, so the
   pair lands in one commit.
3. `noldor docs adr --check` (or the bare `noldor docs adr`) validates the
   folder. Exit 0 when every record is valid or the surface is absent (no
   records yet); exit 1 naming file and rule on a bad filename, duplicate
   number, invalid frontmatter, or a supersede chain dangling in either
   direction.
4. Append-only is enforced at push: editing an accepted record's body,
   editing a superseded record, renaming, or deleting a record fails the
   pre-push hook. The legal in-place mutation is the supersede flip.
   `NOLDOR_ADR_REPAIR=1 git push` is the audited repair path (renumbering a
   post-merge duplicate, un-wedging a chain) — receipted to
   `.noldor/adr-repairs.log`.

**Agent/Programmatic API**

- `checkAdr(cwd)` → `{ status: 'absent' | 'ok' | 'invalid', findings }`.
  Filesystem failures become findings; it never throws.
- `createAdr({ cwd, slug, date, supersedes? })` → result type with the new
  record path (and the flipped target on supersede).
- `validatePushedAdrs({ git, refLines, env })` → the pre-push verdict
  (`ok` / `violations` / `repair` / `infra`).
- `detectAdrFindings(repo)` → `Gap[]` for garden / the SDD report.

**Release**

- `pnpm release` reports an `adr` preflight row: `skipped` when no records
  exist, `blocking` when a record is invalid, `ok` when all valid.
- `RELEASE_SKIP_ADR=1` forces that row to `skipped` and audits the override.

## PRs

<!-- @prs-since-last-release: architecture-decision-record-surface -->

## Changelog

<!-- generated: resources -->

## Resources

- **Code:**
  - [`src/docs/adr-schema.ts`](../../src/docs/adr-schema.ts)
  - [`src/docs/docs-adr.ts`](../../src/docs/docs-adr.ts)
  - [`src/docs/adr-new.ts`](../../src/docs/adr-new.ts)
  - [`src/hooks/validate-pushed-adrs.ts`](../../src/hooks/validate-pushed-adrs.ts)
  - [`src/garden/detectors/adr.ts`](../../src/garden/detectors/adr.ts)
- **Tests:**
  - [`src/docs/__tests__/docs-adr.test.ts`](../../src/docs/__tests__/docs-adr.test.ts)
  - [`src/hooks/__tests__/validate-pushed-adrs.test.ts`](../../src/hooks/__tests__/validate-pushed-adrs.test.ts)
  - [`src/garden/detectors/__tests__/adr.test.ts`](../../src/garden/detectors/__tests__/adr.test.ts)

<!-- /generated: resources -->
