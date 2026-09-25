# Geometry Compare Lane — Part 4: `reviewSurfaceGeometry` and `design geometry-review` Implementation Plan

> **For agentic workers:** Execute this plan task-by-task inline — read each task, use your normal file-edit and shell tools, follow the TDD step order exactly, commit at each task's Commit step, tick `- [ ] → - [x]` as you go. Do not delegate execution to a sub-skill or separate executor.

**Goal:** Compare one surface of a running app against its design, by hand: `pnpm noldor design geometry-review --pen <f> --surface <s> --url <u> --capture <tpl>` reports drift per family, or the reason code when the surface cannot be compared.
**Architecture:** `reviewSurfaceGeometry` does the per-surface work: dispatch the pencil-MCP reader (part 2), reselect the `FINAL:` page from its candidates, capture the implementation at the design page's own viewport through `runCapture` with `NOLDOR_GEOMETRY_SURFACE` set (part 3), and run the shipped `compareGeometry` with partial per-family overrides filled from the defaults. It takes a URL and boots nothing, so the CLI can call it against an app the operator already runs and the lane in part 5 can reuse it per surface.
**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod 3, vitest.

**Depends on:** part 1 (the `geometryCommand` / `geometryTolerance` / `geometryBudget` recipe fields, `screenshotTemplateIssues(template, field)`), part 2 (`dispatchGeometryExtract`, `setGeometryExtractDispatcher`, `GeometryExtractError`, `GEOMETRY_ADHOC_SLUG`, `runGeometryExport`), and part 3 (the six reason codes, `runCapture`'s `env` argument).

---

## File Structure

- `src/cr/geometry/geometry-review.ts` — `reviewSurfaceGeometry`, `withFamilyDefaults`, `viewportsAgree`, `setGeometryReviewDeps` (Create).
- `src/cr/geometry/geometry-cli-emit.ts` — `readGeometrySlug` and `emitFamilyLines`, shared by the geometry CLIs (Modify).
- `src/cr/geometry/geometry-diff-cli.ts`, `src/cr/geometry/geometry-export-cli.ts` — switched to those two helpers (Modify).
- `src/cr/geometry/geometry-review-cli.ts` — `noldor design geometry-review` (Create).
- `src/cli/manifest.ts`, `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`, `AGENTS.md`, `templates/AGENTS.md` — the command's row, catalog entry and capability index (Modify).
- `.noldor/indirection-baseline.json` — re-recorded in its own commit if the new import edges raise it (Modify).
- Tests (Create): `src/cr/__tests__/geometry/geometry-review.test.ts`, `src/cr/__tests__/geometry/geometry-review-cli.test.ts`.

---

## Task 1: `reviewSurfaceGeometry`

**Files:**
- Create: `src/cr/geometry/geometry-review.ts`
- Test: `src/cr/__tests__/geometry/geometry-review.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/geometry/geometry-review.test.ts`:

```ts
// @tests: ui-design-review-lane
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { CaptureResult } from '../../../core/run-capture.js';
import type { Slug } from '../../../core/slug.js';
import { DEFAULT_TOLERANCE } from '../../geometry/geometry-compare-core.js';
import {
  reviewSurfaceGeometry,
  setGeometryReviewDeps,
  viewportsAgree,
  withFamilyDefaults,
  type ReviewSurfaceInput,
} from '../../geometry/geometry-review.js';
import {
  GeometryExtractError,
  setGeometryExtractDispatcher,
} from '../../lanes/geometry-extract-dispatch.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'geo-review-'));
  await writeFile(join(dir, 'design.pen'), 'encrypted', 'utf8');
});

afterEach(() => {
  setGeometryExtractDispatcher(undefined);
  setGeometryReviewDeps({ capture: undefined });
});

const doc = (x: number, viewport = { width: 1440, height: 900 }): unknown => ({
  surface: 'dashboard',
  viewport,
  nodes: [{ kind: 'shape', name: 'Card', box: { x, y: 0, w: 100, h: 40 } }],
});
const OK: CaptureResult = { code: 0, timedOut: false, stderrTail: '' };

/** The reader child: writes the design document and answers with `candidates`. */
function extractWriting(design: unknown, candidates = ['overview']): void {
  setGeometryExtractDispatcher(async (input) => {
    await writeFile(input.requests[0].outPath, JSON.stringify(design), 'utf8');
    return JSON.stringify({ surfaces: [{ surface: 'dashboard', candidates, excluded: [] }] });
  });
}

/** The capture command: writes `impl` (raw text when a string) and exits 0. */
function captureWriting(impl: unknown): void {
  setGeometryReviewDeps({
    capture: async () => {
      const body = typeof impl === 'string' ? impl : JSON.stringify(impl);
      await writeFile(join(dir, 'impl.json'), body, 'utf8');
      return OK;
    },
  });
}

const review = (over: Partial<ReviewSurfaceInput> = {}) =>
  reviewSurfaceGeometry({
    penPath: join(dir, 'design.pen'),
    surface: 'dashboard',
    url: 'http://127.0.0.1:5173/dashboard',
    geometryCommand: 'node cap.mjs {url} {out} {width} {height}',
    outDir: dir,
    implPath: join(dir, 'impl.json'),
    repoRoot: dir,
    slug: 'feat-ui' as Slug,
    ...over,
  });

describe('reviewSurfaceGeometry', () => {
  it('passes when the captured layout matches the design', async () => {
    extractWriting(doc(24));
    captureWriting(doc(24));
    const r = await review();
    expect(r.kind).toBe('compared');
    if (r.kind === 'compared') expect(r.comparison.verdict).toBe('pass');
  });

  it('fails and names the unmatched edges on each side when the layout drifts', async () => {
    extractWriting(doc(24));
    captureWriting(doc(30));
    const r = await review();
    expect(r.kind).toBe('compared');
    if (r.kind === 'compared') {
      expect(r.comparison.verdict).toBe('fail');
      expect(r.comparison.families.edgesX.designOnly).toEqual([24, 124]);
      expect(r.comparison.families.edgesX.implOnly).toEqual([30, 130]);
      expect(r.comparison.families.edgesY.unmatched).toBe(0);
    }
  });

  it('fills families a partial override leaves out from the defaults', async () => {
    expect(withFamilyDefaults({ edgesX: 3 }, DEFAULT_TOLERANCE)).toEqual({
      edgesX: 3,
      edgesY: 2,
      fontSize: 1,
      spacing: 1,
    });
    extractWriting(doc(24));
    captureWriting(doc(30));
    const loose = await review({ tolerance: { edgesX: 10 } });
    expect(loose.kind === 'compared' && loose.comparison.verdict).toBe('pass');
    const budgeted = await review({ budget: { edgesX: 4 } });
    expect(budgeted.kind).toBe('compared');
    if (budgeted.kind === 'compared') {
      expect(budgeted.comparison.verdict).toBe('pass');
      expect(budgeted.comparison.families.edgesX.budget).toBe(4);
      expect(budgeted.comparison.families.edgesY.budget).toBe(0);
    }
  });

  it('captures at the design viewport and tells the script its surface', async () => {
    extractWriting(doc(24));
    const seen: { command: string; env: NodeJS.ProcessEnv | undefined }[] = [];
    setGeometryReviewDeps({
      capture: async (command, _cwd, _ms, env) => {
        seen.push({ command, env });
        await writeFile(join(dir, 'impl.json'), JSON.stringify(doc(24)), 'utf8');
        return OK;
      },
    });
    await review();
    expect(seen).toHaveLength(1);
    expect(seen[0].command).toContain("'1440' '900'");
    expect(seen[0].env).toEqual({ NOLDOR_GEOMETRY_SURFACE: 'dashboard' });
  });

  it('declines with viewport-mismatch rather than comparing mismatched boxes', async () => {
    extractWriting(doc(24));
    captureWriting(doc(24, { width: 1280, height: 900 }));
    const r = await review();
    expect(r.kind === 'declined' && r.reason).toBe('viewport-mismatch');
  });

  it('declines with geometry-empty when a side reports no nodes', async () => {
    extractWriting(doc(24));
    captureWriting({ surface: 'dashboard', viewport: { width: 1440, height: 900 }, nodes: [] });
    const r = await review();
    expect(r.kind === 'declined' && r.reason).toBe('geometry-empty');
  });

  it('declines with geometry-unparseable when the capture writes something that is not JSON', async () => {
    extractWriting(doc(24));
    captureWriting('not json');
    const r = await review();
    expect(r.kind === 'declined' && r.reason).toBe('geometry-unparseable');
  });

  it('declines with geometry-capture-failed and the stderr tail when the command exits non-zero', async () => {
    extractWriting(doc(24));
    setGeometryReviewDeps({ capture: async () => ({ code: 3, timedOut: false, stderrTail: 'boom' }) });
    const r = await review();
    expect(r.kind).toBe('declined');
    if (r.kind === 'declined') {
      expect(r.reason).toBe('geometry-capture-failed');
      expect(r.detail).toContain('boom');
    }
  });

  it('declines with geometry-extract-failed when the reader gives no answer', async () => {
    setGeometryExtractDispatcher(async () => null);
    const r = await review();
    expect(r.kind === 'declined' && r.reason).toBe('geometry-extract-failed');
  });

  it('declines with geometry-extract-failed when the dispatch itself throws', async () => {
    setGeometryExtractDispatcher(async () => {
      throw new GeometryExtractError('timeout', 'geometry-extract dispatch timed out');
    });
    const r = await review();
    expect(r).toEqual({
      kind: 'declined',
      reason: 'geometry-extract-failed',
      detail: 'geometry-extract dispatch timed out',
    });
  });

  it('declines with page-ambiguous when several FINAL: pages exist and no selector names one', async () => {
    extractWriting(doc(24), ['overview', 'expanded']);
    const r = await review();
    expect(r.kind === 'declined' && r.reason).toBe('page-ambiguous');
  });
});

describe('viewportsAgree', () => {
  it('tolerates rounding but not a real difference', () => {
    expect(viewportsAgree({ width: 1440, height: 900 }, { width: 1440.5, height: 900 })).toBe(true);
    expect(viewportsAgree({ width: 1440, height: 900 }, { width: 1438, height: 900 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-review.test.ts
```

Expected output: `Failed to resolve import "../../geometry/geometry-review.js"`.

- [ ] **Step 3: Implement.** Create `src/cr/geometry/geometry-review.ts`:

```ts
// @tests: ui-design-review-lane
// One surface, one comparison: read the design through the pencil-MCP reader
// child, run the consumer's capture command against a URL, and compare the two
// documents. The lane (part 5) calls this per surface after booting the app; the
// CLI beside it calls it once against an app the operator already has running.
// Both get the same reason codes, so a hand-run answer and a lane row cannot
// disagree.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { errMessage } from '../../core/err-message.js';
import { runCapture, type CaptureResult } from '../../core/run-capture.js';
import type { Slug } from '../../core/slug.js';
import { sanitizeSurfaceName } from '../../core/ui-boot.js';
import type { LaneReasonCode } from '../findings-schema.js';
import type { LaneAnswer } from '../lane-answer.js';
import {
  dispatchGeometryExtract,
  GeometryExtractError,
  type GeometryExtractReport,
} from '../lanes/geometry-extract-dispatch.js';
import { selectFinalPage, substituteScreenshotCommand } from '../lanes/render-compare-core.js';
import {
  compareGeometry,
  DEFAULT_BUDGET,
  DEFAULT_TOLERANCE,
  GEOMETRY_FAMILIES,
  type FamilyRecord,
  type GeometryComparison,
} from './geometry-compare-core.js';
import { parseGeometryDoc, type GeometryDoc } from './geometry-doc.js';

/** Byte ceiling before a producer's document is read into memory. */
const MAX_DOC_BYTES = 32 * 1024 * 1024;
/** Viewports may differ by less than a pixel (rounding), never more (spec D4). */
const VIEWPORT_EPSILON = 1;
/** The recipe schema's own `captureTimeoutMs` default. */
const DEFAULT_CAPTURE_TIMEOUT_MS = 60_000;

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
  /** Slug the reader child's answer file is filed under: the round's, or `GEOMETRY_ADHOC_SLUG`. */
  slug: Slug;
  captureTimeoutMs?: number;
  /** Per-family overrides; families left out keep {@link DEFAULT_TOLERANCE}. */
  tolerance?: Partial<FamilyRecord<number>>;
  /** Per-family overrides; families left out keep {@link DEFAULT_BUDGET}. */
  budget?: Partial<FamilyRecord<number>>;
  dispatchTimeoutMs?: number;
}

export type ReviewSurfaceResult =
  | {
      kind: 'compared';
      comparison: GeometryComparison;
      design: GeometryDoc;
      impl: GeometryDoc;
      /** Design nodes pen reported clipped, which the reader therefore dropped. */
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
  Math.abs(a.width - b.width) <= VIEWPORT_EPSILON &&
  Math.abs(a.height - b.height) <= VIEWPORT_EPSILON;

/**
 * Complete a partial per-family record. The recipe's `geometryTolerance` and
 * `geometryBudget` carry no zod defaults, so a recipe naming only `edgesX` must
 * keep the defaults for the other three families rather than compare them at
 * `undefined`.
 */
export function withFamilyDefaults(
  over: Partial<FamilyRecord<number>> | undefined,
  defaults: FamilyRecord<number>,
): FamilyRecord<number> {
  const out = { ...defaults };
  for (const family of GEOMETRY_FAMILIES) {
    const v = over?.[family];
    if (v !== undefined) out[family] = v;
  }
  return out;
}

const declined = (reason: LaneReasonCode, detail: string): ReviewSurfaceResult => ({
  kind: 'declined',
  reason,
  detail,
});

export async function reviewSurfaceGeometry(
  input: ReviewSurfaceInput,
): Promise<ReviewSurfaceResult> {
  const designPath = join(input.outDir, `${sanitizeSurfaceName(input.surface)}.design.json`);
  let answer: LaneAnswer<GeometryExtractReport>;
  try {
    answer = await dispatchGeometryExtract(
      {
        penPath: input.penPath,
        requests: [
          {
            surface: input.surface,
            ...(input.pageSelector !== undefined ? { pageSelector: input.pageSelector } : {}),
            outPath: designPath,
          },
        ],
        ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
      },
      { repoRoot: input.repoRoot, slug: input.slug, kind: 'code' },
    );
  } catch (err) {
    return declined(
      'geometry-extract-failed',
      err instanceof GeometryExtractError ? err.message : `dispatch failed: ${errMessage(err)}`,
    );
  }
  if (!answer.ok) {
    // Without a valid answer there is no trustworthy page enumeration, so a
    // document on disk could describe the WRONG page.
    return declined(
      'geometry-extract-failed',
      `the reader gave no usable answer, so page selection is unverified — ${answer.detail}`,
    );
  }
  const rows = answer.answer.surfaces.filter((s) => s.surface === input.surface);
  if (rows.length !== 1) {
    return declined(
      'geometry-extract-failed',
      `the reader's answer carries ${rows.length} rows for surface '${input.surface}'`,
    );
  }
  // The child ENUMERATES, this side SELECTS.
  const selection = selectFinalPage(input.surface, rows[0].candidates, input.pageSelector);
  if (!selection.ok) return declined('page-ambiguous', selection.detail);
  const design = await readDoc(designPath, 'design', input.surface);
  if (!design.ok) return declined(design.reason, design.detail);

  // The design page's own size IS the capture viewport, so both sides measure
  // the same box rather than agreeing by luck.
  const command = substituteScreenshotCommand(input.geometryCommand, {
    url: input.url,
    out: input.implPath,
    width: String(design.doc.viewport.width),
    height: String(design.doc.viewport.height),
  });
  if (command === null) {
    return declined(
      'geometry-capture-failed',
      `a substitution value contains a single quote and cannot be safely quoted (out=${input.implPath})`,
    );
  }
  const timeoutMs = input.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  let cap: CaptureResult;
  try {
    // The placeholder contract has no {surface}; the script reads it from here.
    cap = await deps.capture(command, input.repoRoot, timeoutMs, {
      NOLDOR_GEOMETRY_SURFACE: input.surface,
    });
  } catch (err) {
    return declined('geometry-capture-failed', `capture threw: ${errMessage(err)}`);
  }
  if (cap.timedOut || cap.code !== 0) {
    const what = cap.timedOut ? `capture timed out after ${timeoutMs}ms` : `capture exited ${cap.code}`;
    return declined(
      'geometry-capture-failed',
      cap.stderrTail !== '' ? `${what} — ${cap.stderrTail}` : what,
    );
  }
  const impl = await readDoc(input.implPath, 'impl', input.surface);
  if (!impl.ok) return declined(impl.reason, impl.detail);
  const dv = design.doc.viewport;
  const iv = impl.doc.viewport;
  if (!viewportsAgree(dv, iv)) {
    return declined(
      'viewport-mismatch',
      `design viewport ${dv.width}x${dv.height} vs capture ${iv.width}x${iv.height}`,
    );
  }
  return {
    kind: 'compared',
    comparison: compareGeometry(
      design.doc,
      impl.doc,
      withFamilyDefaults(input.tolerance, DEFAULT_TOLERANCE),
      withFamilyDefaults(input.budget, DEFAULT_BUDGET),
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
  const missing: LaneReasonCode =
    side === 'design' ? 'geometry-extract-failed' : 'geometry-capture-failed';
  let text: string;
  try {
    // Size-checked before the read: a runaway producer must not get gigabytes
    // into memory just to be rejected by the parser.
    const size = (await stat(path)).size;
    if (size > MAX_DOC_BYTES) {
      return {
        ok: false,
        reason: missing,
        detail: `${side} document is ${size} bytes (cap ${MAX_DOC_BYTES}) — refusing to read`,
      };
    }
    text = await readFile(path, 'utf8');
  } catch (err) {
    return { ok: false, reason: missing, detail: `${side} document missing: ${errMessage(err)}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      reason: 'geometry-unparseable',
      detail: `${side} document is not JSON: ${errMessage(err)}`,
    };
  }
  const parsed = parseGeometryDoc(raw, side, surface);
  if (!parsed.ok) return { ok: false, reason: 'geometry-unparseable', detail: parsed.detail };
  if (parsed.doc.nodes.length === 0) {
    return { ok: false, reason: 'geometry-empty', detail: `${side} document reports zero nodes` };
  }
  return { ok: true, doc: parsed.doc };
}
```

- [ ] **Step 4: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-review.test.ts && pnpm typecheck
```

Expected output: `Tests  12 passed (12)`. `tsc` exits 0.

- [ ] **Step 5: Commit.**

```bash
cat > /tmp/geo-p4t1.msg <<'MSG'
feat(cr): compare one surface's layout against its design

reviewSurfaceGeometry turns the separate pieces into one answer for one
surface. It dispatches the reader child, reselects the FINAL: page from the
child's candidates, captures the implementation at the design page's own
viewport, and compares at the recipe's tolerances and budgets. A partial
override keeps the defaults for the families it leaves out. The capture script
gets its surface through NOLDOR_GEOMETRY_SURFACE. Every stage that cannot go on
declines with its own reason code, a dispatch that throws included, so the lane
and a hand run report the same way. It takes a URL and boots nothing.

Noldor-FD: ui-design-review-lane
MSG
git add src/cr/geometry/geometry-review.ts src/cr/__tests__/geometry/geometry-review.test.ts
git commit -F /tmp/geo-p4t1.msg
```

---

## Task 2: `noldor design geometry-review`

**Files:**
- Create: `src/cr/geometry/geometry-review-cli.ts`
- Modify: `src/cr/geometry/geometry-cli-emit.ts`, `src/cr/geometry/geometry-diff-cli.ts`, `src/cr/geometry/geometry-export-cli.ts`, `src/cli/manifest.ts`, `docs/noldor/script-catalog.md`, `templates/docs/noldor/script-catalog.md`, `AGENTS.md`, `templates/AGENTS.md`
- Test: `src/cr/__tests__/geometry/geometry-review-cli.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/cr/__tests__/geometry/geometry-review-cli.test.ts`:

```ts
// @tests: ui-design-review-lane
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CaptureResult } from '../../../core/run-capture.js';
import { runGeometryReview } from '../../geometry/geometry-review-cli.js';
import { setGeometryReviewDeps } from '../../geometry/geometry-review.js';
import { setGeometryExtractDispatcher } from '../../lanes/geometry-extract-dispatch.js';

const root = mkdtempSync(join(tmpdir(), 'geo-review-cli-'));
const pen = join(root, 'design.pen');
writeFileSync(pen, 'encrypted');
const TPL = 'node cap.mjs {url} {out} {width} {height}';
const base = ['--pen', pen, '--surface', 'dashboard', '--url', 'http://127.0.0.1:5173/', '--capture', TPL];

const doc = (x: number): string =>
  JSON.stringify({
    surface: 'dashboard',
    viewport: { width: 1440, height: 900 },
    nodes: [{ kind: 'shape', name: 'Card', box: { x, y: 0, w: 100, h: 40 } }],
  });

/** Stub the reader (design at x=24) and the capture (impl at `implX`, or a failing exit). */
function stub(implX: number | 'fail'): void {
  setGeometryExtractDispatcher(async (input) => {
    writeFileSync(input.requests[0].outPath, doc(24));
    return JSON.stringify({ surfaces: [{ surface: 'dashboard', candidates: ['overview'], excluded: [] }] });
  });
  setGeometryReviewDeps({
    capture: async (command): Promise<CaptureResult> => {
      if (implX === 'fail') return { code: 3, timedOut: false, stderrTail: 'boom' };
      const out = /'([^']+\.impl\.json)'/.exec(command)?.[1];
      if (out === undefined) throw new Error(`no {out} path in ${command}`);
      writeFileSync(out, doc(implX));
      return { code: 0, timedOut: false, stderrTail: '' };
    },
  });
}

async function run(argv: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const code = await runGeometryReview(argv, (l) => lines.push(l));
  return { code, out: lines.join('\n') };
}

afterEach(() => {
  setGeometryExtractDispatcher(undefined);
  setGeometryReviewDeps({ capture: undefined });
});

describe('design geometry-review', () => {
  it('prints usage and exits 2 without the required flags', async () => {
    const r = await run(['--pen', pen]);
    expect(r.code).toBe(2);
    expect(r.out).toContain('usage: noldor design geometry-review');
  });

  it('rejects an unknown flag, a malformed slug and a template missing a placeholder', async () => {
    expect((await run([...base, '--bogus', 'x'])).out).toContain('unknown flag --bogus');
    const slug = await run([...base, '--slug', 'Not_A_Slug']);
    expect(slug.code).toBe(2);
    const tpl = await run(['--pen', pen, '--surface', 'dashboard', '--url', 'http://x/', '--capture', 'node cap.mjs {url}']);
    expect(tpl.code).toBe(2);
    expect(tpl.out).toContain('--capture is missing {out}');
  });

  it('exits 2 when the design file does not exist', async () => {
    const r = await run(['--pen', join(root, 'nope.pen'), ...base.slice(2)]);
    expect(r.code).toBe(2);
    expect(r.out).toContain('no such design file');
  });

  it('exits 0 with every family within budget on a match', async () => {
    stub(24);
    const r = await run(base);
    expect(r.code).toBe(0);
    expect(r.out).toContain("surface 'dashboard' — pass");
    expect(r.out).toContain('edgesX: 0 unmatched (budget 0)');
  });

  it('exits 1 and names the unmatched values of the failing family on drift', async () => {
    stub(30);
    const r = await run(base);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      'edgesX: 4 unmatched (budget 0) design-only [24.00, 124.00] impl-only [30.00, 130.00]',
    );
  });

  it('exits 2 and prints the reason code when the surface cannot be compared', async () => {
    stub('fail');
    const r = await run(base);
    expect(r.code).toBe(2);
    expect(r.out).toContain('geometry-review: geometry-capture-failed: capture exited 3 — boom');
  });
});
```

- [ ] **Step 2: Run it and verify FAIL.**

```bash
pnpm vitest run src/cr/__tests__/geometry/geometry-review-cli.test.ts
```

Expected output: `Failed to resolve import "../../geometry/geometry-review-cli.js"`.

- [ ] **Step 3: Add the two shared CLI helpers.** A third geometry CLI would repeat part 2's `--slug` block and `geometry-diff`'s per-family printout, and the clone gate flags both. In `src/cr/geometry/geometry-cli-emit.ts`, change the import `import { parseSlug, type Slug } from '../../core/slug.js';` to:

```ts
import { parseSlug, type Slug } from '../../core/slug.js';
import { GEOMETRY_FAMILIES, type GeometryComparison } from './geometry-compare-core.js';
```

and append to the end of the file:

```ts
/** A CLI's `--slug` value, or {@link GEOMETRY_ADHOC_SLUG} when the flag is absent. */
export function readGeometrySlug(
  flag: string | undefined,
): { ok: true; slug: Slug } | { ok: false; error: string } {
  if (flag === undefined) return { ok: true, slug: GEOMETRY_ADHOC_SLUG };
  const parsed = parseSlug(flag);
  return parsed.ok ? { ok: true, slug: parsed.slug } : { ok: false, error: parsed.error.message };
}

const list = (xs: readonly number[]): string => xs.map((v) => v.toFixed(2)).join(', ');

/** One line per family: unmatched count, budget, and the values with no counterpart. */
export function emitFamilyLines(cmp: GeometryComparison, emit: Emit): void {
  for (const family of GEOMETRY_FAMILIES) {
    const o = cmp.families[family];
    emit(
      `  ${family}: ${o.unmatched} unmatched (budget ${o.budget})` +
        (o.designOnly.length > 0 ? ` design-only [${list(o.designOnly)}]` : '') +
        (o.implOnly.length > 0 ? ` impl-only [${list(o.implOnly)}]` : ''),
    );
  }
}
```

In `src/cr/geometry/geometry-diff-cli.ts`: delete the `const list = …` line; change the `./geometry-cli-emit.js` import to `import { emitFamilyLines, stdoutEmit, type Emit } from './geometry-cli-emit.js';`; drop `GEOMETRY_FAMILIES` from the `./geometry-compare-core.js` import; and replace the `for (const family of GEOMETRY_FAMILIES) { … }` loop after `emit(\`surface '${surface}' — ${cmp.verdict}\`);` with `emitFamilyLines(cmp, emit);`.

In `src/cr/geometry/geometry-export-cli.ts`: delete `import { parseSlug } from '../../core/slug.js';`; change the `./geometry-cli-emit.js` import to `import { readGeometrySlug, stdoutEmit, type Emit } from './geometry-cli-emit.js';`; replace the block from `let slug = GEOMETRY_ADHOC_SLUG;` through the closing `}` of `if (slugFlag !== undefined) { … }` with:

```ts
  const slug = readGeometrySlug(values.get('--slug'));
  if (!slug.ok) {
    emit(`${LABEL}: ${slug.error}\n${USAGE}`);
    return 2;
  }
```

and in the `dispatchGeometryExtract` call change `{ repoRoot: process.cwd(), slug, kind: 'code' }` to `{ repoRoot: process.cwd(), slug: slug.slug, kind: 'code' }`.

- [ ] **Step 4: Implement the CLI.** Create `src/cr/geometry/geometry-review-cli.ts`:

```ts
// @tests: ui-design-review-lane
// noldor design geometry-review — compare one surface of an ALREADY-RUNNING app
// against its design, without a CR round. It calls the same function the lane
// calls per surface, so an operator debugging a lane row can reproduce it.

import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readValueFlags, runIfDirect } from '../../core/cli-entry.js';
import { sanitizeSurfaceName, screenshotTemplateIssues } from '../../core/ui-boot.js';
import { emitFamilyLines, readGeometrySlug, stdoutEmit, type Emit } from './geometry-cli-emit.js';
import { reviewSurfaceGeometry } from './geometry-review.js';

const LABEL = 'geometry-review';
const USAGE = `usage: noldor design ${LABEL} --pen <file.pen> --surface <name> --url <url> --capture <template> [--page <name>] [--slug <slug>]`;
/** Every flag this command takes a value for — an unknown flag is user error. */
const VALUE_FLAGS = ['--pen', '--surface', '--url', '--capture', '--page', '--slug'] as const;

/** Exit 0 = every family within budget, 1 = drift, 2 = declined (a reason code) or usage error. */
export async function runGeometryReview(
  argv: readonly string[],
  emit: Emit = stdoutEmit,
): Promise<number> {
  const read = readValueFlags(argv, VALUE_FLAGS, LABEL);
  if (!read.ok) {
    emit(`${read.error}\n${USAGE}`);
    return 2;
  }
  const { values, positional } = read;
  const pen = values.get('--pen');
  const surface = values.get('--surface');
  const url = values.get('--url');
  const geometryCommand = values.get('--capture');
  const pageSelector = values.get('--page');
  if (
    positional.length !== 0 ||
    pen === undefined ||
    surface === undefined ||
    url === undefined ||
    geometryCommand === undefined
  ) {
    emit(USAGE);
    return 2;
  }
  const slug = readGeometrySlug(values.get('--slug'));
  if (!slug.ok) {
    emit(`${LABEL}: ${slug.error}\n${USAGE}`);
    return 2;
  }
  // The same template contract `validate noldor-config` applies to a recipe's
  // geometryCommand, so a hand run cannot accept what the lane would reject.
  const issues = screenshotTemplateIssues(geometryCommand, '--capture');
  if (issues.length > 0) {
    for (const issue of issues) emit(`${LABEL}: ${issue}`);
    return 2;
  }
  const penPath = resolve(pen);
  if (!existsSync(penPath)) {
    emit(`${LABEL}: no such design file: ${penPath}`);
    return 2;
  }
  const dir = await mkdtemp(join(tmpdir(), 'noldor-geometry-review-'));
  const result = await reviewSurfaceGeometry({
    penPath,
    surface,
    ...(pageSelector !== undefined ? { pageSelector } : {}),
    url,
    geometryCommand,
    outDir: dir,
    implPath: join(dir, `${sanitizeSurfaceName(surface)}.impl.json`),
    repoRoot: process.cwd(),
    slug: slug.slug,
  });
  if (result.kind === 'declined') {
    emit(`${LABEL}: ${result.reason}: ${result.detail}`);
    emit(`documents in ${dir}`);
    return 2;
  }
  if (result.excluded.length > 0) {
    emit(
      `${LABEL}: excluded ${result.excluded.length} clipped design node(s): ${result.excluded.join(', ')}`,
    );
  }
  emit(`surface '${surface}' — ${result.comparison.verdict}`);
  emitFamilyLines(result.comparison, emit);
  emit(`documents in ${dir}`);
  return result.comparison.verdict === 'fail' ? 1 : 0;
}

runIfDirect('geometry-review-cli', `design ${LABEL}`, (argv) => runGeometryReview(argv));
```

- [ ] **Step 5: Run it and verify PASS.**

```bash
pnpm vitest run src/cr/__tests__/geometry && pnpm typecheck
```

Expected output: every geometry suite passes. That covers the new CLI file's 6 tests and the `geometry-diff`, `geometry-validate` and `geometry-export` CLI suites, whose output is unchanged by the shared helpers. `tsc` exits 0.

- [ ] **Step 6: Add the manifest row.** In `src/cli/manifest.ts`, inside the `design` group's `subs`, insert between the `'geometry-export'` entry and the `'geometry-validate'` entry:

```ts
      'geometry-review': {
        src: 'cr/geometry/geometry-review-cli.ts',
        desc: 'Compare one surface of a running app against its .pen design (no CR round)',
      },
```

- [ ] **Step 7: Add the catalog entry, twinned.** In `docs/noldor/script-catalog.md`, insert this block between the `### \`design:geometry-export\`` section and the `### \`design:geometry-validate\`` section, then insert the identical block at the same place in `templates/docs/noldor/script-catalog.md`:

```markdown
### `design:geometry-review`

- **Trigger:** `pnpm noldor design geometry-review --pen <file.pen> --surface <name> --url <url> --capture <template> [--page <name>] [--slug <slug>]`. The app must already be running at `--url`, and the design side needs a live pencil bridge.
- **Inputs:** a `.pen` design, the surface to compare, the URL its route renders at, the `geometryCommand` template to capture with (`{url}`, `{out}`, `{width}`, `{height}`; the script also receives `NOLDOR_GEOMETRY_SURFACE`), an optional page selector, and an optional slug for the reader child's answer file (default `geometry-adhoc`).
- **Outputs:** one line per family (unmatched count, budget, and the design-only and implementation-only values), plus the temp directory holding both documents. Exit 0 = within budget, 1 = drift, 2 = declined (the `geometry-compare` reason code is printed) or usage error.
- **When to use:** reproducing a `geometry-compare` lane row by hand, or checking a surface before opting in to the lane.
- **Source:** [`src/cr/geometry/geometry-review-cli.ts`](../../src/cr/geometry/geometry-review-cli.ts)
```

- [ ] **Step 8: Regenerate the capability index.**

```bash
pnpm noldor docs capability-index --write && git diff --stat -- AGENTS.md templates/AGENTS.md
```

Expected output: both files change by one line each. The `design` row now lists `geometry-diff, geometry-export, geometry-review, geometry-validate` in manifest order.

- [ ] **Step 9: Format and run the repo gate.**

```bash
pnpm fmt && pnpm noldor validate script-catalog && pnpm noldor checks template-sync && pnpm verify
```

Expected output: `oxfmt` reflows any pasted block at a different column choice. `Validated script-catalog: 139 manifest command(s) …`, `template-sync` exits 0, and `pnpm verify` (lint, `fmt:check`, typecheck, the full test suite, `triage validate --strict-refs`) exits 0. Stage any file `oxfmt` touched in the commit below.

- [ ] **Step 10: Commit.**

```bash
cat > /tmp/geo-p4t2.msg <<'MSG'
feat(cli): add design geometry-review for one running surface

An operator can now compare an app they already have running against its design
without a CR round, and later reproduce a lane row the same way. The command
checks its capture template against the rule a recipe's geometryCommand must
meet, calls reviewSurfaceGeometry, and prints one line per family, or the
reason code when the surface could not be compared. The --slug reading and the
per-family printout move into geometry-cli-emit.ts, and geometry-diff and
geometry-export use them too, so the three CLIs share one copy. It also adds the
manifest row, the catalog entry in both twins, and the regenerated capability
index.

Noldor-FD: ui-design-review-lane
Noldor-Sibling-Scope: noldor:script-catalog
MSG
git add src/cr/geometry/geometry-review-cli.ts src/cr/geometry/geometry-cli-emit.ts src/cr/geometry/geometry-diff-cli.ts src/cr/geometry/geometry-export-cli.ts src/cr/__tests__/geometry/geometry-review-cli.test.ts src/cli/manifest.ts docs/noldor/script-catalog.md templates/docs/noldor/script-catalog.md AGENTS.md templates/AGENTS.md
git commit -F /tmp/geo-p4t2.msg
```

---

## Task 3: Settle the ratchets

**Files:**
- Modify: `.noldor/indirection-baseline.json` (only if the check below reds)

- [ ] **Step 1: Check the clones ratchet over the whole part.**

```bash
pnpm noldor clones check --against main
```

Expected output: exit 0. If a clone group overlaps lines this part wrote, hoist the shared lines into the module that already owns that concern (`geometry-cli-emit.ts` for the CLIs) and amend that task's commit. Do not re-record the clones baseline.

- [ ] **Step 2: Check the indirection ratchet.**

```bash
pnpm noldor indirection check; echo "exit=$?"
```

Expected output: `exit=0`, or `exit=1` when the new import edges (`geometry-review.ts` → the extract dispatch, render-compare-core and run-capture; the CLI → `geometry-review.ts`) raised the excess sum above the recorded baseline. On `exit=0`, this task ends here.

- [ ] **Step 3: Re-record the baseline (only after `exit=1`).**

```bash
pnpm noldor indirection baseline
```

Expected output: `indirection baseline: recorded excess sum <n> (RAISED from <prior>) across <m> module(s) -> .noldor/indirection-baseline.json`.

- [ ] **Step 4: Commit it on its own (only after Step 3).**

```bash
cat > /tmp/geo-p4t3.msg <<'MSG'
chore(indirection): re-record the baseline for the geometry-review edges

geometry-review.ts imports the extract dispatch, render-compare-core and
run-capture, and the new CLI imports geometry-review.ts. Those edges raise the
transitive-closure excess sum. Re-recorded as its own commit so
the raise shows in the PR diff instead of being buried in a feature commit.

Noldor-FD: ui-design-review-lane
MSG
git add .noldor/indirection-baseline.json
git commit -F /tmp/geo-p4t3.msg
```
