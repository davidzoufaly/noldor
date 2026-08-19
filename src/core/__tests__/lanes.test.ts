import { describe, expect, it } from 'vitest';
import {
  LANE_ALIASES,
  LEGACY_BY_CANONICAL,
  codexIsMandatory,
  laneSchema,
  missingMandatoryReviewer,
  withMandatoryCodex,
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
});

describe('mandatory codex lane (spec/code on M/L/XL sessions)', () => {
  it('mandates codex only for spec/code kinds inside spec-bearing session paths', () => {
    for (const path of [
      'specs-only-new',
      'specs-only-attach',
      'full-new',
      'full-attach',
    ] as const) {
      expect(codexIsMandatory('spec', path)).toBe(true);
      expect(codexIsMandatory('code', path)).toBe(true);
      expect(codexIsMandatory('plan', path)).toBe(false);
    }
  });

  it('exempts XS/S and release paths, and sessions with no marker', () => {
    for (const path of [
      'fast-track',
      'micro-chore',
      'release-sweep',
      'release-automation',
    ] as const) {
      expect(codexIsMandatory('code', path)).toBe(false);
    }
    expect(codexIsMandatory('code', null)).toBe(false);
    expect(codexIsMandatory('code', undefined)).toBe(false);
  });

  it('fails closed on a present-but-unreadable marker (corrupt-marker signal)', () => {
    expect(codexIsMandatory('spec', 'corrupt-marker')).toBe(true);
    expect(codexIsMandatory('code', 'corrupt-marker')).toBe(true);
    // fail-closed widens the path predicate, never the kind predicate
    expect(codexIsMandatory('plan', 'corrupt-marker')).toBe(false);
    expect(withMandatoryCodex('code', 'corrupt-marker', ['reviewer'])).toEqual([
      'reviewer',
      'codex',
    ]);
  });

  it('appends codex order-preserving when mandated', () => {
    expect(withMandatoryCodex('code', 'full-new', ['reviewer'])).toEqual(['reviewer', 'codex']);
    expect(withMandatoryCodex('spec', 'specs-only-new', ['manual', 'reviewer'])).toEqual([
      'manual',
      'reviewer',
      'codex',
    ]);
  });

  it('is idempotent and a no-op when not mandated', () => {
    expect(withMandatoryCodex('code', 'full-new', ['codex', 'reviewer'])).toEqual([
      'codex',
      'reviewer',
    ]);
    expect(withMandatoryCodex('plan', 'full-new', ['reviewer'])).toEqual(['reviewer']);
    expect(withMandatoryCodex('code', 'fast-track', ['reviewer'])).toEqual(['reviewer']);
    expect(withMandatoryCodex('code', null, ['reviewer'])).toEqual(['reviewer']);
  });
});

describe('missingMandatoryReviewer', () => {
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
