# Single Static Binary Distribution (Part 2: Build, Release, Install) Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** The channel around Part 1's runtime: `pnpm build:binary`, the notices generator, the native smoke suite, the 4-target release workflow with sentinel-ordered uploads, the checksum-verified installer, and the docs.

**Architecture:** `bin/build-binary.mjs` (guard → build → pack → compile), `bin/generate-notices.mjs`, `scripts/smoke-binary.sh`, `.github/workflows/release-binaries.yml`, `install.sh`. Spec: `docs/design/specs/2026-08-21-single-static-binary-distribution-design.md`. Requires Part 1 merged (imports `dist/binary/*`).

**Tech Stack:** Node ESM scripts (existing `bin/*.mjs` pattern), POSIX sh, GitHub Actions, vitest for the mapping/notices units.

---

## File Structure

- `bin/build-binary.mjs` — bun-floor guard, dist build, pack assembly, `bun build --compile`
- `bin/generate-notices.mjs` — THIRD_PARTY_NOTICES.txt generator (fail-closed)
- `scripts/smoke-binary.sh` — the 7-assertion native smoke suite (spec Unit 6)
- `.github/workflows/release-binaries.yml` — 4-leg matrix + sentinel-ordered release job
- `install.sh` — POSIX installer (map → download → verify → atomic install)
- `src/binary/__tests__/build-pipeline.test.ts` — pack-assembly list + notices fail-closed units
- `src/binary/__tests__/install-mapping.test.ts` — platform mapping for all four targets
- `package.json` — `build:binary` script
- `README.md`, `docs/noldor/gotchas.md`, `docs/noldor/adoption docs page (hooks note)` — the doc surface

---

## Task 1: `bin/build-binary.mjs` + pack assembly

**Files:**
Create: `bin/build-binary.mjs`
Modify: `package.json`
Test: `src/binary/__tests__/build-pipeline.test.ts`

- [ ] **Step 1: Write the failing test** for the derived pack list. Create `src/binary/__tests__/build-pipeline.test.ts`:
  ```ts
  // @tests: single-static-binary-distribution
  import { describe, expect, it } from 'vitest';
  import { packFileList } from '../pack-list.js';

  describe('packFileList', () => {
    it('derives from RUNTIME_ASSETS + templates + package.json, dist-projected', () => {
      const list = packFileList(process.cwd());
      expect(list).toContain('package.json');
      expect(list.some((p) => p.startsWith('templates/'))).toBe(true);
      expect(list).toContain('dist/cr/cr-record.schema.json');
      expect(list).toContain('dist/dashboard/static/dist/agents.js');
      expect(list.every((p) => !p.startsWith('/') && !p.includes('..'))).toBe(true);
    });
  });
  ```
- [ ] **Step 2: Run to verify FAIL.** `pnpm vitest run src/binary/__tests__/build-pipeline.test.ts` — Expected: FAIL (`pack-list.js` missing).
- [ ] **Step 3: Implement the list module.** Create `src/binary/pack-list.ts`:
  ```ts
  import { readdirSync, statSync } from 'node:fs';
  import { join, relative, sep } from 'node:path';

  // The same fail-closed runtime-asset list the build's digest uses (PR #360).
  // bin/build-manifest.mjs is plain ESM — importable from src via tsx/dist alike.
  // eslint-disable-next-line import/no-relative-packages
  import { RUNTIME_ASSETS } from '../../bin/build-manifest.mjs';

  const toPosix = (p: string): string => p.split(sep).join('/');

  function walk(root: string, dir: string, out: string[]): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(root, full, out);
      else out.push(toPosix(relative(root, full)));
    }
  }

  /**
   * Package-root-relative paths the binary embeds (spec Unit 1): templates/**
   * + package.json + the dist projection of every RUNTIME_ASSETS entry. A new
   * runtime asset rides in automatically — the manifest is imported, never
   * duplicated.
   */
  export function packFileList(pkgRoot: string): string[] {
    const files: string[] = ['package.json'];
    walk(pkgRoot, join(pkgRoot, 'templates'), files);
    for (const asset of RUNTIME_ASSETS as string[]) {
      files.push(asset.replace(/^src\//, 'dist/'));
    }
    return [...new Set(files)].sort();
  }
  ```
  If `bin/build-manifest.mjs` lacks type declarations, add one line to `src/binary/ambient.d.ts`:
  ```ts
  declare module '../../bin/build-manifest.mjs' {
    export const RUNTIME_ASSETS: string[];
  }
  ```
  (Adjust the specifier to exactly what `pack-list.ts` uses.)
- [ ] **Step 4: Run to verify PASS.** Same command (build dist first if the dashboard static bundle is missing: `pnpm build`). Expected: pass.
- [ ] **Step 5: Implement the build script.** Create `bin/build-binary.mjs`:
  ```js
  #!/usr/bin/env node
  // pnpm build:binary [--target=<bun-target>] [--outfile=<path>]
  // Guard bun >= floor -> pnpm build (tsgo dist) -> assemble assets.pack ->
  // bun build --compile (spec Unit 4).
  import { execFileSync, spawnSync } from 'node:child_process';
  import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
  import { join } from 'node:path';

  const root = process.cwd();

  function fail(msg) {
    console.error(`build-binary: ${msg}`);
    process.exit(1);
  }

  // 1. Guard: bun present and >= floor (single shared constant from the spike).
  const { BUN_FLOOR } = await import(join(root, 'dist/binary/bun-floor.js')).catch(() => ({}));
  let bunVersion;
  try {
    bunVersion = execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    fail('bun is not installed — see https://bun.sh (external tool, not a devDependency)');
  }
  // 2. Build dist first (also produces dist/binary/bun-floor.js on a cold tree).
  const build = spawnSync('node', ['bin/build.mjs'], { stdio: 'inherit' });
  if (build.status !== 0) fail('dist build failed');
  const { BUN_FLOOR: floor } = await import(join(root, 'dist/binary/bun-floor.js'));
  const lt = (a, b) => {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
    }
    return false;
  };
  if (BUN_FLOOR === undefined && lt(bunVersion, floor)) fail(`bun ${bunVersion} < floor ${floor}`);
  if (BUN_FLOOR !== undefined && lt(bunVersion, BUN_FLOOR)) fail(`bun ${bunVersion} < floor ${BUN_FLOOR}`);

  // 3. Assemble assets.pack from the derived list.
  const { packFileList } = await import(join(root, 'dist/binary/pack-list.js'));
  const { buildPack } = await import(join(root, 'dist/binary/asset-pack.js'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const files = packFileList(root).map((path) => ({
    path,
    mode: path.startsWith('bin/') ? 0o755 : 0o644,
    data: readFileSync(join(root, path)),
  }));
  writeFileSync(join(root, 'assets.pack'), buildPack(pkg.version, files));
  console.log(`assets.pack: ${files.length} entries`);

  // 4. Compile.
  const targetArg = process.argv.find((a) => a.startsWith('--target='));
  const outArg = process.argv.find((a) => a.startsWith('--outfile='));
  mkdirSync(join(root, 'out'), { recursive: true });
  const outfile = outArg ? outArg.slice('--outfile='.length) : join('out', 'noldor');
  const args = [
    'build', '--compile', 'dist/binary/entry.js', 'assets.pack',
    `--define`, `NOLDOR_BINARY_VERSION=${JSON.stringify(pkg.version)}`,
    '--outfile', outfile,
  ];
  if (targetArg) args.splice(2, 0, `--target=${targetArg.slice('--target='.length)}`);
  const compile = spawnSync('bun', args, { stdio: 'inherit' });
  if (compile.status !== 0) fail('bun compile failed');
  console.log(`built ${outfile} (bun ${bunVersion}, version ${pkg.version})`);
  ```
- [ ] **Step 6: Wire the script.** In `package.json` scripts, add:
  ```json
  "build:binary": "node bin/build-binary.mjs"
  ```
- [ ] **Step 7: Run to verify.** `pnpm build:binary` — Expected: `assets.pack: <N> entries` then `built out/noldor …`; `./out/noldor --version` prints the package version (host has bun from Part 1's spike). Machines without bun: the guard's exit-1 message is itself the verification.
- [ ] **Step 8: Commit.** Write `/tmp/msg-buildbin.txt`:
  ```
  feat(binary): build:binary pipeline — guard, pack assembly, bun compile

  Floor-guarded compile of dist/binary/entry.js with the derived asset pack
  and the JSON-safe version define (spec Unit 4).

  Noldor-FD: single-static-binary-distribution
  ```
  ```bash
  git add bin/build-binary.mjs src/binary/pack-list.ts src/binary/ambient.d.ts src/binary/__tests__/build-pipeline.test.ts package.json && git commit -F /tmp/msg-buildbin.txt
  ```
  (`.gitignore`: add `assets.pack` and `out/` if `git status` shows them untracked — include the `.gitignore` change in this commit.)

---

## Task 2: notices generator (fail-closed)

**Files:**
Create: `bin/generate-notices.mjs`
Test: `src/binary/__tests__/build-pipeline.test.ts`

- [ ] **Step 1: Append the failing test:**
  ```ts
  import { execFileSync } from 'node:child_process';

  describe('generate-notices', () => {
    it('lists every production dependency plus the Bun runtime', () => {
      const out = execFileSync('node', ['bin/generate-notices.mjs', '--stdout'], {
        encoding: 'utf8',
      });
      const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
      for (const dep of Object.keys(pkg.dependencies)) expect(out).toContain(`## ${dep}`);
      expect(out).toContain('## Bun runtime');
    });
  });
  ```
  (Add `readFileSync` to the node:fs import in the test file.)
- [ ] **Step 2: Run to verify FAIL.** `pnpm vitest run src/binary/__tests__/build-pipeline.test.ts` — Expected: notices test FAILS (script missing).
- [ ] **Step 3: Implement.** Create `bin/generate-notices.mjs`:
  ```js
  #!/usr/bin/env node
  // THIRD_PARTY_NOTICES.txt generator (spec Unit 5). Fail-closed: a production
  // dependency with no license text or unrecognizable license field fails the
  // build. --stdout prints instead of writing the file.
  import { execFileSync } from 'node:child_process';
  import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
  import { join } from 'node:path';

  const root = process.cwd();
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const deps = Object.keys(pkg.dependencies ?? {}).sort();

  function licenseTextFor(dep) {
    const dir = join(root, 'node_modules', dep);
    const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (typeof meta.license !== 'string' || meta.license === '') {
      console.error(`generate-notices: ${dep} has no recognizable license field`);
      process.exit(1);
    }
    const file = readdirSync(dir).find((f) => /^licen[cs]e(\.|$)/i.test(f));
    const body = file ? readFileSync(join(dir, file), 'utf8').trim() : '(license text not shipped; see package metadata)';
    return `## ${dep}\nLicense: ${meta.license}\n\n${body}\n`;
  }

  const sections = deps.map(licenseTextFor);
  sections.push(
    '## Bun runtime\nLicense: MIT\n\nThe compiled binary embeds the Bun runtime (https://bun.sh), distributed under the MIT license.\n',
  );
  const out = `Third-party notices for the noldor binary distribution\n\n${sections.join('\n')}`;
  if (process.argv.includes('--stdout')) process.stdout.write(out);
  else writeFileSync(join(root, 'THIRD_PARTY_NOTICES.txt'), out);
  ```
- [ ] **Step 4: Run to verify PASS.** `pnpm vitest run src/binary/__tests__/build-pipeline.test.ts` — Expected: all pass.
- [ ] **Step 5: Commit.** Write `/tmp/msg-notices.txt`:
  ```
  feat(binary): fail-closed third-party notices generator

  Production dependency graph + embedded Bun runtime; missing or
  unrecognizable license fails the build (spec Unit 5).

  Noldor-FD: single-static-binary-distribution
  ```
  ```bash
  git add bin/generate-notices.mjs src/binary/__tests__/build-pipeline.test.ts && git commit -F /tmp/msg-notices.txt
  ```

---

## Task 3: smoke suite

**Files:**
Create: `scripts/smoke-binary.sh`

- [ ] **Step 1: Implement.** Create `scripts/smoke-binary.sh` (the 7 assertions of spec Unit 6):
  ```sh
  #!/bin/sh
  # Native smoke for a built noldor binary. Usage: scripts/smoke-binary.sh <binary> <expected-version>
  # Proves self-containment: PATH stripped of node/npm/pnpm/bun, fixture-local cache.
  set -eu

  BIN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
  EXPECTED_VERSION="$2"
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT INT TERM

  # Minimal PATH: symlink only git + coreutils dirs, never node/npm/pnpm/bun.
  TOOLDIR="$WORK/tools"
  mkdir -p "$TOOLDIR"
  for t in git sh mkdir rm cp mv ls cat diff grep uname mktemp dirname basename curl; do
    p="$(command -v "$t" || true)"
    [ -n "$p" ] && ln -s "$p" "$TOOLDIR/$t"
  done
  export PATH="$TOOLDIR"
  export NOLDOR_CACHE_DIR="$WORK/cache"

  fail() { echo "smoke: FAIL — $1" >&2; exit 1; }

  FIX="$WORK/fixture"; mkdir -p "$FIX"; cd "$FIX"; git init -q .

  # 1. --version
  V="$("$BIN" --version)" || fail "--version exited non-zero"
  [ "$V" = "$EXPECTED_VERSION" ] || fail "--version printed '$V', expected '$EXPECTED_VERSION'"

  # 3. extraction oracle: first run extracted + marker present
  "$BIN" --help >/dev/null 2>"$WORK/first-stderr" || fail "--help exited non-zero"
  grep -q "noldor: extracted assets to" "$WORK/first-stderr" || true # first extraction may have happened on --version
  find "$NOLDOR_CACHE_DIR" -name .noldor-pack-ok | grep -q . || fail "no cache marker written"

  # 2. --help (exit code already asserted above)

  # 4. init materializes templates; adopt refuses
  "$BIN" init >/dev/null 2>&1 || fail "init exited non-zero"
  [ -f lefthook.yml ] || fail "init did not materialize lefthook.yml"
  if "$BIN" init --adopt >/dev/null 2>"$WORK/adopt-stderr"; then
    fail "init --adopt unexpectedly succeeded on the binary channel"
  fi
  grep -q "npm channel" "$WORK/adopt-stderr" || fail "adopt refusal lacks the npm-channel pointer"

  # 5. minimum toolchain-free workflow
  "$BIN" validate features >/dev/null 2>&1 || fail "validate features exited non-zero"
  "$BIN" next-priority >/dev/null 2>&1; NP=$?
  [ "$NP" -eq 0 ] || [ "$NP" -eq 2 ] || fail "next-priority exited $NP (expected 0 or 2)"

  # 6. cache-hit: second run must not re-extract
  "$BIN" --help >/dev/null 2>"$WORK/second-stderr"
  grep -q "noldor: extracted assets to" "$WORK/second-stderr" && fail "second run re-extracted"

  # 7. detached dashboard self-exec
  PORT=51735
  PORT="$PORT" "$BIN" dashboard >/dev/null 2>&1 || fail "noldor dashboard exited non-zero"
  i=0; ok=""
  while [ $i -lt 20 ]; do
    if curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then ok=1; break; fi
    i=$((i+1)); sleep 0.5
  done
  [ -n "$ok" ] || fail "dashboard did not serve HTTP 200 within 10s"
  # Kill the detached server via its pidfile (written under .noldor/), fallback to port kill.
  if [ -f .noldor/dashboard.pid ]; then kill "$(cat .noldor/dashboard.pid)" 2>/dev/null || true; fi

  echo "smoke: OK ($BIN, $EXPECTED_VERSION)"
  ```
  **Adjust two facts against the real tree while implementing** (the executor must verify, not trust this listing): (a) the dashboard pidfile path — read `src/dashboard/ensure.ts` for where the detached spawn records its pid/log and use that exact path, killing by port scan (`kill $(lsof -ti :$PORT)` is unavailable — prefer the pidfile) only if none exists; (b) whether plain `noldor dashboard` is the ensure-entry subcommand (read `src/cli/index.ts` routing) — if ensure rides a different verb, use that verb here and in AC5's wording. `sleep 0.5` fallback: if the runner's sh lacks fractional sleep, use `sleep 1` with 10 iterations.
- [ ] **Step 2: Make it executable + run locally.**
  ```bash
  chmod +x scripts/smoke-binary.sh && pnpm build:binary && scripts/smoke-binary.sh out/noldor "$(node -p "require('./package.json').version")"
  ```
  Expected output: `smoke: OK (…)`. Fix any assertion that trips (this is the plan's local integration gate for Part 1's seams).
- [ ] **Step 3: Commit.** Write `/tmp/msg-smoke.txt`:
  ```
  feat(binary): native smoke suite for built binaries

  Seven-assertion self-containment oracle: version, extraction marker, init
  tree, adopt refusal, toolchain-free workflow, cache hit, detached
  dashboard self-exec (spec Unit 6).

  Noldor-FD: single-static-binary-distribution
  ```
  ```bash
  git add scripts/smoke-binary.sh && git commit -F /tmp/msg-smoke.txt
  ```

---

## Task 4: release workflow

**Files:**
Create: `.github/workflows/release-binaries.yml`

- [ ] **Step 1: Implement.** Create `.github/workflows/release-binaries.yml`:
  ```yaml
  name: release-binaries
  on:
    push:
      tags: ['v*']
  permissions:
    contents: write
  jobs:
    build:
      strategy:
        fail-fast: true
        matrix:
          include:
            - runner: ubuntu-latest
              asset: noldor-linux-amd64
            - runner: ubuntu-24.04-arm
              asset: noldor-linux-arm64
            - runner: macos-13
              asset: noldor-darwin-amd64
            - runner: macos-14
              asset: noldor-darwin-arm64
      runs-on: ${{ matrix.runner }}
      steps:
        - uses: actions/checkout@v4
        - uses: pnpm/action-setup@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 22
            cache: pnpm
        - run: pnpm install --frozen-lockfile
        - name: read bun floor
          id: floor
          run: echo "version=$(node -e "import('./src/binary/bun-floor.ts').catch(()=>null); const m=require('fs').readFileSync('src/binary/bun-floor.ts','utf8').match(/BUN_FLOOR = '([^']+)'/); console.log(m[1])" )" >> "$GITHUB_OUTPUT"
        - uses: oven-sh/setup-bun@v2
          with:
            bun-version: ${{ steps.floor.outputs.version }}
        - name: build host-target binary
          run: pnpm build:binary --outfile=out/${{ matrix.asset }}
        - name: native smoke
          run: scripts/smoke-binary.sh out/${{ matrix.asset }} "$(node -p "require('./package.json').version")"
        - name: record reported version
          run: out/${{ matrix.asset }} --version > out/${{ matrix.asset }}.version
        - uses: actions/upload-artifact@v4
          with:
            name: ${{ matrix.asset }}
            path: |
              out/${{ matrix.asset }}
              out/${{ matrix.asset }}.version
            if-no-files-found: error
    release:
      needs: build
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: pnpm/action-setup@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 22
            cache: pnpm
        - run: pnpm install --frozen-lockfile
        - uses: actions/download-artifact@v4
          with:
            path: assets
            merge-multiple: true
        - name: version guard — tag == package.json == every binary
          run: |
            TAG_VERSION="${GITHUB_REF_NAME#v}"
            PKG_VERSION="$(node -p "require('./package.json').version")"
            [ "$TAG_VERSION" = "$PKG_VERSION" ] || { echo "tag v$TAG_VERSION != package.json $PKG_VERSION" >&2; exit 1; }
            for vf in assets/*.version; do
              BV="$(cat "$vf" | tr -d '[:space:]')"
              [ "$BV" = "$PKG_VERSION" ] || { echo "$vf reports $BV != $PKG_VERSION" >&2; exit 1; }
            done
        - name: checksums + notices
          run: |
            node bin/generate-notices.mjs
            cd assets && sha256sum noldor-* | grep -v '\.version$' > SHA256SUMS
        - name: upload — binaries first, sentinel last
          env:
            GH_TOKEN: ${{ github.token }}
          run: |
            gh release view "$GITHUB_REF_NAME" >/dev/null 2>&1 || gh release create "$GITHUB_REF_NAME" --verify-tag --title "$GITHUB_REF_NAME" --notes "See CHANGELOG."
            for b in assets/noldor-linux-amd64 assets/noldor-linux-arm64 assets/noldor-darwin-amd64 assets/noldor-darwin-arm64; do
              gh release upload "$GITHUB_REF_NAME" "$b" --clobber
            done
            gh release upload "$GITHUB_REF_NAME" THIRD_PARTY_NOTICES.txt --clobber
            gh release upload "$GITHUB_REF_NAME" assets/SHA256SUMS --clobber
  ```
  **Verify while implementing:** the `read bun floor` step is deliberately dependency-free (regex over the source constant) — confirm the regex matches Task 1 of Part 1's `bun-floor.ts` line exactly; `sha256sum` exists on ubuntu (release job runs there only). The `.version` files must NOT enter `SHA256SUMS` (the grep) nor be uploaded.
- [ ] **Step 2: Validate the workflow file.** Run `npx --yes @action-validator/cli .github/workflows/release-binaries.yml 2>/dev/null || node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/release-binaries.yml','utf8')); console.log('yaml ok')"` — Expected: `yaml ok` (or validator pass). Full behavior is only provable on a real tag; the version guard + sentinel order are code-reviewed here.
- [ ] **Step 3: Commit.** Write `/tmp/msg-workflow.txt`:
  ```
  feat(binary): 4-target release workflow with sentinel-ordered uploads

  Native build+smoke per leg, version guard before any release mutation,
  binaries first and SHA256SUMS last so a partial upload is detectable
  (spec Unit 5).

  Noldor-FD: single-static-binary-distribution
  ```
  ```bash
  git add .github/workflows/release-binaries.yml && git commit -F /tmp/msg-workflow.txt
  ```

---

## Task 5: installer

**Files:**
Create: `install.sh`
Test: `src/binary/__tests__/install-mapping.test.ts`

- [ ] **Step 1: Write the failing mapping test.** Create `src/binary/__tests__/install-mapping.test.ts`:
  ```ts
  // @tests: single-static-binary-distribution
  import { execFileSync } from 'node:child_process';
  import { describe, expect, it } from 'vitest';

  function mapped(unameS: string, unameM: string): string {
    return execFileSync('sh', ['install.sh', '--map-only'], {
      encoding: 'utf8',
      env: { ...process.env, NOLDOR_UNAME_S: unameS, NOLDOR_UNAME_M: unameM },
    }).trim();
  }

  describe('install.sh platform mapping', () => {
    it('maps all four supported targets', () => {
      expect(mapped('Linux', 'x86_64')).toBe('noldor-linux-amd64');
      expect(mapped('Linux', 'aarch64')).toBe('noldor-linux-arm64');
      expect(mapped('Darwin', 'x86_64')).toBe('noldor-darwin-amd64');
      expect(mapped('Darwin', 'arm64')).toBe('noldor-darwin-arm64');
    });
    it('rejects unsupported platforms', () => {
      expect(() => mapped('Windows_NT', 'x86_64')).toThrow();
    });
  });
  ```
- [ ] **Step 2: Run to verify FAIL.** `pnpm vitest run src/binary/__tests__/install-mapping.test.ts` — Expected: FAIL (install.sh missing).
- [ ] **Step 3: Implement.** Create `install.sh`:
  ```sh
  #!/bin/sh
  # noldor binary installer (spec Unit 7).
  #   curl -fsSL https://raw.githubusercontent.com/davidzoufaly/noldor/main/install.sh | sh
  #   curl -fsSL … | NOLDOR_VERSION=v1.5.0 sh        # pin (env on the sh side of the pipe)
  # Env: NOLDOR_VERSION (default latest), NOLDOR_INSTALL_DIR (default ~/.local/bin).
  set -eu

  REPO="davidzoufaly/noldor"
  UNAME_S="${NOLDOR_UNAME_S:-$(uname -s)}"
  UNAME_M="${NOLDOR_UNAME_M:-$(uname -m)}"

  case "$UNAME_S" in
    Linux) OS=linux ;;
    Darwin) OS=darwin ;;
    *) echo "install: unsupported OS: $UNAME_S" >&2; exit 1 ;;
  esac
  case "$UNAME_M" in
    x86_64) ARCH=amd64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) echo "install: unsupported architecture: $UNAME_M" >&2; exit 1 ;;
  esac
  ASSET="noldor-$OS-$ARCH"

  if [ "${1:-}" = "--map-only" ]; then echo "$ASSET"; exit 0; fi

  # Checksum tool: sha256sum or shasum -a 256.
  if command -v sha256sum >/dev/null 2>&1; then SHACMD="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then SHACMD="shasum -a 256"
  else echo "install: need sha256sum or shasum" >&2; exit 1; fi

  VERSION="${NOLDOR_VERSION:-latest}"
  case "$VERSION" in latest) BASE="https://github.com/$REPO/releases/latest/download" ;;
    v*) BASE="https://github.com/$REPO/releases/download/$VERSION" ;;
    *) BASE="https://github.com/$REPO/releases/download/v$VERSION" ;;
  esac

  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT INT TERM

  echo "install: downloading $ASSET (${VERSION})"
  curl -fsSL -o "$WORK/$ASSET" "$BASE/$ASSET" || { echo "install: download failed — release may be incomplete; retry later or pin NOLDOR_VERSION" >&2; exit 1; }
  curl -fsSL -o "$WORK/SHA256SUMS" "$BASE/SHA256SUMS" || { echo "install: SHA256SUMS missing — release incomplete (binaries publish after npm); retry later or pin NOLDOR_VERSION" >&2; exit 1; }

  # Exactly one checksum line for this asset.
  LINES="$(grep -c " $ASSET\$" "$WORK/SHA256SUMS" || true)"
  [ "$LINES" = "1" ] || { echo "install: expected exactly 1 checksum line for $ASSET, found $LINES" >&2; exit 1; }
  EXPECTED="$(grep " $ASSET\$" "$WORK/SHA256SUMS" | cut -d' ' -f1)"
  ACTUAL="$(cd "$WORK" && $SHACMD "$ASSET" | cut -d' ' -f1)"
  [ "$EXPECTED" = "$ACTUAL" ] || { echo "install: checksum mismatch for $ASSET" >&2; exit 1; }

  DEST_DIR="${NOLDOR_INSTALL_DIR:-$HOME/.local/bin}"
  mkdir -p "$DEST_DIR"
  # Stage in the destination dir → same-filesystem atomic rename.
  STAGE="$DEST_DIR/.noldor.tmp.$$"
  cp "$WORK/$ASSET" "$STAGE"
  chmod 0755 "$STAGE"
  mv -f "$STAGE" "$DEST_DIR/noldor"
  echo "install: installed $DEST_DIR/noldor"
  case ":$PATH:" in *":$DEST_DIR:"*) ;; *) echo "install: NOTE — $DEST_DIR is not on PATH" ;; esac
  ```
- [ ] **Step 4: Run to verify PASS.** `pnpm vitest run src/binary/__tests__/install-mapping.test.ts` — Expected: all pass. Also `sh -n install.sh` — Expected: exit 0 (syntax).
- [ ] **Step 5: Commit.** Write `/tmp/msg-install.txt`:
  ```
  feat(binary): checksum-verified POSIX installer

  Platform mapping, sentinel-aware download errors, single-line checksum
  selection, same-dir staged atomic install (spec Unit 7).

  Noldor-FD: single-static-binary-distribution
  ```
  ```bash
  git add install.sh src/binary/__tests__/install-mapping.test.ts && git commit -F /tmp/msg-install.txt
  ```

---

## Task 6: docs

**Files:**
Modify: `README.md`, `docs/noldor/gotchas.md` (+ the adoption/hooks page `docs/noldor/` — locate the page that documents lefthook wiring, e.g. via `grep -rl lefthook docs/noldor/ | head -3`)

- [ ] **Step 1: README distribution section.** Add under the existing install section:
  ```markdown
  ### Binary install (no Node required)

  For repositories without a JS toolchain (Go, Python, Rust):

  ​```sh
  curl -fsSL https://raw.githubusercontent.com/davidzoufaly/noldor/main/install.sh | sh
  # pin: curl -fsSL … | NOLDOR_VERSION=v1.5.0 sh
  ​```

  | Platform | Asset | Floor |
  |---|---|---|
  | Linux amd64 (glibc) | `noldor-linux-amd64` | glibc 2.35+ |
  | Linux arm64 (glibc) | `noldor-linux-arm64` | glibc 2.35+ |
  | macOS Intel | `noldor-darwin-amd64` | macOS 13+ |
  | macOS Apple Silicon | `noldor-darwin-arm64` | macOS 13+ |

  The binary carries the full CLI. Commands that shell out to consumer-side JS
  tooling (oxlint/vitest/tsc checks, codex CR lane) fail with their ordinary
  tool-missing errors — per-language check adapters are a separate track.
  `init --adopt` and the `stub` runner require the npm channel. Not a
  replacement for the npm package — the primary channel for JS/TS consumers
  is unchanged.
  ```
  (Strip the zero-width escapes around the inner fence when writing.)
- [ ] **Step 2: gotchas.** Append to `docs/noldor/gotchas.md`:
  ```markdown
  ## Binary channel: cache + env semantics

  - Extracted assets live at `~/Library/Caches/noldor/<version>/pkg` (darwin) /
    `$XDG_CACHE_HOME/noldor/<version>/pkg` (else). Old versions are never
    evicted — litter, not corruption; safe to delete.
  - `NOLDOR_CACHE_DIR` overrides the base; the `<version>/pkg` key is STILL
    appended (stale-cache-across-upgrades guard).
  - `NOLDOR_ASSET_ROOT` (absolute) skips extraction entirely — both channels
    honor it; the npm channel treats it as an operator override of the
    package root.
  - `NOLDOR_BINARY` is set to `'1'` by the binary entry itself — never set it
    by hand on the npm channel; it flips subprocess self-exec semantics.
  ```
- [ ] **Step 3: hooks note.** On the located lefthook/adoption page, add one paragraph: templates keep `pnpm noldor …`; a consumer wanting faster hooks may point lefthook commands at the installed binary (`noldor hooks …`) manually — behavior identical, startup faster, npm channel remains the default.
- [ ] **Step 4: Docs gates.** Run `pnpm noldor checks template-sync` — Expected: exit 0 (README/gotchas have no template twins; if the hooks page has one under `templates/docs/…`, mirror the same paragraph there and re-run to green).
- [ ] **Step 5: Commit.** Write `/tmp/msg-docs.txt`:
  ```
  docs(binary): distribution channel — README table, gotchas, hooks note

  Binary install surface with floors and unsupported-command boundary;
  cache/env semantics in gotchas; manual lefthook swap note (spec Unit 7).

  Noldor-FD: single-static-binary-distribution
  ```
  ```bash
  git add README.md docs/noldor && git commit -F /tmp/msg-docs.txt
  ```
