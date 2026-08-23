---
area: tooling
category: Tooling
deps: []
links:
  code:
    - src/checks/check-lefthook-wiring.ts
    - src/cli/manifest.ts
  tests:
    - src/checks/__tests__/check-lefthook-wiring.test.ts
    - src/cli/__tests__/cli.test.ts
    - src/cli/__tests__/dist-import-graph.test.ts
    - src/cli/__tests__/runtime-parity.test.ts
    - src/cli/__tests__/runtime-select.test.ts
    - src/templates/__tests__/templates.test.ts
  spec: docs/design/specs/archive/2026-05-26-noldor-package-lift-design.md
  plan: docs/design/plans/archive/2026-05-26-noldor-package-lift.md
name: Noldor Package Lift
packages:
  - noldor
  - scripts
phase: done
noldor-tier: full
introduced: 0.2.0
---

## Summary

<!-- TODO 1-3 sentences. What the feature is. -->

## User Story

As an agent or developer driving the Noldor dev-loop framework, I want the
entire framework (code, docs, skills, hooks) lifted into a single `noldor`
workspace package exposing one `pnpm noldor <group> <command>` CLI, so that
Charuy consumes it via `workspace:*`, the framework versions independently of
the product, and any other repo can adopt it through `noldor init`.

## Usage

**CLI**

- All framework operations run through one binary: `pnpm noldor <group> <command> [args]` (e.g. `pnpm noldor garden detect`, `pnpm noldor cr orchestrate`, `pnpm noldor validate features`).
- `pnpm noldor --help` lists command groups; `pnpm noldor <group> --help` lists a group's subcommands.

**Adoption / drift**

- `pnpm noldor init` scaffolds the framework's template-managed files (`docs/noldor/`, `.claude/skills/`, `.claude/noldor.md`, `.claude/engineering-rules.md`, `lefthook/noldor.yml`) into a consumer repo. `--update` re-syncs them; `--adopt` bootstraps templates from existing consumer state (monorepo only).
- `pnpm noldor doctor` diffs every template-managed file against the package version and exits non-zero on drift (wired into `pnpm verify`).

**Evolving the framework (first-party dev repo)**

- Edit the `packages/noldor/templates/…` copy, run `pnpm noldor init --update` to propagate, commit both — never hand-edit the consumer copy.

**Runtime**

- Nothing to configure: every invocation runs compiled `dist` when the build matches the working tree, and falls back to `src` through tsx when it does not. An installed package carries only `dist`.
- `NOLDOR_RUNTIME=source` forces the tsx path (source-level stack traces while debugging); `NOLDOR_RUNTIME=dist` forces the compiled path and warns on stderr if the build is stale. Unset and empty both mean "decide automatically".
- `pnpm build` refreshes the compiled runtime, prunes anything the current sources no longer produce, and stamps the result. The pre-commit chain runs it once so the framework's own hook jobs execute compiled code.
- `pnpm noldor doctor` reports which runtime served the process and why, e.g. `runtime: dist (digest-match)` or `runtime: source (digest-mismatch)`.
- `pnpm bench:runtime` prints the median cost of the freshness decision over five warm runs.

## PRs

<!-- @prs-since-last-release: noldor-package-lift -->

## Changelog

### Initial Release (v0.2.0)

#### Summary

The framework is now lifted into a dedicated `packages/noldor` workspace package (#53).

#### PRs

- #53: lift framework into packages/noldor workspace package ([link](https://github.com/davidzoufaly/noldor/pull/53))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-05-26-noldor-package-lift-design.md`](../../docs/design/specs/archive/2026-05-26-noldor-package-lift-design.md)
- **Plan:**
  - [`docs/design/plans/archive/2026-05-26-noldor-package-lift.md`](../../docs/design/plans/archive/2026-05-26-noldor-package-lift.md)
- **Code:**
  - [`src/checks/check-lefthook-wiring.ts`](../../src/checks/check-lefthook-wiring.ts)
  - [`src/cli/manifest.ts`](../../src/cli/manifest.ts)
- **Tests:**
  - [`src/checks/__tests__/check-lefthook-wiring.test.ts`](../../src/checks/__tests__/check-lefthook-wiring.test.ts)
  - [`src/cli/__tests__/cli.test.ts`](../../src/cli/__tests__/cli.test.ts)
  - [`src/cli/__tests__/dist-import-graph.test.ts`](../../src/cli/__tests__/dist-import-graph.test.ts)
  - [`src/cli/__tests__/runtime-parity.test.ts`](../../src/cli/__tests__/runtime-parity.test.ts)
  - [`src/cli/__tests__/runtime-select.test.ts`](../../src/cli/__tests__/runtime-select.test.ts)
  - [`src/templates/__tests__/templates.test.ts`](../../src/templates/__tests__/templates.test.ts)

<!-- /generated: resources -->
