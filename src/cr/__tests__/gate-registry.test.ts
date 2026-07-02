import { describe, expect, it } from 'vitest';

import { GATE_REGISTRY, BOOTSTRAP_REASON, isBootstrapReason, gateEntry } from '../gate-registry.js';

// @tests: acceptance-verify-lane, bootstrap-immunity-for-self-gating-features

describe('gate-registry', () => {
  it('maps codex-cr to the exact trailer checkCrGate reads', () => {
    expect(GATE_REGISTRY['codex-cr'].overrideTrailer).toBe('Noldor-CR-Override-Codex');
    expect(GATE_REGISTRY['codex-cr'].log).toBe('cr-overrides.log');
  });

  it('gateEntry resolves known keys and rejects unknown/undefined', () => {
    expect(gateEntry('codex-cr')).toEqual(GATE_REGISTRY['codex-cr']);
    expect(gateEntry('nope')).toBeNull();
    expect(gateEntry(undefined)).toBeNull();
  });

  it('isBootstrapReason matches the BOOTSTRAP_REASON prefix', () => {
    expect(isBootstrapReason(BOOTSTRAP_REASON)).toBe(true);
    expect(isBootstrapReason('bootstrap — anything')).toBe(true);
    expect(isBootstrapReason('manual override')).toBe(false);
  });
});
