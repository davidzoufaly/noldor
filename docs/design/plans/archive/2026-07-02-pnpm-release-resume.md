# pnpm release --resume Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `pnpm release --resume` finishes an interrupted release from the exact step that died — an idempotent check-then-act ladder (commit → tag → push → GitHub Release) driven solely by a `.noldor/release-state.json` token written at the mutation boundary; a plain `pnpm release` that finds the token aborts with the `--resume` hint and discard recipe instead of failing on the dirty tree or re-deriving the version.

**Architecture:** New `src/release/release-state.ts` persistence module mirroring `src/core/session.ts` (zod-validated read/write/clear). `resumeRelease()` ladder + `assertNoInProgressRelease()` guard live in `src/release/index.ts` per the spec; the entrypoint gains the house `import.meta.url === file://argv[1]` direct-invocation guard (same as `src/core/pr-flow-cli.ts:220`) so tests can import those exports without firing a live release. `--resume` rides the existing CLI dispatch argv reshape (`src/cli/index.ts:80`); the only CLI change is the `release run` desc in `src/cli/manifest.ts`.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes, oxfmt printWidth 100), zod, vitest scratch-git-repo pattern (bare file remote as `origin`, PATH-stubbed `gh` shim).

Spec: [docs/design/specs/2026-07-02-pnpm-release-resume-design.md](../specs/2026-07-02-pnpm-release-resume-design.md)

---

## File Structure

- `src/release/release-state.ts` — create; zod-validated `{ version, previousTag, date, startedAt }` write/read/clear of `.noldor/release-state.json`, mirroring `src/core/session.ts` persistence
- `src/release/__tests__/release-state.test.ts` — create; state round-trip, absent-file null, invalid-shape reject, clear-tolerates-absence
- `src/release/index.ts` — modify; direct-invocation guard, `assertNoInProgressRelease` normal-path guard, `writeReleaseState`/`clearReleaseState` wiring in `main()`, `resumeRelease()` ladder, `--resume` dispatch, `run()` cwd support, cwd-aware `extractLatestReleaseNotes`
- `src/release/__tests__/release-resume.test.ts` — create; guard + ladder tests on scratch git repos (bare origin, fake `gh` on PATH)
- `src/cli/manifest.ts` — modify; `release run` desc documents `--resume`
- `src/cli/__tests__/cli.test.ts` — modify; `release --help` and `release run --help` surface the flag
- `.gitignore` — modify; ignore `.noldor/release-state.json` next to `.noldor/session.json`

---

## Task 1: Release-state persistence module

**Files:**

- Create: `src/release/release-state.ts`
- Test: `src/release/__tests__/release-state.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing test**

Create `src/release/__tests__/release-state.test.ts`:

```ts
// @tests: pnpm-release-resume
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearReleaseState, readReleaseState, writeReleaseState } from '../release-state.js';

const STATE = {
  version: '0.4.1',
  previousTag: 'v0.4.0',
  date: '2026-07-02',
  startedAt: '2026-07-02T10:00:00.000Z',
};

describe('release state persistence', () => {
  it('round-trips write → read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-state-'));
    writeReleaseState(dir, STATE);
    expect(readReleaseState(dir)).toEqual(STATE);
  });

  it('returns null when the state file is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-state-'));
    expect(readReleaseState(dir)).toBeNull();
  });

  it('creates .noldor/ when missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-state-'));
    writeReleaseState(dir, STATE);
    expect(existsSync(join(dir, '.noldor', 'release-state.json'))).toBe(true);
  });

  it('rejects a state file missing required fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-state-'));
    mkdirSync(join(dir, '.noldor'));
    writeFileSync(
      join(dir, '.noldor', 'release-state.json'),
      JSON.stringify({ version: '0.4.1' }),
      'utf8',
    );
    expect(() => readReleaseState(dir)).toThrow();
  });

  it('clear removes the file and tolerates absence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-state-'));
    writeReleaseState(dir, STATE);
    clearReleaseState(dir);
    expect(readReleaseState(dir)).toBeNull();
    expect(() => clearReleaseState(dir)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/release/__tests__/release-state.test.ts
```

Expected output: 1 failed suite — vitest cannot resolve `../release-state.js` (module does not exist yet).

- [ ] **Step 3: Implement the module**

Create `src/release/release-state.ts` (persistence shape mirrors `src/core/session.ts`):

```ts
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Resume token for an interrupted `pnpm release`. Written by `main()` the
 * moment the run commits to mutating files (right after the dry-run early
 * return), removed after `gh release create` succeeds. A run that dies
 * anywhere in between leaves it behind; `pnpm release --resume` drives the
 * finish ladder from these values alone — the version is never re-derived.
 */
export const ReleaseStateSchema = z
  .object({
    version: z.string().min(1),
    previousTag: z.string().min(1),
    date: z.string().min(1),
    startedAt: z.string().min(1),
  })
  .strict();
export type ReleaseState = z.infer<typeof ReleaseStateSchema>;

const FILE = '.noldor/release-state.json';

export function readReleaseState(cwd: string = process.cwd()): ReleaseState | null {
  const p = join(cwd, FILE);
  if (!existsSync(p)) return null;
  return ReleaseStateSchema.parse(JSON.parse(readFileSync(p, 'utf8')));
}

export function writeReleaseState(cwd: string, state: ReleaseState): void {
  const dir = join(cwd, '.noldor');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(cwd, FILE), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/** Unlink the state file; tolerate absence (clear-after-clear is a no-op). */
export function clearReleaseState(cwd: string = process.cwd()): void {
  const p = join(cwd, FILE);
  if (existsSync(p)) {
    unlinkSync(p);
  }
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/release/__tests__/release-state.test.ts
```

Expected output: 1 passed suite, 5 passed tests.

- [ ] **Step 5: Gitignore the state file**

In `.gitignore`, extend the operator-local block — directly below the line `.noldor/session.json` add:

```
.noldor/release-state.json
```

Verify:

```bash
git check-ignore -v .noldor/release-state.json
```

Expected output: `.gitignore:<line>:.noldor/release-state.json	.noldor/release-state.json` (exit 0).

- [ ] **Step 6: Format and typecheck**

```bash
pnpm fmt && pnpm typecheck
```

Expected output: oxfmt exits clean (possibly rewriting the new files), tsc reports no errors.

- [ ] **Step 7: Commit**

```bash
git add src/release/release-state.ts src/release/__tests__/release-state.test.ts .gitignore
git commit -m "feat(release): add release-state persistence for interrupted releases" -m "Noldor-FD: pnpm-release-resume
Noldor-Path: specs-only-new"
```

---

## Task 2: Import-safe entrypoint, in-progress guard, state lifecycle in main()

**Files:**

- Modify: `src/release/index.ts`
- Test: `src/release/__tests__/release-resume.test.ts` (create)

- [ ] **Step 1: Guard the entrypoint's self-execution (prep for testability)**

This must land before the failing test: `src/release/index.ts` currently calls `main()` at module top level, so a vitest import would fire a live release run against the repo root. Apply the house direct-invocation guard (same pattern as `src/core/pr-flow-cli.ts:220`; `src/cli/index.ts:14-23` documents that dispatch supports it). At the bottom of `src/release/index.ts` replace:

```ts
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nRelease aborted: ${message}`);
  process.exitCode = 1;
});
```

with:

```ts
// Execute only when dispatched as the CLI entrypoint (`noldor release run`
// reshapes argv so argv[1] is this module's path). Importing this module in
// tests must NOT fire a release run.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nRelease aborted: ${message}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 2: Write the failing test**

Create `src/release/__tests__/release-resume.test.ts`:

```ts
// @tests: pnpm-release-resume
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoInProgressRelease } from '../index.js';
import { writeReleaseState } from '../release-state.js';

const STATE = {
  version: '0.4.1',
  previousTag: 'v0.4.0',
  date: '2026-07-02',
  startedAt: '2026-07-02T10:00:00.000Z',
};

describe('assertNoInProgressRelease', () => {
  it('passes silently when no release state exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-resume-'));
    expect(() => assertNoInProgressRelease(dir)).not.toThrow();
  });

  it('aborts naming --resume and the discard recipe when a release is in progress', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-resume-'));
    writeReleaseState(dir, STATE);
    const call = (): void => assertNoInProgressRelease(dir);
    expect(call).toThrow(/In-progress release v0\.4\.1/);
    expect(call).toThrow(/pnpm release --resume/);
    expect(call).toThrow(/git reset --hard && rm \.noldor\/release-state\.json/);
  });
});
```

- [ ] **Step 3: Run to verify FAIL**

```bash
pnpm vitest run src/release/__tests__/release-resume.test.ts
```

Expected output: 1 failed suite — the module `../index.js` does not provide an export named `assertNoInProgressRelease`.

- [ ] **Step 4: Implement the guard**

In `src/release/index.ts`, add the import (below the `withReleaseSession` import):

```ts
import { clearReleaseState, readReleaseState, writeReleaseState } from './release-state.js';
```

Add the guard function directly above `async function main()`:

```ts
/**
 * Normal-path guard: a leftover release-state file means an earlier run died
 * mid-release. Re-running the full pipeline would reject on the dirty tree —
 * or, after a manual commit, re-derive the WRONG version because the release
 * commit itself would enter the bump window — so name the two valid moves.
 */
export function assertNoInProgressRelease(cwd: string): void {
  const state = readReleaseState(cwd);
  if (state === null) return;
  throw new Error(
    `In-progress release v${state.version} detected (.noldor/release-state.json). ` +
      'Run `pnpm release --resume` to finish it, or discard with ' +
      '`git reset --hard && rm .noldor/release-state.json`.',
  );
}
```

Call it in `main()` before the clean-tree check. Replace:

```ts
    const { lockstepPackages, name: cfgName, scanPaths } = loadConsumerConfig();
    await ensureCleanTreeOnMain();
```

with:

```ts
    const { lockstepPackages, name: cfgName, scanPaths } = loadConsumerConfig();
    assertNoInProgressRelease(process.cwd());
    await ensureCleanTreeOnMain();
```

- [ ] **Step 5: Wire the state lifecycle into main()**

Write the token at the mutation boundary — right after the dry-run early return. In `main()` replace:

```ts
    const releaseDate = todayIso();
    const repoUrl = await getRepoUrl();
```

with:

```ts
    const releaseDate = todayIso();
    // The run now commits to mutating files — drop the resume token first so a
    // death anywhere between here and the GitHub Release leaves it behind.
    writeReleaseState(process.cwd(), {
      version: newVersion,
      previousTag,
      date: releaseDate,
      startedAt: new Date().toISOString(),
    });
    const repoUrl = await getRepoUrl();
```

Clear it once the final step succeeds. Replace:

```ts
    console.log(`Created GitHub Release v${newVersion}.`);
```

with:

```ts
    console.log(`Created GitHub Release v${newVersion}.`);
    clearReleaseState(process.cwd());
```

- [ ] **Step 6: Run to verify PASS**

```bash
pnpm vitest run src/release/__tests__/release-resume.test.ts src/release/__tests__/release-session.test.ts
```

Expected output: 2 passed suites (2 new guard tests; the 4 existing session tests still green).

- [ ] **Step 7: Format and typecheck**

```bash
pnpm fmt && pnpm typecheck
```

Expected output: clean exit, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/release/index.ts src/release/__tests__/release-resume.test.ts
git commit -m "feat(release): write release state at the mutation boundary and guard plain runs" -m "Noldor-FD: pnpm-release-resume
Noldor-Path: specs-only-new"
```

---

## Task 3: resumeRelease verification rungs (state, branch, version, shape)

**Files:**

- Modify: `src/release/index.ts`
- Test: `src/release/__tests__/release-resume.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/release/__tests__/release-resume.test.ts`, replace the import block with:

```ts
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoInProgressRelease, resumeRelease } from '../index.js';
import { writeReleaseState } from '../release-state.js';
```

Below the `STATE` const, add the scratch-repo helpers (pattern from `release-cr-gate-e2e.test.ts`):

```ts
function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/**
 * Scratch repo shaped like a consumer mid-release: the full release surface
 * exists and is committed clean; package.json already carries the bumped
 * version (the interruption happened AFTER the mutation phase). `.gitignore`
 * hides the state file and the fake-gh scaffolding from the shape check,
 * exactly as the real repo gitignores `.noldor/`.
 */
function seedReleaseRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'release-resume-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd });
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test User']);
  writeFileSync(join(cwd, '.gitignore'), '.noldor/\nfake-bin/\ngh-log.txt\ngh-release-created\n');
  writeFileSync(
    join(cwd, 'package.json'),
    `${JSON.stringify({ name: 'testpkg', version: '0.4.1' }, null, 2)}\n`,
  );
  writeFileSync(join(cwd, 'CHANGELOG.md'), '# Changelog\n');
  mkdirSync(join(cwd, 'docs/features'), { recursive: true });
  mkdirSync(join(cwd, 'docs/noldor'), { recursive: true });
  writeFileSync(join(cwd, 'docs/release-notes.md'), '## v0.4.1 — 2026-07-02\n\n- resume ladder\n');
  writeFileSync(join(cwd, 'docs/sdd-report.md'), '# SDD report\n');
  writeFileSync(join(cwd, 'docs/features/foo.md'), 'introduced: TBD\n');
  writeFileSync(join(cwd, 'docs/noldor/bar.md'), 'noldor page\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '-m', 'seed']);
  return cwd;
}

const RESUME_OPTS = { lockstepPackages: ['package.json'], name: 'testpkg' };
```

Append the abort-case suite:

```ts
describe('resumeRelease — verification rungs', () => {
  it('aborts when there is no state file', async () => {
    const cwd = seedReleaseRepo();
    await expect(resumeRelease(cwd, RESUME_OPTS)).rejects.toThrow(/Nothing to resume/);
  });

  it('aborts off the main branch', async () => {
    const cwd = seedReleaseRepo();
    git(cwd, ['checkout', '-q', '-b', 'feature']);
    writeReleaseState(cwd, STATE);
    await expect(resumeRelease(cwd, RESUME_OPTS)).rejects.toThrow(/currently on feature/);
  });

  it('aborts when package.json no longer matches the state version', async () => {
    const cwd = seedReleaseRepo();
    writeReleaseState(cwd, { ...STATE, version: '9.9.9' });
    await expect(resumeRelease(cwd, RESUME_OPTS)).rejects.toThrow(/Version mismatch/);
  });

  it('aborts when dirty paths fall outside the release surface', async () => {
    const cwd = seedReleaseRepo();
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeFileSync(join(cwd, 'src-stray.ts'), 'export {};\n');
    writeReleaseState(cwd, STATE);
    await expect(resumeRelease(cwd, RESUME_OPTS)).rejects.toThrow(
      /outside the release surface: src-stray\.ts/,
    );
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/release/__tests__/release-resume.test.ts
```

Expected output: failed suite — `../index.js` does not provide an export named `resumeRelease`.

- [ ] **Step 3: Teach run() to execute in a target cwd**

In `src/release/index.ts`, replace the `run` helper:

```ts
async function run(
  cmd: string,
  args: string[],
  opts: { captureOutput?: boolean; env?: Record<string, string> } = {},
): Promise<string> {
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;
  const { stdout, stderr } = await execFileP(cmd, args, { env });
  if (!opts.captureOutput && stderr) {
    process.stderr.write(stderr);
  }
  return stdout.trim();
}
```

with:

```ts
async function run(
  cmd: string,
  args: string[],
  opts: { captureOutput?: boolean; env?: Record<string, string>; cwd?: string } = {},
): Promise<string> {
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;
  const { stdout, stderr } = await execFileP(cmd, args, { env, cwd: opts.cwd });
  if (!opts.captureOutput && stderr) {
    process.stderr.write(stderr);
  }
  return stdout.trim();
}
```

Add to the node imports at the top of the file:

```ts
import { join } from 'node:path';
```

- [ ] **Step 4: Implement the verification rungs**

In `src/release/index.ts`, add below `assertNoInProgressRelease`:

```ts
/** Options for {@link resumeRelease}. `main()` fills these from the consumer config. */
export interface ResumeOptions {
  /** Same lockstep list the normal-path `git add` stages. */
  lockstepPackages: string[];
  /** Consumer name — names the release-notes temp file, as on the normal path. */
  name: string;
  /** Extra env for every spawned command (tests prepend a fake-gh PATH). */
  env?: Record<string, string>;
}

/** Exact release-owned files the pipeline mutates and commits. */
const RELEASE_SURFACE_FILES = ['CHANGELOG.md', 'docs/release-notes.md', 'docs/sdd-report.md'];
/** Release-owned directories (marker fills + noldor pages). */
const RELEASE_SURFACE_PREFIXES = ['docs/features/', 'docs/noldor/'];

/**
 * Finish an interrupted release from wherever it died. Check-then-act ladder
 * (commit → tag → push → GitHub Release) driven ONLY by the state file written
 * at the mutation boundary — it never re-derives the version and never re-runs
 * checks (the tree is byte-identical to when they passed; the shape check and
 * version cross-check catch external tampering). Safe to re-run after a
 * partial resume: every rung skips when its outcome already exists.
 */
export async function resumeRelease(cwd: string, opts: ResumeOptions): Promise<void> {
  const runIn = (
    cmd: string,
    args: string[],
    extra: { captureOutput?: boolean; env?: Record<string, string> } = {},
  ): Promise<string> => run(cmd, args, { ...extra, cwd, env: { ...opts.env, ...extra.env } });

  // Rung 1 — load + verify state. Branch must be main; the working-tree
  // version must still equal the state version (guards a stale token left
  // behind by an unrelated manual reset). Deliberately NO clean-tree or
  // origin-sync check — the tree is intentionally dirty mid-release.
  const state = readReleaseState(cwd);
  if (state === null) {
    throw new Error('Nothing to resume: .noldor/release-state.json not found.');
  }
  const branch = await runIn('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') {
    throw new Error(`Resume must run from main branch (currently on ${branch}).`);
  }
  const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
    version?: string;
  };
  if (pkg.version !== state.version) {
    throw new Error(
      `Version mismatch: package.json has ${pkg.version ?? 'no version'} but ` +
        `.noldor/release-state.json expects ${state.version}. The tree no longer matches the ` +
        'in-progress release — discard with `git reset --hard && rm .noldor/release-state.json`.',
    );
  }

  // Rung 2 — shape check: every dirty path must be release-owned. Never guess.
  const porcelain = await runIn('git', ['status', '--porcelain']);
  const dirty = porcelain
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3));
  const offenders = dirty.filter(
    (p) =>
      !RELEASE_SURFACE_FILES.includes(p) &&
      !opts.lockstepPackages.includes(p) &&
      !RELEASE_SURFACE_PREFIXES.some((prefix) => p.startsWith(prefix)),
  );
  if (offenders.length > 0) {
    throw new Error(
      `Dirty paths outside the release surface: ${offenders.join(', ')}. ` +
        'Refusing to fold them into the release commit. Clean them up, or discard the ' +
        'in-progress release with `git reset --hard && rm .noldor/release-state.json`.',
    );
  }
  // Rungs 3-6 (commit → tag → push → gh release) land in the next task.
}
```

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/release/__tests__/release-resume.test.ts
```

Expected output: 1 passed suite, 6 passed tests (2 guard + 4 verification aborts).

- [ ] **Step 6: Format and typecheck**

```bash
pnpm fmt && pnpm typecheck
```

Expected output: clean exit, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/release/index.ts src/release/__tests__/release-resume.test.ts
git commit -m "feat(release): verify state, branch, version, and release surface on resume" -m "Noldor-FD: pnpm-release-resume
Noldor-Path: specs-only-new"
```

---

## Task 4: Resume ladder — commit and tag rungs

**Files:**

- Modify: `src/release/index.ts`
- Test: `src/release/__tests__/release-resume.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/release/__tests__/release-resume.test.ts`, extend the `node:fs` import with `chmodSync`:

```ts
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
```

Below `RESUME_OPTS`, add the origin + fake-gh helpers. Both are wired into every ladder test from the start so the same tests keep passing unchanged once the push/gh rungs land in Task 5:

```ts
/** Bare file remote wired up as `origin`, primed with the current main. */
function addBareOrigin(cwd: string): string {
  const bare = mkdtempSync(join(tmpdir(), 'release-resume-origin-'));
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: bare });
  git(cwd, ['remote', 'add', 'origin', bare]);
  git(cwd, ['push', '-q', 'origin', 'main']);
  return bare;
}

/**
 * PATH-stubbed `gh` that records every invocation to a log file. `release
 * view` fails until a `release create` has run (marker file), mirroring the
 * real API surface, so the view-then-create rung behaves realistically.
 */
function fakeGh(
  cwd: string,
  opts: { releaseExists: boolean },
): { env: { PATH: string }; logFile: string } {
  const binDir = join(cwd, 'fake-bin');
  mkdirSync(binDir, { recursive: true });
  const logFile = join(cwd, 'gh-log.txt');
  const marker = join(cwd, 'gh-release-created');
  if (opts.releaseExists) writeFileSync(marker, '');
  const script = [
    '#!/bin/sh',
    `echo "$@" >> ${logFile}`,
    'if [ "$1" = "release" ] && [ "$2" = "view" ]; then',
    `  [ -f ${marker} ] && exit 0`,
    '  exit 1',
    'fi',
    `if [ "$1" = "release" ] && [ "$2" = "create" ]; then touch ${marker}; fi`,
    'exit 0',
    '',
  ].join('\n');
  writeFileSync(join(binDir, 'gh'), script);
  chmodSync(join(binDir, 'gh'), 0o755);
  return { env: { PATH: `${binDir}:${process.env.PATH ?? ''}` }, logFile };
}
```

Append the commit/tag rung suite:

```ts
describe('resumeRelease — commit + tag rungs', () => {
  it('commits the dirty release surface and tags it', async () => {
    const cwd = seedReleaseRepo();
    addBareOrigin(cwd);
    const { env } = fakeGh(cwd, { releaseExists: true });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    appendFileSync(join(cwd, 'docs/features/foo.md'), 'introduced: v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(git(cwd, ['log', '-1', '--format=%s']).trim()).toBe('chore(release): v0.4.1');
    expect(git(cwd, ['status', '--porcelain']).trim()).toBe('');
    expect(git(cwd, ['tag', '--list', 'v0.4.1']).trim()).toBe('v0.4.1');
  });

  it('skips the commit rung when HEAD already carries the release subject', async () => {
    const cwd = seedReleaseRepo();
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-q', '-m', 'chore(release): v0.4.1']);
    addBareOrigin(cwd);
    const { env } = fakeGh(cwd, { releaseExists: true });
    writeReleaseState(cwd, STATE);
    const before = git(cwd, ['rev-list', '--count', 'HEAD']).trim();
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(git(cwd, ['rev-list', '--count', 'HEAD']).trim()).toBe(before);
    expect(git(cwd, ['tag', '--list', 'v0.4.1']).trim()).toBe('v0.4.1');
  });

  it('skips the tag rung when the tag already exists', async () => {
    const cwd = seedReleaseRepo();
    git(cwd, ['tag', '-a', 'v0.4.1', '-m', 'v0.4.1']);
    const tagTarget = git(cwd, ['rev-parse', 'v0.4.1^{}']).trim();
    addBareOrigin(cwd);
    const { env } = fakeGh(cwd, { releaseExists: true });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(git(cwd, ['log', '-1', '--format=%s']).trim()).toBe('chore(release): v0.4.1');
    // Pre-existing tag untouched — still points at the seed commit.
    expect(git(cwd, ['rev-parse', 'v0.4.1^{}']).trim()).toBe(tagTarget);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/release/__tests__/release-resume.test.ts
```

Expected output: 3 new tests fail — `resumeRelease` returns after the shape check, so the first assertion sees HEAD subject `seed` (or the pre-made commit) instead of a new release commit / no `v0.4.1` tag.

- [ ] **Step 3: Implement the commit and tag rungs**

In `resumeRelease` in `src/release/index.ts`, replace the trailing line:

```ts
  // Rungs 3-6 (commit → tag → push → gh release) land in the next task.
```

with:

```ts
  // Rung 3 — commit: skip when HEAD already carries the release subject
  // (same subject + `git add` list as the normal path). Runs inside
  // withReleaseSession, so the pre-commit hook sees a fresh
  // release-automation marker.
  const subject = `chore(release): v${state.version}`;
  const headSubject = await runIn('git', ['log', '-1', '--format=%s']);
  if (headSubject === subject) {
    console.log(`→ commit: HEAD is already "${subject}" (skipped)`);
  } else {
    await runIn('git', [
      'add',
      'CHANGELOG.md',
      'docs/release-notes.md',
      'docs/sdd-report.md',
      'docs/features',
      'docs/noldor',
      ...opts.lockstepPackages,
    ]);
    await runIn('git', ['commit', '-m', subject]);
    console.log(`→ commit: created "${subject}"`);
  }

  // Rung 4 — tag: skip when the tag already exists.
  const tag = `v${state.version}`;
  let tagExists = true;
  try {
    await runIn('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
      captureOutput: true,
    });
  } catch {
    tagExists = false;
  }
  if (tagExists) {
    console.log(`→ tag: ${tag} already exists (skipped)`);
  } else {
    await runIn('git', ['tag', '-a', tag, '-m', tag]);
    console.log(`→ tag: created ${tag}`);
  }
  // Rungs 5-6 (push → gh release) land in the next task.
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/release/__tests__/release-resume.test.ts
```

Expected output: 1 passed suite, 9 passed tests.

- [ ] **Step 5: Format and typecheck**

```bash
pnpm fmt && pnpm typecheck
```

Expected output: clean exit, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/release/index.ts src/release/__tests__/release-resume.test.ts
git commit -m "feat(release): add idempotent commit and tag rungs to the resume ladder" -m "Noldor-FD: pnpm-release-resume
Noldor-Path: specs-only-new"
```

---

## Task 5: Resume ladder — push and GitHub Release rungs, state clear

**Files:**

- Modify: `src/release/index.ts`
- Test: `src/release/__tests__/release-resume.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/release/__tests__/release-resume.test.ts`, extend the `node:fs` import with `readFileSync` and add `readReleaseState` to the release-state import:

```ts
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
```

```ts
import { readReleaseState, writeReleaseState } from '../release-state.js';
```

Append the push/gh rung suite:

```ts
describe('resumeRelease — push + gh-release rungs', () => {
  it('pushes, creates the GitHub Release, and clears the state file', async () => {
    const cwd = seedReleaseRepo();
    addBareOrigin(cwd);
    const { env, logFile } = fakeGh(cwd, { releaseExists: false });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    const head = git(cwd, ['rev-parse', 'HEAD']).trim();
    expect(git(cwd, ['rev-parse', 'origin/main']).trim()).toBe(head);
    const ghLog = readFileSync(logFile, 'utf8');
    expect(ghLog).toContain('release view v0.4.1');
    expect(ghLog).toContain(
      'release create v0.4.1 --notes-file /tmp/testpkg-release-notes-v0.4.1.md --latest --title v0.4.1',
    );
    expect(readReleaseState(cwd)).toBeNull();
  });

  it('re-running over a re-armed state file skips every rung (idempotent ladder)', async () => {
    // Models `--resume` after a resume that died before clearing state (the
    // spec's "twice in a row" acceptance case): the second walk must be a
    // pure no-op — no second commit, no re-tag, no re-push, no second create.
    const cwd = seedReleaseRepo();
    addBareOrigin(cwd);
    const { env, logFile } = fakeGh(cwd, { releaseExists: false });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    const head = git(cwd, ['rev-parse', 'HEAD']).trim();
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(git(cwd, ['rev-parse', 'HEAD']).trim()).toBe(head);
    const creates = readFileSync(logFile, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('release create'));
    expect(creates).toHaveLength(1);
    expect(readReleaseState(cwd)).toBeNull();
  });

  it('skips the gh rung when the release already exists', async () => {
    const cwd = seedReleaseRepo();
    addBareOrigin(cwd);
    const { env, logFile } = fakeGh(cwd, { releaseExists: true });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(readFileSync(logFile, 'utf8')).not.toContain('release create');
    expect(readReleaseState(cwd)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/release/__tests__/release-resume.test.ts
```

Expected output: 3 new tests fail — `origin/main` still points at the seed commit (push rung missing) and/or `gh-log.txt` does not exist because the ladder never invoked `gh`.

- [ ] **Step 3: Make extractLatestReleaseNotes cwd-aware**

In `src/release/index.ts`, replace:

```ts
async function extractLatestReleaseNotes(): Promise<string> {
  const raw = await readFile('docs/release-notes.md', 'utf8');
```

with:

```ts
async function extractLatestReleaseNotes(cwd: string = process.cwd()): Promise<string> {
  const raw = await readFile(join(cwd, 'docs/release-notes.md'), 'utf8');
```

The normal-path call site (`await extractLatestReleaseNotes();`) keeps working via the default.

- [ ] **Step 4: Implement the push and gh-release rungs**

In `resumeRelease`, replace the trailing line:

```ts
  // Rungs 5-6 (push → gh release) land in the next task.
```

with:

```ts
  // Rung 5 — push: skip when origin/main already equals HEAD after a fetch
  // (same rev-parse pair as ensureCleanTreeOnMain). Push carries the
  // release-automation env stamp exactly like the normal path.
  await runIn('git', ['fetch', 'origin', 'main']);
  const local = await runIn('git', ['rev-parse', 'HEAD']);
  const remote = await runIn('git', ['rev-parse', 'origin/main']);
  if (local === remote) {
    console.log('→ push: origin/main already at HEAD (skipped)');
  } else {
    await runIn('git', ['push', '--follow-tags', 'origin', 'main'], {
      env: { NOLDOR_RELEASE_PUSH: '1' },
    });
    console.log('→ push: pushed commit + tag');
  }

  // Rung 6 — GitHub Release: skip when it already exists.
  let releaseExists = true;
  try {
    await runIn('gh', ['release', 'view', tag], { captureOutput: true });
  } catch {
    releaseExists = false;
  }
  if (releaseExists) {
    console.log(`→ gh release: ${tag} already exists (skipped)`);
  } else {
    const notesBody = await extractLatestReleaseNotes(cwd);
    const notesTmp = `/tmp/${opts.name}-release-notes-${tag}.md`;
    await writeFile(notesTmp, notesBody, 'utf8');
    await runIn('gh', [
      'release',
      'create',
      tag,
      '--notes-file',
      notesTmp,
      '--latest',
      '--title',
      tag,
    ]);
    console.log(`→ gh release: created ${tag}`);
  }

  clearReleaseState(cwd);
  console.log(`Resume complete: release ${tag} finished; state file cleared.`);
```

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/release/__tests__/release-resume.test.ts src/release/__tests__/release-state.test.ts
```

Expected output: 2 passed suites, 17 passed tests (12 resume + 5 state).

- [ ] **Step 6: Format and typecheck**

```bash
pnpm fmt && pnpm typecheck
```

Expected output: clean exit, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/release/index.ts src/release/__tests__/release-resume.test.ts
git commit -m "feat(release): finish the resume ladder with push, GitHub Release, and state clear" -m "Noldor-FD: pnpm-release-resume
Noldor-Path: specs-only-new"
```

---

## Task 6: --resume flag plumbing and CLI help

**Files:**

- Modify: `src/release/index.ts`
- Modify: `src/cli/manifest.ts`
- Test: `src/cli/__tests__/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the `describe('noldor CLI', ...)` block in `src/cli/__tests__/cli.test.ts`:

```ts
  it('release --help documents the --resume flag', () => {
    const out = run(['release', '--help']);
    expect(out).toContain('Usage: noldor release');
    expect(out).toContain('--resume');
  });

  it('release run --help short-circuits before any release logic', () => {
    // Acceptance: the help guard at src/cli/index.ts:75 must keep printing
    // usage (now naming --resume) without dispatching into release/index.ts.
    const out = run(['release', 'run', '--help']);
    expect(out).toContain('Usage: noldor release run');
    expect(out).toContain('--resume');
  });
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/cli/__tests__/cli.test.ts
```

Expected output: 2 new tests fail — help output is `Run pnpm release`, which does not contain `--resume`.

- [ ] **Step 3: Document the flag in the manifest**

In `src/cli/manifest.ts`, replace the `release` group's sub entry:

```ts
      run: { src: 'release/index.ts', desc: 'Run pnpm release' },
```

with:

```ts
      run: {
        src: 'release/index.ts',
        desc: 'Run pnpm release (--resume finishes an interrupted release)',
      },
```

- [ ] **Step 4: Dispatch --resume in main()**

In `src/release/index.ts`, replace the head of `main()`:

```ts
async function main(): Promise<void> {
  await withReleaseSession(process.cwd(), async () => {
    const { lockstepPackages, name: cfgName, scanPaths } = loadConsumerConfig();
    assertNoInProgressRelease(process.cwd());
```

with:

```ts
async function main(): Promise<void> {
  // Dispatch reshapes argv so this module sees `node <modPath> [--resume]`.
  const resume = process.argv.slice(2).includes('--resume');
  await withReleaseSession(process.cwd(), async () => {
    const { lockstepPackages, name: cfgName, scanPaths } = loadConsumerConfig();
    if (resume) {
      // Resume re-enters withReleaseSession (fresh release-automation marker
      // for the pre-commit hook) and skips every precondition, check, and
      // version derivation — the ladder trusts only the state file.
      await resumeRelease(process.cwd(), { lockstepPackages, name: cfgName });
      return;
    }
    assertNoInProgressRelease(process.cwd());
```

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/cli/__tests__/cli.test.ts
```

Expected output: 1 passed suite, 13 passed tests (11 existing + 2 new).

- [ ] **Step 6: Full verification gate**

```bash
pnpm verify
```

Expected output: oxlint clean, oxfmt check clean, tsc clean, full vitest suite green.

- [ ] **Step 7: Commit**

```bash
git add src/release/index.ts src/cli/manifest.ts src/cli/__tests__/cli.test.ts
git commit -m "feat(release): plumb --resume from the CLI into the resume ladder" -m "Noldor-FD: pnpm-release-resume
Noldor-Path: specs-only-new"
```
