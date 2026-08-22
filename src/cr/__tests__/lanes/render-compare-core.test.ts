// @tests: ui-design-review-lane
// Pure-half tests for the render-compare lane: page selection shapes (spec R2/D8),
// shell-safe substitution (R2), the pinned diff engine (R6 — the fixtures below
// ARE the versioned raster fixtures, generated deterministically from fixed byte
// patterns so the expectations pin `threshold: 0.2` / `includeAA: false`), and
// the aggregation precedence (R7/D9). No app boot anywhere (AC7).

import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

import {
  ROUTE_CHARSET_RE,
  sanitizationIssues,
  sanitizeSurfaceName,
  screenshotTemplateIssues,
} from '../../../core/ui-boot.js';
import {
  PIXELMATCH_INCLUDE_AA,
  PIXELMATCH_THRESHOLD,
  aggregateOutcomes,
  diffRasters,
  selectFinalPage,
  severityForRatio,
  substituteScreenshotCommand,
} from '../../lanes/render-compare-core.js';
import type { SurfaceOutcome } from '../../lanes/render-compare-core.js';

/** Deterministic raster: 16x16 RGBA filled by a per-row painter. */
function raster(paint: (x: number, y: number) => [number, number, number, number]): Buffer {
  const png = new PNG({ width: 16, height: 16 });
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      const [r, g, b, a] = paint(x, y);
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

describe('sanitizeSurfaceName', () => {
  it('lowercases, replaces disallowed runs with one hyphen, trims edges', () => {
    expect(sanitizeSurfaceName('Dashboard Page!')).toBe('dashboard-page');
    expect(sanitizeSurfaceName('--a__b--')).toBe('a-b');
    expect(sanitizeSurfaceName('ok-name')).toBe('ok-name');
  });

  it('flags collisions and empty sanitizations as config issues', () => {
    expect(sanitizationIssues(['a b', 'a-b'])).toHaveLength(1);
    expect(sanitizationIssues(['a b', 'a-b'])[0]).toContain("'a b', 'a-b'");
    expect(sanitizationIssues(['!!!'])[0]).toContain('empty');
    expect(sanitizationIssues(['app', 'settings'])).toEqual([]);
  });
});

describe('screenshotCommand template contract', () => {
  it('requires all four placeholders and rejects unknown tokens', () => {
    expect(screenshotTemplateIssues('shot --size={width},{height} {url} {out}')).toEqual([]);
    expect(screenshotTemplateIssues('shot {url} {out}')).toEqual([
      'screenshotCommand is missing {width}',
      'screenshotCommand is missing {height}',
    ]);
    expect(screenshotTemplateIssues('shot {url} {out} {width} {height} {state}')).toEqual([
      'screenshotCommand carries unknown placeholder {state}',
    ]);
  });
});

describe('substituteScreenshotCommand', () => {
  const values = {
    url: 'http://127.0.0.1:4001/a?b=1&c=2',
    out: '/tmp/x/shot.png',
    width: '800',
    height: '600',
  };

  it('substitutes every placeholder as a single-quoted token', () => {
    const cmd = substituteScreenshotCommand('cap --size={width},{height} {url} {out}', values);
    expect(cmd).toBe("cap --size='800','600' 'http://127.0.0.1:4001/a?b=1&c=2' '/tmp/x/shot.png'");
  });

  it('refuses a value carrying a single quote instead of splicing it', () => {
    expect(
      substituteScreenshotCommand('cap {url} {out} {width} {height}', {
        ...values,
        out: "/tmp/o'brien/shot.png",
      }),
    ).toBeNull();
  });

  it('the route charset cannot express shell metacharacters', () => {
    for (const bad of ['/$(x)', '/`x`', "/a'b", '/a;b', '/a"b', '/a(b)', '/a b']) {
      expect(ROUTE_CHARSET_RE.test(bad)).toBe(false);
    }
    expect(ROUTE_CHARSET_RE.test('/ok/path-1.html?x=1&y=2%20z')).toBe(true);
  });
});

describe('selectFinalPage', () => {
  it('auto-selects the single page, selector optional', () => {
    expect(selectFinalPage('app', ['default'])).toEqual({ ok: true, page: 'default' });
    expect(selectFinalPage('app', [' default '], 'default')).toEqual({
      ok: true,
      page: 'default',
    });
  });

  it('is page-ambiguous for every unresolvable shape, naming the candidates', () => {
    const zero = selectFinalPage('app', []);
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.detail).toContain('candidates: none');

    const several = selectFinalPage('app', ['a', 'b']);
    expect(several.ok).toBe(false);
    if (!several.ok) expect(several.detail).toContain('candidates: a, b');

    const dangling = selectFinalPage('app', ['a', 'b'], 'c');
    expect(dangling.ok).toBe(false);
    if (!dangling.ok) expect(dangling.detail).toContain("'c' matches no");

    const wrongOnSingle = selectFinalPage('app', ['a'], 'c');
    expect(wrongOnSingle.ok).toBe(false);

    const dupes = selectFinalPage('app', ['a', 'a'], 'a');
    expect(dupes.ok).toBe(false);
    if (!dupes.ok) expect(dupes.detail).toContain('duplicate');
  });

  it('matching is exact and case-sensitive on the trimmed name', () => {
    expect(selectFinalPage('app', ['Default', 'other'], 'default').ok).toBe(false);
    expect(selectFinalPage('app', ['Default', 'other'], 'Default')).toEqual({
      ok: true,
      page: 'Default',
    });
  });
});

describe('severityForRatio (2× rule)', () => {
  it('is high strictly past twice the threshold, med otherwise', () => {
    expect(severityForRatio(0.51, 0.25)).toBe('high');
    expect(severityForRatio(0.5, 0.25)).toBe('med');
    expect(severityForRatio(0.26, 0.25)).toBe('med');
  });
});

describe('diffRasters — pinned engine (threshold 0.2, includeAA false)', () => {
  it('pins the constants the fixtures encode', () => {
    expect(PIXELMATCH_THRESHOLD).toBe(0.2);
    expect(PIXELMATCH_INCLUDE_AA).toBe(false);
  });

  it('identical pair → ratio exactly 0', () => {
    const img = raster(() => WHITE);
    const d = diffRasters(img, img);
    expect(d).toMatchObject({ kind: 'diff', diffRatio: 0, width: 16, height: 16 });
  });

  it('antialiasing-grade jitter stays under the per-pixel color threshold → ratio 0', () => {
    const base = raster(() => [128, 128, 128, 255]);
    const jitter = raster(() => [131, 131, 131, 255]);
    const d = diffRasters(base, jitter);
    expect(d).toMatchObject({ kind: 'diff', diffRatio: 0 });
  });

  it('a blanked region fails high past 2× the default threshold', () => {
    // 10 of 16 rows blanked: ratio 0.625 > 2 × 0.25.
    const design = raster((_x, y) => (y < 10 ? BLACK : WHITE));
    const blank = raster(() => WHITE);
    const d = diffRasters(design, blank);
    expect(d.kind).toBe('diff');
    if (d.kind === 'diff') {
      expect(d.diffRatio).toBeCloseTo(0.625, 5);
      expect(severityForRatio(d.diffRatio, 0.25)).toBe('high');
    }
  });

  it('a shifted region fails med between 1× and 2× the default threshold', () => {
    // A 4-row black band moved by 4 rows: 8 of 16 rows differ → ratio 0.5.
    const design = raster((_x, y) => (y >= 0 && y < 4 ? BLACK : WHITE));
    const shifted = raster((_x, y) => (y >= 4 && y < 8 ? BLACK : WHITE));
    const d = diffRasters(design, shifted);
    expect(d.kind).toBe('diff');
    if (d.kind === 'diff') {
      expect(d.diffRatio).toBeCloseTo(0.5, 5);
      expect(severityForRatio(d.diffRatio, 0.25)).toBe('med');
    }
  });

  it('a size-mismatched pair is dimension-mismatch naming both sizes', () => {
    const small = new PNG({ width: 8, height: 8 });
    const d = diffRasters(
      raster(() => WHITE),
      PNG.sync.write(small),
    );
    expect(d.kind).toBe('dimension-mismatch');
    if (d.kind === 'dimension-mismatch') {
      expect(d.detail).toContain('16x16');
      expect(d.detail).toContain('8x8');
    }
  });

  it('an undecodable buffer is reported per side', () => {
    const garbage = Buffer.from('not a png');
    expect(
      diffRasters(
        garbage,
        raster(() => WHITE),
      ),
    ).toMatchObject({
      kind: 'undecodable',
      which: 'design',
    });
    expect(
      diffRasters(
        raster(() => WHITE),
        garbage,
      ),
    ).toMatchObject({
      kind: 'undecodable',
      which: 'shot',
    });
  });
});

describe('aggregateOutcomes — fail > cannot-review > pass', () => {
  const pass = (surface: string): SurfaceOutcome => ({
    surface,
    kind: 'pass',
    diffRatio: 0,
    threshold: 0.25,
  });
  const fail = (surface: string): SurfaceOutcome => ({
    surface,
    kind: 'fail',
    diffRatio: 0.6,
    threshold: 0.25,
    severity: 'high',
    designPath: 'd',
    shotPath: 's',
    diffPath: 'f',
  });
  const cannot = (surface: string, reason: 'boot-failed' | 'no-boot-recipe'): SurfaceOutcome => ({
    surface,
    kind: 'cannot-review',
    reason,
    detail: `${surface} ${reason}`,
  });

  it('any fail wins, and a fail carries no top-level reason', () => {
    expect(aggregateOutcomes([pass('a'), cannot('b', 'boot-failed'), fail('c')])).toEqual({
      verdict: 'fail',
    });
  });

  it('cannot-review beats pass, headline from the name-ascending first', () => {
    const agg = aggregateOutcomes([
      pass('a'),
      cannot('z', 'no-boot-recipe'),
      cannot('b', 'boot-failed'),
    ]);
    expect(agg).toMatchObject({ verdict: 'cannot-review', reason: 'boot-failed' });
    expect(agg.detail).toBe('b boot-failed');
  });

  it('all pass → pass', () => {
    expect(aggregateOutcomes([pass('a'), pass('b')])).toEqual({ verdict: 'pass' });
  });
});
