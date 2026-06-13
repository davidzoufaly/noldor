# Per-Task Dev Environment Bootstrap — Design

**Slug:** per-task-dev-environment-bootstrap
**FD:** docs/features/per-task-dev-environment-bootstrap.md
**Date:** 2026-06-13
**Tier:** full
**Deps:** none (extends parent `parallel-worktree-workflow`)

## Problem

The parallel-worktree workflow gets an operator from "main" to "branch checked
out in `.worktrees/<slug>` with a per-tree port stamped and an agent terminal
spawned" — but no further. Today only the terminal spawn is automated, by
`src/worktrees/launch-worktrees.ts` — and it hardcodes `claude`, which violates
the framework's agent-agnostic posture (the agent-runner registry already
abstracts claude/codex/opencode). This FD also fixes that: the terminal launches
the consumer's configured agent (`agents.default`, default `claude`), resolved
through the registry — never a hardcoded `claude`. Everything else in a usable
dev surface is manual:

- The IDE is not opened on the worktree folder — the operator `cd`s and opens it by hand.
- No dev server is booted scoped to the tree's stamped `PORT` (`readPort()` in
  `src/worktrees/worktree-status.ts` writes `PORT=` into `.env.local`, but
  nothing consumes it at launch — only the consumer's own dev command does, run manually).
- No second app instance (the "local Charuy app") is started per task.

So per-tree port-juggling and app boot are manual, defeating the "single command
to a fully usable dev surface" intent stated in
`docs/noldor/worktree-discipline.md` (port-per-tree convention, §"Parallel worktrees").

## Goals

- One command (`noldor worktrees up <slug>`) takes the operator from "branch
  checked out" (or not even created) to: worktree present + IDE open on it +
  agent terminal spawned (the configured `agents.default` runner) + every
  configured dev surface booted on its per-tree port and health-probed.
- Dev surfaces are **consumer-declared** (framework stays opinionated about the
  mechanism, agnostic about which servers a given repo runs) — reusing the
  existing `consumer.verifyCommands` shape from `src/core/consumer-config.ts`.
- Long-running surfaces are reaped cleanly by a paired `worktrees down <slug>`.
- Zero change to existing single-port semantics: the stamped `.env.local` `PORT`
  remains the primary web surface's port; additional surfaces derive offset ports.

## Non-goals

- Cross-platform terminal/editor spawning. The existing terminal spawn is
  macOS + iTerm2 (osascript) only; this FD keeps that boundary (D6).
- Changing the `5174-5179` base-port allocation in `allocatePorts()`.
- Replacing the verify-lane smoke floor (`src/verify/smoke.ts`) — dev boot
  reuses its boot+probe logic but never kills the child.
- Managing app state, seed data, or DB instances per task — surfaces are just
  long-running processes the consumer's command defines.

## Design

### Unit 1 — `dev` config block (`src/core/consumer-config.ts`)

Add an optional `dev` block to `ConsumerConfigSchema`. It reuses the existing
`VerifySurfaceSchema` field set (`command`, `healthPath`, `readyTimeoutMs`) and
adds `portOffset`; `kind` is implicitly `server` (dev surfaces are long-running).

```ts
export const DevSurfaceSchema = z
  .object({
    command: z.string().min(1),              // {port}/{path} substituted at boot
    healthPath: z.string().default('/'),
    readyTimeoutMs: z.number().int().positive().default(30_000),
    portOffset: z.number().int().min(0).default(0), // base PORT + offset
  })
  .strict();

export const DevConfigSchema = z
  .object({
    editor: z.object({ command: z.string().min(1) }).optional(), // e.g. "code {path}"
    surfaces: z.record(z.string(), DevSurfaceSchema).default({}),
  })
  .strict();
```

Add `dev: DevConfigSchema.optional()` to `ConsumerConfigSchema`. New loaders
mirror `loadVerifyCommands()`: `loadDevConfig(cwd): DevConfig | null` and
`loadDevSurfaces(cwd): Record<string, DevSurface>`.

For noldor self-host, `.noldor/config.json` declares the dashboard as a dev
surface (`pnpm noldor dashboard server --port {port}`, `healthPath: "/"`,
`portOffset: 0`); a real consumer (Charuy) declares its web app at offset 0 and
its internal API server at a non-zero offset.

### Unit 2 — extract shared health-poll helper (`src/verify/health.ts`)

`probeServer()` in `src/verify/smoke.ts` already encodes "spawn detached process
group → poll `http://127.0.0.1:<port><healthPath>` until 200 or deadline". Dev
boot needs the same poll **without the `finally { process.kill(-pid) }`**.
Extract the pure poll loop:

```ts
export async function waitForHttp200(
  url: string, deadlineMs: number, fetchImpl: typeof fetch,
): Promise<boolean>
```

Refactor `probeServer()` to call it (smoke stays green). This is the only edit
to existing verify code.

### Unit 3 — per-surface port derivation (`src/worktrees/worktree-status.ts`)

```ts
/** Surface port = the tree's stamped base PORT + the surface's offset. */
export function deriveSurfacePort(basePort: number, offset: number): number {
  return basePort + offset;
}
```

Base port comes from the existing `readPort(treePath)`. Offset 0 → the stamped
PORT itself (back-compat: a single offset-0 surface behaves exactly like the
manual `pnpm dev` an operator runs today). Offsets are constrained `>= 100` by
convention so secondary ports land in the `527x` range, clear of the
`5174-5179` base cap and of each other (D1).

### Unit 4 — IDE open (`src/worktrees/open-editor.ts`)

```ts
export async function openEditor(treePath: string, command: string | undefined,
  spawnImpl?): Promise<{ opened: boolean; note?: string }>
```

If `command` is undefined → `{ opened: false, note: 'no dev.editor configured' }`.
Else substitute `{path}` → `treePath`, `spawn` detached + unref (e.g.
`code <path>`), return `{ opened: true }`. Editor command is cross-platform by
the consumer's choice; no osascript.

### Unit 5 — dev-surface boot (`src/worktrees/dev-surfaces.ts`)

```ts
export interface BootedSurface {
  name: string; port: number; url: string; pid: number | null; ready: boolean;
}
export async function bootDevSurfaces(opts: {
  treePath: string; slug: string;
  surfaces: Record<string, DevSurface>;
  basePort: number; cwd: string; fetchImpl?: typeof fetch;
}): Promise<BootedSurface[]>
```

For each surface: `port = deriveSurfacePort(basePort, offset)`; pre-boot
occupancy check (same fetch-then-fail pattern smoke uses to avoid false-greening
against a stale listener); `spawn('/bin/sh', ['-c', cmd], { cwd: treePath,
detached: true, stdio: 'ignore' })` with `{port}`/`{path}` substituted; `child.unref()`
(unlike smoke, the process **survives** the CLI exit); poll via
`waitForHttp200()` to set `ready`. Append each live pid to
`.noldor/dev-<slug>.pids` (newline-delimited `name pid port`) for teardown.

### Unit 6 — single-tree launch extraction (`src/worktrees/launch-worktrees.ts`)

The for-loop body in `main()` that renders the prompt and emits the
`create window … write text` osascript becomes `export async function
launchTree(w: Worktree, template: string)` so `up` reuses the exact terminal
spawn rather than duplicating osascript. `main()` loops `launchTree` over all
non-main trees (unchanged behaviour).

### Unit 7 — orchestrator (`src/worktrees/up-worktree.ts`)

`noldor worktrees up <slug> [--no-create] [--no-editor] [--no-servers] [--no-terminal] [--branch <name>]`

Steps, each gated by its flag:
1. **create** — if `.worktrees/<slug>` absent and not `--no-create`, call
   `createWorktree({ slug, branch })` (reuses install + port stamping). If present, reuse.
2. read `basePort = readPort(treePath)` (warn if null — port range exhausted).
3. **editor** — `openEditor(treePath, loadDevConfig(cwd)?.editor?.command)`.
4. **terminal** — `launchTree({ path, branch, isMain: false }, template)` from Unit 6.
5. **servers** — `bootDevSurfaces({ treePath, slug, surfaces: loadDevSurfaces(cwd), basePort, cwd })`.
6. print a summary table: each surface name → url → ready/✗, editor opened y/n, terminal y/n.

### Unit 8 — teardown (`src/worktrees/down-worktree.ts`)

`noldor worktrees down <slug> [--remove]`: read `.noldor/dev-<slug>.pids`,
`process.kill(-pid, 'SIGKILL')` each (process-group reap, tolerate ENOENT),
delete the pids file; with `--remove` also `git worktree remove --force` +
`git branch -D`. Pairs with the finish-sequence in `docs/noldor/worktree-discipline.md`.

### Unit 9 — CLI wiring (`src/cli/manifest.ts`)

Add to the `worktrees.subs` block:
```ts
up:   { src: 'worktrees/up-worktree.ts',   desc: 'Bootstrap full dev surface: create + IDE + terminal + dev servers' },
down: { src: 'worktrees/down-worktree.ts', desc: 'Reap dev servers for a tree (--remove also deletes the worktree)' },
```

## Acceptance criteria

- `DevSurfaceSchema`/`DevConfigSchema` parse a valid `dev` block and reject
  unknown keys (`.strict()`); `loadDevSurfaces()` returns `{}` when `dev` absent.
- `deriveSurfacePort(5174, 0) === 5174`; `deriveSurfacePort(5174, 100) === 5274`.
- `waitForHttp200()` returns `true` on a stubbed fetch reaching 200 before
  deadline, `false` after deadline; `smoke.ts` tests still pass post-refactor.
- `openEditor(p, undefined)` returns `{ opened: false }` and spawns nothing;
  `openEditor(p, 'code {path}')` spawns `code <p>` detached.
- `bootDevSurfaces()` with a stub spawn + stub fetch: substitutes `{port}`/`{path}`,
  computes offset ports, writes `.noldor/dev-<slug>.pids`, marks `ready` from the
  poll, and does **not** kill the child.
- `bootDevSurfaces()` fails a surface (`ready:false`, note) when its port is
  occupied before boot.
- `launchTree()` is importable and emits the same osascript a single iteration
  of the old loop did (snapshot/string-match test).
- `up` orchestrator honours every `--no-*` flag (each step skippable) and
  returns a summary with one row per surface.
- `down` SIGKILLs each pid in the pids file, tolerates already-dead pids, and
  removes the file; `--remove` additionally invokes the git removal.
- `noldor worktrees up`/`down` are dispatchable (manifest wired); `--help` lists them.

## Risks / trade-offs

- **Port collisions across trees.** Two trees with base 5174/5175 and a surface
  at offset 0 are fine, but offset+1 would collide. Mitigated by the `>=100`
  offset convention (D1) keeping secondary ports in `527x`. Residual: >5 trees
  is already capped by `FEATURE_CAP=3`.
- **Process leakage.** Long-running detached servers outlive the CLI by design;
  if the operator skips `worktrees down`, ports stay held. Mitigated by the pids
  file + occupancy pre-check (next `up` fails loudly rather than false-greening).
- **macOS/iTerm2-only terminal.** Inherited from `launch-worktrees.ts`; non-mac
  hosts skip the terminal step with a note rather than erroring (D6).
- **Editor command injection.** `dev.editor.command` is operator-authored config,
  not free user input — acceptable, same trust level as `verifyCommands`.

## User Story

As a solo operator running features in parallel worktrees, I want one command to
open my IDE on the task's worktree, spawn its agent terminal, and boot every dev
server scoped to that tree's port, so that I go from "branch checked out" to a
fully usable dev surface without manual port-juggling or app-boot steps.

## Usage

**CLI**

1. From the main workspace: `pnpm noldor worktrees up <slug>`
   - Creates `.worktrees/<slug>` on `feat/<slug>` if absent (reuses
     `worktrees create`), stamps a base port into `.env.local`.
   - Opens the IDE via `consumer.dev.editor.command` (e.g. `code {path}`).
   - Spawns one iTerm2 window running the configured agent — resolved from
     `agents.default` via the agent-runner registry, `claude` by default
     (reuses the launch path, now runner-resolved instead of hardcoded).
   - Boots each `consumer.dev.surfaces` entry on `basePort + portOffset`,
     probes `healthPath` until HTTP 200, leaves it running.
   - Prints a surface table (name → `http://127.0.0.1:<port><healthPath>` → ready?).
2. Skip any step: `--no-create`, `--no-editor`, `--no-terminal`, `--no-servers`.
   Override branch with `--branch <name>`.
3. Tear down when done: `pnpm noldor worktrees down <slug>` (SIGKILLs the booted
   servers). Add `--remove` to also delete the worktree + branch.

**Config** (`.noldor/config.json`, `consumer.dev`)

```json
"dev": {
  "editor": { "command": "code {path}" },
  "surfaces": {
    "web":  { "command": "pnpm dev --port {port}",         "healthPath": "/",        "portOffset": 0 },
    "api":  { "command": "pnpm api:serve --port {port}",   "healthPath": "/health",  "portOffset": 100 }
  }
}
```

**Keyboard shortcut** — _none (CLI tool)._

**Agent API** — `createWorktree`, `openEditor`, `bootDevSurfaces`, `launchTree`,
`deriveSurfacePort`, `loadDevSurfaces` are importable for programmatic drain/launch flows.

## Open questions (resolved)

1. *How are ports assigned when a tree runs multiple surfaces, without colliding
   across trees?* -> Keep the stamped `.env.local` `PORT` as the primary surface's
   base; derive secondary surface ports as `base + portOffset` with `portOffset >= 100`
   by convention, landing them in the `527x` range clear of the `5174-5179` base
   cap. **(D1)** — lowest-risk: zero change to `allocatePorts()`, and an offset-0
   single surface is byte-identical to today's manual dev boot.
2. *Should `up` create the worktree or require it to exist?* -> Create if absent
   (idempotent), reuse if present; `--no-create` to require-exists. **(D2)** —
   matches the "from branch-checked-out (or not) to usable surface" single-command goal.
3. *Fire-and-forget the dev servers, or wait for health?* -> Spawn detached +
   `unref` (survives CLI exit) but poll `healthPath` until 200 or `readyTimeoutMs`,
   reporting per-surface `ready`. Never kill (unlike smoke). **(D3)** — operator
   wants confirmation the surface is live; a slow surface is reported, not fatal.
4. *Hardcode the editor (`code`) or make it config?* -> `consumer.dev.editor.command`
   with `{path}` substitution, unset by default (skip + note). **(D4)** — editor
   choice is genuinely per-operator; noldor stays opinionated about the mechanism only.
5. *How are the long-running servers reaped?* -> Ship `worktrees down <slug>`:
   read `.noldor/dev-<slug>.pids`, SIGKILL each process group, delete the file;
   `--remove` also removes the tree. **(D5)** — without it, detached servers leak ports.
6. *Make the terminal/editor cross-platform?* -> No. Keep the macOS/iTerm2
   osascript terminal from `launch-worktrees.ts`; on non-mac, skip the terminal
   step with a note. The editor is cross-platform via the consumer's command. **(D6)**
   — expanding platform scope is out of band for this FD.
