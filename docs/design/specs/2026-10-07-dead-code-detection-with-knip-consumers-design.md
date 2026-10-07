# Dead-Code Detection for Consumers — Design

**Slug:** dead-code-detection-with-knip-consumers
**FD:** docs/features/dead-code-detection-with-knip.md
**Date:** 2026-10-07
**Tier:** specs-only
**Deps:** dead-code-detection-with-knip (Q-0342, shipped in PR #679)



## Problem

`noldor dead-code` (`src/checks/dead-code.ts`) ratchets knip's findings in this repo only. A consumer gets nothing: the command exits 3 when knip is missing or the baseline is absent, so it cannot ship in the consumer lefthook block (`templates/lefthook/noldor.yml`) without breaking every push in a repo that never installed knip. The three places that should show the count do not: `sdd-report` has no dead-code section (`src/garden/sdd-report.ts` has one for clones only), the dashboard's "Dead exports" tile reads a `GRAPH_REPORT.md` section graphify never writes (`parseDeadExports`, `src/dashboard/data.ts:2125`), so it always reads "not reported", and the `/noldor-refactor` report's "Dead Code" section is filled in by hand.

## Goals

- A consumer that installs knip gets the same set ratchet noldor uses on itself, on pre-push, with no other setup than recording a baseline.
- A consumer that has not installed knip sees nothing change: no red push, no new prompt.
- `sdd-report` and the dashboard show the dead-code count wherever knip is installed.

## Non-goals

- Shipping a knip config. Each consumer owns its own (`knip.json` / `knip.ts`); entry points are repo-specific and noldor cannot guess them, and a wrong starter would get its false positives baselined.
- Installing knip for the consumer, or a doctor row nagging them to.
- Changing the key format or the counted issue types (`DEAD_CODE_ALGORITHM_VERSION` stays 1).
- The `/noldor-refactor` skill edit — it ships as a follow-up micro-chore PR; see "Refactor report" below.

## Design

### Structural context

`src/checks/dead-code.ts` sits alone in community c84 with its test; its only cross-community edges are to `cli-entry.ts` (c42, `runIfDirect`) and `state-file.ts` (c51, `readCheckedState` / `writeJsonState`). It is interior: no god node, no bridge. `src/garden/sdd-report.ts` lives in c10 and already reaches into c5 (`dashboard/data.ts`), c74 (`consumer-config.ts`) and c88 (`doc-roots.ts`); adding an import of `checks/dead-code.ts` gives it one more outbound edge, to c84. `src/dashboard/data.ts` is in c5, whose cross-community edges are all to `server.ts` (c28). `templates/lefthook/noldor.yml` is not in the graph (not a code file).

UI verdict: skip — the repo configures no `consumer.uiPaths`, and this change touches no rendered surface beyond one tile's data source.
Architecture verdict: skip — no new directory, package or runnable unit; two new imports between existing modules, which the ship-time `checks arch-baseline` will see.

### Opt-in: `deadCode.enabled`

A new `deadCode:` block in `.noldor/config.json`, added to `noldorConfigSchema` (`src/core/config.ts:272`) beside `clones:` and degrading to unset on malformed input the same way (`.optional().catch(undefined)`). It holds one field today, `enabled: boolean`. Unset or `false` means the repo has not opted in: `dead-code check` prints one line saying the check is off and how to turn it on, and exits 0 without spawning knip. `true` means the full ratchet exactly as it runs in noldor now — knip missing, a baseline absent, unreadable or drifted are all exit 3, a new finding is exit 1. A repo that turned the check on asked for it to bite, so there is no half-strict mode in between.

`report` and `baseline` ignore the knob: they are run by hand, and a maintainer setting up the ratchet needs them to work before flipping `enabled`. Noldor's own `.noldor/config.json` sets `deadCode.enabled: true`, so its root `lefthook.yml` step and `pnpm verify` stay strict with no call-site change. One knob is readable by `sdd-report` and the dashboard too, so all three surfaces agree on whether a repo uses the ratchet ([ADR 0011](../../adr/0011-opt-in-consumer-checks-use-a-config-switch.md)). A knip version bump is drift too: the push stays red until `pnpm noldor dead-code baseline` re-records, whose ADDED / dropped diff shows what the new knip changed.

### Consumer hook

`templates/lefthook/noldor.yml` gains a `noldor-dead-code` pre-push step running `pnpm noldor dead-code check`, beside `noldor-clones`. `noldor init --update` already rewrites that block. In a repo that has not set `deadCode.enabled` the step prints its off line and passes.

### Upgrade migration

A new migration `src/migrations/1.16.0.ts`, registered in `MIGRATIONS` (`src/migrations/registry.ts`), adds `"deadCode": { "enabled": false }` to the consumer's `.noldor/config.json` when the file has no `deadCode` key, and leaves an existing block untouched. Its `description` — which `noldor upgrade` prints as the step's heading (`src/cli/commands/upgrade.ts:112`) — names the opt-in: install knip, write a knip config, run `pnpm noldor dead-code baseline`, set `enabled: true`. The migration never turns the check on and never runs knip, so an upgrade cannot redden a push. `to` is `1.16.0` on the assumption that this ships in the next minor; the release sweep renames it if the version lands elsewhere. The rewrite parses the file to decide, then appends the key as the last top-level entry with the file's detected indentation, so the consumer's key order and formatting survive and the dry-run diff is one added block.

### `sdd-report` section

`sdd-report` gets a `## Dead code` section after `## Code clones`, built the same way the clones section is (`renderReportMd`, `src/garden/sdd-report.ts:951`): the total, a count per issue type, and the number outside the baseline when one exists. It runs knip through the existing `measure` path (exported, minus its stderr write) and omits the section when `deadCode.enabled` is not `true` or knip cannot run — never failing the report. knip took about 2.4 s on this repo.

### Dashboard tile

`parseDeadExports` is removed: the snapshot's `deadExportCount` (renamed `deadCodeCount`) comes from `.noldor/dead-code-baseline.json` — the length of its `issues` array, every finding type — rather than from a `GRAPH_REPORT.md` section that never exists. The tile in `src/dashboard/views.ts:1837` is relabelled "Dead code" to match the ratchet it reports on. Reading the recorded baseline keeps knip out of the request path; the caption names the baseline's `recordedAt`, since the number lags until someone re-records. The tile shows a number only when `deadCode.enabled` is `true` and the baseline reads cleanly; otherwise it shows "—" and the caption says the check is off.

### Refactor report

The `/noldor-refactor` skill's "Dead Code" section should say: when knip is installed, run `pnpm noldor dead-code check` after the refactor and list what it reports outside the baseline. That is a `.claude/skills/**` edit plus its `templates/` twin, which `checks shared-files` refuses from a worktree, so it ships as its own micro-chore PR after this one merges.

### Docs

The manifest description (`src/cli/manifest.ts:562`) and both `script-catalog.md` copies drop "this repo only" and name the knob. A short "Dead code (opt-in)" note goes into the consumer-facing docs: install knip, write a knip config, run `pnpm noldor dead-code baseline`, commit the baseline, set `deadCode.enabled: true`.

## Acceptance criteria

- With `deadCode.enabled` unset or `false`, `dead-code check` exits 0 without running knip.
- With `deadCode.enabled: true`, `dead-code check` behaves exactly as today in every row of the exit table.
- `dead-code report` and `dead-code baseline` run regardless of the knob.
- A malformed `deadCode:` block reads as unset; it never makes `loadConfig` throw.
- Noldor's own `.noldor/config.json` sets `deadCode.enabled: true`.
- The consumer lefthook template runs `dead-code check` on pre-push.
- `sdd-report` writes a `## Dead code` section with per-type counts when the knob is on and knip runs, and omits it (still exit 0) otherwise.
- The dashboard's "Dead code" tile shows the baseline's finding count when `deadCode.enabled` is `true` and the baseline reads, and "—" otherwise.
- `noldor upgrade` across 1.16.0 adds `deadCode.enabled: false` to a config that lacks the key, leaves an existing `deadCode` block untouched, and a second run changes nothing.
- The script catalog and manifest no longer say "this repo only".

## Risks / trade-offs

- A consumer's first knip run may report hundreds of findings; the baseline absorbs them, so the ratchet only stops new ones. That is the intent, but the first `sdd-report` count may alarm.
- The dashboard number is the recorded baseline, not a live run — it lags until someone re-records.
- `sdd-report` now spawns knip (seconds on a large repo) where knip is installed.

## User Story

As a consumer maintainer (human or agent) who has installed knip, I want my pushes to fail when a change leaves new dead code behind, and to see the dead-code count in the SDD report and the dashboard, so that my codebase stops collecting unused files, exports and dependencies without any setup beyond recording a baseline.

## Usage

- Install knip and write a knip config for your repo.
- After `pnpm noldor upgrade`, `.noldor/config.json` carries `"deadCode": { "enabled": false }`.
- `pnpm noldor dead-code baseline` — record today's findings; commit `.noldor/dead-code-baseline.json`.
- Set `"deadCode": { "enabled": true }` in `.noldor/config.json`.
- From then on the pre-push hook's `pnpm noldor dead-code check` fails the push on a new finding. A repo that never sets the knob sees the step pass with a one-line note.
- `pnpm noldor garden sdd-report` includes a `## Dead code` section; the dashboard's graph-health panel shows the recorded dead-code count.

## Open questions (resolved)

1. _Opt-in by flag at the call site, or by a `.noldor/config.json` knob?_ -> Knob (`deadCode.enabled`). One place declares it, and `sdd-report` and the dashboard read the same answer the hook does. (D1)
2. _With the knob on, is a drifted baseline (knip upgraded) exit 3 or a warning?_ -> Exit 3. A drifted baseline is a broken ratchet the consumer owns; a warning would leave it unguarded with nobody noticing. (D2)
3. _Ship a starter knip config from `noldor init`?_ -> No. Entry points are repo-specific; a wrong starter produces hundreds of false positives that end up baselined. (D3)
4. _Dashboard tile counts exports only, or every finding?_ -> Every finding, with the tile relabelled "Dead code" — it reports on the same set the push check guards. (D4)
5. _Where does the `/noldor-refactor` "Dead Code" wiring ship?_ -> A follow-up micro-chore PR after this one merges. `checks shared-files` refuses `.claude/skills/**` from a worktree. (D5)
6. _Should `noldor upgrade` turn the check on when knip is already installed?_ -> No. It writes `deadCode.enabled: false` and names the opt-in steps; turning it on runs knip and bakes an unchecked knip config into the baseline. (D6)
