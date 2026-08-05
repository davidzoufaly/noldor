import { describe, expect, it } from 'vitest';
import {
  LANE_ALIASES,
  LEGACY_BY_CANONICAL,
  laneSchema,
  missingMandatoryReviewer,
  withMandatoryReviewer,
} from '../lanes.js';

// @tests: make-noldor-agent-agnostic, specs-cr-gate-multi-reviewer

describe('lane vocabulary (canonical + legacy aliases)', () => {
  it('accepts the canonical role-ref names', () => {
    for (const l of ['manual', 'codex', 'reviewer', 'standalone', 'verifier']) {
      expect(laneSchema.parse(l)).toBe(l);
    }
  });

  it('normalizes legacy names to canonical (back-compat)', () => {
    expect(laneSchema.parse('subagent')).toBe('reviewer');
    expect(laneSchema.parse('verify')).toBe('verifier');
  });

  it('rejects unknown lanes', () => {
    expect(() => laneSchema.parse('bogus')).toThrow();
  });

  it('exposes the alias maps both directions', () => {
    expect(LANE_ALIASES).toEqual({ subagent: 'reviewer', verify: 'verifier' });
    expect(LEGACY_BY_CANONICAL).toEqual({ reviewer: 'subagent', verifier: 'verify' });
  });
});

describe('mandatory reviewer lane (spec/plan)', () => {
  it('appends reviewer on spec and plan, preserving order', () => {
    expect(withMandatoryReviewer('spec', ['manual'])).toEqual(['manual', 'reviewer']);
    expect(withMandatoryReviewer('plan', ['manual', 'codex'])).toEqual([
      'manual',
      'codex',
      'reviewer',
    ]);
  });

  it('is idempotent and leaves code untouched', () => {
    expect(withMandatoryReviewer('spec', ['reviewer', 'manual'])).toEqual(['reviewer', 'manual']);
    expect(withMandatoryReviewer('code', ['manual'])).toEqual(['manual']);
    expect(withMandatoryReviewer('spec', [])).toEqual(['reviewer']);
  });

  it('reports the crLanes kinds that omit reviewer', () => {
    expect(missingMandatoryReviewer({ spec: ['manual'], plan: ['codex'] })).toEqual([
      'spec',
      'plan',
    ]);
    expect(missingMandatoryReviewer({ spec: ['manual', 'reviewer'] })).toEqual([]);
    // code may legitimately omit reviewer; undeclared kinds inherit the default.
    expect(missingMandatoryReviewer({ code: ['verifier'] })).toEqual([]);
    expect(missingMandatoryReviewer(undefined)).toEqual([]);
  });
});
