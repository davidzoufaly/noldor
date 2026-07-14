import { describe, expect, it } from 'vitest';
import { LANE_ALIASES, LEGACY_BY_CANONICAL, laneSchema } from '../lanes.js';

// @tests: make-noldor-agent-agnostic

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
