import { describe, expect, it } from 'vitest';
import { decideNext } from '../drain-loop.js';
import type { DrainCandidate } from '../drain-source.js';

function cand(over: Partial<DrainCandidate> = {}): DrainCandidate {
  return { slug: 'x', description: 'small thing', eligible: true, ...over };
}
const caps = { shipped: 0, maxFeatures: 20, spawns: 0, maxSpawns: 40 };

describe('decideNext', () => {
  it('spawns an eligible candidate', () => {
    expect(decideNext({ candidate: cand(), ...caps }).action).toBe('spawn');
  });
  it('skips an ineligible candidate', () => {
    expect(decideNext({ candidate: cand({ eligible: false }), ...caps }).action).toBe(
      'skip-out-of-scope',
    );
  });
  it('done when shipped >= maxFeatures', () => {
    expect(decideNext({ candidate: cand(), ...caps, shipped: 20 }).action).toBe('done');
  });
  it('done when spawns >= maxSpawns', () => {
    expect(decideNext({ candidate: cand(), ...caps, spawns: 40 }).action).toBe('done');
  });
});
