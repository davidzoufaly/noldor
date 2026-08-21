// @tests: de-superpowers-vendor-spec-plan-and-worktree-flows
import { describe, expect, it } from 'vitest';

import { emptyLedger, type LedgerState } from '../ledger.js';
import { renderContext } from '../render.js';

const state: LedgerState = {
  entry: 'some-entry-slug',
  scope: 'scope text',
  decided: [
    { id: 'D1', text: 'first' },
    { id: 'D2', text: 'second' },
  ],
  open: [
    { id: 'O1', text: 'still open' },
    { id: 'O2', text: 'already answered', resolvedBy: 'D2' },
  ].map((o) => ({ resolvedBy: null, ...o })),
  support: ['src/foo.ts:12 — already does X'],
  confirmed: [],
  unparsed: [],
};

const opts = { slug: 'parent-enh', kind: 'spec' as const, scope: 'scope text' };

describe('renderContext', () => {
  it('orders sections Scope → Decided → Open → Existing support', () => {
    const out = renderContext(state, opts);
    const at = (needle: string): number => out.indexOf(needle);
    expect(at('Scope')).toBeLessThan(at('Decided ('));
    expect(at('Decided (')).toBeLessThan(at('Open ('));
    expect(at('Open (')).toBeLessThan(at('Existing support ('));
  });

  it('renders every decision and support anchor with no cap', () => {
    const many: LedgerState = {
      ...state,
      decided: Array.from({ length: 20 }, (_, i) => ({ id: `D${i + 1}`, text: `d${i + 1}` })),
    };
    const out = renderContext(many, opts);
    for (let i = 1; i <= 20; i += 1) expect(out).toContain(`- D${i} d${i}`);
    expect(out).toContain('Decided (20)');
  });

  it('hides resolved threads and counts only unresolved ones', () => {
    const out = renderContext(state, opts);
    expect(out).toContain('Open (1)');
    expect(out).toContain('- O1 still open');
    expect(out).not.toContain('already answered');
  });

  it('never returns an empty string for an empty ledger', () => {
    const out = renderContext(emptyLedger(), { ...opts, scope: '(scope not recorded)' });
    expect(out).toContain('(scope not recorded)');
    expect(out).toContain('(no decisions recorded yet)');
    expect(out.length).toBeGreaterThan(0);
  });

  it('differs from --kind spec only in the Scope label', () => {
    const asSpec = renderContext(state, opts);
    const asPlan = renderContext(state, { ...opts, kind: 'plan' });
    expect(asPlan).not.toBe(asSpec);
    expect(asPlan.replace('Plan scope', 'Scope')).toBe(asSpec);
  });

  it('surfaces unparsed sections instead of hiding them', () => {
    const out = renderContext({ ...state, unparsed: ['Decided'] }, opts);
    expect(out).toContain('⚠ ledger section unparsed: Decided');
  });

  it('keeps the storage bullet on every value line so nothing starts a line', () => {
    const forged: LedgerState = {
      ...state,
      decided: [{ id: 'D1', text: '## Open' }],
      support: ['## Decided'],
    };
    const out = renderContext(forged, { ...opts, scope: '## Scope' });
    for (const line of out.split('\n')) expect(line.startsWith('#')).toBe(false);
  });
});
