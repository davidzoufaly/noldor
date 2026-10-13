// @tests: abstraction-cost-ratchet
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALGORITHM_VERSION,
  BASELINE_FILE,
  buildBaseline,
  compareToBaseline,
  readBaseline,
  seedBaselineIfAbsent,
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

describe('red attribution', () => {
  const withFlagged = (flagged: MeasuredIndirection['flagged']): MeasuredIndirection => ({
    ...measured(flagged.reduce((n, m) => n + m.excess, 0)),
    flagged,
  });
  const steady = { source: 'src/steady.ts', closure: 40, excess: 10, edges: [] };
  const before = buildBaseline(withFlagged([steady]), opts, AT);

  it('records each flagged module excess in the baseline', () => {
    expect(before.perModule).toEqual({ 'src/steady.ts': 10 });
  });

  it('names the modules that grew, the edges carrying them, and the known fixes', () => {
    const grown = {
      source: 'src/page.ts',
      closure: 36,
      excess: 6,
      edges: [
        { to: 'src/ui/picker.ts', only: 5 },
        { to: 'src/types.ts', only: 1 },
      ],
    };
    const v = compareToBaseline(withFlagged([steady, grown]), before, opts);
    expect(v.kind).toBe('red');
    expect(v.message).toContain('src/page.ts excess 0 -> 6 (+6), closure 36');
    expect(v.message).toContain(
      'imports src/ui/picker.ts - 5 closure file(s) only through this edge',
    );
    expect(v.message).toContain('imports src/types.ts - 1 closure file(s)');
    // A module whose excess did not move is not an offender.
    expect(v.message).not.toContain('src/steady.ts');
    expect(v.message).toContain('mount the import from a parent');
    expect(v.message).toContain('local structural type instead of a type-only import');
  });

  it('reads a baseline recorded before per-module attribution and asks for a re-record', () => {
    inTmp((dir) => {
      const path = join(dir, 'baseline.json');
      const { perModule: _, ...legacy } = before;
      writeFileSync(path, JSON.stringify(legacy));
      const read = readBaseline(path);
      if (read.kind !== 'ok') throw new Error(read.kind);
      const v = compareToBaseline(measured(99), read.baseline, opts);
      expect(v.kind).toBe('red');
      expect(v.message).toContain('baseline predates per-module attribution');
    });
  });
});

describe('seedBaselineIfAbsent', () => {
  const inTmpAsync = async (fn: (dir: string) => Promise<void>): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), 'indirection-seed-'));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  /** Stands in for `noldor indirection baseline`: the dependency-cruiser edge. */
  const recorder = (excessSum: number, calls: string[]) => async (cwd: string) => {
    calls.push(cwd);
    writeBaseline(join(cwd, BASELINE_FILE), buildBaseline(measured(excessSum), opts, AT));
    return 0;
  };

  it('records a baseline when the consumer has none', async () => {
    await inTmpAsync(async (dir) => {
      const calls: string[] = [];
      const outcome = await seedBaselineIfAbsent(dir, recorder(882, calls));
      expect(outcome.kind).toBe('recorded');
      expect(calls).toEqual([dir]);
      const back = readBaseline(join(dir, BASELINE_FILE));
      expect(back.kind).toBe('ok');
      if (back.kind !== 'ok') return;
      expect(back.baseline.excessSum).toBe(882);
    });
  });

  it('leaves an existing baseline untouched and never runs the recorder', async () => {
    await inTmpAsync(async (dir) => {
      const path = join(dir, BASELINE_FILE);
      writeBaseline(path, buildBaseline(measured(500), opts, AT));
      const calls: string[] = [];
      const outcome = await seedBaselineIfAbsent(dir, recorder(882, calls));
      expect(outcome.kind).toBe('already-recorded');
      expect(calls).toEqual([]);
      const back = readBaseline(path);
      expect(back.kind).toBe('ok');
      if (back.kind !== 'ok') return;
      expect(back.baseline.excessSum).toBe(500);
    });
  });

  it('refuses to overwrite an unreadable baseline', async () => {
    await inTmpAsync(async (dir) => {
      const path = join(dir, BASELINE_FILE);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '{ not json');
      const calls: string[] = [];
      const outcome = await seedBaselineIfAbsent(dir, recorder(882, calls));
      expect(outcome.kind).toBe('unreadable');
      expect(calls).toEqual([]);
      expect(readFileSync(path, 'utf8')).toBe('{ not json');
    });
  });

  it('reports a refusal separately from a throw, carrying the exit code', async () => {
    await inTmpAsync(async (dir) => {
      const outcome = await seedBaselineIfAbsent(dir, async () => 3);
      expect(outcome).toEqual({ kind: 'recorder-refused', code: 3 });
      expect(readBaseline(join(dir, BASELINE_FILE)).kind).toBe('absent');
    });
  });

  it('converts a throwing recorder into an outcome instead of propagating', async () => {
    await inTmpAsync(async (dir) => {
      const outcome = await seedBaselineIfAbsent(dir, () => {
        throw new Error("EACCES: permission denied, mkdir '.noldor'");
      });
      expect(outcome).toEqual({
        kind: 'recorder-threw',
        message: "EACCES: permission denied, mkdir '.noldor'",
      });
      expect(readBaseline(join(dir, BASELINE_FILE)).kind).toBe('absent');
    });
  });
});
