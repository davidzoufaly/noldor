---
area: tooling
category: Tooling
deps: []
entry-id: Q-0139
links:
  code:
    - src/checks/check-readme.ts
    - src/docs/readme-content.ts
  tests:
    - src/checks/__tests__/check-readme.test.ts
    - src/docs/__tests__/readme-content.test.ts
  spec: docs/design/specs/archive/2026-08-20-root-readme-content-validator-design.md
name: Root README Content Validator
packages:
  - package.json
phase: done
since: 2026-08-17T00:00:00.000Z
noldor-tier: full
---
## Summary

Root `README.md` is the only doc surface the framework never inspects for content, so a documentation surface added under `docs/` can become unreachable from the project's front door and nothing notices. Four mechanisms touch the file and none read what it says: `docs check` resolves its links but not its claims (`src/docs/docs-check.ts:222`), the `bootstrap commands` rule-pair asserts one `pnpm test` mention at `severity: 'warn'` (`src/invariants/rule-pairs.ts:62`), SDD detector 12 `detectReadmePackageDrift` keys on a `### Packages` table this repo does not have (`src/garden/sdd-report.ts:490`), and release-sweep step 4 is prose asking an LLM to eyeball the file. The measured miss: Q-0093 shipped a four-page `docs/architecture/` surface and the README stayed silent — the string "architecture" appeared nowhere in it.

`pnpm noldor checks readme` closes that gap. Every directory one level under `docs/` holding markdown — minus the per-change artifact dirs `features`, `design`, `superpowers` and `milestones` — must be reachable by a transitive markdown-link walk seeded from the README. Reachability is satisfied by any reached markdown file or directly-linked directory at or beneath the surface. No surface registry is maintained: a new `docs/<dir>/` enrols itself and immediately demands a link. Link eligibility is inherited from `extractLinks`, which strips code regions — load-bearing here, because `docs/architecture/` and `docs/adr/` were named in the rule pages only inside prose backticks, never as links.

**Scope is reachability only.** Validating the commands the README quotes was cut at code review and is tracked as **Q-0148**: `src/garden/detectors/fd-command-rot.ts` already owns command resolution — an exported `commandTokens`, a ~33-entry `PNPM_BUILTINS`, and a registry unioning manifest leaves, bare group names, `package.json` scripts and script-catalog aliases — and a second, weaker implementation here produced verified false findings on `pnpm --filter web run build`, `pnpm remove`, `pnpm publish` and `pnpm noldor docs --help`. That half belongs on those helpers.

Findings are advisory everywhere. The `pre-push` job runs `checks readme || true`, and release preflight carries a `readme` row at `warn`, which never aborts a release. There is deliberately no `GardenFindings` key: routing to `sddGaps` would gate the garden receipt and block a release through the four-hop chain Q-0136 exists to make structural. Advisory rather than blocking is also an adoption decision — the lefthook template twin is byte-identical and there is no `templates/README.md`, so a blocking job would red a fresh consumer's first push against a file the framework treats as consumer-owned.

Design: [`docs/design/specs/archive/2026-08-20-root-readme-content-validator-design.md`](../design/specs/archive/2026-08-20-root-readme-content-validator-design.md).

## User Story

As a framework maintainer (human or agent), I want every documentation surface under `docs/` checked for reachability from the README at push time, so that a surface I add cannot sit unnavigable from the project's front door.

## Usage

**Agent/Programmatic API**

- `pnpm noldor checks readme` — checks doc-surface reachability. Exit 0 clean, exit 1 when findings exist. Operational degradations (unreadable link target, missing `package.json`) print as `note:` lines and never change the exit code.
- Runs automatically as an advisory `pre-push` job wired `pnpm noldor checks readme || true`, so it reports without blocking the push. Fix a finding by editing `README.md` and pushing again — no separate micro-chore needed.
- `pnpm release --preflight` renders a `readme` row carrying any notes in its detail. Findings show as `warn` and never abort a release. `RELEASE_SKIP_README=1` skips the row and records the override.

**UI** — _none: this is a CLI and hook surface with no dashboard route._

**Keyboard shortcut** — _none for v1: the check has no interactive surface to bind._

## PRs

<!-- @prs-since-last-release: root-readme-content-validator -->

## Changelog
