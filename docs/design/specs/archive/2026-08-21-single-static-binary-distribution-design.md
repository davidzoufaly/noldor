# Single Static Binary Distribution — Design

**Slug:** single-static-binary-distribution
**FD:** docs/features/single-static-binary-distribution.md
**Date:** 2026-08-21
**Tier:** full
**Deps:** none (Q-0117 dist-canonical runtime shipped in v1.4.0 — the compiled `dist/` this design embeds already exists)

UI verdict: skip — no `consumer.uiPaths` configured and no UI-mapped candidate paths; this is packaging/release work with no UI surface.

## Problem

Adoption assumes a TS/JS consumer with Node already present: `pnpm add -D @david.zoufaly/noldor`, `npx noldor`, `engines.node >=20`. A Go, Python or Rust repository cannot adopt the framework at all — there is no artifact it can run. The runtime chain today is `bin/noldor.mjs` → `bin/engines-check.mjs` (Node floor) → `bin/boot.mjs` → `bin/runtime-select.mjs` → `dist/cli/index.js` (or `src` via tsx fallback), and every link assumes a Node interpreter on the consumer machine.

Compiling that chain into one file collides with every place the CLI treats its own package as an on-disk filesystem. Full inventory of package-relative runtime dependence:

**Asset reads** (need a real path):

1. `src/templates/manifest.ts` — walks up from its module path to the package root and **enumerates** `templates/` (a directory walk, not a single-file read). Downstream: `installedFrameworkVersion()` (`src/migrations/pkg-version.ts:13`) reads `package.json` as `TEMPLATES_ROOT/..` — every package.json reader resolves *through* this walk, so fixing the templates root fixes version reads too.
2. `src/dashboard/server.ts:394` — `STATIC_ROOT` = `./static/dist` relative to `import.meta.url` (package-root-relative: `dist/dashboard/static/dist`).
3. `src/cr/codex-adapter.ts:30` — `CR_RECORD_SCHEMA_PATH` resolved module-relatively and handed to the **external** codex process, which must be able to `open()` it — a virtual in-binary path is useless to a child process.

**Self-exec spawns** (need the binary to re-exec itself — under a compiled binary `process.execPath` is the binary, `bin/*.mjs` does not exist on disk, and the binary will not execute a `.mjs` argv):

4. `src/core/noldor-cli.ts:15` — `NOLDOR_BIN` = `bin/noldor.mjs`; `noldorCliCommand()` spawns `[process.execPath, [NOLDOR_BIN, ...args]]`. Callers: `src/garden/garden-detect.ts:665`, `src/garden/garden-detect-runner.ts:108`, `src/release/index.ts:80`, `src/release/preflight-probes.ts:120`.
5. `src/dashboard/ensure.ts:88` — `spawnDetachedServer()` hand-rolls the same launcher (`<moduleDir>/../../bin/noldor.mjs`).
6. `src/autonomous/watch-detach.ts:25` — `binPathFrom()` hand-rolls it again; spawned at `watch-detach.ts:76` for `autonomous watch --detach`.
7. `src/core/agent-runner/runners/stub.ts:11` — `buildStubArgv()` targets a *different* entry, `bin/noldor-stub-gate.mjs`; `doctor-runners.ts` probes it via `process.execPath`.

Favorable ground: all 11 runtime `dependencies` (`@inquirer/prompts`, `dependency-cruiser`, `gray-matter`, `highlight.js`, `marked`, `marked-highlight`, `minimatch`, `semver`, `yaml`, `zod`, `zod-to-json-schema`) are pure JS — no native addons. `typescript` (tsgo) and `@swc/core` are devDependencies and never ship to consumers.

## Goals

- Ship `noldor` as a self-contained executable for darwin/linux × arm64/amd64 — runs with **no Node, npm, pnpm or tsx on the machine**.
- Keep the npm package as the canonical channel: `bin/noldor.mjs` + `dist/` + `templates/` unchanged in behavior for every existing consumer.
- Release automation: a `v*` tag builds all four targets, smoke-tests each **natively**, and attaches binaries + `SHA256SUMS` + license notices to the GitHub release.
- One-line install for non-Node consumers (`curl | sh`), checksum-verified.

## Non-goals

- **Cross-language check adapters.** The checks still hardcode the TS toolchain (`CODE_FILE_RE` in `src/core/repo-paths.ts`, oxlint/oxfmt/vitest/tsc wrappers, dependency-cruiser graphs). On the binary channel, commands that spawn consumer-side JS tooling fail exactly as today when the tool is absent — the ordinary tool-missing error, not a crash. The **minimum toolchain-free workflow** the binary must support in a git-only repository is pinned in Unit 6 (init → validate → queue reads); the full per-command matrix is a documentation task in the plan.
- **Binary-channel unsupported commands (explicit):** `noldor init --adopt` and the template-migration write paths (they write *into* the package templates root, which on this channel is a shared read-only cache — Unit 2 refuses them); the `stub` agent runner (its gate entry `bin/noldor-stub-gate.mjs` is a separate script the binary cannot exec — runner probes report it unavailable).
- Windows targets; musl/Alpine Linux (glibc baseline only, documented).
- Binary-aware hook templates. `templates/lefthook.yml` keeps `pnpm noldor …`; adoption docs gain a manual-swap note (decision O5).
- Homebrew tap / npm platform-packages (esbuild pattern). Deferred until someone asks.
- Auto-update, telemetry, or any installer beyond `install.sh`.

## Design

Compiler decision (O1): **`bun build --compile`**, bundling the already-compiled **`dist/`** ESM output (tsgo compiles first; bun never sees TypeScript). Bun cross-compiles all four targets via `--target`, embeds extra files, and starts faster than a Node boot — the hook-latency goal. The accepted trade-off is Bun-vs-Node semantic drift under the CLI's heavy `spawnSync`/fs use; mitigations: the spike gate below, per-target native smoke, and the npm channel staying canonical.

### Unit 0 — spike gate (plan task 1; everything else depends on it)

Compile `dist/cli/index.js` for the host target and assert, in a temp git fixture: `--version` exits 0; `--help` exits 0; a subcommand that `spawnSync`s `git` succeeds; file embedding round-trips (embed a probe file, read it back at runtime); an `@inquirer/prompts` prompt renders and accepts input under a PTY (`script -q` wrapper — asserted locally at spike time, not in CI). **The spike also records the exact Bun version it verified — that version becomes the pinned floor** (one constant shared by `bin/build-binary.mjs` and the workflow's `bun-version`). **Any failure → stop; fallback decision is Node SEA (re-spec required); no dependent task starts.** This converts O6 from assumption to evidence before the seams are built.

### Unit 1 — asset pack + extractor (`src/binary/asset-pack.ts`)

Assets are **extracted to a version-keyed cache, not served from Bun's virtual FS** (decision O2) — `templates/` is *walked*, and site 3 needs a path an external process can open. Read sites stay untouched; the walk finds a real directory. The extracted tree is treated as **read-only shared state**: nothing on the binary channel may write into it (enforced in Unit 2).

- **Pack contents are derived, not hand-listed:** `templates/**` + `package.json` + the dist projection of every entry in `RUNTIME_ASSETS` (`bin/build-manifest.mjs:17` — the existing fail-closed source of truth from PR #360, covering `cr-record.schema.json`, the CR prompt files, dashboard static bundles, and the canned fixture). A new runtime asset added to `RUNTIME_ASSETS` rides into the pack automatically; the pack builder imports the manifest rather than duplicating it.
- **Pack format (versioned, framed):** magic `NPAK` + `u32le formatVersion (=1)` + `u32le indexLength` + index JSON (UTF-8) + data section. Index: `{ pkgVersion, entries: [{ path, offset, size, mode }] }`; `offset` is relative to the data-section start; `size`/`offset` are non-negative integers ≤ `Number.MAX_SAFE_INTEGER`. Paths: relative POSIX UTF-8; the reader **rejects** absolute paths, `..` segments, duplicates, and overlapping ranges. Regular files only — no symlinks, no empty-dir entries (no current asset needs either). `mode` is either `0o644` or `0o755`; anything else is rejected. Writer and reader live in the same module and are unit-tested as a round-trip.
- **Extractor contract:** `extractAssets(packSource: string | Buffer, dest: string, fsImpl = node:fs)` — a string is a pack file on disk (build script, tests); a Buffer is the embedded pack's bytes handed over by the entry (`Bun.embeddedFiles` exposes bytes, not a filesystem path). `fsImpl` is the defaulted injection seam the tests use. The extractor creates `dest`'s parent before staging its private temp dir. Errors are thrown `Error`s carrying the attempted path (boundary contract; no result-object API).
- **Extraction + replacement protocol:** extract into a private temp dir from `mkdtempSync(dest + '.tmp-')`; write all entries; write completion marker `.noldor-pack-ok` containing the pack's SHA-256; publish with a single `renameSync(temp, dest)`. A cache **hit** requires `dest/.noldor-pack-ok` to exist *and* match the embedded pack's digest. On a **stale/markerless `dest`**: rename it aside to `dest.stale-<pid>` (never `rm` a directory another process may be publishing), rename the fresh temp into place, then best-effort remove the stale dir. If the final rename loses a race (`EEXIST`/`ENOTEMPTY`), re-verify the winner's marker digest — matching digest means another process published the same content: accept it and clean up our temp. **Residual window declared:** two processes can both rename-aside a stale dir; the loser's aside-dir lingers until its best-effort cleanup — litter, never corruption, because `dest` is only ever published by atomic rename and only trusted with a digest-matching marker. No lock file — identity is checked by content digest, not by name ownership.
- **Path resolution (exact equations, shared parser used by both channels):**
  - `NOLDOR_ASSET_ROOT` set → must be an absolute path; used verbatim as the package root; **no extraction at all** (operator asserts the tree exists). Empty or relative → exit 1 naming the variable — validated inside `assetRoot()` itself (`src/binary/asset-root.ts`), so Node-channel misuse fails identically.
  - else `NOLDOR_CACHE_DIR` set → root = `$NOLDOR_CACHE_DIR/<pkgVersion>/pkg` (absolute required, same validation; version key **always** appended — an override must not serve stale assets across upgrades).
  - else darwin → `~/Library/Caches/noldor/<pkgVersion>/pkg`; other platforms → `${XDG_CACHE_HOME:-~/.cache}/noldor/<pkgVersion>/pkg`. Unresolvable `$HOME` with no `XDG_CACHE_HOME` → exit 1.
  - Unwritable cache dir: the extraction failure path above.
- No eviction; old version dirs are litter (documented in gotchas).

### Unit 2 — binary entry (`src/binary/entry.ts`) + version bake

The compile entrypoint, replacing the `bin/noldor.mjs` chain on this channel only:

1. Version is **baked at compile time**: `bun build --define NOLDOR_BINARY_VERSION=<JSON.stringify(pkg.version)>` (JSON-safe serialization is the build script's job). `src/binary/ambient.d.ts` declares `declare const NOLDOR_BINARY_VERSION: string` (plus `declare module '*.pack'`) so strict TS compiles without `bun-types`. The baked value exists because the version-keyed cache path must be computed *before* anything is extracted (chicken-and-egg); after extraction, `installedFrameworkVersion()` and every other `package.json` reader resolve through the templates walk (Problem site 1) against the extracted root — no separate seam.
2. Set `process.env.NOLDOR_BINARY = '1'` — the self-exec channel marker. **Exact contract: the value `'1'`, nothing else, activates binary behavior** (`isBinaryChannel()` helper beside `assetRoot()`); any other value is ignored. Nothing on the npm channel sets it.
3. Resolve the asset root per Unit 1; extract on miss (single stderr line on actual extraction: `noldor: extracted assets to <path>` — the smoke suite's cache-hit oracle); set `NOLDOR_ASSET_ROOT` if unset (an operator-provided value wins and skips extraction).
4. `await import('../cli/index.js')` — the same dist entry `bin/boot.mjs` imports today.

**Write-refusal guard:** `init --adopt` (and any template-migration write path) checks `isBinaryChannel()` and exits 1 with `adopt requires the npm channel — the binary's template root is a shared read-only cache` (`src/cli/commands/init.ts` adopt branch). This closes the cross-repo leak where an adopt snapshot into the shared cache would silently surface in every repo on the machine.

Embedding mechanics (D3): `assets.pack` is built **before** the compile step and passed to bun as an **extra compile input** (`bun build --compile dist/binary/entry.js assets.pack`); at runtime the entry locates it via `Bun.embeddedFiles` and hands its bytes to the extractor. No `.pack` import statement exists in the compiled entry — deliberately, so the dist import-graph audit (`bin/import-graph.mjs`) stays clean and tsgo never sees a non-JS import specifier. The ambient decl file provides the minimal `Bun.embeddedFiles` type; `bun-types` is not a dependency.

**Command-graph bundling (discovered at implementation, now normative):** the CLI router dispatches every subcommand through a *computed* dynamic import (`src/cli/index.ts` `dispatch()`), which a bundler cannot follow — a naive compile ships the router and nothing else. The remedy is a **generated static import table**: `src/binary/command-table.gen.ts` (regenerated by `bin/generate-command-table.mjs`, sync-asserted against `MANIFEST` by a unit test) carries one static thunk per manifest leaf; the entry installs it on `globalThis.__NOLDOR_COMMAND_IMPORTS`, and `dispatch()` consults the table before falling back to the path import. The argv reshape is preserved, so `runIfDirect`-style guards — which match on the argv[1] **suffix**, never on `import.meta.url` — keep working under the single-URL bundle; any remaining `import.meta.url === pathToFileURL(argv[1])` guard in a dispatched module must migrate to `invokedDirectly` (the pre-push hook did). Corollaries: top-level named imports that bun's runtime does not provide (`fs.promises.glob`) hoist into bundle startup and must be lazy in dispatched modules; dead transitive deep-imports (dependency-cruiser's webpack shim) stay `--external`; the detached dashboard child receives its port via argv, not env (env overrides do not reliably cross bun's detached spawn).

### Unit 3 — asset-root seam (three read sites)

A tiny resolver, `assetRoot(): string | null` (`src/binary/asset-root.ts`, validation per Unit 1), consulted **first** by:

- `src/templates/manifest.ts` — template root = `join(assetRoot(), 'templates')` when set; existing walk-up otherwise. (Carries `installedFrameworkVersion()` and all package.json readers with it — Problem site 1.)
- `src/dashboard/server.ts` `STATIC_ROOT` — `join(assetRoot(), 'dist/dashboard/static/dist')` when set (the exact package-root-relative path; the pack stores it under the same path); existing `import.meta.url` resolution otherwise.
- `src/cr/codex-adapter.ts` `CR_RECORD_SCHEMA_PATH` — `join(assetRoot(), 'dist/cr/cr-record.schema.json')` when set; module-relative otherwise. (The schema already rides the pack via `RUNTIME_ASSETS`.)

With the env unset, all three behave byte-identically to today. `NOLDOR_ASSET_ROOT` is honored on both channels by design (that is what makes it testable under Node); the compatibility claim is scoped accordingly: **Node-channel behavior is unchanged when the variable is unset**, and the variable is documented operator surface, not an accident.

### Unit 3b — self-exec seam (three spawn sites + one refusal)

`noldorCliCommand()` (`src/core/noldor-cli.ts`) branches on `isBinaryChannel()`: when true, return `[process.execPath, args]` — the binary re-execs itself directly, no launcher script; otherwise today's `[process.execPath, [NOLDOR_BIN, ...args]]`. The two hand-rolled launchers converge on it:

- `spawnDetachedServer()` (`src/dashboard/ensure.ts:88`) → `noldorCliCommand(['dashboard', 'server'])`.
- `detachChildArgv()` (`src/autonomous/watch-detach.ts:25`) → `noldorCliCommand(['autonomous', 'watch', ...stripDetach(args)])`.

This unblocks `garden detect`, `sdd-report`, release preflight probes, detached dashboard spawn, and `autonomous watch --detach` under the binary. The **stub runner** stays a refusal, not a seam: `buildStubArgv` targets `bin/noldor-stub-gate.mjs`, a separate entry that does not exist on this channel — `doctor-runners`' probe reports the runner unavailable (probe failure is already a handled state), and selecting `stub` errors with the npm-channel pointer.

### Unit 4 — build script (`bin/build-binary.mjs`, `pnpm build:binary`)

1. Guard: `bun` on PATH at ≥ the spike-pinned floor (single exported constant, same value the workflow pins) or exit 1 with an install pointer — bun is an external tool, not a devDependency.
2. Run the existing `bin/build.mjs` (tsgo → `dist/`, stamped).
3. Build `assets.pack` (Unit 1 format) from the derived list.
4. `bun build --compile dist/binary/entry.js --target=<bun target> --define NOLDOR_BINARY_VERSION=<json> --outfile out/<release name>` for the requested target (default: host).

`dist/binary/entry.js` ships in the npm tarball as inert extra files (nothing imports them under Node; the tarball-entry contract snapshot is updated once) — excluding them from `files` would special-case the build for no consumer-visible gain (D9).

### Unit 5 — release workflow (`.github/workflows/release-binaries.yml`)

Separate workflow on the same `push: tags: ['v*']` trigger as `publish.yml` (decision O4). Target/naming table (D10):

| Runner | `--target` | Release asset |
|---|---|---|
| `ubuntu-latest` | `bun-linux-x64` | `noldor-linux-amd64` |
| `ubuntu-24.04-arm` | `bun-linux-arm64` | `noldor-linux-arm64` |
| `macos-13` | `bun-darwin-x64` | `noldor-darwin-amd64` |
| `macos-14` | `bun-darwin-arm64` | `noldor-darwin-arm64` |

Each leg: checkout → pnpm install → `setup-bun` (pinned to the spike-recorded version) → `pnpm build:binary` (host target) → native smoke (Unit 6) → upload artifact. Compatibility floor = the pinned Bun runtime's floor — glibc per `ubuntu-latest`'s baseline (2.35 class), macOS 13+ — recorded in the README table, not re-verified beyond the hosted runners. **`macos-13` retirement fallback (named now):** if GitHub retires hosted Intel runners mid-lifecycle, the darwin-amd64 leg cross-compiles `bun-darwin-x64` on `macos-14` and smokes under Rosetta 2 (`arch -x86_64`).

**Release job** (`needs` all legs, `permissions: contents: write`):

1. Download all artifacts.
2. **Version guard before any release mutation:** normalize the tag (`v` stripped), compare against `package.json` and against **each** downloaded binary's `--version` output (the two natively runnable ones execute; the two foreign-arch ones are compared via their leg's smoke-reported version in the artifact metadata). Any mismatch → fail, no mutation.
3. Generate `SHA256SUMS` + `THIRD_PARTY_NOTICES.txt`. Notices generator: a script over `pnpm licenses list --json --long --prod` (production dependency graph only) plus a static section for the embedded Bun runtime's license; deterministic name-sorted output; a dependency with a missing or unrecognizable license field **fails the build** (fail closed); a unit test asserts every production dependency name appears in the generated file.
4. `gh release create --verify-tag` if absent, then upload with `--clobber`: **binaries first, `SHA256SUMS` + notices last.** `gh release upload` is not transactional — the all-or-nothing guarantee is therefore *sentinel-based, not atomic*: `SHA256SUMS` uploads only after every binary landed, and the installer refuses any release lacking it. A partially-uploaded release is detectable (no sentinel) and recovers by re-running the job (`--clobber` is idempotent). npm publish stays independent — the accepted window where npm is live before binaries exist is the same sentinel-missing state.

### Unit 6 — smoke suite (`scripts/smoke-binary.sh`)

Runs the built binary in a temp git fixture with `PATH` rebuilt to exclude `node`, `npm`, `pnpm`, `bun` (a minimal dir of symlinks to `git`, coreutils, and the binary) and **`NOLDOR_CACHE_DIR` pointed at a fixture-local dir** (isolation from the runner's real cache). Named assertions (D12):

1. `noldor --version` → exit 0, stdout equals `package.json` version.
2. `noldor --help` → exit 0.
3. First run's stderr contains the extraction line (`noldor: extracted assets to …`); the cache marker `.noldor-pack-ok` exists under the fixture cache dir.
4. `noldor init` in the fixture → exit 0; the materialized tree is `diff -r`-identical to a plain `noldor init` run from the npm-channel checkout in a sibling fixture (same command, both channels — the tree-equality oracle). *(`init`, not `init --adopt`: adopt snapshots consumer files INTO the templates root — the reverse direction — and is refused on this channel; the smoke asserts that refusal: `noldor init --adopt` → exit 1, error names the npm channel.)*
5. **Minimum toolchain-free workflow** (the git-only value proposition): in the initialized fixture, `noldor validate features` → exit 0 and `noldor next-priority` → exit 0 or 2 (both legal empty-queue outcomes) — gate/docs/queue machinery running with no JS toolchain present.
6. Any second command's stderr **lacks** the extraction line (cache-hit oracle) and the marker digest is unchanged.
7. `noldor dashboard` (the ensure → **detached self-exec spawn** path, not `dashboard server` directly) with `PORT=<free>` → HTTP 200 from `/` within 10s → detached pid (from the ensure output/pidfile) killed; fixture removed.

Deliberately **not** `noldor doctor` as the oracle: doctor probes consumer-side tools (gh, oxlint, …) that are legitimately absent in the fixture.

### Unit 7 — installer + docs (`install.sh`, README, `docs/noldor/`)

- `install.sh` at repo root, served from `https://raw.githubusercontent.com/davidzoufaly/noldor/main/install.sh`. POSIX sh. Contract (D14):
  - Map `uname -s`/`uname -m` (`x86_64`→`amd64`, `aarch64`/`arm64`→`arm64`; anything else → exit 1 "unsupported").
  - Version = `$NOLDOR_VERSION` (accepts `v1.5.0` or `1.5.0`, normalizes to the `v` tag), default `latest`.
  - Require `curl` and `sha256sum` **or** `shasum -a 256` (exit 1 naming the missing tool).
  - Download the platform binary + `SHA256SUMS`; **missing `SHA256SUMS` = incomplete release** (the Unit 5 sentinel) → exit 1 advising retry or version pin.
  - Verify: select exactly the one `SHA256SUMS` line whose filename matches the downloaded asset (duplicate or absent line → exit 1); compare digests.
  - Install atomically: stage the download in a temp file **in the destination directory** (`mkdir -p "${NOLDOR_INSTALL_DIR:-$HOME/.local/bin}"` first), `chmod 0755` the staged file, then `mv -f` over any existing binary — same-filesystem rename, the existing installation survives every pre-publish failure.
  - Warn when the install dir is not on `PATH`; remove partial downloads on any failure.
  - Pinned invocation documented as `curl -fsSL … | NOLDOR_VERSION=v1.5.0 sh` (env on the consumer side of the pipe — the `VAR=… curl | sh` form sets it on curl and is wrong).
- README distribution section: binary channel beside the npm channel, target/floor table, the "not sufficient for cross-language adoption on its own" caveat stated plainly, the binary-channel unsupported list (adopt, stub runner).
- Adoption/hooks doc note (O5): pointing lefthook at the binary manually for faster hooks.
- `docs/noldor/gotchas.md`: cache-dir litter across versions; `NOLDOR_CACHE_DIR` / `NOLDOR_ASSET_ROOT` / `NOLDOR_BINARY` semantics.

### Data flow

```
tag v* ──► publish.yml (npm, unchanged, independent)
      └──► release-binaries.yml
             4 legs: build.mjs ──► dist/ ──► assets.pack ──► bun compile ──► native smoke ──► artifact
             release job (all legs green): version guard ──► SHA256SUMS + notices ──► create? ──► upload (binaries, sentinel last)

consumer:  install.sh ──► sentinel + sha256 verify ──► staged chmod+mv ──► ~/.local/bin/noldor
first run: baked version ──► cache path ──► extract embedded pack (tmp+rename, digest marker) ──► NOLDOR_ASSET_ROOT ──► dist CLI
self-exec: NOLDOR_BINARY='1' ──► noldorCliCommand → [execPath, args] ──► same binary
```

### Error handling

- `bun` absent/below floor at build: exit 1, named remediation. Never auto-install.
- Pack reader rejects malformed/unsafe packs (bad magic, version, bounds, paths, modes) with a named reason — fail closed.
- Extraction failure: exit 1 with attempted path; temp dir removed best-effort; no partial `dest` ever visible (rename is the only publish; stale dirs renamed aside, never rm'd in place).
- Binary-channel write paths into the shared cache (`init --adopt`, template migration): exit 1 naming the npm channel.
- `install.sh`: checksum mismatch, duplicate/missing checksum line, missing tool, or missing sentinel → abort loudly, nothing installed or replaced, partials removed.
- Smoke failure on any leg fails the workflow — no assets uploaded.

### Testing

- Unit: pack writer/reader round-trip (framing, bounds, rejection table, mode preservation); extractor (marker digest, stale-dir aside-replace, rename-race acceptance via digest re-verify, injected `fsImpl` failures); path equations per env/platform matrix (including version-key-under-override and absolute-path validation); `noldorCliCommand` both channels (`NOLDOR_BINARY='1'` vs unset vs `'0'`); `assetRoot` seam sites env set/unset; adopt-refusal guard; notices generator (fail-closed on missing license, all prod deps present).
- Existing suites prove the inert path: full suite + `test:contract` green with nothing set (tarball snapshot updated once for the inert `dist/binary/*` entries).
- CI native smoke per target (Unit 6) is the integration oracle for the binary; vitest never executes under Bun.

## Acceptance criteria

1. `pnpm build:binary` with bun ≥ floor produces a runnable host-target binary; without bun (or below floor) it exits non-zero naming the tool and floor.
2. The smoke suite passes on a fixture whose `PATH` excludes node/npm/pnpm/bun, exactly as itemized in Unit 6 — including the extraction-line oracle, the `init --adopt` refusal, and the minimum toolchain-free workflow (`validate features`, `next-priority`).
3. First run extracts to the version-keyed cache dir and writes the digest marker; a second run performs no extraction; a stale or markerless cache dir is renamed aside and re-extracted, never trusted and never `rm`'d in place.
4. `noldor init` from the binary produces a tree `diff -r`-identical to the npm channel's in a sibling fixture.
5. Self-exec paths work under the binary: `noldor dashboard` (ensure → detached spawn) serves HTTP 200, and a `noldorCliCommand`-spawned subcommand (e.g. `garden detect`) exits 0 in a docs-bearing fixture; `autonomous watch --detach` spawns through the same seam (unit-covered).
6. With `NOLDOR_ASSET_ROOT` unset, all seam sites resolve exactly as today; the full existing test suite and `test:contract` stay green (one recorded tarball-snapshot update for inert `dist/binary/*` entries).
7. Pack reader rejects each malformed-pack class (bad magic/version, out-of-bounds, absolute or `..` path, duplicate, overlap, symlink-mode, disallowed mode) with a named error — covered by unit tests.
8. A `v*` tag builds all four targets per the naming table, each smoke-tested natively; the release carries four binaries + `SHA256SUMS` + `THIRD_PARTY_NOTICES.txt`, with the sentinel uploaded last; a re-run after partial upload converges (`--clobber` idempotent).
9. The release job's version guard blocks any release mutation when tag, `package.json`, or any built binary's reported version disagree.
10. `install.sh` on darwin-arm64 and linux-amd64 installs the checksum-verified matching binary (dir created, mode 0755, atomic same-dir rename) and `noldor --version` succeeds; checksum mismatch, duplicate checksum line, unsupported platform, and missing-sentinel cases abort with the prior installation intact (CI-covered on the two native-runner platforms; the platform-mapping function is covered for all four).
11. `NOLDOR_CACHE_DIR` override still gets the version key appended; `NOLDOR_ASSET_ROOT` set skips extraction and must be absolute (relative/empty exits 1 on both channels) — asserted by tests.
12. The notices file lists every production dependency plus the Bun runtime; a missing/unknown license fails the build.

## Risks / trade-offs

- **Bun-vs-Node semantic drift** (spawnSync, fs edge cases, inquirer TTY) — the core accepted risk of O1. Mitigations: the Unit 0 spike gate with named pass criteria and a Node-SEA fallback decision, `dist/`-only bundling, native smoke per target, npm channel canonical. Residual: drift in commands the smoke sweep doesn't exercise surfaces in the field.
- **Binary size** (~60–100MB × 4 per release). Accepted: GH release assets are free; one download per consumer.
- **`ubuntu-24.04-arm` runner availability** — occasionally queue-constrained; a slow leg delays release assets, never npm publish. `macos-13` retirement has a named fallback (Unit 5).
- **npm-before-binaries window** — workflows independent by design; the sentinel-missing state makes it detectable and the installer fails loudly.
- **Extraction race residual** — concurrent replacements can strand a `dest.stale-<pid>` dir until best-effort cleanup; litter, never corruption (digest-verified publish only).
- **Cache litter** across versions (no eviction). Documented.
- **Bun as an external pinned tool** — the spike-recorded pin is a single constant shared by build script and CI; releases reproducible while local dev floats.

## User Story

As an operator of a non-Node repository (Go, Python, Rust), I want to install noldor as a single self-contained binary, so that I can adopt the framework's gate/docs/queue discipline without Node, pnpm, or any JS toolchain on my machine.

## Usage

```sh
# non-Node consumer install (checksum-verified, ~/.local/bin)
curl -fsSL https://raw.githubusercontent.com/davidzoufaly/noldor/main/install.sh | sh
noldor --version

# pin a version (env applies to the shell, not curl)
curl -fsSL https://raw.githubusercontent.com/davidzoufaly/noldor/main/install.sh | NOLDOR_VERSION=v1.5.0 sh

# maintainer: build a host-target binary locally (requires bun)
pnpm build:binary

# overrides
NOLDOR_CACHE_DIR=/tmp/noldor-cache noldor init   # version key still appended under the override
NOLDOR_ASSET_ROOT=/path/to/pkg noldor dashboard  # pre-extracted tree, no extraction (absolute path required)
```

Node consumers: nothing changes — `pnpm add -D @david.zoufaly/noldor` + `npx noldor` remain the primary channel. Optional: point lefthook commands at the installed binary for faster hook startup (documented manual swap).

## Open questions (resolved)

1. *Does bun compile the ESM `dist/` (top-level `await`, `import.meta.url`, file embedding, subprocess, TTY prompts) correctly?* → **Unit 0 spike gate with named pass criteria runs first and records the verified Bun version as the pin; any failure stops the feature and falls back to a Node-SEA re-spec.** Assumption converted to a gating task rather than carried silently (D-O6).
2. *Cache directory convention?* → **`NOLDOR_ASSET_ROOT` (verbatim absolute, no extraction) → `NOLDOR_CACHE_DIR/<version>/pkg` → platform default, exact equations in Unit 1.** Version key always appended under overrides so upgrades never serve stale assets (D-O7, D18).
3. *Archive format?* → **Versioned framed blob (magic + index-length header) with a normative rejection table.** No tar builtin exists; a dependency is heavier than ~60 lines of framing code; format is write-once/read-once by the same module (D4).
4. *Why not `noldor doctor` as the smoke oracle?* → **Doctor probes consumer-side tools legitimately absent in a minimal fixture; the smoke suite asserts self-containment with named commands instead (Unit 6).**
5. *Full TypeScript signatures for `extractAssets` in the spec?* → **The behavioral contract is pinned (signature shape with defaulted `fsImpl`, thrown-`Error`-with-path boundary); exhaustive types remain the implementation's job (D8).**
6. *Per-command support matrix for the binary channel?* → **The minimum toolchain-free workflow is pinned in Unit 6 and smoke-covered; the full matrix is a docs task.** The matrix would restate "does it spawn consumer JS tooling?" per command — a doc table, not a design decision (D11).
7. *`init --adopt` on the binary channel?* → **Refused with a named error (Unit 2).** Adopt writes consumer snapshots *into* the package templates root; on this channel that root is a shared version-keyed cache, and a write there would leak one repo's snapshot into every repo on the machine. The npm channel keeps adopt.
