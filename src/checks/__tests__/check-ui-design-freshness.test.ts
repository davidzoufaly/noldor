// @tests: pendev-ui-design-phase
import { describe, expect, it } from 'vitest';

import { exitCodeFor, renderRows } from '../check-ui-design-freshness.js';

describe('exitCodeFor', () => {
  it('0 on fresh and skipped', () => {
    expect(exitCodeFor('fresh')).toBe(0);
    expect(exitCodeFor('skipped')).toBe(0);
  });
  it('non-zero on stale and uninitialized', () => {
    expect(exitCodeFor('stale')).toBe(1);
    expect(exitCodeFor('uninitialized')).toBe(1);
  });
});

describe('renderRows', () => {
  it('prints one row per surface with status and detail', () => {
    const out = renderRows([
      {
        surface: 'app',
        status: 'stale',
        uiCommit: 'a'.repeat(40),
        baselineCommit: 'b'.repeat(40),
        detail: 'drift — run ui-sync',
      },
    ]);
    expect(out).toContain('app');
    expect(out).toContain('stale');
    expect(out).toContain('ui-sync');
  });
  it('explains the empty case', () => {
    expect(renderRows([])).toContain('no uiPaths');
  });
});
