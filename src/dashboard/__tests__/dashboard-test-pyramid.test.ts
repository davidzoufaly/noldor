// @tests: project-tracking-dashboard

import { describe, expect, it } from 'vitest';

import { countTestCases, isTestPath, loadTestPyramid, testPyramidRowSchema } from '../data.js';
import { renderTestPyramid } from '../views.js';

import type { TestPyramidRow } from '../data.js';

describe('isTestPath', () => {
  it('matches __tests__ directory segments', () => {
    expect(isTestPath('cr/__tests__/orchestrate.test.ts')).toBe(true);
    expect(isTestPath('__tests__/helpers.ts')).toBe(true);
  });

  it('matches .test.<ext> suffixes outside __tests__', () => {
    expect(isTestPath('core/session.test.ts')).toBe(true);
    expect(isTestPath('core/widget.test.tsx')).toBe(true);
  });

  it('rejects plain source files', () => {
    expect(isTestPath('core/session.ts')).toBe(false);
    expect(isTestPath('core/latest-tests.ts')).toBe(false);
    expect(isTestPath('contest/runner.ts')).toBe(false);
  });
});

describe('countTestCases', () => {
  it('counts it( and test( calls including modifier forms', () => {
    const src = [
      "it('a', () => {});",
      "  test('b', () => {});",
      "it.skip('c', () => {});",
      "it.each([1, 2])('d %i', () => {});",
      "const x = unit('not a test');",
      "// it('commented out but still counted-ish? no — anchored to line start with optional ws')",
    ].join('\n');
    expect(countTestCases(src)).toBe(4);
  });

  it('returns 0 for content without test cases', () => {
    expect(countTestCases('export const x = 1;\n')).toBe(0);
  });
});

describe('loadTestPyramid', () => {
  it('returns Zod-valid rows against the current repo', async () => {
    const rows = await loadTestPyramid();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) testPyramidRowSchema.parse(r);
  });

  it('includes the dashboard module with both source and test files', async () => {
    const rows = await loadTestPyramid();
    const dashboard = rows.find((r) => r.module === 'src/dashboard');
    expect(dashboard).toBeDefined();
    expect(dashboard!.sourceFiles).toBeGreaterThan(0);
    expect(dashboard!.testFiles).toBeGreaterThan(0);
    expect(dashboard!.testCases).toBeGreaterThan(0);
    expect(dashboard!.ratio).not.toBeNull();
  });

  it('sorts worst-covered first (ratio ascending, null last)', async () => {
    const rows = await loadTestPyramid();
    const ratios = rows.map((r) => r.ratio);
    const firstNull = ratios.indexOf(null);
    const numeric = (firstNull === -1 ? ratios : ratios.slice(0, firstNull)) as number[];
    for (let i = 1; i < numeric.length; i += 1) {
      expect(numeric[i - 1]).toBeLessThanOrEqual(numeric[i]);
    }
    if (firstNull !== -1) {
      for (const r of ratios.slice(firstNull)) expect(r).toBeNull();
    }
  });
});

describe('renderTestPyramid', () => {
  const rows: TestPyramidRow[] = [
    { module: 'src/cli', sourceFiles: 4, testFiles: 0, testCases: 0, ratio: 0 },
    { module: 'src/core', sourceFiles: 10, testFiles: 5, testCases: 42, ratio: 0.5 },
    { module: 'src/fixtures', sourceFiles: 0, testFiles: 1, testCases: 3, ratio: null },
  ];

  it('renders counter strip totals and overall ratio', () => {
    const html = renderTestPyramid(rows);
    expect(html).toContain('<h1>Test pyramid</h1>');
    expect(html).toContain('>3</div><div class="l">modules</div>');
    expect(html).toContain('>14</div><div class="l">source files</div>');
    expect(html).toContain('>6</div><div class="l">test files</div>');
    expect(html).toContain('>45</div><div class="l">test cases</div>');
    expect(html).toContain('>1</div><div class="l">untested modules</div>');
  });

  it('flags untested modules with a stale badge and row highlight', () => {
    const html = renderTestPyramid(rows);
    expect(html).toContain('badge stale">untested');
    expect(html).toContain('row-stale');
    expect(html).toContain('badge fresh">covered');
    expect(html).toContain('badge aging">test-only');
  });

  it('renders an empty state when no rows', () => {
    const html = renderTestPyramid([]);
    expect(html).toContain('class="empty"');
  });
});
