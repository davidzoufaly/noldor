# Single Static Binary Distribution — Design

**Slug:** single-static-binary-distribution
**FD:** docs/features/single-static-binary-distribution.md
**Date:** 2026-08-21
**Tier:** full
**Deps:** none (Q-0117 dist-canonical runtime shipped in v1.4.0 — the compiled `dist/` this design embeds already exists)

UI verdict: skip — no `consumer.uiPaths` configured and no UI-mapped candidate paths; this is packaging/release work with no UI surface.

## Problem

Adoption assumes a TS/JS consumer with Node already present: `pnpm add -D @david.zoufaly/noldor`, `npx noldor`, `engines.node >=20`. A Go, Python or Rust repository cannot adopt the framework at all — there is no artifact it can run. The runtime chain today is `bin/noldor.mjs` → `bin/engines-check.mjs` (Node floor) → `bin/boot.mjs` → `bin/runtime-select.mjs` → `dist/cli/index.js` (or `src` via tsx fallback), and every link assumes a Node interpreter on the consumer machine.

Two package-root filesystem reads make the CLI non-relocatable into a single file today:

- `src/templates/manifest.ts` walks up from its own module path to the package root and enumerates `templates/` (a real directory walk, not a single-file read).
- `src/dashboard/server.ts:394` resolves `STATIC_ROOT` as `./static/dist` relative to `import.meta.url`; `src/dashboard/ensure.ts:92` resolves its module directory the same way.

Everything else is favorable: all 11 runtime `dependencies` (`@inquirer/prompts`, `dependency-cruiser`, `gray-matter`, `highlight.js`, `marked`, `marked-highlight`, `minimatch`, `semver`, `yaml`, `zod`, `zod-to-json-schema`) are pure JS — no native addons. `typescript` (tsgo) and `@swc/core` are devDependencies and never ship to consumers.

## Goals

- Ship `noldor` as a self-contained executable for darwin/linux × arm64/amd64 — runs with **no Node, npm, pnpm or tsx on the machine**.
- Keep the npm package exactly as it is: `bin/noldor.mjs` + `dist/` + `templates/` remains the canonical channel for Node consumers; nothing in the existing runtime-select machinery changes behavior.
- Release automation: a `v*` tag builds all four targets, smoke-tests each **natively**, and attaches binaries + `SHA256SUMS` to the GitHub release.
- One-line install for non-Node consumers (`curl | sh`), checksum-verified.

## Non-goals

- **Cross-language check adapters.** The checks still hardcode the TS toolchain (`CODE_FILE_RE` in `src/core/repo-paths.ts`, oxlint/oxfmt/vitest/tsc wrappers, dependency-cruiser graphs). A non-TS consumer gets the gate/docs/queue machinery, not language checks. Separate, larger prerequisite — stays parked.
- Windows targets. Matrix is darwin/linux × arm64/amd64 per the roadmap entry.
- Binary-aware hook templates. `templates/lefthook.yml` keeps `pnpm noldor …`; adoption docs gain a manual-swap note (decision O5).
- Homebrew tap / npm platform-packages (esbuild pattern). Deferred until someone asks.
- Auto-update, telemetry, or any installer beyond `install.sh`.

## Design

Compiler decision (O1): **`bun build --compile`**, bundling the already-compiled **`dist/`** ESM output (tsgo compiles first; bun never sees TypeScript). Bun cross-compiles all four targets from one machine via `--target=bun-<os>-<arch>`, embeds extra files, and starts faster than a Node boot — the hook-latency goal. The accepted trade-off is Bun-vs-Node semantic drift under the CLI's heavy `spawnSync`/fs use; the per-target **native** smoke suite is the mitigation, and the npm channel stays canonical so a drift bug never strands a Node consumer.

### Unit 1 — asset pack + extractor (`src/binary/asset-pack.ts`)

The binary cannot rely on a real package root, and `templates/` is *walked*, not read file-by-file — so assets are **extracted to a version-keyed cache, not served from Bun's virtual FS** (decision O2). Read sites stay untouched; the walk finds a real directory.

- **Pack format:** one blob file, `assets.pack` — a JSON index (`{ version, entries: [{ path, offset, size, mode }] }`) followed by concatenated file bytes. Built by the build script from an explicit tree list: `templates/**`, `dist/dashboard/static/dist/**`, plus `package.json` (version identity for `--version` and README-staleness code paths). No tar dependency — Node/Bun have no built-in tar, and a hand-rolled indexed blob is ~60 lines with zero new deps.
- **Extractor:** `extractAssets(packPath, destDir)` — writes to `<dest>.tmp-<pid>`, then a single `renameSync` to `<dest>` (atomic; a lost race to a concurrent extraction is a benign no-op via `EEXIST`/`ENOTEMPTY` → verify dest exists and continue).
- **Cache dir (O7):** `$NOLDOR_CACHE_DIR` override → else `$XDG_CACHE_HOME/noldor/<version>/pkg` → else `~/Library/Caches/noldor/<version>/pkg` on darwin, `~/.cache/noldor/<version>/pkg` elsewhere. Version-keyed = upgrades never fight stale caches; no eviction logic (old versions are litter, documented in gotchas).
- Extraction is skipped when `<dest>` already exists (presence of the version-keyed dir is the completeness signal, guaranteed by the atomic rename).

### Unit 2 — binary entry (`src/binary/entry.ts`)

The compile entrypoint. Replaces the `bin/noldor.mjs` chain for the binary channel only:

1. No Node-floor check (the runtime is baked in), no runtime-select (there is exactly one runtime).
2. Locate the embedded `assets.pack` (Bun embedded-file path), extract per Unit 1 if the cache dir is absent.
3. Set `process.env.NOLDOR_ASSET_ROOT = <cacheDir>` (only if unset — an operator override wins).
4. `await import('../cli/index.js')` — the same dist entry `bin/boot.mjs` imports today.

### Unit 3 — asset-root seam (three existing read sites)

A tiny resolver, `assetRoot(): string | null` (reads `NOLDOR_ASSET_ROOT`), consulted **first** by:

- `src/templates/manifest.ts` — template root = `join(assetRoot(), 'templates')` when set; existing walk-up otherwise.
- `src/dashboard/server.ts` `STATIC_ROOT` — `join(assetRoot(), 'dist/dashboard/static/dist')` when set; existing `import.meta.url` resolution otherwise.
- `src/dashboard/ensure.ts` — same substitution for its module-dir use.

With the env unset (every Node-channel run), all three behave byte-identically to today — the seam is inert outside the binary. This is the entire source-code blast radius of the feature.

### Unit 4 — build script (`bin/build-binary.mjs`, `pnpm build:binary`)

1. Guard: `bun` on PATH (≥ pinned minimum) or exit 1 with an install pointer — mirrors the doctor-probe style; bun is an external tool, not a devDependency.
2. Run the existing `bin/build.mjs` (tsgo → `dist/`, stamped).
3. Build `assets.pack` from the tree list (Unit 1 format).
4. `bun build --compile dist/binary/entry.js --target=<t> --outfile out/noldor-<os>-<arch>` for the requested target (`--target` flag, default: host), embedding `assets.pack`. (`src/binary/entry.ts` compiles to `dist/binary/entry.js` in the ordinary tsgo build; the spike compiles `dist/cli/index.js` directly only because the entry unit doesn't exist yet.)

Compiled from `dist/`, the ESM output including top-level `await` and `import.meta.url` is bun-native bundling territory; the spike task in the plan asserts this end-to-end before anything else builds on it (O6).

### Unit 5 — release workflow (`.github/workflows/release-binaries.yml`)

Separate workflow on the same `push: tags: ['v*']` trigger as `publish.yml` (decision O4):

- **Matrix job** (4 legs): `ubuntu-latest` → linux-amd64, `ubuntu-24.04-arm` → linux-arm64, `macos-14` → darwin-arm64, `macos-13` → darwin-amd64. Each leg: checkout → pnpm install → setup-bun → `pnpm build:binary` (host target) → **native smoke** (Unit 6) → upload artifact.
- **Release job** (`needs: build`, `permissions: contents: write`): download all artifacts, generate `SHA256SUMS`, `gh release upload` onto the release for the tag (create it if `publish.yml` hasn't). Version guard mirrors `publish.yml`: tag == `package.json` version == `noldor --version` output of the built binary.

### Unit 6 — smoke suite (`scripts/smoke-binary.sh`)

Runs the built binary in an environment proving self-containment: a temp fixture git repo, `PATH` stripped to exclude `node`/`npm`/`pnpm`/`bun`. Asserts:

- `noldor --version` exits 0 and prints the `package.json` version.
- `noldor init` (or the minimal init-shaped command) materializes templates in the fixture — proves extraction + template walk.
- A read-only command sweep (`--help`, manifest/validate-shaped commands that need no consumer toolchain) exits green.
- Second invocation does not re-extract (cache-hit path).

Deliberately **not** `noldor doctor` as the oracle: doctor probes consumer-side tools (gh, oxlint, …) that are legitimately absent in the fixture.

### Unit 7 — installer + docs (`install.sh`, README, `docs/noldor/`)

- `install.sh` at repo root, served raw: detects `uname -s`/`-m`, downloads the matching asset for the latest (or `NOLDOR_VERSION`-pinned) release, verifies against `SHA256SUMS`, installs to `~/.local/bin/noldor` (override `NOLDOR_INSTALL_DIR`).
- README distribution section: binary channel beside the npm channel, with the "not sufficient for cross-language adoption on its own" caveat stated plainly.
- Adoption/hooks doc note (O5): how a consumer points lefthook at the binary manually for faster hooks.
- `docs/noldor/gotchas.md`: cache-dir litter across versions; `NOLDOR_CACHE_DIR`/`NOLDOR_ASSET_ROOT` overrides.

### Data flow

```
tag v* ──► publish.yml (npm, unchanged)
      └──► release-binaries.yml
             matrix leg: build.mjs ──► dist/ ──► assets.pack ──► bun compile ──► smoke ──► artifact
             release job: artifacts ──► SHA256SUMS ──► gh release upload

consumer:  install.sh ──► ~/.local/bin/noldor
first run: embedded assets.pack ──► extract ──► $CACHE/noldor/<ver>/pkg ──► NOLDOR_ASSET_ROOT ──► dist CLI
```

### Error handling

- `bun` absent at build: exit 1, named remediation. Never auto-install.
- Extraction failure (ENOSPC, perms): exit 1 with the attempted path; no partial dir left behind (tmp + rename).
- `install.sh` checksum mismatch: abort loudly, leave nothing installed.
- Smoke failure on any leg fails the whole workflow — no partial release uploads (release job runs only after all legs).

### Testing

- Unit: pack/extract round-trip (index integrity, mode preservation, atomicity via injected rename failure), asset-root seam (env set/unset → resolved roots), cache-dir resolution per platform/env matrix.
- Existing suites prove the inert path: no behavior change with `NOLDOR_ASSET_ROOT` unset; `test:contract` still green (npm tarball untouched).
- CI native smoke per target (Unit 6) is the integration oracle for the binary itself — vitest never executes under Bun.

## Acceptance criteria

1. `pnpm build:binary` with bun installed produces a runnable host-target binary; without bun it exits non-zero naming the missing tool.
2. The built binary passes the smoke suite in a fixture repo with node/npm/pnpm/bun stripped from `PATH` — `--version` exit 0 printing the package version.
3. First binary run extracts assets to the version-keyed cache dir; a second run reuses it without re-extracting; a template-materializing command produces the same tree the npm channel produces.
4. Dashboard static assets resolve from the extracted root under the binary (server boots and serves its index in smoke or an equivalent integration assertion).
5. With `NOLDOR_ASSET_ROOT` unset, all three seam sites resolve exactly as today and the full existing test suite plus `test:contract` stay green.
6. A `v*` tag builds all four targets, each smoke-tested natively on its own runner; the GitHub release carries four binaries plus `SHA256SUMS`, and any leg's failure blocks all uploads.
7. The workflow refuses to upload when tag, `package.json` version, and the binary's `--version` output disagree.
8. `install.sh` on darwin-arm64 and linux-amd64 installs the matching checksum-verified binary that then runs `--version` successfully.
9. npm channel is bit-identical in behavior: no changes to `bin/noldor.mjs`, `bin/boot.mjs`, `bin/runtime-select.mjs` semantics; packed-tarball contract unchanged.
10. README + adoption docs document the binary channel, its cross-language caveat, and the manual lefthook swap; `docs/noldor/gotchas.md` records cache/override env vars.

## Risks / trade-offs

- **Bun-vs-Node semantic drift** (spawnSync, fs edge cases, inquirer TTY handling) — the core accepted risk of O1. Mitigations: bundle `dist/` (no TS-toolchain variance), native smoke per target, npm channel canonical. Residual: drift in commands the smoke sweep doesn't exercise surfaces only in the field.
- **Binary size** (~90–100MB with Bun runtime embedded ×4 targets on every release). Accepted: GH release assets are free; no consumer downloads more than one.
- **`ubuntu-24.04-arm` runner availability** — public-repo arm64 runners are GA but occasionally queue-constrained; a slow leg delays release assets, never npm publish (separate workflow).
- **Cache litter** across versions (no eviction). Documented; version-keyed dirs are small (templates + dashboard static).
- **Bun as an unpinned external tool** — build guard pins a minimum; CI pins the setup-bun version, so releases are reproducible even if local dev floats.

## User Story

As an operator of a non-Node repository (Go, Python, Rust), I want to install noldor as a single self-contained binary, so that I can adopt the framework's gate/docs/queue discipline without Node, pnpm, or any JS toolchain on my machine.

## Usage

```sh
# non-Node consumer install (checksum-verified, ~/.local/bin)
curl -fsSL https://raw.githubusercontent.com/<org>/noldor/main/install.sh | sh
noldor --version

# pin a version
NOLDOR_VERSION=v1.5.0 curl -fsSL .../install.sh | sh

# maintainer: build a host-target binary locally (requires bun)
pnpm build:binary

# overrides
NOLDOR_CACHE_DIR=/tmp/noldor-cache noldor init
NOLDOR_ASSET_ROOT=/path/to/pkg noldor dashboard
```

Node consumers: nothing changes — `pnpm add -D @david.zoufaly/noldor` + `npx noldor` remain the primary channel. Optional: point lefthook commands at the installed binary for faster hook startup (documented manual swap).

## Open questions (resolved)

1. *Does bun bundle the ESM `dist/` (top-level `await`, `import.meta.url` sites) cleanly into a compiled binary?* → **Assumed yes; plan task 1 is a spike that compiles `dist/cli/index.js` and runs `--version` + `--help` before any other task builds on it.** Bun's compile path is ESM-native and this is its mainline use case; the spike converts the assumption into evidence first (D-O6).
2. *Cache directory convention?* → **`$NOLDOR_CACHE_DIR` → `$XDG_CACHE_HOME/noldor/<version>/pkg` → platform default (`~/Library/Caches` darwin, `~/.cache` elsewhere).** Matches platform norms; version key makes upgrades collision-free (D-O7).
3. *Archive format for embedded assets?* → **Custom JSON-index blob + concatenated bytes.** No tar builtin exists in Node/Bun; a dependency for tar is heavier than 60 lines of index code; the format is write-once/read-once by the same codebase (D-pack).
4. *Why not `noldor doctor` as the smoke oracle?* → **Doctor probes consumer-side tools that are legitimately absent in a minimal fixture; the smoke sweep asserts self-containment (version, extraction, templates, read-only commands) instead.** Keeps the oracle about the binary, not the fixture's toolchain (D-smoke).
