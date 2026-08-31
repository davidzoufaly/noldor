// @tests: abstraction-cost-ratchet
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALGORITHM_VERSION,
  buildBaseline,
  compareToBaseline,
  readBaseline,
  writeBaseline,
} from '../baseline.js';
import type { MeasuredIndirection } from '../detect.js';

const measured = (excessSum: number): MeasuredIndirection => ({
  kind: 'measured',
  threshold: 30,
  excessSum,
  modules: [],
  flagged: [],
  percentiles: { p50: 1, p75: 2, p90: 3, p99: 4, max: 5 },
  unresolvedInScope: [],
});

const opts = { threshold: 30, scanRoots: ['src'], includeTests: false };
const AT = '2026-08-30T00:00:00.000Z';

const inTmp = (fn: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'indirection-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('baseline persistence', () => {
  it('round-trips through the schema', () => {
    inTmp((dir) => {
      const path = join(dir, 'baseline.json');
      writeBaseline(path, buildBaseline(measured(882), opts, AT));
      const back = readBaseline(path);
      expect(back.kind).toBe('ok');
      if (back.kind !== 'ok') return;
      expect(back.baseline.excessSum).toBe(882);
      expect(back.baseline.algorithmVersion).toBe(ALGORITHM_VERSION);
      expect(back.baseline.percentiles).toEqual({ p50: 1, p75: 2, p90: 3, p99: 4, max: 5 });
    });
  });

  it('is absent — not unreadable — when the file does not exist', () => {
    expect(readBaseline(join(tmpdir(), 'nope-indirection-baseline.json')).kind).toBe('absent');
  });

  it('is unreadable when the file is malformed', () => {
    inTmp((dir) => {
      const path = join(dir, 'baseline.json');
      writeFileSync(path, '{ not json');
      expect(readBaseline(path).kind).toBe('unreadable');
    });
  });

  it('rejects an unknown key rather than accepting it silently', () => {
    inTmp((dir) => {
      const path = join(dir, 'baseline.json');
      const good = buildBaseline(measured(5), opts, AT);
      writeFileSync(path, JSON.stringify({ ...good, surprise: 1 }));
      expect(readBaseline(path).kind).toBe('unreadable');
    });
  });
});

describe('compareToBaseline', () => {
  const base = buildBaseline(measured(882), opts, AT);

  it('reds only when the number rose, and names the signed delta', () => {
    const v = compareToBaseline(measured(951), base, opts);
    expect(v.kind).toBe('red');
    expect(v.message).toContain('882 -> 951');
    expect(v.message).toContain('+69');
  });

  it('names a fall too, rather than passing silently', () => {
    const v = compareToBaseline(measured(813), base, opts);
    expect(v.kind).toBe('green');
    expect(v.message).toContain('882 -> 813');
    expect(v.message).toContain('-69');
  });

  it('says so when the number is unchanged', () => {
    const v = compareToBaseline(measured(882), base, opts);
    expect(v.kind).toBe('green');
    expect(v.message).toContain('unchanged');
  });

  it('is stale, never red, when a consumer-owned knob differs', () => {
    const v = compareToBaseline(measured(9999), base, { ...opts, scanRoots: ['packages'] });
    expect(v.kind).toBe('stale');
  });

  it('is stale when the threshold differs', () => {
    expect(compareToBaseline(measured(9999), base, { ...opts, threshold: 40 }).kind).toBe('stale');
  });

  it('is stale when the algorithm version differs', () => {
    const older = { ...base, algorithmVersion: ALGORITHM_VERSION + 1 };
    expect(compareToBaseline(measured(9999), older, opts).kind).toBe('stale');
  });
});
