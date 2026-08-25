# Geometry Compare Lane — Part 5: Lane Registration + `design geometry-review` Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Ship the per-surface comparison as one function behind a CLI — `pnpm noldor design geometry-review --pen <f> --surface <s> --url <u> --capture <tpl>` compares a running app against its design and reports per-family drift — and register the lane identity (canonical lane, mode knob, reason codes) that part 6's lane will use.
**Architecture:** Registration touches the four places a lane's identity lives. Two pieces of `render-compare` are lifted to shared modules rather than copied. `reviewSurfaceGeometry` then composes parts 1–4 into the whole per-surface sequence, taking a URL instead of booting anything — which is what makes it both hand-runnable now and reusable by the lane in part 6.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod 3, vitest.

**Depends on:** parts 1–4.

---

## File Structure

- `src/core/lanes.ts` — `geometry-compare` in `CANONICAL_LANES` (Modify).
- `src/cr/lane-mode.ts`, `src/core/config.ts` — the `geometryCompareMode` knob (Modify).
- `src/cr/findings-schema.ts` — six reason codes (Modify).
- `src/cr/lanes/round-artifacts.ts` — the atomic evidence-directory swap, lifted out of `render-compare.ts` (Create).
- `src/cr/lanes/capture.ts` — `runCapture`, lifted out of `render-compare.ts` (Create).
- `src/cr/lanes/render-compare-core.ts` — `aggregateOutcomes` generalized over the outcome payload (Modify).
- `src/cr/lanes/render-compare.ts` — use both lifted pieces (Modify).
- `src/cr/geometry/geometry-review.ts` — `reviewSurfaceGeometry`: design read → capture → compare, or a decline carrying a reason code (Create).
- `src/cr/geometry/geometry-review-cli.ts` — `noldor design geometry-review` (Create).
- `src/cli/manifest.ts`, `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md` — the command's row and its twinned catalog entry (Modify).
- Tests: `src/cr/__tests__/lanes/geometry-registration.test.ts`, `src/cr/__tests__/lanes/round-artifacts.test.ts`, `src/cr/__tests__/geometry/geometry-review.test.ts`.

---

## Task 1: Register the lane, the knob, and the reason codes

**Files:**
- Modify: `src/core/lanes.ts`, `src/cr/lane-mode.ts`, `src/core/config.ts`, `src/cr/findings-schema.ts`
- Test: `src/cr/__tests__/lanes/geometry-registration.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/lanes/geometry-registration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { autonomousConfigSchema } from '../../../core/config.js';
import { LANE_NAMES, laneSchema } from '../../../core/lanes.js';
import { laneReasonCodeSchema } from '../../findings-schema.js';

describe('geometry-compare registration', () => {
  it('is a canonical lane', () => {
    expect(LANE_NAMES).toContain('geometry-compare');
    expect(laneSchema.safeParse('geometry-compare').success).toBe(true);
  });

  it('adds the mode knob with an advisory default', () => {
    expect(autonomousConfigSchema.parse({}).geometryCompareMode).toBe('advisory');
    expect(autonomousConfigSchema.safeParse({ geometryCompareMode: 'blocking' }).success).toBe(true);
    expect(autonomousConfigSchema.safeParse({ geometryCompareMode: 'sometimes' }).success).toBe(false);
  });

  it('adds one reason code per declining stage', () => {
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

Adjust the import path of `autonomousConfigSchema` to whatever `src/core/config.ts` exports for the `autonomous` block if the name differs.

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/lanes/geometry-registration.test.ts
```

Expected output: all three cases fail — the lane, the knob, and the codes do not exist.

- [ ] **Step 3: Add the lane.** In `src/core/lanes.ts`, append to `CANONICAL_LANES` after `'render-compare'`:

```ts
  // Code-only mechanical sibling of `render-compare`: boots the consumer's app
  // and compares LAYOUT — alignment edges, font sizes, declared spacing —
  // against the session's `.pen`, for surfaces whose design cannot be
  // pixel-faithful. Its one agent role is the MCP-mediated geometry reader.
  'geometry-compare',
```

- [ ] **Step 4: Add the mode knob.** In `src/cr/lane-mode.ts`, widen the `key` union to include `'geometryCompareMode'`. In `src/core/config.ts`, add to the `autonomous` block after `renderCompareMode`:

```ts
  // Governs the geometry-compare lane's review outcomes only — a third knob
  // because an adopter's confidence in a pixel diff and in a layout-value diff
  // diverge. Same posture: advisory default, `pen-modified` reds in BOTH modes.
  geometryCompareMode: z.enum(['blocking', 'advisory']).default('advisory'),
```

- [ ] **Step 5: Add the reason codes.** In `src/cr/findings-schema.ts`, add to `laneReasonCodeSchema` after the render-compare block:

```ts
  // cannot-review classes owned by the geometry-compare lane (spec D7), one per
  // stage that can decline. An ordinary layout mismatch carries NO reason code —
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
pnpm vitest run src/cr/__tests__/lanes/geometry-registration.test.ts && pnpm typecheck
```

Expected output: `Tests 3 passed`; typecheck fails only in `src/cr/orchestrate.ts`, where `LANES` must now be exhaustive over the lane union — Task 4 fixes it. Note the error and continue.

- [ ] **Step 7: Commit.**

```bash
cat > /tmp/geo-p5t1.msg <<'MSG'
feat(cr): register the geometry-compare lane, knob and reason codes

Why — every lane's identity lives in four places: the canonical lane list, the
mode-key union, the autonomous config block, and the closed reason vocabulary.
Registering them together keeps a half-registered lane from existing, where a
config could name a lane the runtime cannot resolve or a sink could carry a
reason validation would reject.

How — geometry-compare joins CANONICAL_LANES, geometryCompareMode joins the
mode-key union and the autonomous schema with the same fail-soft advisory
default its two siblings use, and six reason codes join the enum — one per
pipeline stage that can decline, deliberately excluding the ordinary layout
mismatch, which is a fail with findings rather than a cannot-review with a
reason.

What — the lane literal, the knob, the six codes, and a registration test that
pins each of the four surfaces.

Noldor-FD: ui-design-review-lane
MSG
git add src/core/lanes.ts src/cr/lane-mode.ts src/core/config.ts src/cr/findings-schema.ts src/cr/__tests__/lanes/geometry-registration.test.ts
git commit -F /tmp/geo-p5t1.msg
```

---

## Task 2: Lift the two shared pieces out of `render-compare`

**Files:**
- Create: `src/cr/lanes/round-artifacts.ts`
- Modify: `src/cr/lanes/render-compare.ts`, `src/cr/lanes/render-compare-core.ts`
- Test: `src/cr/__tests__/lanes/round-artifacts.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/lanes/round-artifacts.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { swapRoundArtifacts } from '../../lanes/round-artifacts.js';

describe('swapRoundArtifacts', () => {
  it('replaces the round directory atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'round-art-'));
    const final = join(root, 'slug');
    await mkdir(final, { recursive: true });
    await writeFile(join(final, 'old.json'), 'old', 'utf8');
    const r = await swapRoundArtifacts(root, 'slug', [{ name: 'new.json', body: 'new' }]);
    expect(r.ok).toBe(true);
    expect(await readdir(final)).toEqual(['new.json']);
    expect(await readFile(join(final, 'new.json'), 'utf8')).toBe('new');
  });

  it('leaves the prior round in place when handed nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'round-art-'));
    const final = join(root, 'slug');
    await mkdir(final, { recursive: true });
    await writeFile(join(final, 'old.json'), 'old', 'utf8');
    const r = await swapRoundArtifacts(root, 'slug', []);
    expect(r.ok).toBe(true);
    expect(await readdir(final)).toEqual(['old.json']);
  });

  it('reports a failure detail instead of throwing', async () => {
    const r = await swapRoundArtifacts('/proc/nonexistent-root', 'slug', [
      { name: 'a.json', body: 'a' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).not.toBe('');
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/lanes/round-artifacts.test.ts
```

Expected output: collection error — `Failed to resolve import "../../lanes/round-artifacts.js"`.

- [ ] **Step 3: Implement the shared swap.** Create `src/cr/lanes/round-artifacts.ts`:

```ts
// @tests: ui-design-review-lane
// The evidence-directory swap both mechanical design lanes need: stage this
// round's files in a temp dir, move the prior round ASIDE, then move the new set
// in — so a failure between the two renames still leaves ONE complete set on
// disk rather than a mixture. Lifted out of `render-compare.ts` when
// `geometry-compare` needed the same guarantee for JSON instead of PNGs; a
// second copy would have been a clones-ratchet hit AND a place for the two
// lanes' durability rules to drift.

import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { errMessage } from '../../core/err-message.js';

/** One evidence file: a name inside the round directory and its bytes. */
export interface RoundArtifact {
  name: string;
  body: string | Buffer;
}

export type SwapResult = { ok: true } | { ok: false; detail: string };

/**
 * Replace `<root>/<slug>` with `artifacts`. An EMPTY list is a no-op that
 * preserves the prior round: a round which produced no evidence must not
 * destroy the previous one to record nothing, and its sink references no file
 * either way.
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
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {
      /* best-effort */
    });
    // trashDir may be the ONLY surviving set when both renames failed — remove
    // it only when finalDir still holds one.
    if (existsSync(finalDir)) {
      await rm(trashDir, { recursive: true, force: true }).catch(() => {
        /* best-effort */
      });
    }
    return { ok: false, detail: errMessage(err) };
  }
}
```

- [ ] **Step 4: Use it from `render-compare.ts`.** Replace the body of `persistJobs` and its surrounding try/catch (the `artifactRoot` / `tmpDir` / `trashDir` block) with a call:

```ts
    const artifactRoot = join(input.repoRoot, '.noldor', 'cr', 'render-compare');
    let persistFailure: string | null = null;
    if (jobs.length > 0) {
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
      const swap = await swapRoundArtifacts(artifactRoot, input.slug, artifacts);
      if (!swap.ok) {
        persistFailure = swap.detail;
        notes.push(`artifact persist failed: ${persistFailure}`);
      }
    }
```

Add `import { swapRoundArtifacts, type RoundArtifact } from './round-artifacts.js';` and drop the now-unused `existsSync` / `rename` / `rm` imports if nothing else in the file uses them.

- [ ] **Step 5: Generalize the aggregate.** In `src/cr/lanes/render-compare-core.ts`, change `aggregateOutcomes` to accept any outcome carrying the three fields it reads, so the geometry lane's differently-shaped outcomes reuse the rule rather than copying it:

```ts
/** The only fields aggregation reads — every lane's outcome type structurally satisfies this. */
export interface AggregableOutcome {
  surface: string;
  kind: 'pass' | 'fail' | 'cannot-review';
  reason?: LaneReasonCode;
  detail?: string;
}

export function aggregateOutcomes(outcomes: readonly AggregableOutcome[]): Aggregated {
  if (outcomes.some((o) => o.kind === 'fail')) return { verdict: 'fail' };
  const cannots = outcomes
    .filter((o) => o.kind === 'cannot-review')
    .sort((a, b) => (a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0));
  if (cannots.length > 0) {
    return { verdict: 'cannot-review', reason: cannots[0].reason, detail: cannots[0].detail };
  }
  return { verdict: 'pass' };
}
```

- [ ] **Step 6: Run everything and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/lanes && pnpm typecheck
```

Expected output: the new suite passes, the existing `render-compare` suites still pass unchanged, and typecheck reports only the orchestrate exhaustiveness error from Task 1.

- [ ] **Step 7: Check the clones ratchet.**

```bash
pnpm noldor clones check | head -20
```

Expected output: no new duplicated group — the lift removed the copy this task existed to avoid.

- [ ] **Step 8: Commit.**

```bash
cat > /tmp/geo-p5t2.msg <<'MSG'
feat(cr): lift the round-evidence swap and generalize the aggregate

Why — the geometry lane needs exactly two things render-compare already has: a
durable evidence-directory replacement whose failure modes are already
arbitrated (never leave a mixed set; an empty round must not destroy the prior
one), and the worst-outcome-wins aggregation rule. Copying either would be a
clones-ratchet hit and, worse, a place for two lanes' durability and precedence
rules to drift apart.

How — the tmp-then-trash-then-swap sequence moves into round-artifacts.ts as a
function over a name-and-bytes list, returning a result rather than throwing so
the caller can degrade to cannot-review; render-compare now calls it and keeps
its own PNG assembly. aggregateOutcomes takes a structural type carrying only
the three fields it reads, so each lane keeps its own payload while sharing the
rule.

What — src/cr/lanes/round-artifacts.ts, render-compare.ts switched over to it,
AggregableOutcome in render-compare-core.ts, and tests for the swap covering
replacement, the empty no-op, and a failure reported as a detail.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/lanes/round-artifacts.ts src/cr/lanes/render-compare.ts src/cr/lanes/render-compare-core.ts src/cr/__tests__/lanes/round-artifacts.test.ts
git commit -F /tmp/geo-p5t2.msg
```

---

## Task 3: `noldor design geometry-review`

**Files:**
- Create: `src/cr/geometry/geometry-review.ts`, `src/cr/geometry/geometry-review-cli.ts`
- Modify: `src/cr/lanes/render-compare.ts`, `src/cli/manifest.ts`, `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`
- Create: `src/cr/lanes/capture.ts`
- Test: `src/cr/__tests__/geometry/geometry-review.test.ts`

- [ ] **Step 1: Lift the capture helper.** `runCapture` lives inside `src/cr/lanes/render-compare.ts` and is not exported. Move it verbatim into a new `src/cr/lanes/capture.ts`, exporting the function and its `CaptureResult` interface, and import it back into `render-compare.ts`. Same lift-instead-of-copy reasoning as Task 2: both the review function below and the lane in part 6 run a consumer capture command.

```bash
pnpm vitest run src/cr/__tests__/lanes && pnpm typecheck
```

Expected output: every existing lane suite still passes and typecheck is clean apart from the orchestrate exhaustiveness error from Task 1.

- [ ] **Step 2: Write the failing test.** Create `src/cr/__tests__/geometry/geometry-review.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { reviewSurfaceGeometry, setGeometryReviewDeps } from '../../geometry/geometry-review.js';
import { setGeometryExtractDispatcher } from '../../lanes/geometry-extract-dispatch.js';

const dir = await mkdtemp(join(tmpdir(), 'geo-review-'));
const pen = join(dir, 'design.pen');
await writeFile(pen, 'encrypted', 'utf8');

const doc = (surface: string, x: number): unknown => ({
  surface,
  viewport: { width: 1440, height: 900 },
  nodes: [{ kind: 'shape', box: { x, y: 0, w: 100, h: 40 } }],
});

afterEach(() => {
  setGeometryExtractDispatcher(undefined);
  setGeometryReviewDeps({ capture: undefined });
});

const stubExtract = (x: number): void => {
  setGeometryExtractDispatcher(async (input) => {
    await writeFile(input.requests[0].outPath, JSON.stringify(doc('dashboard', x)), 'utf8');
    return '```json\n{"surfaces":[{"surface":"dashboard","candidates":["overview"]}]}\n```';
  });
};

describe('reviewSurfaceGeometry', () => {
  it('passes when the captured layout matches the design', async () => {
    stubExtract(24);
    setGeometryReviewDeps({
      capture: async (_cmd, _cwd, _ms) => {
        await writeFile(join(dir, 'impl.json'), JSON.stringify(doc('dashboard', 24)), 'utf8');
        return { code: 0, timedOut: false, stderrTail: '' };
      },
    });
    const r = await reviewSurfaceGeometry({
      penPath: pen,
      surface: 'dashboard',
      url: 'http://127.0.0.1:5173/dashboard',
      geometryCommand: 'node cap.mjs {url} {out} {width} {height}',
      outDir: dir,
      implPath: join(dir, 'impl.json'),
      repoRoot: dir,
    });
    expect(r.kind).toBe('compared');
    if (r.kind === 'compared') expect(r.comparison.verdict).toBe('pass');
  });

  it('fails and names the impl-only edge when the layout drifts', async () => {
    stubExtract(24);
    setGeometryReviewDeps({
      capture: async () => {
        await writeFile(join(dir, 'impl.json'), JSON.stringify(doc('dashboard', 30)), 'utf8');
        return { code: 0, timedOut: false, stderrTail: '' };
      },
    });
    const r = await reviewSurfaceGeometry({
      penPath: pen,
      surface: 'dashboard',
      url: 'http://127.0.0.1:5173/dashboard',
      geometryCommand: 'node cap.mjs {url} {out} {width} {height}',
      outDir: dir,
      implPath: join(dir, 'impl.json'),
      repoRoot: dir,
    });
    expect(r.kind).toBe('compared');
    if (r.kind === 'compared') {
      expect(r.comparison.verdict).toBe('fail');
      expect(r.comparison.families.edges.implOnly).toContain(30);
    }
  });

  it('declines with viewport-mismatch rather than comparing mismatched boxes', async () => {
    stubExtract(24);
    setGeometryReviewDeps({
      capture: async () => {
        await writeFile(
          join(dir, 'impl.json'),
          JSON.stringify({ ...(doc('dashboard', 24) as object), viewport: { width: 1280, height: 900 } }),
          'utf8',
        );
        return { code: 0, timedOut: false, stderrTail: '' };
      },
    });
    const r = await reviewSurfaceGeometry({
      penPath: pen,
      surface: 'dashboard',
      url: 'http://127.0.0.1:5173/dashboard',
      geometryCommand: 'node cap.mjs {url} {out} {width} {height}',
      outDir: dir,
      implPath: join(dir, 'impl.json'),
      repoRoot: dir,
    });
    expect(r.kind).toBe('declined');
    if (r.kind === 'declined') expect(r.reason).toBe('viewport-mismatch');
  });

  it('declines with geometry-capture-failed when the capture command exits non-zero', async () => {
    stubExtract(24);
    setGeometryReviewDeps({
      capture: async () => ({ code: 3, timedOut: false, stderrTail: 'boom' }),
    });
    const r = await reviewSurfaceGeometry({
      penPath: pen,
      surface: 'dashboard',
      url: 'http://127.0.0.1:5173/dashboard',
      geometryCommand: 'node cap.mjs {url} {out} {width} {height}',
      outDir: dir,
      implPath: join(dir, 'missing.json'),
      repoRoot: dir,
    });
    expect(r.kind).toBe('declined');
    if (r.kind === 'declined') expect(r.reason).toBe('geometry-capture-failed');
  });
});
```

- [ ] **Step 3: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-review.test.ts
```

Expected output: collection error — `Failed to resolve import "../../geometry/geometry-review.js"`.

- [ ] **Step 4: Implement the shared review function.** Create `src/cr/geometry/geometry-review.ts`:

```ts
// @tests: ui-design-review-lane
// One surface, one comparison: read the design through pencil MCP, run the
// consumer's capture command against a URL, and compare the two documents. The
// lane (part 6) calls this per surface after booting the app; the CLI beside it
// calls it once against an app the operator already has running. Both get the
// same reason codes, so a hand-run answer and a lane row cannot disagree.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { errMessage } from '../../core/err-message.js';
import { sanitizeSurfaceName } from '../../core/ui-boot.js';
import type { LaneReasonCode } from '../findings-schema.js';
import {
  dispatchGeometryExtract,
  GeometryExtractError,
  parseGeometryExtractReport,
} from '../lanes/geometry-extract-dispatch.js';
import { runCapture } from '../lanes/capture.js';
import { selectFinalPage, substituteScreenshotCommand } from '../lanes/render-compare-core.js';
import {
  compareGeometry,
  DEFAULT_BUDGET,
  DEFAULT_TOLERANCE,
  type FamilyRecord,
  type GeometryComparison,
} from './geometry-compare-core.js';
import { parseGeometryDoc, type GeometryDoc } from './geometry-doc.js';

/** Byte ceiling before a producer's document is read into memory. */
const MAX_DOC_BYTES = 32 * 1024 * 1024;
/** Viewports may differ by less than a pixel (rounding), never more (spec D4). */
const VIEWPORT_EPSILON = 1;

export interface ReviewSurfaceInput {
  /** Scratch COPY of the design — never the repo's own file. */
  penPath: string;
  surface: string;
  /** `FINAL:<surface>: <name>` selector, when the surface has several pages. */
  pageSelector?: string;
  /** Where the implementation renders — already booted by the caller. */
  url: string;
  geometryCommand: string;
  /** Directory the design document is written into. */
  outDir: string;
  /** Path the capture command must write the implementation document to. */
  implPath: string;
  repoRoot: string;
  captureTimeoutMs?: number;
  tolerance?: FamilyRecord<number>;
  budget?: FamilyRecord<number>;
  dispatchTimeoutMs?: number;
}

export type ReviewSurfaceResult =
  | {
      kind: 'compared';
      comparison: GeometryComparison;
      design: GeometryDoc;
      impl: GeometryDoc;
      /** Design nodes pen reported clipped and the child therefore dropped. */
      excluded: string[];
    }
  | { kind: 'declined'; reason: LaneReasonCode; detail: string };

interface ReviewDeps {
  capture: typeof runCapture;
}
let deps: ReviewDeps = { capture: runCapture };

/** Test seam — production code never calls this. Passing `undefined` restores the default. */
export function setGeometryReviewDeps(partial: { capture?: typeof runCapture }): void {
  deps = { capture: partial.capture ?? runCapture };
}

/** Sub-pixel tolerance on the viewport; anything larger makes every edge drift. */
export const viewportsAgree = (
  a: { width: number; height: number },
  b: { width: number; height: number },
): boolean =>
  Math.abs(a.width - b.width) <= VIEWPORT_EPSILON && Math.abs(a.height - b.height) <= VIEWPORT_EPSILON;

export async function reviewSurfaceGeometry(input: ReviewSurfaceInput): Promise<ReviewSurfaceResult> {
  const designPath = join(input.outDir, `${sanitizeSurfaceName(input.surface)}.design.json`);
  let raw: string;
  try {
    raw = await dispatchGeometryExtract({
      penPath: input.penPath,
      requests: [
        {
          surface: input.surface,
          ...(input.pageSelector !== undefined ? { pageSelector: input.pageSelector } : {}),
          outPath: designPath,
        },
      ],
      ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
    });
  } catch (err) {
    return {
      kind: 'declined',
      reason: 'geometry-extract-failed',
      detail: err instanceof GeometryExtractError ? err.message : errMessage(err),
    };
  }
  const report = parseGeometryExtractReport(raw);
  if (report === null) {
    // Without a parseable report there is no trustworthy page enumeration, so a
    // document on disk could describe the WRONG page.
    return {
      kind: 'declined',
      reason: 'geometry-extract-failed',
      detail: 'reader report unparseable — no trustworthy FINAL: page enumeration',
    };
  }
  const rows = report.surfaces.filter((s) => s.surface === input.surface);
  if (rows.length !== 1) {
    return {
      kind: 'declined',
      reason: 'geometry-extract-failed',
      detail: `reader report carries ${rows.length} rows for surface '${input.surface}'`,
    };
  }
  // The child ENUMERATES, this side SELECTS.
  const selection = selectFinalPage(input.surface, rows[0].candidates, input.pageSelector);
  if (!selection.ok) return { kind: 'declined', reason: 'page-ambiguous', detail: selection.detail };
  const design = await readDoc(designPath, 'design', input.surface);
  if (!design.ok) return { kind: 'declined', reason: design.reason, detail: design.detail };

  // The design page's own size IS the capture viewport, so both sides measure
  // the same box rather than agreeing by luck.
  const command = substituteScreenshotCommand(input.geometryCommand, {
    url: input.url,
    out: input.implPath,
    width: String(design.doc.viewport.width),
    height: String(design.doc.viewport.height),
  });
  if (command === null) {
    return {
      kind: 'declined',
      reason: 'geometry-capture-failed',
      detail: `a substitution value contains a single quote and cannot be safely quoted (out=${input.implPath})`,
    };
  }
  const cap = await deps.capture(command, input.repoRoot, input.captureTimeoutMs ?? 60_000);
  if (cap.timedOut || cap.code !== 0) {
    return {
      kind: 'declined',
      reason: 'geometry-capture-failed',
      detail:
        (cap.timedOut ? `capture timed out after ${input.captureTimeoutMs ?? 60_000}ms` : `capture exited ${cap.code}`) +
        (cap.stderrTail !== '' ? ` — ${cap.stderrTail}` : ''),
    };
  }
  const impl = await readDoc(input.implPath, 'impl', input.surface);
  if (!impl.ok) return { kind: 'declined', reason: impl.reason, detail: impl.detail };
  if (!viewportsAgree(design.doc.viewport, impl.doc.viewport)) {
    return {
      kind: 'declined',
      reason: 'viewport-mismatch',
      detail: `design viewport ${design.doc.viewport.width}x${design.doc.viewport.height} vs capture ${impl.doc.viewport.width}x${impl.doc.viewport.height}`,
    };
  }
  return {
    kind: 'compared',
    comparison: compareGeometry(
      design.doc,
      impl.doc,
      input.tolerance ?? DEFAULT_TOLERANCE,
      input.budget ?? DEFAULT_BUDGET,
    ),
    design: design.doc,
    impl: impl.doc,
    excluded: rows[0].excluded,
  };
}

/** Read one side's document, mapping every failure onto its own reason code. */
async function readDoc(
  path: string,
  side: 'design' | 'impl',
  surface: string,
): Promise<{ ok: true; doc: GeometryDoc } | { ok: false; reason: LaneReasonCode; detail: string }> {
  const missing: LaneReasonCode = side === 'design' ? 'geometry-extract-failed' : 'geometry-capture-failed';
  let text: string;
  try {
    // Size-checked before the read: a runaway producer must not get gigabytes
    // into memory just to be rejected by the parser.
    const size = (await stat(path)).size;
    if (size > MAX_DOC_BYTES) {
      return { ok: false, reason: missing, detail: `${side} document is ${size} bytes — refusing to read` };
    }
    text = await readFile(path, 'utf8');
  } catch (err) {
    return { ok: false, reason: missing, detail: `${side} document missing: ${errMessage(err)}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: 'geometry-unparseable', detail: `${side} document is not JSON: ${errMessage(err)}` };
  }
  const parsed = parseGeometryDoc(raw, side, surface);
  if (!parsed.ok) return { ok: false, reason: 'geometry-unparseable', detail: parsed.detail };
  if (parsed.doc.nodes.length === 0) {
    return { ok: false, reason: 'geometry-empty', detail: `${side} document reports zero nodes` };
  }
  return { ok: true, doc: parsed.doc };
}
```

- [ ] **Step 5: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-review.test.ts
```

Expected output: `Test Files 1 passed`, `Tests 4 passed`.

- [ ] **Step 6: Add the CLI.** Create `src/cr/geometry/geometry-review-cli.ts`:

```ts
// @tests: ui-design-review-lane
// noldor design geometry-review — compare one surface of an ALREADY-RUNNING app
// against its design, without a CR round. Same function the lane calls per
// surface, so an operator debugging a lane row can reproduce it directly.

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runIfDirect } from '../../core/cli-entry.js';
import { GEOMETRY_FAMILIES } from './geometry-compare-core.js';
import { reviewSurfaceGeometry } from './geometry-review.js';

const USAGE =
  'usage: noldor design geometry-review --pen <file.pen> --surface <name> --url <url> --capture <template> [--page <name>]';

/** Exit 0 = every family within budget, 1 = drift, 2 = declined or usage error. */
export async function runGeometryReview(
  argv: readonly string[],
  emit: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
): Promise<number> {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  const penPath = flag('--pen');
  const surface = flag('--surface');
  const url = flag('--url');
  const geometryCommand = flag('--capture');
  if (penPath === undefined || surface === undefined || url === undefined || geometryCommand === undefined) {
    emit(USAGE);
    return 2;
  }
  const dir = await mkdtemp(join(tmpdir(), 'noldor-geometry-review-'));
  const result = await reviewSurfaceGeometry({
    penPath,
    surface,
    ...(flag('--page') !== undefined ? { pageSelector: flag('--page') as string } : {}),
    url,
    geometryCommand,
    outDir: dir,
    implPath: join(dir, 'impl.json'),
    repoRoot: process.cwd(),
  });
  if (result.kind === 'declined') {
    emit(`geometry-review: ${result.reason}: ${result.detail}`);
    return 2;
  }
  if (result.excluded.length > 0) {
    emit(`geometry-review: excluded ${result.excluded.length} clipped design node(s): ${result.excluded.join(', ')}`);
  }
  emit(`surface '${surface}' — ${result.comparison.verdict}`);
  for (const family of GEOMETRY_FAMILIES) {
    const o = result.comparison.families[family];
    emit(
      `  ${family}: ${o.unmatched} unmatched (budget ${o.budget})` +
        (o.designOnly.length > 0 ? ` design-only [${o.designOnly.join(', ')}]` : '') +
        (o.implOnly.length > 0 ? ` impl-only [${o.implOnly.join(', ')}]` : ''),
    );
  }
  emit(`documents in ${dir}`);
  return result.comparison.verdict === 'fail' ? 1 : 0;
}

await runIfDirect(import.meta.url, async () => {
  process.exitCode = await runGeometryReview(process.argv.slice(2));
});
```

- [ ] **Step 7: Register it and document it.** Add the manifest row under the `design` group:

```ts
      'geometry-review': {
        src: 'cr/geometry/geometry-review-cli.ts',
        desc: 'Compare one surface of a running app against its .pen design (no CR round)',
      },
```

Then append this block to `docs/noldor/script-catalog.md` after `design:geometry-export`, and copy it identically into `templates/docs/noldor/script-catalog.md`:

```markdown
### `design:geometry-review`

- **Trigger:** `pnpm noldor design geometry-review --pen <file.pen> --surface <name> --url <url> --capture <template> [--page <name>]`. The app must already be running at `--url`; needs a live pencil bridge.
- **Inputs:** a `.pen` design, the surface to compare, the URL its route renders at, and the `geometryCommand` template to capture with (`{url}`, `{out}`, `{width}`, `{height}`).
- **Outputs:** one line per family — unmatched count, budget, and the design-only and implementation-only values — plus the temp directory holding both documents. Exit 0 = within budget, 1 = drift, 2 = declined (a reason code) or usage error.
- **When to use:** reproducing a `geometry-compare` lane row by hand, or checking a surface before wiring the lane at all.
- **Source:** [`src/cr/geometry/geometry-review-cli.ts`](../../src/cr/geometry/geometry-review-cli.ts)
```

- [ ] **Step 8: Verify the gates.**

```bash
pnpm noldor validate script-catalog && pnpm noldor checks template-sync && pnpm typecheck && pnpm lint && pnpm noldor clones check | head -20
```

Expected output: the catalog and template gates exit 0, typecheck reports only the orchestrate exhaustiveness error from Task 1, lint is clean, and the clones ratchet reports no new duplicated group.

- [ ] **Step 9: Commit.**

```bash
cat > /tmp/geo-p5t3.msg <<'MSG'
feat(cli): compare one running surface against its design

Why — every piece of a geometry comparison now exists separately, and the thing
that turns them into an answer is one function: read the design, capture the
implementation, compare. Putting that function behind a CLI before the lane
exists means an operator can reproduce a comparison against an app they already
have running, and later reproduce a lane row that surprised them, without
booting a CR round.

How — reviewSurfaceGeometry does the whole per-surface sequence and returns
either a comparison or a decline carrying the same reason code the lane will
report, so a hand-run answer and a lane row cannot disagree. It takes the URL
rather than booting anything, which is what keeps it usable by hand and reusable
by the lane. The capture helper moves out of render-compare into capture.ts so
both callers share one implementation, and the design page's own size becomes
the capture viewport so the two sides measure the same box.

What — src/cr/geometry/geometry-review.ts, its CLI at geometry-review-cli.ts,
runCapture lifted into src/cr/lanes/capture.ts, the manifest row, the twinned
catalog entry, and tests covering pass, drift, viewport mismatch, and a failing
capture command.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/geometry/geometry-review.ts src/cr/geometry/geometry-review-cli.ts src/cr/lanes/capture.ts src/cr/lanes/render-compare.ts src/cli/manifest.ts docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md src/cr/__tests__/geometry/geometry-review.test.ts
git commit -F /tmp/geo-p5t3.msg
```
