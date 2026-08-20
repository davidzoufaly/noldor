---
area: tooling
category: Tooling
deps: []
entry-id: Q-0139
links:
  code: []
  tests: []
  spec: docs/design/specs/2026-08-20-root-readme-content-validator-design.md
name: Root README Content Validator
packages:
  - package.json
phase: in-progress
since: 2026-08-17T00:00:00.000Z
noldor-tier: full
---
## Summary

Root `README.md` is the only doc surface the framework never inspects for content, so every capability added to the CLI or to `docs/` can drift out of the front door silently. Four mechanisms touch the file and none read what it says: `docs check` resolves its links but not its claims (`src/docs/docs-check.ts:222`), the `bootstrap commands` rule-pair asserts one `pnpm test` mention at `severity: 'warn'` (`src/invariants/rule-pairs.ts:62`), SDD detector 12 `detectReadmePackageDrift` keys on a `### Packages` table this repo does not have (`src/garden/sdd-report.ts:490`), and release-sweep step 4 is prose asking an LLM to eyeball the file. The measured miss: Q-0093 shipped a `docs architecture` subcommand plus a four-page `docs/architecture/` surface, and the README stayed silent — the string "architecture" appears nowhere in it.

This adds two structural checks behind `pnpm noldor checks readme`. **Command resolution:** every command the README quotes resolves — `pnpm noldor <group> <sub>` against `flattenManifest()`, `pnpm run <name>` and `pnpm <script>` against root `package.json` `scripts`, with `add` / `install` / `dlx` / `exec` out of scope because their arguments are not repo-owned names. **Doc-surface reachability:** every directory one level under `docs/` holding markdown — minus the per-change artifact dirs `features` and `design` — must be reachable by a transitive markdown-link walk seeded from the README. No surface registry is maintained: a new `docs/<dir>/` enrols itself and immediately demands a link.

Direction on the CLI half is README → registry only. The README's `## CLI reference` section declares itself "the journey-critical subset, **not exhaustive**", so demanding a row per manifest group would contradict its stated contract; `validate script-catalog` already enforces exhaustive coverage against `docs/noldor/script-catalog.md`. That leaves one hole — a subcommand aliased onto an already-catalogued entrypoint is checked by neither gate — recorded as **Q-0147** rather than claimed as covered.

Findings are advisory everywhere. The `pre-push` job runs `checks readme || true`, and release preflight carries a `readme` row at `warn`, which never aborts a release. There is deliberately **no `GardenFindings` key**: routing to `sddGaps` would gate the garden receipt and therefore block a release through the four-hop chain Q-0136 exists to make structural, and a hand-rolled advisory key on the `architectureAdvisories` precedent would have no consumer beyond the JSON dump. Declining both is what let this ship without waiting on Q-0136. Advisory rather than blocking is an adoption decision too: the lefthook template twin is byte-identical and there is no `templates/README.md`, so a blocking job would red a fresh consumer's first push against a file the framework itself treats as consumer-owned.

Design: [`docs/design/specs/2026-08-20-root-readme-content-validator-design.md`](../design/specs/2026-08-20-root-readme-content-validator-design.md).

## User Story

<!-- TODO: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: UI steps, keyboard shortcut, agent API call. -->

## PRs

<!-- @prs-since-last-release: root-readme-content-validator -->

## Changelog
