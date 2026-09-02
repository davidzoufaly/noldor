---
area: tooling
category: Tooling
deps: []
entry-id: Q-0144
links:
  code:
    - src/core/ui-predicate.ts
    - src/core/run-capture.ts
    - src/core/consumer-config.ts
    - src/core/design-artifact-names.ts
    - src/core/doc-roots.ts
    - src/core/session.ts
    - src/core/feature-schema.ts
    - src/release/ui-design-freshness.ts
    - src/checks/check-ui-design-freshness.ts
    - src/design/ui-capture.ts
    - src/design/ui-capture-cli.ts
    - src/design/ui-sync-cli.ts
    - src/design/archive-resolve.ts
    - src/design/archive-cli.ts
    - src/sync/sync-fd-resources.ts
  spec: docs/design/specs/archive/2026-08-19-pendev-ui-design-phase-design.md
  tests:
    - src/checks/__tests__/check-ui-design-freshness.test.ts
    - src/core/__tests__/design-artifact-names.test.ts
    - src/core/__tests__/ui-predicate.test.ts
    - src/design/__tests__/design-approval.test.ts
    - src/design/__tests__/pen-bridge.test.ts
    - src/design/__tests__/ui-capture.test.ts
    - src/design/__tests__/ui-sync.test.ts
    - src/release/__tests__/ui-design-freshness.test.ts
name: pen.dev UI Design Phase
packages:
  - package.json
phase: in-progress
since: 2026-08-17T00:00:00.000Z
noldor-tier: full
introduced: 1.4.0
updated: 1.6.0
---
## Summary

The framework has no UI-design stage: `/noldor-spec` produces prose, and a frontend feature's visual design is either absent from the artifact trail or pasted in as a screenshot nobody validates. This feature adds a pen.dev-backed design step inside the spec phase: on UI-bearing sessions (decided by a `consumer.uiPaths` predicate with an FD `design:` override, never by operator memory), several UI versions are drafted and compared as pages inside one repo-committed `.pen` file while the spec is still being written, converging on one `FINAL:` design per affected surface that the spec links and gate Step 2.5 commits alongside it — design decisions adjudicated with the rest of the spec rather than after it. A shared baseline at `docs/design/ui/baseline/<surface>.pen` mirrors the shipped UI so every design session seeds from reality; ship-time write-back plus an ancestry-based per-surface freshness check and a `design ui-sync` remediation command keep it from rotting. The design spec resolves the entry's open questions (artifact pinning via git, candidates-as-pages, predicate semantics, non-UI skip); the review lane that checks implemented UI against the chosen design was carved out to Q-0145. Related but distinct: Q-0116's design-artifact detector module governs how design artifacts are discovered once they exist, not where they come from. Consumer-blocking, which is why this outranked internal-polish entries per the vision's adoption tie-breaker.

## User Story

As an operator shipping a UI feature through the gate, I want the spec phase to produce a pinned visual design seeded from an always-current baseline of the shipped UI, so that design decisions are adjudicated with the spec, iteration starts from reality rather than memory, and the artifact trail records what was chosen and why.

## Usage

- Consumer setup: add `"uiPaths": ["src/dashboard/app/**"]` (optionally `"uiSurfaces": {"dashboard": ["src/dashboard/app/**"]}`) to `consumer` in `.noldor/config.json`; run `pnpm noldor design ui-sync` once per surface to bootstrap the baseline. To make freshness depend on the capture actually working, also declare `"uiCapture": {"<surface>": {"command": "<the underlying capture command>", "timeoutMs": 300000}}` and repoint your own script at the wrapper (`"design:capture-ui": "noldor design capture"`). **`command` must be the underlying command, never the alias you just repointed** — declaring `"command": "pnpm design:capture-ui"` makes the wrapper invoke itself.
- Spec phase (automatic): on a UI-bearing entry, the design step seeds `docs/design/ui/<date>-<slug>.pen` from the affected baseline surfaces, iterates variants as pages, marks one winner `FINAL:` per surface; the gate commits it with the spec.
- Design approval (automatic on UI-bearing sessions with no waiver, in the `/noldor-spec` skill flow — the prose-dispatch runners' workflow docs do not yet carry it): the design step **opens the session's `.pen` by path first** (`pnpm noldor design pen-bridge --pen <the session's .pen>` — a bare invocation opens a *tracked* file and this one is untracked until the spec commit), **then** verifies via `get_app_state` that the open document is that file and holds exactly one `FINAL:<surface>:` page per affected surface, walks each winner and alternative, and asks for one atomic approve / revise verdict over the whole set. Opening precedes every read: `get_app_state` reports whatever canvas is open, so reading first can inspect another document. `revise` must say what to change and returns to iteration; after two rounds approve-with-reservations is offered too. On approve, the approval is written into the spec's `## Design`, per surface — then recorded on disk: `pnpm noldor design verdict --pen <the session's .pen> --approve --surface <s> [--surface <s>...] [--reservation "<text>"]` writes `.noldor/design-approval/<pen-stem>.json`, blob-bound to the approved file. A waiver taken after Seed records the same way via `--waive --reason "<why>"`. The record commits with the spec and the `.pen` at gate Step 2.5.
- Approval enforcement (automatic): the pre-commit `shared-files` job refuses a feature `.pen` entering the index without a matching record — `pen-unapproved` (none usable in the resulting tree) or `pen-approval-mismatch` (the record names a different version of the design); `NOLDOR_ALLOW_PEN_WRITE` waives neither, and a record already committed in `HEAD` satisfies it. At code stage the `ui-reviewer` lane refuses a design with no record (`design-unapproved`) or one edited after its verdict (`design-approval-stale`) — advisory by default, red under `autonomous.uiReviewMode: blocking`. Remedy for every one of them: re-run `design verdict` on the design as it now stands (the write overwrites).
- Override: set `design: required` or `design: skip` in the FD frontmatter to force either verdict (operator-only field).
- Capture: `pnpm noldor design capture [--surface <name>] [--vouch-only]` runs each surface's declared command and writes `.noldor/ui-capture/<surface>.json` only when it exits 0 and produced a baseline. Surfaces run sequentially; a failure leaves that surface's receipt untouched and exits non-zero. Commit the baseline together with its receipt — the receipt is what the freshness check reads, so a capture that fails can no longer leave a surface reading `fresh`. After a sanctioned hand edit to a baseline (the gate's Step 4 write-back), use `--surface <name> --vouch-only`: it records a receipt for the file on disk without running the command, which would otherwise overwrite the edit. It needs `--surface` (a bare vouch would green untouched surfaces) and works even where no `uiCapture` command is declared.
- Freshness: `pnpm noldor checks ui-design-freshness` any time; gate Step 4 and release preflight run it automatically. Remediation depends on the row, and the report names the right one per surface: `unverified` and a receipt-backed `stale` are repaired by `pnpm noldor design capture`; `uninitialized`, and a surface still on the pre-receipt read, by hand via `pnpm noldor design ui-sync`.

## PRs

<!-- @prs-since-last-release: pendev-ui-design-phase -->

## Changelog

### 1.6.0

#### Summary

This release rests UI baseline freshness on a capture receipt (#401), takes an operator verdict on the `.pen` before implementation (#399), and enforces the design-approval signal at commit and review time (#406).

#### PRs

- #401: rest UI baseline freshness on a capture receipt ([link](https://github.com/davidzoufaly/noldor/pull/401))
- #399: take an operator verdict on the .pen before implementation ([link](https://github.com/davidzoufaly/noldor/pull/399))
- #406: enforce the design-approval signal at commit and review time ([link](https://github.com/davidzoufaly/noldor/pull/406))

### Initial Release (v1.4.0)

#### Summary

Consumer config schema now accepts `uiPaths` and `uiSurfaces` (#342).

#### PRs

- #342: add uiPaths + uiSurfaces to consumer config schema ([link](https://github.com/davidzoufaly/noldor/pull/342))

<!-- generated: resources -->

## Resources

- **Spec:** [`docs/design/specs/archive/2026-08-19-pendev-ui-design-phase-design.md`](../../docs/design/specs/archive/2026-08-19-pendev-ui-design-phase-design.md)
- **Code:**
  - [`src/core/ui-predicate.ts`](../../src/core/ui-predicate.ts)
  - [`src/core/run-capture.ts`](../../src/core/run-capture.ts)
  - [`src/core/consumer-config.ts`](../../src/core/consumer-config.ts)
  - [`src/core/design-artifact-names.ts`](../../src/core/design-artifact-names.ts)
  - [`src/core/doc-roots.ts`](../../src/core/doc-roots.ts)
  - [`src/core/session.ts`](../../src/core/session.ts)
  - [`src/core/feature-schema.ts`](../../src/core/feature-schema.ts)
  - [`src/release/ui-design-freshness.ts`](../../src/release/ui-design-freshness.ts)
  - [`src/checks/check-ui-design-freshness.ts`](../../src/checks/check-ui-design-freshness.ts)
  - [`src/design/ui-capture.ts`](../../src/design/ui-capture.ts)
  - [`src/design/ui-capture-cli.ts`](../../src/design/ui-capture-cli.ts)
  - [`src/design/ui-sync-cli.ts`](../../src/design/ui-sync-cli.ts)
  - [`src/design/archive-resolve.ts`](../../src/design/archive-resolve.ts)
  - [`src/design/archive-cli.ts`](../../src/design/archive-cli.ts)
  - [`src/sync/sync-fd-resources.ts`](../../src/sync/sync-fd-resources.ts)
- **Tests:**
  - [`src/checks/__tests__/check-ui-design-freshness.test.ts`](../../src/checks/__tests__/check-ui-design-freshness.test.ts)
  - [`src/core/__tests__/design-artifact-names.test.ts`](../../src/core/__tests__/design-artifact-names.test.ts)
  - [`src/core/__tests__/ui-predicate.test.ts`](../../src/core/__tests__/ui-predicate.test.ts)
  - [`src/design/__tests__/design-approval.test.ts`](../../src/design/__tests__/design-approval.test.ts)
  - [`src/design/__tests__/pen-bridge.test.ts`](../../src/design/__tests__/pen-bridge.test.ts)
  - [`src/design/__tests__/ui-capture.test.ts`](../../src/design/__tests__/ui-capture.test.ts)
  - [`src/design/__tests__/ui-sync.test.ts`](../../src/design/__tests__/ui-sync.test.ts)
  - [`src/release/__tests__/ui-design-freshness.test.ts`](../../src/release/__tests__/ui-design-freshness.test.ts)

<!-- /generated: resources -->
