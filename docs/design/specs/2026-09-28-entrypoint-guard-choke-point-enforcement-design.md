# Entrypoint-Guard Choke-Point Enforcement — Design

**Slug:** entrypoint-guard-choke-point-enforcement
**FD:** docs/features/entrypoint-guard-choke-point-enforcement.md
**Date:** 2026-09-28
**Tier:** specs-only

UI verdict: skip — the repo declares no `consumer.uiPaths`, and nothing here renders.

Architecture verdict: skip — no new directory, package, runnable unit or external; one new file inside `src/invariants/`, and the sweep only adds `src/core/cli-entry.ts` imports that the `core-is-foundation` direction already allows.

## Problem

A module under `src/` decides "was I run directly?" before it runs its CLI body. When that decision is wrong, the body never runs and the process exits 0. Callers read that as success. Q-0126 (PR #454) fixed the one shape known to be wrong: comparing `import.meta.url` to a `file://` template of `process.argv[1]`, which fails on any path that needs percent-encoding. It routed those 42 sites through `isEntrypoint` in `src/core/cli-entry.ts`. It added no check, and the class regrows: two new broken sites arrived while Q-0126 sat in the queue.

Q-0126 did not touch every hand-written guard. **49 non-test files** still read `process.argv[1]` themselves:

- 25 compare by prefix: `basename(process.argv[1]).startsWith('<stem>')`, including the `typeof` variant in `src/core/lint-plan-snippets.ts:283`.
- 20 test an inline copy of `invokedDirectly`'s regex: `/[\\/]<stem>\.(ts|js|mjs)$/.test(process.argv[1] ?? '')`.
- 3 dashboard modules compare by suffix: `process.argv[1]?.endsWith('server.ts')` in `src/dashboard/{server,status,ensure}.ts`.
- 1 is not a guard at all. `src/testing/contract-harness.ts:194` holds `import(process.argv[1])` inside the template text of a child `node -e` script.

None of these has the encoding bug. Two of the shapes are looser than they look, though. A prefix or suffix match is true for any file whose name starts or ends the same way. `'garden-detect'` matches `src/garden/garden-detect-runner.ts`. `'sdd-report'` matches `sdd-report-format.ts` and `src/release/sdd-report-diff.ts`. `endsWith('status.ts')` matches `src/worktrees/worktree-status.ts`, which the router runs directly. Today none of those files imports the module whose guard it satisfies, so nothing misfires. The first such import would run two CLI bodies in one process.

Three attempts to recognise a bad comparison in text failed in three rounds of code review. Each failure was a heuristic judging either an operator or the lines around a mention (see Risks).

## Goals

- A new hand-written read of `process.argv[1]` anywhere under `src/` makes `pnpm noldor checks invariants` exit non-zero, naming the file and line.
- One place derives direct invocation from `argv[1]`: `src/core/cli-entry.ts`. After this change every guard in `src/` is `isEntrypoint(import.meta.url)`, `invokedDirectly(stem)` or `runIfDirect(stem, label, main)`.
- No module's direct-invocation behaviour changes, except that a prefix or suffix match becomes an exact one.

## Non-goals

- Re-signing `runIfDirect` / `invokedDirectly` to take `import.meta.url`. That would change the 22 call sites already on the helper, and none of them is broken.
- Catching `argv` reached through an alias: `const a = process.argv; a[1]`, `process['argv']`, or `argv` imported from `node:process`. Nothing in `src/` reads index 1 that way today. The two files that import `argv` from `node:process` only call `.includes(...)`.
- Scanning outside `src/` (`bin/`, `templates/`), or scanning test files.
- An AST route (`@swc/core`, or the TS 7 `unstable/*` API server). The rule needs only a token match once comments and strings are masked out.

## Design

### Structural context

`src/core/cli-entry.ts` sits in community c92, next to the CLI entry modules it serves (`src/rules/cli-resolve.ts`, `src/hooks/noldor-inject-trailers.ts`, `src/milestones/validate-milestones.ts`). It defines two god nodes: `isEntrypoint()` (rank #3, 47 edges) and `runIfDirect()` (rank #8, 36 edges). The sweep adds about 49 more import edges to `isEntrypoint`, which moves it toward rank #1. That concentration is the point of the feature, not a side effect. `src/invariants/source-scan.ts` is interior to c116 (the invariants community): no god node, and its only cross-community edges are `walkRepo()` in `fd-load.ts` and its two sibling plugins. The new plugin lands beside it with the same shape.

### Masking non-code text (`maskNonCode` in `src/invariants/source-scan.ts`)

The rule matches tokens, so first it must know which characters are code. `maskNonCode(text)` returns a string of the same length. Every character inside a comment, a string literal or the literal text of a template is replaced with a space, and newlines are kept. So offsets and line numbers match the original file.

Template holes (`${ … }`) stay code, recursively. That matters because `` `file://${process.argv[1]}` `` is the exact shape Q-0126 swept. The mask handles the traps the earlier attempts listed:

- A one-line `/** … */` doc comment is masked.
- `/* note */ if (…) {}` masks only the comment.
- `'file://' + process.argv[1]` keeps its code, because `//` inside a string opens no comment.

It lives in `source-scan.ts` beside `splitArgs`, because it is a general text-scan tool, not this plugin's own.

`src/clones/tokenize.ts` is not reused. It collapses a whole template, holes included, into one `LIT` token, which would hide the swept shape.

Known imprecision: regex literals are not recognised. A `'` or `/*` inside a regex literal would mask the wrong span. Nothing in `src/` does that once the 20 inline regexes are swept, and the live-repo test case would surface a new one the day it lands.

### The rule (`src/invariants/entrypoint-guard-choke-point.ts`)

`defineSrcScanInvariant('entrypoint-guard-choke-point', …)` scans every `.ts` file under `src/`, skipping `__tests__/` directories, `*.test.ts` and `src/core/cli-entry.ts`. After masking, the rule flags each of these forms:

- `process.argv[1]` and `process.argv?.[1]`
- `process.argv.at(1)`
- `process.argv.slice(1` … (any `slice` starting at 1, which passes `argv[1]` on)
- array destructuring from `process.argv` whose second slot binds a name: `[, x]`, `[a, b]`, `[, ...rest]`. `[, , group]` is not flagged: its second slot is a hole, as in `src/cli/index.ts:116` and `src/milestones/cli.ts:32`.

Whitespace is allowed around every `.`, `[` and `(`.

Reads and writes are both flagged. Only `cli-entry.ts` may touch the slot. `src/cli/index.ts` gets no allowance. It reassigns `process.argv` as a whole array and destructures `[, , group, …]`, so it never touches slot 1. An allowance it does not use would be one more place the class could come back.

Each violation names the file and 1-based line. The message names the three sanctioned calls. The plugin is **blocking**: every flagged form is an exact token shape, so a hit is always a real read, never a guess. That is the same reason `locale-compare-pinned` is blocking. `src/invariants/index.ts` registers it in both `invariants` and `makeInvariants`.

### The sweep

Each of the 49 files gets a one-line change to its guard. The tail below the guard (what runs, how it exits) is left alone:

- **Prefix, suffix and `typeof` shapes (28 files)** → `isEntrypoint(import.meta.url)`. That is path-exact, so the prefix and suffix over-matches go away. An unused `basename` import is dropped.
- **Inline regex (20 files)** → `invokedDirectly('<stem>')`, which has the same semantics. When the tail is exactly `runIfDirect`'s body (`main(process.argv.slice(2))` → `process.exit(code)` → labelled stderr + exit 1, as in `src/core/wait-cli.ts:166`), it becomes `runIfDirect(stem, label, main)` instead. These sites do not move to `isEntrypoint`, because that would change what happens when a module is invoked through a symlinked path. It belongs with re-signing `runIfDirect`, which is a separate feature.
- **`src/testing/contract-harness.ts`** → no change. Its `argv[1]` is template text, so the mask removes it.

### Tests

`src/invariants/__tests__/entrypoint-guard-choke-point.test.ts` feeds `scanSource` fixtures in both directions:

- Every form listed above is flagged.
- Every shape the earlier attempts got wrong is classified correctly: the sanctioned `isEntrypoint(import.meta.url) && argv.length === 2`, the documented `isEntrypoint(import.meta.url, argv1)`, `new URL('x', import.meta.url)` near an argv read, `[, , group]`, `process.argv[0]`, one-line doc comments, `/* c */ code`, and argv inside strings and template text but not inside holes.

`maskNonCode` gets its own table test in the same file. A live-repo case runs `makeEntrypointGuardChokePointInvariant(repoRoot)` against the real tree and expects zero violations. That case is the sweep's completeness proof.

## Acceptance criteria

- `pnpm noldor checks invariants` exits 0 on the branch, with `entrypoint-guard-choke-point` listed and reporting no violations.
- Adding `const x = process.argv[1];` to any non-test `.ts` file under `src/` other than `src/core/cli-entry.ts` makes `pnpm noldor checks invariants` exit non-zero and name that file and line. The same holds for `.at(1)`, `.slice(1)`, `?.[1]` and `[, x] = process.argv`.
- `` `file://${process.argv[1]}` `` in a template hole is flagged. The same text in a comment, a string literal or template text is not.
- None of these is flagged: `isEntrypoint(import.meta.url)`, `isEntrypoint(import.meta.url, argv1)`, `invokedDirectly('x')`, `runIfDirect(...)`, `process.argv.slice(2)`, `process.argv[0]` and `const [, , a] = process.argv`.
- `grep -rE 'process\.argv(\?\.)?\[1\]'` over non-test `src/**/*.ts` finds only `src/core/cli-entry.ts`, comment lines, and the template text at `src/testing/contract-harness.ts:194`.
- Every swept module still runs its body when invoked through `pnpm noldor <group> <cmd>`, and still does nothing when imported. The existing test suite passes unchanged.
- A module whose basename only starts or ends with a swept stem (e.g. `src/garden/garden-detect-runner.ts`) no longer satisfies that stem's guard.
- `pnpm typecheck`, `pnpm test`, the clone gate and the indirection ratchet all pass. Any ratchet movement is re-recorded in its own commit.

## Risks / trade-offs

- **The earlier text scans.** Over three rounds, these approaches were falsified: keying on an equality operator near the mention, judging a window of lines, per-line co-occurrence of `import.meta.url` and an indexed argv read, whole-line comment blanking without first stripping closed `/* … */` spans, and cutting a line at `//`. This design keeps none of them. It never looks for an operator or a neighbour. It asks one question per token: is this a read of argv slot 1 in code? The mask replaces every comment and line heuristic.
- **`isEntrypoint` normalises encoding, not symlinks.** Invoking a swept module as `node <symlinked-path>` now returns false where the prefix match returned true. The router passes a realpath (`src/cli/index.ts` builds `modPath` from its own `fileURLToPath(import.meta.url)`), and every hook runs through the router. So only a hand-typed symlinked invocation changes. On macOS `os.tmpdir()` is under the `/var` → `/private/var` symlink, so any test that copies a module into a tmp dir and runs it directly would now go quiet. The suite will show it. None is known.
- **Diff-scoped clone gate.** The sweep touches only guard lines, and tails stay as they were. A regex site that moves to `runIfDirect` *removes* duplicated tokens. If the gate still fires on a touched span, the answer is to move that site to `runIfDirect`, not to rebaseline.
- **49 files in one PR.** Each change is mechanical and has the same shape. The live-repo test case gives a single yes/no on completeness.

## User Story

As an agent or maintainer adding a CLI module under `src/`, I want the invariants check to refuse a hand-written read of `process.argv[1]`, so that a guard that silently never fires cannot ship. The only way to ask "was I run directly?" is then a helper that is tested once.

## Usage

- Guard a new CLI module with `if (isEntrypoint(import.meta.url)) { … }` or `runIfDirect('<stem>', '<label>', main)` from `src/core/cli-entry.ts`.
- `pnpm noldor checks invariants` (also run by the pre-push gate and CI) reports `entrypoint-guard-choke-point` violations as `<file>:<line>` with the sanctioned alternatives.

## Open questions (resolved)

1. _Should `src/cli/index.ts` be on the allowlist?_ → No. It never reads slot 1. It reassigns `process.argv` whole and destructures `[, , group, …]`, which the rule does not flag. An allowance it does not use would be a place the class could come back (D3).
2. _Which spelling do regex-shaped guards move to?_ → `invokedDirectly` / `runIfDirect`. That keeps their semantics exactly. Moving them to `isEntrypoint` belongs with the separate `runIfDirect` re-signing (D2).
3. _Should the mask recognise regex literals?_ → No. After the sweep no regex literal in `src/` contains a quote or `/*`. The live-repo test would expose a new one on the day it lands (D4).
4. _Blocking or advisory?_ → Blocking. The match is exact, like `locale-compare-pinned` (D5).
