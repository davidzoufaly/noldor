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

1. `src/templates/manifest.ts` — walks up from its module path to the package root and **enumerates** `templates/` (a directory walk, not a single-file read).
2. `src/dashboard/server.ts:394` — `STATIC_ROOT` = `./static/dist` relative to `import.meta.url`.
3. `src/cr/codex-adapter.ts:30` — `CR_RECORD_SCHEMA_PATH` resolved module-relatively and handed to the **external** codex process, which must be able to `open()` it — a virtual in-binary path is useless to a child process.
4. `src/core/noldor-cli.ts:15` — `NOLDOR_BIN` points at `bin/noldor.mjs`; `noldorCliCommand()` spawns `[process.execPath, [NOLDOR_BIN, ...args]]`. Callers: `src/garden/garden-detect.ts:665`, `src/garden/garden-detect-runner.ts:108`, `src/release/index.ts:80`, `src/release/preflight-probes.ts:120`.
5. `src/dashboard/ensure.ts:88` — `spawnDetachedServer()` hand-rolls the same launcher: `spawn(process.execPath, ['<moduleDir>/../../bin/noldor.mjs', 'dashboard', 'server'])`.
6. Version identity — `--version` and README-staleness paths read the package's `package.json`.

Sites 4–5 are **self-exec**, not asset reads: under a compiled binary `process.execPath` is the binary itself, `bin/noldor.mjs` does not exist on disk, and the binary will not execute a `.mjs` argv — so `noldor dashboard`, `garden detect`, and release preflight would all break if only the asset reads were fixed.

Favorable ground: all 11 runtime `dependencies` (`@inquirer/prompts`, `dependency-cruiser`, `gray-matter`, `highlight.js`, `marked`, `marked-highlight`, `minimatch`, `semver`, `yaml`, `zod`, `zod-to-json-schema`) are pure JS — no native addons. `typescript` (tsgo) and `@swc/core` are devDependencies and never ship to consumers.

## Goals

- Ship `noldor` as a self-contained executable for darwin/linux × arm64/amd64 — runs with **no Node, npm, pnpm or tsx on the machine**.
- Keep the npm package as the canonical channel: `bin/noldor.mjs` + `dist/` + `templates/` unchanged in behavior for every existing consumer.
- Release automation: a `v*` tag builds all four targets, smoke-tests each **natively**, and attaches binaries + `SHA256SUMS` + license notices to the GitHub release.
- One-line install for non-Node consumers (`curl | sh`), checksum-verified.

## Non-goals

- **Cross-language check adapters.** The checks still hardcode the TS toolchain (`CODE_FILE_RE` in `src/core/repo-paths.ts`, oxlint/oxfmt/vitest/tsc wrappers, dependency-cruiser graphs). On the binary channel, commands that spawn consumer-side JS tooling fail exactly as they do today when the tool is absent — with the tool-missing error, not a crash. A per-command support matrix is a documentation task in the plan, not a spec artifact; the boundary rule is: everything runs except what shells out to a toolchain the consumer doesn't have.
- Windows targets; musl/Alpine Linux (glibc baseline only, documented).
- Binary-aware hook templates. `templates/lefthook.yml` keeps `pnpm noldor …`; adoption docs gain a manual-swap note (decision O5).
- Homebrew tap / npm platform-packages (esbuild pattern). Deferred until someone asks.
- Auto-update, telemetry, or any installer beyond `install.sh`.

## Design

Compiler decision (O1): **`bun build --compile`**, bundling the already-compiled **`dist/`** ESM output (tsgo compiles first; bun never sees TypeScript). Bun cross-compiles all four targets via `--target`, embeds extra files, and starts faster than a Node boot — the hook-latency goal. The accepted trade-off is Bun-vs-Node semantic drift under the CLI's heavy `spawnSync`/fs use; mitigations: the spike gate below, per-target native smoke, and the npm channel staying canonical.

### Unit 0 — spike gate (plan task 1; everything else depends on it)

Compile `dist/cli/index.js` for the host target and assert, in a temp git fixture: `--version` exits 0; `--help` exits 0; a subcommand that `spawnSync`s `git` succeeds; `assets.pack`-style file embedding round-trips (embed a probe file, read it back at runtime); an `@inquirer/prompts` prompt renders and accepts input under a PTY (`script -q` wrapper — asserted locally at spike time, not in CI). **Any failure → stop; fallback decision is Node SEA (re-spec required); no dependent task starts.** This converts O6 from assumption to evidence before the seams are built.

### Unit 1 — asset pack + extractor (`src/binary/asset-pack.ts`)

Assets are **extracted to a version-keyed cache, not served from Bun's virtual FS** (decision O2) — `templates/` is *walked*, and site 3 needs a path an external process can open. Read sites stay untouched; the walk finds a real directory.

- **Pack contents are derived, not hand-listed:** `templates/**` + `package.json` + the dist projection of every entry in `RUNTIME_ASSETS` (`bin/build-manifest.mjs:17` — the existing fail-closed source of truth from PR #360, covering `cr-record.schema.json`, the CR prompt files, dashboard static bundles, and the canned fixture). A new runtime asset added to `RUNTIME_ASSETS` rides into the pack automatically; the pack builder imports the manifest rather than duplicating it.
- **Pack format (versioned, framed):** magic `NPAK` + `u32le formatVersion (=1)` + `u32le indexLength` + index JSON (UTF-8) + data section. Index: `{ pkgVersion, entries: [{ path, offset, size, mode }] }`; `offset` is relative to the data-section start; `size`/`offset` are non-negative integers ≤ `Number.MAX_SAFE_INTEGER`. Paths: relative POSIX UTF-8; the reader **rejects** absolute paths, `..` segments, duplicates, and overlapping ranges. Regular files only — no symlinks, no empty-dir entries (no current asset needs either). `mode` is either `0o644` or `0o755`; anything else is rejected. Writer and reader live in the same module and are unit-tested as a round-trip.
- **Extractor:** `extractAssets(pack, dest)` — creates a private sibling temp dir via `mkdtempSync(dest + '.tmp-')`, writes all entries, writes a completion marker `.noldor-pack-ok` containing the pack's SHA-256, then one `renameSync` to `dest`. A cache **hit** requires `dest/.noldor-pack-ok` to exist *and* match the embedded pack's digest — a bare directory (stale, corrupt, pre-created) is treated as a miss and re-extracted to a fresh temp dir, followed by best-effort replace (`rm` + `rename`; on `EEXIST`/`ENOTEMPTY` race, re-verify the marker and accept the winner). Failures (ENOSPC, perms) remove the temp dir best-effort and exit 1 naming the attempted path. Errors are thrown `Error`s with path context (boundary contract); the fs surface is a defaulted parameter for test injection.
- **Path resolution (exact equations):**
  - `NOLDOR_ASSET_ROOT` set → use verbatim as the package root; **no extraction at all** (operator asserts the tree exists).
  - else `NOLDOR_CACHE_DIR` set → root = `$NOLDOR_CACHE_DIR/<pkgVersion>/pkg` (version key **always** appended — an override must not serve stale assets across upgrades).
  - else darwin → `~/Library/Caches/noldor/<pkgVersion>/pkg`; other platforms → `${XDG_CACHE_HOME:-~/.cache}/noldor/<pkgVersion>/pkg`.
  - Empty or relative `NOLDOR_ASSET_ROOT`/`NOLDOR_CACHE_DIR`, or unresolvable `$HOME` with no `XDG_CACHE_HOME`: exit 1 with the offending variable named. Unwritable cache dir: the extraction failure path above.
- No eviction; old version dirs are litter (documented in gotchas).

### Unit 2 — binary entry (`src/binary/entry.ts`) + version bake

The compile entrypoint, replacing the `bin/noldor.mjs` chain on this channel only:

1. Version is **baked at compile time** via `bun build --define 'NOLDOR_BINARY_VERSION="<pkg.version>"'` — it must be known *before* the version-keyed cache path is computed, so it cannot come from the extracted `package.json` (chicken-and-egg). The extracted `package.json` still serves any code path that reads version/metadata from the package root at runtime.
2. Set `process.env.NOLDOR_BINARY = '1'` (self-exec channel marker, Unit 3b).
3. Resolve the asset root per Unit 1; extract on miss; set `NOLDOR_ASSET_ROOT` if unset (an operator-provided value wins and skips extraction).
4. `await import('../cli/index.js')` — the same dist entry `bin/boot.mjs` imports today.

Embedding mechanics (D3): `assets.pack` is built **before** the compile step and imported by the entry as `import packPath from '../../assets.pack' with { type: 'file' }` — bun bundles the file into the binary and the import resolves to its embedded path at runtime, readable via `Bun.file`/`node:fs`. TypeScript-side: a small ambient declaration file `src/binary/ambient.d.ts` (`declare module '*.pack'`; minimal `Bun` global if needed) — `bun-types` is not added as a dependency. Under tsgo the entry compiles to `dist/binary/entry.js`; the `.pack` import specifier survives verbatim for bun to resolve at bundle time.

### Unit 3 — asset-root seam (three read sites)

A tiny resolver, `assetRoot(): string | null` (reads `NOLDOR_ASSET_ROOT`), consulted **first** by:

- `src/templates/manifest.ts` — template root = `join(assetRoot(), 'templates')` when set; existing walk-up otherwise.
- `src/dashboard/server.ts` `STATIC_ROOT` — `join(assetRoot(), <dist static path>)` when set; existing `import.meta.url` resolution otherwise.
- `src/cr/codex-adapter.ts` `CR_RECORD_SCHEMA_PATH` — `join(assetRoot(), 'dist/cr/cr-record.schema.json')` when set; module-relative otherwise. (The schema already rides the pack via `RUNTIME_ASSETS`.)

With the env unset, all three behave byte-identically to today. `NOLDOR_ASSET_ROOT` is honored on both channels by design (that is what makes it testable under Node); the compatibility claim is scoped accordingly: **Node-channel behavior is unchanged when the variable is unset**, and the variable is documented operator surface, not an accident.

### Unit 3b — self-exec seam (two spawn sites)

`noldorCliCommand()` (`src/core/noldor-cli.ts`) branches on `NOLDOR_BINARY`: when set, return `[process.execPath, args]` — the binary re-execs itself directly, no launcher script; otherwise today's `[process.execPath, [NOLDOR_BIN, ...args]]`. `spawnDetachedServer()` (`src/dashboard/ensure.ts:88`) drops its hand-rolled launcher and calls `noldorCliCommand(['dashboard', 'server'])` — one seam, and the duplicate launcher construction goes away. This unblocks `garden detect`, `sdd-report`, release preflight probes, and detached dashboard spawn under the binary.

### Unit 4 — build script (`bin/build-binary.mjs`, `pnpm build:binary`)

1. Guard: `bun` on PATH at ≥ the pinned minimum (single constant in this script, same version CI pins) or exit 1 with an install pointer — bun is an external tool, not a devDependency.
2. Run the existing `bin/build.mjs` (tsgo → `dist/`, stamped).
3. Build `assets.pack` (Unit 1 format) from the derived list.
4. `bun build --compile dist/binary/entry.js --target=<bun target> --define NOLDOR_BINARY_VERSION=… --outfile out/<release name>` for the requested target (default: host).

`dist/binary/entry.js` ships in the npm tarball as inert extra files (nothing imports them under Node; the tarball-entry contract snapshot is updated once) — excluding them from `files` would special-case the build for no consumer-visible gain (D9).

### Unit 5 — release workflow (`.github/workflows/release-binaries.yml`)

Separate workflow on the same `push: tags: ['v*']` trigger as `publish.yml` (decision O4). Target/naming table (D10):

| Runner | `--target` | Release asset |
|---|---|---|
| `ubuntu-latest` | `bun-linux-x64` | `noldor-linux-amd64` |
| `ubuntu-24.04-arm` | `bun-linux-arm64` | `noldor-linux-arm64` |
| `macos-13` | `bun-darwin-x64` | `noldor-darwin-amd64` |
| `macos-14` | `bun-darwin-arm64` | `noldor-darwin-arm64` |

Each leg: checkout → pnpm install → `setup-bun` (pinned `bun-version`) → `pnpm build:binary` (host target) → native smoke (Unit 6) → upload artifact. Compatibility floor = the pinned Bun runtime's floor (glibc baseline linux, macOS 13+); recorded in the README table, not re-verified beyond the hosted runners.

**Release job** (`needs` all legs, `permissions: contents: write`): download artifacts → generate `SHA256SUMS` + `THIRD_PARTY_NOTICES.txt` (generated from the production dependency tree at build; includes Bun's license — D15) → `gh release create --verify-tag` if absent, then `gh release upload --clobber` all assets. Semantics (D13): `--clobber` makes re-runs idempotent; assets upload only after **all** legs pass, so the asset set is all-or-nothing per run; npm publish stays independent — the accepted window where npm is live before binaries exist is handled by the installer failing loudly (below), never by blocking npm on the binary matrix.

### Unit 6 — smoke suite (`scripts/smoke-binary.sh`)

Runs the built binary in a temp git fixture with `PATH` rebuilt to exclude `node`, `npm`, `pnpm`, `bun` (a minimal dir of symlinks to `git`, coreutils, and the binary). Named assertions (D12):

1. `noldor --version` → exit 0, stdout equals `package.json` version.
2. `noldor --help` → exit 0.
3. `noldor init --adopt` in the fixture → exit 0; extracted-template materialization verified by `diff -r` of the fixture result against the same command run from the npm-channel checkout (tree equality oracle).
4. Re-run any command → the extraction path is not re-entered (assert via `NOLDOR_RUNTIME_TRACE`-style marker: extraction logs a line on first run only; second run's stderr lacks it) and the cache marker file is present.
5. `noldor dashboard server` with `PORT=<free>` in background → HTTP 200 from `/` within 10s (static root + self-exec proof) → process killed, fixture removed.

Deliberately **not** `noldor doctor` as the oracle: doctor probes consumer-side tools (gh, oxlint, …) that are legitimately absent in the fixture.

### Unit 7 — installer + docs (`install.sh`, README, `docs/noldor/`)

- `install.sh` at repo root, served from `https://raw.githubusercontent.com/davidzoufaly/noldor/main/install.sh`. POSIX sh. Contract (D14): map `uname -s`/`uname -m` (`x86_64`→`amd64`, `aarch64`/`arm64`→`arm64`; anything else → exit 1 "unsupported"); version = `$NOLDOR_VERSION` (accepts `v1.5.0` or `1.5.0`, normalizes to the `v` tag) defaulting to `latest`; download binary + `SHA256SUMS` from `https://github.com/davidzoufaly/noldor/releases/…`; **require** `sha256sum` or `shasum -a 256` (exit 1 naming the missing tool); verify before install; install atomically (`mv` of a completed download) to `${NOLDOR_INSTALL_DIR:-$HOME/.local/bin}/noldor`, replacing any existing file; warn when the dir is not on `PATH`; missing assets on the release (npm-before-binaries window) → exit 1 telling the user to retry or pin a version; cleanup of partial downloads on any failure. Pinned invocation is documented as `curl -fsSL … | NOLDOR_VERSION=v1.5.0 sh` (env on the consumer side of the pipe — the earlier `VAR=… curl | sh` form set it on curl and is wrong).
- README distribution section: binary channel beside the npm channel, target/floor table, the "not sufficient for cross-language adoption on its own" caveat stated plainly.
- Adoption/hooks doc note (O5): pointing lefthook at the binary manually for faster hooks.
- `docs/noldor/gotchas.md`: cache-dir litter across versions; `NOLDOR_CACHE_DIR` / `NOLDOR_ASSET_ROOT` / `NOLDOR_BINARY` semantics.

### Data flow

```
tag v* ──► publish.yml (npm, unchanged, independent)
      └──► release-binaries.yml
             4 legs: build.mjs ──► dist/ ──► assets.pack ──► bun compile ──► native smoke ──► artifact
             release job (all legs green): SHA256SUMS + notices ──► gh release create? ──► upload --clobber

consumer:  install.sh ──► sha256 verify ──► ~/.local/bin/noldor
first run: baked version ──► cache path ──► extract embedded pack (tmp+rename, marker) ──► NOLDOR_ASSET_ROOT ──► dist CLI
self-exec: NOLDOR_BINARY=1 ──► noldorCliCommand → [execPath, args] ──► same binary
```

### Error handling

- `bun` absent/below floor at build: exit 1, named remediation. Never auto-install.
- Pack reader rejects malformed/unsafe packs (bad magic, version, bounds, paths, modes) with a named reason — fail closed.
- Extraction failure: exit 1 with attempted path; temp dir removed best-effort; no partial `dest` ever visible (rename is the only publish).
- `install.sh`: checksum mismatch or missing tool/asset → abort loudly, nothing installed, partials removed.
- Smoke failure on any leg fails the workflow — no assets uploaded.

### Testing

- Unit: pack writer/reader round-trip (framing, bounds, rejection table, mode preservation); extractor (marker digest, stale-dir re-extract, rename race acceptance, injected fs failures via the defaulted fs parameter); path equations per env/platform matrix; `noldorCliCommand` both channels; `assetRoot` seam sites env set/unset.
- Existing suites prove the inert path: full suite + `test:contract` green with nothing set (tarball snapshot updated once for the inert `dist/binary/*` entries).
- CI native smoke per target (Unit 6) is the integration oracle for the binary; vitest never executes under Bun.

## Acceptance criteria

1. `pnpm build:binary` with bun ≥ floor produces a runnable host-target binary; without bun (or below floor) it exits non-zero naming the tool and floor.
2. The smoke suite passes in a fixture whose `PATH` excludes node/npm/pnpm/bun: `--version` (exit 0, exact version), `--help`, `init --adopt`, cache-hit second run, dashboard HTTP 200 — each as specified in Unit 6.
3. First run extracts to the version-keyed cache dir and writes the digest marker; a second run performs no extraction; a stale or markerless cache dir is re-extracted, not trusted.
4. `noldor init --adopt` from the binary produces a template tree `diff -r`-identical to the npm channel's.
5. Self-exec paths work under the binary: `noldor dashboard` (ensure → detached spawn) serves HTTP 200, and a `noldorCliCommand`-spawned subcommand (e.g. `garden detect`) exits 0 in a docs-bearing fixture.
6. With `NOLDOR_ASSET_ROOT` unset, all seam sites resolve exactly as today; the full existing test suite and `test:contract` stay green (one recorded tarball-snapshot update for inert `dist/binary/*` entries).
7. Pack reader rejects each malformed-pack class (bad magic/version, out-of-bounds, absolute or `..` path, duplicate, overlap, symlink-mode, disallowed mode) with a named error — covered by unit tests.
8. A `v*` tag builds all four targets per the naming table, each smoke-tested natively; the release carries four binaries + `SHA256SUMS` + `THIRD_PARTY_NOTICES.txt`; any leg's failure blocks all uploads; a re-run is idempotent.
9. The workflow refuses to upload when tag, `package.json` version, and the built binary's `--version` output disagree.
10. `install.sh` on darwin-arm64 and linux-amd64 installs the checksum-verified matching binary and `noldor --version` succeeds; checksum mismatch, unsupported platform, and missing-asset cases abort with nothing installed (CI-covered for the two native-runner platforms; the mapping function itself is covered for all four).
11. `NOLDOR_CACHE_DIR` override still gets the version key appended (asserted by test); `NOLDOR_ASSET_ROOT` set skips extraction entirely and is used verbatim.
12. FD `docs/features/single-static-binary-distribution.md` Summary reflects shipped-Q-0117 reality (no "blocked-by"/"park" language) before implementation starts.

## Risks / trade-offs

- **Bun-vs-Node semantic drift** (spawnSync, fs edge cases, inquirer TTY) — the core accepted risk of O1. Mitigations: the Unit 0 spike gate with named pass criteria and a Node-SEA fallback decision, `dist/`-only bundling, native smoke per target, npm channel canonical. Residual: drift in commands the smoke sweep doesn't exercise surfaces in the field.
- **Binary size** (~60–100MB × 4 per release). Accepted: GH release assets are free; one download per consumer.
- **`ubuntu-24.04-arm` runner availability** — occasionally queue-constrained; a slow leg delays release assets, never npm publish.
- **npm-before-binaries window** — the two workflows are independent by design; the installer fails loudly on missing assets rather than the release process serializing on the slowest matrix leg.
- **Cache litter** across versions (no eviction). Documented.
- **Bun as an external pinned tool** — one floor constant + pinned CI version keeps releases reproducible while local dev floats.

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
NOLDOR_ASSET_ROOT=/path/to/pkg noldor dashboard  # pre-extracted tree, no extraction
```

Node consumers: nothing changes — `pnpm add -D @david.zoufaly/noldor` + `npx noldor` remain the primary channel. Optional: point lefthook commands at the installed binary for faster hook startup (documented manual swap).

## Open questions (resolved)

1. *Does bun compile the ESM `dist/` (top-level `await`, `import.meta.url`, file embedding, subprocess, TTY prompts) correctly?* → **Unit 0 spike gate with named pass criteria runs first; any failure stops the feature and falls back to a Node-SEA re-spec.** Assumption converted to a gating task rather than carried silently (D-O6).
2. *Cache directory convention?* → **`NOLDOR_ASSET_ROOT` (verbatim, no extraction) → `NOLDOR_CACHE_DIR/<version>/pkg` → platform default (`~/Library/Caches` darwin, `$XDG_CACHE_HOME`/`~/.cache` elsewhere), exact equations in Unit 1.** Version key always appended under overrides so upgrades never serve stale assets (D-O7, D18).
3. *Archive format?* → **Versioned framed blob (magic + index-length header) with a normative rejection table.** No tar builtin exists; a dependency is heavier than ~60 lines of framing code; format is write-once/read-once by the same module (D4).
4. *Why not `noldor doctor` as the smoke oracle?* → **Doctor probes consumer-side tools legitimately absent in a minimal fixture; the smoke suite asserts self-containment with named commands instead (Unit 6).**
5. *Full TypeScript signatures for `extractAssets` in the spec?* → **No — rejected as plan-level detail.** The spec pins the behavioral contract (thrown `Error` with path context, defaulted-parameter fs injection for tests); exact types are the implementation's job (D8).
6. *Per-command support matrix for the binary channel?* → **Deferred to the docs task; the boundary rule lives in Non-goals.** The matrix would restate "does it spawn consumer JS tooling?" per command — a doc table, not a design decision (D11).
