// @tests: architecture-decision-record-surface
import { describe, expect, it } from 'vitest';

import { toGaps } from '../adr.js';

describe('toGaps', () => {
  it('is empty on absent — a repo with no records is not drifting', () => {
    expect(toGaps({ status: 'absent', findings: [] })).toEqual([]);
  });

  it('projects findings with stable <file>#<rule> ids', () => {
    const gaps = toGaps({
      status: 'invalid',
      findings: [{ file: 'docs/adr/0001-x.md', rule: 'dup-number', message: 'shares number' }],
    });
    expect(gaps).toEqual([
      { category: 'adr', itemId: 'docs/adr/0001-x.md#dup-number', message: 'shares number' },
    ]);
  });
});
