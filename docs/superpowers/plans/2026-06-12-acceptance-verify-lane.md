# Acceptance-Verify Lane Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Add a `verify` CR lane for `code` artifacts: a deterministic smoke floor (`noldor verify smoke` — doctor + boot every configured surface + HTTP-200/exit-0 probe) plus an independent verifier agent that exercises the new behavior through the real interface and emits `{ pass | fail | cannot-verify }` with quoted evidence. Smoke fail blocks in both modes; the agent verdict respects `autonomous.verifyMode` (default `advisory`).

**Architecture:** Mirror of the subagent lane — new `RunLane` in `src/cr/lanes/verify.ts` registered in orchestrate's `LANES` dispatch; agent spawned headless via `spawnAgent(role: 'verifier')`; deterministic smoke module in `src/verify/` with a CLI manifest entry. Boot knowledge in `consumer.verifyCommands`; policy knob `autonomous.verifyMode`. Spec: `docs/superpowers/specs/2026-06-12-acceptance-verify-lane-design.md`.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), zod, vitest, node:child_process, node:net.

---

## File Structure

- `src/core/consumer-config.ts` — modify: `verifyCommands` schema field + `loadVerifyCommands()` tolerant loader
- `src/core/agent-runner/types.ts` — modify: `AGENT_ROLES` gains `'verifier'`
- `src/verify/port.ts` — create: `resolvePort(cwd)` — `.env.local` `PORT` or free port via `net`
- `src/verify/smoke.ts` — create: `runSmoke(cwd, port, deps?)` — doctor + boot surfaces + probe → `SmokeReport`
- `src/verify/smoke-cli.ts` — create: `noldor verify smoke [--json]` entrypoint
- `src/cli/manifest.ts` — modify: new `verify` group with `smoke` sub
- `src/cr/findings-schema.ts` — modify: `laneSchema` gains `'verify'`; `laneFindingsSchema` gains `verdict`/`evidence`/`mismatches`
- `src/cr/read-fd-summary.ts` — modify: add `extractFdAcceptance()` (`## Summary` + `## Usage`)
- `src/cr/config.ts` — modify: `autonomousConfigSchema` gains `verifyMode`
- `src/cr/lanes/verify-dispatch.ts` — create: prompt builder + fenced-JSON verdict parser + `setVerifyDispatcher()` seam
- `src/cr/lanes/verify.ts` — create: `runVerify()` lane runner (smoke-first, acceptance fallback chain, verdict×mode mapping)
- `src/cr/orchestrate.ts` — modify: register `verify` in `LANES`, add code-only kind guard
- `.noldor/config.json` — modify: self-host opt-in (`crLanes.code`, `consumer.verifyCommands`)
- `docs/noldor/cr-pipeline.md` + `templates/docs/noldor/cr-pipeline.md` — modify (twins, identical edit): verify-lane section
- `docs/noldor/adoption-guide.md` + `templates/docs/noldor/adoption-guide.md` — modify (twins): config reference
- Tests: `src/verify/__tests__/port.test.ts`, `src/verify/__tests__/smoke.test.ts`, `src/cr/__tests__/lanes/verify.test.ts`, plus additions to `src/core/__tests__/consumer-config.test.ts`, `src/cr/__tests__/findings-schema.test.ts`, `src/cr/__tests__/config.test.ts`, `src/cr/__tests__/read-fd-summary.test.ts`, `src/cr/__tests__/orchestrate.test.ts`

---

## Task 1: `verifyCommands` consumer-config block

**Files:**
- Modify: `src/core/consumer-config.ts`
- Test: `src/core/__tests__/consumer-config.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/core/__tests__/consumer-config.test.ts` (follow the file's existing tmpdir + `writeConfig` helpers; if the file has none, use this self-contained block):

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConsumerConfig, loadVerifyCommands } from '../consumer-config.js';

function writeConsumer(consumer: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-vc-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(join(dir, '.noldor', 'config.json'), JSON.stringify({ consumer }));
  return dir;
}

const BASE = {
  name: 'x',
  repoUrl: 'https://example.com/x',
  lockstepPackages: ['package.json'],
  e2ePrefix: 'e2e/',
  samplesPath: 'samples',
  packagePrefix: '@x/',
  pnpmStderrPrefix: 'x',
  appPathPrefix: 'src',
};

describe('verifyCommands', () => {
  it('parses server and cli surfaces with defaults', () => {
    const dir = writeConsumer({
      ...BASE,
      verifyCommands: {
        dashboard: { command: 'pnpm dev --port {port}', kind: 'server' },
        cli: { command: 'pnpm noldor --help', kind: 'cli' },
      },
    });
    const cfg = loadConsumerConfig(dir);
    expect(cfg.verifyCommands.dashboard).toEqual({
      command: 'pnpm dev --port {port}',
      kind: 'server',
      healthPath: '/',
      readyTimeoutMs: 30_000,
    });
    expect(cfg.verifyCommands.cli.kind).toBe('cli');
  });

  it('defaults to empty record when absent', () => {
    const dir = writeConsumer(BASE);
    expect(loadConsumerConfig(dir).verifyCommands).toEqual({});
  });

  it('loadVerifyCommands is tolerant: {} on missing config', () => {
    expect(loadVerifyCommands(mkdtempSync(join(tmpdir(), 'noldor-empty-')))).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/core/__tests__/consumer-config.test.ts
```

Expected output: failures — `loadVerifyCommands` is not exported / `verifyCommands` unknown key rejected by `.strict()`.

- [ ] **Step 3: Implement.** In `src/core/consumer-config.ts`, add the surface schema above `ConsumerConfigSchema`:

```ts
/**
 * One bootable run surface for the verify lane / smoke floor. `server`
 * surfaces are booted, probed at `healthPath` until HTTP 200 or
 * `readyTimeoutMs`, then killed; `cli` surfaces run once and must exit 0.
 * `{port}` in `command` is substituted with the per-tree port at run time.
 */
export const VerifySurfaceSchema = z
  .object({
    command: z.string().min(1),
    kind: z.enum(['server', 'cli']),
    healthPath: z.string().default('/'),
    readyTimeoutMs: z.number().int().positive().default(30_000),
  })
  .strict();

export type VerifySurface = z.infer<typeof VerifySurfaceSchema>;
```

Inside `ConsumerConfigSchema`, after `scopeAliases`:

```ts
    /**
     * Named run surfaces for the verify lane's smoke floor (see
     * docs/noldor/cr-pipeline.md). Empty by default — smoke is opt-in.
     */
    verifyCommands: z.record(z.string(), VerifySurfaceSchema).default({}),
```

At the bottom of the file, beside `loadScopeAliases`:

```ts
/**
 * The consumer's named verify surfaces (empty when no config). Tolerant by
 * design, mirroring {@link loadScopeAliases}: a missing or invalid config
 * yields `{}` so smoke/verify callers never throw at load time.
 */
export function loadVerifyCommands(cwd: string = process.cwd()): Record<string, VerifySurface> {
  try {
    return loadConsumerConfig(cwd).verifyCommands;
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/core/__tests__/consumer-config.test.ts
```

Expected output: all tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/core/consumer-config.ts src/core/__tests__/consumer-config.test.ts
git commit -m "feat(acceptance-verify-lane): add verifyCommands consumer-config block" -m "Noldor-FD: acceptance-verify-lane"
```

## Task 2: `verifier` agent role

**Files:**
- Modify: `src/core/agent-runner/types.ts`
- Test: `src/core/agent-runner/__tests__/registry.test.ts` (additions)

- [ ] **Step 1: Write the failing test.** Append to `src/core/agent-runner/__tests__/registry.test.ts` (reuse its existing imports of `resolveRunner`/`agentsConfigSchema`; add `AGENT_ROLES` to the types import):

```ts
describe('verifier role', () => {
  it('is a registered role and resolves to the default runner when unmapped', () => {
    expect(AGENT_ROLES).toContain('verifier');
    const cfg = agentsConfigSchema.parse({});
    expect(resolveRunner('verifier', cfg)).toEqual({ runner: 'claude' });
  });

  it('can be remapped via agents.roles like any role', () => {
    const cfg = agentsConfigSchema.parse({ roles: { verifier: { runner: 'opencode' } } });
    expect(resolveRunner('verifier', cfg)).toEqual({ runner: 'opencode' });
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/core/agent-runner/__tests__/registry.test.ts
```

Expected output: type/parse failure — `'verifier'` not in `AGENT_ROLES` enum.

- [ ] **Step 3: Implement.** In `src/core/agent-runner/types.ts` line 3:

```ts
export const AGENT_ROLES = ['implementer', 'reviewer', 'second-opinion', 'polish', 'verifier'] as const;
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/core/agent-runner/__tests__/registry.test.ts
```

Expected output: all tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/core/agent-runner/types.ts src/core/agent-runner/__tests__/registry.test.ts
git commit -m "feat(acceptance-verify-lane): add verifier agent role" -m "Noldor-FD: acceptance-verify-lane"
```

## Task 3: `resolvePort`

**Files:**
- Create: `src/verify/port.ts`
- Test: `src/verify/__tests__/port.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/verify/__tests__/port.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePort } from '../port.js';

describe('resolvePort', () => {
  it('reads PORT from .env.local at the worktree root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-port-'));
    writeFileSync(join(dir, '.env.local'), 'FOO=bar\nPORT=4321\n');
    await expect(resolvePort(dir)).resolves.toBe(4321);
  });

  it('falls back to a free ephemeral port when .env.local is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-port-'));
    const port = await resolvePort(dir);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65_536);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/verify/__tests__/port.test.ts
```

Expected output: `Cannot find module '../port.js'`.

- [ ] **Step 3: Implement.** Create `src/verify/port.ts`:

```ts
// @tests: acceptance-verify-lane
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

/**
 * Resolve the port for verify-lane boots, exactly once per lane run: the
 * worktree's `PORT` from `.env.local` (the port-per-tree convention in
 * docs/noldor/worktree-discipline.md), else a free ephemeral port found by
 * binding port 0. Callers pass the concrete number everywhere (smoke and the
 * verifier prompt) so all boots in one run target the same port.
 */
export function resolvePort(cwd: string): Promise<number> {
  try {
    const env = readFileSync(join(cwd, '.env.local'), 'utf8');
    const m = env.match(/^PORT=(\d+)\s*$/m);
    if (m) return Promise.resolve(Number(m[1]));
  } catch {
    /* no .env.local — fall through to free-port probe */
  }
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/verify/__tests__/port.test.ts
```

Expected output: 2 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/verify/port.ts src/verify/__tests__/port.test.ts
git commit -m "feat(acceptance-verify-lane): add resolvePort (.env.local PORT or free port)" -m "Noldor-FD: acceptance-verify-lane"
```

## Task 4: smoke floor module

**Files:**
- Create: `src/verify/smoke.ts`
- Test: `src/verify/__tests__/smoke.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/verify/__tests__/smoke.test.ts`. Stub commands are real `node -e` one-liners; the doctor command is injected so tests never shell out to `pnpm noldor doctor`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePort } from '../port.js';
import { runSmoke } from '../smoke.js';

const OK_DOCTOR = 'node -e "process.exit(0)"';
const BAD_DOCTOR = 'node -e "console.error(\'drift: AGENTS.md\'); process.exit(1)"';

function consumerDir(verifyCommands: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-smoke-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor', 'config.json'),
    JSON.stringify({
      consumer: {
        name: 'x',
        repoUrl: 'https://example.com/x',
        lockstepPackages: ['package.json'],
        e2ePrefix: 'e2e/',
        samplesPath: 'samples',
        packagePrefix: '@x/',
        pnpmStderrPrefix: 'x',
        appPathPrefix: 'src',
        verifyCommands,
      },
    }),
  );
  return dir;
}

describe('runSmoke', () => {
  it('fails fast with doctor evidence when doctor is red', async () => {
    const dir = consumerDir({});
    const report = await runSmoke(dir, 4000, { doctorCommand: BAD_DOCTOR });
    expect(report.ok).toBe(false);
    expect(report.surfaces[0].name).toBe('doctor');
    expect(report.surfaces[0].evidence.observed).toContain('drift: AGENTS.md');
  });

  it('is green with a note when zero surfaces are configured', async () => {
    const dir = consumerDir({});
    const report = await runSmoke(dir, 4000, { doctorCommand: OK_DOCTOR });
    expect(report.ok).toBe(true);
    expect(report.notes).toContain('no surfaces configured');
  });

  it('cli surface: exit 0 passes, non-zero fails with output quoted', async () => {
    const dir = consumerDir({
      good: { command: 'node -e "process.exit(0)"', kind: 'cli' },
      bad: { command: 'node -e "console.error(\'boom\'); process.exit(3)"', kind: 'cli' },
    });
    const report = await runSmoke(dir, 4000, { doctorCommand: OK_DOCTOR });
    expect(report.ok).toBe(false);
    const byName = Object.fromEntries(report.surfaces.map((s) => [s.name, s]));
    expect(byName.good.ok).toBe(true);
    expect(byName.bad.ok).toBe(false);
    expect(byName.bad.evidence.observed).toContain('boom');
  });

  it('server surface: boots on {port}, probes 200, kills the process', async () => {
    const server =
      'node -e "require(\'node:http\').createServer((q,s)=>s.end(\'ok\')).listen({port},\'127.0.0.1\')"';
    const dir = consumerDir({ web: { command: server, kind: 'server', readyTimeoutMs: 10_000 } });
    const port = await resolvePort(dir);
    const report = await runSmoke(dir, port, { doctorCommand: OK_DOCTOR });
    expect(report.ok).toBe(true);
    const web = report.surfaces.find((s) => s.name === 'web');
    expect(web?.evidence.observed).toContain('200');
    // the boot was killed: the port is free again
    await expect(
      fetch(`http://127.0.0.1:${port}/`).then(() => 'up', () => 'down'),
    ).resolves.toBe('down');
  });

  it('server surface: no 200 within readyTimeoutMs fails with evidence', async () => {
    const dir = consumerDir({
      dead: { command: 'node -e "setTimeout(()=>{}, 60000)"', kind: 'server', readyTimeoutMs: 1500 },
    });
    const report = await runSmoke(dir, 4000, { doctorCommand: OK_DOCTOR });
    expect(report.ok).toBe(false);
    expect(report.surfaces.find((s) => s.name === 'dead')?.evidence.observed).toContain('no HTTP 200');
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/verify/__tests__/smoke.test.ts
```

Expected output: `Cannot find module '../smoke.js'`.

- [ ] **Step 3: Implement.** Create `src/verify/smoke.ts`:

```ts
// @tests: acceptance-verify-lane
import { execFile, spawn } from 'node:child_process';
import { loadVerifyCommands } from '../core/consumer-config.js';
import type { VerifySurface } from '../core/consumer-config.js';

export interface SmokeSurfaceResult {
  name: string;
  ok: boolean;
  evidence: { command: string; observed: string };
}

export interface SmokeReport {
  ok: boolean;
  surfaces: SmokeSurfaceResult[];
  notes: string[];
}

export interface SmokeDeps {
  /** Injected by tests; defaults to the real doctor. */
  doctorCommand?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_DOCTOR = 'pnpm noldor doctor';
const OBSERVED_CAP = 2000;

function runShell(command: string, cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', command], { cwd, timeout: 120_000 }, (err, stdout, stderr) => {
      const rawCode = err ? ((err as NodeJS.ErrnoException & { code?: unknown }).code ?? 1) : 0;
      resolve({
        code: typeof rawCode === 'number' ? rawCode : 1,
        output: `${stdout}${stderr}`.trim(),
      });
    });
  });
}

async function probeServer(
  name: string,
  surface: VerifySurface,
  port: number,
  cwd: string,
  fetchImpl: typeof fetch,
): Promise<SmokeSurfaceResult> {
  const command = surface.command.replaceAll('{port}', String(port));
  // Own process group so cleanup kills the whole boot tree (pnpm → node → …).
  const child = spawn('/bin/sh', ['-c', command], { cwd, detached: true, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}${surface.healthPath}`;
  const deadline = Date.now() + surface.readyTimeoutMs;
  try {
    while (Date.now() < deadline) {
      try {
        const res = await fetchImpl(url);
        if (res.status === 200) {
          return { name, ok: true, evidence: { command, observed: `GET ${url} → 200` } };
        }
      } catch {
        /* not accepting connections yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return {
      name,
      ok: false,
      evidence: { command, observed: `GET ${url} → no HTTP 200 within ${surface.readyTimeoutMs}ms` },
    };
  } finally {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already exited */
      }
    }
  }
}

/**
 * The smoke floor: `noldor doctor` + boot every `consumer.verifyCommands`
 * surface + probe. Deterministic and agent-free; blocking in BOTH verify
 * modes (stop-the-line semantics — see the spec, Unit 4 step 2). Surfaces are
 * booted sequentially so one port serves all of them.
 */
export async function runSmoke(cwd: string, port: number, deps: SmokeDeps = {}): Promise<SmokeReport> {
  const doctorCommand = deps.doctorCommand ?? DEFAULT_DOCTOR;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const notes: string[] = [];

  const doctor = await runShell(doctorCommand, cwd);
  if (doctor.code !== 0) {
    return {
      ok: false,
      surfaces: [
        {
          name: 'doctor',
          ok: false,
          evidence: { command: doctorCommand, observed: doctor.output.slice(0, OBSERVED_CAP) },
        },
      ],
      notes,
    };
  }
  const surfaces: SmokeSurfaceResult[] = [
    { name: 'doctor', ok: true, evidence: { command: doctorCommand, observed: 'exit 0' } },
  ];

  const commands = loadVerifyCommands(cwd);
  if (Object.keys(commands).length === 0) notes.push('no surfaces configured');
  for (const [name, surface] of Object.entries(commands)) {
    if (surface.kind === 'server') {
      surfaces.push(await probeServer(name, surface, port, cwd, fetchImpl));
    } else {
      const command = surface.command.replaceAll('{port}', String(port));
      const r = await runShell(command, cwd);
      surfaces.push({
        name,
        ok: r.code === 0,
        evidence: {
          command,
          observed: r.code === 0 ? 'exit 0' : r.output.slice(0, OBSERVED_CAP) || `exit ${r.code}`,
        },
      });
    }
  }
  return { ok: surfaces.every((s) => s.ok), surfaces, notes };
}
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/verify/__tests__/smoke.test.ts
```

Expected output: 5 tests pass (server tests take a few seconds).

- [ ] **Step 5: Commit.**

```bash
git add src/verify/smoke.ts src/verify/__tests__/smoke.test.ts
git commit -m "feat(acceptance-verify-lane): smoke floor (doctor + boot surfaces + probe)" -m "Noldor-FD: acceptance-verify-lane"
```

## Task 5: `noldor verify smoke` CLI

**Files:**
- Create: `src/verify/smoke-cli.ts`
- Modify: `src/cli/manifest.ts`

- [ ] **Step 1: Create the entrypoint.** Create `src/verify/smoke-cli.ts` (manifest entrypoints run top-level, like `src/cli/commands/doctor.ts`):

```ts
// @tests: acceptance-verify-lane
// `noldor verify smoke [--json]` — the smoke floor, standalone. Exit 0 when
// doctor + every configured surface is green; exit 1 otherwise.
import { resolvePort } from './port.js';
import { runSmoke } from './smoke.js';

const json = process.argv.includes('--json');
const cwd = process.cwd();
const port = await resolvePort(cwd);
const report = await runSmoke(cwd, port);

if (json) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
} else {
  for (const s of report.surfaces) {
    process.stdout.write(`${s.ok ? '✓' : '✗'} ${s.name}: ${s.evidence.observed}\n`);
  }
  for (const n of report.notes) process.stdout.write(`note: ${n}\n`);
  process.stdout.write(report.ok ? 'smoke OK\n' : 'smoke FAILED\n');
}
process.exit(report.ok ? 0 : 1);
```

- [ ] **Step 2: Register in the manifest.** In `src/cli/manifest.ts`, add a `verify` group after the `worktrees` group (alphabetical placement is not enforced; adjacency to other dev-flow groups is the convention):

```ts
  verify: {
    desc: 'Acceptance verification (smoke floor)',
    subs: {
      smoke: {
        src: 'verify/smoke-cli.ts',
        desc: 'Doctor + boot every consumer.verifyCommands surface + HTTP-200/exit-0 probe',
      },
    },
  },
```

- [ ] **Step 3: Run to verify.**

```bash
pnpm noldor verify smoke
```

Expected output (self-host has no `verifyCommands` yet — Task 10 seeds them): `✓ doctor: exit 0`, `note: no surfaces configured`, `smoke OK`, exit 0. If `noldor doctor` itself is red on this tree, the output quotes the drift and exits 1 — investigate before proceeding; the floor working is the point.

- [ ] **Step 4: Commit.**

```bash
git add src/verify/smoke-cli.ts src/cli/manifest.ts
git commit -m "feat(acceptance-verify-lane): noldor verify smoke CLI" -m "Noldor-FD: acceptance-verify-lane"
```

## Task 6: schema extensions — `verify` lane + verdict fields + `verifyMode`

**Files:**
- Modify: `src/cr/findings-schema.ts`, `src/cr/config.ts`
- Test: `src/cr/__tests__/findings-schema.test.ts`, `src/cr/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `src/cr/__tests__/findings-schema.test.ts`:

```ts
describe('verify lane extensions', () => {
  it('laneSchema accepts verify', () => {
    expect(laneSchema.parse('verify')).toBe('verify');
  });

  it('laneFindingsSchema accepts verdict/evidence/mismatches', () => {
    const parsed = laneFindingsSchema.parse({
      lane: 'verify',
      artifact: '.',
      kind: 'code',
      slug: 's',
      summary: 'verified',
      startedAt: new Date().toISOString(),
      verdict: 'fail',
      evidence: [{ command: 'curl localhost:4000/x', observed: '[]' }],
      mismatches: ['promised object, observed array'],
    });
    expect(parsed.verdict).toBe('fail');
    expect(parsed.evidence?.[0].command).toContain('curl');
  });
});
```

Append to `src/cr/__tests__/config.test.ts`:

```ts
describe('verifyMode', () => {
  it('defaults to advisory', () => {
    expect(autonomousConfigSchema.parse({}).verifyMode).toBe('advisory');
  });

  it('accepts blocking', () => {
    expect(autonomousConfigSchema.parse({ verifyMode: 'blocking' }).verifyMode).toBe('blocking');
  });
});
```

(Import `autonomousConfigSchema` from `../config.js` if the test file doesn't already.)

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/findings-schema.test.ts src/cr/__tests__/config.test.ts
```

Expected output: `verify` rejected by `laneSchema`; `verifyMode` undefined.

- [ ] **Step 3: Implement.** In `src/cr/findings-schema.ts`:

```ts
export const laneSchema = z.enum(['manual', 'codex', 'subagent', 'standalone', 'verify']);
```

```ts
export const verifyVerdictValueSchema = z.enum(['pass', 'fail', 'cannot-verify']);
export type VerifyVerdictValue = z.infer<typeof verifyVerdictValueSchema>;

export const verifyEvidenceSchema = z.object({
  command: z.string().min(1),
  observed: z.string(),
});
export type VerifyEvidence = z.infer<typeof verifyEvidenceSchema>;
```

In `laneFindingsSchema`, after `fullReview`:

```ts
  // verify-lane verdict payload (absent on every other lane)
  verdict: verifyVerdictValueSchema.optional(),
  evidence: z.array(verifyEvidenceSchema).optional(),
  mismatches: z.array(z.string()).optional(),
```

In `src/cr/config.ts`, inside `autonomousConfigSchema` after `requireHumanPrApproval`:

```ts
  // Governs ONLY the verify lane's agent judgment; the smoke floor blocks in
  // both modes (stop-the-line). Advisory default = one bake-in release.
  verifyMode: z.enum(['blocking', 'advisory']).default('advisory'),
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/findings-schema.test.ts src/cr/__tests__/config.test.ts
```

Expected output: all pass. Note: `assertConfig` in `src/autonomous/queue-drain.ts` only checks three fields — the new default does not affect drain preconditions.

- [ ] **Step 5: Commit.**

```bash
git add src/cr/findings-schema.ts src/cr/config.ts src/cr/__tests__/findings-schema.test.ts src/cr/__tests__/config.test.ts
git commit -m "feat(acceptance-verify-lane): verify lane enum, verdict fields, verifyMode knob" -m "Noldor-FD: acceptance-verify-lane"
```

## Task 7: `extractFdAcceptance`

**Files:**
- Modify: `src/cr/read-fd-summary.ts`
- Test: `src/cr/__tests__/read-fd-summary.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/cr/__tests__/read-fd-summary.test.ts` (reuse its tmpdir/file helpers if present, else inline):

```ts
import { extractFdAcceptance } from '../read-fd-summary.js';

describe('extractFdAcceptance', () => {
  const write = (body: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-fd-'));
    const p = join(dir, 'fd.md');
    writeFileSync(p, body);
    return p;
  };

  it('returns Summary + Usage joined', async () => {
    const p = write('## Summary\n\nThe what.\n\n## Usage\n\n- run it\n\n## PRs\n');
    await expect(extractFdAcceptance(p)).resolves.toBe('The what.\n\n- run it');
  });

  it('tolerates a missing Usage section', async () => {
    const p = write('## Summary\n\nOnly summary.\n');
    await expect(extractFdAcceptance(p)).resolves.toBe('Only summary.');
  });

  it('throws when neither section exists', async () => {
    const p = write('# Title\nno sections\n');
    await expect(extractFdAcceptance(p)).rejects.toThrow(/no ## Summary or ## Usage/);
  });
});
```

(Add `mkdtempSync`/`writeFileSync`/`tmpdir`/`join` imports if the file lacks them.)

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/read-fd-summary.test.ts
```

Expected output: `extractFdAcceptance` is not exported.

- [ ] **Step 3: Implement.** Append to `src/cr/read-fd-summary.ts`:

```ts
/**
 * Acceptance text for the verify lane: the FD's `## Summary` and `## Usage`
 * bodies, joined. `readFdSummary` above captures Summary only — Usage is what
 * carries the testable promises (CLI invocations, endpoints, flags), so the
 * verify lane needs both. Throws when neither section exists; the caller maps
 * a missing FD file (fast-track) to its commit-prose fallback.
 */
export async function extractFdAcceptance(fdPath: string): Promise<string> {
  const raw = await readFile(fdPath, 'utf8');
  const grab = (heading: string): string =>
    raw
      .match(new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))?.[1]
      .trim() ?? '';
  const parts = [grab('Summary'), grab('Usage')].filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`extractFdAcceptance: no ## Summary or ## Usage section in ${fdPath}`);
  }
  return parts.join('\n\n');
}
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/read-fd-summary.test.ts
```

Expected output: all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/cr/read-fd-summary.ts src/cr/__tests__/read-fd-summary.test.ts
git commit -m "feat(acceptance-verify-lane): extractFdAcceptance (Summary + Usage)" -m "Noldor-FD: acceptance-verify-lane"
```

## Task 8: verify dispatch — prompt, parser, injection seam

**Files:**
- Create: `src/cr/lanes/verify-dispatch.ts`
- Test: `src/cr/__tests__/lanes/verify-dispatch.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/lanes/verify-dispatch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildVerifyPrompt, parseVerifyVerdict } from '../../lanes/verify-dispatch.js';

describe('buildVerifyPrompt', () => {
  it('carries acceptance text, range, concrete commands, and the no-source-reading rule', () => {
    const p = buildVerifyPrompt({
      acceptance: 'GET /x returns an object',
      baseSha: 'aaa',
      headSha: 'bbb',
      surfaces: [{ name: 'dashboard', command: 'pnpm dev --port 4321', kind: 'server', healthPath: '/', readyTimeoutMs: 30_000 }],
      port: 4321,
    });
    expect(p).toContain('GET /x returns an object');
    expect(p).toContain('aaa..bbb');
    expect(p).toContain('pnpm dev --port 4321');
    expect(p).not.toContain('{port}');
    expect(p).toMatch(/never conclude from reading source/i);
  });
});

describe('parseVerifyVerdict', () => {
  it('parses a fenced JSON verdict', () => {
    const md = 'Booted it.\n```json\n{"verdict":"fail","evidence":[{"command":"curl :4321/x","observed":"[]"}],"mismatches":["object promised, array observed"]}\n```\n';
    const v = parseVerifyVerdict(md);
    expect(v?.verdict).toBe('fail');
    expect(v?.mismatches).toEqual(['object promised, array observed']);
  });

  it('returns null on missing or malformed JSON', () => {
    expect(parseVerifyVerdict('no fence here')).toBeNull();
    expect(parseVerifyVerdict('```json\n{"verdict":"maybe"}\n```')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/lanes/verify-dispatch.test.ts
```

Expected output: `Cannot find module '../../lanes/verify-dispatch.js'`.

- [ ] **Step 3: Implement.** Create `src/cr/lanes/verify-dispatch.ts`:

```ts
import { z } from 'zod';
import { spawnAgent } from '../../core/agent-runner/registry.js';
import { verifyEvidenceSchema, verifyVerdictValueSchema } from '../findings-schema.js';
import type { VerifySurface } from '../../core/consumer-config.js';

export const verifyVerdictSchema = z.object({
  verdict: verifyVerdictValueSchema,
  evidence: z.array(verifyEvidenceSchema).default([]),
  mismatches: z.array(z.string()).default([]),
  reason: z.string().optional(),
});
export type VerifyVerdict = z.infer<typeof verifyVerdictSchema>;

export interface VerifyDispatchInput {
  acceptance: string;
  baseSha: string;
  headSha: string;
  /** Surfaces with `{port}` ALREADY substituted — the agent gets runnable commands. */
  surfaces: Array<VerifySurface & { name: string }>;
  port: number;
}

export function buildVerifyPrompt(input: VerifyDispatchInput): string {
  const surfaceLines =
    input.surfaces.length > 0
      ? input.surfaces
          .map((s) => {
            const cmd = s.command.replaceAll('{port}', String(input.port));
            return s.kind === 'server'
              ? `- ${s.name} (server): \`${cmd}\` — health probe GET http://127.0.0.1:${input.port}${s.healthPath} (ready within ${s.readyTimeoutMs}ms)`
              : `- ${s.name} (cli): \`${cmd}\``;
          })
          .join('\n')
      : '- (none configured — if the change has no reachable interface, emit cannot-verify)';
  return `You are an independent Acceptance Verifier. Judge whether the change in range ${input.baseSha}..${input.headSha} actually delivers the promised behavior.

Promised behavior (acceptance text):
${input.acceptance}

Boot surfaces (commands are runnable as-is; servers listen on port ${input.port}):
${surfaceLines}

Hard rules:
1. Exercise the SPECIFIC new behavior through the real interface — CLI invocation, HTTP request, file output. Never conclude from reading source code; reading code to find the interface is fine, judging from it is not.
2. Quote real observed output in evidence. Every evidence entry is a command you actually ran plus what it printed.
3. Kill every process you start.
4. \`cannot-verify\` is an honest outcome when no boot path reaches the behavior — use it with a reason instead of guessing.

When done, emit EXACTLY ONE fenced json block as the last thing in your output:

\`\`\`json
{"verdict": "pass" | "fail" | "cannot-verify", "evidence": [{"command": "...", "observed": "..."}], "mismatches": ["..."], "reason": "only for cannot-verify"}
\`\`\``;
}

/** Last fenced ```json block wins; null on absence or schema mismatch. */
export function parseVerifyVerdict(md: string): VerifyVerdict | null {
  const fences = [...md.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  const last = fences.at(-1)?.[1];
  if (!last) return null;
  try {
    return verifyVerdictSchema.parse(JSON.parse(last));
  } catch {
    return null;
  }
}

type VerifyDispatcher = (input: VerifyDispatchInput) => Promise<string>;

let dispatcher: VerifyDispatcher = async (input) => {
  const r = await spawnAgent(buildVerifyPrompt(input), {
    role: 'verifier',
    timeoutMs: 600_000,
    site: 'cr.verify-dispatch',
  });
  if (r.timedOut || r.exitCode !== 0) {
    throw new Error(`verify dispatch failed: exit ${r.exitCode}${r.timedOut ? ' (timeout)' : ''}`);
  }
  return r.stdout;
};

/** Test seam, mirroring subagent-dispatch's setDispatcher. */
export function setVerifyDispatcher(impl: VerifyDispatcher): void {
  dispatcher = impl;
}

export function dispatchVerify(input: VerifyDispatchInput): Promise<string> {
  return dispatcher(input);
}
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/lanes/verify-dispatch.test.ts
```

Expected output: all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/cr/lanes/verify-dispatch.ts src/cr/__tests__/lanes/verify-dispatch.test.ts
git commit -m "feat(acceptance-verify-lane): verifier prompt + fenced-JSON verdict parser" -m "Noldor-FD: acceptance-verify-lane"
```

## Task 9: the verify lane runner

**Files:**
- Create: `src/cr/lanes/verify.ts`
- Test: `src/cr/__tests__/lanes/verify.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/lanes/verify.test.ts`. Smoke and dispatch are both injected; the FD and config live in a tmpdir:

```ts
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { setVerifyDispatcher } from '../../lanes/verify-dispatch.js';
import { runVerify, setSmokeRunner } from '../../lanes/verify.js';
import type { LaneInput } from '../../lane-types.js';

const GREEN_SMOKE = {
  ok: true,
  surfaces: [{ name: 'doctor', ok: true, evidence: { command: 'doctor', observed: 'exit 0' } }],
  notes: [],
};
const RED_SMOKE = {
  ok: false,
  surfaces: [
    { name: 'doctor', ok: true, evidence: { command: 'doctor', observed: 'exit 0' } },
    { name: 'web', ok: false, evidence: { command: 'pnpm dev', observed: 'no HTTP 200 within 30000ms' } },
  ],
  notes: [],
};

function repo(verifyMode?: string): { cwd: string; input: LaneInput } {
  const cwd = mkdtempSync(join(tmpdir(), 'noldor-verify-'));
  mkdirSync(join(cwd, '.noldor'), { recursive: true });
  mkdirSync(join(cwd, 'docs', 'features'), { recursive: true });
  writeFileSync(
    join(cwd, '.noldor', 'config.json'),
    JSON.stringify({ autonomous: verifyMode ? { verifyMode } : {} }),
  );
  writeFileSync(
    join(cwd, 'docs', 'features', 'feat-x.md'),
    '## Summary\n\nEndpoint /x returns an object.\n\n## Usage\n\n- GET /x\n',
  );
  const input: LaneInput = {
    slug: 'feat-x',
    artifact: '.',
    kind: 'code',
    fdPath: join(cwd, 'docs', 'features', 'feat-x.md'),
    artifactSha: 'head',
    baseSha: 'base',
    repoRoot: cwd,
  };
  return { cwd, input };
}

function readSink(cwd: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(cwd, '.noldor', 'cr', 'feat-x-code-verify.json'), 'utf8'));
}

beforeEach(() => {
  setSmokeRunner(async () => GREEN_SMOKE);
  setVerifyDispatcher(async () => '```json\n{"verdict":"pass","evidence":[{"command":"curl /x","observed":"{}"}],"mismatches":[]}\n```');
});

describe('runVerify', () => {
  it('pass → ok with evidence in the sink', async () => {
    const { cwd, input } = repo();
    const r = await runVerify(input);
    expect(r.ok).toBe(true);
    const sink = readSink(cwd);
    expect(sink.verdict).toBe('pass');
    expect((sink.evidence as unknown[]).length).toBe(1);
  });

  it('smoke fail → blockers and ok:false in BOTH modes', async () => {
    setSmokeRunner(async () => RED_SMOKE);
    for (const mode of ['advisory', 'blocking']) {
      const { cwd, input } = repo(mode);
      const r = await runVerify(input);
      expect(r.ok).toBe(false);
      const sink = readSink(cwd);
      expect(sink.verdict).toBe('fail');
      expect((sink.blockers as Array<{ message: string }>)[0].message).toContain('no HTTP 200');
    }
  });

  it('agent fail + blocking → mismatches become blockers', async () => {
    setVerifyDispatcher(async () => '```json\n{"verdict":"fail","evidence":[{"command":"curl /x","observed":"[]"}],"mismatches":["object promised, array observed"]}\n```');
    const { cwd, input } = repo('blocking');
    const r = await runVerify(input);
    expect(r.ok).toBe(false);
    expect((readSink(cwd).blockers as Array<{ message: string }>)[0].message).toContain('object promised');
  });

  it('agent fail + advisory → suggestions, ok:true, ADVISORY FAIL summary', async () => {
    setVerifyDispatcher(async () => '```json\n{"verdict":"fail","evidence":[],"mismatches":["m1"]}\n```');
    const { cwd, input } = repo('advisory');
    const r = await runVerify(input);
    expect(r.ok).toBe(true);
    const sink = readSink(cwd);
    expect(sink.blockers).toEqual([]);
    expect((sink.suggestions as unknown[]).length).toBe(1);
    expect(String(sink.summary)).toMatch(/^ADVISORY FAIL:/);
  });

  it('cannot-verify → ok:true in both modes with reason note', async () => {
    setVerifyDispatcher(async () => '```json\n{"verdict":"cannot-verify","evidence":[],"mismatches":[],"reason":"no boot path"}\n```');
    for (const mode of ['advisory', 'blocking']) {
      const { cwd, input } = repo(mode);
      const r = await runVerify(input);
      expect(r.ok).toBe(true);
      expect(JSON.stringify(readSink(cwd).notes)).toContain('no boot path');
    }
  });

  it('malformed output: blocking → fail-closed blocker; advisory → cannot-verify note', async () => {
    setVerifyDispatcher(async () => 'I am confused and emit no JSON');
    const blocking = repo('blocking');
    expect((await runVerify(blocking.input)).ok).toBe(false);
    expect((readSink(blocking.cwd).blockers as Array<{ message: string }>)[0].message).toContain('verify lane errored');
    const advisory = repo('advisory');
    expect((await runVerify(advisory.input)).ok).toBe(true);
    expect(readSink(advisory.cwd).verdict).toBe('cannot-verify');
  });

  it('dispatch throw: same no-trustworthy-verdict mapping', async () => {
    setVerifyDispatcher(async () => {
      throw new Error('spawn-failed: ENOENT');
    });
    const { cwd, input } = repo('blocking');
    expect((await runVerify(input)).ok).toBe(false);
    expect((readSink(cwd).blockers as Array<{ message: string }>)[0].message).toContain('spawn-failed');
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/lanes/verify.test.ts
```

Expected output: `Cannot find module '../../lanes/verify.js'`.

- [ ] **Step 3: Implement.** Create `src/cr/lanes/verify.ts`:

```ts
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { writeJsonAtomic } from '../atomic-write.js';
import { loadConfig } from '../config.js';
import { loadVerifyCommands } from '../../core/consumer-config.js';
import type { Finding, LaneFindings } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { extractFdAcceptance } from '../read-fd-summary.js';
import { resolvePort } from '../../verify/port.js';
import { runSmoke } from '../../verify/smoke.js';
import type { SmokeReport } from '../../verify/smoke.js';
import { dispatchVerify, parseVerifyVerdict } from './verify-dispatch.js';

type VerifyMode = 'blocking' | 'advisory';

type SmokeRunner = (cwd: string, port: number) => Promise<SmokeReport>;
let smokeRunner: SmokeRunner = (cwd, port) => runSmoke(cwd, port);

/** Test seam — production code never calls this. */
export function setSmokeRunner(impl: SmokeRunner): void {
  smokeRunner = impl;
}

function sinkPathFor(input: LaneInput): string {
  return join(input.repoRoot, '.noldor', 'cr', `${input.slug}-${input.kind}-verify.json`);
}

function basePayload(input: LaneInput, startedAt: string): Omit<LaneFindings, 'summary'> {
  return {
    lane: 'verify',
    artifact: input.artifact,
    kind: input.kind,
    slug: input.slug,
    blockers: [],
    suggestions: [],
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(input.baseSha ? { baseSha: input.baseSha } : {}),
    ...(input.fullReview ? { fullReview: true } : {}),
  };
}

function mkFinding(artifact: string, message: string, severity: Finding['severity']): Finding {
  return { file: artifact, severity, message };
}

function commitProse(repoRoot: string, baseSha: string, headSha: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['log', `${baseSha}..${headSha}`, '--format=%s%n%b'], { cwd: repoRoot }, (err, stdout) =>
      resolve(err ? '' : String(stdout).trim()),
    );
  });
}

export async function runVerify(input: LaneInput): Promise<LaneResult> {
  const sinkPath = sinkPathFor(input);
  const startedAt = new Date().toISOString();
  const cfg = await loadConfig(join(input.repoRoot, '.noldor', 'config.json')).catch(() => null);
  const mode: VerifyMode = cfg?.autonomous?.verifyMode ?? 'advisory';

  const write = async (payload: LaneFindings, ok: boolean): Promise<LaneResult> => {
    await writeJsonAtomic(sinkPath, payload);
    return { lane: 'verify', sinkPath, ok };
  };

  // 1. Smoke floor — blocking in BOTH modes (stop-the-line; spec Unit 4 step 2).
  const port = await resolvePort(input.repoRoot);
  const smoke = await smokeRunner(input.repoRoot, port);
  if (!smoke.ok) {
    const failed = smoke.surfaces.filter((s) => !s.ok);
    return write(
      {
        ...basePayload(input, startedAt),
        blockers: failed.map((s) =>
          mkFinding(input.artifact, `smoke floor: surface '${s.name}' failed — ${s.evidence.observed}`, 'high'),
        ),
        summary: 'smoke floor failed',
        verdict: 'fail',
        evidence: failed.map((s) => s.evidence),
        mismatches: failed.map((s) => `surface '${s.name}' not healthy`),
      },
      false,
    );
  }

  // 2. Acceptance text: FD Summary+Usage → commit prose → cannot-verify.
  const baseShaForRange = input.baseSha ?? `${input.artifactSha}~1`;
  let acceptance = await extractFdAcceptance(input.fdPath).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  });
  if (!acceptance) acceptance = await commitProse(input.repoRoot, baseShaForRange, input.artifactSha);
  if (!acceptance) {
    return write(
      {
        ...basePayload(input, startedAt),
        summary: 'cannot-verify: no acceptance text (no FD, empty commit prose)',
        verdict: 'cannot-verify',
        notes: ['no acceptance text available — no FD and empty commit prose for the range'],
      },
      true,
    );
  }

  // 3. Agent judgment.
  const surfaces = Object.entries(loadVerifyCommands(input.repoRoot)).map(([name, s]) => ({ ...s, name }));
  let raw: string | null = null;
  let dispatchErr = '';
  try {
    raw = await dispatchVerify({
      acceptance,
      baseSha: baseShaForRange,
      headSha: input.artifactSha,
      surfaces,
      port,
    });
  } catch (err) {
    dispatchErr = (err as Error).message;
  }
  const parsed = raw === null ? null : parseVerifyVerdict(raw);

  // 4. No trustworthy verdict (spawn fail, timeout, malformed output) — one class.
  if (parsed === null) {
    const detail = dispatchErr || `malformed verifier output: ${(raw ?? '').slice(0, 200)}`;
    if (mode === 'blocking') {
      return write(
        {
          ...basePayload(input, startedAt),
          blockers: [mkFinding(input.artifact, `verify lane errored: ${detail}`, 'high')],
          summary: 'verify lane errored (fail-closed in blocking mode)',
          verdict: 'fail',
        },
        false,
      );
    }
    return write(
      {
        ...basePayload(input, startedAt),
        summary: 'cannot-verify: no trustworthy verdict',
        verdict: 'cannot-verify',
        notes: [`no trustworthy verdict — ${detail}`],
      },
      true,
    );
  }

  // 5. Honest agent verdicts × mode.
  if (parsed.verdict === 'pass') {
    return write(
      {
        ...basePayload(input, startedAt),
        summary: 'verified: observed behavior matches acceptance text',
        verdict: 'pass',
        evidence: parsed.evidence,
      },
      true,
    );
  }
  if (parsed.verdict === 'cannot-verify') {
    return write(
      {
        ...basePayload(input, startedAt),
        summary: `cannot-verify: ${parsed.reason ?? 'no reason given'}`,
        verdict: 'cannot-verify',
        evidence: parsed.evidence,
        notes: [parsed.reason ?? 'cannot-verify with no reason given'],
      },
      true,
    );
  }
  // verdict === 'fail'
  const findings = parsed.mismatches.map((m) => mkFinding(input.artifact, m, 'high'));
  if (mode === 'blocking') {
    return write(
      {
        ...basePayload(input, startedAt),
        blockers: findings,
        summary: 'verify FAIL: observed behavior mismatches acceptance text',
        verdict: 'fail',
        evidence: parsed.evidence,
        mismatches: parsed.mismatches,
      },
      false,
    );
  }
  return write(
    {
      ...basePayload(input, startedAt),
      suggestions: findings.map((f) => ({ ...f, severity: 'low' as const })),
      summary: 'ADVISORY FAIL: observed behavior mismatches acceptance text (advisory mode)',
      verdict: 'fail',
      evidence: parsed.evidence,
      mismatches: parsed.mismatches,
    },
    true,
  );
}
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/lanes/verify.test.ts
```

Expected output: 7 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/cr/lanes/verify.ts src/cr/__tests__/lanes/verify.test.ts
git commit -m "feat(acceptance-verify-lane): verify lane runner (smoke-first, verdict×mode mapping)" -m "Noldor-FD: acceptance-verify-lane"
```

## Task 10: orchestrate wiring + self-host opt-in

**Files:**
- Modify: `src/cr/orchestrate.ts`, `.noldor/config.json`
- Test: `src/cr/__tests__/orchestrate.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `src/cr/__tests__/orchestrate.test.ts` (follow the file's existing `run()` test setup for tmpdir/sink assertions; the kind-guard test needs no git):

```ts
describe('verify lane wiring', () => {
  it('rejects verify for non-code kinds at entry', async () => {
    await expect(
      run({
        args: {
          slug: 's',
          artifact: 'spec.md',
          kind: 'spec',
          lanes: ['verify'],
          fullReview: false,
          autonomous: true,
        },
        cwd: mkdtempSync(join(tmpdir(), 'noldor-orch-')),
      }),
    ).rejects.toThrow(/code-only/);
  });
});
```

- [ ] **Step 2: Run to verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts
```

Expected output: the new test fails — no kind guard yet (verify currently crashes later at `LANES[l]` dispatch instead).

- [ ] **Step 3: Implement.** In `src/cr/orchestrate.ts`:

Import the lane:

```ts
import { runVerify } from './lanes/verify.js';
```

Extend the dispatch record (the `Exclude<Lane, 'standalone'>` key type now includes `'verify'`, so the record requires the new entry):

```ts
const LANES: Record<Exclude<Lane, 'standalone'>, (input: LaneInput) => Promise<LaneResult>> = {
  manual: runManual,
  codex: runCodex,
  subagent: runSubagent,
  verify: runVerify,
};
```

In `run()`, directly under the existing `standalone` rejection:

```ts
  if (requested.includes('verify') && opts.args.kind !== 'code') {
    throw new Error(
      "lane 'verify' is code-only — remove it from --lanes / crLanes for spec/plan artifacts",
    );
  }
```

- [ ] **Step 4: Run to verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts src/cr/__tests__/orchestrate.integration.test.ts
```

Expected output: all pass (existing tests unaffected — verify only runs when requested).

- [ ] **Step 5: Opt the self-host repo in.** Edit `.noldor/config.json` (top level, beside `autonomous`):

```json
"crLanes": {
  "code": ["subagent", "verify"]
},
```

And inside the `consumer` block, after `scopeAliases`:

```json
"verifyCommands": {
  "dashboard": {
    "command": "pnpm noldor dashboard server --port {port}",
    "kind": "server",
    "healthPath": "/"
  },
  "cli": { "command": "pnpm noldor --help", "kind": "cli" }
}
```

`autonomous.verifyMode` is left unset — the `advisory` default is the bake-in posture. Verify the dashboard sub-command string against `src/cli/manifest.ts` (`dashboard` group) before committing; use the manifest's actual sub-command and port flag spelling.

- [ ] **Step 6: Validate config still parses.**

```bash
pnpm noldor verify smoke
```

Expected output: `✓ doctor`, `✓ dashboard: GET http://127.0.0.1:<port>/ → 200`, `✓ cli: exit 0`, `smoke OK`, exit 0. (If the pre-commit `shared-files` check blocks `.noldor/config.json` from a worktree, commit that file with `NOLDOR_ALLOW_SHARED=1 git commit …`.)

- [ ] **Step 7: Commit.**

```bash
git add src/cr/orchestrate.ts src/cr/__tests__/orchestrate.test.ts .noldor/config.json
git commit -m "feat(acceptance-verify-lane): register verify lane in orchestrate, opt self-host in" -m "Noldor-FD: acceptance-verify-lane"
```

## Task 11: docs (template twins) + full-suite verification

**Files:**
- Modify: `docs/noldor/cr-pipeline.md`, `templates/docs/noldor/cr-pipeline.md`, `docs/noldor/adoption-guide.md`, `templates/docs/noldor/adoption-guide.md`

- [ ] **Step 1: cr-pipeline.md.** Add a `## Verify lane` section to BOTH `docs/noldor/cr-pipeline.md` and `templates/docs/noldor/cr-pipeline.md` (identical content, or the `template-sync` pre-commit check rejects the commit). Content — adapt heading level to the file's existing structure:

```markdown
## Verify lane

The `verify` lane (code artifacts only) is the behavioral third signal beside tests and CR: it boots the real artifact and judges observed behavior against the FD's acceptance text (`## Summary` + `## Usage`; commit prose for FD-less fast-tracks).

Two layers:

- **Smoke floor** (deterministic): `noldor doctor` + boot every `consumer.verifyCommands` surface + HTTP-200/exit-0 probe. Runs first, also standalone via `pnpm noldor verify smoke [--json]`. A smoke failure blocks in **both** verify modes — stop-the-line semantics: a broken surface halts autonomous merging whether or not this FD broke it.
- **Verifier agent** (judgment): spawned via the agent-runner registry (`role: verifier`), exercises the specific new behavior through the real interface (never by reading source), and emits `{ verdict: pass | fail | cannot-verify, evidence: [{command, observed}], mismatches: [] }` as the sink's verdict payload (`.noldor/cr/<slug>-code-verify.json`).

Policy: `autonomous.verifyMode: "blocking" | "advisory"` (default `advisory`) governs only the agent verdict — `fail` maps mismatches to blockers (blocking) or suggestions with an `ADVISORY FAIL:` summary (advisory). `cannot-verify` never blocks. Spawn failure, timeout, or malformed verifier output is one "no trustworthy verdict" class: fail-closed blocker in blocking mode, `cannot-verify` note in advisory.

Opt in via `crLanes.code: ["subagent", "verify"]`; drain and watch inherit it from config.
```

- [ ] **Step 2: adoption-guide.md.** In BOTH `docs/noldor/adoption-guide.md` and `templates/docs/noldor/adoption-guide.md`, add to the config reference (match the file's existing config-table/section style):

```markdown
- `consumer.verifyCommands` — named run surfaces for the verify lane's smoke floor. `{ "<name>": { "command": "… --port {port}", "kind": "server" | "cli", "healthPath": "/", "readyTimeoutMs": 30000 } }`. `server` surfaces boot, get probed for HTTP 200, then killed; `cli` surfaces must exit 0. `{port}` is substituted with the per-tree port. Empty = smoke trivially green.
- `autonomous.verifyMode` — `"advisory"` (default) or `"blocking"`. Governs only the verify agent's judgment; the smoke floor blocks in both modes.
```

- [ ] **Step 3: Full verification.**

```bash
pnpm typecheck && pnpm test
```

Expected output: typecheck clean; full suite green (previous baseline 1943 tests + the new ones).

- [ ] **Step 4: Commit.**

```bash
git add docs/noldor/cr-pipeline.md templates/docs/noldor/cr-pipeline.md docs/noldor/adoption-guide.md templates/docs/noldor/adoption-guide.md
git commit -m "docs(acceptance-verify-lane): verify lane in cr-pipeline + adoption guide" -m "Noldor-FD: acceptance-verify-lane"
```

## Task 12: acceptance check (spec's seeded-wrong-implementation sketch)

**Files:**
- Test: manual, throwaway worktree state — nothing committed from this task

- [ ] **Step 1: Honest-implementation pass.** From the feature worktree:

```bash
pnpm noldor cr orchestrate --slug acceptance-verify-lane --artifact . --kind code --lanes verify --head-sha $(git rev-parse HEAD) --base-sha $(git rev-parse origin/main)
cat .noldor/cr/acceptance-verify-lane-code-verify.json | python3 -m json.tool | head -30
```

Expected output: lane runs; sink `verdict` is `pass` (or `cannot-verify` with an honest reason if the agent finds no reachable interface for a framework-internal change — acceptable per spec). `evidence` contains at least one real command + observed output.

- [ ] **Step 2: Advisory-fail path (cheap seeded check).** Temporarily break a surface to prove the smoke floor blocks: edit `.noldor/config.json`'s `cli` surface to `node -e "process.exit(1)"`, rerun the orchestrate command from Step 1 after `rm .noldor/cr/acceptance-verify-lane-code-verify.json`. Expected: exit 1, sink has `verdict: fail` with the smoke blocker. **Revert the config edit** (`git checkout -- .noldor/config.json`) and remove the sink before continuing to gate Step 4.

- [ ] **Step 3: Tick the FD checklist.** No commit from this task; the gate's Step 4 (code-stage orchestrate with `crLanes.code`) is the durable enforcement.
