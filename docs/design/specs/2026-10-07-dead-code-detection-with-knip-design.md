# Dead-Code Detection with knip — Design

**Slug:** dead-code-detection-with-knip
**FD:** docs/features/dead-code-detection-with-knip.md
**Date:** 2026-10-07
**Tier:** specs-only

UI verdict: skip — no candidate path touches a UI surface, and `consumer.uiPaths` is unset.

Architecture verdict: skip — the code lands in `src/checks/` beside `skill-size.ts`; no new module, package or external.

## Problem

Nothing in noldor finds dead code: unused files, unused exports, unused or unlisted dependencies. `noldor clones` (`src/clones/`) finds code that exists twice, not code that should not exist. The `/noldor-refactor` report's `### Dead Code` section (`.claude/skills/noldor-refactor/SKILL.md:159`) is filled in by hand, and the dashboard's `deadExportCount` (`src/dashboard/data.ts`, `parseDeadExports`) reads a `GRAPH_REPORT.md` section nothing writes.

A zero-config knip run over this repo today reports 226 unused exports, 160 unused exported types, 148 unused files, two unused dependencies, one unlisted dependency and one unresolved import. Most of the 148 files are false positives — 114 are `src/indirection/__tests__/trees/` fixtures, and the rest are CLI leaves knip cannot see because `src/cli/index.ts` loads them by string from `MANIFEST`. So the raw number is not usable as-is: knip needs to be told where the entry points are before any count means anything.

## Goals

- knip runs over noldor with a config that knows the real entry points, so what it reports is actually dead.
- A ratchet: a recorded baseline of today's findings, and a check that reds when a change adds a new one.
- The check runs on every push from this repo.

## Non-goals

- Anything consumer-facing — the opt-in consumer check, `sdd-report` counts, the dashboard slot and the `/noldor-refactor` section are Q-0345 (`Dead-Code Detection for Consumers`), after this has proved itself.
- Fixing anything knip finds today — the dead files and exports, the `package.json` findings (`@swc/core`, `oxfmt`, `playwright`), and the unresolved type import in `src/hooks/__tests__/validate-pushed-adrs.test.ts:6`. The baseline records every one of them; draining them is one follow-up idea filed at ship time, so this PR stays a tool rather than a sweep.

## Design

### Structural context

No candidate paths: the FD has no `links.code` yet and the entry declared no `Touches:`. The digest below is from the three files this design builds on, run as proxies.

- `src/clones/baseline.ts` sits in community c119 with its own test only; its outbound edges go to `clones-cli.ts` (c85) and `state-file.ts` (c41). Interior — no god node, no bridge.
- `src/checks/skill-size.ts` is in c41 alongside `src/core/state-file.ts`, the state-file hardening code. The new file lands in the same community, reusing `readCheckedState` / `writeJsonState` the same way.
- `src/cli/manifest.ts` is in c16 with the doc and catalog validators; its edges fan out to `index.ts`, `help.ts`, `capability-index.ts`. The knip config reads `flattenManifest()` from it, which adds one more reader to that fan-out but no edge inside `src/`.

### knip config

A `knip.ts` at the repo root. It is TypeScript so it can import `flattenManifest()` from `src/cli/manifest.ts` and list every leaf's `src` as an entry — the manifest stays the one place that names the CLI's entry points, and a new command never needs a knip edit. Other entries: `bin/*.mjs`, `src/cli/index.ts`, `templates/scripts/*.mjs`. Ignored: test fixture trees (`src/indirection/__tests__/trees/**`, `src/fixtures/**`). knip's vitest plugin picks the test files up as entries on its own.

knip is pinned as an exact-version devDependency, so every run on every machine uses the same rules.

The split between config and baseline is a rule: a finding that is not really dead goes into `knip.ts` — an entry or an ignore, each with a one-line comment saying why — and never into the baseline. `@swc/core` is the first case: knip calls it unused, but dependency-cruiser loads it as a parser (`src/invariants/slug-path-choke-point.ts:12`), so it goes in `ignoreDependencies`. `src/invariants/.dependency-cruiser.cjs` gets the same treatment, as an entry if something loads it and a delete-candidate in the baseline if nothing does. The baseline then holds only true findings — dead code, plus the real defects knip reports beside it (an unlisted dependency, an unresolved import) — so draining it later is honest work.

### The check: `noldor dead-code`

`src/checks/dead-code.ts`, shaped like `src/checks/skill-size.ts`: `noldor dead-code <report|check|baseline>`. It runs the local knip binary with `--reporter json --no-progress --no-exit-code`, parses the JSON, and turns every finding into one key: `<type>:<file>:<name>` (for example `exports:src/core/config.ts:loadRaw`; a whole-file finding has no name). For a member finding the name carries its parent (`enumMembers:<file>:Enum.member`), and a `duplicates` group joins its sorted names with `|`, so two findings never share a key.

The manifest entry is a bare group like `skill-size`, desc ending `(this repo only)`.

### Baseline and ratchet

`.noldor/dead-code-baseline.json` holds `{ algorithmVersion, knipVersion, recordedAt, issues: string[] }`, `issues` sorted. The check compares the current key set to the recorded one:

- a key not in the baseline → red, exit 1, every new key listed;
- a baseline key now gone → green, with a hint to re-record and lock the gain in;
- same set → green.

This is a set ratchet, not a count ratchet like clones'. A knip finding has a stable name, so the check can say exactly what is new, and deleting one dead export does not buy room for another. Trade-off, accepted: moving a file that has unused exports makes them "new", so the move either deletes them or re-records.

A `knipVersion` or `algorithmVersion` mismatch is exit 3 with a re-record hint, the same as skill-size: this ratchet guards one repo, so a skip would leave it unguarded.

### Wiring

One pre-push job in the root `lefthook.yml`, next to `skill-size`: `pnpm noldor dead-code check`. Not in `lefthook/noldor.yml` — that file ships to every consumer. The same command is appended to the `verify` script in `package.json`, which `.github/workflows/contract-e2e.yml` runs on every pull request — the backstop for a push made with `--no-verify`. A knip run over this repo takes about 2.5 s.

### Errors

knip missing, crashing, or printing JSON the parser rejects → exit 3, "could not look", never green. The exit-code table mirrors skill-size's header.

## Acceptance criteria

- `pnpm noldor dead-code report` prints every current finding grouped by type and exits 0.
- `pnpm noldor dead-code baseline` writes `.noldor/dead-code-baseline.json` with a sorted key list and exits 0.
- With the baseline recorded, `check` exits 0 on an unchanged tree.
- Adding an unused export to a `src/` file makes `check` exit 1 and name that export.
- Deleting a recorded unused export keeps `check` at exit 0 and prints a re-record hint.
- A baseline with a different `knipVersion` or `algorithmVersion` makes `check` exit 3.
- A knip failure or unparseable output makes `check` exit 3.
- No CLI leaf in `MANIFEST` is reported as an unused file.
- `git push` from this repo and `pnpm verify` both run the check.
- Nothing in `lefthook/noldor.yml` or `templates/` changes.

## Risks / trade-offs

- knip's TypeScript plugin resolution may disagree with how `bin/boot.mjs` picks `dist/` vs `src/`; if so, more config, not code.
- Pre-push gets slower by one knip run (about 2.5 s here).
- A knip upgrade can change findings; the exit-3 mismatch forces a deliberate re-record.
- Pre-push checks the working tree, not the pushed ref, so an uncommitted edit can sway it — the same as skill-size; the CI run over the PR is exact.

## User Story

As a noldor maintainer (human or agent), I want a push to fail when my change leaves new dead code behind, so that the codebase stops collecting unused files, exports and dependencies.

## Usage

```bash
pnpm noldor dead-code report     # list what knip finds today
pnpm noldor dead-code baseline   # record the current findings as the floor
pnpm noldor dead-code check      # exit 1 if anything new appeared (runs on pre-push)
```

## Open questions (resolved)

1. _Set ratchet or count ratchet?_ -> Set: a knip finding has a name, so the check can say what is new, and a removal cannot fund an addition. (D1)
2. _Clean up today's dead code in this PR, or baseline it?_ -> Baseline all of it, `package.json` findings and the broken test import included; one follow-up idea covers the drain, so this PR stays a tool. (D2)
3. _Where does a false positive go?_ -> Into `knip.ts` as an entry or ignore with a one-line why, never into the baseline, so the baseline holds only true findings. (D3)
4. _Which knip issue types count?_ -> knip's defaults, all of them. Narrowing later is a config edit. (D4)
5. _Pre-push or CI?_ -> Both: pre-push in the root `lefthook.yml` for fast feedback, and the `verify` script that CI runs on every PR, since pre-push can be skipped. One knip run costs about 2.5 s. (D5)
