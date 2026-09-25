# Geometry Compare Lane — Part 3: render-compare on Shared `boot-probe.ts` and `round-artifacts.ts`, plus the Geometry Knob Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** `render-compare` keeps behaving exactly the same while it runs through two lifted helpers — `forEachBootedSurface` (`boot-probe.ts`: per-`verifyCommand` boot plus the retrying `routeProbeBudgetMs` route probe) and `swapRoundArtifacts` (`round-artifacts.ts`: the atomic evidence swap) — so the geometry lane can reuse them instead of copying them. The same part adds `autonomous.geometryCompareMode`, the six geometry reason codes, and an `env` argument on `runCapture`.
**Architecture:** Lift, don't copy: both helpers move out of `render-compare.ts` verbatim in behaviour, render-compare switches to them, and its existing suite is the proof. `aggregateOutcomes` reads a structural `AggregableOutcome` so each lane keeps its own payload. The knob widens the one `LaneModeKey` union that `openDesignReviewRound` also uses. The `geometry-compare` lane literal is NOT added here: `LANES` in `orchestrate.ts` must list every lane and the pre-commit build runs `tsc`, so the literal lands with its runner in part 5.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod 3, vitest.

**Depends on:** part 1 (`screenshotCommand` optional, so render-compare's `SurfaceJob.recipe` is `UiBootRecipe & { screenshotCommand: string }`). Independent of part 2.

---

## File Structure

- `src/cr/lane-mode.ts` — `LaneModeKey` union including `geometryCompareMode` (Modify).
- `src/cr/lanes/pen-scratch.ts` — `openDesignReviewRound`'s mode key widened through `LaneModeKey` (Modify).
- `src/core/config.ts` — `autonomous.geometryCompareMode`, fail-soft `advisory` (Modify).
- `src/cr/findings-schema.ts` — six geometry reason codes (Modify).
- `src/core/run-capture.ts` — optional `env` merged over `process.env` (Modify).
- `src/cr/lanes/round-artifacts.ts` — `RoundArtifact`, `SwapResult`, `swapRoundArtifacts` (Create).
- `src/cr/lanes/boot-probe.ts` — `forEachBootedSurface`, `BootProbeDeps` (Create).
- `src/cr/lanes/render-compare-core.ts` — `AggregableOutcome`; `aggregateOutcomes` reads only that shape (Modify).
- `src/cr/lanes/render-compare.ts` — uses the swap and the boot helper (Modify).
- `.noldor/indirection-baseline.json` — re-recorded in its own commit if the new edges raise it (Modify).
- Tests (Create): `src/cr/__tests__/lanes/geometry-registration.test.ts`, `src/core/__tests__/run-capture.test.ts`, `src/cr/__tests__/lanes/round-artifacts.test.ts`, `src/cr/__tests__/lanes/boot-probe.test.ts`.

---

## Task 1: The mode knob and the reason codes

**Files:**
- Modify: `src/cr/lane-mode.ts`, `src/cr/lanes/pen-scratch.ts`, `src/core/config.ts`, `src/cr/findings-schema.ts`
- Test: `src/cr/__tests__/lanes/geometry-registration.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/lanes/geometry-registration.test.ts`:

```ts
// @tests: ui-design-review-lane
import { describe, expect, it } from 'vitest';

import { autonomousConfigSchema } from '../../../core/config.js';
import { laneReasonCodeSchema } from '../../findings-schema.js';

describe('geometry-compare registration', () => {
  it('adds the mode knob with a fail-soft advisory default', () => {
    expect(autonomousConfigSchema.parse({}).geometryCompareMode).toBe('advisory');
    expect(autonomousConfigSchema.safeParse({ geometryCompareMode: 'blocking' }).success).toBe(true);
    expect(autonomousConfigSchema.safeParse({ geometryCompareMode: 'sometimes' }).success).toBe(
      false,
    );
  });

  it('adds one reason code per stage that can decline', () => {
    for (const code of [
      'no-geometry-recipe',
      'geometry-extract-failed',
      'geometry-capture-failed',
      'geometry-unparseable',
      'geometry-empty',
      'viewport-mismatch',
    ]) {
      expect(laneReasonCodeSchema.safeParse(code).success).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/lanes/geometry-registration.test.ts
```

Expected output: `Tests  2 failed (2)`. The first case gets `undefined` for `geometryCompareMode`, and the second rejects `no-geometry-recipe`.

- [ ] **Step 3: Add the knob.** In `src/core/config.ts`, inside `autonomousConfigSchema`, directly after the `renderCompareMode` line, add:

```ts
  // Governs the geometry-compare lane's review outcomes only. A third knob,
  // because an adopter can trust a layout-value diff and a pixel diff to
  // different degrees. Same posture: advisory default, `pen-modified` reds in
  // BOTH modes.
  geometryCompareMode: z.enum(['blocking', 'advisory']).default('advisory'),
```

- [ ] **Step 4: Widen the mode key in one place.** In `src/cr/lane-mode.ts`, replace the `loadLaneMode` function with:

```ts
/** The autonomous-config knobs a lane can own. */
export type LaneModeKey = 'verifyMode' | 'uiReviewMode' | 'renderCompareMode' | 'geometryCompareMode';

/** `key` names the autonomous-config knob this lane owns. */
export async function loadLaneMode(repoRoot: string, key: LaneModeKey): Promise<LaneMode> {
  const cfg = await loadConfig(join(repoRoot, '.noldor', 'config.json')).catch(() => null);
  return cfg?.autonomous?.[key] ?? 'advisory';
}
```

In `src/cr/lanes/pen-scratch.ts`, change the import `import type { LaneMode } from '../lane-mode.js';` to `import type { LaneMode, LaneModeKey } from '../lane-mode.js';`, and in `openDesignReviewRound` replace the parameter line `modeKey: 'uiReviewMode' | 'renderCompareMode',` with:

```ts
  // Every design lane's knob; `verifyMode` belongs to the verifier, which never opens a design round.
  modeKey: Exclude<LaneModeKey, 'verifyMode'>,
```

- [ ] **Step 5: Add the reason codes.** In `src/cr/findings-schema.ts`, inside `laneReasonCodeSchema`, directly after `'persist-failed',` and before the `// integrity` comment, add:

```ts
  // cannot-review classes owned by the geometry-compare lane (spec D6), one per
  // stage that can decline. An ordinary layout mismatch carries NO reason code:
  // it is a `fail` whose findings name the family and the unmatched values.
  'no-geometry-recipe',
  'geometry-extract-failed',
  'geometry-capture-failed',
  'geometry-unparseable',
  'geometry-empty',
  'viewport-mismatch',
```

- [ ] **Step 6: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/lanes/geometry-registration.test.ts src/cr/__tests__/findings-schema.test.ts && pnpm typecheck
```

Expected output: `Test Files  2 passed (2)`. `tsc` exits 0 with no output.

- [ ] **Step 7: Commit.**

```bash
cat > /tmp/geo-p3t1.msg <<'MSG'
feat(cr): add the geometry-compare mode knob and reason codes

The lane in part 5 needs a mode knob and a closed set of reasons for a
round that could not compare. geometryCompareMode joins the autonomous schema
with the same fail-soft advisory default its two siblings use. The mode-key
union now lives once in lane-mode.ts as LaneModeKey, and openDesignReviewRound
takes that union minus verifyMode instead of restating it. Six reason codes join
the enum, one per pipeline stage that can decline. The ordinary layout mismatch
is left out on purpose: it is a fail with findings.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/lane-mode.ts src/cr/lanes/pen-scratch.ts src/core/config.ts src/cr/findings-schema.ts src/cr/__tests__/lanes/geometry-registration.test.ts
git commit -F /tmp/geo-p3t1.msg
```

---

## Task 2: `runCapture` passes extra environment

**Files:**
- Modify: `src/core/run-capture.ts`
- Test: `src/core/__tests__/run-capture.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/core/__tests__/run-capture.test.ts`:

```ts
// @tests: ui-design-review-lane
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCapture } from '../run-capture.js';

describe('runCapture env', () => {
  it('merges the extra variables over the inherited environment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-capture-env-'));
    const r = await runCapture(
      `printf '%s|%s' "$NOLDOR_GEOMETRY_SURFACE" "$PATH" > out.txt`,
      dir,
      10_000,
      { NOLDOR_GEOMETRY_SURFACE: 'dashboard' },
    );
    expect(r.code).toBe(0);
    const [surface, path] = (await readFile(join(dir, 'out.txt'), 'utf8')).split('|');
    expect(surface).toBe('dashboard');
    expect(path).toBe(process.env.PATH);
  });

  it('inherits the environment unchanged when no env is given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-capture-env-'));
    const r = await runCapture(
      `printf '%s' "\${NOLDOR_GEOMETRY_SURFACE-unset}" > out.txt`,
      dir,
      10_000,
    );
    expect(r.code).toBe(0);
    expect(await readFile(join(dir, 'out.txt'), 'utf8')).toBe('unset');
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/core/__tests__/run-capture.test.ts
```

Expected output: `Tests  1 failed | 1 passed (2)`. The first case reads `''` for the surface, because the fourth argument is ignored.

- [ ] **Step 3: Implement.** In `src/core/run-capture.ts`, replace the doc comment's first sentence `Run \`command\` via \`/bin/sh -c\` under \`timeoutMs\`, with cwd = \`cwd\` and env inherited.` with `Run \`command\` via \`/bin/sh -c\` under \`timeoutMs\`, with cwd = \`cwd\` and the environment inherited, \`env\` merged over it when given.`, then replace the signature and the `spawn` call with:

```ts
export function runCapture(
  command: string,
  cwd: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      // Merged, not replaced: a capture command still needs PATH and HOME. The
      // geometry capture script learns its surface from NOLDOR_GEOMETRY_SURFACE
      // this way, since the placeholder contract has no {surface}.
      ...(env !== undefined ? { env: { ...process.env, ...env } } : {}),
    });
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/core/__tests__/run-capture.test.ts src/design/__tests__/ui-capture.test.ts src/cr/__tests__/lanes/render-compare.test.ts && pnpm typecheck
```

Expected output: `Test Files  3 passed (3)`. The two existing callers are unchanged. `tsc` exits 0.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/geo-p3t2.msg <<'MSG'
feat(core): let runCapture pass extra environment to the command

The geometry capture script has to know which surface it is measuring. The
placeholder contract ({url} {out} {width} {height}) has no {surface}, so the
script reads NOLDOR_GEOMETRY_SURFACE. runCapture takes an optional env record and
merges it over process.env, so PATH and HOME still reach the command. Existing
callers pass nothing and behave as before.

Noldor-FD: ui-design-review-lane
MSG
git add src/core/run-capture.ts src/core/__tests__/run-capture.test.ts
git commit -F /tmp/geo-p3t2.msg
```

---

## Task 3: Lift the evidence swap out of `render-compare`

**Files:**
- Create: `src/cr/lanes/round-artifacts.ts`
- Modify: `src/cr/lanes/render-compare.ts`
- Test: `src/cr/__tests__/lanes/round-artifacts.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/lanes/round-artifacts.test.ts`:

```ts
// @tests: ui-design-review-lane
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { swapRoundArtifacts } from '../../lanes/round-artifacts.js';

async function priorRound(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'round-art-'));
  await mkdir(join(root, 'slug'), { recursive: true });
  await writeFile(join(root, 'slug', 'old.json'), 'old', 'utf8');
  return root;
}

describe('swapRoundArtifacts', () => {
  it('replaces the round directory with the new set', async () => {
    const root = await priorRound();
    const r = await swapRoundArtifacts(root, 'slug', [{ name: 'new.json', body: 'new' }]);
    expect(r).toEqual({ ok: true });
    expect(await readdir(join(root, 'slug'))).toEqual(['new.json']);
    expect(await readFile(join(root, 'slug', 'new.json'), 'utf8')).toBe('new');
    expect((await readdir(root)).filter((e) => e.startsWith('.'))).toEqual([]);
  });

  it('keeps the prior round when handed nothing', async () => {
    const root = await priorRound();
    expect(await swapRoundArtifacts(root, 'slug', [])).toEqual({ ok: true });
    expect(await readdir(join(root, 'slug'))).toEqual(['old.json']);
  });

  it('reports a failure detail instead of throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'round-art-'));
    const notADir = join(dir, 'file');
    await writeFile(notADir, 'x', 'utf8');
    const r = await swapRoundArtifacts(notADir, 'slug', [{ name: 'a.json', body: 'a' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).not.toBe('');
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/lanes/round-artifacts.test.ts
```

Expected output: `Failed to resolve import "../../lanes/round-artifacts.js"`.

- [ ] **Step 3: Implement the shared swap.** Create `src/cr/lanes/round-artifacts.ts`:

```ts
// @tests: ui-design-review-lane
// The evidence-directory swap both booting design lanes need: stage, move the
// prior round ASIDE, move the new set in — a failure between the renames still
// leaves ONE complete set. Lifted out of `render-compare.ts` for `geometry-compare`.

import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { errMessage } from '../../core/err-message.js';

/** One evidence file: a name inside the round directory and its bytes. */
export interface RoundArtifact {
  name: string;
  body: string | Buffer;
}

/** The swap's outcome: a failure is a detail for the sink, never a throw. */
export type SwapResult = { ok: true } | { ok: false; detail: string };

/**
 * Replace `<root>/<slug>` with `artifacts`. noldor:cut — an EMPTY list keeps the
 * prior round (arbitrated between two render-compare review rounds): files are
 * only read through the sink that references them, and an empty round's sink
 * references none. noldor:cut — a hard crash exactly between the renames can
 * leave `<root>/<slug>` absent with the trash intact; closing that needs an
 * atomic directory exchange Node lacks. Absent-but-recoverable beats mixed.
 */
export async function swapRoundArtifacts(
  root: string,
  slug: string,
  artifacts: readonly RoundArtifact[],
  unique: string = `${slug}-${process.pid}-${Date.now()}`,
): Promise<SwapResult> {
  if (artifacts.length === 0) return { ok: true };
  const finalDir = join(root, slug);
  const tmpDir = join(root, `.tmp-${unique}`);
  const trashDir = join(root, `.trash-${unique}`);
  try {
    await mkdir(tmpDir, { recursive: true });
    for (const a of artifacts) await writeFile(join(tmpDir, a.name), a.body);
    try {
      await rename(finalDir, trashDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    try {
      await rename(tmpDir, finalDir);
    } catch (err) {
      await rename(trashDir, finalDir).catch(() => {
        /* no prior round to restore */
      });
      throw err;
    }
    await rm(trashDir, { recursive: true, force: true }).catch(() => {
      /* stale trash is disk cost only; the fresh set is already in place */
    });
    return { ok: true };
  } catch (err) {
    // Never remove finalDir: it holds a complete set (prior, or just restored).
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {
      /* best-effort */
    });
    // trashDir may be the ONLY surviving set — remove it only when finalDir exists.
    if (existsSync(finalDir)) {
      await rm(trashDir, { recursive: true, force: true }).catch(() => {
        /* best-effort */
      });
    }
    return { ok: false, detail: errMessage(err) };
  }
}
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/lanes/round-artifacts.test.ts
```

Expected output: `Tests  3 passed (3)`.

- [ ] **Step 5: Switch `render-compare.ts` to it.** Replace the whole block from the comment line `// ---- R6: persist artifacts, atomically per round ----` down to the closing `}` of `if (jobs.length > 0) { … }` (the line before `// ---- rows (per-surface record, deterministic order) ----`) with:

```ts
    // ---- R6: persist artifacts, atomically per round ----
    // A round with no raster hands the swap an empty list, which keeps the prior
    // round's evidence (see round-artifacts.ts for why).
    const artifacts: RoundArtifact[] = [];
    for (const job of jobs) {
      artifacts.push({ name: `${job.sanitized}.design.png`, body: job.designBuf });
      if (job.shotBuf !== undefined) {
        artifacts.push({ name: `${job.sanitized}.shot.png`, body: job.shotBuf });
      }
      if (job.diffBuf !== undefined) {
        artifacts.push({ name: `${job.sanitized}.diff.png`, body: job.diffBuf });
      }
    }
    const swap = await swapRoundArtifacts(
      join(input.repoRoot, '.noldor', 'cr', 'render-compare'),
      input.slug,
      artifacts,
    );
    const persistFailure = swap.ok ? null : swap.detail;
    if (persistFailure !== null) notes.push(`artifact persist failed: ${persistFailure}`);
```

Then fix the imports at the top of `render-compare.ts`: delete `import { existsSync } from 'node:fs';`, change `import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';` to `import { mkdir, readFile, stat } from 'node:fs/promises';`, and add `import { swapRoundArtifacts, type RoundArtifact } from './round-artifacts.js';` after the `render-export-dispatch.js` import.

- [ ] **Step 6: Verify render-compare is unchanged in behaviour.**

```bash
pnpm vitest run src/cr/__tests__/lanes/render-compare.test.ts src/cr/__tests__/lanes/round-artifacts.test.ts && pnpm typecheck && pnpm lint
```

Expected output: `Test Files  2 passed (2)`. Every existing render-compare case, persistence ones included, passes unchanged. `tsc` and `oxlint` exit 0 (no unused import left behind).

- [ ] **Step 7: Commit.**

```bash
cat > /tmp/geo-p3t3.msg <<'MSG'
refactor(cr): lift the round-evidence swap out of render-compare

The geometry lane needs render-compare's evidence guarantee: never a mixed set,
and an empty round never destroys the prior one. The tmp, trash, swap sequence
moves to round-artifacts.ts, returning a result instead of throwing so a caller
can report persist-failed. render-compare now builds its PNG list and calls it.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/lanes/round-artifacts.ts src/cr/lanes/render-compare.ts src/cr/__tests__/lanes/round-artifacts.test.ts
git commit -F /tmp/geo-p3t3.msg
```

---

## Task 4: Lift the boot-and-probe loop and generalize the aggregate

**Files:**
- Create: `src/cr/lanes/boot-probe.ts`
- Modify: `src/cr/lanes/render-compare.ts`, `src/cr/lanes/render-compare-core.ts`
- Test: `src/cr/__tests__/lanes/boot-probe.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/lanes/boot-probe.test.ts`:

```ts
// @tests: ui-design-review-lane
import { describe, expect, it } from 'vitest';

import type { VerifySurface } from '../../../core/consumer-config.js';
import { forEachBootedSurface, type BootProbeDeps } from '../../lanes/boot-probe.js';

interface Job { surface: string; recipe: { verifyCommand: string; route: string } }
const job = (surface: string, verifyCommand = 'web'): Job => ({
  surface,
  recipe: { verifyCommand, route: `/${surface}` },
});
const server: VerifySurface = { command: 'dev --port {port}', kind: 'server', healthPath: '/', readyTimeoutMs: 1000 };

interface Log { boots: number; kills: number; unreachable: string[]; reached: string[] }

function harness(over: Partial<BootProbeDeps> = {}): { log: Log; deps: BootProbeDeps } {
  const log: Log = { boots: 0, kills: 0, unreachable: [], reached: [] };
  const deps: BootProbeDeps = {
    resolvePort: async () => 4100,
    routeProbeBudgetMs: 100,
    boot: async (s, port) => {
      log.boots++;
      return {
        ok: true,
        url: `http://127.0.0.1:${port}/`,
        command: s.command,
        kill: () => {
          log.kills++;
        },
      };
    },
    fetchImpl: (async () => new Response('', { status: 200 })) as typeof fetch,
    ...over,
  };
  return { log, deps };
}

const walk = (
  jobs: Job[],
  { log, deps }: { log: Log; deps: BootProbeDeps },
  opts: { cmds?: Map<string, VerifySurface>; budgetMs?: number } = {},
): Promise<void> =>
  forEachBootedSurface({
    jobs,
    verifyCommands: opts.cmds ?? new Map([['web', server]]),
    repoRoot: '/repo',
    deps,
    ...(opts.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}),
    unreachable: (j, reason, detail) => {
      log.unreachable.push(`${j.surface} ${reason}: ${detail}`);
    },
    reached: async (j, url) => {
      log.reached.push(`${j.surface} ${url}`);
    },
  });

describe('forEachBootedSurface', () => {
  it('boots once per verifyCommand group, reaches every route, and kills each boot', async () => {
    const h = harness();
    const cmds = new Map([
      ['web', server],
      ['api', server],
    ]);
    await walk([job('a'), job('b'), job('c', 'api')], h, { cmds });
    expect(h.log.boots).toBe(2);
    expect(h.log.kills).toBe(2);
    expect(h.log.reached).toEqual([
      'a http://127.0.0.1:4100/a',
      'b http://127.0.0.1:4100/b',
      'c http://127.0.0.1:4100/c',
    ]);
  });

  it('fails a group whose verifyCommand is missing without booting it', async () => {
    const h = harness();
    await walk([job('a', 'api')], h);
    expect(h.log.boots).toBe(0);
    expect(h.log.unreachable).toEqual([
      "a boot-failed: verifyCommand 'api' is missing from consumer.verifyCommands",
    ]);
  });

  it('fails every surface of a group whose boot fails', async () => {
    const h = harness({
      boot: async (s) => ({ ok: false, url: 'u', command: s.command, observed: 'no 200 in 1000ms' }),
    });
    await walk([job('a'), job('b')], h);
    expect(h.log.unreachable).toEqual([
      'a boot-failed: no 200 in 1000ms',
      'b boot-failed: no 200 in 1000ms',
    ]);
    expect(h.log.kills).toBe(0);
  });

  it('refuses to boot once the round budget is spent', async () => {
    const h = harness();
    await walk([job('a')], h, { budgetMs: 0 });
    expect(h.log.boots).toBe(0);
    expect(h.log.unreachable).toEqual([
      'a boot-failed: round budget (0ms) exhausted before this group booted',
    ]);
  });

  it('retries a cold route that does not answer yet, within routeProbeBudgetMs', async () => {
    let calls = 0;
    const h = harness({
      routeProbeBudgetMs: 2000,
      fetchImpl: (async () => {
        calls++;
        if (calls < 3) throw new Error('ECONNREFUSED');
        return new Response('', { status: 200 });
      }) as typeof fetch,
    });
    await walk([job('a')], h);
    expect(calls).toBe(3);
    expect(h.log.reached).toEqual(['a http://127.0.0.1:4100/a']);
  });

  it('declines a non-2xx route and still kills the boot', async () => {
    const h = harness({
      fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
    });
    await walk([job('a')], h);
    expect(h.log.unreachable).toEqual([
      'a route-unreachable: GET http://127.0.0.1:4100/a → 404 (want 2xx)',
    ]);
    expect(h.log.kills).toBe(1);
  });

  it('declines a route that never answers within the probe budget', async () => {
    const h = harness({
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch,
    });
    await walk([job('a')], h);
    expect(h.log.unreachable).toEqual([
      'a route-unreachable: GET http://127.0.0.1:4100/a got no response within 100ms: ECONNREFUSED',
    ]);
  });

  it('kills the boot even when the per-surface callback throws', async () => {
    const h = harness();
    await expect(
      forEachBootedSurface({
        jobs: [job('a')],
        verifyCommands: new Map([['web', server]]),
        repoRoot: '/repo',
        deps: h.deps,
        unreachable: () => {},
        reached: async () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');
    expect(h.log.kills).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/lanes/boot-probe.test.ts
```

Expected output: `Failed to resolve import "../../lanes/boot-probe.js"`.

- [ ] **Step 3: Implement the helper.** Create `src/cr/lanes/boot-probe.ts`:

```ts
// @tests: ui-design-review-lane
// The per-`verifyCommand` boot-and-route-probe loop both booting design lanes run:
// boot each group once inside one round budget, probe each route with retries,
// and hand the lane a URL only for a 2xx route. Lifted out of `render-compare.ts`.

import type { VerifySurface } from '../../core/consumer-config.js';
import { errMessage } from '../../core/err-message.js';
import type { bootServer } from '../../verify/boot.js';
import type { resolvePort } from '../../verify/port.js';

/** Bounds one route-probe fetch, the same cap the health check's probe fetches use. */
export const ROUTE_PROBE_TIMEOUT_MS = 2000;

/**
 * Whole-loop wall clock, fixed once, so a slow early group shrinks what later
 * groups may spend booting. noldor:cut — enforced at BOOT ADMISSION only: every
 * step inside a group is already bounded (probe ≤ `routeProbeBudgetMs`, capture
 * ≤ 120s), so boot time is the one unbounded quantity; checking mid-group would
 * abandon surfaces whose own caps were about to hold.
 */
export const TOTAL_ROUND_BUDGET_MS = 300_000;

/** The seams a booting lane injects; a lane's own deps object extends this. */
export interface BootProbeDeps {
  boot: typeof bootServer;
  fetchImpl: typeof fetch;
  resolvePort: typeof resolvePort;
  /** Total retry budget for the route probe (cold dev routes compile on demand). */
  routeProbeBudgetMs: number;
}

/** The two recipe fields the loop reads; each lane's job type carries more. */
export interface BootableJob {
  surface: string;
  recipe: { verifyCommand: string; route: string };
}

/** Why a surface never reached its per-surface work. */
export type UnreachableReason = 'boot-failed' | 'route-unreachable';

export interface BootedSurfacesInput<J extends BootableJob> {
  jobs: readonly J[];
  verifyCommands: ReadonlyMap<string, VerifySurface>;
  repoRoot: string;
  deps: BootProbeDeps;
  /** Whole-loop wall clock; {@link TOTAL_ROUND_BUDGET_MS} when omitted. */
  budgetMs?: number;
  /** Record a surface that could not be reached; it gets no `reached` call. */
  unreachable: (job: J, reason: UnreachableReason, detail: string) => void;
  /** The lane's per-surface work, against a booted server whose route answered 2xx. */
  reached: (job: J, url: string) => Promise<void>;
}

/**
 * Walk every job through boot and route probe. A per-group failure lands as that
 * group's rows and the loop continues. The boot is killed on every exit path of
 * its group, including a throwing `reached`.
 */
export async function forEachBootedSurface<J extends BootableJob>(
  input: BootedSurfacesInput<J>,
): Promise<void> {
  const { deps } = input;
  const budgetMs = input.budgetMs ?? TOTAL_ROUND_BUDGET_MS;
  const groups = new Map<string, J[]>();
  for (const job of input.jobs) {
    groups.set(job.recipe.verifyCommand, [...(groups.get(job.recipe.verifyCommand) ?? []), job]);
  }
  const roundDeadline = Date.now() + budgetMs;
  const failGroup = (jobs: readonly J[], detail: string): void => {
    for (const job of jobs) input.unreachable(job, 'boot-failed', detail);
  };
  for (const [cmdName, groupJobs] of groups) {
    const entry = input.verifyCommands.get(cmdName);
    // noldor:cut — unreachable under a schema-valid config; kept so a missing
    // entry degrades to rows instead of throwing.
    if (entry === undefined || entry.kind !== 'server') {
      failGroup(
        groupJobs,
        `verifyCommand '${cmdName}' is ${entry === undefined ? 'missing from consumer.verifyCommands' : `kind "${entry.kind}", not "server"`}`,
      );
      continue;
    }
    let port: number;
    try {
      port = await deps.resolvePort(input.repoRoot);
    } catch (err) {
      failGroup(groupJobs, `no free port: ${errMessage(err)}`);
      continue;
    }
    const remaining = roundDeadline - Date.now();
    if (remaining <= 0) {
      failGroup(groupJobs, `round budget (${budgetMs}ms) exhausted before this group booted`);
      continue;
    }
    let boot: Awaited<ReturnType<typeof deps.boot>>;
    try {
      boot = await deps.boot(entry, port, input.repoRoot, deps.fetchImpl, remaining);
    } catch (err) {
      failGroup(groupJobs, `boot threw: ${errMessage(err)}`);
      continue;
    }
    if (!boot.ok) {
      failGroup(groupJobs, boot.observed);
      continue;
    }
    try {
      for (const job of groupJobs) {
        const url = `http://127.0.0.1:${port}${job.recipe.route}`;
        const probe = await probeRoute(url, deps);
        if (!probe.ok) {
          input.unreachable(job, 'route-unreachable', probe.detail);
          continue;
        }
        await input.reached(job, url);
      }
    } finally {
      // Fire-and-forget SIGKILL: each group boots on its own fresh port.
      boot.kill();
    }
  }
}

/**
 * Keeps a 404/500 route from yielding a confident verdict against an error page;
 * the FINAL status must be 2xx. RETRIED under a small budget because dev servers
 * compile cold routes on demand; any HTTP status ends the loop, only no-response
 * shapes (timeout, refused) retry.
 */
async function probeRoute(
  url: string,
  deps: BootProbeDeps,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  let status: number | null = null;
  let probeErr = '';
  const probeDeadline = Date.now() + deps.routeProbeBudgetMs;
  for (;;) {
    try {
      const res = await deps.fetchImpl(url, {
        signal: AbortSignal.timeout(ROUTE_PROBE_TIMEOUT_MS),
        redirect: 'follow',
      });
      status = res.status;
      // Release the socket; the capture right behind it competes for it.
      await res.body?.cancel().catch(() => {
        /* already consumed or closed */
      });
      break;
    } catch (err) {
      probeErr = errMessage(err);
      if (Date.now() >= probeDeadline) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (status === null) {
    return {
      ok: false,
      detail: `GET ${url} got no response within ${deps.routeProbeBudgetMs}ms: ${probeErr}`,
    };
  }
  if (status < 200 || status >= 300) {
    return { ok: false, detail: `GET ${url} → ${status} (want 2xx)` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/lanes/boot-probe.test.ts
```

Expected output: `Tests  8 passed (8)`.

- [ ] **Step 5: Switch `render-compare.ts` to the helper.** Four edits:

1. Delete the `ROUTE_PROBE_TIMEOUT_MS` constant and the `TOTAL_ROUND_BUDGET_MS` constant with its doc comment; both now live in `boot-probe.ts`.
2. Replace the `RenderCompareDeps` interface with:

```ts
interface RenderCompareDeps extends BootProbeDeps {
  capture: typeof runCapture;
}
```

3. Add `import { forEachBootedSurface, type BootProbeDeps } from './boot-probe.js';` after the `pen-scratch.js` import.
4. Replace the whole group loop — from the comment line `// ---- R4: boot per verifyCommand group, probe + capture per surface ----` through the closing `}` of `for (const [cmdName, groupJobs] of groups) { … }` — with the code below. The route probe that sat inside the loop is gone (`forEachBootedSurface` runs it); the capture and diff code is the same sequence with the same reason codes and details, its repeated `outcomes.push(cannot(…, 'screenshot-failed', …))` calls folded into two local helpers.

```ts
    // ---- R4: boot per verifyCommand group, probe + capture per surface ----
    await forEachBootedSurface({
      jobs,
      verifyCommands,
      repoRoot: input.repoRoot,
      deps,
      unreachable: (job, reason, detail) => {
        outcomes.push(cannot(job.surface, reason, detail));
      },
      reached: async (job, url) => {
        const failShot = (detail: string): void => {
          outcomes.push(cannot(job.surface, 'screenshot-failed', detail));
        };
        const outAbs = join(shotDir, `${job.sanitized}.shot.png`);
        const command = substituteScreenshotCommand(job.recipe.screenshotCommand, {
          url,
          out: outAbs,
          width: String(job.designPng.width),
          height: String(job.designPng.height),
        });
        if (command === null) {
          failShot(`a substitution value contains a single quote and cannot be safely quoted (out=${outAbs})`);
          return;
        }
        let cap: CaptureResult;
        try {
          cap = await deps.capture(command, input.repoRoot, job.recipe.captureTimeoutMs);
        } catch (err) {
          failShot(`capture threw: ${errMessage(err)}`);
          return;
        }
        // The stderr tail rides `notes` for EVERY failed-capture class (spec R4):
        // a timeout or an undecodable output needs the diagnosis as much as an exit.
        const failCapture = (detail: string): void => {
          if (cap.stderrTail !== '') notes.push(`[${job.surface}] capture stderr: ${cap.stderrTail}`);
          failShot(detail);
        };
        if (cap.timedOut) {
          failCapture(`capture timed out after ${job.recipe.captureTimeoutMs}ms`);
          return;
        }
        if (cap.code !== 0) {
          failCapture(`capture exited ${cap.code}`);
          return;
        }
        let shotBuf: Buffer;
        try {
          const size = (await stat(outAbs)).size;
          if (size > MAX_RASTER_BYTES) {
            failCapture(`capture output is ${size} bytes (cap ${MAX_RASTER_BYTES}) — refusing to read`);
            return;
          }
          shotBuf = await readFile(outAbs);
        } catch (err) {
          failCapture(`capture wrote no output file: ${errMessage(err)}`);
          return;
        }
        job.shotBuf = shotBuf;
        // ---- R6: the diff engine (design already decoded at export time) ----
        const diff = diffDecoded(job.designPng, shotBuf);
        if (diff.kind === 'undecodable') {
          failCapture(`shot raster undecodable: ${diff.detail}`);
          return;
        }
        if (diff.kind === 'dimension-mismatch') {
          outcomes.push(cannot(job.surface, 'dimension-mismatch', diff.detail));
          return;
        }
        job.diffBuf = diff.diffPng;
        const threshold = job.recipe.maxDiffRatio;
        const base = { surface: job.surface, diffRatio: diff.diffRatio, threshold };
        // Strict: ratios exactly at the threshold pass (spec R6).
        outcomes.push(
          diff.diffRatio > threshold
            ? {
                ...base,
                kind: 'fail',
                severity: severityForRatio(diff.diffRatio, threshold),
                designPath: rel(job.sanitized, 'design'),
                shotPath: rel(job.sanitized, 'shot'),
                diffPath: rel(job.sanitized, 'diff'),
              }
            : { ...base, kind: 'pass' },
        );
      },
    });
```

- [ ] **Step 6: Generalize the aggregate.** In `src/cr/lanes/render-compare-core.ts`, replace `aggregateOutcomes` (keep the `Aggregated` interface) with:

```ts
/**
 * The only fields aggregation reads. Each lane keeps its own outcome payload
 * (render-compare's ratios, geometry-compare's report) and passes it straight
 * in: every lane's outcome union satisfies this structurally.
 */
export type AggregableOutcome =
  | { surface: string; kind: 'pass' | 'fail' }
  | { surface: string; kind: 'cannot-review'; reason: LaneReasonCode; detail: string };

export function aggregateOutcomes(outcomes: readonly AggregableOutcome[]): Aggregated {
  if (outcomes.some((o) => o.kind === 'fail')) return { verdict: 'fail' };
  const cannots = outcomes
    .filter(
      (o): o is Extract<AggregableOutcome, { kind: 'cannot-review' }> =>
        o.kind === 'cannot-review',
    )
    .sort((a, b) => (a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0));
  if (cannots.length > 0) {
    return { verdict: 'cannot-review', reason: cannots[0].reason, detail: cannots[0].detail };
  }
  return { verdict: 'pass' };
}
```

- [ ] **Step 7: Run everything and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/lanes && pnpm typecheck && pnpm lint
```

Expected output: every lane suite passes. That includes the existing `render-compare.test.ts` cases for boot failure, route-unreachable and the retried probe, and the `aggregateOutcomes` cases in `render-compare-core.test.ts`, all unchanged. `tsc` and `oxlint` exit 0.

- [ ] **Step 8: Check the clones ratchet.**

```bash
pnpm noldor clones check --against main
```

Expected output: exit 0. No clone group overlaps the lines this branch wrote, and duplication is at or below the recorded baseline. These lifts exist so that part 5's lane copies nothing.

- [ ] **Step 9: Commit.**

```bash
cat > /tmp/geo-p3t4.msg <<'MSG'
refactor(cr): share render-compare's boot-and-probe loop and aggregate

The geometry lane boots the same servers the same way, and a copy would have
lost the retrying route probe. forEachBootedSurface in boot-probe.ts now groups
by verifyCommand, boots once per group inside one round budget, probes each
route with retries, kills on every exit path, and hands the lane a URL only for
a 2xx route. render-compare passes its capture and diff work as the callback;
its suite passes unchanged. aggregateOutcomes reads a structural type.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/lanes/boot-probe.ts src/cr/lanes/render-compare.ts src/cr/lanes/render-compare-core.ts src/cr/__tests__/lanes/boot-probe.test.ts
git commit -F /tmp/geo-p3t4.msg
```

- [ ] **Step 10: Check the indirection ratchet.**

```bash
pnpm noldor indirection check; echo "exit=$?"
```

Expected output: `exit=0`, or `exit=1` because `render-compare.ts` now imports `boot-probe.ts` and `round-artifacts.ts`. On `exit=0`, this part is done.

- [ ] **Step 11: Re-record the baseline and commit it on its own (only after `exit=1`).**

```bash
pnpm noldor indirection baseline
cat > /tmp/geo-p3t4b.msg <<'MSG'
chore(indirection): re-record the baseline for the render-compare lifts

render-compare.ts now imports boot-probe.ts and round-artifacts.ts, which
raises the transitive-closure excess sum. Re-recorded as its own commit so the
raise shows in the PR diff.

Noldor-FD: ui-design-review-lane
MSG
git add .noldor/indirection-baseline.json
git commit -F /tmp/geo-p3t4b.msg
```

Expected output: `indirection baseline: recorded excess sum <n> (RAISED from <prior>) …`, then the commit.
