// @tests: specs-cr-gate-multi-reviewer
import { describe, expect, it } from 'vitest';

import {
  DISPOSITIONS,
  arbitrationPath,
  arbitrationRecordSchema,
  isFilled,
  parseArbitrationTrailer,
  recordDigest,
} from '../arbitration.js';
import type { Slug } from '../../core/slug.js';

const base = {
  version: 1,
  slug: 's',
  kind: 'code',
  boundTree: 'a'.repeat(40),
  rounds: [{ round: 1, verdict: 'red', headSha: 'abc1234' }],
  blockers: [{ id: 'b1', severity: 'high', message: 'boom', lanes: ['reviewer'] }],
  signals: [],
  dispositions: [],
};

describe('arbitrationPath', () => {
  // A file matching `.noldor/cr/<slug>-<kind>-*.json` is collected by
  // `aggregate` as a lane sink; `autofix-ledger.ts` records what that cost last
  // time. The subdirectory is the proven remedy, not decoration.
  it('nests under .noldor/cr/arbitration, outside the lane-sink glob', () => {
    const p = arbitrationPath('/r', 's' as Slug, 'code');
    expect(p).toContain('/.noldor/cr/arbitration/');
    expect(p.endsWith('/s-code.json')).toBe(true);
  });
});

describe('arbitrationRecordSchema', () => {
  it('accepts a skeleton with no dispositions', () => {
    expect(() => arbitrationRecordSchema.parse(base)).not.toThrow();
  });

  it('rejects an unknown disposition value', () => {
    const bad = { ...base, dispositions: [{ blockerId: 'b1', disposition: 'shrug' }] };
    expect(() => arbitrationRecordSchema.parse(bad)).toThrow();
  });

  it('accepts every documented disposition value', () => {
    for (const d of DISPOSITIONS) {
      const rec = { ...base, dispositions: [{ blockerId: 'b1', disposition: d, note: 'why' }] };
      expect(() => arbitrationRecordSchema.parse(rec)).not.toThrow();
    }
  });

  it('rejects a duplicate disposition for one blocker', () => {
    const dup = {
      ...base,
      dispositions: [
        { blockerId: 'b1', disposition: 'accepted' },
        { blockerId: 'b1', disposition: 'rejected' },
      ],
    };
    expect(() => arbitrationRecordSchema.parse(dup)).toThrow();
  });

  it('rejects a disposition for an unknown blocker id', () => {
    const orphan = { ...base, dispositions: [{ blockerId: 'nope', disposition: 'accepted' }] };
    expect(() => arbitrationRecordSchema.parse(orphan)).toThrow();
  });
});

describe('isFilled', () => {
  it('is false for a skeleton', () => {
    expect(isFilled(arbitrationRecordSchema.parse(base))).toBe(false);
  });

  it('is true only when every blocker has a disposition', () => {
    const rec = arbitrationRecordSchema.parse({
      ...base,
      blockers: [
        { id: 'b1', severity: 'high', message: 'x', lanes: ['reviewer'] },
        { id: 'b2', severity: 'med', message: 'y', lanes: ['codex'] },
      ],
      dispositions: [{ blockerId: 'b1', disposition: 'accepted' }],
    });
    expect(isFilled(rec)).toBe(false);
    const full = {
      ...rec,
      dispositions: [...rec.dispositions, { blockerId: 'b2', disposition: 'rejected' as const }],
    };
    expect(isFilled(arbitrationRecordSchema.parse(full))).toBe(true);
  });
});

describe('recordDigest', () => {
  const rec = arbitrationRecordSchema.parse(base);

  it('is stable across key order', () => {
    const reordered = arbitrationRecordSchema.parse({
      dispositions: [],
      signals: [],
      blockers: base.blockers,
      rounds: base.rounds,
      boundTree: base.boundTree,
      kind: 'code',
      slug: 's',
      version: 1,
    });
    expect(recordDigest(rec)).toBe(recordDigest(reordered));
  });

  it('changes when a disposition is added', () => {
    const filled = arbitrationRecordSchema.parse({
      ...base,
      dispositions: [{ blockerId: 'b1', disposition: 'accepted' }],
    });
    expect(recordDigest(filled)).not.toBe(recordDigest(rec));
  });
});

describe('parseArbitrationTrailer', () => {
  it('reads the digest out of a structured override', () => {
    const v = 'cr-arbitration abc123def456 — two design blockers rejected';
    expect(parseArbitrationTrailer(v)).toBe('abc123def456');
  });

  it('returns null for a bare free-text override', () => {
    expect(parseArbitrationTrailer('verify lane infra red, shipping anyway')).toBeNull();
  });

  it('returns null when the marker is present but the digest is malformed', () => {
    expect(parseArbitrationTrailer('cr-arbitration NOTHEX — why')).toBeNull();
  });
});
