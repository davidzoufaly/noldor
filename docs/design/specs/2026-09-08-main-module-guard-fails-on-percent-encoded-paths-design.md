# Main-Module Guard Fails on Percent-Encoded Paths — Design

**Slug:** main-module-guard-fails-on-percent-encoded-paths
**FD:** docs/features/main-module-guard-fails-on-percent-encoded-paths.md
**Date:** 2026-09-08
**Tier:** specs-only
**Deps:** none

## Problem

35 modules under `src/` decide whether to run their CLI body by comparing `import.meta.url` against a hand-built string: `` import.meta.url === `file://${process.argv[1]}` ``. `import.meta.url` is a percent-encoded URL; `process.argv[1]` is a raw filesystem path. The two agree only while the path needs no encoding — one space in a directory name is enough to make the comparison permanently false, at which point the module is imported, runs nothing, and exits 0 with no diagnostic.

The blast radius is not cosmetic, because the CLI router makes these guards live. `src/cli/index.ts:36` rewrites `process.argv = [argv0, modPath, ...args]` and then dynamically imports `modPath`, so the dispatched module's guard is what decides whether its body executes. Every `pnpm noldor <command>` routed this way depends on the comparison being true. Eight of the 35 sites are `src/hooks/` entrypoints — `noldor-pre-commit.ts`, `noldor-validate-trailer.ts`, `noldor-inject-trailers.ts`, `noldor-enforce-review-receipt.ts`, `noldor-enforce-arbitration.ts`, `noldor-pre-edit-guard.ts`, `noldor-open-artifact.ts`, `agent-rules-guard.ts` — so on a checkout at a path like `~/code/my repo/`, the framework's commit and push gates report success precisely when they checked nothing. Six more are validators outside `src/hooks/` (`validate-noldor.ts`, `validate-noldor-scope.ts`, `validate-skill-catalog.ts`, `validate-triage.ts`, `validate-script-catalog.ts`, `validate-milestones.ts`), with the same silent-pass shape.

Two facts about the defect matter for the fix and are not in the roadmap entry. First, the repo already grew a canonical answer: `src/core/cli-entry.ts` exports `invokedDirectly(stem, argv1)` and `runIfDirect(stem, label, main)`, and 22 modules have migrated to them; the file's own doc comment says "around fifty modules still inline the block … and can migrate as they are next edited." Second, that existing helper is not a drop-in for all 35, because it matches on **basename** via `` new RegExp(`[\\\\/]${stem}\\.(ts|js|mjs)$`) ``: `src/release/index.ts` is one of six `index.ts` files under `src/` and `src/cr/codex.ts` is one of four `codex.ts` files, so `invokedDirectly('index')` and `invokedDirectly('codex')` cannot distinguish them from their namesakes. A path-qualified stem would fix that on POSIX and break the Windows separator case the existing test at `src/core/__tests__/cli-entry.test.ts:10` pins.

Thirty-five sites carry the defect, but they are not all the sites that compare `import.meta.url`: seven more do so correctly, in three further spellings, and Unit 3 sweeps those too — 42 in total — because an invariant with seven exemptions is one whose eighth hole nobody notices.

The class also regrows. The entry measured 35 sites on 2026-08-14; there are still exactly 35 today, but the set has changed — `src/design/context-cli.ts` and `src/design/log-cli.ts` migrated away to `runIfDirect`, while `src/hooks/noldor-enforce-arbitration.ts` and `src/hooks/noldor-open-artifact.ts` were added carrying the broken template. A sweep with no enforcement buys a clean tree that refills.

## Goals

- No module under `src/` compares `import.meta.url` to anything at all — not the broken `file://` template, not a `'file://' +` concatenation, not a `fileURLToPath` path compare, not any hand-rolled variant. Every direct-invocation guard goes through a `cli-entry` helper, and `cli-entry` itself compares a parameter rather than `import.meta.url`, so the rule needs no exception for it.
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

What is known without the graph, by direct measurement: `src/core/cli-entry.ts` has 22 importers under `src/` today and this change adds 42 more, taking it to 64 and making it the highest fan-in module in `src/core/`. That is the intended shape — it is what "one choke point" means — but it is a real centralisation and the invariant in Unit 5 is what keeps it honest rather than merely popular. The 42 sites themselves are leaves: each is a CLI tail at the bottom of its own module, imported by the router and by nothing else, which is why a 42-file sweep carries far less coupling risk than the file count suggests.

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

Nothing else in any of the 33 files changes. This is deliberate: a sweep that also tidies tails cannot be reviewed as a mechanical diff, and the review cost of 42 files is dominated by whether every hunk is the same hunk.

One comment moves with them. `src/cli/index.ts:34` currently documents the old guard by quoting it verbatim — `` `if (import.meta.url === pathToFileURL(process.argv[1]).href)` `` — which is stale once every entrypoint calls `isEntrypoint`, and which Unit 5's scan would otherwise report on a clean tree. Reword it to name `isEntrypoint`. That is a stale comment fixed as part of the change it describes, not an exemption bought to keep a check quiet.

### Unit 3 — normalise the nine remaining comparison sites

`src/core/rename-plan-only-tier.ts:109` reads `` import.meta.url === `file://${argv[1]}` `` against a destructured `argv`; `src/milestones/validate-milestones.ts:61` assigns `const isMain = …` and branches on `isMain` below. Both are the same defect in different local style, not a second class, and both become the same `isEntrypoint(import.meta.url)` call — inline in the first, as the initialiser of the retained `isMain` in the second, so its later branch is untouched.

Seven more sites are **not** broken but still move, because Goal 1 and acceptance criterion 1 say no file compares `import.meta.url` **to anything** — and the invariant in Unit 5, matching comparisons rather than the broken template, would flag every one of them:

- `src/hooks/noldor-pre-push.ts:183` reads `import.meta.url === pathToFileURL(process.argv[1] ?? '').href`. This is the correct comparison and the reason the roadmap entry could name a known-good form at all. Its inline comment explaining the percent-encoding hazard moves to `isEntrypoint`'s doc comment in Unit 1, where it documents the shared choke point instead of one site.
- Six compare **paths rather than URLs**, via `fileURLToPath`, in three spellings: `argv[1] === fileURLToPath(import.meta.url)` (`src/core/bump-session-marker.ts:25`, `src/core/prefix-skills-codemod.ts:91`), `fileURLToPath(import.meta.url) === process.argv[1]` assigned to a local (`src/triage/score.ts:181`, `src/triage/mint-id-cli.ts:56`, `src/triage/backfill-ids-cli.ts:60`), and one with a redundant undefined-check in front (`src/triage/merge-candidates-cli.ts:32`). Building no URL, they were never exposed to the percent-encoding defect — they are a third correct answer, arrived at independently. `isEntrypoint`'s `?? ''` subsumes the sixth site's explicit `process.argv[1] !== undefined` guard.

Leaving these seven as named exemptions was the alternative. Sweeping them is better: seven exempt-because-they-happen-to-be-right sites are a list a reader has to hold, and an invariant with seven holes is one whose next hole nobody notices. Zero exemptions is a rule that can be checked.

That makes **42** comparison sites in total: 33 on-template (Unit 2), two off-template, one already-correct URL comparison, and six already-correct path comparisons. Thirty-five are defective; all 42 move.

### Unit 4 — proof under a percent-encoded path

Two tests, at two altitudes, because after Unit 1 the class has a choke point and no longer needs 35 process spawns to cover.

A unit test in `src/core/__tests__/cli-entry.test.ts` tables the predicate in **both** failure directions, since a predicate that gates execution can fail two ways and each is a different defect:

- *false-negative direction* (the live bug — returns `false` when the module **is** the entrypoint, so a gate silently passes): a plain path, a path containing a space, one containing `#`, one containing a non-ASCII character, a relative path, and a Windows-style path. **Every row states its expected URL as a hardcoded percent-encoded literal** — `isEntrypoint('file:///repo/my%20dir/m.ts', '/repo/my dir/m.ts')`, never `isEntrypoint(pathToFileURL(p).href, p)`. Derive the expectation from the same encoder the implementation uses and both sides move together: every row passes for any encoder, the reverted `` `file://${…}` `` template included, which would leave the unit half of the deletion test below silently green.
- *false-positive direction* (returns `true` when the module is **not** the entrypoint, so an imported module runs its CLI body): a sibling module in the same directory, and a namesake in another directory — the `src/release/index.ts` vs `src/cli/index.ts` and `src/cr/codex.ts` vs `src/cr/lanes/codex.ts` cases that rule `invokedDirectly` out for those sites.

An integration test then proves the wiring, not the predicate: copy the repo (or a minimal tree containing the router plus two representative entrypoints, one hook and one validator) into a temp directory whose name contains a space, invoke each through `bin/noldor.mjs`, and assert the body ran by observing its real output. Two entrypoints rather than 42 — the entry's reason for wanting all of them ("every site re-derives it inline") describes the code before Unit 1 and stops holding after it. What the spawns were meant to prove is proved instead by acceptance criterion 1 (no file compares `import.meta.url`) and by Unit 5's invariant, which covers all 42 sites and every site added after this change; and a repo-copy fixture spawning 42 CLI boots would land a heavy filesystem test on a suite already reported as timing-flaky.

**`realpathSync` the fixture root before using it, or the fixture fails for the wrong reason.** Node resolves a module to its realpath, so `import.meta.url` is realpath-based while `process.argv[1]` keeps whatever path the caller typed. On macOS `os.tmpdir()` is `/var/folders/…`, a symlink to `/private/var/folders/…`, so a `mkdtemp`-based spaced-path fixture makes the two sides disagree on the symlink rather than on the percent-encoding under test — a red that looks exactly like the defect and is not it. Resolve the temp root once with `realpathSync` and build every path in the fixture from that.

**The cross-extension concern gets no test — it is accepted residual risk, and the Risks section carries the reasoning.** No test was found that could earn its place: a `NOLDOR_RUNTIME=dist` integration run cannot happen in a temp fixture (`dist/` is gitignored and build-produced, so neither fixture shape has one), and a static scan asserting every manifest entrypoint guards via `isEntrypoint` would be worse than useless — it contradicts Non-goal 2 by redding the 26 manifest sources that guard through `invokedDirectly`/`runIfDirect`, no-ops on the 59 that carry no guard, and still could not prove what it claims, since a guard's *shape* says nothing about whether `runtimeRelative` paired a `.ts` argv path with a `.js` module.

**Deletion test.** Revert Unit 1's `pathToFileURL` to the `` `file://${…}` `` template and the integration test fails on the spaced-path checkout while passing on an unencoded one. Delete Unit 5's invariant and a reintroduced template guard commits clean.

### Unit 5 — a choke-point invariant

Add `src/invariants/entrypoint-guard-choke-point.ts` and register it in both `invariants` and `makeInvariants` in `src/invariants/index.ts`. Take the *file shape* from `src/invariants/slug-path-choke-point.ts` (the sibling feature `unvalidated-slug-path-traversal-across-cli-entry-points` added it for the same class of reason) but **not** its severity: that plugin emits `severity: 'warn'`, which `src/invariants/types.ts` documents as "surfaced but non-blocking; the runner still exits zero". A warning cannot refuse anything, so this plugin emits `severity: 'error'` — the blocking form `src/invariants/toolchain-floor.ts` uses, and the value the runner assumes when `severity` is omitted.

**It matches the comparison, not the `file://` template.** The rule is one sentence: any comparison whose operand is `import.meta.url`, in a non-exempt file, is a violation. A check keyed on the `` `file://${…}` `` template would pass `'file://' + process.argv[1]`, pass a mistyped replacement, and pass whatever fourth spelling someone invents — while this section claims to prove that no site bypasses the helper. The claim and the check have to be the same shape or the claim is false.

**The operand may be `import.meta.url` itself or a call wrapping it.** `fileURLToPath(import.meta.url) === process.argv[1]` is a comparison and a direct-invocation guard, so a scan keyed on a bare `import.meta.url` operand would let the six sites in Unit 3 through while Goal 1 claims none survive. Match any comparison whose text mentions `import.meta.url`.

There is deliberately **no allowlist of sanctioned right-hand operands.** The sanctioned form is `isEntrypoint(import.meta.url)` — a boolean-returning call containing no comparison at all — so it cannot match a comparison scan and needs no exception; `invokedDirectly` never mentions `import.meta.url`. An "unless the other operand is a helper call" arm would be a branch nothing reaches. Genuine non-guard uses (`dirname(fileURLToPath(import.meta.url))` for a directory, `new URL(…, import.meta.url)` for an asset) are not comparisons and so never match — but note that this is a property of those *expressions*, not of `fileURLToPath`, which appears on both sides of the line.

Exempt files, named in the plugin rather than discovered: `__tests__/` and `*.test.ts`, inheriting the exclusion `src/invariants/slug-path-choke-point.ts` already applies. That is the whole list. **`src/core/cli-entry.ts` is deliberately not exempt:** it contains no `import.meta.url` today (verified — zero occurrences) and after Unit 1 `isEntrypoint` compares `moduleUrl`, a parameter, so a scan for `import.meta.url` comparisons never reaches it. An exemption would be unreachable as written and would bless the one file where a reintroduced raw guard would do the most damage. `src/cli/index.ts` is likewise not exempt: its comment at line 34 spells the old comparison out verbatim and is stale the moment this sweep lands, so Unit 2 rewrites it rather than buying an exception. A prose comment that trips this plugin later is a false positive that fails closed and costs a reword, which is the right way for a blocking check to be wrong.

This is the unit that makes the sweep durable. The evidence that it is needed is in the drift already observed: two sites migrated away from the template and two new ones arrived carrying it, in three weeks, with the defect already written down in the roadmap.

## Acceptance criteria

1. No file under `src/` compares `import.meta.url` to anything; every direct-invocation guard reads `isEntrypoint(import.meta.url)` or `invokedDirectly(<stem>)`. (`grep -rF 'file://${' src --include='*.ts'` returning nothing is necessary but not sufficient — it misses both the `'file://' +` concatenation and the `fileURLToPath(import.meta.url) === process.argv[1]` path-compare forms.)
2. `isEntrypoint` is exported from `src/core/cli-entry.ts` and takes an optional second argument that overrides `process.argv[1]`.
3. `isEntrypoint(url, argv1)` returns `true` for every path that resolves to `url`, including paths containing a space, a `#`, and a non-ASCII character, and for a relative path resolving to it from the cwd.
4. `isEntrypoint(url, argv1)` returns `false` for a same-directory sibling module and for a same-basename module in a different directory.
5. `isEntrypoint(url, '')` returns `false` and does not throw. (`undefined` is not the assertion: it selects the `process.argv[1]` default, so under a test runner it compares against the runner's path and pins nothing — the same latent hole as `src/core/__tests__/cli-entry.test.ts:18`.)
6. All 42 swept sites retain their pre-change tail behaviour: same exit codes, same stdout/stderr, same async handling.
7. `src/milestones/validate-milestones.ts` still exposes its `isMain` local and branches on it unchanged.
8. From a checkout whose absolute `realpathSync`-resolved path contains a space, the representative hook and validator entrypoints execute their bodies and produce their normal output.
9. A file added under `src/` (outside `__tests__/` and `*.test.ts`) that compares `import.meta.url` to anything causes `pnpm noldor checks invariants` to **exit non-zero**, naming that file and line — including the `'file://' + process.argv[1]` concatenation and the `fileURLToPath(import.meta.url) === process.argv[1]` path compare, not only the template-literal form.
10. The new invariant is present in both `invariants` and `makeInvariants` in `src/invariants/index.ts`, and its violations carry `severity: 'error'` or omit `severity`.
11. `pnpm noldor checks invariants` is green on the swept tree — in particular the reworded comment in `src/cli/index.ts` does not trip the new plugin.
12. `pnpm typecheck`, the full test suite, and `pnpm noldor checks push-gates` are green.
13. The clone ratchet does not rise: 42 identical one-line conditions calling a shared helper replace 35 identical inline comparisons plus seven correct-but-inline ones in four spellings.

## Risks / trade-offs

**A 42-file diff is reviewed by sampling, not by reading.** The mitigation is that 33 of the hunks are byte-identical and the other nine are called out individually as Unit 3, so a reviewer can verify the shape once and then verify sameness mechanically. The counter-risk — sweeping in smaller batches — leaves the class half-alive across releases and makes the invariant unlandable until the last batch.

**Centralising raises `src/core/cli-entry.ts` fan-in from 22 importers to 64.** A change to `isEntrypoint` then reaches every CLI entrypoint at once. Accepted deliberately: that is the same property that makes the defect fixable once instead of 42 times, and the predicate is four tokens of logic with a two-directional test table pinning both failure directions.

**The integration test's cost and flakiness.** Copying a tree per test run is slow, and a spaced-path temp directory is exactly the kind of fixture that breaks on a shell quoting mistake. Mitigated by keeping it to two entrypoints and by having the unit table carry the real coverage; if the integration test proves unstable it can be reduced to one entrypoint without losing the class guarantee.

**`isEntrypoint` drops the `.ts`/`.js` cross-extension tolerance `invokedDirectly` has, and this risk is accepted untested.** If some invocation path ever hands the router a `dist` module path while a `src` module is imported, the guard goes false and the body silently does not run — the same failure mode being fixed, from a different cause. The reason it cannot happen through the router is structural: `dispatch` derives `modPath` from `runtimeRelative` (`src/cli/index.ts:27`), assigns it to `process.argv[1]`, and imports that same `modPath`, so both sides of the comparison are one string. What is accepted is that no *test* pins this. A `NOLDOR_RUNTIME=dist` fixture cannot exist (`dist/` is gitignored and build-produced), and a static scan over the manifest would contradict Non-goal 2 while still not proving the pairing — a guard's shape says nothing about which extension `runtimeRelative` chose. The residual exposure is a future change to `dispatch` that stops deriving both from one value; the mitigation is that such a change breaks every routed command at once and cannot ship quietly.

**A symlinked invocation path defeats the predicate, and this design accepts that.** Node resolves a module to its realpath, so `import.meta.url` is realpath-based while `process.argv[1]` is whatever the caller typed; invoking a module through a symlink makes the two disagree and the guard returns `false` — the same silent-pass shape being fixed. Accepted, because no framework path is exposed: the router derives `SRC_ROOT` from its own `import.meta.url` (already a realpath), builds `modPath` from it, and **rewrites `process.argv[1]` to that `modPath`** before importing, so both sides of every routed comparison come from the same realpath. Only a direct `node <symlinked-src-path>` invocation, which nothing in the framework or its hooks performs, is affected. The alternative — `realpathSync` inside the predicate — buys that edge case for an fs call on every guard evaluation in every process (41 of the 42 guards evaluate to `false` on any given invocation) plus an ENOENT branch, and is not worth it. It would also *change* behaviour at the six `fileURLToPath` sites in Unit 3, which compare realpath-resolved paths today. What this risk does force is Unit 4's `realpathSync` on the fixture root, since `os.tmpdir()` is itself a symlink on macOS.

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

11. *What happens to `src/hooks/noldor-pre-push.ts:183`, the one site whose comparison is already correct?*
    → **Sweep it too.** (D11) Goal 1 and criterion 1 forbid comparing `import.meta.url` anywhere, and Unit 5 matches comparisons rather than the broken template, so leaving it would make criteria 1, 9 and 11 mutually unsatisfiable. Naming it an exemption was the alternative: rejected because an exempt-because-it-happens-to-be-right site is a rule a reader has to remember, while zero exemptions is a rule they can check.

14. *What about the six sites that compare paths via `fileURLToPath(import.meta.url)`?*
    → **Sweep them too; that is what makes the count 42.** (D14) `src/core/bump-session-marker.ts:25`, `src/core/prefix-skills-codemod.ts:91`, `src/triage/score.ts:181`, `src/triage/mint-id-cli.ts:56`, `src/triage/backfill-ids-cli.ts:60` and `src/triage/merge-candidates-cli.ts:32` are comparisons *and* direct-invocation guards, so treating the `fileURLToPath` shape as a non-guard use would make this spec unsatisfiable read either way: the scan would red the swept tree, or the six would bypass the choke point while Goal 1 claimed none survive. Building no URL, they are exposed to no percent-encoding defect — this is D11's reasoning applied to a third correct answer arrived at independently. `fileURLToPath` is not itself the signal: `dirname(fileURLToPath(import.meta.url))` is a directory read and never a comparison.

15. *Should `src/core/cli-entry.ts` be exempt from its own invariant?*
    → **No.** (D15) The file contains no `import.meta.url` today, and after Unit 1 `isEntrypoint` compares `moduleUrl` — a parameter — so a scan for `import.meta.url` comparisons never reaches it. The exemption would be unreachable as written, and it would bless the one file where a reintroduced raw guard would do the most damage, since every other guard now delegates to it.

12. *Should the invariant allowlist `isEntrypoint` / `invokedDirectly` as sanctioned right-hand operands?*
    → **No — that branch is unreachable.** (D12) `isEntrypoint(import.meta.url)` is a call, not a comparison, so a comparison scan never sees it; `invokedDirectly` never mentions `import.meta.url`. The rule is "every `import.meta.url` comparison outside the exempt files is a violation", which is what D8 actually asked for — the allowlist point was about matching the comparison rather than the `file://` template, not about inspecting operands.

13. *How is the claim verified that `import.meta.url` and the router's `modPath` always share an extension?*
    → **It is not verified; it is accepted residual risk with a structural argument.** (D13) A `NOLDOR_RUNTIME=dist` fixture cannot exist because `dist/` is gitignored and build-produced, and a static scan demanding `isEntrypoint` of every manifest entrypoint would contradict Non-goal 2 — 26 of the manifest's sources guard through `invokedDirectly`/`runIfDirect` and 59 carry no guard — while still not proving the pairing. Saying so beats keeping a criterion that reads as proof and is not.
