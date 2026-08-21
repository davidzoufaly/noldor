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
2. No invocation transpiles TypeScript when a current build exists, unless the
   operator explicitly asks for the source runtime.
3. The implicit path selects `dist` only when the compiled inputs and runtime
   assets hash to exactly what the build recorded, and every expected output
   file is present. An explicit `NOLDOR_RUNTIME=dist` may override that, and
   says so on stderr.
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
`bin/engines-check.mjs`, exports a **pure** `selectRuntime(packageRoot, env)`
returning a verdict and nothing else — no printing, no exiting. It must be plain
`.mjs` because it runs before any TypeScript is loadable.

```js
// verdict shape
{ runtime: 'dist' | 'source' | 'error',
  reason: 'forced-dist' | 'forced-dist-stale' | 'forced-source'
        | 'no-source-tree' | 'digest-match' | 'digest-mismatch'
        | 'missing-output' | 'no-stamp' | 'bad-stamp' | 'build-in-progress'
        | 'bad-override' | 'no-dist' | 'no-tsx',
  stale: boolean }
```

`bin/noldor.mjs` owns every side effect: it maps `runtime: 'error'` to an exit
code and message, prints the one-line stderr notice for `forced-dist-stale`,
sets `NOLDOR_RUNTIME_ACTIVE` / `NOLDOR_RUNTIME_REASON`, appends a line to
`$NOLDOR_RUNTIME_TRACE` when that variable names a file, and then imports the
entry. That split is what makes the selector unit-testable without spawning.

An unset **or empty** `NOLDOR_RUNTIME` means "no override" — a wrapper that
clears the variable must not hard-fail every invocation.

Decision order:

1. `NOLDOR_RUNTIME=dist` — run `dist` unconditionally. Absent `dist/cli/index.js`
   exits non-zero naming `pnpm build`. A stale or unverifiable build runs anyway
   and prints one stderr line saying so; this is the debug escape hatch Goal 3
   carves out.
2. `NOLDOR_RUNTIME=source` — register tsx, import `src/cli/index.ts`. Absent
   `src` or `tsx` (the installed-package shape) exits non-zero naming which one
   is missing.
3. Any other non-empty `NOLDOR_RUNTIME` value — `reason: 'bad-override'`,
   which the caller turns into a usage error.
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
`files: bin` and its line 2 is a **static** `import { register } from
'tsx/esm/api'` — unlike `bin/noldor.mjs`, whose tsx import is already dynamic.
Once `tsx` is a devDependency that static import crashes the file on load in
every installed package, and `buildStubArgv`
([`stub.ts:11`](../../../src/core/agent-runner/runners/stub.ts)) makes it
reachable for any consumer configuring the `stub` runner. It therefore calls the
same selector, imports `dist/testing/stub-gate.js` or the `.ts` twin
accordingly, and its tsx import becomes dynamic and fallback-only. Its canned
fixture is carried by U3 and exercised by U8.

### U2 — Freshness by content digest

Freshness is content-based, not timestamp-based. `bin/build-inputs.mjs` is the
**single** enumerator both the build and the selector use: it derives the
compiled input set from `tsconfig.json` (`include: src/**/*.ts` minus
`src/**/__tests__/**`, `src/**/*.test.ts`, `src/fixtures/**`), appends U3's
runtime-asset manifest, and returns sorted absolute paths. One enumerator is the
point — two drifting enumerations would make the digest never match and silently
strip the fast path away while every other criterion stayed green.

`pnpm build` then:

1. Acquires `dist/.build-lock` by `open(..., 'wx')` — an atomic exclusive
   create — writing its pid. A second builder finding a live pid exits 0 with
   "build already in progress"; a lock whose pid is not alive is a crashed
   build, so it is removed and the build proceeds. Liveness is a fresh process
   probe, never a timeout. `try/finally` plus `SIGINT`/`SIGTERM` handlers release
   it.
2. Runs `tsc`.
3. Prunes orphans: every `.js` under `dist` with no corresponding entry in the
   enumerator's compiled set is deleted, because `tsc` leaves the output of a
   deleted input behind and `files: dist` would ship it.
4. Copies U3's assets.
5. Atomically writes `dist/.build-stamp` (temp file + rename) recording the
   `inputsDigest` — a SHA-256 over each enumerated path and its content — and
   the `outputs` list: every path the build emitted or copied.

`selectRuntime` answers `dist` only when the stamp parses, its `inputsDigest`
equals a freshly computed digest, and every `outputs` entry exists. Otherwise
the reason names which check failed and the verdict is `source`. A missing,
truncated or malformed stamp is `no-stamp` / `bad-stamp`, never current. A live
`dist/.build-lock` is `build-in-progress`, so an invocation landing mid-build
takes the source path rather than reading a half-rewritten tree.

Measured on this tree: enumerating and hashing 683 compiled inputs (2.4 MB)
costs 10–12ms, against the 0.35s transpile it avoids. Content hashing is what
makes the digest immune to `mtime` behaviour entirely — backdated writes, equal
timestamps, and `git checkout` rewriting every source timestamp all stop
mattering.

`tsconfig.json` carries no `extends` and no `references` today, so enumerating
from it is exact. A test asserts that stays true; if either appears, the
enumerator must follow it before the digest can be trusted, so the assertion
fails closed rather than silently under-hashing.

The residual window is a source edit landing between the digest computation and
the entry import. It is inherent to any check-then-run design and bounded to the
invocation that raced: the edit is visible to the digest on the next boot.

### U3 — Runtime asset copy

`bin/copy-runtime-assets.mjs`, run by `pnpm build` after `tsc`, copies **exactly
the entries in its manifest** — never a glob, so `src/fixtures/**` (17 files)
and test fixtures can never leak into `dist` or the tarball. It exits non-zero
when a manifest entry is missing from `src`, and when a file matching its
extensions appears in a manifested directory without being listed, so a new
runtime asset is a deliberate edit rather than a silent inclusion or a runtime
404.

The manifest is six files:

- `src/cr/cr-record.schema.json`
- `src/dashboard/static/dist/agents.js`
- `src/dashboard/static/dist/drag.js`
- `src/testing/fixtures/canned/add-greeting-helper.json`
- `src/cr/standalone-prompt.md`
- `src/cr/lanes/escalate-prompt.md`

`src/dashboard/static/tsconfig.json` is build-time-only and excluded.
`src/invariants/.dependency-cruiser.cjs` is excluded too: it has no reader —
[`boundaries.ts:4`](../../../src/invariants/boundaries.ts) builds `cruise()`
options in code, and nothing in the repo references the file — so shipping it
would pin a dead file into `dist` forever.

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
which today is nothing but `extends: - ./lefthook/noldor.yml`. That file cannot
be the twin: `lefthook/noldor.yml` is byte-identical to
`templates/lefthook/noldor.yml`, absent from `SCAFFOLD_ONLY_TEMPLATES`
([`manifest.ts:20`](../../../src/templates/manifest.ts)), and `checkTemplateSync`
([`check-template-sync.ts:28`](../../../src/checks/check-template-sync.ts))
enforces the identity — so a job there either reds `checks shared-files` or
pushes `pnpm build` onto every consumer, over a `src` tree they do not ship.

Lefthook concatenates hook `jobs` arrays with the root config's jobs **first**,
and `jobs` carries no ordering field, so a root-file job lands at the head of the
pre-commit chain — before `fmt` (`stage_fixed: true`) and
`code-links-auto-high`, both of which rewrite `src/**/*.ts` mid-chain. Under the
timestamp design that placement was worthless, because those writes moved every
mtime past the stamp. Under U2's content digest it is fine: a formatter run that
changes no bytes leaves the digest intact, so the jobs behind it still take the
compiled path. When `fmt` genuinely reformats a file the digest legitimately
changes and the rest of that one commit falls back to source — correct, and
self-correcting on the next commit.

This is why freshness had to become content-based rather than merely being
hardened: head placement is the only slot the root config can occupy, and only a
content digest survives it.

### U7 — Runtime visibility in `doctor` and an opt-in trace

`doctor` gains one additive row printing the verdict the selector produced for
*this* process: `runtime` and `reason` from `NOLDOR_RUNTIME_ACTIVE` /
`NOLDOR_RUNTIME_REASON`, e.g. `dist (digest-match)`, `source
(digest-mismatch)`, `dist (no-source-tree)` in an installed package. The reason
vocabulary is the enum in U1, so the row is an exact contract rather than prose.
No other command prints a runtime line.

Because every process derives its own verdict, a *chain* of processes needs a
durable record. When `NOLDOR_RUNTIME_TRACE` names a file, `bin/noldor.mjs`
appends one `<pid> <runtime> <reason> <argv-tail>` line per invocation. That is
the observable AC 11 asserts against; it is off unless the variable is set, so
normal output is untouched.

### U8 — Packed-consumer verification

[`scripts/test-contract.mjs`](../../../scripts/test-contract.mjs) already packs
and installs into a fixture. It gains, in that packed fixture:

- no `src/` entry, no `.d.ts`, no `.map` in the tarball; every U3 asset present
  under `dist/`;
- `node_modules/tsx` absent, and the harness scrubs `NOLDOR_RUNTIME*` from the
  child environment so an operator's shell cannot flip what CI proves;
- `doctor` reporting `dist (no-source-tree)`;
- `--help` for every subcommand in `flattenManifest()`, which proves each
  compiled module resolves;
- and, because `--help` exercises no assets, four behavioural probes that do:
  the dashboard server answering `GET /static/agents.js` and `/static/drag.js`
  with 200, a `cr` invocation that reads `cr-record.schema.json`, a canned run
  through `bin/noldor-stub-gate.mjs` reading its fixture, and a deep-review
  spawn path that loads `standalone-prompt.md`.

## Acceptance criteria

1. With a current build, an invocation runs the compiled entry and `doctor`
   reports `dist (digest-match)`; changing the content of any compiled input or
   runtime asset makes the next invocation take the source path and still
   succeed.
2. Touching a file without changing its bytes — a no-op reformat, a `git
   checkout` that rewrites timestamps — leaves the build current.
3. Editing a file `tsconfig.json` excludes (a test, anything under
   `src/fixtures/`) leaves the build current.
4. Adding or deleting a compiled input, or editing `tsconfig.json`, makes the
   build stale; after the rebuild, the deleted input's emitted `.js` is gone from
   `dist`.
5. Deleting any file listed in the stamp's `outputs` makes the build stale
   (`missing-output`) even though the input digest still matches.
6. A `dist/.build-lock` held by a live process forces the source path; a lock
   whose pid is dead is removed and the build treated as stale; a second
   concurrent `pnpm build` exits 0 without touching `dist`.
7. A missing, truncated or malformed stamp reads as stale.
8. `NOLDOR_RUNTIME=dist` runs dist silently with a current build and after a
   stderr notice with a stale one; with no `dist` it exits non-zero naming the
   build command. `NOLDOR_RUNTIME=source` with no `src` or no `tsx` exits
   non-zero naming which is absent. Unset and empty both mean no override; any
   other value is a usage error.
9. `selectRuntime` is pure: unit tests drive every reason in the enum through it
   without spawning a process, and it neither prints nor exits.
10. Every subcommand in `flattenManifest()` resolves to an existing module under
    both runtimes, iterated rather than sampled.
11. Every asset in U3's manifest exists under `dist/` after `pnpm build`; the
    build fails non-zero when a manifest entry is missing from `src` or an
    unlisted asset appears in a manifested directory.
12. `npm pack --dry-run --json` lists no `src/`, no `.d.ts`, no `.map`, every U3
    asset, and both entry count and unpacked size below today's 2258 / 8.75 MB.
13. In the packed fixture with no `tsx` installed and `NOLDOR_RUNTIME*` scrubbed:
    `doctor` reports `dist (no-source-tree)`; `--help` exits 0 for every
    subcommand; the dashboard answers 200 for `/static/agents.js` and
    `/static/drag.js`; the schema, canned-fixture and prompt reads all succeed;
    and `bin/noldor-stub-gate.mjs` completes a canned run.
14. A commit exercising the hook chain with `NOLDOR_RUNTIME_TRACE` set builds
    once, and the trace shows `dist` for every subsequent invocation in that
    chain when `fmt` changed no bytes.
15. `selectRuntime` costs ≤25ms on this repo's tree — median of five warm runs,
    measured by the plan's benchmark script and recorded in the plan.
16. `prerequisites.ts` no longer asserts a tsx-only runtime, and its two template
    twins (`templates/docs/noldor/adoption-guide.md:16`,
    `templates/docs/noldor/versioning.md:199`) carry the dist-first wording, so
    `checks template-sync` stays green.
17. `pnpm verify` passes with `NOLDOR_RUNTIME` unset, forced to `dist`, and
    forced to `source`. `pnpm test:contract` passes unset and forced to `dist`;
    forced `source` is not applicable in the packed fixture, which by design
    carries neither `src` nor `tsx`.

## Risks / trade-offs

- **Content hashing costs 10–12ms per invocation** where the timestamp design
  cost 5.6ms. It buys immunity to every `mtime` pathology — backdated writes,
  equal timestamps, `git checkout` rewriting the tree — and it is what makes the
  only available hook slot usable.
- **The check-then-import window remains.** A source edit landing between the
  digest and the import is served by the build that preceded it, and is picked up
  on the next invocation. Closing it would require holding a lock across the
  whole command.
- **Two boot paths to maintain.** Criterion 17 runs the suite under each, and the
  override makes both directly selectable.
- **`fmt` reformatting a file mid-chain drops the rest of that commit to
  source.** Correct — the tree really did change — and it only happens on commits
  where the author had not already formatted.
- **U3's manifest can go stale** when someone adds a runtime asset. Criterion 11
  turns that into a red build instead of a runtime 404, in both directions.
- **Stack traces move to compiled positions** once maps leave the tarball.
  `NOLDOR_RUNTIME=source` is the answer in a checkout; a consumer bug report
  cites dist positions.
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
   → **A content digest over the compiled inputs and runtime assets, an output
   presence check, and a build lock — plus one build job in the self-host
   chain.** Timestamps were the first answer and could not hold: `git checkout`
   rewrites them, backdated writes defeat them, and the formatter jobs move them
   mid-chain. Hashing costs 10–12ms and removes the whole class (D2).

3. *How does dispatch resolve a manifest entry under both runtimes?*
   → **Keep `.ts` in the manifest, rewrite the extension at dispatch.** The
   manifest keeps naming real files for the detectors and skills citing it, and
   no fs probe is added (D3).

4. *What represents "when did we last build"?*
   → **`dist/.build-stamp`, holding a content digest and the emitted output
   list — not a timestamp.** A no-op incremental `tsc` was verified not to
   rewrite `dist/cli/index.js`, so no emitted file is a trustworthy proxy for
   "when", and "when" turned out to be the wrong question anyway (D4).

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
   → **The root `lefthook.yml`, at the head of the chain.** `lefthook/noldor.yml`
   is byte-identical to its template twin and enforced by `checkTemplateSync`, so
   a job there either reds the sync check or pushes `pnpm build` onto consumers.
   Lefthook concatenates root jobs first and offers no ordering field, so head is
   the only slot the root file can occupy — which is precisely why freshness had
   to become content-based rather than timestamp-based (D8).

9. *Does the freshness check cover the runtime assets, not just TypeScript?*
   → **Yes — they are in the same digest.** Editing `agents.js` or a schema
   without invalidating the build would serve a stale copy from `dist` with no
   TypeScript involved (D9).

10. *Who enumerates the compiled input set?*
    → **One shared `bin/build-inputs.mjs`, used by both the stamp writer and the
    selector.** Two enumerations drifting by a single path would make the digest
    never match, silently removing the fast path while every criterion except
    the first stayed green (D10).
