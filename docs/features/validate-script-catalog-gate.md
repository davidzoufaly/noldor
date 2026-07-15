---
area: tooling
category: Tooling
deps: []
entry-id: Q-0042
links:
  code:
    - src/cli/validate-script-catalog.ts
  tests:
    - src/cli/__tests__/validate-script-catalog.test.ts
  spec: docs/design/specs/2026-07-14-validate-script-catalog-gate-design.md
name: Validate Script-Catalog Gate
packages:
  - scripts
phase: done
since: 2026-07-13T00:00:00.000Z
noldor-tier: specs-only
introduced: 1.0.0
---
## Summary

Deep-audit finding (batch `.noldor/research/2026-07-13-184850`): gated docs stay true, ungated docs rot — `validate skill-catalog` keeps the skill catalog perfectly 1:1, while `docs/noldor/script-catalog.md` (self-declared canonical) is missing ~20 live subcommands and its promised `validate:script-catalog` gate was never implemented (the page falsely claims a backlog entry exists). Ship the `validate:script-catalog` pre-commit gate mirroring the skill-catalog one, do the one-time catch-up of the missing subcommands, fix the template twin, and resolve the detector-count contradiction (script-catalog says 19, garden-and-drift says 20, code has more).

## User Story

As a Noldor maintainer (human or agent), I want a pre-commit gate that fails when a CLI subcommand exists in the manifest but is undocumented in the script catalog, so that `docs/noldor/script-catalog.md` stays 1:1 with the CLI the way `validate:skill-catalog` keeps the skill page honest.

## Usage

**CLI**

- `pnpm noldor validate script-catalog` — check-only. Exit 0 when every manifest leaf command's entrypoint `src` is cited by a Source link in `docs/noldor/script-catalog.md`; exit 1 listing the undocumented sources otherwise. Joins on the `src/…` path, so alias commands sharing an entrypoint are satisfied by one Source link and non-manifest sources (pnpm composites, helpers) are advisory-only.

**Pre-commit gate**

- Runs automatically (lefthook `validate` group, job `script-catalog`) when `src/cli/manifest.ts` or `docs/noldor/script-catalog.md` is staged. Mirror of the `skill-catalog` job.

**Fixing drift**

1. Add a Source-linked entry for the flagged command to `docs/noldor/script-catalog.md`.
2. Mirror the edit into the twin `templates/docs/noldor/script-catalog.md` (byte-identical — `pnpm noldor checks template-sync` enforces).
3. Commit; the gate re-runs green.

## PRs

<!-- @prs-since-last-release: validate-script-catalog-gate -->

## Changelog

<!-- generated: resources -->

## Resources

- **Code:**
  - [`src/cli/validate-script-catalog.ts`](../../src/cli/validate-script-catalog.ts)
- **Tests:**
  - [`src/cli/__tests__/validate-script-catalog.test.ts`](../../src/cli/__tests__/validate-script-catalog.test.ts)

<!-- /generated: resources -->
