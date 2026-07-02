// @tests: plan-runner
import { describe, expect, it } from 'vitest';

import { discoverPrepEntries } from '../discover.js';

const ROADMAP = `# Roadmap

### Small Thing
- area: tooling
- type: feat
- size: S
- impact: med

Body small.

### Medium Thing
- area: tooling
- type: feat
- size: M
- impact: high

Body medium. Touches: src/med.ts

### Large Thing
- area: tooling
- type: feat
- size: L
- impact: high
- parent: noldor

Body large.
`;

describe('discoverPrepEntries', () => {
  it('keeps only M/L/XL entries', () => {
    expect(discoverPrepEntries(ROADMAP, [], []).map((e) => e.slug)).toEqual([
      'medium-thing',
      'large-thing',
    ]);
  });

  it('maps tier by size (M -> specs-only, L -> full)', () => {
    const out = discoverPrepEntries(ROADMAP, [], []);
    expect(out.find((e) => e.slug === 'medium-thing')?.tier).toBe('specs-only');
    expect(out.find((e) => e.slug === 'large-thing')?.tier).toBe('full');
  });

  it('carries parent + deps + body', () => {
    const large = discoverPrepEntries(ROADMAP, [], []).find((e) => e.slug === 'large-thing');
    expect(large?.parent).toBe('noldor');
  });

  it('excludes entries that already have a spec', () => {
    expect(
      discoverPrepEntries(ROADMAP, ['2026-06-01-medium-thing-design.md'], []).map((e) => e.slug),
    ).toEqual(['large-thing']);
  });

  it('excludes entries that already have an FD', () => {
    expect(discoverPrepEntries(ROADMAP, [], ['large-thing']).map((e) => e.slug)).toEqual([
      'medium-thing',
    ]);
  });

  it('restricts to slugFilter when provided', () => {
    expect(discoverPrepEntries(ROADMAP, [], [], ['large-thing']).map((e) => e.slug)).toEqual([
      'large-thing',
    ]);
  });

  it('slugFilter still respects M+ / already-designed exclusions (no force-include)', () => {
    // 'small-thing' is size-S, never eligible; requesting it yields nothing.
    expect(discoverPrepEntries(ROADMAP, [], [], ['small-thing'])).toEqual([]);
    // a spec'd entry stays excluded even when explicitly requested.
    expect(
      discoverPrepEntries(ROADMAP, ['2026-06-01-large-thing-design.md'], [], ['large-thing']),
    ).toEqual([]);
  });

  it('empty slugFilter array filters everything out (explicit empty selection)', () => {
    expect(discoverPrepEntries(ROADMAP, [], [], [])).toEqual([]);
  });

  it('undefined slugFilter keeps the unfiltered M+ behavior', () => {
    expect(discoverPrepEntries(ROADMAP, [], [], undefined).map((e) => e.slug)).toEqual([
      'medium-thing',
      'large-thing',
    ]);
  });

  it('does not false-match a slug that is a hyphen-suffix of a longer spec slug', () => {
    // A spec for "queue-drain" must NOT make a roadmap slug "drain" look already-specced.
    const roadmap = `# Roadmap

### Drain
- area: tooling
- type: feat
- size: M
- impact: high

Body.
`;
    expect(
      discoverPrepEntries(roadmap, ['2026-06-01-queue-drain-design.md'], []).map((e) => e.slug),
    ).toEqual(['drain']);
  });
});
