# Per-Task Dev Environment Bootstrap Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** One command (`noldor worktrees up <slug>`) takes an operator from "branch checked out" to a fully usable dev surface: worktree present + IDE open + agent terminal spawned (the configured `agents.default` runner, resolved via the agent-runner registry — `claude` by default, never hardcoded) + every consumer-declared dev server booted on its per-tree port and health-probed. Paired `worktrees down <slug>` reaps the servers.
**Architecture:** Compose existing seams — `createWorktree` (src/worktrees/create-worktree.ts), `readPort`/`allocatePorts` (src/worktrees/worktree-status.ts), the iTerm2 osascript launch (src/worktrees/launch-worktrees.ts), and the `VerifySurface` boot+probe pattern (src/verify/smoke.ts) — behind a new orchestrator. Dev surfaces are consumer-declared via a new `consumer.dev` config block; the boot reuses smoke's poll logic minus the kill, against the stamped `.env.local` PORT instead of an ephemeral one.
**Tech Stack:** TypeScript (ESM, NodeNext), Zod for config, Vitest, `node:child_process` spawn/execFile, native `fetch`.

---

## File Structure

- `src/core/consumer-config.ts` — Modify: add `DevSurfaceSchema`, `DevConfigSchema`, `dev` field, `loadDevConfig`/`loadDevSurfaces`.
- `src/verify/health.ts` — Create: extracted `waitForHttp200` poll helper.
- `src/verify/smoke.ts` — Modify: `probeServer` calls `waitForHttp200`.
- `src/worktrees/worktree-status.ts` — Modify: add `deriveSurfacePort`.
- `src/worktrees/open-editor.ts` — Create: `openEditor`.
- `src/worktrees/dev-surfaces.ts` — Create: `bootDevSurfaces` + pids-file write.
- `src/worktrees/launch-worktrees.ts` — Modify: extract `launchTree`.
- `src/worktrees/up-worktree.ts` — Create: `upWorktree` orchestrator + CLI main.
- `src/worktrees/down-worktree.ts` — Create: `downWorktree` teardown + CLI main.
- `src/cli/manifest.ts` — Modify: wire `worktrees up` + `worktrees down`.
- `src/core/__tests__/consumer-config.test.ts` — Modify: dev-block parse tests.
- `src/verify/__tests__/health.test.ts` — Create.
- `src/worktrees/__tests__/worktree-status.test.ts` — Modify: `deriveSurfacePort`.
- `src/worktrees/__tests__/open-editor.test.ts` — Create.
- `src/worktrees/__tests__/dev-surfaces.test.ts` — Create.
- `src/worktrees/__tests__/launch-worktrees.test.ts` — Modify: `launchTree`.
- `src/worktrees/__tests__/up-worktree.test.ts` — Create.
- `src/worktrees/__tests__/down-worktree.test.ts` — Create.

---

## Task 1: `dev` config block + loaders

**Files:**
- Modify: `src/core/consumer-config.ts`
- Test: `src/core/__tests__/consumer-config.test.ts`

- [ ] **Step 1: Write failing tests for the dev block.**
  Append to `src/core/__tests__/consumer-config.test.ts`:
  ```ts
  import { DevSurfaceSchema, DevConfigSchema, loadDevSurfaces } from '../consumer-config.js';

  describe('dev config', () => {
    it('parses a surface with offset + rejects unknown keys', () => {
      const s = DevSurfaceSchema.parse({ command: 'pnpm dev --port {port}', portOffset: 100 });
      expect(s.healthPath).toBe('/');
      expect(s.readyTimeoutMs).toBe(30_000);
      expect(s.portOffset).toBe(100);
      expect(() => DevSurfaceSchema.parse({ command: 'x', bogus: 1 })).toThrow();
    });
    it('defaults portOffset to 0 and surfaces to {}', () => {
      expect(DevSurfaceSchema.parse({ command: 'x' }).portOffset).toBe(0);
      expect(DevConfigSchema.parse({}).surfaces).toEqual({});
    });
    it('loadDevSurfaces returns {} when consumer.dev absent', () => {
      // config.json has no dev block by default in this repo at test time
      expect(loadDevSurfaces(process.cwd())).toEqual({});
    });
  });
  ```
- [ ] **Step 2: Run the test — verify FAIL.**
  ```bash
  pnpm vitest run src/core/__tests__/consumer-config.test.ts
  ```
  Expected: fails — `DevSurfaceSchema`/`DevConfigSchema`/`loadDevSurfaces` are not exported.
- [ ] **Step 3: Implement the schema + loaders.**
  In `src/core/consumer-config.ts`, after `export type VerifySurface = ...`, add:
  ```ts
  /**
   * One long-running per-task dev surface (web app, internal API). Booted by
   * `noldor worktrees up`, probed at `healthPath`, and left running. `{port}`
   * and `{path}` in `command` are substituted at boot; the port is the tree's
   * stamped base PORT plus `portOffset` (see deriveSurfacePort).
   */
  export const DevSurfaceSchema = z
    .object({
      command: z.string().min(1),
      healthPath: z.string().default('/'),
      readyTimeoutMs: z.number().int().positive().default(30_000),
      portOffset: z.number().int().min(0).default(0),
    })
    .strict();
  export type DevSurface = z.infer<typeof DevSurfaceSchema>;

  /** Per-task dev environment config: optional editor + named dev surfaces. */
  export const DevConfigSchema = z
    .object({
      editor: z.object({ command: z.string().min(1) }).strict().optional(),
      surfaces: z.record(z.string(), DevSurfaceSchema).default({}),
    })
    .strict();
  export type DevConfig = z.infer<typeof DevConfigSchema>;
  ```
  Add to `ConsumerConfigSchema`'s object (before the closing `})` / `.strict()`):
  ```ts
    /** Per-task dev surfaces booted by `worktrees up`. Absent = nothing booted. */
    dev: DevConfigSchema.optional(),
  ```
  After `loadVerifyCommands`, add:
  ```ts
  /** Load the `consumer.dev` block, or null when absent. */
  export function loadDevConfig(cwd: string = process.cwd()): DevConfig | null {
    return loadConsumerConfig(cwd).dev ?? null;
  }
  /** Load the named dev surfaces, or `{}` when `consumer.dev` is absent. */
  export function loadDevSurfaces(cwd: string = process.cwd()): Record<string, DevSurface> {
    return loadConsumerConfig(cwd).dev?.surfaces ?? {};
  }
  ```
- [ ] **Step 4: Run the test — verify PASS.**
  ```bash
  pnpm vitest run src/core/__tests__/consumer-config.test.ts
  ```
  Expected: all green.
- [ ] **Step 5: Commit.**
  ```bash
  git add src/core/consumer-config.ts src/core/__tests__/consumer-config.test.ts
  git commit -m "feat(tooling): add consumer.dev surface config block" -m "Noldor-FD: per-task-dev-environment-bootstrap"
  ```

---

## Task 2: extract `waitForHttp200` poll helper

**Files:**
- Create: `src/verify/health.ts`
- Modify: `src/verify/smoke.ts`
- Test: `src/verify/__tests__/health.test.ts`

- [ ] **Step 1: Write failing test for the helper.**
  Create `src/verify/__tests__/health.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { waitForHttp200 } from '../health.js';

  describe('waitForHttp200', () => {
    it('resolves true when fetch reaches 200 before deadline', async () => {
      let n = 0;
      const fetchImpl = (async () => {
        n++;
        if (n < 2) throw new Error('refused');
        return { status: 200 } as Response;
      }) as unknown as typeof fetch;
      const ok = await waitForHttp200('http://127.0.0.1:5174/', Date.now() + 2000, fetchImpl);
      expect(ok).toBe(true);
    });
    it('resolves false after the deadline with no 200', async () => {
      const fetchImpl = (async () => ({ status: 500 }) as Response) as unknown as typeof fetch;
      const ok = await waitForHttp200('http://127.0.0.1:5174/', Date.now() + 300, fetchImpl);
      expect(ok).toBe(false);
    });
  });
  ```
- [ ] **Step 2: Run — verify FAIL.**
  ```bash
  pnpm vitest run src/verify/__tests__/health.test.ts
  ```
  Expected: fails — `../health.js` does not exist.
- [ ] **Step 3: Create the helper.**
  Create `src/verify/health.ts`:
  ```ts
  // @tests: per-task-dev-environment-bootstrap
  const PROBE_FETCH_TIMEOUT_MS = 2000;

  /**
   * Poll `url` until it returns HTTP 200 or `deadlineMs` passes. Each fetch is
   * bounded so a half-open server cannot hang the loop. Shared by the verify
   * smoke floor and the per-task dev-surface boot.
   *
   * @returns true on a 200 before the deadline, false otherwise.
   */
  export async function waitForHttp200(
    url: string,
    deadlineMs: number,
    fetchImpl: typeof fetch = fetch,
  ): Promise<boolean> {
    while (Date.now() < deadlineMs) {
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(PROBE_FETCH_TIMEOUT_MS) });
        if (res.status === 200) return true;
      } catch {
        /* not accepting connections yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }
  ```
- [ ] **Step 4: Refactor `probeServer` in `src/verify/smoke.ts` to use it.**
  Add `import { waitForHttp200 } from './health.js';` at the top. Replace the
  `while (Date.now() < deadline) { ... }` poll block inside `probeServer` with:
  ```ts
    const ok = await waitForHttp200(url, deadline, fetchImpl);
    if (ok) return { name, ok: true, evidence: { command, observed: `GET ${url} → 200` } };
    return {
      name,
      ok: false,
      evidence: { command, observed: `GET ${url} → no HTTP 200 within ${readyMs}ms` },
    };
  ```
  (Keep the surrounding `try/finally` that spawns and `process.kill(-child.pid)`s
  the child, and the pre-boot occupancy check, unchanged.)
- [ ] **Step 5: Run health + smoke tests — verify PASS.**
  ```bash
  pnpm vitest run src/verify/__tests__/health.test.ts src/verify/__tests__/smoke.test.ts
  ```
  Expected: all green (smoke unchanged in behaviour).
- [ ] **Step 6: Commit.**
  ```bash
  git add src/verify/health.ts src/verify/smoke.ts src/verify/__tests__/health.test.ts
  git commit -m "refactor(verify): extract waitForHttp200 poll helper" -m "Noldor-FD: per-task-dev-environment-bootstrap"
  ```

---

## Task 3: `deriveSurfacePort`

**Files:**
- Modify: `src/worktrees/worktree-status.ts`
- Test: `src/worktrees/__tests__/worktree-status.test.ts`

- [ ] **Step 1: Write failing test.**
  Append to `src/worktrees/__tests__/worktree-status.test.ts`:
  ```ts
  import { deriveSurfacePort } from '../worktree-status.js';
  describe('deriveSurfacePort', () => {
    it('adds the offset to the base port', () => {
      expect(deriveSurfacePort(5174, 0)).toBe(5174);
      expect(deriveSurfacePort(5174, 100)).toBe(5274);
    });
  });
  ```
- [ ] **Step 2: Run — verify FAIL.**
  ```bash
  pnpm vitest run src/worktrees/__tests__/worktree-status.test.ts -t deriveSurfacePort
  ```
  Expected: fails — `deriveSurfacePort` not exported.
- [ ] **Step 3: Implement.**
  In `src/worktrees/worktree-status.ts`, after the `readPort` function, add:
  ```ts
  /**
   * Port for a dev surface = the tree's stamped base PORT + the surface offset.
   * Offset 0 → the stamped PORT itself (back-compat with a single dev server).
   * Offsets >= 100 by convention keep secondary surfaces clear of the
   * 5174-5179 base cap and of each other.
   *
   * @param basePort - The tree's stamped `.env.local` PORT.
   * @param offset - The surface's configured `portOffset`.
   */
  export function deriveSurfacePort(basePort: number, offset: number): number {
    return basePort + offset;
  }
  ```
- [ ] **Step 4: Run — verify PASS.**
  ```bash
  pnpm vitest run src/worktrees/__tests__/worktree-status.test.ts -t deriveSurfacePort
  ```
  Expected: green.
- [ ] **Step 5: Commit.**
  ```bash
  git add src/worktrees/worktree-status.ts src/worktrees/__tests__/worktree-status.test.ts
  git commit -m "feat(tooling): add deriveSurfacePort for per-tree dev surfaces" -m "Noldor-FD: per-task-dev-environment-bootstrap"
  ```

---

## Task 4: `openEditor`

**Files:**
- Create: `src/worktrees/open-editor.ts`
- Test: `src/worktrees/__tests__/open-editor.test.ts`

- [ ] **Step 1: Write failing test.**
  Create `src/worktrees/__tests__/open-editor.test.ts`:
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { openEditor } from '../open-editor.js';

  describe('openEditor', () => {
    it('returns opened:false and spawns nothing when command undefined', async () => {
      const spawnImpl = vi.fn();
      const r = await openEditor('/tmp/wt', undefined, spawnImpl as never);
      expect(r.opened).toBe(false);
      expect(spawnImpl).not.toHaveBeenCalled();
    });
    it('substitutes {path} and spawns detached', async () => {
      const unref = vi.fn();
      const spawnImpl = vi.fn(() => ({ unref }));
      const r = await openEditor('/tmp/wt', 'code {path}', spawnImpl as never);
      expect(r.opened).toBe(true);
      expect(spawnImpl).toHaveBeenCalledWith(
        '/bin/sh', ['-c', 'code /tmp/wt'],
        expect.objectContaining({ detached: true }),
      );
      expect(unref).toHaveBeenCalled();
    });
  });
  ```
- [ ] **Step 2: Run — verify FAIL.**
  ```bash
  pnpm vitest run src/worktrees/__tests__/open-editor.test.ts
  ```
  Expected: fails — module missing.
- [ ] **Step 3: Implement.**
  Create `src/worktrees/open-editor.ts`:
  ```ts
  // @tests: per-task-dev-environment-bootstrap
  import { spawn } from 'node:child_process';

  type SpawnImpl = typeof spawn;

  /**
   * Open the operator's editor on a worktree path via the consumer-configured
   * `dev.editor.command` (`{path}` substituted). Detached + unref so the CLI
   * exits immediately. Editor choice is cross-platform by the consumer's command.
   *
   * @param treePath - Absolute worktree path.
   * @param command - The `dev.editor.command` template, or undefined to skip.
   * @param spawnImpl - Injectable spawn (tests stub this).
   */
  export async function openEditor(
    treePath: string,
    command: string | undefined,
    spawnImpl: SpawnImpl = spawn,
  ): Promise<{ opened: boolean; note?: string }> {
    if (!command) return { opened: false, note: 'no dev.editor configured' };
    const cmd = command.replaceAll('{path}', treePath);
    const child = spawnImpl('/bin/sh', ['-c', cmd], { detached: true, stdio: 'ignore' });
    child.unref();
    return { opened: true };
  }
  ```
- [ ] **Step 4: Run — verify PASS.**
  ```bash
  pnpm vitest run src/worktrees/__tests__/open-editor.test.ts
  ```
  Expected: green.
- [ ] **Step 5: Commit.**
  ```bash
  git add src/worktrees/open-editor.ts src/worktrees/__tests__/open-editor.test.ts
  git commit -m "feat(tooling): open IDE on a worktree via dev.editor command" -m "Noldor-FD: per-task-dev-environment-bootstrap"
  ```

---

## Task 5: `bootDevSurfaces`

**Files:**
- Create: `src/worktrees/dev-surfaces.ts`
- Test: `src/worktrees/__tests__/dev-surfaces.test.ts`

- [ ] **Step 1: Write failing test.**
  Create `src/worktrees/__tests__/dev-surfaces.test.ts`:
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { mkdtempSync, readFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { bootDevSurfaces } from '../dev-surfaces.js';

  function fakeChild(pid: number) {
    return { pid, unref: vi.fn() };
  }

  describe('bootDevSurfaces', () => {
    it('boots each surface on base+offset, substitutes vars, writes pids, never kills', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'devsurf-'));
      const spawnImpl = vi.fn(() => fakeChild(4242));
      let calls = 0;
      const fetchImpl = (async (url: string) => {
        // first call per surface = occupancy pre-check → must reject (free)
        calls++;
        if (calls % 2 === 1) throw new Error('free');
        return { status: 200 } as Response;
      }) as unknown as typeof fetch;

      const booted = await bootDevSurfaces({
        treePath: '/tmp/wt',
        slug: 'demo',
        surfaces: {
          web: { command: 'pnpm dev --port {port}', healthPath: '/', readyTimeoutMs: 2000, portOffset: 0 },
          api: { command: 'serve {path} --port {port}', healthPath: '/health', readyTimeoutMs: 2000, portOffset: 100 },
        },
        basePort: 5174,
        cwd,
        spawnImpl: spawnImpl as never,
        fetchImpl,
      });

      const web = booted.find((b) => b.name === 'web')!;
      const api = booted.find((b) => b.name === 'api')!;
      expect(web.port).toBe(5174);
      expect(api.port).toBe(5274);
      expect(web.ready).toBe(true);
      expect(spawnImpl).toHaveBeenCalledWith(
        '/bin/sh', ['-c', 'serve /tmp/wt --port 5274'],
        expect.objectContaining({ cwd: '/tmp/wt', detached: true }),
      );
      // pids file written, no process.kill anywhere
      const pids = readFileSync(join(cwd, '.noldor', 'dev-demo.pids'), 'utf8');
      expect(pids).toMatch(/web 4242 5174/);
      expect(pids).toMatch(/api 4242 5274/);
    });

    it('fails a surface whose port is already occupied before boot', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'devsurf-'));
      const spawnImpl = vi.fn(() => fakeChild(1));
      const fetchImpl = (async () => ({ status: 200 }) as Response) as unknown as typeof fetch;
      const booted = await bootDevSurfaces({
        treePath: '/tmp/wt', slug: 'demo',
        surfaces: { web: { command: 'x --port {port}', healthPath: '/', readyTimeoutMs: 500, portOffset: 0 } },
        basePort: 5174, cwd, spawnImpl: spawnImpl as never, fetchImpl,
      });
      expect(booted[0]!.ready).toBe(false);
      expect(spawnImpl).not.toHaveBeenCalled();
    });
  });
  ```
- [ ] **Step 2: Run — verify FAIL.**
  ```bash
  pnpm vitest run src/worktrees/__tests__/dev-surfaces.test.ts
  ```
  Expected: fails — module missing.
- [ ] **Step 3: Implement.**
  Create `src/worktrees/dev-surfaces.ts`:
  ```ts
  // @tests: per-task-dev-environment-bootstrap
  import { spawn } from 'node:child_process';
  import { mkdir, writeFile } from 'node:fs/promises';
  import { join } from 'node:path';
  import type { DevSurface } from '../core/consumer-config.js';
  import { waitForHttp200 } from '../verify/health.js';
  import { deriveSurfacePort } from './worktree-status.js';

  const PROBE_FETCH_TIMEOUT_MS = 2000;

  /** One booted (and left-running) dev surface. */
  export interface BootedSurface {
    name: string;
    port: number;
    url: string;
    pid: number | null;
    ready: boolean;
    note?: string;
  }

  export interface BootOptions {
    treePath: string;
    slug: string;
    surfaces: Record<string, DevSurface>;
    basePort: number;
    /** Where `.noldor/dev-<slug>.pids` is written (the main workspace root). */
    cwd: string;
    spawnImpl?: typeof spawn;
    fetchImpl?: typeof fetch;
  }

  /**
   * Boot every configured dev surface on `basePort + portOffset`, probe its
   * `healthPath` until 200 (or timeout), and LEAVE IT RUNNING (detached +
   * unref). Records live pids to `.noldor/dev-<slug>.pids` for `worktrees down`.
   * Unlike the verify smoke floor, the child is never killed.
   */
  export async function bootDevSurfaces(opts: BootOptions): Promise<BootedSurface[]> {
    const spawnImpl = opts.spawnImpl ?? spawn;
    const fetchImpl = opts.fetchImpl ?? fetch;
    const results: BootedSurface[] = [];

    for (const [name, surface] of Object.entries(opts.surfaces)) {
      const port = deriveSurfacePort(opts.basePort, surface.portOffset);
      const url = `http://127.0.0.1:${port}${surface.healthPath}`;
      const command = surface.command
        .replaceAll('{port}', String(port))
        .replaceAll('{path}', opts.treePath);

      // Pre-boot occupancy check: a 200 here means a stale/concurrent server
      // already holds the port; booting would false-green. Fail honestly.
      const occupied = await fetchImpl(url, {
        signal: AbortSignal.timeout(PROBE_FETCH_TIMEOUT_MS),
      }).then(() => true, () => false);
      if (occupied) {
        results.push({
          name, port, url, pid: null, ready: false,
          note: `port ${port} already in use before boot`,
        });
        continue;
      }

      const child = spawnImpl('/bin/sh', ['-c', command], {
        cwd: opts.treePath,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      const ready = await waitForHttp200(url, Date.now() + surface.readyTimeoutMs, fetchImpl);
      results.push({ name, port, url, pid: child.pid ?? null, ready });
    }

    const live = results.filter((r) => r.pid !== null);
    if (live.length > 0) {
      const dir = join(opts.cwd, '.noldor');
      await mkdir(dir, { recursive: true });
      const body = live.map((r) => `${r.name} ${r.pid} ${r.port}`).join('\n');
      await writeFile(join(dir, `dev-${opts.slug}.pids`), `${body}\n`);
    }
    return results;
  }
  ```
- [ ] **Step 4: Run — verify PASS.**
  ```bash
  pnpm vitest run src/worktrees/__tests__/dev-surfaces.test.ts
  ```
  Expected: both tests green.
- [ ] **Step 5: Commit.**
  ```bash
  git add src/worktrees/dev-surfaces.ts src/worktrees/__tests__/dev-surfaces.test.ts
  git commit -m "feat(tooling): boot per-task dev surfaces on per-tree ports" -m "Noldor-FD: per-task-dev-environment-bootstrap"
  ```

---

## Task 6: extract `launchTree` from launch-worktrees

**Files:**
- Modify: `src/worktrees/launch-worktrees.ts`
- Test: `src/worktrees/__tests__/launch-worktrees.test.ts`

  Agent-agnostic: the launch command must run the consumer's configured agent
  (`agents.default`), resolved through the existing agent-runner registry — not a
  hardcoded `claude`. `buildLaunchCommand` takes the resolved interactive-launch
  invocation so the unit stays pure (no config read inside it); the caller resolves
  `agents.default` → invocation via the registry. `claude` is the default, so the
  no-config path is byte-identical to today's behavior.

- [ ] **Step 1: Write failing test for the extracted unit.**
  Append to `src/worktrees/__tests__/launch-worktrees.test.ts`:
  ```ts
  import { buildLaunchCommand } from '../launch-worktrees.js';
  describe('buildLaunchCommand', () => {
    it('cds into the tree and runs the resolved agent with the rendered prompt', () => {
      const cmd = buildLaunchCommand(
        { path: '/repo/.worktrees/foo', branch: 'feat/foo', isMain: false },
        'read {{slug}} on {{branch}}',
        'claude --dangerously-skip-permissions', // resolved from agents.default (default)
      );
      expect(cmd).toContain("cd '/repo/.worktrees/foo'");
      expect(cmd).toContain('claude --dangerously-skip-permissions');
      expect(cmd).toContain('read foo on feat/foo');
    });
    it('omits the prompt arg when template empty', () => {
      const cmd = buildLaunchCommand(
        { path: '/repo/.worktrees/foo', branch: 'feat/foo', isMain: false }, '',
        'claude --dangerously-skip-permissions',
      );
      expect(cmd).toBe("cd '/repo/.worktrees/foo' && claude --dangerously-skip-permissions");
    });
    it('runs a non-claude agent when agents.default resolves to one', () => {
      const cmd = buildLaunchCommand(
        { path: '/repo/.worktrees/foo', branch: 'feat/foo', isMain: false }, '',
        'opencode', // resolved interactive invocation for agents.default = opencode
      );
      expect(cmd).toBe("cd '/repo/.worktrees/foo' && opencode");
    });
  });
  ```
- [ ] **Step 2: Run — verify FAIL.**
  ```bash
  pnpm vitest run src/worktrees/__tests__/launch-worktrees.test.ts -t buildLaunchCommand
  ```
  Expected: fails — `buildLaunchCommand` not exported.
- [ ] **Step 3: Extract the command builder + single-tree launcher.**
  In `src/worktrees/launch-worktrees.ts`, add (above `main`):
  ```ts
  /**
   * Build the shell command an iTerm2 session runs for one worktree: cd in and
   * start the agent, appending the rendered launch prompt when the template is
   * non-empty. `agentInvocation` is the interactive launch string for the
   * consumer's `agents.default` runner (e.g. `claude --dangerously-skip-permissions`),
   * resolved by the caller via the agent-runner registry — this unit stays pure
   * and never hardcodes a runner. `Worktree` and the `renderPrompt`/`escapeShell`
   * helpers are reused.
   */
  export function buildLaunchCommand(w: Worktree, template: string, agentInvocation: string): string {
    const slug = basename(w.path);
    const prompt = renderPrompt(template, { slug, branch: w.branch, path: w.path });
    return prompt
      ? `cd ${escapeShell(w.path)} && ${agentInvocation} ${escapeShell(prompt)}`
      : `cd ${escapeShell(w.path)} && ${agentInvocation}`;
  }

  /**
   * Resolve the interactive launch invocation for the consumer's configured agent.
   * Reuses the agent-runner registry's per-runner bins so claude/codex/opencode
   * stay the single source of truth. claude is the default → today's behavior.
   * Headless argv (`--print` / `exec` / `run`) is NOT reused here — those are for
   * the drain's non-interactive spawns; the terminal wants an interactive session.
   */
  export function resolveAgentInvocation(cwd: string): string {
    const runner = resolveRunner('implementer', loadConfigSync(cwd) ?? {}).runner;
    switch (runner) {
      case 'codex': return CODEX_BIN; // interactive codex (no `exec`)
      case 'opencode': return OPENCODE_BIN; // interactive opencode (no `run`)
      case 'claude':
      default: return `${CLAUDE_BIN} --dangerously-skip-permissions`;
    }
  }

  /** Open one iTerm2 window for a single worktree running the launch command. */
  export async function launchTree(w: Worktree, template: string, agentInvocation: string): Promise<void> {
    const command = buildLaunchCommand(w, template, agentInvocation);
    const script = `tell application "iTerm"
      create window with default profile
      tell current session of current window
        write text "${command}"
      end tell
    end tell`;
    await execFileAsync('osascript', ['-e', script]);
  }
  ```
  Replace the body of the `for (const w of worktrees)` loop in `main()` with
  (resolve the agent invocation once, before the loop):
  ```ts
    const agentInvocation = resolveAgentInvocation(process.cwd());
    for (const w of worktrees) {
      console.log(`  ${w.branch} → ${w.path}`);
      await launchTree(w, template, agentInvocation);
    }
  ```
  Add the registry imports at the top of `launch-worktrees.ts`:
  ```ts
  import { resolveRunner } from '../core/agent-runner/registry.js';
  import { CLAUDE_BIN } from '../core/agent-runner/runners/claude.js';
  import { CODEX_BIN } from '../core/agent-runner/runners/codex.js';
  import { OPENCODE_BIN } from '../core/agent-runner/runners/opencode.js';
  import { loadConfigSync } from '../cr/config.js';
  ```
  Export the `Worktree` interface (`export interface Worktree { ... }`).
- [ ] **Step 4: Run launch tests — verify PASS.**
  ```bash
  pnpm vitest run src/worktrees/__tests__/launch-worktrees.test.ts
  ```
  Expected: existing + new tests green.
- [ ] **Step 5: Commit.**
  ```bash
  git add src/worktrees/launch-worktrees.ts src/worktrees/__tests__/launch-worktrees.test.ts
  git commit -m "refactor(tooling): extract launchTree for single-tree reuse" -m "Noldor-FD: per-task-dev-environment-bootstrap"
  ```

---

## Task 7: `upWorktree` orchestrator + CLI

**Files:**
- Create: `src/worktrees/up-worktree.ts`
- Test: `src/worktrees/__tests__/up-worktree.test.ts`

- [ ] **Step 1: Write failing test for flag-gated composition.**
  Create `src/worktrees/__tests__/up-worktree.test.ts`:
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { upWorktree } from '../up-worktree.js';

  function deps(overrides = {}) {
    return {
      createWorktreeImpl: vi.fn(async () => ({ path: '/repo/.worktrees/foo', branch: 'feat/foo', port: 5174, installWarning: null })),
      existsImpl: vi.fn(() => false),
      readPortImpl: vi.fn(async () => 5174),
      openEditorImpl: vi.fn(async () => ({ opened: true })),
      launchTreeImpl: vi.fn(async () => {}),
      bootDevSurfacesImpl: vi.fn(async () => [{ name: 'web', port: 5174, url: 'http://127.0.0.1:5174/', pid: 9, ready: true }]),
      loadDevConfigImpl: () => ({ editor: { command: 'code {path}' }, surfaces: { web: { command: 'x', healthPath: '/', readyTimeoutMs: 1, portOffset: 0 } } }),
      readTemplateImpl: async () => 'tmpl',
      ...overrides,
    };
  }

  describe('upWorktree', () => {
    it('runs every step by default and returns a summary', async () => {
      const d = deps();
      const r = await upWorktree({ slug: 'foo', cwd: '/repo' }, d as never);
      expect(d.createWorktreeImpl).toHaveBeenCalled();
      expect(d.openEditorImpl).toHaveBeenCalled();
      expect(d.launchTreeImpl).toHaveBeenCalled();
      expect(d.bootDevSurfacesImpl).toHaveBeenCalled();
      expect(r.surfaces[0]!.ready).toBe(true);
    });
    it('honours --no-* flags', async () => {
      const d = deps();
      await upWorktree({ slug: 'foo', cwd: '/repo', noCreate: true, noEditor: true, noTerminal: true, noServers: true }, d as never);
      expect(d.createWorktreeImpl).not.toHaveBeenCalled();
      expect(d.openEditorImpl).not.toHaveBeenCalled();
      expect(d.launchTreeImpl).not.toHaveBeenCalled();
      expect(d.bootDevSurfacesImpl).not.toHaveBeenCalled();
    });
    it('reuses an existing worktree instead of creating', async () => {
      const d = deps({ existsImpl: vi.fn(() => true) });
      await upWorktree({ slug: 'foo', cwd: '/repo' }, d as never);
      expect(d.createWorktreeImpl).not.toHaveBeenCalled();
      expect(d.bootDevSurfacesImpl).toHaveBeenCalled();
    });
  });
  ```
- [ ] **Step 2: Run — verify FAIL.**
  ```bash
  pnpm vitest run src/worktrees/__tests__/up-worktree.test.ts
  ```
  Expected: fails — module missing.
- [ ] **Step 3: Implement orchestrator + CLI main.**
  Create `src/worktrees/up-worktree.ts`:
  ```ts
  // @tests: per-task-dev-environment-bootstrap
  import { existsSync } from 'node:fs';
  import { readFile } from 'node:fs/promises';
  import { join } from 'node:path';
  import { createWorktree } from './create-worktree.js';
  import { readPort } from './worktree-status.js';
  import { openEditor } from './open-editor.js';
  import { launchTree } from './launch-worktrees.js';
  import { bootDevSurfaces, type BootedSurface } from './dev-surfaces.js';
  import { loadDevConfig } from '../core/consumer-config.js';

  export interface UpOptions {
    slug: string;
    cwd: string;
    branch?: string;
    noCreate?: boolean;
    noEditor?: boolean;
    noTerminal?: boolean;
    noServers?: boolean;
  }

  export interface UpSummary {
    treePath: string;
    basePort: number | null;
    editorOpened: boolean;
    terminalSpawned: boolean;
    surfaces: BootedSurface[];
  }

  /** Injectable seams (defaults wired to the real units; tests stub them). */
  export interface UpDeps {
    createWorktreeImpl: typeof createWorktree;
    existsImpl: (p: string) => boolean;
    readPortImpl: typeof readPort;
    openEditorImpl: typeof openEditor;
    launchTreeImpl: typeof launchTree;
    bootDevSurfacesImpl: typeof bootDevSurfaces;
    loadDevConfigImpl: typeof loadDevConfig;
    readTemplateImpl: (cwd: string) => Promise<string>;
  }

  const defaultDeps: UpDeps = {
    createWorktreeImpl: createWorktree,
    existsImpl: existsSync,
    readPortImpl: readPort,
    openEditorImpl: openEditor,
    launchTreeImpl: launchTree,
    bootDevSurfacesImpl: bootDevSurfaces,
    loadDevConfigImpl: loadDevConfig,
    readTemplateImpl: (cwd) => readFile(join(cwd, '.claude/launch-prompt.md'), 'utf8').catch(() => ''),
  };

  /**
   * From "branch checked out" (or not) to a usable dev surface: create the
   * worktree, open the IDE, spawn the agent terminal (the configured
   * `agents.default` runner), and boot every consumer-declared dev surface on
   * its per-tree port. Each step is skippable.
   */
  export async function upWorktree(opts: UpOptions, deps: UpDeps = defaultDeps): Promise<UpSummary> {
    const treePath = join(opts.cwd, '.worktrees', opts.slug);
    const branch = opts.branch ?? `feat/${opts.slug}`;

    if (!opts.noCreate && !deps.existsImpl(treePath)) {
      await deps.createWorktreeImpl({ slug: opts.slug, branch, cwd: opts.cwd });
    }

    const basePort = await deps.readPortImpl(treePath);
    const devConfig = deps.loadDevConfigImpl(opts.cwd);

    let editorOpened = false;
    if (!opts.noEditor) {
      editorOpened = (await deps.openEditorImpl(treePath, devConfig?.editor?.command)).opened;
    }

    let terminalSpawned = false;
    if (!opts.noTerminal) {
      const template = await deps.readTemplateImpl(opts.cwd);
      await deps.launchTreeImpl({ path: treePath, branch, isMain: false }, template);
      terminalSpawned = true;
    }

    let surfaces: BootedSurface[] = [];
    if (!opts.noServers && basePort !== null) {
      surfaces = await deps.bootDevSurfacesImpl({
        treePath,
        slug: opts.slug,
        surfaces: devConfig?.surfaces ?? {},
        basePort,
        cwd: opts.cwd,
      });
    }

    return { treePath, basePort, editorOpened, terminalSpawned, surfaces };
  }

  function parseArgs(argv: string[]): UpOptions & { ok: boolean } {
    let slug: string | null = null;
    let branch: string | undefined;
    const flags = { noCreate: false, noEditor: false, noTerminal: false, noServers: false };
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i]!;
      if (a === '--no-create') flags.noCreate = true;
      else if (a === '--no-editor') flags.noEditor = true;
      else if (a === '--no-terminal') flags.noTerminal = true;
      else if (a === '--no-servers') flags.noServers = true;
      else if (a === '--branch') branch = argv[++i];
      else if (!a.startsWith('-') && slug === null) slug = a;
    }
    return { slug: slug ?? '', cwd: process.cwd(), ...(branch ? { branch } : {}), ...flags, ok: slug !== null };
  }

  async function main(): Promise<number> {
    const opts = parseArgs(process.argv.slice(2));
    if (!opts.ok) {
      process.stderr.write('usage: noldor worktrees up <slug> [--branch <n>] [--no-create|--no-editor|--no-terminal|--no-servers]\n');
      return 2;
    }
    const s = await upWorktree(opts);
    process.stdout.write(`Worktree: ${s.treePath}  base port: ${s.basePort ?? 'none'}\n`);
    process.stdout.write(`Editor: ${s.editorOpened ? 'opened' : 'skipped'}  Terminal: ${s.terminalSpawned ? 'spawned' : 'skipped'}\n`);
    for (const su of s.surfaces) {
      process.stdout.write(`  ${su.ready ? '✓' : '✗'} ${su.name}: ${su.url}${su.note ? ` (${su.note})` : ''}\n`);
    }
    return 0;
  }

  if (import.meta.url === `file://${process.argv[1]}`) {
    main().then((code) => process.exit(code));
  }
  ```
- [ ] **Step 4: Run — verify PASS.**
  ```bash
  pnpm vitest run src/worktrees/__tests__/up-worktree.test.ts
  ```
  Expected: all three tests green.
- [ ] **Step 5: Commit.**
  ```bash
  git add src/worktrees/up-worktree.ts src/worktrees/__tests__/up-worktree.test.ts
  git commit -m "feat(tooling): noldor worktrees up — full per-task dev bootstrap" -m "Noldor-FD: per-task-dev-environment-bootstrap"
  ```

---

## Task 8: `downWorktree` teardown + CLI

**Files:**
- Create: `src/worktrees/down-worktree.ts`
- Test: `src/worktrees/__tests__/down-worktree.test.ts`

- [ ] **Step 1: Write failing test.**
  Create `src/worktrees/__tests__/down-worktree.test.ts`:
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { downWorktree } from '../down-worktree.js';

  describe('downWorktree', () => {
    it('SIGKILLs each pid group, tolerates dead pids, removes the file', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'down-'));
      mkdirSync(join(cwd, '.noldor'), { recursive: true });
      writeFileSync(join(cwd, '.noldor', 'dev-foo.pids'), 'web 4242 5174\napi 4243 5274\n');
      const kills: number[] = [];
      const killImpl = vi.fn((pid: number) => {
        if (pid === -4243) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
        kills.push(pid);
      });
      const r = await downWorktree({ slug: 'foo', cwd }, { killImpl } as never);
      expect(kills).toContain(-4242);
      expect(r.reaped).toBe(2);
      expect(existsSync(join(cwd, '.noldor', 'dev-foo.pids'))).toBe(false);
    });
    it('--remove invokes git removal', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'down-'));
      const gitImpl = vi.fn(async () => {});
      await downWorktree({ slug: 'foo', cwd, remove: true }, { killImpl: vi.fn(), gitImpl } as never);
      expect(gitImpl).toHaveBeenCalled();
    });
  });
  ```
- [ ] **Step 2: Run — verify FAIL.**
  ```bash
  pnpm vitest run src/worktrees/__tests__/down-worktree.test.ts
  ```
  Expected: fails — module missing.
- [ ] **Step 3: Implement.**
  Create `src/worktrees/down-worktree.ts`:
  ```ts
  // @tests: per-task-dev-environment-bootstrap
  import { execFile } from 'node:child_process';
  import { readFile, rm } from 'node:fs/promises';
  import { join } from 'node:path';
  import { promisify } from 'node:util';

  const execFileP = promisify(execFile);

  export interface DownOptions {
    slug: string;
    cwd: string;
    remove?: boolean;
  }
  export interface DownDeps {
    killImpl: (pid: number, signal: NodeJS.Signals) => void;
    gitImpl: (args: string[], cwd: string) => Promise<void>;
  }

  const defaultDeps: DownDeps = {
    killImpl: (pid, signal) => process.kill(pid, signal),
    gitImpl: async (args, cwd) => {
      await execFileP('git', args, { cwd });
    },
  };

  /**
   * Reap the long-running dev surfaces booted by `worktrees up`: SIGKILL each
   * recorded process group, tolerating already-dead pids, then delete the pids
   * file. With `remove`, also remove the worktree + delete its branch.
   */
  export async function downWorktree(opts: DownOptions, deps: DownDeps = defaultDeps): Promise<{ reaped: number }> {
    const pidsFile = join(opts.cwd, '.noldor', `dev-${opts.slug}.pids`);
    let reaped = 0;
    const body = await readFile(pidsFile, 'utf8').catch(() => '');
    for (const line of body.split('\n').filter(Boolean)) {
      const pid = Number(line.split(/\s+/)[1]);
      if (!Number.isFinite(pid)) continue;
      reaped++;
      try {
        deps.killImpl(-pid, 'SIGKILL'); // negative = process group
      } catch {
        /* already exited */
      }
    }
    await rm(pidsFile, { force: true });

    if (opts.remove) {
      await deps.gitImpl(['worktree', 'remove', '--force', join('.worktrees', opts.slug)], opts.cwd);
      await deps.gitImpl(['branch', '-D', `feat/${opts.slug}`], opts.cwd).catch(() => {});
    }
    return { reaped };
  }

  async function main(): Promise<number> {
    const argv = process.argv.slice(2);
    const slug = argv.find((a) => !a.startsWith('-'));
    if (!slug) {
      process.stderr.write('usage: noldor worktrees down <slug> [--remove]\n');
      return 2;
    }
    const r = await downWorktree({ slug, cwd: process.cwd(), remove: argv.includes('--remove') });
    process.stdout.write(`Reaped ${r.reaped} dev surface(s) for ${slug}\n`);
    return 0;
  }

  if (import.meta.url === `file://${process.argv[1]}`) {
    main().then((code) => process.exit(code));
  }
  ```
- [ ] **Step 4: Run — verify PASS.**
  ```bash
  pnpm vitest run src/worktrees/__tests__/down-worktree.test.ts
  ```
  Expected: both tests green.
- [ ] **Step 5: Commit.**
  ```bash
  git add src/worktrees/down-worktree.ts src/worktrees/__tests__/down-worktree.test.ts
  git commit -m "feat(tooling): noldor worktrees down — reap per-task dev surfaces" -m "Noldor-FD: per-task-dev-environment-bootstrap"
  ```

---

## Task 9: wire CLI manifest

**Files:**
- Modify: `src/cli/manifest.ts`
- Test: `src/cli/__tests__/manifest.test.ts` (if present) or `pnpm noldor worktrees --help`

- [ ] **Step 1: Add a failing dispatch check.**
  If `src/cli/__tests__/manifest.test.ts` exists, add a case asserting
  `manifest.worktrees.subs.up` and `.down` resolve to their `src` paths.
  Otherwise rely on the help command in Step 4 as the verification.
- [ ] **Step 2: Run the relevant suite — verify FAIL (or help missing entries).**
  ```bash
  pnpm noldor worktrees --help
  ```
  Expected: `up`/`down` absent from the listing.
- [ ] **Step 3: Wire the subs.**
  In `src/cli/manifest.ts`, inside the `worktrees.subs` object (after `launch`), add:
  ```ts
        up: {
          src: 'worktrees/up-worktree.ts',
          desc: 'Bootstrap full dev surface: create + IDE + terminal + dev servers',
        },
        down: {
          src: 'worktrees/down-worktree.ts',
          desc: 'Reap dev servers for a tree (--remove also deletes the worktree)',
        },
  ```
- [ ] **Step 4: Verify dispatch + help.**
  ```bash
  pnpm noldor worktrees --help
  pnpm noldor worktrees up   # no slug → usage on stderr, exit 2
  ```
  Expected: `up` and `down` listed; bare `up` prints the usage line.
- [ ] **Step 5: Full typecheck + suite + commit.**
  ```bash
  pnpm typecheck && pnpm vitest run src/worktrees src/verify src/core/__tests__/consumer-config.test.ts
  ```
  Expected: typecheck clean, all targeted suites green.
  ```bash
  git add src/cli/manifest.ts src/cli/__tests__/manifest.test.ts
  git commit -m "feat(tooling): wire worktrees up/down into the CLI manifest" -m "Noldor-FD: per-task-dev-environment-bootstrap"
  ```
