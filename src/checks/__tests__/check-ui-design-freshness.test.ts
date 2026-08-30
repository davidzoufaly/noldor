// @tests: pendev-ui-design-phase
import { describe, expect, it } from 'vitest';

import { exitCodeFor, renderRows } from '../check-ui-design-freshness.js';

describe('exitCodeFor', () => {
  it('does not fail a repo that has a baseline but no capture receipt yet', () => {
    // Adoption debt, not drift. Every consumer reads `unverified` on the
    // upgrade that introduces the receipt, so a non-zero here would break them
    // all at once.
    expect(exitCodeFor('unverified')).toBe(0);
  });

  it('0 on fresh and skipped', () => {
    expect(exitCodeFor('fresh')).toBe(0);
    expect(exitCodeFor('skipped')).toBe(0);
  });
  it('non-zero on stale and uninitialized', () => {
    expect(exitCodeFor('stale')).toBe(1);
    expect(exitCodeFor('uninitialized')).toBe(1);
  });
  it('0 when a surface could not be checked at all', () => {
    // A git failure may never mint a red: `indeterminate` means the check did
    // not run, which is not evidence of drift. It stays visible through the
    // printed `overall`, which it now outranks `fresh` to reach.
    expect(exitCodeFor('indeterminate')).toBe(0);
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
