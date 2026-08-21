# Package Runtime Representation — Design

**Slug:** noldor-package-lift
**FD:** docs/features/noldor-package-lift.md
**Date:** 2026-08-21
**Tier:** specs-only
**Deps:** none — Q-0133 (single static binary) declares `blocked-by` on this decision

## Problem

The package ships two complete runtime representations and executes the wrong
one. `package.json.files` lists both `dist` and `src`, while
[`bin/noldor.mjs`](../../../bin/noldor.mjs) registers `tsx/esm/api` and imports
`src/cli/index.ts` — so compiled `dist` is published but dead, and the source
inclusion drags test suites and fixtures along. Measured here: `npm pack
--dry-run` yields 2258 entries / 2.23 MB packed / 8.75 MB unpacked, 1444 files
of `dist` and 737 of `src`.

Source-at-runtime costs latency on every invocation, because the entry graph is
transpiled before any work starts. Measured: `noldor --help` 0.094s through tsx
versus 0.058s from `dist`; `validate features` 0.24s; `checks invariants`
0.44s. One commit fires roughly eight CLI boots through the lefthook chain —
2.2–2.8s of operator-felt wait.

Running `dist` today fails past `--help`: [`src/cli/manifest.ts`](../../../src/cli/manifest.ts)
holds 112 entries whose `src` field is an `src`-relative **`.ts`** path, and
[`dispatch()`](../../../src/cli/index.ts) resolves it against its own directory,
so `node dist/cli/index.js triage validate` dies with `ERR_MODULE_NOT_FOUND` on
`dist/triage/validate-triage.ts`.

`tsc` also emits only JavaScript, so eight module-adjacent runtime assets have
no `dist` twin at all (verified absent in `dist`, present in `src`):

| Asset | Read by |
| --- | --- |
| `src/cr/cr-record.schema.json` | [`codex-adapter.ts:30`](../../../src/cr/codex-adapter.ts) via `new URL('./cr-record.schema.json', import.meta.url)` |
| `src/dashboard/static/dist/agents.js`, `drag.js` | [`server.ts:394`](../../../src/dashboard/server.ts) `STATIC_ROOT` |
| `src/testing/fixtures/canned/add-greeting-helper.json` | [`stub-gate.ts:17`](../../../src/testing/stub-gate.ts) `cannedPath()` |
| `src/invariants/.dependency-cruiser.cjs` | dependency-cruiser config discovery |
| `src/cr/standalone-prompt.md`, `src/cr/lanes/escalate-prompt.md` | [`deep-review-spawn.ts:32`](../../../src/cr/deep-review-spawn.ts) |
| `src/dashboard/static/tsconfig.json` | build-time only for the browser bundle |

A dist runtime that ignores them serves 404s for every dashboard static asset
and kills the codex CR lane.

## Goals

1. Exactly one executable runtime tree in the published tarball, and it is the
   one that runs.
2. No invocation transpiles TypeScript when a current build exists.
3. No *implicit* path ever serves a stale or partial build. Only an explicit
   `NOLDOR_RUNTIME=dist` override can, and it says so on stderr.
4. The CLI contract — command set, flags, exit codes, stdout contracts — stays
   unchanged. `doctor` gains one additive row; new failure modes appear only on
   explicit override misuse.

## Non-goals

- Bundling `dist` into a single file. The 112 dynamic manifest imports are the
  dispatch mechanism.
- A self-contained executable (Q-0133, which blocks on this).
- A public JavaScript API. `exports` keeps exposing only `./templates/*`.
- Rewriting the manifest's 112 entries.
- Fixing `PROMPT_TEMPLATE_PATH` ([`deep-review-spawn.ts:32`](../../../src/cr/deep-review-spawn.ts)),
  which resolves `src/cr/standalone-prompt.md` against the *consumer's* repo
  root and already misses in every installed package, swallowed by
  `.catch(() => '')`. Pre-existing and orthogonal; the asset unit below carries
  the file so a later fix has something to point at.

## Design

### U1 — Runtime selector (`bin/runtime-select.mjs`)

A new dependency-free `bin/runtime-select.mjs`, beside the existing
`bin/engines-check.mjs`, exports `selectRuntime(packageRoot)` returning
`{ runtime: 'dist' | 'source', reason, stale }`. It must be plain `.mjs`
because it runs before any TypeScript is loadable.

Decision order:

1. `NOLDOR_RUNTIME=dist` — run `dist` unconditionally. Absent `dist/cli/index.js`
   exits non-zero naming `pnpm build`. A stale or unverifiable build runs anyway
   and prints one stderr line saying so; this is the debug escape hatch Goal 3
   carves out.
2. `NOLDOR_RUNTIME=source` — register tsx, import `src/cli/index.ts`. Absent
   `src` or `tsx` (the installed-package shape) exits non-zero naming which one
   is missing.
3. Any other `NOLDOR_RUNTIME` value — usage error, exit non-zero.
4. No `src/` directory (installed package) — `dist` unconditionally; the
   freshness comparison has no inputs and is skipped, reported as
   `reason: 'no-source-tree'`.
5. Otherwise — `dist` when U2 says current, else source.

`bin/noldor.mjs` calls it between `assertNodeFloor()` and the entry import, and
sets `process.env.NOLDOR_RUNTIME_ACTIVE` to the chosen runtime plus
`NOLDOR_RUNTIME_REASON` to the reason before importing, which is how U7 reads
it. Every child process spawned through `NOLDOR_BIN`
([`noldor-cli.ts:12`](../../../src/core/noldor-cli.ts)) runs the selector
itself, so the value always describes the process reporting it.

[`bin/noldor-stub-gate.mjs`](../../../bin/noldor-stub-gate.mjs) ships via
`files: bin` and today top-level-imports `tsx/esm/api` plus
`../src/testing/stub-gate.ts`; `buildStubArgv`
([`stub.ts:11`](../../../src/core/agent-runner/runners/stub.ts)) makes it
reachable for any consumer configuring the `stub` runner. It gets the same
selector treatment, and its canned-fixture asset is carried by U3.

### U2 — Freshness

`pnpm build` becomes: capture the start time, run `tsc`, run the asset copy
(U3), then atomically write `dist/.build-stamp` (temp file + rename) recording

- the captured **start** time — not the finish time, so a source file edited
  while `tsc` ran reads as newer than the stamp and fails toward slow-but-correct;
- a `inputsDigest`: a hash over the sorted relative paths of the compiled input
  set plus `tsconfig.json`'s content hash. A digest mismatch means files were
  added, deleted or the compiler configuration moved, none of which an mtime
  comparison can see; obsolete `dist` output after a deletion is exactly this
  case.

`selectRuntime` reads the stamp and answers `current` only when the digest
matches and every compiled input's mtime is at or below the stamp time. A
missing, malformed or unreadable stamp counts as stale, never as current.

The input set mirrors `tsconfig.json` — `include: src/**/*.ts` minus
`src/**/__tests__/**`, `src/**/*.test.ts`, `src/fixtures/**` — so a TDD commit
touching only tests does not invalidate a good build. Measured cost of the
walk over the whole `src` tree (644 files, a superset of the compiled set):
5.6ms.

Concurrency: `pnpm build` creates `dist/.build-lock` before invoking `tsc` and
removes it after the stamp rename. `selectRuntime` treats a present lock as
stale, so an invocation landing mid-build takes the source path rather than
reading a half-rewritten tree. A lock older than 10 minutes is ignored as
abandoned.

### U3 — Runtime asset copy

`bin/copy-runtime-assets.mjs`, run by `pnpm build` after `tsc`, mirrors every
non-`.ts` file under `src/` that is not test-only into the same relative path
under `dist/`, and fails non-zero when its manifest and the filesystem
disagree. The manifest is the seven runtime assets tabulated in Problem
(`src/dashboard/static/tsconfig.json` is build-time only and excluded) — an
explicit list, not a glob, so a new runtime asset is a deliberate edit rather
than a silent inclusion.

### U4 — Extension translation in `dispatch()`

[`dispatch()`](../../../src/cli/index.ts) keeps resolving the manifest path
against `SRC_ROOT`, which already points at `dist/` when the router is
`dist/cli/index.js` (both trees put the router one level below their root). The
only change: when the router itself is not a `.ts` file, rewrite a trailing
`.ts` to `.js`. The manifest keeps naming real source files, which is what the
skills and the `skill-code-drift` / `fd-command-rot` detectors cite; neither
resolves `SubCmd.src` on disk.

### U5 — Packaging

`files` becomes `dist` (whole tree, so U3's assets travel), `bin`, `templates`,
minus `dist/**/*.d.ts`, `dist/**/*.d.ts.map` and `dist/**/*.map` via negated
patterns, and minus `src` entirely. Measured `dist` classes: 1.88 MB `.js`,
1.37 MB `.js.map`, 0.72 MB `.d.ts`, 0.25 MB `.d.ts.map`; no consumer can reach
declarations through an `exports` map limited to `./templates/*`.

`tsx` moves to `devDependencies`. `prepare` changes from bare `tsc` to the same
stamped build path as `pnpm build` — otherwise a plain `pnpm install` in a
checkout leaves `dist` present with no stamp, and the selector correctly but
uselessly reads stale forever.

### U6 — One build job in the self-host hook chain

The build job goes in the repo's **root** [`lefthook.yml`](../../../lefthook.yml),
not `lefthook/noldor.yml`. That file is a synced consumer twin: it is
byte-identical to `templates/lefthook/noldor.yml`, absent from
`SCAFFOLD_ONLY_TEMPLATES` ([`manifest.ts:20`](../../../src/templates/manifest.ts)),
and `checkTemplateSync` ([`check-template-sync.ts:28`](../../../src/checks/check-template-sync.ts))
enforces the identity — so editing it either reds `checks shared-files` or
pushes `pnpm build` onto every consumer, over a `src` tree they do not ship.

Placement is *after* the last source-mutating job, not at the head: `fmt`
(`stage_fixed: true`, globbing `*.ts`) and `code-links-auto-high` (which runs
`pnpm fmt`) rewrite `src/**/*.ts` mid-chain, and any build before them is
invalidated by their own writes. The job sits immediately before the
`noldor-pre-commit` / `validate` group, whose jobs are the eight boots that
benefit.

### U7 — Runtime visibility in `doctor`

`doctor` gains one additive row reporting `NOLDOR_RUNTIME_ACTIVE` and
`NOLDOR_RUNTIME_REASON` as set by U1 — `dist`, `source`, and for a source
checkout whether the build was current, stale or locked. Installed packages
report `dist (no-source-tree)`. Nothing else prints a runtime line; per-command
output stays unchanged per Goal 4.

### U8 — Packed-consumer verification

[`scripts/test-contract.mjs`](../../../scripts/test-contract.mjs) already packs
and installs into a fixture. It gains: no `src/` entry in the tarball; every
one of U3's runtime assets present under `dist/`; `node_modules/tsx` absent in
the consumer install; `doctor` reporting the dist runtime; and `--help` invoked
for every subcommand in `flattenManifest()` inside the packed fixture, which is
what proves each compiled module and its adjacent assets actually shipped.

## Acceptance criteria

1. In a source checkout with a current build, an invocation runs the compiled
   entry and `doctor` reports the dist runtime; touching a compiled input
   afterwards makes the next invocation take the source path and still succeed.
2. Touching only a test file, or any path `tsconfig.json` excludes, leaves the
   build current.
3. Adding or deleting a compiled input, or editing `tsconfig.json`, marks the
   build stale even when no surviving file's mtime moved.
4. A present `dist/.build-lock` forces the source path; a lock older than ten
   minutes is ignored.
5. A missing, truncated or malformed `dist/.build-stamp` reads as stale.
6. `NOLDOR_RUNTIME=dist` runs dist with a current build silently and with a
   stale one after a stderr notice; with no `dist` it exits non-zero naming the
   build command. `NOLDOR_RUNTIME=source` with no `src` or no `tsx` exits
   non-zero naming which is absent. An unrecognised value is a usage error.
7. Every subcommand in `flattenManifest()` resolves to an existing module under
   both runtimes, iterated rather than sampled.
8. Every asset in U3's manifest exists under `dist/` after `pnpm build`, and the
   build fails non-zero when the manifest and the filesystem disagree.
9. `npm pack --dry-run --json` lists no `src/`, no `.d.ts`, no `.map`, every U3
   asset, and both entry count and unpacked size below today's 2258 / 8.75 MB.
10. In the packed fixture with no `tsx` installed, `doctor` reports the dist
    runtime and `--help` exits 0 for every subcommand in `flattenManifest()`.
11. A commit exercising the hook chain builds once, and every job in the
    `validate` group behind that build reports the dist runtime.
12. `selectRuntime` costs ≤20ms on this repo's tree — median of five warm runs,
    measured by the plan's own benchmark script and recorded in the plan.
13. `prerequisites.ts` no longer asserts a tsx-only runtime, and its two
    template twins (`templates/docs/noldor/adoption-guide.md:16`,
    `templates/docs/noldor/versioning.md:199`) carry the dist-first wording, so
    `checks template-sync` stays green.
14. `pnpm verify` and `pnpm test:contract` pass with `NOLDOR_RUNTIME` unset, and
    again with it forced to each value.

## Risks / trade-offs

- **`mtime` plus digest is still not a content hash.** A backdated write that
  preserves the input set defeats it. Hashing 361 files on every boot would
  cost more than the transpile it saves; the digest closes the add/delete/config
  hole, and the lock closes the mid-build hole.
- **`git checkout` rewrites source timestamps**, so the first invocation after a
  branch switch reads stale and falls back to source — slower, never stale.
- **Two boot paths to maintain.** Criterion 14 runs the whole suite under both,
  and the override makes each directly selectable.
- **Stack traces move to compiled positions** once maps leave the tarball.
  `NOLDOR_RUNTIME=source` is the answer in a checkout; a consumer bug report
  cites dist positions.
- **U3's explicit manifest can go stale** when someone adds a runtime asset.
  Criterion 8's fail-closed check is what turns that into a red build instead of
  a runtime 404.
- **The build job adds 0.15–0.21s** per commit and pays for the eight boots
  behind it.

## User Story

As a Noldor operator, I want the CLI to execute compiled code instead of
transpiling its entire source graph on every invocation, so that commit and
push hooks stop paying a per-boot transpile tax and installs stop carrying two
runtime trees.

## Usage

```bash
# Normal use — unchanged. The runtime is selected automatically.
pnpm noldor triage validate

# Force a runtime: debugging, or proving which path served a command
NOLDOR_RUNTIME=source pnpm noldor checks invariants
NOLDOR_RUNTIME=dist   pnpm noldor checks invariants   # warns on stderr if stale

# Refresh the compiled runtime by hand; the pre-commit chain also does this
pnpm build

# Report the active runtime, and whether the build is current
pnpm noldor doctor
```

## Open questions (resolved)

1. *Which runtime representation should the package settle on?*
   → **dist-canonical with a tsx fallback.** Publishing only runtime source
   fixes tarball waste but keeps the transpile tax, which is the
   operator-felt half of the problem (D1).

2. *How does a source checkout avoid serving a stale build?*
   → **Start-time stamp + input digest + build lock, plus one build job in the
   self-host chain.** The gate makes the implicit path unconditionally correct;
   the build job is what makes the fast path actually happen, since `dist` is
   otherwise stale throughout active development (D2).

3. *How does dispatch resolve a manifest entry under both runtimes?*
   → **Keep `.ts` in the manifest, rewrite the extension at dispatch.** The
   manifest keeps naming real files for the detectors and skills citing it, and
   no fs probe is added (D3).

4. *What represents "when did we last build"?*
   → **An explicit `dist/.build-stamp`.** A no-op incremental `tsc` was
   verified not to rewrite `dist/cli/index.js`, so no emitted file is a
   trustworthy proxy (D4).

5. *Do sourcemaps and declarations belong in the tarball?*
   → **No.** `exports` makes them unreachable and they are 2.34 MB of the 8.75
   MB unpacked; `NOLDOR_RUNTIME=source` covers debugging (D5).

6. *May a forced `NOLDOR_RUNTIME=dist` serve a stale build?*
   → **Yes, with a stderr notice.** An override that silently re-derived the
   default would be useless for the one job it has — running the compiled tree
   you are debugging. Goal 3 is scoped to implicit selection (D6).

7. *How does `doctor` know which runtime served the process?*
   → **`NOLDOR_RUNTIME_ACTIVE` / `NOLDOR_RUNTIME_REASON`, set by the selector
   before the entry import.** Hook jobs are separate children spawned through
   `NOLDOR_BIN`; each runs the selector itself, so the reported value always
   belongs to the reporting process (D7).

8. *Where does the build job live, given the twin?*
   → **The root `lefthook.yml`.** `lefthook/noldor.yml` is byte-identical to
   its template twin and enforced by `checkTemplateSync`, so a build job there
   either reds the sync check or pushes `pnpm build` onto consumers (D8).
