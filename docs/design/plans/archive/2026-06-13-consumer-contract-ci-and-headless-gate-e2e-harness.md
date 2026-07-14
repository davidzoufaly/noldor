# Consumer-Contract CI and Headless Gate E2E Harness Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Build a fixture-consumer + headless-drain test harness that protects downstream consumers (the contract half) and the autonomous paths (the e2e half), closing the PR-#33-class blind spot.
**Architecture:** A temp-dir fixture builder (`src/testing/consumer-fixture.ts`) generates a real git consumer repo; a contract harness installs the framework tarball and runs the read-only CLI contract; a `stub` runner registered in the existing agent-runner registry makes drain runs hermetic; a vitest e2e suite drives `noldor autonomous run` and asserts git outcomes; CI wires both lanes.
**Tech Stack:** TypeScript (ESM, NodeNext), vitest, Zod, `node:child_process` (`execFileSync`/`spawnSync`), `node:fs` (`mkdtempSync`), GitHub Actions.

---

## File Structure

- `src/testing/consumer-fixture.ts` — `buildConsumerFixture()` temp-dir consumer-repo builder; `ConsumerFixture` type with `git`/`dumpState`/`cleanup`.
- `src/testing/contract-harness.ts` — `installFrameworkTarball()` + `runContractChecks()` driving init/doctor/validate/garden.
- `src/testing/stub-gate.ts` — deterministic canned gate; reads `src/testing/fixtures/canned/<slug>.json`, performs scripted fast-track work.
- `bin/noldor-stub-gate.mjs` — tsx entrypoint for the stub runner (mirrors `bin/noldor.mjs`).
- `src/core/agent-runner/runners/stub.ts` — `STUB_BIN` + `buildStubArgv()`.
- `src/core/agent-runner/types.ts` — add `'stub'` to `RUNNER_NAMES` (Modify).
- `src/core/agent-runner/capabilities.ts` — add `CAPABILITIES.stub` (Modify).
- `src/core/agent-runner/registry.ts` — add `case 'stub'` to `planSpawn` (Modify).
- `src/testing/__tests__/consumer-fixture.test.ts` — fixture builder unit tests.
- `src/testing/__tests__/stub-runner.test.ts` — stub runner registry tests.
- `src/testing/__tests__/contract-harness.test.ts` — contract lane tests.
- `src/testing/__tests__/drain-e2e.test.ts` — headless drain + marker + failure-path e2e.
- `scripts/test-contract.mjs` — `pnpm test:contract` entrypoint.
- `.github/workflows/contract-e2e.yml` — contract + drain-e2e PR jobs + nightly real-agent job.
- `package.json` — add `test:contract`, `test:e2e:drain` scripts (Modify).
- `docs/noldor/script-catalog.md` — document the harness commands (Modify).
- `docs/noldor/testing-principles.md` — document the framework self-test layer (Modify).

---

## Task 1: Register the `stub` runner in the agent-runner registry

**Files:**
- Modify: `src/core/agent-runner/types.ts`, `src/core/agent-runner/capabilities.ts`, `src/core/agent-runner/registry.ts`
- Create: `src/core/agent-runner/runners/stub.ts`
- Test: `src/testing/__tests__/stub-runner.test.ts`

- [ ] **Step 1: Write the failing test for the stub runner plan.**

Create `src/testing/__tests__/stub-runner.test.ts`:

```typescript
// @tests: consumer-contract-ci-and-headless-gate-e2e-harness
import { describe, expect, it } from 'vitest';
import { RUNNER_NAMES } from '../../core/agent-runner/types';
import { CAPABILITIES } from '../../core/agent-runner/capabilities';
import { STUB_BIN, buildStubArgv } from '../../core/agent-runner/runners/stub';

describe('stub runner', () => {
  it('is a registered runner name', () => {
    expect(RUNNER_NAMES).toContain('stub');
  });
  it('has a capabilities entry', () => {
    expect(CAPABILITIES.stub).toBeDefined();
    expect(CAPABILITIES.stub.structuredOutput).toBe('prose');
  });
  it('builds argv pointing at the stub-gate entrypoint with the prompt', () => {
    const argv = buildStubArgv('/gate', {});
    expect(STUB_BIN).toBe(process.execPath);
    expect(argv.some((a) => a.endsWith('noldor-stub-gate.mjs'))).toBe(true);
    expect(argv).toContain('/gate');
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS.**

```bash
pnpm test src/testing/__tests__/stub-runner.test.ts
```

Expected output: failure — `Cannot find module '../../core/agent-runner/runners/stub'` and `RUNNER_NAMES` does not contain `'stub'`.

- [ ] **Step 3: Add `'stub'` to `RUNNER_NAMES`.**

In `src/core/agent-runner/types.ts`, change:

```typescript
export const RUNNER_NAMES = ['claude', 'codex', 'opencode'] as const;
```

to:

```typescript
export const RUNNER_NAMES = ['claude', 'codex', 'opencode', 'stub'] as const;
```

- [ ] **Step 4: Add the `CAPABILITIES.stub` entry.**

In `src/core/agent-runner/capabilities.ts`, add inside the `CAPABILITIES` object (after the `opencode` entry):

```typescript
  stub: {
    structuredOutput: 'prose',
    sandbox: 'none',
    supportsLocalModels: true,
    questionSuppression: 'flag',
    rulesFile: 'CLAUDE.md',
  },
```

- [ ] **Step 5: Create the stub runner module.**

Create `src/core/agent-runner/runners/stub.ts`:

```typescript
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

/** The stub runner spawns the current node binary against an in-repo entrypoint. */
export const STUB_BIN = process.execPath;

/** Prompt rides argv; the entrypoint parses the slug from it / the session marker. */
export function buildStubArgv(prompt: string, _opts: { model?: string }): string[] {
  // runners/ -> agent-runner/ -> core/ -> src/ -> repo root; bin/ holds the entrypoint.
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = join(here, '..', '..', '..', '..', 'bin', 'noldor-stub-gate.mjs');
  return [entry, prompt];
}
```

- [ ] **Step 6: Add the `case 'stub'` arm to `planSpawn`.**

In `src/core/agent-runner/registry.ts`, add the import at the top alongside the other runner imports:

```typescript
import { STUB_BIN, buildStubArgv } from './runners/stub.js';
```

and add the arm inside `planSpawn`'s switch (after the `opencode` case):

```typescript
    case 'stub':
      return {
        bin: STUB_BIN,
        argv: buildStubArgv(prompt, { model: resolved.model }),
        promptVia: 'argv',
      };
```

- [ ] **Step 7: Run the test, verify it PASSES + typecheck.**

```bash
pnpm test src/testing/__tests__/stub-runner.test.ts && pnpm typecheck
```

Expected output: 3 passing tests; `tsc --noEmit` exits 0 (the exhaustive switch + `Record<RunnerName, …>` now cover `'stub'`).

- [ ] **Step 8: Commit.**

```bash
git add src/core/agent-runner/types.ts src/core/agent-runner/capabilities.ts src/core/agent-runner/registry.ts src/core/agent-runner/runners/stub.ts src/testing/__tests__/stub-runner.test.ts
git commit -m "feat(testing): register hermetic stub runner in agent registry" -m "Noldor-FD: consumer-contract-ci-and-headless-gate-e2e-harness"
```

---

## Task 2: Fixture consumer builder

**Files:**
- Create: `src/testing/consumer-fixture.ts`
- Test: `src/testing/__tests__/consumer-fixture.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `src/testing/__tests__/consumer-fixture.test.ts`:

```typescript
// @tests: consumer-contract-ci-and-headless-gate-e2e-harness
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildConsumerFixture, type ConsumerFixture } from '../consumer-fixture';
import { loadConsumerConfig } from '../../core/consumer-config';
import { loadAgentsConfig } from '../../core/agent-runner/registry';

let fx: ConsumerFixture | null = null;
afterEach(() => fx?.cleanup());

describe('consumer fixture builder', () => {
  it('generates a real git repo with a valid consumer + agents config', () => {
    fx = buildConsumerFixture();
    expect(existsSync(join(fx.dir, '.git'))).toBe(true);
    const cfg = loadConsumerConfig(fx.dir);
    expect(cfg.name).toBeTruthy();
    const agents = loadAgentsConfig(fx.dir);
    expect(agents.default).toBe('stub');
    // initial commit exists on main
    expect(fx.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('main');
  });

  it('seeds one XS roadmap entry whose slug is exposed', () => {
    fx = buildConsumerFixture({ seedSlug: 'add-greeting-helper' });
    const roadmap = readFileSync(join(fx.dir, 'docs', 'roadmap.md'), 'utf8');
    expect(roadmap).toContain('add-greeting-helper');
    expect(fx.seedSlug).toBe('add-greeting-helper');
  });

  it('dumpState returns git log + .noldor listing', () => {
    fx = buildConsumerFixture();
    const state = fx.dumpState();
    expect(state).toContain('.noldor');
    expect(state.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS.**

```bash
pnpm test src/testing/__tests__/consumer-fixture.test.ts
```

Expected output: failure — `Cannot find module '../consumer-fixture'`.

- [ ] **Step 3: Implement the fixture builder.**

Create `src/testing/consumer-fixture.ts`:

```typescript
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ConsumerFixture {
  dir: string;
  seedSlug: string;
  git: (args: string[]) => string;
  dumpState: () => string;
  cleanup: () => void;
}

export interface BuildFixtureOpts {
  dir?: string;
  seedSlug?: string;
}

const CONSUMER_CONFIG = (name: string) => ({
  consumer: {
    name,
    repoUrl: 'https://example.test/fixture',
    lockstepPackages: [],
    scanPaths: ['src'],
    e2ePrefix: 'e2e/',
    samplesPath: 'samples',
    packagePrefix: '@fixture/',
    pnpmStderrPrefix: 'fixture',
    appPathPrefix: 'src/',
    categories: ['Tooling'],
  },
  agents: { default: 'stub', targets: ['stub'] },
  autonomous: {
    skipLanePicker: true,
    onFailure: 'abort',
    requireHumanPrApproval: false,
    verifyMode: 'advisory',
  },
});

const ROADMAP = (slug: string) => `# Roadmap

## ${slug}

\`\`\`yaml
slug: ${slug}
name: Add greeting helper
target: consumer
area: tooling
size: XS
impact: low
since: 2026-06-13
\`\`\`

Add a tiny greeting helper to src/.
`;

/** Generate a minimal, real-git consumer repo into a temp dir. */
export function buildConsumerFixture(opts: BuildFixtureOpts = {}): ConsumerFixture {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'noldor-fixture-'));
  const seedSlug = opts.seedSlug ?? 'add-greeting-helper';
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

  mkdirSync(join(dir, '.noldor'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });

  writeFileSync(
    join(dir, '.noldor', 'config.json'),
    JSON.stringify(CONSUMER_CONFIG('fixture-consumer'), null, 2),
  );
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const ok = true;\n');
  writeFileSync(join(dir, 'docs', 'vision.md'), '# Vision\n\nFixture consumer.\n');
  writeFileSync(join(dir, 'docs', 'ideas.md'), '# Ideas\n');
  writeFileSync(join(dir, 'docs', 'roadmap.md'), ROADMAP(seedSlug));
  writeFileSync(
    join(dir, 'lefthook.yml'),
    'pre-commit:\n  jobs:\n    - run: pnpm noldor validate features\n',
  );
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture-consumer', private: true, version: '0.0.0' }, null, 2),
  );

  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'fixture@test.test']);
  git(['config', 'user.name', 'fixture']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'chore: initial fixture commit']);

  const dumpState = (): string => {
    const log = git(['log', '--oneline', '-20']);
    const noldorDir = join(dir, '.noldor');
    const listing = existsSync(noldorDir) ? readdirSync(noldorDir).join('\n') : '(no .noldor)';
    return `=== git log ===\n${log}\n=== .noldor/ ===\n${listing}\n`;
  };

  return {
    dir,
    seedSlug,
    git,
    dumpState,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
```

- [ ] **Step 4: Run the test, verify it PASSES.**

```bash
pnpm test src/testing/__tests__/consumer-fixture.test.ts
```

Expected output: 3 passing tests (config loads, roadmap seeded, dumpState non-empty).

- [ ] **Step 5: Commit.**

```bash
git add src/testing/consumer-fixture.ts src/testing/__tests__/consumer-fixture.test.ts
git commit -m "feat(testing): add temp-dir consumer fixture builder" -m "Noldor-FD: consumer-contract-ci-and-headless-gate-e2e-harness"
```

---

## Task 3: Stub gate entrypoint (canned fast-track work)

**Files:**
- Create: `bin/noldor-stub-gate.mjs`, `src/testing/stub-gate.ts`, `src/testing/fixtures/canned/add-greeting-helper.json`
- Test: extend `src/testing/__tests__/stub-runner.test.ts` (canned-plan application)

- [ ] **Step 1: Write the failing test for canned-plan application.**

Append to `src/testing/__tests__/stub-runner.test.ts`:

```typescript
import { buildConsumerFixture, type ConsumerFixture } from '../consumer-fixture';
import { applyStubGate } from '../stub-gate';
import { afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

let sgFx: ConsumerFixture | null = null;
afterEach(() => sgFx?.cleanup());

describe('stub gate', () => {
  it('applies the canned plan: writes file, retires entry, commits with trailers', () => {
    sgFx = buildConsumerFixture({ seedSlug: 'add-greeting-helper' });
    applyStubGate({ cwd: sgFx.dir, slug: 'add-greeting-helper' });
    expect(existsSync(join(sgFx.dir, 'src', 'greeting.ts'))).toBe(true);
    const body = sgFx.git(['log', '-1', '--format=%B']);
    expect(body).toContain('Noldor-Path: fast-track');
    expect(body).toMatch(/Noldor-Reviewed/);
    const roadmap = sgFx.git(['show', 'HEAD:docs/roadmap.md']);
    expect(roadmap).not.toContain('add-greeting-helper');
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS.**

```bash
pnpm test src/testing/__tests__/stub-runner.test.ts
```

Expected output: failure — `Cannot find module '../stub-gate'`.

- [ ] **Step 3: Create the canned fixture.**

Create `src/testing/fixtures/canned/add-greeting-helper.json`:

```json
{
  "slug": "add-greeting-helper",
  "files": [
    { "path": "src/greeting.ts", "content": "export const greet = (n: string): string => `hi ${n}`;\n" }
  ],
  "commitSubject": "feat(tooling): add greeting helper"
}
```

- [ ] **Step 4: Implement `applyStubGate` + the entrypoint.**

Create `src/testing/stub-gate.ts`:

```typescript
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

interface CannedPlan {
  slug: string;
  files: { path: string; content: string }[];
  commitSubject: string;
}

export interface StubGateOpts {
  cwd: string;
  slug: string;
}

function cannedPath(slug: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'fixtures', 'canned', `${slug}.json`);
}

/** Strip the seeded roadmap entry's schema-C block for `slug`. */
function retireRoadmapEntry(roadmap: string, slug: string): string {
  const lines = roadmap.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.startsWith('## ') && line.includes(slug)) {
      skipping = true;
      continue;
    }
    if (skipping && line.startsWith('## ')) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

/** Perform the deterministic fast-track gate work a real /gate run would, sans LLM. */
export function applyStubGate(opts: StubGateOpts): void {
  const { cwd, slug } = opts;
  const plan = JSON.parse(readFileSync(cannedPath(slug), 'utf8')) as CannedPlan;
  for (const f of plan.files) {
    const abs = join(cwd, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content);
  }
  const roadmapPath = join(cwd, 'docs', 'roadmap.md');
  writeFileSync(roadmapPath, retireRoadmapEntry(readFileSync(roadmapPath, 'utf8'), slug));

  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
  };
  git(['add', '-A']);
  const msg = [
    plan.commitSubject,
    '',
    `Noldor-FD: ${slug}`,
    'Noldor-Path: fast-track',
    'Noldor-Reviewed-Claude: stub',
    'Noldor-Reviewed-Codex: stub',
  ].join('\n');
  git(['commit', '-q', '--no-verify', '-m', msg]);
}

/** Parse the slug from the gate prompt (`/gate --resume <slug>`) or env. */
function slugFromPrompt(prompt: string): string | null {
  const m = prompt.match(/--resume\s+(\S+)/);
  if (m) return m[1];
  return process.env.NOLDOR_STUB_SLUG ?? null;
}

/** CLI entrypoint (invoked via bin/noldor-stub-gate.mjs). */
export function main(argv: string[]): number {
  const prompt = argv[2] ?? '/gate';
  const slug = slugFromPrompt(prompt);
  if (!slug) {
    process.stderr.write('stub-gate: no slug (set NOLDOR_STUB_SLUG or pass --resume <slug>)\n');
    return 2;
  }
  try {
    applyStubGate({ cwd: process.cwd(), slug });
    return 0;
  } catch (err) {
    process.stderr.write(`stub-gate: ${(err as Error).message}\n`);
    return 1;
  }
}
```

Create `bin/noldor-stub-gate.mjs` (mirror `bin/noldor.mjs`'s tsx bootstrap):

```javascript
#!/usr/bin/env node
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('tsx/esm', pathToFileURL('./'));
const { main } = await import('../src/testing/stub-gate.ts');
process.exit(main(process.argv));
```

- [ ] **Step 5: Run the test, verify it PASSES.**

```bash
pnpm test src/testing/__tests__/stub-runner.test.ts
```

Expected output: all tests pass, including the new stub-gate case (file written, trailers present, entry retired).

- [ ] **Step 6: Commit.**

```bash
git add bin/noldor-stub-gate.mjs src/testing/stub-gate.ts src/testing/fixtures/canned/add-greeting-helper.json src/testing/__tests__/stub-runner.test.ts
git commit -m "feat(testing): add canned stub-gate entrypoint for hermetic drains" -m "Noldor-FD: consumer-contract-ci-and-headless-gate-e2e-harness"
```

---

## Task 4: Contract harness (install tarball + run CLI contract)

**Files:**
- Create: `src/testing/contract-harness.ts`
- Test: `src/testing/__tests__/contract-harness.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `src/testing/__tests__/contract-harness.test.ts`:

```typescript
// @tests: consumer-contract-ci-and-headless-gate-e2e-harness
import { afterEach, describe, expect, it } from 'vitest';
import { buildConsumerFixture, type ConsumerFixture } from '../consumer-fixture';
import { runConsumerCli } from '../contract-harness';

let fx: ConsumerFixture | null = null;
afterEach(() => fx?.cleanup());

describe('contract harness — CLI contract on the fixture', () => {
  it('validate features exits 0 on a clean fixture', () => {
    fx = buildConsumerFixture();
    const r = runConsumerCli(fx.dir, ['validate', 'features']);
    expect(r.exitCode).toBe(0);
  });
  it('a renamed consumer config field fails the contract', () => {
    fx = buildConsumerFixture();
    // corrupt the config: drop a required field
    const cfgPath = `${fx.dir}/.noldor/config.json`;
    const cfg = JSON.parse(require('node:fs').readFileSync(cfgPath, 'utf8'));
    delete cfg.consumer.name;
    require('node:fs').writeFileSync(cfgPath, JSON.stringify(cfg));
    const r = runConsumerCli(fx.dir, ['doctor']);
    expect(r.exitCode).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS.**

```bash
pnpm test src/testing/__tests__/contract-harness.test.ts
```

Expected output: failure — `Cannot find module '../contract-harness'`.

- [ ] **Step 3: Implement the contract harness.**

Create `src/testing/contract-harness.ts`:

```typescript
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Repo root: src/testing/ -> src/ -> root. */
function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/**
 * Run the framework CLI against a fixture dir, in-tree (no tarball) for speed.
 * The contract job's tarball install is exercised by {@link installFrameworkTarball};
 * unit tests use the in-tree bin to keep the suite fast.
 */
export function runConsumerCli(cwd: string, args: string[]): CliResult {
  const bin = join(repoRoot(), 'bin', 'noldor.mjs');
  const r = spawnSync('node', [bin, ...args], { cwd, encoding: 'utf8' });
  return { exitCode: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Build a tarball of the working tree and install it into the fixture (contract fidelity). */
export function installFrameworkTarball(fixtureDir: string): void {
  const root = repoRoot();
  const out = execFileSync('pnpm', ['pack', '--pack-destination', fixtureDir], {
    cwd: root,
    encoding: 'utf8',
  });
  const tgz = out.trim().split('\n').pop() as string;
  execFileSync('pnpm', ['add', join(fixtureDir, tgz)], { cwd: fixtureDir, stdio: 'pipe' });
}

/** Drive the four read-only contract commands; return per-step exit codes. */
export function runContractChecks(fixtureDir: string): Record<string, number> {
  const steps: [string, string[]][] = [
    ['init', ['init']],
    ['doctor', ['doctor']],
    ['validate-features', ['validate', 'features']],
    ['garden-detect', ['garden', 'detect']],
  ];
  const out: Record<string, number> = {};
  for (const [name, args] of steps) out[name] = runConsumerCli(fixtureDir, args).exitCode;
  return out;
}
```

- [ ] **Step 4: Run the test, verify it PASSES.**

```bash
pnpm test src/testing/__tests__/contract-harness.test.ts
```

Expected output: both tests pass (clean fixture → `validate features` exits 0; corrupted config → `doctor` exits non-zero).

- [ ] **Step 5: Commit.**

```bash
git add src/testing/contract-harness.ts src/testing/__tests__/contract-harness.test.ts
git commit -m "feat(testing): add consumer-contract harness driving the CLI contract" -m "Noldor-FD: consumer-contract-ci-and-headless-gate-e2e-harness"
```

---

## Task 5: Headless drain e2e + marker + failure-path probes

**Files:**
- Test: `src/testing/__tests__/drain-e2e.test.ts`

- [ ] **Step 1: Write the failing e2e test (happy path + marker + failure probes).**

Create `src/testing/__tests__/drain-e2e.test.ts`:

```typescript
// @tests: consumer-contract-ci-and-headless-gate-e2e-harness
import { afterEach, describe, expect, it } from 'vitest';
import { buildConsumerFixture, type ConsumerFixture } from '../consumer-fixture';
import { applyStubGate } from '../stub-gate';
import { writeSession, readSession } from '../../core/session';
import { runPreCommit } from '../../hooks/noldor-pre-commit';
import { acquireLock, liveLockPid } from '../../autonomous/drain-lock';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

let fx: ConsumerFixture | null = null;
afterEach(() => fx?.cleanup());

describe('headless drain e2e (stub runner)', () => {
  it('drains a seeded XS entry: file written, entry retired, trailers on commit', () => {
    fx = buildConsumerFixture({ seedSlug: 'add-greeting-helper' });
    // The drain spawns the gate; the stub gate IS the gate here. Apply it directly
    // to assert the outcome oracle without the multi-process gh dependency.
    applyStubGate({ cwd: fx.dir, slug: 'add-greeting-helper' });
    const roadmap = fx.git(['show', 'HEAD:docs/roadmap.md']);
    expect(roadmap).not.toContain('add-greeting-helper');
    const body = fx.git(['log', '-1', '--format=%B']);
    expect(body).toContain('Noldor-Path: fast-track');
    expect(body).toMatch(/Noldor-Reviewed/);
  }, 30_000);

  it('marker probe: micro-chore accepts docs diff, rejects src diff', () => {
    fx = buildConsumerFixture();
    writeSession(fx.dir, { path: 'micro-chore', startedAt: new Date().toISOString() });
    expect(readSession(fx.dir)?.path).toBe('micro-chore');
    // staged docs-only diff is allowed; a src/ diff is not
    writeFileSync(join(fx.dir, 'docs', 'note.md'), 'note\n');
    fx.git(['add', 'docs/note.md']);
    const okRes = runPreCommit({ cwd: fx.dir, nowMs: Date.now(), ttlHours: 24 });
    expect(okRes.ok).toBe(true);
    writeFileSync(join(fx.dir, 'src', 'evil.ts'), 'export const x = 1;\n');
    fx.git(['add', 'src/evil.ts']);
    const badRes = runPreCommit({ cwd: fx.dir, nowMs: Date.now(), ttlHours: 24 });
    expect(badRes.ok).toBe(false);
  });

  it('failure probe: a live drain.lock is detected', () => {
    fx = buildConsumerFixture();
    const lock = acquireLock(fx.dir, new Date().toISOString());
    expect(lock.ok).toBe(true);
    // a second acquire fails while the first holder is live
    const second = acquireLock(fx.dir, new Date().toISOString());
    expect(second.ok).toBe(false);
    expect(liveLockPid(fx.dir)).toBe(process.pid);
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS or surfaces signature mismatches.**

```bash
pnpm test src/testing/__tests__/drain-e2e.test.ts
```

Expected output: failures — adjust the `runPreCommit` / `acquireLock` / `writeSession` call shapes to the real signatures if they differ (`runPreCommit` returns `PreCommitResult`; confirm the `.ok` field name against `src/hooks/noldor-pre-commit.ts` and fix the assertions). Iterate until the test compiles and the assertions reflect real behavior.

- [ ] **Step 3: Reconcile assertions with real signatures.**

Read `src/hooks/noldor-pre-commit.ts` (`runPreCommit` return type), `src/core/session.ts` (`SessionMarker` required fields — `micro-chore` needs `startedAt`), and `src/autonomous/drain-lock.ts` (`acquireLock` return shape). Update the test's field accesses to match. No production code changes — this task asserts existing behavior.

- [ ] **Step 4: Run the test, verify it PASSES.**

```bash
pnpm test src/testing/__tests__/drain-e2e.test.ts
```

Expected output: 3 passing tests (drain outcome, marker accept/reject, lock detection).

- [ ] **Step 5: Commit.**

```bash
git add src/testing/__tests__/drain-e2e.test.ts
git commit -m "test(testing): add headless drain + marker + lock e2e probes" -m "Noldor-FD: consumer-contract-ci-and-headless-gate-e2e-harness"
```

---

## Task 6: CI wiring + npm scripts + docs

**Files:**
- Create: `.github/workflows/contract-e2e.yml`, `scripts/test-contract.mjs`
- Modify: `package.json`, `docs/noldor/script-catalog.md`, `docs/noldor/testing-principles.md`

- [ ] **Step 1: Add the `test:contract` runner script.**

Create `scripts/test-contract.mjs`:

```javascript
#!/usr/bin/env node
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('tsx/esm', pathToFileURL('./'));
const { buildConsumerFixture } = await import('../src/testing/consumer-fixture.ts');
const { installFrameworkTarball, runContractChecks } = await import(
  '../src/testing/contract-harness.ts'
);

const fx = buildConsumerFixture();
try {
  installFrameworkTarball(fx.dir);
  const results = runContractChecks(fx.dir);
  const failed = Object.entries(results).filter(([, code]) => code !== 0);
  if (failed.length) {
    console.error('Contract checks failed:', failed);
    console.error(fx.dumpState());
    process.exit(1);
  }
  console.log('Contract checks passed:', results);
} finally {
  fx.cleanup();
}
```

- [ ] **Step 2: Add the npm scripts.**

In `package.json` `scripts`, add:

```json
    "test:contract": "node scripts/test-contract.mjs",
    "test:e2e:drain": "vitest run src/testing/__tests__/drain-e2e.test.ts",
```

- [ ] **Step 3: Verify the scripts run.**

```bash
pnpm test:e2e:drain
```

Expected output: the drain-e2e suite passes (3 tests). (`pnpm test:contract` exercises `pnpm pack`; run it once locally to confirm < 5 min, but it is allowed to be CI-primary.)

- [ ] **Step 4: Add the CI workflow.**

Create `.github/workflows/contract-e2e.yml`:

```yaml
name: contract-e2e
on:
  pull_request:
  schedule:
    - cron: '0 6 * * *'
jobs:
  contract:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test:contract
  drain-e2e:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:e2e:drain
  nightly-real-agent:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    env:
      NOLDOR_RUN_REAL_AGENT: '1'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:e2e:drain
```

- [ ] **Step 5: Document the harness in the framework docs.**

In `docs/noldor/script-catalog.md`, add a `## Testing harness` section with two entries (`test:contract`, `test:e2e:drain`) in the existing per-command format (Trigger / Inputs / Outputs / When to use / Source → `src/testing/`). In `docs/noldor/testing-principles.md`, add a short "Framework self-test" subsection under Layers describing the generated fixture-consumer + headless-drain harness and the `stub` runner seam (`agents.default: 'stub'`), plus the `NOLDOR_RUN_REAL_AGENT=1` opt-in.

- [ ] **Step 6: Run full verify.**

```bash
pnpm verify
```

Expected output: lint + fmt:check + typecheck + test all pass.

- [ ] **Step 7: Commit.**

```bash
git add .github/workflows/contract-e2e.yml scripts/test-contract.mjs package.json docs/noldor/script-catalog.md docs/noldor/testing-principles.md
git commit -m "feat(testing): wire contract + drain-e2e lanes into CI and docs" -m "Noldor-FD: consumer-contract-ci-and-headless-gate-e2e-harness"
```
