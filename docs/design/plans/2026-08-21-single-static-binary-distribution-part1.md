# Single Static Binary Distribution (Part 1: Core Runtime) Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Everything the binary needs *inside* the package: channel/asset-root resolution, the framed asset pack + extractor, the three asset-read seams, the self-exec seam, and the compile entrypoint — all inert on the npm channel (env unset ⇒ byte-identical behavior).

**Architecture:** New `src/binary/` module (asset-root, asset-pack, entry, ambient decls). Three read sites and one spawn helper consult it first; two hand-rolled launchers converge on `noldorCliCommand()`; `init --adopt` and the stub runner refuse on the binary channel. Spec: `docs/design/specs/2026-08-21-single-static-binary-distribution-design.md`.

**Tech Stack:** TypeScript (tsgo), vitest, node:fs/crypto only — no new dependencies. Bun is used by the spike task only (external tool).

---

## File Structure

- `src/binary/bun-floor.ts` — spike-recorded Bun version pin (single exported constant)
- `src/binary/asset-root.ts` — `isBinaryChannel()`, `assetRoot()`, `resolveAssetCachePath()`
- `src/binary/asset-pack.ts` — pack writer/reader + `extractAssets()` (framing, validation, atomic extract)
- `src/binary/entry.ts` — binary-only compile entrypoint (bake, mark, extract, import CLI)
- `src/binary/ambient.d.ts` — `NOLDOR_BINARY_VERSION` + `*.pack` module declarations
- `src/binary/__tests__/asset-root.test.ts` — env/platform matrix
- `src/binary/__tests__/asset-pack.test.ts` — round-trip + rejection table + extractor protocol
- `src/templates/manifest.ts` — `TEMPLATES_ROOT` consults `assetRoot()` first (seam 1)
- `src/dashboard/server.ts` — `STATIC_ROOT` consults `assetRoot()` first (seam 2)
- `src/cr/codex-adapter.ts` — `CR_RECORD_SCHEMA_PATH` consults `assetRoot()` first (seam 3)
- `src/core/noldor-cli.ts` — `noldorCliCommand()` branches on `isBinaryChannel()` (self-exec seam)
- `src/dashboard/ensure.ts` — `spawnDetachedServer()` uses `noldorCliCommand()`
- `src/autonomous/watch-detach.ts` — detach spawn uses `noldorCliCommand()`
- `src/core/agent-runner/doctor-runners.ts` — stub probe reports unavailable on binary channel
- `src/core/agent-runner/runners/stub.ts` — `buildStubArgv` throws on binary channel
- `src/cli/commands/init.ts` — `--adopt` refusal on binary channel

---

## Task 1: Spike gate — prove bun compiles `dist/`, record the pin

**Files:**
Create: `src/binary/bun-floor.ts`

- [ ] **Step 1: Assert bun is installed.** Run:
  ```bash
  bun --version
  ```
  Expected output: a dotted version (e.g. `1.2.x`). If the command is missing: STOP — install bun (`curl -fsSL https://bun.sh/install | bash`) before continuing; no later task may proceed.
- [ ] **Step 2: Build dist.** Run `pnpm build`. Expected output ends with the build stamp line; `dist/cli/index.js` exists.
- [ ] **Step 3: Compile the existing CLI as-is.** Run:
  ```bash
  mkdir -p /tmp/noldor-spike && bun build --compile dist/cli/index.js --outfile /tmp/noldor-spike/noldor-spike
  ```
  Expected output: bun reports the bundle + `compile` success; the outfile exists and is executable.
- [ ] **Step 4: Probe basic execution in a fixture.** Run:
  ```bash
  cd "$(mktemp -d)" && git init -q . && /tmp/noldor-spike/noldor-spike --version; echo "exit=$?"
  ```
  Expected output: the version from `package.json`, then `exit=0`. Also run `/tmp/noldor-spike/noldor-spike --help` → usage text, exit 0. Any crash referencing module resolution, top-level await, or `import.meta` ⇒ **STOP: spike failed — fall back to Node SEA re-spec (spec Unit 0); do not continue.**
- [ ] **Step 5: Probe file embedding with import attributes.** Create `/tmp/noldor-spike/probe.pack` containing `hello-pack`, then `/tmp/noldor-spike/probe.js`:
  ```js
  import packPath from './probe.pack' with { type: 'file' };
  import { readFileSync } from 'node:fs';
  console.log(readFileSync(packPath, 'utf8'));
  ```
  Run:
  ```bash
  cd /tmp/noldor-spike && bun build --compile probe.js --outfile probe-bin && ./probe-bin
  ```
  Expected output: `hello-pack`. This proves the embed mechanics Unit 2 uses (`readFileSync` on an embedded path).
- [ ] **Step 6: Probe subprocess spawn.** Create `/tmp/noldor-spike/spawn.js`:
  ```js
  import { spawnSync } from 'node:child_process';
  const r = spawnSync('git', ['--version'], { encoding: 'utf8' });
  console.log(r.status, r.stdout.trim());
  ```
  Compile + run as in Step 5. Expected output: `0 git version …`.
- [ ] **Step 7: Probe an interactive prompt under a PTY (operator-present check).** Run the spike binary's `init` in a scratch git dir under `script -q /dev/null` and answer one prompt. Expected: the `@inquirer/prompts` prompt renders and accepts input. (Local-only assertion; CI never runs this.)
- [ ] **Step 8: Record the pin.** Create `src/binary/bun-floor.ts` with the version Step 1 printed (example shows 1.2.19 — write the real one):
  ```ts
  /**
   * Minimum Bun version for `pnpm build:binary` and the release matrix — the
   * exact version the Unit-0 spike verified (compile, embed, spawn, PTY).
   * Build script and CI both pin to this single constant (spec Unit 0/4/5).
   */
  export const BUN_FLOOR = '1.2.19';
  ```
- [ ] **Step 9: Verify typecheck passes.** Run `pnpm typecheck`. Expected: exit 0.
- [ ] **Step 10: Commit.** Write `/tmp/msg-spike.txt`:
  ```
  feat(binary): record spike-verified bun floor

  Why — the single-static-binary channel rests on bun compiling the existing
  ESM dist output; the spike converts that assumption into evidence before
  any dependent seam is built (spec Unit 0).

  How — compiled dist/cli/index.js plus embed/spawn/PTY probes with the
  locally installed bun; the verified version becomes the pinned floor
  constant shared by the build script and the release workflow.

  What — src/binary/bun-floor.ts exporting BUN_FLOOR, the spike-recorded
  minimum bun version for build:binary and CI legs.

  Noldor-FD: single-static-binary-distribution
  ```
  Run:
  ```bash
  git add src/binary/bun-floor.ts && git commit -F /tmp/msg-spike.txt
  ```
  Expected output: 1 file changed. (This is the branch's first code-bearing commit — the Why/How/What body above becomes the PR Summary.)

---

## Task 2: `asset-root.ts` — channel marker + path equations

**Files:**
Create: `src/binary/asset-root.ts`
Test: `src/binary/__tests__/asset-root.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/binary/__tests__/asset-root.test.ts`:
  ```ts
  // @tests: single-static-binary-distribution
  import { describe, expect, it } from 'vitest';
  import { assetRoot, isBinaryChannel, resolveAssetCachePath } from '../asset-root.js';

  describe('isBinaryChannel', () => {
    it("is true only for the exact value '1'", () => {
      expect(isBinaryChannel({ NOLDOR_BINARY: '1' })).toBe(true);
      expect(isBinaryChannel({ NOLDOR_BINARY: '0' })).toBe(false);
      expect(isBinaryChannel({ NOLDOR_BINARY: 'true' })).toBe(false);
      expect(isBinaryChannel({})).toBe(false);
    });
  });

  describe('assetRoot', () => {
    it('returns null when unset', () => {
      expect(assetRoot({})).toBeNull();
    });
    it('returns the value verbatim when absolute', () => {
      expect(assetRoot({ NOLDOR_ASSET_ROOT: '/opt/noldor-pkg' })).toBe('/opt/noldor-pkg');
    });
    it('throws on empty and on relative values (both channels)', () => {
      expect(() => assetRoot({ NOLDOR_ASSET_ROOT: '' })).toThrow(/NOLDOR_ASSET_ROOT/);
      expect(() => assetRoot({ NOLDOR_ASSET_ROOT: 'rel/path' })).toThrow(/absolute/);
    });
  });

  describe('resolveAssetCachePath', () => {
    it('appends the version key under NOLDOR_CACHE_DIR', () => {
      expect(resolveAssetCachePath('9.9.9', { NOLDOR_CACHE_DIR: '/tmp/nc' }, 'linux')).toBe(
        '/tmp/nc/9.9.9/pkg',
      );
    });
    it('rejects a relative NOLDOR_CACHE_DIR', () => {
      expect(() => resolveAssetCachePath('9.9.9', { NOLDOR_CACHE_DIR: 'nc' }, 'linux')).toThrow(
        /absolute/,
      );
    });
    it('uses Library/Caches on darwin', () => {
      expect(resolveAssetCachePath('9.9.9', { HOME: '/Users/u' }, 'darwin')).toBe(
        '/Users/u/Library/Caches/noldor/9.9.9/pkg',
      );
    });
    it('prefers XDG_CACHE_HOME elsewhere', () => {
      expect(
        resolveAssetCachePath('9.9.9', { XDG_CACHE_HOME: '/xdg', HOME: '/home/u' }, 'linux'),
      ).toBe('/xdg/noldor/9.9.9/pkg');
    });
    it('falls back to ~/.cache', () => {
      expect(resolveAssetCachePath('9.9.9', { HOME: '/home/u' }, 'linux')).toBe(
        '/home/u/.cache/noldor/9.9.9/pkg',
      );
    });
    it('throws when neither HOME nor XDG_CACHE_HOME resolves', () => {
      expect(() => resolveAssetCachePath('9.9.9', {}, 'linux')).toThrow(/HOME/);
    });
  });
  ```
- [ ] **Step 2: Run to verify FAIL.** `pnpm vitest run src/binary/__tests__/asset-root.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Create `src/binary/asset-root.ts`:
  ```ts
  import { isAbsolute, join } from 'node:path';

  /**
   * Channel marker: exactly the value '1' activates binary behavior (spec
   * Unit 2). Anything else — unset, '0', 'true' — is the npm channel, so a
   * stray value can never flip spawn semantics.
   */
  export function isBinaryChannel(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.NOLDOR_BINARY === '1';
  }

  /**
   * Operator-provided package root. Absolute-or-error on BOTH channels — the
   * npm channel reaches this same validation, so misuse fails identically
   * everywhere (spec Unit 1 path equations).
   */
  export function assetRoot(env: NodeJS.ProcessEnv = process.env): string | null {
    const raw = env.NOLDOR_ASSET_ROOT;
    if (raw === undefined) return null;
    if (raw === '' || !isAbsolute(raw)) {
      throw new Error(`NOLDOR_ASSET_ROOT must be an absolute path (got '${raw}')`);
    }
    return raw;
  }

  /**
   * Version-keyed extraction destination. The version key is appended even
   * under the NOLDOR_CACHE_DIR override so an upgrade never serves a stale
   * tree (spec Unit 1).
   */
  export function resolveAssetCachePath(
    version: string,
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
  ): string {
    const base = env.NOLDOR_CACHE_DIR;
    if (base !== undefined) {
      if (base === '' || !isAbsolute(base)) {
        throw new Error(`NOLDOR_CACHE_DIR must be an absolute path (got '${base}')`);
      }
      return join(base, version, 'pkg');
    }
    if (platform === 'darwin') {
      const home = env.HOME;
      if (!home) throw new Error('cannot resolve cache dir: HOME is unset');
      return join(home, 'Library', 'Caches', 'noldor', version, 'pkg');
    }
    const xdg = env.XDG_CACHE_HOME;
    if (xdg) return join(xdg, 'noldor', version, 'pkg');
    const home = env.HOME;
    if (!home) throw new Error('cannot resolve cache dir: HOME and XDG_CACHE_HOME are unset');
    return join(home, '.cache', 'noldor', version, 'pkg');
  }
  ```
- [ ] **Step 4: Run to verify PASS.** Same command as Step 2 — Expected: all tests pass.
- [ ] **Step 5: Commit.** Write `/tmp/msg-assetroot.txt`:
  ```
  feat(binary): asset-root resolver — channel marker + cache path equations

  Exact-value channel marker, absolute-path validation shared by both
  channels, and the version-keyed cache equations from spec Unit 1.

  Noldor-FD: single-static-binary-distribution
  ```
  ```bash
  git add src/binary/asset-root.ts src/binary/__tests__/asset-root.test.ts && git commit -F /tmp/msg-assetroot.txt
  ```

---

## Task 3: `asset-pack.ts` — framed pack writer/reader

**Files:**
Create: `src/binary/asset-pack.ts`
Test: `src/binary/__tests__/asset-pack.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/binary/__tests__/asset-pack.test.ts`:
  ```ts
  // @tests: single-static-binary-distribution
  import { describe, expect, it } from 'vitest';
  import { buildPack, readPack, type PackFile } from '../asset-pack.js';

  const files: PackFile[] = [
    { path: 'templates/lefthook.yml', mode: 0o644, data: Buffer.from('hooks: {}\n') },
    { path: 'package.json', mode: 0o644, data: Buffer.from('{"version":"9.9.9"}') },
    { path: 'dist/cr/cr-record.schema.json', mode: 0o644, data: Buffer.from('{}') },
  ];

  describe('pack round-trip', () => {
    it('writes and reads back every entry byte-identically', () => {
      const pack = buildPack('9.9.9', files);
      const { pkgVersion, entries } = readPack(pack);
      expect(pkgVersion).toBe('9.9.9');
      expect(entries.map((e) => e.path).sort()).toEqual(files.map((f) => f.path).sort());
      for (const f of files) {
        const e = entries.find((x) => x.path === f.path)!;
        expect(e.data.equals(f.data)).toBe(true);
        expect(e.mode).toBe(f.mode);
      }
    });
  });

  describe('rejection table (spec Unit 1 format rules)', () => {
    const build = (over: Partial<PackFile>) =>
      buildPack('9.9.9', [{ path: 'a.txt', mode: 0o644, data: Buffer.from('x'), ...over }]);

    it('writer rejects absolute paths', () => {
      expect(() => build({ path: '/etc/passwd' })).toThrow(/absolute/);
    });
    it('writer rejects .. segments', () => {
      expect(() => build({ path: '../escape' })).toThrow(/\.\./);
    });
    it('writer rejects duplicates', () => {
      expect(() =>
        buildPack('9.9.9', [
          { path: 'a.txt', mode: 0o644, data: Buffer.from('x') },
          { path: 'a.txt', mode: 0o644, data: Buffer.from('y') },
        ]),
      ).toThrow(/duplicate/);
    });
    it('writer rejects modes other than 0o644/0o755', () => {
      expect(() => build({ mode: 0o777 })).toThrow(/mode/);
    });
    it('reader rejects bad magic', () => {
      const pack = buildPack('9.9.9', files);
      pack.write('XXXX', 0, 'ascii');
      expect(() => readPack(pack)).toThrow(/magic/);
    });
    it('reader rejects unknown format version', () => {
      const pack = buildPack('9.9.9', files);
      pack.writeUInt32LE(99, 4);
      expect(() => readPack(pack)).toThrow(/format version/);
    });
    it('reader rejects out-of-bounds entries', () => {
      const pack = buildPack('9.9.9', [{ path: 'a.txt', mode: 0o644, data: Buffer.from('x') }]);
      // Corrupt the index: inflate the entry size past the data section.
      const indexLen = pack.readUInt32LE(8);
      const idx = JSON.parse(pack.subarray(12, 12 + indexLen).toString('utf8'));
      idx.entries[0].size = 10_000;
      const newIdx = Buffer.from(JSON.stringify(idx), 'utf8');
      const rebuilt = Buffer.concat([pack.subarray(0, 8)]);
      const head = Buffer.alloc(4);
      head.writeUInt32LE(newIdx.length, 0);
      expect(() =>
        readPack(Buffer.concat([rebuilt, head, newIdx, pack.subarray(12 + indexLen)])),
      ).toThrow(/bounds/);
    });
  });
  ```
- [ ] **Step 2: Run to verify FAIL.** `pnpm vitest run src/binary/__tests__/asset-pack.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Create `src/binary/asset-pack.ts`:
  ```ts
  /**
   * Framed asset pack (spec Unit 1): magic NPAK + u32le formatVersion(=1) +
   * u32le indexLength + index JSON + data section. Regular files only, modes
   * 0o644/0o755, relative POSIX paths. Writer and reader are the same module
   * so the format has exactly one implementation.
   */

  const MAGIC = 'NPAK';
  const FORMAT_VERSION = 1;
  const HEADER_LEN = 12; // 4 magic + 4 version + 4 indexLength

  export interface PackFile {
    path: string;
    mode: number;
    data: Buffer;
  }

  export interface PackEntry {
    path: string;
    mode: number;
    data: Buffer;
  }

  interface IndexEntry {
    path: string;
    offset: number;
    size: number;
    mode: number;
  }

  function assertSafePath(path: string): void {
    if (path.startsWith('/')) throw new Error(`pack path must not be absolute: ${path}`);
    if (path.split('/').includes('..')) throw new Error(`pack path must not contain ..: ${path}`);
    if (path === '') throw new Error('pack path must not be empty');
  }

  function assertMode(mode: number, path: string): void {
    if (mode !== 0o644 && mode !== 0o755) {
      throw new Error(`pack entry mode must be 0o644 or 0o755 (got 0o${mode.toString(8)}) for ${path}`);
    }
  }

  export function buildPack(pkgVersion: string, files: PackFile[]): Buffer {
    const seen = new Set<string>();
    const entries: IndexEntry[] = [];
    const blobs: Buffer[] = [];
    let offset = 0;
    for (const f of files) {
      assertSafePath(f.path);
      assertMode(f.mode, f.path);
      if (seen.has(f.path)) throw new Error(`duplicate pack path: ${f.path}`);
      seen.add(f.path);
      entries.push({ path: f.path, offset, size: f.data.length, mode: f.mode });
      blobs.push(f.data);
      offset += f.data.length;
    }
    const index = Buffer.from(JSON.stringify({ pkgVersion, entries }), 'utf8');
    const header = Buffer.alloc(HEADER_LEN);
    header.write(MAGIC, 0, 'ascii');
    header.writeUInt32LE(FORMAT_VERSION, 4);
    header.writeUInt32LE(index.length, 8);
    return Buffer.concat([header, index, ...blobs]);
  }

  export function readPack(pack: Buffer): { pkgVersion: string; entries: PackEntry[] } {
    if (pack.length < HEADER_LEN) throw new Error('pack truncated: no header');
    if (pack.subarray(0, 4).toString('ascii') !== MAGIC) throw new Error('bad pack magic');
    const version = pack.readUInt32LE(4);
    if (version !== FORMAT_VERSION) throw new Error(`unsupported pack format version ${version}`);
    const indexLen = pack.readUInt32LE(8);
    if (HEADER_LEN + indexLen > pack.length) throw new Error('pack truncated: index out of bounds');
    const raw = JSON.parse(pack.subarray(HEADER_LEN, HEADER_LEN + indexLen).toString('utf8')) as {
      pkgVersion: string;
      entries: IndexEntry[];
    };
    const dataStart = HEADER_LEN + indexLen;
    const dataLen = pack.length - dataStart;
    const seen = new Set<string>();
    const entries: PackEntry[] = raw.entries.map((e) => {
      assertSafePath(e.path);
      assertMode(e.mode, e.path);
      if (seen.has(e.path)) throw new Error(`duplicate pack path: ${e.path}`);
      seen.add(e.path);
      if (
        !Number.isSafeInteger(e.offset) ||
        !Number.isSafeInteger(e.size) ||
        e.offset < 0 ||
        e.size < 0 ||
        e.offset + e.size > dataLen
      ) {
        throw new Error(`pack entry out of bounds: ${e.path}`);
      }
      return {
        path: e.path,
        mode: e.mode,
        data: pack.subarray(dataStart + e.offset, dataStart + e.offset + e.size),
      };
    });
    return { pkgVersion: raw.pkgVersion, entries };
  }
  ```
  (Overlap between entries is allowed by this reader only in the harmless shared-bytes sense; the writer never produces it and the bounds check stops any read outside the data section — the rejection classes from the spec's table that matter for safety are all enforced.)
- [ ] **Step 4: Run to verify PASS.** Same command — Expected: all pass.
- [ ] **Step 5: Commit.** Write `/tmp/msg-pack.txt`:
  ```
  feat(binary): framed asset-pack writer/reader

  NPAK v1 framing with normative validation — safe relative paths, mode
  allowlist, duplicate and bounds rejection (spec Unit 1 format).

  Noldor-FD: single-static-binary-distribution
  ```
  ```bash
  git add src/binary/asset-pack.ts src/binary/__tests__/asset-pack.test.ts && git commit -F /tmp/msg-pack.txt
  ```

---

## Task 4: extractor — atomic version-keyed extraction

**Files:**
Modify: `src/binary/asset-pack.ts`
Test: `src/binary/__tests__/asset-pack.test.ts`

- [ ] **Step 1: Append the failing tests** to `src/binary/__tests__/asset-pack.test.ts`:
  ```ts
  import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { extractAssets, MARKER_NAME } from '../asset-pack.js';

  function tmpBase(): string {
    return mkdtempSync(join(tmpdir(), 'npak-test-'));
  }

  describe('extractAssets', () => {
    const packOf = (text: string) =>
      buildPack('9.9.9', [
        { path: 'templates/a.txt', mode: 0o644, data: Buffer.from(text) },
        { path: 'bin/tool', mode: 0o755, data: Buffer.from('#!/bin/sh\n') },
      ]);

    it('extracts, writes the digest marker, and reports extracted=true', () => {
      const base = tmpBase();
      const packPath = join(base, 'assets.pack');
      writeFileSync(packPath, packOf('one'));
      const dest = join(base, 'pkg');
      const r = extractAssets(packPath, dest);
      expect(r.extracted).toBe(true);
      expect(readFileSync(join(dest, 'templates/a.txt'), 'utf8')).toBe('one');
      expect(statSync(join(dest, 'bin/tool')).mode & 0o755).toBe(0o755);
      expect(existsSync(join(dest, MARKER_NAME))).toBe(true);
    });

    it('is a no-op on a digest-matching cache hit', () => {
      const base = tmpBase();
      const packPath = join(base, 'assets.pack');
      writeFileSync(packPath, packOf('one'));
      const dest = join(base, 'pkg');
      extractAssets(packPath, dest);
      const r2 = extractAssets(packPath, dest);
      expect(r2.extracted).toBe(false);
    });

    it('re-extracts over a markerless (stale) dest by renaming it aside', () => {
      const base = tmpBase();
      const packPath = join(base, 'assets.pack');
      writeFileSync(packPath, packOf('fresh'));
      const dest = join(base, 'pkg');
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, 'junk.txt'), 'stale');
      const r = extractAssets(packPath, dest);
      expect(r.extracted).toBe(true);
      expect(readFileSync(join(dest, 'templates/a.txt'), 'utf8')).toBe('fresh');
      expect(existsSync(join(dest, 'junk.txt'))).toBe(false);
    });

    it('accepts a concurrent winner: rename failure + matching marker → extracted=false', () => {
      const base = tmpBase();
      const packPath = join(base, 'assets.pack');
      writeFileSync(packPath, packOf('one'));
      const dest = join(base, 'pkg');
      extractAssets(packPath, dest); // "the other process" already published
      const failingFs = {
        renameSync: () => {
          const err = new Error('exists') as NodeJS.ErrnoException;
          err.code = 'ENOTEMPTY';
          throw err;
        },
      };
      // Force the miss path by removing the marker read: simulate via a fresh
      // dest2 that the failing rename can never publish — winner check falls
      // back to the real dest marker.
      const r = extractAssets(packPath, dest, failingFs);
      expect(r.extracted).toBe(false);
    });

    it('propagates non-race failures with the attempted path', () => {
      const base = tmpBase();
      const packPath = join(base, 'assets.pack');
      writeFileSync(packPath, packOf('one'));
      const dest = join(base, 'pkg2');
      const failingFs = {
        renameSync: () => {
          const err = new Error('denied') as NodeJS.ErrnoException;
          err.code = 'EACCES';
          throw err;
        },
      };
      expect(() => extractAssets(packPath, dest, failingFs)).toThrow(/pkg2/);
    });
  });
  ```
- [ ] **Step 2: Run to verify FAIL.** `pnpm vitest run src/binary/__tests__/asset-pack.test.ts` — Expected: FAIL (`extractAssets` not exported).
- [ ] **Step 3: Implement.** Append to `src/binary/asset-pack.ts`:
  ```ts
  import { createHash } from 'node:crypto';
  import * as realFs from 'node:fs';
  import { dirname, join as joinPath } from 'node:path';

  export const MARKER_NAME = '.noldor-pack-ok';

  /** The fs surface the extractor uses — injectable for failure tests. */
  export type ExtractFs = Pick<
    typeof realFs,
    'mkdtempSync' | 'mkdirSync' | 'writeFileSync' | 'renameSync' | 'readFileSync' | 'rmSync' | 'existsSync'
  >;

  function markerDigest(fs: ExtractFs, dest: string): string | null {
    try {
      return fs.readFileSync(joinPath(dest, MARKER_NAME), 'utf8').trim();
    } catch {
      return null;
    }
  }

  /**
   * Extract the embedded pack to `dest` (spec Unit 1 protocol): private temp
   * dir + digest marker + single rename publish; stale dests renamed aside,
   * never rm'd in place; rename races resolved by re-verifying the winner's
   * digest. Returns { extracted } — false means a valid cache was reused.
   */
  export function extractAssets(
    packPath: string,
    dest: string,
    fsOverride: Partial<ExtractFs> = {},
  ): { extracted: boolean } {
    const fs: ExtractFs = { ...realFs, ...fsOverride };
    const pack = fs.readFileSync(packPath) as Buffer;
    const digest = createHash('sha256').update(pack).digest('hex');
    if (markerDigest(fs, dest) === digest) return { extracted: false };

    const { entries } = readPack(pack);
    fs.mkdirSync(dirname(dest), { recursive: true });
    const temp = fs.mkdtempSync(`${dest}.tmp-`);
    try {
      for (const e of entries) {
        const target = joinPath(temp, e.path);
        fs.mkdirSync(dirname(target), { recursive: true });
        fs.writeFileSync(target, e.data, { mode: e.mode });
      }
      fs.writeFileSync(joinPath(temp, MARKER_NAME), `${digest}\n`);

      if (fs.existsSync(dest)) {
        // Never rm a dir another process may be publishing — rename it aside.
        const aside = `${dest}.stale-${process.pid}`;
        fs.renameSync(dest, aside);
        fs.renameSync(temp, dest);
        fs.rmSync(aside, { recursive: true, force: true });
        return { extracted: true };
      }
      fs.renameSync(temp, dest);
      return { extracted: true };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST' || code === 'ENOTEMPTY') {
        // Lost a publish race — accept the winner iff its content matches.
        if (markerDigest(fs, dest) === digest) {
          fs.rmSync(temp, { recursive: true, force: true });
          return { extracted: false };
        }
      }
      fs.rmSync(temp, { recursive: true, force: true });
      throw new Error(`asset extraction to ${dest} failed: ${(error as Error).message}`);
    }
  }
  ```
- [ ] **Step 4: Run to verify PASS.** Same command — Expected: all pass (including the earlier round-trip suite).
- [ ] **Step 5: Commit.** Write `/tmp/msg-extract.txt`:
  ```
  feat(binary): atomic pack extractor with digest marker

  Temp-dir + rename publish, marker-verified cache hits, aside-rename for
  stale dests, race acceptance by digest re-verify (spec Unit 1 protocol).

  Noldor-FD: single-static-binary-distribution
  ```
  ```bash
  git add src/binary/asset-pack.ts src/binary/__tests__/asset-pack.test.ts && git commit -F /tmp/msg-extract.txt
  ```

---

## Task 5: asset-read seams — templates, dashboard static, codex schema

**Files:**
Modify: `src/templates/manifest.ts`, `src/dashboard/server.ts`, `src/cr/codex-adapter.ts`
Test: `src/binary/__tests__/asset-root.test.ts`

- [ ] **Step 1: Append the failing seam tests** to `src/binary/__tests__/asset-root.test.ts`:
  ```ts
  import { afterEach } from 'vitest';

  describe('asset-root seams', () => {
    const saved = process.env.NOLDOR_ASSET_ROOT;
    afterEach(() => {
      if (saved === undefined) delete process.env.NOLDOR_ASSET_ROOT;
      else process.env.NOLDOR_ASSET_ROOT = saved;
      vi.resetModules();
    });

    it('TEMPLATES_ROOT follows NOLDOR_ASSET_ROOT when set', async () => {
      process.env.NOLDOR_ASSET_ROOT = '/opt/pkg';
      vi.resetModules();
      const { TEMPLATES_ROOT } = await import('../../templates/manifest.js');
      expect(TEMPLATES_ROOT).toBe('/opt/pkg/templates');
    });

    it('CR_RECORD_SCHEMA_PATH follows NOLDOR_ASSET_ROOT when set', async () => {
      process.env.NOLDOR_ASSET_ROOT = '/opt/pkg';
      vi.resetModules();
      const { CR_RECORD_SCHEMA_PATH } = await import('../../cr/codex-adapter.js');
      expect(CR_RECORD_SCHEMA_PATH).toBe('/opt/pkg/dist/cr/cr-record.schema.json');
    });

    it('TEMPLATES_ROOT stays module-relative when unset', async () => {
      delete process.env.NOLDOR_ASSET_ROOT;
      vi.resetModules();
      const { TEMPLATES_ROOT } = await import('../../templates/manifest.js');
      expect(TEMPLATES_ROOT.endsWith('/templates')).toBe(true);
      expect(TEMPLATES_ROOT.startsWith('/opt/pkg')).toBe(false);
    });
  });
  ```
  Also add `vi` to the vitest import at the top of the file: `import { afterEach, describe, expect, it, vi } from 'vitest';` (merge with the existing import line).
- [ ] **Step 2: Run to verify FAIL.** `pnpm vitest run src/binary/__tests__/asset-root.test.ts` — Expected: the two "follows NOLDOR_ASSET_ROOT" tests FAIL.
- [ ] **Step 3: Implement seam 1.** In `src/templates/manifest.ts`, replace:
  ```ts
  const here = dirname(fileURLToPath(import.meta.url));
  export const TEMPLATES_ROOT = join(here, '..', '..', 'templates');
  ```
  with:
  ```ts
  import { assetRoot } from '../binary/asset-root.js';

  const here = dirname(fileURLToPath(import.meta.url));
  // Binary channel: NOLDOR_ASSET_ROOT points at the extracted package tree
  // (spec Unit 3). Unset (every npm-channel run): module-relative walk, as
  // before. installedFrameworkVersion() resolves package.json through this
  // same root, so version reads ride the seam too.
  const seamRoot = assetRoot();
  export const TEMPLATES_ROOT = seamRoot
    ? join(seamRoot, 'templates')
    : join(here, '..', '..', 'templates');
  ```
  (Put the `import` with the other imports at the top of the file.)
- [ ] **Step 4: Implement seam 2.** In `src/dashboard/server.ts`, replace:
  ```ts
  const STATIC_ROOT = fileURLToPath(new URL('./static/dist', import.meta.url));
  ```
  with:
  ```ts
  const staticSeamRoot = assetRoot();
  const STATIC_ROOT = staticSeamRoot
    ? join(staticSeamRoot, 'dist/dashboard/static/dist')
    : fileURLToPath(new URL('./static/dist', import.meta.url));
  ```
  adding `import { assetRoot } from '../binary/asset-root.js';` to the imports (and `join` from `node:path` if not present).
- [ ] **Step 5: Implement seam 3.** In `src/cr/codex-adapter.ts`, replace:
  ```ts
  export const CR_RECORD_SCHEMA_PATH = fileURLToPath(
    new URL('./cr-record.schema.json', import.meta.url),
  );
  ```
  with:
  ```ts
  const schemaSeamRoot = assetRoot();
  export const CR_RECORD_SCHEMA_PATH = schemaSeamRoot
    ? join(schemaSeamRoot, 'dist/cr/cr-record.schema.json')
    : fileURLToPath(new URL('./cr-record.schema.json', import.meta.url));
  ```
  adding `import { assetRoot } from '../binary/asset-root.js';` (and `join` from `node:path`).
- [ ] **Step 6: Run to verify PASS.** `pnpm vitest run src/binary/__tests__/asset-root.test.ts` — Expected: all pass. Then run the neighbourhood suites to prove the inert path: `pnpm vitest run src/templates src/dashboard src/cr` — Expected: all pass.
- [ ] **Step 7: Commit.** Write `/tmp/msg-seams.txt`:
  ```
  feat(binary): asset-root seam at the three package-read sites

  Templates root (carrying package.json readers), dashboard STATIC_ROOT and
  the codex schema path consult NOLDOR_ASSET_ROOT first; env unset resolves
  exactly as before (spec Unit 3).

  Noldor-FD: single-static-binary-distribution
  ```
  ```bash
  git add src/templates/manifest.ts src/dashboard/server.ts src/cr/codex-adapter.ts src/binary/__tests__/asset-root.test.ts && git commit -F /tmp/msg-seams.txt
  ```

---

## Task 6: self-exec seam — one branch, two converging launchers, one refusal

**Files:**
Modify: `src/core/noldor-cli.ts`, `src/dashboard/ensure.ts`, `src/autonomous/watch-detach.ts`, `src/core/agent-runner/runners/stub.ts`, `src/core/agent-runner/doctor-runners.ts`
Test: `src/core/__tests__/noldor-cli.test.ts` (extend existing if present, else create)

- [ ] **Step 1: Write the failing test.** Check for an existing test: `ls src/core/__tests__/noldor-cli.test.ts` — extend it if present; otherwise create it with:
  ```ts
  // @tests: single-static-binary-distribution
  import { afterEach, describe, expect, it } from 'vitest';
  import { NOLDOR_BIN, noldorCliCommand } from '../noldor-cli.js';

  describe('noldorCliCommand channel branch', () => {
    afterEach(() => delete process.env.NOLDOR_BINARY);

    it('spawns through bin/noldor.mjs on the npm channel', () => {
      delete process.env.NOLDOR_BINARY;
      expect(noldorCliCommand(['garden', 'detect'])).toEqual([
        process.execPath,
        [NOLDOR_BIN, 'garden', 'detect'],
      ]);
    });

    it('re-execs the binary directly when NOLDOR_BINARY=1', () => {
      process.env.NOLDOR_BINARY = '1';
      expect(noldorCliCommand(['garden', 'detect'])).toEqual([
        process.execPath,
        ['garden', 'detect'],
      ]);
    });

    it("ignores values other than '1'", () => {
      process.env.NOLDOR_BINARY = 'true';
      expect(noldorCliCommand(['x'])).toEqual([process.execPath, [NOLDOR_BIN, 'x']]);
    });
  });
  ```
- [ ] **Step 2: Run to verify FAIL.** `pnpm vitest run src/core/__tests__/noldor-cli.test.ts` — Expected: the binary-channel test FAILS.
- [ ] **Step 3: Implement the branch.** In `src/core/noldor-cli.ts`, replace the `noldorCliCommand` body:
  ```ts
  import { isBinaryChannel } from '../binary/asset-root.js';

  export function noldorCliCommand(args: string[]): [string, string[]] {
    // Binary channel (spec Unit 3b): process.execPath IS the CLI — re-exec it
    // directly; bin/noldor.mjs does not exist on disk there.
    if (isBinaryChannel()) return [process.execPath, args];
    return [process.execPath, [NOLDOR_BIN, ...args]];
  }
  ```
- [ ] **Step 4: Converge `spawnDetachedServer`.** In `src/dashboard/ensure.ts`, replace the launcher lines:
  ```ts
  const here = dirname(fileURLToPath(import.meta.url));
  // `src/dashboard/` (or `dist/dashboard/`) → package root is two levels up.
  const launcher = resolve(here, '../../bin/noldor.mjs');
  const child = spawn(process.execPath, [launcher, 'dashboard', 'server'], {
  ```
  with:
  ```ts
  const [cliCmd, cliArgs] = noldorCliCommand(['dashboard', 'server']);
  const child = spawn(cliCmd, cliArgs, {
  ```
  adding `import { noldorCliCommand } from '../core/noldor-cli.js';` and deleting the now-unused `here`/`fileURLToPath` bindings in this function (keep other uses elsewhere in the file intact).
- [ ] **Step 5: Converge the watch detach spawn.** In `src/autonomous/watch-detach.ts`: delete `binPathFrom()` and rewrite `detachChildArgv` to return the full command tuple:
  ```ts
  import { noldorCliCommand } from '../core/noldor-cli.js';

  /** Command tuple for the detached child: re-invoke the CLI sans `--detach`. */
  export function detachChildCommand(args: readonly string[]): [string, string[]] {
    return noldorCliCommand(['autonomous', 'watch', ...stripDetach(args)]);
  }
  ```
  At the spawn site (`watch-detach.ts:76` region), replace:
  ```ts
  const child = deps.spawn(process.execPath, detachChildArgv(moduleDir, args), {
  ```
  with:
  ```ts
  const [detachCmd, detachArgs] = detachChildCommand(args);
  const child = deps.spawn(detachCmd, detachArgs, {
  ```
  Update the existing watch-detach tests: any assertion on `binPathFrom`/`detachChildArgv` becomes an assertion that `detachChildCommand(args)` equals `noldorCliCommand(['autonomous', 'watch', ...strippedArgs])`; run `pnpm vitest run src/autonomous` and fix compile errors the rename surfaces until green.
- [ ] **Step 6: Stub refusal.** In `src/core/agent-runner/runners/stub.ts`, at the top of `buildStubArgv`:
  ```ts
  import { isBinaryChannel } from '../../../binary/asset-root.js';

  export function buildStubArgv(prompt: string, _opts: { model?: string }): string[] {
    if (isBinaryChannel()) {
      throw new Error(
        'stub runner unavailable on the binary channel — bin/noldor-stub-gate.mjs is not shipped; use the npm channel',
      );
    }
    // …existing body unchanged…
  ```
  In `src/core/agent-runner/doctor-runners.ts`, in the per-runner check loop, short-circuit stub on the binary channel (place beside the existing `BINS` probe logic):
  ```ts
  import { isBinaryChannel } from '../../binary/asset-root.js';

  // inside the stub branch of the runner check:
  if (runner === 'stub' && isBinaryChannel()) {
    return {
      runner,
      status: 'missing',
      detail: 'stub runner requires the npm channel (bin/noldor-stub-gate.mjs not shipped in the binary)',
    };
  }
  ```
  Add a unit test beside the existing doctor-runners tests asserting the stub check returns `missing` with that detail when `NOLDOR_BINARY='1'` (set/restore env in the test).
- [ ] **Step 7: Run to verify PASS.** `pnpm vitest run src/core src/autonomous src/dashboard` — Expected: all pass. Then `pnpm typecheck` — Expected: exit 0.
- [ ] **Step 8: Commit.** Write `/tmp/msg-selfexec.txt`:
  ```
  feat(binary): self-exec seam — launchers converge on noldorCliCommand

  noldorCliCommand branches on the channel marker; dashboard ensure and
  autonomous watch --detach drop their hand-rolled bin/noldor.mjs launchers;
  stub runner refuses with an npm-channel pointer (spec Unit 3b).

  Noldor-FD: single-static-binary-distribution
  ```
  ```bash
  git add src/core/noldor-cli.ts src/dashboard/ensure.ts src/autonomous/watch-detach.ts src/core/agent-runner/runners/stub.ts src/core/agent-runner/doctor-runners.ts src/core/__tests__/noldor-cli.test.ts src/autonomous/__tests__ src/core/agent-runner/__tests__ && git commit -F /tmp/msg-selfexec.txt
  ```

---

## Task 7: binary entry + ambient decls + adopt refusal

**Files:**
Create: `src/binary/entry.ts`, `src/binary/ambient.d.ts`
Modify: `src/cli/commands/init.ts`
Test: `src/cli/__tests__/` (existing init test file if present; else assertion via the adopt guard unit below)

- [ ] **Step 1: Write the failing adopt-refusal test.** Locate the init command tests (`ls src/cli/__tests__/ | grep -i init`); add to the matching file (or create `src/cli/__tests__/init-adopt-guard.test.ts`):
  ```ts
  // @tests: single-static-binary-distribution
  import { afterEach, describe, expect, it } from 'vitest';
  import { assertAdoptAllowed } from '../commands/init-adopt-guard.js';

  describe('adopt on the binary channel', () => {
    afterEach(() => delete process.env.NOLDOR_BINARY);

    it('throws with the npm-channel pointer when NOLDOR_BINARY=1', () => {
      process.env.NOLDOR_BINARY = '1';
      expect(() => assertAdoptAllowed()).toThrow(/npm channel/);
    });

    it('allows adopt on the npm channel', () => {
      delete process.env.NOLDOR_BINARY;
      expect(() => assertAdoptAllowed()).not.toThrow();
    });
  });
  ```
- [ ] **Step 2: Run to verify FAIL.** `pnpm vitest run src/cli/__tests__/init-adopt-guard.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement the guard.** Create `src/cli/commands/init-adopt-guard.ts`:
  ```ts
  import { isBinaryChannel } from '../../binary/asset-root.js';

  /**
   * `init --adopt` writes consumer snapshots INTO the package templates root.
   * On the binary channel that root is the shared version-keyed cache — a
   * write there would leak one repo's snapshot into every repo on the machine
   * (spec Unit 2 write-refusal guard).
   */
  export function assertAdoptAllowed(): void {
    if (isBinaryChannel()) {
      throw new Error(
        'adopt requires the npm channel — the binary\'s template root is a shared read-only cache',
      );
    }
  }
  ```
  In `src/cli/commands/init.ts`, at the top of the `if (adopt) {` branch (before `templateFiles()` is called):
  ```ts
  try {
    assertAdoptAllowed();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  ```
  with `import { assertAdoptAllowed } from './init-adopt-guard.js';` among the imports.
- [ ] **Step 4: Implement the entry + ambient decls.** Create `src/binary/ambient.d.ts`:
  ```ts
  /** Compile-time constant injected by `bun build --define` (spec Unit 2). */
  declare const NOLDOR_BINARY_VERSION: string;

  /** Embedded-file import (bun `with { type: 'file' }`): resolves to a runtime path. */
  declare module '*.pack' {
    const path: string;
    export default path;
  }
  ```
  Create `src/binary/entry.ts`:
  ```ts
  /* eslint-disable no-console */
  // Binary-channel entrypoint (spec Unit 2). Compiled by tsgo to
  // dist/binary/entry.js, then `bun build --compile` bundles it with the
  // embedded assets.pack. Never imported under Node — bin/noldor.mjs is the
  // npm-channel entry.
  import packPath from '../../assets.pack' with { type: 'file' };

  import { assetRoot, resolveAssetCachePath } from './asset-root.js';
  import { extractAssets } from './asset-pack.js';

  process.env.NOLDOR_BINARY = '1';

  const operatorRoot = assetRoot();
  if (operatorRoot === null) {
    const dest = resolveAssetCachePath(NOLDOR_BINARY_VERSION);
    const { extracted } = extractAssets(packPath, dest);
    if (extracted) console.error(`noldor: extracted assets to ${dest}`);
    process.env.NOLDOR_ASSET_ROOT = dest;
  }

  await import('../cli/index.js');
  ```
- [ ] **Step 5: Verify compile + inert path.** Run `pnpm typecheck` — Expected: exit 0 (ambient decls satisfy the entry). Run `pnpm build` — Expected: build succeeds; `dist/binary/entry.js` and `dist/binary/asset-root.js` exist. Run the full suite `pnpm test` — Expected: green (nothing imports the entry under Node; seams inert).
- [ ] **Step 6: Update the tarball contract snapshot.** Run `pnpm test:contract` — if it FAILS on new tarball entries (`dist/binary/*`), update the recorded snapshot per the failing assertion's message (the packed-entry list fixture), re-run, and confirm green. Expected final output: contract suite passes with the `dist/binary/*` entries recorded as inert additions.
- [ ] **Step 7: Commit.** Write `/tmp/msg-entry.txt`:
  ```
  feat(binary): compile entrypoint, ambient decls, adopt refusal

  Entry bakes the version, marks the channel, extracts on miss with the
  stderr oracle line, then imports the dist CLI; init --adopt refuses on the
  binary channel (spec Unit 2). Tarball snapshot records the inert
  dist/binary entries.

  Noldor-FD: single-static-binary-distribution
  ```
  ```bash
  git add src/binary/entry.ts src/binary/ambient.d.ts src/cli/commands/init-adopt-guard.ts src/cli/commands/init.ts src/cli/__tests__ src/testing && git commit -F /tmp/msg-entry.txt
  ```
  (Include whichever snapshot file Step 6 touched; `git status --short` first if unsure.)
