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
