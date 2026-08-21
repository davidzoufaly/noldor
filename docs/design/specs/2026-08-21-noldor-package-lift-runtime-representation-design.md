# Package Runtime Representation — Design

**Slug:** noldor-package-lift
**FD:** docs/features/noldor-package-lift.md
**Date:** 2026-08-21
**Tier:** specs-only
**Deps:** none — Q-0133 (single static binary) declares `blocked-by` on this decision

## Problem

The package ships two complete runtime representations and runs neither one
cleanly. `package.json.files` lists both `dist` and `src`, while
[`bin/noldor.mjs`](../../../bin/noldor.mjs) registers `tsx/esm/api` and imports
`src/cli/index.ts` — so compiled `dist` is published but never executed, and
the source inclusion drags test suites and fixtures along with it. Measured on
this checkout: `npm pack --dry-run` yields 2258 entries / 2.23 MB packed /
8.75 MB unpacked, of which 1444 files are `dist` and 737 are `src`.

Source-at-runtime also costs latency on every invocation, because the whole
entry graph is transpiled before any work starts. Measured: `noldor --help`
0.094s through tsx versus 0.058s from `dist`; `validate features` 0.24s;
`checks invariants` 0.44s. A single commit fires roughly eight CLI boots
through the lefthook chain, totalling 2.2–2.8s of operator-felt wait per
commit.

Running `dist` today does not work at all beyond `--help` and `--version`:
[`src/cli/manifest.ts`](../../../src/cli/manifest.ts) holds 112 entries whose
`src` field is an `src`-relative **`.ts`** path, and
[`dispatch()`](../../../src/cli/index.ts) resolves that path against its own
directory, so `node dist/cli/index.js triage validate` dies with
`ERR_MODULE_NOT_FOUND` on `dist/triage/validate-triage.ts`.

## Goals

1. Exactly one runtime tree in the published tarball, and it is the one that
   executes.
2. No invocation transpiles TypeScript when a current build exists.
3. A stale build can never serve a command — correctness is unconditional, not
   dependent on the operator remembering to build.
4. The CLI surface, the `exports` map and every consumer-visible behaviour stay
   byte-identical.

## Non-goals

- Bundling `dist` into a single file (esbuild or equivalent). The 112 dynamic
  manifest imports are the dispatch mechanism, and collapsing them buys little
  over plain `dist`.
- A self-contained executable. That is Q-0133, which blocks on this decision.
- Adding a public JavaScript API. `exports` continues to expose only
  `./templates/*`.
- Rewriting the manifest's 112 entries.

## Design

### U1 — Runtime selector in `bin/noldor.mjs`

`bin/noldor.mjs` gains a runtime decision between its existing
`assertNodeFloor()` call and the import of the CLI entry:

1. `NOLDOR_RUNTIME=dist` forces the compiled path and exits non-zero with a
   build hint when `dist/cli/index.js` is absent. `NOLDOR_RUNTIME=source`
   forces the tsx path. Any other value is a usage error.
2. With no override: run `dist/cli/index.js` when it exists and is current per
   U2; otherwise register `tsx/esm/api` and import `src/cli/index.ts`.
3. When `src` is absent (the installed-package shape) `dist` is current by
   definition and the freshness walk is skipped.

The selector lives in a new dependency-free `bin/runtime-select.mjs` beside the
existing `bin/engines-check.mjs`, because it must run before any TypeScript is
loadable. Same constraint, same shape, same file family.

### U2 — Freshness stamp

`pnpm build` becomes `tsc && node bin/write-build-stamp.mjs`, which writes
`dist/.build-stamp` containing the build's wall-clock time. The selector
compares the newest `mtime` among `src/**/*.ts` against that stamp: newer
source means stale build means tsx fallback.

A stamp file is required rather than reading a `dist` artifact's `mtime`:
verified that a no-op incremental `tsc` leaves `dist/cli/index.js` untouched,
so any single emitted file is an unreliable proxy for "when did we last
build".

Measured cost of the source walk on this tree (644 `.ts` files): 5.6ms.

### U3 — Extension translation in `dispatch()`

[`dispatch()`](../../../src/cli/index.ts) keeps resolving the manifest's
`src`-relative path against `SRC_ROOT`, which already points at `dist/` when
the router is `dist/cli/index.js` (both trees put the router one level below
their root). The only change is the extension: when the router itself is not a
`.ts` file, rewrite a trailing `.ts` to `.js`.

The manifest keeps naming real source files, which is what the skills and the
`skill-code-drift` / `fd-command-rot` detectors cite. Neither detector resolves
`SubCmd.src` on disk, so nothing else is affected.

### U4 — Packaging

`files` becomes `dist/**/*.js`, `bin`, `templates` — dropping `src` entirely
and, within `dist`, the declaration and sourcemap classes that no consumer can
reach through an `exports` map limited to `./templates/*`. Measured classes in
`dist`: 1.88 MB of `.js`, 1.37 MB of `.js.map`, 0.72 MB of `.d.ts`, 0.25 MB of
`.d.ts.map`.

`tsx` moves from `dependencies` to `devDependencies`; the fallback path needs
it only in a source checkout. `prepare` already runs `tsc`, which npm executes
before `pack` and `publish`, so the published `dist` cannot be missing.

### U5 — Invariant and documentation updates

[`src/core/prerequisites.ts:49`](../../../src/core/prerequisites.ts) currently
records `whereAssumed: 'bin/noldor.mjs + tsx runtime execute all CLI surfaces'`
for the Node floor. That text becomes the dist-first statement. The
`NOLDOR_BIN` docstring in
[`src/core/noldor-cli.ts`](../../../src/core/noldor-cli.ts) says the bin "boots
`src/cli/index.ts` via tsx" and gets the same treatment, as does any
architecture page asserting the tsx runtime.

### U6 — One build job in the pre-commit chain

`lefthook/noldor.yml` gains a `build` job at the head of the pre-commit chain
(measured 0.15–0.21s incremental, 0.15s no-op), so the jobs behind it all take
the compiled path instead of each paying its own transpile.

### U7 — Runtime visibility in `doctor`

`noldor doctor` reports which runtime served the invocation and, in a source
checkout, whether the build is current. This is the observable that the
contract test asserts against, and it is what an operator reads when a hook
feels slow.

### U8 — Packed-consumer verification

`scripts/test-contract.mjs` already packs the package and installs it into a
fixture. It gains assertions that the tarball carries no `src/` entry, that
`node_modules/tsx` is absent in the consumer install, and that `doctor` in that
fixture reports the dist runtime.

## Acceptance criteria

1. `noldor --help` in a source checkout with a current build runs the compiled
   entry, and `doctor` reports the dist runtime.
2. Touching any `src/**/*.ts` after a build makes the next invocation fall back
   to source and still succeed.
3. `NOLDOR_RUNTIME=source` runs the tsx path even with a current build;
   `NOLDOR_RUNTIME=dist` with no `dist` exits non-zero naming the build
   command; an unrecognised value is a usage error.
4. Every subcommand in `MANIFEST` resolves to an existing module under both
   runtimes, asserted by iterating `flattenManifest()` rather than by sampling.
5. `npm pack --dry-run --json` lists no `src/` entry, no `.d.ts`, no `.map`,
   and both entry count and unpacked size fall below today's 2258 / 8.75 MB.
6. A packed install in the contract fixture runs `doctor`, `init`,
   `validate features` and `garden detect` green with no `tsx` in the
   consumer's `node_modules`.
7. The pre-commit chain builds once, and every job behind that build reports
   the dist runtime.
8. The freshness decision is computed before any dispatch, and its cost on this
   repo's tree stays at or below 20ms.
9. `prerequisites.ts` no longer asserts a tsx-only runtime, and `doctor` does
   not require `tsx` when serving from `dist`.
10. `pnpm verify` and `pnpm test:contract` pass under both runtimes.

## Risks / trade-offs

- **`mtime` is coarse.** A `git checkout` rewrites source timestamps, so the
  first invocation after a branch switch reads as stale and falls back to
  source. The failure direction is correct-but-slower, never stale-but-fast.
- **Two boot paths to maintain.** Mitigated by criterion 10 running the whole
  suite both ways, and by the override making each path directly selectable.
- **Stack traces move to compiled line numbers** once maps leave the tarball.
  `NOLDOR_RUNTIME=source` in a checkout is the debugging answer; a consumer bug
  report cites dist positions, which is what a CLI without a public API needs.
- **The pre-commit build job adds 0.15–0.21s** to every commit and pays for
  roughly eight boots behind it.
- **Dropping `src` removes an unsupported deep-import escape hatch.** The
  `exports` map already blocks those imports, so nothing supported changes.

## User Story

As a Noldor operator, I want the CLI to execute compiled code instead of
transpiling its entire source graph on every invocation, so that commit and
push hooks stop paying a per-boot transpile tax and installs stop carrying two
runtime trees.

## Usage

```bash
# Normal use — unchanged. Runtime is selected automatically.
pnpm noldor triage validate

# Force a runtime (debugging, or proving which path served a command)
NOLDOR_RUNTIME=source pnpm noldor checks invariants
NOLDOR_RUNTIME=dist   pnpm noldor checks invariants

# Refresh the compiled runtime by hand; the pre-commit chain also does this
pnpm build

# Report the active runtime and whether the build is current
pnpm noldor doctor
```

## Open questions (resolved)

1. *Which runtime representation should the package settle on?*
   → **dist-canonical with a tsx fallback.** Publishing only runtime source
   (the archived entry's first option) fixes tarball waste but keeps the
   transpile tax, which is the operator-felt half of the problem (D1).

2. *How does a source checkout avoid serving a stale build?*
   → **A 5.6ms freshness gate plus one build job in the pre-commit chain.** The
   gate makes correctness unconditional; the build job is what makes the local
   fast path actually happen, since `dist` is otherwise stale during active
   development (D2).

3. *How does dispatch resolve a manifest entry under both runtimes?*
   → **Keep `.ts` in the manifest and rewrite the extension at dispatch.** The
   manifest keeps naming real files for the detectors and skills that cite it,
   and no fs probe is added (D3).

4. *What represents "when did we last build"?*
   → **An explicit `dist/.build-stamp` written by `pnpm build`.** A no-op
   incremental `tsc` was verified not to rewrite `dist/cli/index.js`, so no
   single emitted file is a trustworthy proxy (D4).

5. *Do sourcemaps and declarations belong in the tarball?*
   → **No.** With `exports` limited to `./templates/*` no consumer can import
   them, and they are 2.34 MB of the 8.75 MB unpacked. `NOLDOR_RUNTIME=source`
   covers debugging in a checkout (D5).

6. *Does anything still need `tsx` at consumer runtime?*
   → **No.** It becomes a devDependency, and criterion 6 asserts its absence in
   the packed-install fixture (D6).
