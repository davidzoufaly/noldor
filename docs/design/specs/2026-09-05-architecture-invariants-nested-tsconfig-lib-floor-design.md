# Nested tsconfig lib floor — Design

**Slug:** architecture-invariants-nested-tsconfig-lib-floor
**FD:** docs/features/architecture-invariants.md
**Date:** 2026-09-05
**Tier:** specs-only
**Deps:** none

## Problem

The `toolchain-floor` invariant reads exactly two files. `TSCONFIG_CANDIDATES` in [`src/invariants/toolchain-floor.ts`](../../../src/invariants/toolchain-floor.ts) is `['tsconfig.base.json', 'tsconfig.json']`, and `collectFloorViolations` loops over that pair alone. Any other tsconfig in the repo is invisible to the floor, so a nested config that declares a `lib` below the floor passes unseen.

This was found live in this repo. `src/dashboard/static/tsconfig.json` sat at `lib: ["ES2023", "DOM"]` while the enforced `platform-over-dependency` and `deterministic-cleanup` rules both bind `**/*.ts` — which covers the `drag.ts` and `agents.ts` that config includes — and mandate `Set.prototype.union` and `Symbol.dispose` by name. Both are a TS2550 "change the lib option" error under that `lib`. Two *enforced* rules were directing agents to write code a real config in the same repo rejects, and no gate said a word. (That file has since been repaired by hand to extend the base and declare no `lib` of its own; the invariant gap it exposed is what this spec closes.)

The existing `lib-inherited` guard cannot cover this class. It fires only when *no* root candidate declares a `lib`, and here the root config does declare a compliant one — so it stays quiet by design, and it is a repo-wide verdict rather than a per-file one.

The load-bearing TypeScript fact is that `lib` **replaces** rather than merges across `extends`. Putting a compliant `lib` in a base config therefore protects only those children that omit `lib` entirely. A child that declares its own `lib` overrides the base completely, which is exactly the shape that slipped through.

## Goals

- The floor grades every tsconfig in the repo that declares a `lib`, not only the two root candidates.
- A nested tsconfig whose declared `lib` sits below the floor produces an `error`-severity violation naming that file.
- A nested tsconfig that declares no `lib` stays silent. **The guarantee is over declared `lib`s only** — see the false negatives named in Risks; this design does not claim to grade every effective `lib`.
- Existing root-candidate behaviour is unchanged: the strictness anchor, `tsconfig-invalid`, `tsconfig-absent` and `lib-inherited` keep their current semantics and severities.
- No new dependency. The floor exists partly to make `platform-over-dependency` enforceable, so it must not reach for a JSONC or glob package to do its own job.

## Non-goals

- **Resolving the `extends` graph to compute an effective `lib`.** A genuine coverage limit, accepted rather than dismissed. In the common repo shape a config either declares a `lib` (graded directly) or extends an in-repo ancestor this same walk also grades, so the walk covers what a resolver would. It does **not** cover a config whose effective `lib` comes from outside that set — the false negatives are named in Risks. Closing them needs `extends` resolution *plus* a `target`-to-default-lib table, which is a second and considerably larger design.
- Grading anything but `lib` per nested file. The two strictness flags stay anchored to one root config; they are consumer-owned migrations and reporting them once per nested config would be noise, not signal.
- Changing the floor's thresholds (`ES_BUILTINS_FLOOR_YEAR`, the disposable-lib requirement) or the waiver mechanism. Waivers stay id-keyed; a path-keyed waiver is a separate design.
- Extracting the shared tsconfig-reading helpers into a neutral module. Filed as its own roadmap entry — see Risks.
- Teaching the floor about deployment runtimes. Unchanged from today: `lib` proves the compiler knows an API, not that the target implements it.

## Design

### Structural context

Read from `pnpm noldor design graph-context` over the invariant's own files, against a graph regenerated in this worktree (`/graphify --ast-only` + `pnpm toon`, status `fresh`).

`src/invariants/toolchain-floor.ts` sits in community **c62**, alongside only its own test file — an interior module, no god node, low fan-in. Its cross-community edges are the interesting part: it imports `loadConsumerConfig()` from **c80** (the waiver read), and **`src/indirection/detect.ts` [c73] imports `stripJsonc` from it**, calling into `readTsconfig()` in that same community. So the tsconfig-reading responsibility is already split across two communities, with the dependency running invariants → indirection.

`src/invariants/index.ts` and `types.ts` are in **c56**, owned by `architecture-invariants` (3 files), and `check-invariants.ts` is a thin edge module in **c113** reached from `cli-entry.ts`. `garden-detect.ts` in **c30** defines `detectAll()` — a god node at rank #4 with 32 edges — and consumes the invariant registry, so it is the one place where a change to violation volume is felt indirectly.

The finding that shapes the design: `detect.ts` already contains `findTsconfigFiles`, `readTsconfig` and `resolveExtends`, and already depends on this module. Importing them back would close a cycle between c62 and c73.

### Unit 1 — one walk, two harvests

`findPackageManifests` in `toolchain-floor.ts` already walks the repo to `WORKSPACE_SCAN_DEPTH` (4), skipping `SKIPPED_DIRS`, and returns a `ManifestScan { manifests, unreadableDirs }`. It is generalised to harvest `tsconfig*.json` alongside `package.json` in the same pass and return a `RepoScan { manifests, tsconfigs, unreadableDirs }`. One walk rather than two: the traversal, the skip set and the depth bound are identical, and the walk runs on every pre-commit.

The filename match is `startsWith('tsconfig')` + `endsWith('.json')`, matching what `detect.ts` already does for the alias scan — a package whose type surface lives in `tsconfig.app.json` is discovered rather than silently skipped.

Fixture configs are excluded **by name, not by arithmetic**. A new `FIXTURE_DIRS` constant — `__tests__`, `__fixtures__`, `fixtures`, `test`, `tests`, `e2e` — names the directories whose tsconfigs are test data rather than a repo's type surface. Today `src/indirection/__tests__/trees/**` (roughly twenty deliberately-shaped fixture configs) happens to sit at depth 5 and so falls outside `WORKSPACE_SCAN_DEPTH` anyway, but that is an accident of arithmetic rather than an expressed rule: a fixture placed one level shallower, or any change to the depth constant, would red the repo's own pre-commit on test data. Naming the set states the intent, survives both, and covers the sibling names consumers use just as often.

**The exclusion suppresses harvesting, it does not stop the walk.** This is one traversal with one queue, so "descend for `package.json` but not for tsconfigs" is not expressible as a skip. Instead each queue entry carries an `inFixtures` flag, set when the directory's own name is in `FIXTURE_DIRS` and inherited by every descendant. The walk proceeds exactly as it does today; a directory whose flag is set contributes no tsconfig to `RepoScan.tsconfigs` while still contributing its `package.json` to `RepoScan.manifests`. `SKIPPED_DIRS` is untouched, so the manifest half — which answers a different question, whether `react` is declared anywhere — behaves precisely as it does now.

The existing depth bound is otherwise kept rather than raised. At depth 4 the walk already reaches `src/dashboard/static/tsconfig.json`, the live case that motivated this work.

### Unit 2 — grade every declared lib

`collectFloorViolations` keeps its root-candidate loop exactly as it is: first parseable candidate is the strictness anchor, `tsconfig-invalid` on a broken one, `sawDeclaredLib` drives `lib-inherited`, `tsconfig-absent` when neither exists. After that loop, it grades every *non-root* tsconfig the scan found by calling the existing `libFloorChecks(path, cfg)`.

No new grading logic is written. `libFloorChecks` is already per-file and already returns `[]` for a config that declares no `lib`, which is precisely the "inherits, nothing to say" semantics a nested config needs. It emits **three** floor ids — `disposable-lib` and `lib-es-builtins` for a declared-but-insufficient `lib`, and `lib-malformed` for a `lib` that is a string or holds a non-string entry ([`src/invariants/toolchain-floor.ts`](../../../src/invariants/toolchain-floor.ts), `libFloorChecks`). All three are `error`, and all three carry over to nested configs unchanged. Waivers are id-keyed rather than path-keyed, so an existing waiver covers root and nested alike.

A nested config found by the scan is skipped when its path equals a root candidate already graded, so the root files are never double-reported.

### Unit 3 — a nested config that cannot be read

A nested tsconfig that is present but unparseable is reported as `tsconfig-invalid` at **`error`**, identical to the root-candidate case. The repo's documented floor policy is that a config which *exists* but cannot be read blocks — reporting a broken blocking config as advisory is what made this floor bypassable once already — and a nested exception would contradict it.

A weaker `warn` was considered and dropped. It was internally inconsistent: `libFloorChecks` already emits `lib-malformed` at `error`, so a nested config with `"lib": "ESNext"` hard-blocked whether or not `tsconfig-invalid` warned. It also rested on a blast radius that no longer exists — the fixture trees and deliberately-malformed configs it worried about are now excluded by `FIXTURE_DIRS`, before any read is attempted.

### Unit 4 — reporting

Messages already carry their own `path` (every `libFloorChecks` message is prefixed with it), so a nested finding names the file it came from with no format change. `garden-detect` picks these up as advisory `invariantViolations` with no change on its side.

## Acceptance criteria

1. A repo with a compliant root `lib` and a nested `tsconfig.json` declaring `lib: ["ES2023", "DOM"]` produces `lib-es-builtins` and `disposable-lib` violations at `error`, both naming the nested path. (Deletion test: reverting the walk makes this pass silently.)
2. A nested tsconfig that declares no `compilerOptions.lib` produces no violation.
3. A nested tsconfig declaring an umbrella `lib` (`["ESNext"]`) produces no violation.
4. Root-candidate behaviour is unchanged: existing `toolchain-floor` tests pass untouched.
5. `lib-inherited` still fires only when no *root* candidate declares a `lib`, and a compliant nested config does not suppress it.
6. A waiver for `lib-es-builtins` in `.noldor/config.json` downgrades a nested finding to `warn` with its reason attached, exactly as it does a root one.
7. A nested tsconfig that is present but unparseable produces `tsconfig-invalid` at `error` naming that file, and does not abort the invariant.
8. A nested tsconfig with `"lib": "ESNext"` (a string, not an array) produces `lib-malformed` at `error` naming that file.
9. Neither root candidate is reported twice when it is also reached by the walk.
10. The walk finds `tsconfig.app.json`-style names, not only `tsconfig.json`.
11. A tsconfig under any `FIXTURE_DIRS` name yields no finding even when it declares a below-floor `lib`, while a `package.json` in that same directory still reaches the manifest scan.
12. Directories under `SKIPPED_DIRS` (`node_modules`, `dist`, `.worktrees`, …) yield no tsconfig findings.
13. `pnpm noldor checks invariants` on this repo stays green, and no new runtime dependency is added to `package.json`.

## Risks / trade-offs

- **Known false negatives: an effective `lib` this walk never sees.** The floor grades *declared* `lib`s in *discovered* files. Three shapes escape it, all silently, and none is closed here:
  - `"extends": "@tsconfig/strictest/tsconfig.json"` and any other preset resolving into `node_modules`, which is in `SKIPPED_DIRS`. The nested package gets the preset's `lib`, not the compliant root one.
  - An in-repo base whose filename does not match `tsconfig*.json` (`base.json`, `compiler-options.json`). Discovery never finds it, so the `lib` it declares is never graded.
  - A config declaring no `lib` and no in-repo `extends`, whose effective library set comes from `target`'s default. `lib-inherited` catches this only at the root, and only when *no* root candidate declares a `lib`.

  Each needs the `extends` resolution and `target` table this design rules out. The honest framing is that the change closes the declared-nested-`lib` hole — the one found live — and narrows nothing else.
- **`FIXTURE_DIRS` is a real false-negative edge of its own.** A consumer whose genuine package config sits under a directory named `test`, `tests` or `e2e` goes ungraded. That is accepted: grading fixture trees reds a repo's own pre-commit on files that exist precisely to be malformed, and a shipped package rooted in one of those names is far rarer than a fixture tree in one. The set is a constant, so a consumer that hits the edge can see why.
- **Violation volume in a large consumer.** A monorepo with twenty packages each declaring a below-floor `lib` now gets twenty `error`s where it previously got zero. That is the correct report, but it lands as a wall on first upgrade. Waivers are id-keyed, so a single waiver silences the whole class — over-broad, but the alternative is a path-keyed waiver format this change does not introduce.
- **Reuse forgone, deliberately.** `detect.ts` already has a tested `findTsconfigFiles`/`readTsconfig` pair, and this change duplicates the discovery rather than importing it: `detect.ts` already imports `stripJsonc` from `toolchain-floor.ts`, so the import back would close a module cycle. The two walks are also not a clean lift — async `readdir` with a depth bound here, sync `readdirSync` over configured scan roots there — so a shared helper is a design, not a move. The extraction is filed as its own roadmap entry. Nearby risk: `pnpm noldor clones check` runs at pre-push and has flagged a duplicated walker in `detect.ts` before, so this duplication may need a recorded baseline move.
- **Per-commit cost.** The walk is already being paid for the manifest scan; harvesting a second filename in the same pass adds one `readFile` per discovered tsconfig. On this repo that is a handful of files.
- **Configs that govern nothing are still graded.** A `tsconfig.eslint.json` declaring a below-floor `lib` over no real sources reports as a violation. Conservative by choice: deciding which configs are "live" would mean resolving `include`/`references`, which is the graph walk this design rules out.

## User Story

- As an agent writing code under an enforced platform rule, I want a nested tsconfig whose `lib` is below the floor to be rejected at commit time, so that I am never directed to write APIs the repo's own compiler rejects.
- As a maintainer, I want the floor to report which file failed rather than a repo-wide verdict, so that I can fix the config that is actually wrong.

## Usage

No new command. The check runs where it already runs:

```bash
pnpm noldor checks invariants     # blocking — nested lib findings are error-severity
pnpm noldor garden detect         # advisory — same findings as invariantViolations
```

A repo that genuinely declines the floor for a nested config waives by id, as today:

```jsonc
{
  "consumer": {
    "toolchainFloor": {
      "waivers": [{ "id": "lib-es-builtins", "reason": "deploy target predates es2025" }]
    }
  }
}
```

## Open questions (resolved)

1. _Walk every tsconfig, or resolve the `extends` graph to compute each config's effective `lib`?_ -> **Walk and grade each declared `lib`, and state the coverage limit.** (D1) Because `lib` replaces rather than merges, a config either declares one (graded directly) or inherits one — and in the common shape that ancestor is in-repo and graded by the same walk. Where it is not (a `node_modules` preset, a base named `base.json`, or a bare `target` default) the config escapes, which Risks names as a known false negative rather than papering over. Closing those needs the resolver plus a `target` table; this change takes the hole it can close cheaply.
2. _Should the discovery helpers be extracted into a neutral module shared with `src/indirection/detect.ts`?_ -> **Not in this change.** (D2) `detect.ts` already imports `stripJsonc` from `toolchain-floor.ts`, so importing discovery back would close a module cycle; the honest fix is a neutral third module, which is a refactor with its own blast radius and belongs in its own entry.
3. _What severity for an unparseable nested tsconfig?_ -> **`error`, same as the root case.** (D3) The documented floor policy is that a config which exists but cannot be read blocks, and a `warn` here would also have been inconsistent with `lib-malformed`, which already errors on a malformed `lib` in the same file. The blast-radius argument for a softer severity is answered by `FIXTURE_DIRS` instead, which excludes deliberately-malformed test data before any read.
4. _Should fixture trees be excluded by name rather than left to the depth bound, and which names?_ -> **Yes — a `FIXTURE_DIRS` set: `__tests__`, `__fixtures__`, `fixtures`, `test`, `tests`, `e2e`.** (D4) The depth bound excludes them only by arithmetic, so a fixture one level shallower would red the repo's own pre-commit on test data; and `__tests__` alone is an arbitrary cut of a set whose siblings consumers use just as often. It suppresses tsconfig harvesting only — the walk still descends and the manifest scan is unchanged.
5. _Should the two strictness flags also be asserted per nested config?_ -> **No.** (D5) They are `warn`-severity migrations on a consumer-owned tree, and repeating them per config turns a single visible ratchet into per-file noise without changing what anyone does.
6. _Does `WORKSPACE_SCAN_DEPTH` need raising to reach deeper package configs?_ -> **No.** (D6) Depth 4 already reaches the scoped-package layout the constant was tuned for, and raising it broadens the walk for every consumer without a case asking for it.
7. _What severity for a nested below-floor `lib`?_ -> **`error`, identical to the root case.** (D7) The defect being closed is that nothing blocked; widening a `lib` only adds declarations and cannot break code, and the id-keyed waiver is already the escape hatch.
8. _Does the nested exception need a `docs/noldor/rules.md` update (and its `templates/` twin)?_ -> **No.** (D8) Once D3 resolved to `error`, there is no exception left to document — nested configs now follow the floor policy the rules doc already states. The one addition worth making at implementation time is naming that the floor grades every discovered tsconfig rather than the two root candidates, which is a factual correction to the existing section rather than a new rule.
