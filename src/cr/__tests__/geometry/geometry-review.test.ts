// @tests: ui-design-review-lane
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { CaptureResult } from '../../../core/run-capture.js';
import type { Slug } from '../../../core/slug.js';
import { DEFAULT_TOLERANCE } from '../../geometry/geometry-compare-core.js';
import {
  extractDesignDocs,
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
    setGeometryReviewDeps({
      capture: async () => ({ code: 3, timedOut: false, stderrTail: 'boom' }),
    });
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

describe('extractDesignDocs', () => {
  it('reads every requested surface with ONE reader dispatch', async () => {
    let calls = 0;
    setGeometryExtractDispatcher(async (input) => {
      calls++;
      for (const r of input.requests) {
        await writeFile(
          r.outPath,
          JSON.stringify({ ...(doc(24) as object), surface: r.surface }),
          'utf8',
        );
      }
      const rows = input.requests.map((r) => ({
        surface: r.surface,
        candidates: ['overview'],
        excluded: [],
      }));
      return JSON.stringify({ surfaces: rows });
    });
    const surfaces = [{ surface: 'dashboard' }, { surface: 'settings' }];
    const m = await extractDesignDocs({
      penPath: join(dir, 'design.pen'),
      surfaces,
      outDir: dir,
      repoRoot: dir,
      slug: 'feat-ui' as Slug,
    });
    expect(calls).toBe(1);
    expect([...m.values()].map((e) => e.kind)).toEqual(['extracted', 'extracted']);
  });

  it("never passes a stale design document off as this dispatch's output", async () => {
    await writeFile(join(dir, 'dashboard.design.json'), JSON.stringify(doc(24)), 'utf8');
    setGeometryExtractDispatcher(async () =>
      JSON.stringify({
        surfaces: [{ surface: 'dashboard', candidates: ['overview'], excluded: [] }],
      }),
    );
    const r = await review();
    expect(r.kind === 'declined' && r.reason).toBe('geometry-extract-failed');
  });
});

describe('viewportsAgree', () => {
  it('tolerates rounding but not a real difference', () => {
    expect(viewportsAgree({ width: 1440, height: 900 }, { width: 1440.5, height: 900 })).toBe(true);
    expect(viewportsAgree({ width: 1440, height: 900 }, { width: 1438, height: 900 })).toBe(false);
  });
});
