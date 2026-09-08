# Main-Module Guard Fails on Percent-Encoded Paths — Design

**Slug:** main-module-guard-fails-on-percent-encoded-paths
**FD:** docs/features/main-module-guard-fails-on-percent-encoded-paths.md
**Date:** 2026-09-08
**Tier:** specs-only
**Deps:** none

## Problem

35 modules under `src/` decide whether to run their CLI body by comparing `import.meta.url` against a hand-built string: `` import.meta.url === `file://${process.argv[1]}` ``. `import.meta.url` is a percent-encoded URL; `process.argv[1]` is a raw filesystem path. The two agree only while the path needs no encoding — one space in a directory name is enough to make the comparison permanently false, at which point the module is imported, runs nothing, and exits 0 with no diagnostic.

The blast radius is not cosmetic, because the CLI router makes these guards live. `src/cli/index.ts:36` rewrites `process.argv = [argv0, modPath, ...args]` and then dynamically imports `modPath`, so the dispatched module's guard is what decides whether its body executes. Every `pnpm noldor <command>` routed this way depends on the comparison being true. Eight of the 35 sites are `src/hooks/` entrypoints — `noldor-pre-commit.ts`, `noldor-validate-trailer.ts`, `noldor-inject-trailers.ts`, `noldor-enforce-review-receipt.ts`, `noldor-enforce-arbitration.ts`, `noldor-pre-edit-guard.ts`, `noldor-open-artifact.ts`, `agent-rules-guard.ts` — so on a checkout at a path like `~/code/my repo/`, the framework's commit and push gates report success precisely when they checked nothing. Six more are validators outside `src/hooks/` (`validate-noldor.ts`, `validate-noldor-scope.ts`, `validate-skill-catalog.ts`, `validate-triage.ts`, `validate-script-catalog.ts`, `validate-milestones.ts`), with the same silent-pass shape.

Two facts about the defect matter for the fix and are not in the roadmap entry. First, the repo already grew a canonical answer: `src/core/cli-entry.ts` exports `invokedDirectly(stem, argv1)` and `runIfDirect(stem, label, main)`, and roughly twenty modules have migrated to them; the file's own doc comment says "around fifty modules still inline the block … and can migrate as they are next edited." Second, that existing helper is not a drop-in for all 35, because it matches on **basename** via `` new RegExp(`[\\\\/]${stem}\\.(ts|js|mjs)$`) ``: `src/release/index.ts` is one of six `index.ts` files under `src/` and `src/cr/codex.ts` is one of four `codex.ts` files, so `invokedDirectly('index')` and `invokedDirectly('codex')` cannot distinguish them from their namesakes. A path-qualified stem would fix that on POSIX and break the Windows separator case the existing test at `src/core/__tests__/cli-entry.test.ts:10` pins.

The class also regrows. The entry measured 35 sites on 2026-08-14; there are still exactly 35 today, but the set has changed — `src/design/context-cli.ts` and `src/design/log-cli.ts` migrated away to `runIfDirect`, while `src/hooks/noldor-enforce-arbitration.ts` and `src/hooks/noldor-open-artifact.ts` were added carrying the broken template. A sweep with no enforcement buys a clean tree that refills.

## Goals

- No module under `src/` except `src/core/cli-entry.ts` compares `import.meta.url` to anything at all — not the broken `file://` template, not a `'file://' +` concatenation, not a hand-rolled variant. Every guard goes through a helper.
- A checkout whose absolute path contains a space (or any other character `pathToFileURL` percent-encodes) runs every swept entrypoint's body exactly as an unencoded path does.
- One choke point owns the comparison, so the behaviour is unit-testable once instead of re-derived 35 times.
- A newly added entrypoint that compares `import.meta.url` outside a helper is refused mechanically — a non-zero exit, not an advisory line — rather than by review attention.
- The two off-template sites normalise to the same call as the other 33, so there is one shape to read and one to enforce.

## Non-goals

- Migrating the 35 sites' **tails** to `runIfDirect`. The tails are not uniform (`src/rules/cli-list.ts:12` is a bare `if (…) main();`, `src/core/rename-plan-only-tier.ts:109` catches and calls `exit(1)`, `src/milestones/validate-milestones.ts:61` assigns `const isMain` and branches on it later), and `runIfDirect` imposes a `Promise<number>` contract plus `process.exit(code)`. Changing exit semantics at 35 sites is a different feature with a different risk profile.
- Re-pointing the ~20 modules that already call `invokedDirectly` / `runIfDirect`. None of their stems currently collides with another `src/` module, so none is broken today. The basename hazard is recorded here and left for whoever adds a colliding stem.
- Anything about `bin/noldor.mjs`, `bin/boot.mjs`, or runtime selection. They already use `pathToFileURL` correctly.
- Fixing relative-`argv[1]` invocation as a separate concern. It falls out of the fix for free (`pathToFileURL` resolves against cwd) and is asserted, not designed for.

## Design

### Structural context

`noldor:cut` — `graphify-out/graph.json` is 2 days and 7 `src` commits stale (last regenerated at `e081d6a`, 2026-09-06), and `graphify-out/**` is tracked, so regenerating it here would put five unrelated generated files in this feature's diff. What would change the answer: a graph regenerated on this branch, whose per-path digest would say whether `src/core/cli-entry.ts` is already a god node and which communities the eight `src/hooks/` sites bridge.

What is known without the graph, by direct measurement: `src/core/cli-entry.ts` has 22 importers under `src/` today and this change adds 35 more, taking it to 57 and making it the highest fan-in module in `src/core/`. That is the intended shape — it is what "one choke point" means — but it is a real centralisation and the invariant in Unit 5 is what keeps it honest rather than merely popular. The 35 sites themselves are leaves: each is a CLI tail at the bottom of its own module, imported by the router and by nothing else, which is why a 35-file sweep carries far less coupling risk than the file count suggests.

### Unit 1 — the isEntrypoint predicate in core/cli-entry

Add one exported predicate beside the existing pair. `src/core/cli-entry.ts` currently has no import statements at all, so this also introduces its first:

```ts
import { pathToFileURL } from 'node:url';

export function isEntrypoint(
  moduleUrl: string,
  argv1: string | undefined = process.argv[1],
): boolean {
  return moduleUrl === pathToFileURL(argv1 ?? '').href;
}
```

Path-exact rather than basename-matched, so it has no namesake hazard; percent-encoding-immune, because both sides are now produced by the same encoder; and relative-path-immune, because `pathToFileURL` resolves against `process.cwd()`. `pathToFileURL('')` returns the cwd URL rather than throwing, so the `?? ''` fallback yields `false` for an absent `process.argv[1]` instead of a crash — the same shape `src/hooks/noldor-pre-push.ts:183` already relies on.

The injectable `argv1` parameter is what makes the predicate testable at all; it mirrors `invokedDirectly`'s signature so the two read as siblings. Its contract needs stating, because a default parameter makes two cases look like one: **passing `undefined` explicitly means "use `process.argv[1]`"**, exactly as omitting the argument does — that is what a TypeScript default parameter does, and `invokedDirectly` already behaves this way. The `?? ''` therefore guards only the case where `process.argv[1]` is *itself* absent (a `node -e` or `node --input-type=module -e` process), which no call-site argument can simulate. A test that wants the no-entrypoint branch passes `''`, not `undefined`; passing `undefined` under a test runner compares against the runner's own path and asserts nothing.

Unlike `invokedDirectly`, this does **not** match a compiled `.js` against a `.ts` source path — it does not need to. `import.meta.url` and the router's `modPath` are both derived from the same runtime tree (`src/cli/index.ts:27` `runtimeRelative` picks the extension the live runtime emits), so under `dist` both sides are `.js` and under source both are `.ts`.

### Unit 2 — sweep the 33 on-template sites

For each site, replace the condition and leave the tail byte-identical:

```ts
-if (import.meta.url === `file://${process.argv[1]}`) {
+if (isEntrypoint(import.meta.url)) {
```

plus `import { isEntrypoint } from '<relative>/core/cli-entry.js';` in the import block. The three `src/rules/cli-*.ts` sites are the single-statement form (`if (…) main();`) and take the same substitution.

Nothing else in any of the 33 files changes. This is deliberate: a sweep that also tidies tails cannot be reviewed as a mechanical diff, and the review cost of 35 files is dominated by whether every hunk is the same hunk.

### Unit 3 — normalise the two off-template sites

`src/core/rename-plan-only-tier.ts:109` reads `` import.meta.url === `file://${argv[1]}` `` against a destructured `argv`; `src/milestones/validate-milestones.ts:61` assigns `const isMain = …` and branches on `isMain` below. Both become the same `isEntrypoint(import.meta.url)` call — inline in the first, as the initialiser of the retained `isMain` in the second, so its later branch is untouched. They are the same defect with different local style, not a second class.

### Unit 4 — proof under a percent-encoded path

Two tests, at two altitudes, because after Unit 1 the class has a choke point and no longer needs 35 process spawns to cover.

A unit test in `src/core/__tests__/cli-entry.test.ts` tables the predicate in **both** failure directions, since a predicate that gates execution can fail two ways and each is a different defect:

- *false-negative direction* (the live bug — returns `false` when the module **is** the entrypoint, so a gate silently passes): a plain path, a path containing a space, one containing `#`, one containing a non-ASCII character, a relative path, and a Windows-style path.
- *false-positive direction* (returns `true` when the module is **not** the entrypoint, so an imported module runs its CLI body): a sibling module in the same directory, and a namesake in another directory — the `src/release/index.ts` vs `src/cli/index.ts` and `src/cr/codex.ts` vs `src/cr/lanes/codex.ts` cases that rule `invokedDirectly` out for those sites.

An integration test then proves the wiring, not the predicate: copy the repo (or a minimal tree containing the router plus two representative entrypoints, one hook and one validator) into a temp directory whose name contains a space, invoke each through `bin/noldor.mjs`, and assert the body ran by observing its real output. Two entrypoints rather than 35 — the entry's reason for wanting all of them ("every site re-derives it inline") describes the code before Unit 1 and stops holding after it. What the 35 spawns were meant to prove is proved instead by acceptance criterion 1 (no site compares `import.meta.url` outside a helper) plus Unit 5's invariant and the extended parity scan below, which together cover all 35 sites and every site added after this change; and a repo-copy fixture spawning 35 CLI boots would land a heavy filesystem test on a suite already reported as timing-flaky.

**`realpathSync` the fixture root before using it, or the fixture fails for the wrong reason.** Node resolves a module to its realpath, so `import.meta.url` is realpath-based while `process.argv[1]` keeps whatever path the caller typed. On macOS `os.tmpdir()` is `/var/folders/…`, a symlink to `/private/var/folders/…`, so a `mkdtemp`-based spaced-path fixture makes the two sides disagree on the symlink rather than on the percent-encoding under test — a red that looks exactly like the defect and is not it. Resolve the temp root once with `realpathSync` and build every path in the fixture from that.

The cross-extension concern gets a **static** answer, not a `dist` build. `isEntrypoint` deliberately drops the `.ts`/`.js` tolerance `invokedDirectly` has, and the claim that `import.meta.url` and the router's `modPath` always share an extension rests on `runtimeRelative` at `src/cli/index.ts:27`. `src/cli/__tests__/runtime-parity.test.ts` already scans every manifest entrypoint for a guard hardcoding one extension; extend that scan to assert each one's guard goes through `isEntrypoint`. That covers the class for all 35 sites at once, needs no build, and doubles as the runtime check behind Unit 5's coverage claim — where an integration test under `NOLDOR_RUNTIME=dist` could not run at all, since `dist/` is gitignored and build-produced and neither fixture shape has one.

**Deletion test.** Revert Unit 1's `pathToFileURL` to the `` `file://${…}` `` template and the integration test fails on the spaced-path checkout while passing on an unencoded one. Delete Unit 5's invariant and a reintroduced template guard commits clean.

### Unit 5 — a choke-point invariant

Add `src/invariants/entrypoint-guard-choke-point.ts` and register it in both `invariants` and `makeInvariants` in `src/invariants/index.ts`. Take the *file shape* from `src/invariants/slug-path-choke-point.ts` (the sibling feature `unvalidated-slug-path-traversal-across-cli-entry-points` added it for the same class of reason) but **not** its severity: that plugin emits `severity: 'warn'`, which `src/invariants/types.ts` documents as "surfaced but non-blocking; the runner still exits zero". A warning cannot refuse anything, so this plugin emits `severity: 'error'` — the blocking form `src/invariants/toolchain-floor.ts` uses, and the value the runner assumes when `severity` is omitted.

**What it enforces is an allowlist, not a denylist of the one broken template.** It scans `src/**/*.ts` for any comparison whose operand is `import.meta.url` and reports a violation unless the other operand is a call to `isEntrypoint` or `invokedDirectly`. A denylist keyed on the `` `file://${…}` `` template would pass `'file://' + process.argv[1]`, pass a mistyped replacement, and pass whatever fourth spelling someone invents — while this section claims to prove that no site bypasses the helper. The claim and the check have to be the same shape or the claim is false.

Two exemptions are expected and are named in the plugin rather than discovered: `src/core/cli-entry.ts` itself, which contains the sanctioned comparison, and non-guard uses of `import.meta.url` (`fileURLToPath(import.meta.url)` for a directory, `new URL(…, import.meta.url)` for an asset), which are not comparisons and so never match.

This is the unit that makes the sweep durable. The evidence that it is needed is in the drift already observed: two sites migrated away from the template and two new ones arrived carrying it, in three weeks, with the defect already written down in the roadmap.

## Acceptance criteria

1. No file under `src/` except `src/core/cli-entry.ts` compares `import.meta.url` to anything; every direct-invocation guard reads `isEntrypoint(import.meta.url)` or `invokedDirectly(<stem>)`. (`grep -rF 'file://${' src --include='*.ts'` returning nothing is necessary but not sufficient — it misses the concatenation form.)
2. `isEntrypoint` is exported from `src/core/cli-entry.ts` and takes an optional second argument that overrides `process.argv[1]`.
3. `isEntrypoint(url, argv1)` returns `true` for every path that resolves to `url`, including paths containing a space, a `#`, and a non-ASCII character, and for a relative path resolving to it from the cwd.
4. `isEntrypoint(url, argv1)` returns `false` for a same-directory sibling module and for a same-basename module in a different directory.
5. `isEntrypoint(url, '')` returns `false` and does not throw. (`undefined` is not the assertion: it selects the `process.argv[1]` default, so under a test runner it compares against the runner's path and pins nothing — the same latent hole as `src/core/__tests__/cli-entry.test.ts:18`.)
6. All 35 swept sites retain their pre-change tail behaviour: same exit codes, same stdout/stderr, same async handling.
7. `src/milestones/validate-milestones.ts` still exposes its `isMain` local and branches on it unchanged.
8. From a checkout whose absolute `realpathSync`-resolved path contains a space, the representative hook and validator entrypoints execute their bodies and produce their normal output.
9. `src/cli/__tests__/runtime-parity.test.ts` fails when a manifest entrypoint's direct-invocation guard does not go through `isEntrypoint`.
10. A file added under `src/` that compares `import.meta.url` to anything other than an `isEntrypoint` or `invokedDirectly` call causes `pnpm noldor checks invariants` to **exit non-zero**, naming that file and line — including the `'file://' + process.argv[1]` concatenation form, not only the template-literal form.
11. The new invariant is present in both `invariants` and `makeInvariants` in `src/invariants/index.ts`, and its violations carry `severity: 'error'` or omit `severity`.
12. `pnpm typecheck`, the full test suite, and `pnpm noldor checks push-gates` are green.
13. The clone ratchet does not rise: 35 identical one-line conditions calling a shared helper replace 35 identical inline comparisons.

## Risks / trade-offs

**A 35-file diff is reviewed by sampling, not by reading.** The mitigation is that 33 of the hunks are byte-identical and the other two are called out as Unit 3, so a reviewer can verify the shape once and then verify sameness mechanically. The counter-risk — sweeping in smaller batches — leaves the class half-alive across releases and makes the invariant unlandable until the last batch.

**Centralising raises `src/core/cli-entry.ts` fan-in from 22 importers to 57.** A change to `isEntrypoint` then reaches every CLI entrypoint at once. Accepted deliberately: that is the same property that makes the defect fixable once instead of 35 times, and the predicate is four tokens of logic with a two-directional test table pinning both failure directions.

**The integration test's cost and flakiness.** Copying a tree per test run is slow, and a spaced-path temp directory is exactly the kind of fixture that breaks on a shell quoting mistake. Mitigated by keeping it to two entrypoints and by having the unit table carry the real coverage; if the integration test proves unstable it can be reduced to one entrypoint without losing the class guarantee.

**`isEntrypoint` drops the `.ts`/`.js` cross-extension tolerance `invokedDirectly` has.** If some invocation path ever hands the router a `dist` module path while a `src` module is imported, the guard goes false and the body silently does not run — the same failure mode being fixed, from a different cause. The claim that this cannot happen rests on `runtimeRelative` at `src/cli/index.ts:27`; Unit 4 pins it by extending the static scan in `src/cli/__tests__/runtime-parity.test.ts` rather than by building a `dist` inside a temp fixture. Residual risk: a scan over the manifest cannot see an entrypoint reached by some path the manifest does not name.

**A symlinked invocation path defeats the predicate, and this design accepts that.** Node resolves a module to its realpath, so `import.meta.url` is realpath-based while `process.argv[1]` is whatever the caller typed; invoking a module through a symlink makes the two disagree and the guard returns `false` — the same silent-pass shape being fixed. Accepted, because no framework path is exposed: the router derives `SRC_ROOT` from its own `import.meta.url` (already a realpath), builds `modPath` from it, and **rewrites `process.argv[1]` to that `modPath`** before importing, so both sides of every routed comparison come from the same realpath. Only a direct `node <symlinked-src-path>` invocation, which nothing in the framework or its hooks performs, is affected. The alternative — `realpathSync` inside the predicate — buys that edge case for an fs call on every guard evaluation in every process (34 of the 35 guards evaluate to `false` on any given invocation) plus an ENOENT branch, and is not worth it. What this risk does force is Unit 4's `realpathSync` on the fixture root, since `os.tmpdir()` is itself a symlink on macOS.

**A false positive is worse than the bug being fixed.** A guard that wrongly returns `true` makes an imported module run its CLI body and call `process.exit`, which would break the router mid-dispatch. This is why the design refuses the basename approach for the two colliding sites and why the false-positive direction gets its own test rows.

## User Story

As an agent or operator running Noldor from a checkout whose path contains a space, I want every CLI entrypoint, hook, and validator to execute its body, so that a green gate means the gate actually ran instead of meaning it silently did nothing.

## Usage

No new command surface. Existing behaviour becomes correct where it was silently absent:

- `pnpm noldor <any routed command>` from a checkout at a path such as `~/code/my repo/` now runs the dispatched module's body.
- The commit and push hooks (`noldor-pre-commit`, `noldor-validate-trailer`, `noldor-enforce-review-receipt`, `noldor-enforce-arbitration`, `noldor-pre-edit-guard`) enforce rather than pass vacuously on such a checkout.
- `pnpm noldor checks invariants` gains one row that fails when a new entrypoint reintroduces the broken guard.

For new code, the entrypoint tail is `if (isEntrypoint(import.meta.url)) { … }`, imported from `src/core/cli-entry.ts`.

## Open questions (resolved)

1. *Add a new URL-based predicate, or reuse the existing `invokedDirectly`?*
   → **Add `isEntrypoint`.** (D1) `invokedDirectly` matches on basename, and two of the 35 sites (`src/release/index.ts`, `src/cr/codex.ts`) have namesakes under `src/`; a path-qualified stem would fix that on POSIX and break the Windows separator case already pinned at `src/core/__tests__/cli-entry.test.ts:10`.

2. *Sweep the conditions only, or migrate the tails to `runIfDirect` while touching every file anyway?*
   → **Conditions only.** (D2) The tails differ in exit semantics and async shape across the 35; folding that in turns a mechanically verifiable diff into 35 individual judgement calls, and `runIfDirect` would import the basename hazard from D1.

3. *What is the name?*
   → **`isEntrypoint`.** (D3) The `invokedDirectly` / `runIfDirect` pair is stem-based; a URL-based sibling wants a name that does not read as a variant of them, and the predicate answers exactly "is this module the process entrypoint".

4. *Does the regression test need to exercise all 35 entrypoints under a spaced path?*
   → **No — two.** (D4) The entry's reasoning ("a unit test on the comparison helper alone would not have caught the class, since every site re-derives it inline") is true of the code as it stands and false of the code after Unit 1: with one choke point, the class is covered by a unit table on the predicate plus Unit 5 proving no site bypasses it, and the integration test only has to prove the wiring once.

5. *Is the invariant in scope, or a follow-up entry?*
   → **In scope.** (D5) The set of broken sites already churned in both directions in three weeks with the defect written down and unfixed; a sweep without enforcement is a tree that refills, and the invariant is ~40 lines on an established plugin pattern.

6. *Should the FD's `links.code` be populated with the 35 paths up front?*
   → **No.** (D6) Leave it empty and let the implementation's `@fd:` tags feed it, so the link list describes what the change actually touched rather than what this spec predicted.

7. *Does explicit `isEntrypoint(url, undefined)` mean "use `process.argv[1]`" or "no entrypoint"?*
   → **"Use `process.argv[1]`".** (D7) That is what a TypeScript default parameter does and what `invokedDirectly` already does, so the alternative would make two sibling helpers disagree on the same argument. The consequence is that `undefined` cannot express "no entrypoint" from a call site: the `?? ''` fallback exists for a genuinely absent `process.argv[1]`, and the test for the false branch passes `''`.

8. *Should the invariant denylist the broken template, or allowlist the sanctioned helpers?*
   → **Allowlist.** (D8) A denylist keyed on `` `file://${…}` `` passes `'file://' + process.argv[1]`, passes a mistyped replacement, and passes the next spelling someone invents — while the spec claims the invariant proves no site bypasses the helper. The check has to have the same shape as the claim, or the claim is false.

9. *Blocking or advisory severity for the new invariant?*
   → **Blocking (`severity: 'error'`).** (D9) `src/invariants/slug-path-choke-point.ts`, the file this one copies its shape from, emits `severity: 'warn'`, which `src/invariants/types.ts` defines as non-blocking. Inheriting that would make Unit 5 an advisory that refuses nothing, contradicting the goal it exists to serve.

10. *`realpathSync` inside the predicate, or only in the test fixture?*
    → **Only in the fixture; the symlink case is accepted residual risk.** (D10) Every routed invocation is already symlink-safe because the router derives `modPath` from its own realpath-based `import.meta.url` and rewrites `process.argv[1]` to it, so both sides of the comparison share one realpath; only a direct `node <symlinked-src-path>` call is exposed and nothing in the framework makes one. Putting `realpathSync` in the predicate would buy that edge case for an fs call on every guard evaluation in every process, plus an ENOENT branch. The fixture, by contrast, must resolve its root, because `os.tmpdir()` is a symlink on macOS.
