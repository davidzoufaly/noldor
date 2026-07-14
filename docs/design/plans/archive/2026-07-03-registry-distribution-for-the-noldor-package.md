# Registry Distribution for the Noldor Package Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `pnpm add -D noldor` works from any machine. Publishing is split-executor: a tag-triggered `.github/workflows/publish.yml` workflow publishes to public npm with Trusted Publishing (OIDC — works from the still-private repo), while the local `pnpm release` pipeline gains a final opt-in rung that only *waits* for registry visibility before clearing `.noldor/release-state.json` — so an interrupted release can never silently end unpublished (`--resume` rung 7 finishes the wait). Provenance attestation requires a **public** repo, so `--provenance` is config-gated behind `release.publish.provenance` (default `false`; flip on after open-sourcing) — the workflow never hard-codes it. Consumers running the vendored pipeline (Charuy, contract fixture) stay byte-identical: `release.publish.enabled` defaults `false`.

**Architecture:** New `src/release/release-publish.ts` owns the registry probe (`isVersionOnRegistry`) + poller (`awaitPublish`, exec-seam for tests, env-tunable timeout/poll) + `readPkgIdentity`, and doubles as the `noldor release publish` CLI entry (`--verify-tarball` default mode reuses `src/testing/` contract harness; `--wait <version>` re-attaches to an in-flight publish; `--local` is the logged, provenance-less emergency hatch guarded by `ensureCleanTreeOnMain`, which gets exported from `src/release/index.ts`). `releaseConfigSchema` (`src/cr/config.ts`) grows the `publish` block (`enabled` / `registry` / `distTag` / `provenance`). `main()` calls `awaitPublish` after `gh release create` and *before* `clearReleaseState`; `resumeRelease()` appends rung 7 with the same skip-if-done shape as rungs 3–6. publish.yml reads the provenance knob from the checked-in `.noldor/config.json` at run time; the committed spec gets a sentence-level amendment making provenance conditional on repo visibility. Docs flip registry-first (README Quick start, adoption-guide Bootstrap §1, versioning.md publish section) with byte-identical template twins.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes, oxfmt printWidth 100), zod, vitest (exec-seam fakes; scratch git repos with bare `origin` + PATH-stubbed `gh`/`npm` shims, per `src/release/__tests__/release-resume.test.ts`), GitHub Actions + npm Trusted Publishing (OIDC), `yaml` package for workflow-shape tests.

Spec: [docs/design/specs/2026-07-03-registry-distribution-for-the-noldor-package-design.md](../specs/2026-07-03-registry-distribution-for-the-noldor-package-design.md)

---

## File Structure

- `src/cr/config.ts` — modify; `releasePublishConfigSchema` (`enabled` default `false`, `registry` default npmjs, `distTag` default `latest`, `provenance` default `false` — requires public repo) hung off `releaseConfigSchema` as optional `publish`
- `src/cr/__tests__/config.test.ts` — modify; `release.publish` defaults / opt-in / provenance-knob / absent-stays-absent / reject tests
- `src/release/release-publish.ts` — create; `isVersionOnRegistry` probe, `awaitPublish` poller (exec seam + `NOLDOR_PUBLISH_TIMEOUT_MS`/`NOLDOR_PUBLISH_POLL_MS` tuning), `readPkgIdentity`; later the `release publish` CLI entry (`--verify-tarball` / `--wait` / `--local`)
- `src/release/__tests__/release-publish.test.ts` — create; poller unit tests with counting exec fakes (first-poll resolve, retry-on-404, timeout message, env tuning) + `readPkgIdentity`
- `src/release/index.ts` — modify; `export` on `ensureCleanTreeOnMain`, publish-verification rung in `main()` before `clearReleaseState`, rung 7 in `resumeRelease()`, `name` in the resume pkg parse
- `src/release/release-state.ts` — modify; doc-comment only ("removed after the final rung", not "after `gh release create`")
- `src/release/__tests__/release-resume.test.ts` — modify; `fakeNpm` + `enablePublish` helpers, rung-7 describe (disabled → npm never runs; visible → skip line; timeout → state file survives)
- `.noldor/config.json` — modify; `"publish": { "enabled": true }` inside the existing `release` block (Noldor's own opt-in)
- `src/cli/manifest.ts` — modify; `release publish` subcommand entry beside `run`
- `src/cli/__tests__/cli.test.ts` — modify; `release --help` lists `publish`; `release publish --help` short-circuits
- `src/release/__tests__/release-publish-cli.test.ts` — create; spawned-bin guard tests (`--local` refuses dirty tree / missing HEAD tag; `--wait` without version prints usage)
- `.github/workflows/publish.yml` — create; tag-triggered publish job: version guard → `pnpm install --frozen-lockfile` → `pnpm test:contract` → `npm publish --access public` with `--provenance` added only when `release.publish.provenance` is true (read from the checked-in `.noldor/config.json`)
- `src/release/__tests__/publish-workflow.test.ts` — create; workflow-shape lock (v* trigger, OIDC permissions, registry-url, guard-before-install, contract-before-publish, provenance never hard-coded)
- `docs/design/specs/2026-07-03-registry-distribution-for-the-noldor-package-design.md` — modify; sentence-level amendment: provenance conditional on repo visibility via `release.publish.provenance` (default off; repo private for now)
- `README.md` — modify; Status sentence + registry-first Quick start; `file:` block moves under Development as the contributor path
- `docs/noldor/adoption-guide.md` — modify; Bootstrap §1 becomes `pnpm add -D noldor` with a `file:` contributor note
- `templates/docs/noldor/adoption-guide.md` — modify; identical twin edit (template-sync check)
- `docs/noldor/versioning.md` — modify; new "Registry publishing" section (tag ↔ npm version, `latest`-only pre-1.0, `src`-in-`files` packaging note)
- `templates/docs/noldor/versioning.md` — modify; identical twin edit

---

## Task 1: `release.publish` config block

**Files:**

- Modify: `src/cr/config.ts`
- Test: `src/cr/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/cr/__tests__/config.test.ts`, right after the `describe('release.crGateExemptCommits block', …)` block (before `describe('garden.overrideAudit block', …)`):

```ts
describe('release.publish block', () => {
  it('defaults enabled=false, npmjs registry, latest dist-tag, provenance off', () => {
    const parsed = noldorConfigSchema.parse({ release: { publish: {} } });
    expect(parsed.release?.publish).toEqual({
      enabled: false,
      registry: 'https://registry.npmjs.org',
      distTag: 'latest',
      provenance: false,
    });
  });

  it('stays absent when not configured (no synthesized block)', () => {
    expect(noldorConfigSchema.parse({ release: {} }).release?.publish).toBeUndefined();
  });

  it('parses an opt-in block and fills the other defaults', () => {
    const parsed = noldorConfigSchema.parse({ release: { publish: { enabled: true } } });
    expect(parsed.release?.publish?.enabled).toBe(true);
    expect(parsed.release?.publish?.registry).toBe('https://registry.npmjs.org');
    expect(parsed.release?.publish?.distTag).toBe('latest');
    expect(parsed.release?.publish?.provenance).toBe(false);
  });

  it('parses the provenance opt-in (public-repo-only attestation knob)', () => {
    const parsed = noldorConfigSchema.parse({
      release: { publish: { enabled: true, provenance: true } },
    });
    expect(parsed.release?.publish?.provenance).toBe(true);
  });

  it('rejects a non-URL registry', () => {
    expect(() =>
      noldorConfigSchema.parse({ release: { publish: { registry: 'not-a-url' } } }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/cr/__tests__/config.test.ts
```

Expected output: 4 of the 5 new tests fail (zod strips the unknown `publish` key, so the parsed block is `undefined` and the bad registry does not throw); "stays absent when not configured" passes already.

- [ ] **Step 3: Implement the schema**

In `src/cr/config.ts`, replace the `releaseConfigSchema` block:

```ts
/** Release-enforcement tuning — the `release:` block of `.noldor/config.json`. */
export const releaseConfigSchema = z.object({
  crGateExemptCommits: z.array(crGateExemptionSchema).default([]),
});
```

with:

```ts
/**
 * Registry-publish verification block. `enabled` defaults FALSE so every
 * consumer running the vendored release pipeline (Charuy, the contract
 * fixture) keeps byte-identical behaviour with no config change; only the
 * framework repo opts in. The tag-triggered publish.yml workflow is the
 * publish EXECUTOR — it reads `provenance` from this checked-in block, while
 * the other values drive the local pipeline's registry poll target and log
 * lines (`distTag` is echoed; the workflow hard-codes `latest` pre-1.0).
 */
export const releasePublishConfigSchema = z.object({
  enabled: z.boolean().default(false),
  registry: z.string().url().default('https://registry.npmjs.org'),
  distTag: z.string().default('latest'),
  /** Provenance attestation requires a PUBLIC repo; flip on after open-sourcing. */
  provenance: z.boolean().default(false),
});

/** Parsed `release.publish` block. */
export type ReleasePublishConfig = z.infer<typeof releasePublishConfigSchema>;

/** Release-enforcement tuning — the `release:` block of `.noldor/config.json`. */
export const releaseConfigSchema = z.object({
  crGateExemptCommits: z.array(crGateExemptionSchema).default([]),
  publish: releasePublishConfigSchema.optional(),
});
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/cr/__tests__/config.test.ts
```

Expected output: all tests pass, including the 5 new `release.publish` tests.

- [ ] **Step 5: Commit**

```bash
pnpm fmt
git add src/cr/config.ts src/cr/__tests__/config.test.ts
git commit -m "feat(release): add release.publish config block (default-off consumer safety)" -m "Noldor-FD: registry-distribution-for-the-noldor-package"
```

---

## Task 2: `awaitPublish` registry poller module

**Files:**

- Create: `src/release/release-publish.ts`
- Test: `src/release/__tests__/release-publish.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/release/__tests__/release-publish.test.ts`:

```ts
// @tests: registry-distribution-for-the-noldor-package
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_REGISTRY,
  awaitPublish,
  isVersionOnRegistry,
  readPkgIdentity,
} from '../release-publish.js';
import type { ExecFn } from '../release-publish.js';

/** Exec fake that fails `failures` times (E404), then resolves; records calls. */
function fakeExec(failures: number): {
  exec: ExecFn;
  calls: () => number;
  lastArgs: () => unknown[];
} {
  let n = 0;
  let last: unknown[] = [];
  const exec: ExecFn = async (cmd, cmdArgs, env) => {
    n += 1;
    last = [cmd, cmdArgs, env];
    if (n <= failures) throw new Error('npm ERR! code E404');
    return { stdout: '"0.5.0"\n' };
  };
  return { exec, calls: () => n, lastArgs: () => last };
}

describe('isVersionOnRegistry', () => {
  it('probes `npm view <pkg>@<version>` against the default registry', async () => {
    const fake = fakeExec(0);
    await expect(
      isVersionOnRegistry({ pkgName: 'noldor', version: '0.5.0', exec: fake.exec }),
    ).resolves.toBe(true);
    expect(fake.lastArgs()).toEqual([
      'npm',
      ['view', 'noldor@0.5.0', 'version', '--json', '--registry', DEFAULT_REGISTRY],
      undefined,
    ]);
  });

  it('returns false when npm exits non-zero (version not published yet)', async () => {
    const fake = fakeExec(99);
    await expect(
      isVersionOnRegistry({ pkgName: 'noldor', version: '0.5.0', exec: fake.exec }),
    ).resolves.toBe(false);
  });

  it('honours a configured registry', async () => {
    const fake = fakeExec(0);
    await isVersionOnRegistry({
      pkgName: 'noldor',
      version: '0.5.0',
      registry: 'https://registry.example.test',
      exec: fake.exec,
    });
    expect(fake.lastArgs()[1]).toContain('https://registry.example.test');
  });
});

describe('awaitPublish', () => {
  it('resolves on the first poll when the version is already visible', async () => {
    const fake = fakeExec(0);
    const res = await awaitPublish({
      pkgName: 'noldor',
      version: '0.5.0',
      exec: fake.exec,
      pollMs: 1,
      timeoutMs: 1000,
    });
    expect(res.ok).toBe(true);
    expect(fake.calls()).toBe(1);
  });

  it('retries while npm 404s and resolves once the version appears', async () => {
    const fake = fakeExec(2);
    const res = await awaitPublish({
      pkgName: 'noldor',
      version: '0.5.0',
      exec: fake.exec,
      pollMs: 1,
      timeoutMs: 1000,
    });
    expect(res.ok).toBe(true);
    expect(fake.calls()).toBe(3);
  });

  it('throws on timeout, naming publish.yml and the recovery commands', async () => {
    const fake = fakeExec(Number.POSITIVE_INFINITY);
    await expect(
      awaitPublish({
        pkgName: 'noldor',
        version: '0.5.0',
        exec: fake.exec,
        pollMs: 5,
        timeoutMs: 25,
      }),
    ).rejects.toThrow(/publish\.yml[\s\S]*pnpm release --resume/);
  });

  it('reads poll tuning from env overrides when explicit options are absent', async () => {
    const fake = fakeExec(Number.POSITIVE_INFINITY);
    await expect(
      awaitPublish({
        pkgName: 'noldor',
        version: '0.5.0',
        exec: fake.exec,
        env: { NOLDOR_PUBLISH_TIMEOUT_MS: '25', NOLDOR_PUBLISH_POLL_MS: '5' },
      }),
    ).rejects.toThrow(/Timed out/);
  });
});

describe('readPkgIdentity', () => {
  it('reads name + version from package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-publish-'));
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'testpkg', version: '0.4.1' }),
      'utf8',
    );
    expect(readPkgIdentity(dir)).toEqual({ name: 'testpkg', version: '0.4.1' });
  });

  it('throws when name or version is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-publish-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'testpkg' }), 'utf8');
    expect(() => readPkgIdentity(dir)).toThrow(/name and version/);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/release/__tests__/release-publish.test.ts
```

Expected output: 1 failed suite — vitest cannot resolve `../release-publish.js` (module does not exist yet).

- [ ] **Step 3: Implement the module**

Create `src/release/release-publish.ts`:

```ts
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Default poll target; overridable per-consumer via `release.publish.registry`. */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_MS = 10_000;

/** Exec seam so unit tests can stub the `npm view` probe without PATH games. */
export type ExecFn = (
  cmd: string,
  args: string[],
  env?: Record<string, string>,
) => Promise<{ stdout: string }>;

const realExec: ExecFn = (cmd, args, env) =>
  execFileP(cmd, args, { env: env ? { ...process.env, ...env } : process.env });

export interface RegistryProbe {
  pkgName: string;
  version: string;
  /** Poll target (default {@link DEFAULT_REGISTRY}). */
  registry?: string;
  /** Extra env for the spawned `npm` (resume tests prepend a fake-npm PATH). */
  env?: Record<string, string>;
  /** Test seam; defaults to a real execFile. */
  exec?: ExecFn;
}

/** One registry probe: does `<pkg>@<version>` resolve? npm non-zero = not yet. */
export async function isVersionOnRegistry(probe: RegistryProbe): Promise<boolean> {
  const exec = probe.exec ?? realExec;
  const registry = probe.registry ?? DEFAULT_REGISTRY;
  try {
    await exec(
      'npm',
      ['view', `${probe.pkgName}@${probe.version}`, 'version', '--json', '--registry', registry],
      probe.env,
    );
    return true;
  } catch {
    return false;
  }
}

export interface AwaitPublishOptions extends RegistryProbe {
  /** Give-up horizon (default 5 min; env `NOLDOR_PUBLISH_TIMEOUT_MS`). */
  timeoutMs?: number;
  /** Probe interval (default 10 s; env `NOLDOR_PUBLISH_POLL_MS`). */
  pollMs?: number;
}

export interface AwaitPublishResult {
  ok: true;
  elapsedMs: number;
}

/** Positive-number env override for poll tuning; anything else → fallback. */
function envTuning(
  env: Record<string, string> | undefined,
  key: string,
  fallback: number,
): number {
  const raw = env?.[key] ?? process.env[key];
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Poll the registry until `<pkg>@<version>` is visible. The publish itself is
 * executed by the tag-triggered publish.yml workflow (npm Trusted Publishing
 * via CI OIDC; `--provenance` only when `release.publish.provenance` is on —
 * attestation needs a public repo) — the release pipeline only WAITS here.
 * Timeout throws with the two recovery moves; the caller keeps
 * `.noldor/release-state.json` behind so `pnpm release --resume` can finish.
 */
export async function awaitPublish(opts: AwaitPublishOptions): Promise<AwaitPublishResult> {
  const timeoutMs =
    opts.timeoutMs ?? envTuning(opts.env, 'NOLDOR_PUBLISH_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const pollMs = opts.pollMs ?? envTuning(opts.env, 'NOLDOR_PUBLISH_POLL_MS', DEFAULT_POLL_MS);
  const registry = opts.registry ?? DEFAULT_REGISTRY;
  const started = Date.now();
  for (;;) {
    if (await isVersionOnRegistry(opts)) {
      return { ok: true, elapsedMs: Date.now() - started };
    }
    const elapsed = Date.now() - started;
    if (elapsed + pollMs > timeoutMs) {
      throw new Error(
        `Timed out after ${Math.round(elapsed / 1000)}s waiting for ` +
          `${opts.pkgName}@${opts.version} on ${registry}. Check the workflow with ` +
          '`gh run list --workflow publish.yml`, then finish with `pnpm release --resume` ' +
          '(or `pnpm noldor release publish --wait <version>`).',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export interface PkgIdentity {
  name: string;
  version: string;
}

/** `name` + `version` from `<cwd>/package.json`; both are publish-load-bearing. */
export function readPkgIdentity(cwd: string): PkgIdentity {
  const raw = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as Partial<PkgIdentity>;
  if (!raw.name || !raw.version) {
    throw new Error('package.json must declare both name and version.');
  }
  return { name: raw.name, version: raw.version };
}
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/release/__tests__/release-publish.test.ts
```

Expected output: all 10 tests pass (3 probe, 5 poller, 2 identity).

- [ ] **Step 5: Commit**

```bash
pnpm fmt
git add src/release/release-publish.ts src/release/__tests__/release-publish.test.ts
git commit -m "feat(release): add awaitPublish registry-visibility poller" -m "Noldor-FD: registry-distribution-for-the-noldor-package"
```

---

## Task 3: Publish-verification rung in `pnpm release` + resume rung 7 + Noldor opt-in

**Files:**

- Modify: `src/release/index.ts`
- Modify: `src/release/release-state.ts`
- Modify: `.noldor/config.json`
- Test: `src/release/__tests__/release-resume.test.ts`

- [ ] **Step 1: Write the failing rung-7 tests**

In `src/release/__tests__/release-resume.test.ts`, extend the `node:fs` import to include `existsSync`:

```ts
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
```

Then add two helpers right after the `fakeGh` function:

```ts
/**
 * PATH-stubbed `npm` for the publish rung, sharing fakeGh's fake-bin dir (call
 * fakeGh first — its env.PATH already covers this shim). `visible: true` →
 * every `npm view` exits 0 (version on registry); `visible: false` → always
 * exits 1, so the rung's awaitPublish must time out. The log lives inside the
 * gitignored fake-bin/ so a re-run's shape check never sees it as dirty.
 */
function fakeNpm(cwd: string, opts: { visible: boolean }): { logFile: string } {
  const binDir = join(cwd, 'fake-bin');
  mkdirSync(binDir, { recursive: true });
  const logFile = join(binDir, 'npm-log.txt');
  const script = [
    '#!/bin/sh',
    `echo "$@" >> ${logFile}`,
    opts.visible ? 'exit 0' : 'exit 1',
    '',
  ].join('\n');
  writeFileSync(join(binDir, 'npm'), script);
  chmodSync(join(binDir, 'npm'), 0o755);
  return { logFile };
}

/** Opt the scratch repo into the publish rung (`.noldor/` is gitignored). */
function enablePublish(cwd: string): void {
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  writeFileSync(
    join(cwd, '.noldor', 'config.json'),
    JSON.stringify({ release: { publish: { enabled: true } } }, null, 2),
  );
}
```

Then append a new describe block at the end of the file:

```ts
describe('resumeRelease — publish rung (rung 7)', () => {
  it('never invokes npm when release.publish is not enabled', async () => {
    const cwd = seedReleaseRepo();
    addBareOrigin(cwd);
    const { env } = fakeGh(cwd, { releaseExists: true });
    const { logFile } = fakeNpm(cwd, { visible: true });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(existsSync(logFile)).toBe(false);
    expect(readReleaseState(cwd)).toBeNull();
  });

  it('skips rung 7 when the version is already on the registry, then clears state', async () => {
    const cwd = seedReleaseRepo();
    enablePublish(cwd);
    addBareOrigin(cwd);
    const { env } = fakeGh(cwd, { releaseExists: true });
    const { logFile } = fakeNpm(cwd, { visible: true });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    await resumeRelease(cwd, { ...RESUME_OPTS, env });
    expect(readFileSync(logFile, 'utf8')).toContain('view testpkg@0.4.1 version --json');
    expect(readReleaseState(cwd)).toBeNull();
  });

  it('leaves the state file behind when the version never becomes visible', async () => {
    const cwd = seedReleaseRepo();
    enablePublish(cwd);
    addBareOrigin(cwd);
    const { env } = fakeGh(cwd, { releaseExists: true });
    fakeNpm(cwd, { visible: false });
    appendFileSync(join(cwd, 'CHANGELOG.md'), '\n## v0.4.1\n');
    writeReleaseState(cwd, STATE);
    const opts = {
      ...RESUME_OPTS,
      env: { ...env, NOLDOR_PUBLISH_TIMEOUT_MS: '60', NOLDOR_PUBLISH_POLL_MS: '20' },
    };
    await expect(resumeRelease(cwd, opts)).rejects.toThrow(/publish\.yml/);
    expect(readReleaseState(cwd)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/release/__tests__/release-resume.test.ts
```

Expected output: the two enabled-path rung-7 tests fail (`readFileSync(logFile)` throws ENOENT because npm is never invoked; the timeout test resolves instead of rejecting and state is cleared). The disabled-path test already passes — it pins today's behaviour.

- [ ] **Step 3: Implement the rungs in `src/release/index.ts`**

3a. Add the import (after the `release-state.js` import on line 27):

```ts
import { awaitPublish, isVersionOnRegistry, readPkgIdentity } from './release-publish.js';
```

3b. Export the preflight for reuse by `release publish --local` (Task 4) — change line 45:

```ts
async function ensureCleanTreeOnMain(): Promise<void> {
```

to:

```ts
export async function ensureCleanTreeOnMain(): Promise<void> {
```

3c. In `resumeRelease()`, widen the rung-1 pkg parse to carry `name`:

```ts
  const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
    version?: string;
  };
```

becomes:

```ts
  const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
    name?: string;
    version?: string;
  };
```

3d. In `resumeRelease()`, insert rung 7 between the rung-6 block's closing brace and `clearReleaseState(cwd);`:

```ts
  // Rung 7 — publish: opt-in (`release.publish.enabled`). The tag push from
  // rung 5 already triggered publish.yml — this rung only VERIFIES registry
  // visibility, it never publishes. Skip-if-done: the version already
  // resolves. A timeout throws BEFORE clearReleaseState, so the resume token
  // survives and the ladder stays re-runnable.
  const publishCfg = loadConfigSync(join(cwd, '.noldor/config.json'))?.release?.publish;
  if (publishCfg?.enabled) {
    const pkgName = pkg.name;
    if (!pkgName) {
      throw new Error('package.json has no name — cannot verify the registry publish.');
    }
    const probe = {
      pkgName,
      version: state.version,
      registry: publishCfg.registry,
      env: opts.env,
    };
    if (await isVersionOnRegistry(probe)) {
      console.log(`→ publish: ${pkgName}@${state.version} already on registry (skipped)`);
    } else {
      console.log(`→ publish: waiting for ${pkgName}@${state.version} on ${publishCfg.registry} …`);
      await awaitPublish(probe);
      console.log(`→ publish: ${pkgName}@${state.version} visible on ${publishCfg.registry}.`);
    }
  }

  clearReleaseState(cwd);
```

Also update the `resumeRelease` doc comment's ladder description from `(commit → tag → push → GitHub Release)` to `(commit → tag → push → GitHub Release → publish wait)`.

3e. In `main()`, replace the tail:

```ts
    console.log(`Created GitHub Release v${newVersion}.`);
    clearReleaseState(process.cwd());
```

with:

```ts
    console.log(`Created GitHub Release v${newVersion}.`);

    // Publish-verification rung — opt-in via `release.publish.enabled`
    // (default false: consumers running this vendored pipeline never touch
    // npm). The v-tag push above already fired publish.yml; this rung only
    // waits for registry visibility. It runs BEFORE clearReleaseState so a
    // publish failure leaves the resume token — the operator lands in
    // `pnpm release --resume` (rung 7), never in half-released limbo.
    const publishCfg = loadConfigSync()?.release?.publish;
    if (publishCfg?.enabled) {
      const pkgName = readPkgIdentity(process.cwd()).name;
      console.log(
        `→ publish: waiting for ${pkgName}@${newVersion} on ${publishCfg.registry} ` +
          `(dist-tag ${publishCfg.distTag}) …`,
      );
      const { elapsedMs } = await awaitPublish({
        pkgName,
        version: newVersion,
        registry: publishCfg.registry,
      });
      console.log(
        `→ publish: ${pkgName}@${newVersion} visible after ${Math.round(elapsedMs / 1000)}s.`,
      );
    }
    clearReleaseState(process.cwd());
```

3f. In `src/release/release-state.ts`, keep the token's doc comment honest — change the sentence in the `ReleaseStateSchema` JSDoc from:

```
 * return), removed after `gh release create` succeeds. A run that dies
```

to:

```
 * return), removed after the final rung succeeds (`gh release create`, plus
 * the registry-visibility wait when `release.publish.enabled`). A run that dies
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/release/__tests__/release-resume.test.ts src/release/__tests__/release-state.test.ts
```

Expected output: all tests pass — the 3 new rung-7 tests and every pre-existing ladder test (proves the disabled path is byte-identical: no `npm` invocation, state cleared right after `gh release create`).

- [ ] **Step 5: Opt Noldor itself in**

In `.noldor/config.json`, add `publish` to the existing `release` block:

```json
  "release": {
    "publish": { "enabled": true },
    "crGateExemptCommits": [
      {
        "sha": "19a74a10e8e844e021b08fe616992eae1b56f977",
        "reason": "pre-rollout-marker CI-workflow fast-track (#117); shipped before receipt enforcement armed"
      }
    ]
  }
```

Verify the parse (defaults filled):

```bash
node bin/noldor.mjs validate noldor-config
```

Expected output: `.noldor/config.json valid` followed by the parsed JSON showing `"publish": { "enabled": true, "registry": "https://registry.npmjs.org", "distTag": "latest", "provenance": false }` — provenance stays off until the repo goes public.

- [ ] **Step 6: Commit**

```bash
pnpm fmt
git add src/release/index.ts src/release/release-state.ts src/release/__tests__/release-resume.test.ts .noldor/config.json
git commit -m "feat(release): publish-verification rung + resume rung 7, opt-in via release.publish" -m "Noldor-FD: registry-distribution-for-the-noldor-package"
```

---

## Task 4: `noldor release publish` manual subcommand

**Files:**

- Modify: `src/cli/manifest.ts`
- Modify: `src/release/release-publish.ts`
- Test: `src/cli/__tests__/cli.test.ts`
- Test: `src/release/__tests__/release-publish-cli.test.ts`

- [ ] **Step 1: Write the failing CLI tests**

1a. Append to the `describe('noldor CLI', …)` block in `src/cli/__tests__/cli.test.ts` (after the `release run --help` test):

```ts
  it('release --help lists the publish subcommand', () => {
    const out = run(['release', '--help']);
    expect(out).toContain('publish');
    expect(out).toContain('--verify-tarball');
  });

  it('release publish --help short-circuits before any publish logic', () => {
    const out = run(['release', 'publish', '--help']);
    expect(out).toContain('Usage: noldor release publish');
    expect(out).toContain('--wait');
  });
```

1b. Create `src/release/__tests__/release-publish-cli.test.ts`:

```ts
// @tests: registry-distribution-for-the-noldor-package
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BIN = resolve(__dirname, '../../../bin/noldor.mjs');

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/**
 * Minimal clean-main scratch repo with a bare file `origin` —
 * ensureCleanTreeOnMain fetches origin, so --local's guards need one.
 */
function seedRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'release-publish-cli-'));
  git(cwd, ['init', '-q', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test User']);
  writeFileSync(
    join(cwd, 'package.json'),
    `${JSON.stringify({ name: 'testpkg', version: '0.4.1' }, null, 2)}\n`,
  );
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '-m', 'seed']);
  const bare = mkdtempSync(join(tmpdir(), 'release-publish-cli-origin-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: bare });
  git(cwd, ['remote', 'add', 'origin', bare]);
  git(cwd, ['push', '-q', 'origin', 'main']);
  return cwd;
}

function runPublish(cwd: string, args: string[]): { status: number | null; stderr: string } {
  const r = spawnSync('node', [BIN, 'release', 'publish', ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr };
}

describe('noldor release publish — guard rails', () => {
  it('--local refuses on a dirty tree', () => {
    const cwd = seedRepo();
    writeFileSync(join(cwd, 'stray.txt'), 'dirty\n');
    const r = runPublish(cwd, ['--local']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('not clean');
  });

  it('--local refuses when HEAD is not tagged v<version>', () => {
    const cwd = seedRepo();
    const r = runPublish(cwd, ['--local']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('not tagged v0.4.1');
  });

  it('--wait without a version prints usage and exits non-zero', () => {
    const cwd = seedRepo();
    const r = runPublish(cwd, ['--wait']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('usage: noldor release publish');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/cli/__tests__/cli.test.ts src/release/__tests__/release-publish-cli.test.ts
```

Expected output: the 2 new manifest tests fail (`release --help` does not mention `publish`; `release publish --help` errors `Unknown subcommand`), and all 3 guard tests fail with `Unknown subcommand: release publish` on stderr instead of the guard messages.

- [ ] **Step 3: Register the subcommand in the manifest**

In `src/cli/manifest.ts`, replace the `release` group:

```ts
  release: {
    desc: 'Release pipeline',
    subs: {
      run: {
        src: 'release/index.ts',
        desc: 'Run pnpm release (--resume finishes an interrupted release)',
      },
    },
  },
```

with:

```ts
  release: {
    desc: 'Release pipeline',
    subs: {
      run: {
        src: 'release/index.ts',
        desc: 'Run pnpm release (--resume finishes an interrupted release)',
      },
      publish: {
        src: 'release/release-publish.ts',
        desc: 'Tarball pre-flight + registry wait: --verify-tarball (default) / --wait <version> / --local (emergency, no provenance, logged)',
      },
    },
  },
```

- [ ] **Step 4: Add the CLI modes to `src/release/release-publish.ts`**

4a. Add these imports after the existing `node:` imports (note: `./index.js` ↔ this module is a deliberate ESM cycle — both sides export hoisted function declarations referenced only at call time, and `index.ts`'s own entry guard keys on `process.argv[1]`, so importing it here never fires a release run):

```ts
import { loadConfigSync } from '../cr/config.js';
import { appendOverrideLog } from '../core/overrides-log.js';
import { buildConsumerFixture } from '../testing/consumer-fixture.js';
import { installFrameworkTarball, runContractChecks } from '../testing/contract-harness.js';
import { ensureCleanTreeOnMain } from './index.js';
```

4b. Append the CLI section at the end of the file:

```ts
const USAGE = 'usage: noldor release publish [--verify-tarball | --wait <version> | --local]\n';

/**
 * `--verify-tarball` (default mode): pack the working tree, install the
 * tarball into a scratch consumer fixture, and run the contract checks — the
 * same fidelity loop as `pnpm test:contract`, exposed as the operator
 * pre-flight before tagging a release.
 */
async function verifyTarball(): Promise<void> {
  const fx = buildConsumerFixture();
  try {
    installFrameworkTarball(fx.dir);
    const results = runContractChecks(fx.dir);
    const failed = Object.entries(results).filter(([, code]) => code !== 0);
    if (failed.length > 0) {
      console.error('verify-tarball: contract checks FAILED:', failed);
      process.exitCode = 1;
      return;
    }
    console.log('verify-tarball: pack + scratch install + contract checks passed:', results);
  } finally {
    fx.cleanup();
  }
}

/**
 * `--local`: CI-down emergency executor. Provenance is impossible outside CI
 * OIDC, so this is loud + logged (`.noldor/overrides.log`, surfaced by the
 * garden override-audit) and guarded by the release pipeline's own preflight
 * (main branch, clean tree, synced origin) plus a HEAD-tag check.
 */
async function publishLocal(cwd: string): Promise<void> {
  await ensureCleanTreeOnMain();
  const { name, version } = readPkgIdentity(cwd);
  const { stdout } = await execFileP('git', ['tag', '--points-at', 'HEAD'], { cwd });
  const headTags = stdout.split('\n').map((t) => t.trim());
  if (!headTags.includes(`v${version}`)) {
    throw new Error(
      `HEAD is not tagged v${version} — run pnpm release first; --local only ` +
        're-executes the publish of an already-tagged release.',
    );
  }
  console.warn(
    'WARNING: --local publishes WITHOUT provenance (emergency hatch for CI-down). ' +
      'Prefer re-running the publish.yml workflow.',
  );
  appendOverrideLog(cwd, 'release publish --local', 'release');
  await execFileP('npm', ['publish', '--access', 'public'], { cwd });
  console.log(`Published ${name}@${version} to the registry (no provenance).`);
}

/** `--wait <version>`: bare awaitPublish, for a release whose state file is gone. */
async function waitForVersion(cwd: string, version: string): Promise<void> {
  const publishCfg = loadConfigSync(join(cwd, '.noldor/config.json'))?.release?.publish;
  const { name } = readPkgIdentity(cwd);
  const { elapsedMs } = await awaitPublish({
    pkgName: name,
    version,
    registry: publishCfg?.registry,
  });
  console.log(`${name}@${version} visible after ${Math.round(elapsedMs / 1000)}s.`);
}

async function cliMain(): Promise<void> {
  const args = process.argv.slice(2);
  const cwd = process.cwd();
  if (args.includes('--local')) {
    await publishLocal(cwd);
    return;
  }
  const waitIdx = args.indexOf('--wait');
  if (waitIdx !== -1) {
    const version = args[waitIdx + 1];
    if (!version || version.startsWith('--')) {
      process.stderr.write(USAGE);
      process.exitCode = 1;
      return;
    }
    await waitForVersion(cwd, version);
    return;
  }
  await verifyTarball(); // default mode; also the explicit --verify-tarball
}

// Execute only when dispatched as the CLI entrypoint (`noldor release publish`
// reshapes argv so argv[1] is this module's path). Importing this module —
// including from ./index.ts — must NOT fire the CLI.
const invokedDirect = /[\\/]release-publish\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) {
  cliMain().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`release publish failed: ${message}`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 5: Run to verify PASS**

```bash
pnpm vitest run src/cli/__tests__/cli.test.ts src/release/__tests__/release-publish-cli.test.ts src/release/__tests__/release-publish.test.ts
```

Expected output: all tests pass — help listing, help short-circuit, both `--local` refusals (dirty tree / missing tag), `--wait` usage error, and the Task 2 poller suite still green (cycle-safe import).

- [ ] **Step 6: Commit**

```bash
pnpm fmt
git add src/cli/manifest.ts src/release/release-publish.ts src/cli/__tests__/cli.test.ts src/release/__tests__/release-publish-cli.test.ts
git commit -m "feat(cli): add noldor release publish (--verify-tarball / --wait / --local)" -m "Noldor-FD: registry-distribution-for-the-noldor-package"
```

---

## Task 5: Tag-triggered trusted-publishing workflow (config-gated provenance) + spec amendment

**Files:**

- Create: `.github/workflows/publish.yml`
- Modify: `docs/design/specs/2026-07-03-registry-distribution-for-the-noldor-package-design.md`
- Test: `src/release/__tests__/publish-workflow.test.ts`

Context: the repo stays **private** for now and npm refuses `--provenance` from private repos, while Trusted Publishing (OIDC) itself works fine from them. So the workflow reads `release.publish.provenance` from the checked-in `.noldor/config.json` and adds the flag only when it is `true`.

- [ ] **Step 1: Write the failing workflow-shape test**

Create `src/release/__tests__/publish-workflow.test.ts` (locks the load-bearing bits: trigger, OIDC permissions, guard order, contract-before-publish, provenance never hard-coded):

```ts
// @tests: registry-distribution-for-the-noldor-package
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface WorkflowShape {
  on: { push: { tags: string[] } };
  permissions: Record<string, string>;
  jobs: { publish: { steps: WorkflowStep[] } };
}

function loadWorkflow(): WorkflowShape {
  const raw = readFileSync(join(ROOT, '.github', 'workflows', 'publish.yml'), 'utf8');
  return parse(raw) as WorkflowShape;
}

describe('publish.yml — tag-triggered trusted publishing', () => {
  it('fires on v* tag pushes only', () => {
    expect(loadWorkflow().on).toEqual({ push: { tags: ['v*'] } });
  });

  it('declares OIDC permissions (id-token: write) for provenance', () => {
    expect(loadWorkflow().permissions).toEqual({ 'id-token': 'write', contents: 'read' });
  });

  it('points npm at the public registry via setup-node', () => {
    const setupNode = loadWorkflow().jobs.publish.steps.find((s) =>
      s.uses?.startsWith('actions/setup-node'),
    );
    expect(setupNode?.with?.['registry-url']).toBe('https://registry.npmjs.org');
  });

  it('guards tag-vs-package.json before installing anything', () => {
    const runs = loadWorkflow().jobs.publish.steps.map((s) => s.run ?? '');
    const guardIdx = runs.findIndex((r) => r.includes('GITHUB_REF_NAME#v'));
    const installIdx = runs.findIndex((r) => r.includes('pnpm install --frozen-lockfile'));
    expect(guardIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeGreaterThan(guardIdx);
  });

  it('contract-checks the exact bits, then publishes', () => {
    const runs = loadWorkflow().jobs.publish.steps.map((s) => s.run ?? '');
    const contractIdx = runs.findIndex((r) => r.includes('pnpm test:contract'));
    const publishIdx = runs.findIndex((r) => r.includes('npm publish'));
    expect(contractIdx).toBeGreaterThan(-1);
    expect(publishIdx).toBeGreaterThan(contractIdx);
  });

  it('never hard-codes --provenance — the flag is gated on release.publish.provenance', () => {
    // Provenance requires a PUBLIC repo; this repo is private for now. The
    // publish step must read the knob from the checked-in .noldor/config.json
    // so open-sourcing flips attestation on with a one-line config change.
    const runs = loadWorkflow().jobs.publish.steps.map((s) => s.run ?? '');
    const publishRun = runs.find((r) => r.includes('npm publish')) ?? '';
    expect(publishRun).toContain('--access public');
    expect(publishRun).toContain('release?.publish?.provenance');
    expect(publishRun).not.toContain('npm publish --provenance');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

```bash
pnpm vitest run src/release/__tests__/publish-workflow.test.ts
```

Expected output: all 6 tests fail — `readFileSync` throws ENOENT (`.github/workflows/publish.yml` does not exist yet).

- [ ] **Step 3: Create the workflow**

Create `.github/workflows/publish.yml` (auth = npm Trusted Publishing via OIDC — no `NPM_TOKEN` secret anywhere, and OIDC works from the private repo; `pnpm install` runs `prepare` → `tsc` → `dist/`; default checkout depth 1 is fine, no changelog walk here; the publish step branches on the checked-in provenance knob):

```yaml
name: publish
on:
  push:
    tags: ['v*']
permissions:
  id-token: write
  contents: read
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - name: version guard — tag must equal package.json version
        run: |
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          PKG_VERSION="$(node -p "require('./package.json').version")"
          if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
            echo "Tag v$TAG_VERSION != package.json $PKG_VERSION — refusing to publish." >&2
            exit 1
          fi
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:contract
      - name: publish (provenance gated on release.publish.provenance — needs public repo)
        run: |
          PROVENANCE_FLAG="$(node -p "require('./.noldor/config.json')?.release?.publish?.provenance ? '--provenance' : ''")"
          npm publish $PROVENANCE_FLAG --access public
```

- [ ] **Step 4: Run to verify PASS**

```bash
pnpm vitest run src/release/__tests__/publish-workflow.test.ts
```

Expected output: all 6 workflow-shape tests pass.

- [ ] **Step 5: Amend the spec — provenance is conditional on repo visibility**

The committed spec promises provenance-by-default; the operator decision (repo stays private for now) makes that unsatisfiable, so amend `docs/design/specs/2026-07-03-registry-distribution-for-the-noldor-package-design.md` with these five sentence-level edits (nothing else changes):

5a. Goals, second bullet — replace `Publishing is a tag-driven, provenance-attested step that fires only after` with `Publishing is a tag-driven, provenance-capable step (attestation is gated on release.publish.provenance, default off — provenance requires a public repo; flip on after open-sourcing) that fires only after`.

5b. Unit 2, list item 6 — replace `` 6. `npm publish --provenance --access public`. `` with `` 6. `npm publish --access public`, adding `--provenance` only when `release.publish.provenance` is true (requires a public repo; the repo is private for now, so the default is off). ``

5c. Unit 2, closing paragraph — after the sentence ending `which is why the executor is a workflow, not local code (D3).` insert: `Provenance additionally requires a public repo, so the flag is config-gated (release.publish.provenance, default false) while the repo stays private; Trusted Publishing itself works from private repos.`

5d. Unit 4, schema snippet — add `provenance: z.boolean().default(false),` on a new line after `distTag: z.string().default('latest'),`.

5e. Acceptance criteria, second bullet — replace `npm package page shows a provenance attestation.` with `npm package page shows a provenance attestation once release.publish.provenance is enabled after open-sourcing (private repos cannot attest).`

- [ ] **Step 6: Commit**

```bash
pnpm fmt
git add .github/workflows/publish.yml src/release/__tests__/publish-workflow.test.ts docs/design/specs/2026-07-03-registry-distribution-for-the-noldor-package-design.md
git commit -m "feat(ci): tag-triggered trusted-publishing workflow with config-gated provenance" -m "Noldor-FD: registry-distribution-for-the-noldor-package"
```

---

## Task 6: Docs flip — registry-first README, adoption guide, versioning (+ template twins)

**Files:**

- Modify: `README.md`
- Modify: `docs/noldor/adoption-guide.md`
- Modify: `templates/docs/noldor/adoption-guide.md`
- Modify: `docs/noldor/versioning.md`
- Modify: `templates/docs/noldor/versioning.md`

- [ ] **Step 1: Run the (currently failing) doc checks**

```bash
grep -l "pnpm add -D noldor" README.md docs/noldor/adoption-guide.md docs/noldor/versioning.md
```

Expected output: no matches, exit code 1 — none of the three pages documents the registry path yet.

- [ ] **Step 2: Rewrite README Status + Quick start; move `file:` under Development**

2a. In `README.md` Status (line 7), replace the sentence `Distribution is still \`file:\`-dependency based; npm publication is tracked on the roadmap.` with:

```
Distributed on the public npm registry as [`noldor`](https://www.npmjs.com/package/noldor) — tag-driven publishes via npm Trusted Publishing (provenance attestation arrives with `release.publish.provenance` once the repo is public).
```

2b. Replace the whole Quick start section (lines 9–21, from `## Quick start` through the `Filesystem assumption:` paragraph) with:

````markdown
## Quick start

```bash
pnpm add -D noldor    # public npm registry — no clone needed
pnpm noldor init      # scaffold docs/noldor, hooks, .noldor/config.json
pnpm noldor doctor    # health check → green
```
````

2c. Replace the Development section:

````markdown
## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```
````

with:

````markdown
## Development

Framework contributors work against a clone. A consumer repo on the same machine can point at it with a `file:` dependency instead of the registry (assumes `noldor/` is a sibling directory of the consumer repo, e.g. `~/code/noldor/` next to `~/code/charuy/`):

```json
{
  "devDependencies": {
    "noldor": "file:../noldor"
  }
}
```

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```
````

- [ ] **Step 3: Commit the README flip (repo-level scope — noldor-scope hook forces a separate commit for `docs/noldor/`)**

```bash
grep -q "pnpm add -D noldor" README.md && grep -q "file:../noldor" README.md && echo README-OK
pnpm fmt
git add README.md
git commit -m "docs: lead README quick start with the registry install, file: moves to Development" -m "Noldor-FD: registry-distribution-for-the-noldor-package"
```

Expected output of the check line: `README-OK`.

- [ ] **Step 4: Registry-first Bootstrap §1 in the adoption guide (both copies)**

In **both** `docs/noldor/adoption-guide.md` and `templates/docs/noldor/adoption-guide.md` (byte-identical twins), replace Bootstrap item 1:

```markdown
1. **Install** the package as a dev dependency (`noldor`).
```

with:

```markdown
1. **Install** the package as a dev dependency from the public npm registry: `pnpm add -D noldor`. (Framework contributors point at a sibling clone instead: `"noldor": "file:../noldor"`.)
```

- [ ] **Step 5: Add the "Registry publishing" section to versioning (both copies)**

In **both** `docs/noldor/versioning.md` and `templates/docs/noldor/versioning.md`, insert this section between the end of the `## Release flow` section (after its closing paragraph "Preconditions failing aborts … one-line recovery command.") and `## Who owns \`introduced\` / \`updated\`?`:

```markdown
## Registry publishing

The framework package itself ships to the public npm registry. Every release
tag `vX.Y.Z` maps 1:1 to npm version `X.Y.Z` of `noldor`; `latest` is the
only dist-tag pre-1.0. The publish executor is the tag-triggered
`.github/workflows/publish.yml` workflow (npm Trusted Publishing / CI OIDC —
works from a private repo; `--provenance` attestation is gated on
`release.publish.provenance`, default `false`, because it requires a public
repo — flip it on after open-sourcing); the local `pnpm release` pipeline
only polls the registry until the new version is visible, and the
`.noldor/release-state.json` resume token is cleared only after that
(interruption → `pnpm release --resume`, rung 7). Publishing is opt-in via
`release.publish.enabled` in `.noldor/config.json` (default `false`), so
consumer repos running this same vendored pipeline never touch npm.
Emergency hatches: `pnpm noldor release publish --wait <version>` re-attaches
to an in-flight publish; `--local` publishes without provenance and logs to
`.noldor/overrides.log`.

Consumer upgrade flow is unchanged: `pnpm up noldor && pnpm noldor doctor &&
pnpm noldor upgrade` (see [Version-aware upgrade](#version-aware-upgrade)).

Packaging note: the published bin runs `src/` through tsx at runtime, so
`src` must stay in the package.json `files` whitelist — dropping it breaks
every registry install.
```

- [ ] **Step 6: Verify twins are byte-identical, then commit with the noldor scope**

```bash
diff docs/noldor/adoption-guide.md templates/docs/noldor/adoption-guide.md && diff docs/noldor/versioning.md templates/docs/noldor/versioning.md && echo TWINS-OK
git add docs/noldor/adoption-guide.md templates/docs/noldor/adoption-guide.md docs/noldor/versioning.md templates/docs/noldor/versioning.md
git commit -m "docs(noldor): registry-first bootstrap install + registry-publishing section" -m "Noldor-FD: registry-distribution-for-the-noldor-package"
```

Expected output of the check line: `TWINS-OK` (both diffs empty).

---

## Task 7: End-to-end verification + operator runbook (no commit)

**Files:** none (verification only — every file change shipped in Tasks 1–6)

- [ ] **Step 1: Full verify gate**

```bash
pnpm verify
```

Expected output: lint, fmt:check, typecheck, and the full vitest suite all green (includes the new config, poller, resume-rung-7, CLI-guard, and workflow-shape tests).

- [ ] **Step 2: Prove the tarball shape end-to-end (the spec's pack + scratch-dir install verification)**

```bash
node bin/noldor.mjs release publish --verify-tarball
```

Expected output: `verify-tarball: pack + scratch install + contract checks passed: { init: 0, doctor: 0, 'validate-features': 0, 'garden-detect': 0 }` — the working tree packs, installs into a scratch consumer fixture, and every contract command exits 0 (same loop as `pnpm test:contract`).

- [ ] **Step 3: Confirm the disabled path stays byte-identical for consumers**

```bash
pnpm test:contract
```

Expected output: `Contract checks passed: …` — the fixture consumer (no `release.publish` block) exercises the packaged pipeline with zero npm involvement.

- [ ] **Step 4: Operator runbook (manual, post-merge — record in the PR description)**

No commands to run now; these are the one-time human steps that arm the workflow after this branch merges:

1. **Trusted Publisher setup (one-time, npmjs.com):** log in → Access Tokens / Trusted Publishing → add a GitHub Actions trusted publisher for package `noldor` with owner `davidzoufaly`, repository `noldor`, workflow filename `publish.yml`, environment left blank. Untestable until the first tag fires — accepted one iteration loop per the spec.
2. **First publish claims the name:** the next `pnpm release` on main pushes `v<version>`, publish.yml fires, and `awaitPublish` holds the pipeline until `npm view noldor@<version> version` resolves. No provenance badge is expected while the repo is private.
3. **If the workflow misconfigures on the first attempt:** fix + re-run via `gh run rerun`, or claim the name immediately with `pnpm noldor release publish --local` (logged, provenance-less), then repair trusted publishing before the next release.
4. **Fresh-machine acceptance check (post-publish):** in an empty temp dir on any machine — `pnpm init && pnpm add -D noldor && pnpm noldor init && pnpm noldor doctor` → doctor green with no sibling clone present.
5. **After open-sourcing:** flip `"provenance": true` inside `release.publish` in `.noldor/config.json` — the next tagged release publishes with a provenance attestation (verify the badge on the npm package page). No workflow edit needed; the publish step reads the knob at run time.
