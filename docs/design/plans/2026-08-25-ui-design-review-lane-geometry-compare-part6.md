# Geometry Compare Lane — Part 6: The Lane + Adoption Docs Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Turn the per-surface comparison into a selectable CR lane: `crLanes.code: ["reviewer", "geometry-compare"]` resolves affected surfaces, boots the app once per `verifyCommand` group, compares each surface, persists evidence, and writes a standard lane sink — documented well enough for a consumer to adopt it.
**Architecture:** The lane is an orchestration shell over part 5's `reviewSurfaceGeometry`: the design-lane skeleton opens the round, the boot loop supplies URLs, and `aggregateOutcomes` decides the verdict. Nothing about comparison semantics is re-decided here.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod 3, vitest.

**Depends on:** parts 1–5.

---

## File Structure

- `src/cr/lanes/geometry-compare.ts` — the lane: surface planning, the boot/probe loop, evidence, aggregation, mode matrix (Create).
- `src/cr/orchestrate.ts` — runner map, delta short-circuit set, code-only list, and the booting-lane chain (Modify).
- `docs/noldor/cr-pipeline.md` + `templates/docs/noldor/cr-pipeline.md` — the lane's section, twinned (Modify).
- `docs/features/ui-design-review-lane.md` — Usage for the new lane plus refreshed `links` (Modify).
- Tests: `src/cr/__tests__/lanes/geometry-compare.test.ts`, additions to `src/cr/__tests__/orchestrate.test.ts`.

---

## Task 1: The lane

**Files:**
- Create: `src/cr/lanes/geometry-compare.ts`
- Test: `src/cr/__tests__/lanes/geometry-compare.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/lanes/geometry-compare.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { planSurfaceJobs, roundFindings, roundRows } from '../../lanes/geometry-compare.js';

const recipe = (over: Record<string, unknown> = {}): never =>
  ({
    verifyCommand: 'dev',
    route: '/dashboard',
    geometryCommand: 'node cap.mjs {url} {out} {width} {height}',
    geometryTolerance: { edges: 2, fontSize: 1, spacing: 1 },
    geometryBudget: { edges: 0, fontSize: 0, spacing: 0 },
    maxDiffRatio: 0.25,
    captureTimeoutMs: 60_000,
    ...over,
  }) as never;

const family = (over: Record<string, unknown> = {}) => ({
  family: 'edges' as const,
  unmatched: 0,
  budget: 0,
  designOnly: [] as number[],
  implOnly: [] as number[],
  severity: 'med' as const,
  ...over,
});

const families = (over: Record<string, unknown> = {}) => ({
  edges: family(),
  fontSize: family({ family: 'fontSize' as const }),
  spacing: family({ family: 'spacing' as const }),
  ...over,
});

describe('planSurfaceJobs', () => {
  it('declines a surface with no recipe and one with no geometryCommand', () => {
    const plan = planSurfaceJobs(
      ['a', 'b', 'c'],
      new Map([
        ['b', recipe()],
        ['c', recipe({ geometryCommand: undefined })],
      ]),
    );
    expect(plan.declined.map((d) => [d.surface, d.reason])).toEqual([
      ['a', 'no-geometry-recipe'],
      ['c', 'no-geometry-recipe'],
    ]);
    expect(plan.jobs.map((j) => j.surface)).toEqual(['b']);
  });
});

describe('roundRows / roundFindings', () => {
  it('writes one row per surface, declines included', () => {
    const rows = roundRows([
      { surface: 'b', kind: 'pass', families: families() },
      { surface: 'a', kind: 'cannot-review', reason: 'boot-failed', detail: 'no server' },
    ]);
    expect(rows[0]).toContain('[a] boot-failed');
    expect(rows[1]).toContain('[b] pass');
  });

  it('emits one finding per failing family, naming the evidence file', () => {
    const findings = roundFindings('slug', [
      {
        surface: 'dashboard',
        kind: 'fail',
        families: families({
          edges: family({ unmatched: 3, implOnly: [30, 40, 50], severity: 'high' }),
          spacing: family({ family: 'spacing', unmatched: 1, designOnly: [16] }),
        }),
      },
    ]);
    expect(findings).toHaveLength(2);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].file).toBe('.noldor/cr/geometry-compare/slug/dashboard.report.json');
    expect(findings[0].message).toContain('impl-only');
    expect(findings[1].message).toContain('design-only');
  });

  it('emits nothing for a passing surface', () => {
    expect(roundFindings('slug', [{ surface: 'a', kind: 'pass', families: families() }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/lanes/geometry-compare.test.ts
```

Expected output: collection error — `Failed to resolve import "../../lanes/geometry-compare.js"`.

- [ ] **Step 3: Implement the lane.** Create `src/cr/lanes/geometry-compare.ts`:

```ts
// @tests: ui-design-review-lane
// The `geometry-compare` lane (spec D1-D8): boot the consumer's app and compare
// LAYOUT rather than paint. It is an orchestration shell — `reviewSurfaceGeometry`
// owns the per-surface sequence and `openDesignReviewRound` owns sinks, modes and
// scratch integrity — so the only decisions here are which surfaces are in scope,
// how the app is booted for each, and how per-surface outcomes become one verdict.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConsumerConfig } from '../../core/consumer-config.js';
import type { UiBootRecipe } from '../../core/consumer-config.js';
import { errMessage } from '../../core/err-message.js';
import { sanitizeSurfaceName } from '../../core/ui-boot.js';
import { bootServer } from '../../verify/boot.js';
import { resolvePort } from '../../verify/port.js';
import type { Finding, LaneReasonCode } from '../findings-schema.js';
import { GEOMETRY_FAMILIES, type GeometryComparison } from '../geometry/geometry-compare-core.js';
import { reviewSurfaceGeometry } from '../geometry/geometry-review.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { cleanupPenScratch, openDesignReviewRound } from './pen-scratch.js';
import { aggregateOutcomes, type AggregableOutcome } from './render-compare-core.js';
import { swapRoundArtifacts, type RoundArtifact } from './round-artifacts.js';
import { writeFailByMode, writePenModified } from './ui-design-resolve.js';

const LANE = 'geometry-compare' as const;
/** Whole-round wall clock, not per boot — same budget `render-compare` uses. */
const TOTAL_ROUND_BUDGET_MS = 300_000;
const ROUTE_PROBE_TIMEOUT_MS = 2000;

/** A surface the round will actually try to compare. */
export interface SurfaceJob {
  surface: string;
  sanitized: string;
  recipe: UiBootRecipe & { geometryCommand: string };
}

export interface DeclinedSurface {
  surface: string;
  reason: LaneReasonCode;
  detail: string;
}

/** Per-surface outcome; `families` is present exactly when the surface compared. */
export type Outcome = AggregableOutcome & { families?: GeometryComparison['families'] };

/**
 * Split the surfaces in scope into jobs and declines. A surface with no recipe,
 * or a recipe without `geometryCommand`, is a full `no-geometry-recipe` row —
 * never silently absent, or a partially covered round would aggregate to a
 * whole-design pass.
 */
export function planSurfaceJobs(
  surfaces: readonly string[],
  recipes: ReadonlyMap<string, UiBootRecipe>,
): { jobs: SurfaceJob[]; declined: DeclinedSurface[] } {
  const jobs: SurfaceJob[] = [];
  const declined: DeclinedSurface[] = [];
  for (const surface of surfaces) {
    const recipe = recipes.get(surface);
    if (recipe === undefined) {
      declined.push({
        surface,
        reason: 'no-geometry-recipe',
        detail: `surface '${surface}' has no consumer.uiBoot recipe`,
      });
    } else if (recipe.geometryCommand === undefined) {
      declined.push({
        surface,
        reason: 'no-geometry-recipe',
        detail: `surface '${surface}' has a uiBoot recipe but no geometryCommand`,
      });
    } else {
      jobs.push({
        surface,
        sanitized: sanitizeSurfaceName(surface),
        recipe: recipe as UiBootRecipe & { geometryCommand: string },
      });
    }
  }
  return { jobs, declined };
}

const bySurface = (a: Outcome, b: Outcome): number =>
  a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0;

/** One `notes` row per surface, in surface order — the record of what was computed. */
export function roundRows(outcomes: readonly Outcome[]): string[] {
  return [...outcomes].sort(bySurface).map((o) =>
    o.kind === 'cannot-review'
      ? `[${o.surface}] ${o.reason}: ${o.detail}`
      : `[${o.surface}] ${o.kind}: ${GEOMETRY_FAMILIES.map(
          (f) => `${f} ${o.families?.[f].unmatched ?? 0}/${o.families?.[f].budget ?? 0}`,
        ).join(', ')}`,
  );
}

/** One finding per failing family, pointing at the evidence that explains it. */
export function roundFindings(slug: string, outcomes: readonly Outcome[]): Finding[] {
  return [...outcomes].sort(bySurface).flatMap((o) => {
    if (o.kind !== 'fail' || o.families === undefined) return [];
    const fams = o.families;
    return GEOMETRY_FAMILIES.filter((f) => fams[f].unmatched > fams[f].budget).map((f) => {
      const fam = fams[f];
      const sides = [
        fam.designOnly.length > 0 ? `design-only [${fam.designOnly.join(', ')}]` : '',
        fam.implOnly.length > 0 ? `impl-only [${fam.implOnly.join(', ')}]` : '',
      ]
        .filter((s) => s !== '')
        .join(' ');
      return {
        file: `.noldor/cr/geometry-compare/${slug}/${sanitizeSurfaceName(o.surface)}.report.json`,
        severity: fam.severity,
        message: `[${o.surface}] ${f}: ${fam.unmatched} unmatched > budget ${fam.budget} — ${sides}`,
      };
    });
  });
}

interface GeometryCompareDeps {
  boot: typeof bootServer;
  fetchImpl: typeof fetch;
  resolvePort: typeof resolvePort;
}
let deps: GeometryCompareDeps = { boot: bootServer, fetchImpl: fetch, resolvePort };

/** Test seam — production code never calls this. */
export function setGeometryCompareDeps(partial: Partial<GeometryCompareDeps>): void {
  deps = { ...deps, ...partial };
}

const cannot = (surface: string, reason: LaneReasonCode, detail: string): Outcome => ({
  surface,
  kind: 'cannot-review',
  reason,
  detail,
});

export async function runGeometryCompare(input: LaneInput): Promise<LaneResult> {
  const opened = await openDesignReviewRound(
    input,
    LANE,
    'geometryCompareMode',
    'noldor-geometry-compare',
  );
  if (opened.kind === 'done') return opened.result;
  const { mode } = opened;
  const { write, writeTerminal, design, notes } = opened.ctx;
  const { dir: scratchDir, penPath: scratchPen, designChanged } = opened.ctx.scratch;
  const penModified = (detail: string, rows: string[]): Promise<LaneResult> =>
    writePenModified(write, design.repoRelPath, detail, [...notes, ...rows]);

  try {
    let recipes: Map<string, UiBootRecipe>;
    let declaredSurfaces: string[];
    let verifyCommands: Map<string, ReturnType<typeof loadConsumerConfig>['verifyCommands'][string]>;
    try {
      const consumer = loadConsumerConfig(input.repoRoot);
      // Maps, not raw records: Object.entries copies OWN keys only, so a surface
      // named like an inherited property cannot alias a prototype member.
      recipes = new Map(Object.entries(consumer.uiBoot ?? {}));
      declaredSurfaces = Object.keys(consumer.uiSurfaces ?? {});
      verifyCommands = new Map(Object.entries(consumer.verifyCommands));
    } catch (err) {
      // pen-modified precedence is absolute — checked even on a pre-pipeline
      // terminal, since the reference hash already exists.
      const integrity = await designChanged();
      if (integrity.changed) return penModified(integrity.detail, []);
      return writeTerminal(
        { verdict: 'cannot-review', reason: 'config-unreadable', detail: errMessage(err) },
        notes,
      );
    }

    // Zero AFFECTED surfaces must not aggregate to a "0 surfaces" pass — that
    // would be a blocking-mode bypass for operator-forced sessions. Same
    // whole-design fallback the sibling lanes use.
    let surfaces = design.surfaces;
    if (surfaces.length === 0) {
      surfaces = [...new Set([...declaredSurfaces, ...recipes.keys()])].sort();
      if (surfaces.length === 0) {
        const integrity = await designChanged();
        if (integrity.changed) return penModified(integrity.detail, []);
        return writeTerminal(
          {
            verdict: 'cannot-review',
            reason: 'no-geometry-recipe',
            detail: 'zero affected surfaces resolved and no consumer.uiBoot recipe to fall back to',
          },
          notes,
        );
      }
      notes.push(
        `zero affected surfaces resolved — reviewing every declared surface: ${surfaces.join(', ')}`,
      );
    }

    const { jobs, declined } = planSurfaceJobs(surfaces, recipes);
    const outcomes: Outcome[] = declined.map((d) => cannot(d.surface, d.reason, d.detail));
    const artifacts: RoundArtifact[] = [];
    const workDir = await mkdtemp(join(tmpdir(), 'noldor-geometry-round-'));

    try {
      // One boot per verifyCommand group, surfaces compared inside it.
      const groups = new Map<string, SurfaceJob[]>();
      for (const job of jobs) {
        groups.set(job.recipe.verifyCommand, [...(groups.get(job.recipe.verifyCommand) ?? []), job]);
      }
      const deadline = Date.now() + TOTAL_ROUND_BUDGET_MS;
      for (const [cmdName, groupJobs] of groups) {
        const entry = verifyCommands.get(cmdName);
        if (entry === undefined || entry.kind !== 'server') {
          for (const job of groupJobs) {
            outcomes.push(
              cannot(
                job.surface,
                'boot-failed',
                `verifyCommand '${cmdName}' is ${
                  entry === undefined
                    ? 'missing from consumer.verifyCommands'
                    : `kind "${entry.kind}", not "server"`
                }`,
              ),
            );
          }
          continue;
        }
        let port: number;
        try {
          port = await deps.resolvePort(input.repoRoot);
        } catch (err) {
          for (const job of groupJobs) {
            outcomes.push(cannot(job.surface, 'boot-failed', `no free port: ${errMessage(err)}`));
          }
          continue;
        }
        let boot: Awaited<ReturnType<typeof deps.boot>>;
        try {
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            for (const job of groupJobs) {
              outcomes.push(
                cannot(
                  job.surface,
                  'boot-failed',
                  `round budget (${TOTAL_ROUND_BUDGET_MS}ms) exhausted before this group booted`,
                ),
              );
            }
            continue;
          }
          boot = await deps.boot(entry, port, input.repoRoot, deps.fetchImpl, remaining);
        } catch (err) {
          for (const job of groupJobs) {
            outcomes.push(cannot(job.surface, 'boot-failed', `boot threw: ${errMessage(err)}`));
          }
          continue;
        }
        if (!boot.ok) {
          for (const job of groupJobs) {
            outcomes.push(cannot(job.surface, 'boot-failed', boot.observed));
          }
          continue;
        }
        try {
          for (const job of groupJobs) {
            const url = `http://127.0.0.1:${port}${job.recipe.route}`;
            // A 404 or 500 route must not yield a confident layout verdict
            // against an error page.
            let status: number | null = null;
            let probeErr = '';
            try {
              const res = await deps.fetchImpl(url, {
                signal: AbortSignal.timeout(ROUTE_PROBE_TIMEOUT_MS),
                redirect: 'follow',
              });
              status = res.status;
              await res.body?.cancel().catch(() => {
                /* already consumed or closed */
              });
            } catch (err) {
              probeErr = errMessage(err);
            }
            if (status === null) {
              outcomes.push(
                cannot(job.surface, 'route-unreachable', `GET ${url} got no response: ${probeErr}`),
              );
              continue;
            }
            if (status < 200 || status >= 300) {
              outcomes.push(
                cannot(job.surface, 'route-unreachable', `GET ${url} → ${status} (want 2xx)`),
              );
              continue;
            }
            const result = await reviewSurfaceGeometry({
              penPath: scratchPen,
              surface: job.surface,
              ...(job.recipe.page !== undefined ? { pageSelector: job.recipe.page } : {}),
              url,
              geometryCommand: job.recipe.geometryCommand,
              outDir: workDir,
              implPath: join(workDir, `${job.sanitized}.impl.json`),
              repoRoot: input.repoRoot,
              captureTimeoutMs: job.recipe.captureTimeoutMs,
              tolerance: job.recipe.geometryTolerance,
              budget: job.recipe.geometryBudget,
              ...(input.dispatchTimeoutMs !== undefined
                ? { dispatchTimeoutMs: input.dispatchTimeoutMs }
                : {}),
            });
            if (result.kind === 'declined') {
              outcomes.push(cannot(job.surface, result.reason, result.detail));
              continue;
            }
            if (result.excluded.length > 0) {
              notes.push(
                `[${job.surface}] clipped design nodes excluded: ${result.excluded.join(', ')}`,
              );
            }
            artifacts.push(
              {
                name: `${job.sanitized}.design.json`,
                body: JSON.stringify(result.design, null, 1),
              },
              { name: `${job.sanitized}.impl.json`, body: JSON.stringify(result.impl, null, 1) },
              {
                name: `${job.sanitized}.report.json`,
                body: JSON.stringify(result.comparison, null, 1),
              },
            );
            outcomes.push({
              surface: job.surface,
              kind: result.comparison.verdict,
              families: result.comparison.families,
            });
          }
        } finally {
          // Fire-and-forget: every group boots on its own ephemeral port, so a
          // dying predecessor cannot contend with the next boot.
          boot.kill();
        }
      }
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {
        /* losing a tmpdir costs disk; the sink is already the record */
      });
    }

    const rows = roundRows(outcomes);
    const swap = await swapRoundArtifacts(
      join(input.repoRoot, '.noldor', 'cr', 'geometry-compare'),
      input.slug,
      artifacts,
    );

    // pen-modified precedence is absolute (spec D7) — before any other verdict.
    const integrity = await designChanged();
    if (integrity.changed) return penModified(integrity.detail, rows);

    if (!swap.ok) {
      // A verdict whose evidence could not be written is not auditable, so it
      // must not read as a clean pass or fail.
      return writeTerminal(
        {
          verdict: 'cannot-review',
          reason: 'persist-failed',
          detail: `evidence unavailable: ${swap.detail}`,
        },
        [...notes, ...rows],
      );
    }

    const agg = aggregateOutcomes(outcomes);
    if (agg.verdict === 'pass') {
      return write(
        {
          verdict: 'pass',
          blockers: [],
          suggestions: [],
          summary: `every family within budget (${outcomes.length} surface${outcomes.length === 1 ? '' : 's'})`,
          notes: [...notes, ...rows],
        },
        true,
      );
    }
    if (agg.verdict === 'cannot-review') {
      const reds = mode === 'blocking';
      return write(
        {
          verdict: 'cannot-review',
          reason: agg.reason,
          blockers: reds
            ? [
                {
                  file: input.artifact,
                  severity: 'high',
                  message: `${agg.reason}: ${agg.detail ?? 'geometry-compare could not review'}`,
                },
              ]
            : [],
          suggestions: [],
          summary: `cannot-review: ${agg.reason}`,
          notes: [...notes, ...rows],
        },
        !reds,
      );
    }
    return writeFailByMode(
      write,
      mode,
      roundFindings(input.slug, outcomes),
      'implemented layout drifts from the design',
      [...notes, ...rows],
    );
  } catch (err) {
    // A round must never terminate without its sink; pen-modified precedence
    // holds even here.
    const integrity = await designChanged();
    if (integrity.changed) {
      return penModified(
        integrity.detail || `during unexpected pipeline failure: ${errMessage(err)}`,
        [],
      );
    }
    return writeTerminal(
      {
        verdict: 'cannot-review',
        reason: 'dispatch-failed',
        detail: `unexpected pipeline failure: ${errMessage(err)}`,
      },
      notes,
    );
  } finally {
    await cleanupPenScratch(scratchDir, 'geometry-compare');
  }
}
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/lanes/geometry-compare.test.ts
```

Expected output: `Test Files 1 passed`, `Tests 4 passed`.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/geo-p6t1.msg <<'MSG'
feat(cr): add the geometry-compare lane

Why — the per-surface comparison already works and is hand-runnable, but a CR
round has to answer for every surface a diff affects, and that is a different
job: resolve the scope, boot the app once per verifyCommand group, keep a row
for every surface including the ones it could not review, persist the evidence
durably, and turn the rows into one verdict under the advisory-or-blocking knob.

How — an orchestration shell, deliberately thin. openDesignReviewRound owns the
sink, the mode, target resolution and scratch integrity; reviewSurfaceGeometry
owns the comparison; aggregateOutcomes owns precedence. What the lane decides is
scope and booting: a surface with no recipe or no geometryCommand still lands a
no-geometry-recipe row so partial coverage cannot read as a whole-design pass, a
zero-affected-surface round falls back to every declared surface rather than
passing on emptiness, a non-2xx route declines instead of comparing against an
error page, and pen-modified outranks every other outcome including an
unexpected throw.

What — src/cr/lanes/geometry-compare.ts with runGeometryCompare, planSurfaceJobs,
roundRows and roundFindings, plus tests over surface planning, the per-surface
rows, and one finding per failing family naming its evidence file.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/lanes/geometry-compare.ts src/cr/__tests__/lanes/geometry-compare.test.ts
git commit -F /tmp/geo-p6t1.msg
```

---

## Task 2: Wire it into orchestrate

**Files:**
- Modify: `src/cr/orchestrate.ts`
- Test: `src/cr/__tests__/orchestrate.test.ts`

- [ ] **Step 1: Write the failing test.** Add to `src/cr/__tests__/orchestrate.test.ts`:

```ts
describe('geometry-compare in the lane pipeline', () => {
  it('is a runnable code-only lane exempt from the empty-delta short-circuit', async () => {
    const { LANES, NO_DELTA_SHORTCIRCUIT, CODE_ONLY_LANES, BOOTING_LANES } = await import('../orchestrate.js');
    expect(typeof LANES['geometry-compare']).toBe('function');
    expect(NO_DELTA_SHORTCIRCUIT.has('geometry-compare')).toBe(true);
    expect(CODE_ONLY_LANES).toContain('geometry-compare');
  });

  it('orders the app-booting lanes so no two boot at once', async () => {
    const { BOOTING_LANES } = await import('../orchestrate.js');
    expect([...BOOTING_LANES]).toEqual(['verifier', 'render-compare', 'geometry-compare']);
  });
});
```

If `orchestrate.ts` does not export those four values today, export them rather than duplicating the literals in the test — a test asserting its own copy of a list proves nothing.

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts -t 'geometry-compare in the lane pipeline'
```

Expected output: both cases fail — `LANES['geometry-compare']` is undefined and `BOOTING_LANES` does not exist.

- [ ] **Step 3: Register the runner.** In `src/cr/orchestrate.ts`, add `import { runGeometryCompare } from './lanes/geometry-compare.js';`, add `'geometry-compare': runGeometryCompare,` to the `LANES` map, add the lane to `NO_DELTA_SHORTCIRCUIT`, and extract the existing `['verifier', 'ui-reviewer', 'render-compare']` literal into an exported `CODE_ONLY_LANES` that also carries `'geometry-compare'`.

- [ ] **Step 4: Sequence the boots.** Replace the two-pass launch block (the `render-compare` / `verifierRun` special case) with an explicit chain:

```ts
/**
 * Lanes that boot the consumer's `verifyCommands` server, in the order they must
 * run. Distinct ports do NOT make concurrent boots safe: two dev servers over
 * one project directory contend on the same build cache (`.next`, vite's dep
 * cache), so these run as a chain while every other lane still launches
 * concurrently. A lane absent from the round contributes no link.
 */
export const BOOTING_LANES: readonly Lane[] = ['verifier', 'render-compare', 'geometry-compare'];
```

```ts
  const promises: Promise<LaneResult>[] = Array.from({ length: effective.length });
  for (let i = 0; i < effective.length; i++) {
    if (BOOTING_LANES.includes(effective[i])) continue;
    promises[i] = launch(effective[i]);
  }
  let previous: Promise<LaneResult> | undefined;
  for (const lane of BOOTING_LANES) {
    const i = effective.indexOf(lane);
    if (i < 0) continue;
    const start = (): Promise<LaneResult> => launch(lane);
    // `.then(start, start)` on purpose: the next lane starts when the previous
    // RESOLVES either way — a failed verifier must not strand the round.
    promises[i] = previous === undefined ? start() : previous.then(start, start);
    previous = promises[i];
  }
```

- [ ] **Step 5: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/orchestrate.test.ts && pnpm typecheck && pnpm lint
```

Expected output: every orchestrate case passes — including the pre-existing render-compare-after-verifier ordering case — and typecheck is clean, resolving the exhaustiveness error part 5 Task 1 introduced.

- [ ] **Step 6: Commit.**

```bash
cat > /tmp/geo-p6t2.msg <<'MSG'
feat(cr): run geometry-compare from orchestrate, chained after the boots

Why — a lane absent from the runner map cannot be selected, so this is what
makes the slice usable. It is also where a real hazard lives: verifier,
render-compare and geometry-compare all boot the consumer's verifyCommands
server, and the previous wiring chained only render-compare off the verifier. A
second lane chained off the same promise would run concurrently with
render-compare, and distinct ports do not help — two dev servers over one
project directory contend on the same build cache.

How — the app-booting lanes become an explicit ordered chain, each starting when
the previous resolves either way so a failed verifier cannot strand the round,
while every other lane still launches concurrently. The lane also joins the
empty-delta short-circuit exemption and the code-only list, both of which move
to exported constants so the tests assert the real values.

What — the runner-map entry, exported CODE_ONLY_LANES and BOOTING_LANES, the
rewritten launch sequencing in src/cr/orchestrate.ts, and orchestrate tests for
registration and ordering.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/orchestrate.ts src/cr/__tests__/orchestrate.test.ts
git commit -F /tmp/geo-p6t2.msg
```

---

## Task 3: Document the lane for adoption

**Files:**
- Modify: `docs/noldor/cr-pipeline.md`, `templates/docs/noldor/cr-pipeline.md`, `docs/features/ui-design-review-lane.md`

- [ ] **Step 1: Add the pipeline section.** In `docs/noldor/cr-pipeline.md`, immediately after the `render-compare` lane section, add:

```markdown
### The `geometry-compare` lane (code artifacts only)

The third mechanical design lane, and the one to reach for when the design cannot
be pixel-faithful — SVG-driven effects, shaders, generated artwork, platform text
rendering. Instead of diffing rasters it compares **layout values**: alignment
edges, font sizes, and declared spacing.

- **Design side:** a dispatched `geometry-extract` child opens the scratch `.pen`
  through pencil MCP and walks the selected `FINAL:` page with a `Get` visitor,
  reporting each node's resolved box (`Ctx.bounds` accumulated up `parentCtx`,
  page origin subtracted), its `fontSize` when it is text, and its `gap`/`padding`
  when it is a frame. Page selection is recomputed Node-side from the child's
  reported candidates.
- **Implementation side:** the consumer's `geometryCommand` renders the route in
  their own browser tool and writes the same normalized document. `noldor init`
  scaffolds a reference Playwright producer at `scripts/geometry-capture.mjs`,
  which is yours to edit.
- **Comparison:** per family, each side's values cluster by single linkage at the
  family's tolerance, then clusters match optimally (order-preserving DP,
  maximizing pairs then minimizing total difference). Leftovers are unmatched. A
  family fails when its unmatched count exceeds its budget — all budgets default
  to 0. `edges` and `fontSize` count both directions; **`spacing` counts
  design-only leftovers only**, so an implementation `margin` can satisfy a design
  `gap` while UA-stylesheet margins and negative gutters cannot fail anything.
- **Sink:** `.noldor/cr/<slug>-code-geometry-compare.json`, one finding per
  failing family. **Evidence:**
  `.noldor/cr/geometry-compare/<slug>/<surface>.{design,impl,report}.json` — open
  the report before arguing with a count; it lists the nodes behind every
  unmatched value.
- **Mode:** `autonomous.geometryCompareMode` (`advisory` default, `blocking`
  available); `pen-modified` reds in both. Reason codes for a round that could not
  compare: `no-geometry-recipe`, `geometry-extract-failed`,
  `geometry-capture-failed`, `geometry-unparseable`, `geometry-empty`,
  `viewport-mismatch`. An ordinary layout mismatch carries no reason code — it is
  a `fail` with findings.
- **Ordering:** `verifier` → `render-compare` → `geometry-compare` run as a chain,
  never concurrently: they boot the same server and two dev servers over one
  project directory contend on the same build cache.

Opt in:

```jsonc
{
  "crLanes": { "code": ["reviewer", "geometry-compare"] },
  "autonomous": { "geometryCompareMode": "advisory" },
  "consumer": {
    "uiBoot": {
      "dashboard": {
        "verifyCommand": "dev",
        "route": "/dashboard",
        "geometryCommand": "node scripts/geometry-capture.mjs {url} {out} {width} {height}",
        "geometryTolerance": { "edges": 2, "fontSize": 1, "spacing": 1 },
        "geometryBudget": { "edges": 0, "fontSize": 0, "spacing": 0 }
      }
    }
  }
}
```

Three commands reproduce any part of it by hand: `design geometry-export` (design
side), `design geometry-validate` (a capture script's output), and
`design geometry-review` (a whole surface against a running app).
```

- [ ] **Step 2: Mirror it into the template twin.** Copy the identical block into `templates/docs/noldor/cr-pipeline.md` at the same position, then verify:

```bash
pnpm noldor checks template-sync
```

Expected output: exit 0 — no templated file differs from its `templates/` copy.

- [ ] **Step 3: Add the FD's Usage section.** In `docs/features/ui-design-review-lane.md`, after the render-compare Usage subsection, add a `**Geometry-compare (layout sibling).**` paragraph carrying the same opt-in snippet, the three hand-run commands, the one-directional spacing rule, and the evidence path — the FD is what a consumer reads first, so it must state the spacing asymmetry rather than leaving it to the pipeline doc.

- [ ] **Step 4: Refresh the FD's link lists.** Do not hand-edit `links.code` / `links.tests` on this FD — it is tag-driven (`// @tests: ui-design-review-lane`). Run the sync, then check it only touched this FD:

```bash
pnpm noldor sync code-links
git diff --stat docs/features/
```

Expected output: only `docs/features/ui-design-review-lane.md` changed. If any other FD appears in the diff, revert those files (`git checkout -- docs/features/<other>.md`) — the sync is repo-wide and has previously dropped hand-listed links on unrelated FDs.

- [ ] **Step 5: Verify the whole surface.**

```bash
pnpm verify && pnpm noldor doctor
```

Expected output: `pnpm verify` exits 0 — it is the repo's own chain (lint, `fmt:check`, typecheck, the full test run, triage refs) — and `doctor` reports no new red (a missing `gh` binary is the one pre-existing exception).

- [ ] **Step 6: Commit.**

```bash
cat > /tmp/geo-p6t3.msg <<'MSG'
docs(features:ui-design-review-lane): document the geometry-compare lane

Why — the lane is only adoptable if a consumer can find out what it compares,
what it cannot see, and how to opt in. Two facts especially need stating where
someone will read them: spacing is compared one-directionally, so an
implementation-only spacing value never fails, and the lane reports drift in the
population of layout values rather than per-element position, so a node
relocating onto an alignment value the surface already uses is invisible to it.

How — a cr-pipeline section covering both sides of the comparison, the
clustering and matching rule, the per-family budgets, the reason codes, the
evidence paths, the boot ordering, and the opt-in snippet, mirrored into the
template twin so template-sync stays green. The FD gains a Usage paragraph with
the same opt-in plus the three commands that reproduce any part of the lane by
hand, and its tag-driven link lists are refreshed by sync rather than by hand.

What — docs/noldor/cr-pipeline.md and its templates/ twin, the FD's Usage
section, and its regenerated links.

Noldor-FD: ui-design-review-lane
Noldor-Sibling-Scope: noldor:cr-pipeline
MSG
git add docs/noldor/cr-pipeline.md templates/docs/noldor/cr-pipeline.md docs/features/ui-design-review-lane.md
git commit -F /tmp/geo-p6t3.msg
```
