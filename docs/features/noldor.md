---
name: Noldor Framework
phase: done
area: docs
category: Tooling
packages:
  - scripts
links:
  code:
    - src/core/changelog.ts
    - src/core/next-priority.ts
    - src/core/lint-plan-snippets.ts
    - src/core/release-markers.ts
    - src/core/validate-noldor-scope.ts
    - src/core/validate-noldor.ts
    - src/core/validate-skill-catalog.ts
    - src/cr/codex.ts
    - src/cr/sidecar.ts
    - src/cr/context.ts
    - src/cr/run-codex.ts
    - src/cr/cr-record.schema.json
    - src/cr/cli-args.ts
    - src/release/release-cr-gate.ts
    - src/garden/detectors/codex-cr-override-audit.ts
    - src/garden/detectors/override-audit.ts
    - src/garden/sdd-report.ts
    - src/core/pr-flow.ts
    - .claude/skills/gate/SKILL.md
    - .claude/skills/promote/SKILL.md
    - docs/noldor/pr-flow.md
  tests:
    - src/core/__tests__/changelog.test.ts
    - src/core/__tests__/lint-plan-snippets.test.ts
    - src/core/__tests__/phase-flip-done.test.ts
    - src/core/__tests__/release-markers.test.ts
    - src/core/__tests__/rename-plan-only-tier.test.ts
    - src/core/__tests__/validate-noldor-scope.test.ts
    - src/core/__tests__/validate-noldor.test.ts
    - src/core/__tests__/validate-skill-catalog.test.ts
    - src/cr/__tests__/amend-receipt.test.ts
    - src/cr/__tests__/cli-args.test.ts
    - src/cr/__tests__/codex.test.ts
    - src/cr/__tests__/context.test.ts
    - src/cr/__tests__/findings-schema.test.ts
    - src/cr/__tests__/run-codex.test.ts
    - src/cr/__tests__/schema-parity.test.ts
    - src/cr/__tests__/sidecar.test.ts
    - src/garden/__tests__/garden-detect.test.ts
    - src/garden/__tests__/garden-receipt.test.ts
    - src/garden/detectors/__tests__/allowlist-drift.test.ts
    - src/garden/detectors/__tests__/codex-cr-override-audit.test.ts
    - src/garden/detectors/__tests__/fd-without-plan.test.ts
    - src/garden/detectors/__tests__/override-audit.test.ts
    - src/garden/detectors/__tests__/plan-without-fd.test.ts
    - src/garden/detectors/__tests__/tier-mismatch.test.ts
    - src/garden/detectors/__tests__/trailer-scope-mismatch.test.ts
    - src/hooks/__tests__/noldor-validate-trailer.test.ts
    - src/release/__tests__/release-cr-gate-e2e.test.ts
    - src/release/__tests__/release-cr-gate.test.ts
  docs:
    - docs/noldor/README.md
    - docs/noldor/lifecycle.md
    - docs/noldor/complexity-gating.md
    - docs/noldor/workflow.md
    - docs/noldor/feature-md-schema.md
    - docs/noldor/worktree-discipline.md
    - docs/noldor/git-and-commits.md
    - docs/noldor/doc-conventions.md
    - docs/noldor/skill-catalog.md
    - docs/noldor/testing-principles.md
    - docs/noldor/versioning.md
    - docs/noldor/triage.md
    - docs/noldor/garden-and-drift.md
    - docs/noldor/graph-integration.md
    - docs/noldor/adoption-guide.md
    - docs/noldor/engineering-principles.md
    - docs/noldor/cr-pipeline.md
  spec: >-
    docs/superpowers/specs/archive/2026-05-08-quickforge-framework-extraction-design.md
noldor-tier: full
introduced: 0.4.0
updated: 0.5.0
---
## Summary

Noldor is the Charuy-internal dev-loop framework extracted into a
dedicated `docs/noldor/` folder so the project-agnostic rules
(complexity gating, worktree discipline, /promote /triage /garden,
SDD audit, graphify integration, FD schema, doc & test conventions,
engineering principles) live separately from Charuy's product-specific
overlays. Tracked as a single FD with all 17 framework pages in
`links.docs`; per-page change history is recovered via
`pnpm noldor:changelog` walking commit scopes
(`noldor:<slug>` / `noldor`).

## User Story

As a contributor (human or agent) iterating on the dev-loop framework, I want
the Noldor rules to live in a dedicated `docs/noldor/` home with
git-driven per-page change history, so that I can evolve framework theory as a
coherent body without bloating CLAUDE.md or duplicating frontmatter across 17
pages.

## Usage

**Reading the framework**

1. Start at [`docs/noldor/README.md`](../noldor/README.md) — the index
   maps each page to a "you are…" entry point (new to the framework, starting
   a feature, parallel branches, releasing, auditing, bootstrapping into
   another repo).
2. Follow the page links inline; CLAUDE.md and `.claude/CLAUDE.md` now hold
   only Charuy-specific overlays plus pointers into `docs/noldor/`.

**Editing a Noldor page**

1. Edit `docs/noldor/<page>.md`. Per-page frontmatter is minimal:
   `noldor-page: <slug>` (must match filename stem, except
   `README.md` → `index`) plus optional `introduced: <semver>`.
2. Commit using Conventional Commits scope `noldor:<page-slug>` for a
   single-page change, or `noldor` for a multi-page / framework-wide
   change. Examples:
   - `docs(noldor:complexity-gating): add 2-axis future-direction note`
   - `refactor(noldor): rename feature-md-schema sections`
3. Pre-commit runs `pnpm validate:noldor` (frontmatter check). Commit-msg
   runs `pnpm validate:noldor-scope` (rejects missing or wrong scope when
   the staged diff touches `docs/noldor/*.md`). Both are wired in
   `lefthook.yml`.
4. `pnpm release` walks `docs/noldor/*.md` and back-fills `introduced` on
   any page lacking it (separate logic from the FD `release-markers.ts`,
   which is `phase=done`-gated).

**Per-page changelog**

- `pnpm noldor:changelog` — emits a per-page table; filter is
  `(path-touched) AND (scope noldor:<slug> OR scope noldor)`. Both
  required, so accidental edits and multi-page framework commits both
  surface correctly.
- `pnpm noldor:changelog --page <slug>` — single-page view.

**Two-pass code review** — `/gate` end-of-flow runs Claude review (writes
`Noldor-Reviewed`); `pnpm cr:codex` runs Codex as a second pass
(writes `Noldor-Reviewed-Codex`). Both trailers are required by the
release gate on every code-touching commit. Override:
`Noldor-CR-Override-Codex: <reason>`. See
[`docs/noldor/cr-pipeline.md`](../noldor/cr-pipeline.md).

**Drift detection**

- `pnpm garden:detect` runs Detector 14 (rule contradiction across the
  CLAUDE.md ↔ Noldor tracked pairs) and Detector 15 (source-of-truth ↔
  page drift). Detector 9 (orphan source files) now also walks `scripts/`,
  so framework scripts surface alongside `packages/` and `apps/` files.

**Keyboard shortcut**

_none — framework / docs feature, not a UI action._

**Agent API**

_none — operates through git, lefthook, and `pnpm` scripts; no
`window.charuy.*` surface._

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/superpowers/specs/archive/2026-05-08-quickforge-framework-extraction-design.md`](../../docs/superpowers/specs/archive/2026-05-08-quickforge-framework-extraction-design.md)
- **Code:**
  - [`src/core/changelog.ts`](../../src/core/changelog.ts)
  - [`src/core/next-priority.ts`](../../src/core/next-priority.ts)
  - [`src/core/lint-plan-snippets.ts`](../../src/core/lint-plan-snippets.ts)
  - [`src/core/release-markers.ts`](../../src/core/release-markers.ts)
  - [`src/core/validate-noldor-scope.ts`](../../src/core/validate-noldor-scope.ts)
  - [`src/core/validate-noldor.ts`](../../src/core/validate-noldor.ts)
  - [`src/core/validate-skill-catalog.ts`](../../src/core/validate-skill-catalog.ts)
  - [`src/cr/codex.ts`](../../src/cr/codex.ts)
  - [`src/cr/sidecar.ts`](../../src/cr/sidecar.ts)
  - [`src/cr/context.ts`](../../src/cr/context.ts)
  - [`src/cr/run-codex.ts`](../../src/cr/run-codex.ts)
  - [`src/cr/cr-record.schema.json`](../../src/cr/cr-record.schema.json)
  - [`src/cr/cli-args.ts`](../../src/cr/cli-args.ts)
  - [`src/release/release-cr-gate.ts`](../../src/release/release-cr-gate.ts)
  - [`src/garden/detectors/codex-cr-override-audit.ts`](../../src/garden/detectors/codex-cr-override-audit.ts)
  - [`src/garden/detectors/override-audit.ts`](../../src/garden/detectors/override-audit.ts)
  - [`src/garden/sdd-report.ts`](../../src/garden/sdd-report.ts)
  - [`src/core/pr-flow.ts`](../../src/core/pr-flow.ts)
  - [`.claude/skills/gate/SKILL.md`](../../.claude/skills/gate/SKILL.md)
  - [`docs/noldor/pr-flow.md`](../../docs/noldor/pr-flow.md)
- **Tests:**
  - [`src/core/__tests__/changelog.test.ts`](../../src/core/__tests__/changelog.test.ts)
  - [`src/core/__tests__/lint-plan-snippets.test.ts`](../../src/core/__tests__/lint-plan-snippets.test.ts)
  - [`src/core/__tests__/phase-flip-done.test.ts`](../../src/core/__tests__/phase-flip-done.test.ts)
  - [`src/core/__tests__/release-markers.test.ts`](../../src/core/__tests__/release-markers.test.ts)
  - [`src/core/__tests__/rename-plan-only-tier.test.ts`](../../src/core/__tests__/rename-plan-only-tier.test.ts)
  - [`src/core/__tests__/validate-noldor-scope.test.ts`](../../src/core/__tests__/validate-noldor-scope.test.ts)
  - [`src/core/__tests__/validate-noldor.test.ts`](../../src/core/__tests__/validate-noldor.test.ts)
  - [`src/core/__tests__/validate-skill-catalog.test.ts`](../../src/core/__tests__/validate-skill-catalog.test.ts)
  - [`src/cr/__tests__/amend-receipt.test.ts`](../../src/cr/__tests__/amend-receipt.test.ts)
  - [`src/cr/__tests__/cli-args.test.ts`](../../src/cr/__tests__/cli-args.test.ts)
  - [`src/cr/__tests__/codex.test.ts`](../../src/cr/__tests__/codex.test.ts)
  - [`src/cr/__tests__/context.test.ts`](../../src/cr/__tests__/context.test.ts)
  - [`src/cr/__tests__/findings-schema.test.ts`](../../src/cr/__tests__/findings-schema.test.ts)
  - [`src/cr/__tests__/run-codex.test.ts`](../../src/cr/__tests__/run-codex.test.ts)
  - [`src/cr/__tests__/schema-parity.test.ts`](../../src/cr/__tests__/schema-parity.test.ts)
  - [`src/cr/__tests__/sidecar.test.ts`](../../src/cr/__tests__/sidecar.test.ts)
  - [`src/garden/__tests__/garden-detect.test.ts`](../../src/garden/__tests__/garden-detect.test.ts)
  - [`src/garden/__tests__/garden-receipt.test.ts`](../../src/garden/__tests__/garden-receipt.test.ts)
  - [`src/garden/detectors/__tests__/allowlist-drift.test.ts`](../../src/garden/detectors/__tests__/allowlist-drift.test.ts)
  - [`src/garden/detectors/__tests__/codex-cr-override-audit.test.ts`](../../src/garden/detectors/__tests__/codex-cr-override-audit.test.ts)
  - [`src/garden/detectors/__tests__/fd-without-plan.test.ts`](../../src/garden/detectors/__tests__/fd-without-plan.test.ts)
  - [`src/garden/detectors/__tests__/override-audit.test.ts`](../../src/garden/detectors/__tests__/override-audit.test.ts)
  - [`src/garden/detectors/__tests__/plan-without-fd.test.ts`](../../src/garden/detectors/__tests__/plan-without-fd.test.ts)
  - [`src/garden/detectors/__tests__/tier-mismatch.test.ts`](../../src/garden/detectors/__tests__/tier-mismatch.test.ts)
  - [`src/garden/detectors/__tests__/trailer-scope-mismatch.test.ts`](../../src/garden/detectors/__tests__/trailer-scope-mismatch.test.ts)
  - [`src/hooks/__tests__/noldor-validate-trailer.test.ts`](../../src/hooks/__tests__/noldor-validate-trailer.test.ts)
  - [`src/release/__tests__/release-cr-gate-e2e.test.ts`](../../src/release/__tests__/release-cr-gate-e2e.test.ts)
  - [`src/release/__tests__/release-cr-gate.test.ts`](../../src/release/__tests__/release-cr-gate.test.ts)
- **Docs:**
  - [`docs/noldor/README.md`](../../docs/noldor/README.md)
  - [`docs/noldor/lifecycle.md`](../../docs/noldor/lifecycle.md)
  - [`docs/noldor/complexity-gating.md`](../../docs/noldor/complexity-gating.md)
  - [`docs/noldor/workflow.md`](../../docs/noldor/workflow.md)
  - [`docs/noldor/feature-md-schema.md`](../../docs/noldor/feature-md-schema.md)
  - [`docs/noldor/worktree-discipline.md`](../../docs/noldor/worktree-discipline.md)
  - [`docs/noldor/git-and-commits.md`](../../docs/noldor/git-and-commits.md)
  - [`docs/noldor/doc-conventions.md`](../../docs/noldor/doc-conventions.md)
  - [`docs/noldor/skill-catalog.md`](../../docs/noldor/skill-catalog.md)
  - [`docs/noldor/testing-principles.md`](../../docs/noldor/testing-principles.md)
  - [`docs/noldor/versioning.md`](../../docs/noldor/versioning.md)
  - [`docs/noldor/triage.md`](../../docs/noldor/triage.md)
  - [`docs/noldor/garden-and-drift.md`](../../docs/noldor/garden-and-drift.md)
  - [`docs/noldor/graph-integration.md`](../../docs/noldor/graph-integration.md)
  - [`docs/noldor/adoption-guide.md`](../../docs/noldor/adoption-guide.md)
  - [`docs/noldor/engineering-principles.md`](../../docs/noldor/engineering-principles.md)
  - [`docs/noldor/cr-pipeline.md`](../../docs/noldor/cr-pipeline.md)

<!-- /generated: resources -->

## Enhancements

- **Specs-only tier produces a spec file** (2026-05-25): flipped tier behavior to match the rename's original intent — `specs-only` paths now invoke `superpowers:brainstorming` and produce a spec file (no plan). Roster stays at 2 tiers (`specs-only`, `full`). See [spec](../superpowers/specs/2026-05-25-noldor-specs-only-tier-produces-spec-design.md) + [plan](../superpowers/plans/2026-05-25-noldor-specs-only-tier-produces-spec.md).

## Changelog

### 0.5.0

#### Summary

This release drops the pending-priority file mechanism via a refactor (#2), adds a static lint pass over plan/spec code blocks at gate Step 2.5, introduces a `pnpm next-priority` CLI for end-of-flow handoff, and fixes the override-audit ledger to skip commits that only touch `docs/sdd-report.md`.

#### PRs

- #2: drop pending-priority file mechanism ([link](https://github.com/davidzoufaly/charuy/pull/2))

### 0.4.0

#### Summary

Final-review findings addressed (tags, FD links, `--dry-run`, `--rerun`) and `codex-cr-override-audit` detector added, with recognition of the `Noldor-CR-Override-Codex` trailer. `checkCrGate` wired into `pnpm release` preconditions, backed by new `release-cr-gate` module (diff-scope + tree-match) and `pnpm cr:codex` CLI for gate and ad-hoc lanes. CLI arg parser for codex CR invocation modes added, with unknown flags rejected in `cli-args` and `SHA_RE` tightened. Codex subprocess wrapper ships with schema-validated output and a prompt context builder. Sidecar I/O for codex CR records introduced; `writeSidecar` mkdir exercised and `readSidecar` contract documented. Gate rewrite rollout hardened.
