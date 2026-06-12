// @tests: outcome-telemetry-and-effectiveness-metrics
import { describe, expect, it } from 'vitest';
import { collectRoutingAccuracy } from '../collect/routing-accuracy';
import { emptyFacts, feature, commit } from './fixtures';

describe('collectRoutingAccuracy', () => {
  it('builds a suggestion×actual confusion table using sizeToPath(size, hasParent)', () => {
    const facts = emptyFacts({
      features: [feature('a', { introduced: '1.0.0' })],
      releases: [{ version: '1.0.0', date: '2026-01-11T00:00:00+00:00' }],
      intake: [{ slug: 'a', size: 'L', parent: 'noldor' }],
      commits: [commit({ trailers: { 'Noldor-FD': 'a', 'Noldor-Path': 'full-new' } })],
    });
    const v = collectRoutingAccuracy(facts).value as {
      table: Record<string, Record<string, number>>;
      matches: number;
      total: number;
    };
    // size L + hasParent → suggestion 'full-attach'; actual 'full-new' → mismatch cell
    expect(v.table['full-attach']['full-new']).toBe(1);
    expect(v.matches).toBe(0);
    expect(v.total).toBe(1);
  });

  it('excludes entries with no recoverable size or no actual path', () => {
    const facts = emptyFacts({
      features: [feature('a', { introduced: '1.0.0' })],
      releases: [{ version: '1.0.0', date: '2026-01-11T00:00:00+00:00' }],
    });
    const v = collectRoutingAccuracy(facts).value as { total: number; excluded: number };
    expect(v.total).toBe(0);
    expect(v.excluded).toBe(1);
  });
});
