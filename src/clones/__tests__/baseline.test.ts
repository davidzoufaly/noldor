// @tests: code-clone-detector
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BASELINE_FILE,
  buildBaseline,
  compareToBaseline,
  ratchetOffenders,
  readBaseline,
  writeBaseline,
} from '../baseline';
import { DEFAULT_CLONE_OPTIONS, detectClones } from '../detect.js';
import type { CloneOptions, CloneReport } from '../detect.js';

const OPTS: CloneOptions = { minTokens: 30, minLines: 5, gapTokens: 10 };

/** A ~60-token, 8-line body — the same shape the detector tests use. */
const fn = (name: string): string =>
  [
    `export function ${name}(alpha: number, beta: number): number {`,
    '  const sum = alpha + beta;',
    '  const diff = alpha - beta;',
    '  const prod = alpha * beta;',
    '  const quot = beta === 0 ? 0 : alpha / beta;',
    '  const mix = sum + diff + prod + quot;',
    '  return mix > 0 ? mix : -mix;',
    '}',
    '',
  ].join('\n');

/** A report carrying just the numbers the ratchet reads. */
const reportWith = (
  duplicatedTokens: number,
  perFile: Record<string, number> = {},
): CloneReport => ({
  groups: [],
  filesScanned: 2,
  totalTokens: 1000,
  duplicatedTokens,
  perFile,
  duplicationPct: duplicatedTokens / 10,
});

const baselineAt = (
  duplicatedTokens: number,
  opts: CloneOptions = OPTS,
  includeTests = false,
  perFile: Record<string, number> = {},
) =>
  buildBaseline(
    reportWith(duplicatedTokens, perFile),
    opts,
    includeTests,
    '2026-08-12T00:00:00.000Z',
  );

describe('buildBaseline', () => {
  it('snapshots the corpus numbers plus the options they were measured under', () => {
    const report = detectClones(
      new Map([
        ['src/a.ts', fn('first')],
        ['src/b.ts', fn('second')],
      ]),
      OPTS,
    );
    const baseline = buildBaseline(report, OPTS, false, '2026-08-12T00:00:00.000Z');
    expect(baseline.duplicatedTokens).toBe(report.duplicatedTokens);
    expect(baseline.duplicatedTokens).toBeGreaterThan(0);
    expect(baseline.groups).toBe(report.groups.length);
    expect(baseline.filesScanned).toBe(2);
    expect(baseline.options).toEqual({
      minTokens: 30,
      minLines: 5,
      gapTokens: 10,
      includeTests: false,
      noisePolicy: 1,
    });
    expect(baseline.recordedAt).toBe('2026-08-12T00:00:00.000Z');
  });
});

describe('writeBaseline / readBaseline', () => {
  it('round-trips through a real file, creating the .noldor directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-clones-baseline-'));
    const path = join(dir, BASELINE_FILE);
    const baseline = baselineAt(120);
    writeBaseline(path, baseline);
    const read = readBaseline(path);
    expect(read).toEqual({ kind: 'ok', baseline });
  });

  it('reports a missing file as absent, not as an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-clones-baseline-'));
    expect(readBaseline(join(dir, BASELINE_FILE))).toEqual({ kind: 'absent' });
  });

  it('reports unparseable and schema-invalid content as unreadable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-clones-baseline-'));
    const junk = join(dir, 'junk.json');
    writeFileSync(junk, '{ not json', 'utf8');
    expect(readBaseline(junk).kind).toBe('unreadable');

    const wrongShape = join(dir, 'wrong.json');
    writeFileSync(wrongShape, JSON.stringify({ duplicatedTokens: 'lots' }), 'utf8');
    expect(readBaseline(wrongShape).kind).toBe('unreadable');

    // A negative count is structurally valid JSON but not a corpus measurement.
    const negative = join(dir, 'negative.json');
    writeFileSync(negative, JSON.stringify({ ...baselineAt(5), duplicatedTokens: -1 }), 'utf8');
    expect(readBaseline(negative).kind).toBe('unreadable');
  });
});

describe('compareToBaseline', () => {
  it('reds on an increase and names both numbers', () => {
    const verdict = compareToBaseline(reportWith(150), baselineAt(120), OPTS, false);
    expect(verdict.kind).toBe('red');
    expect(verdict.message).toContain('120 -> 150');
    expect(verdict.message).toContain('+30');
  });

  it('is green when the number holds', () => {
    expect(compareToBaseline(reportWith(120), baselineAt(120), OPTS, false).kind).toBe('green');
  });

  it('is green on a decrease and asks for the baseline to be re-recorded', () => {
    const verdict = compareToBaseline(reportWith(90), baselineAt(120), OPTS, false);
    expect(verdict.kind).toBe('green');
    expect(verdict.message).toContain('120 -> 90');
    expect(verdict.message).toContain('clones baseline');
  });

  it('is stale — never red — when the baseline used different detection options', () => {
    const looser = compareToBaseline(
      reportWith(500),
      baselineAt(120, DEFAULT_CLONE_OPTIONS),
      OPTS,
      false,
    );
    expect(looser.kind).toBe('stale');
    expect(looser.message).toContain('min-tokens 50');
    expect(looser.message).toContain('min-tokens 30');

    // --include-tests changes the corpus, so it changes comparability too.
    const withTests = compareToBaseline(reportWith(500), baselineAt(120, OPTS, true), OPTS, false);
    expect(withTests.kind).toBe('stale');
  });
});

describe('ratchetOffenders', () => {
  it('names only the files whose coverage grew, biggest rise first', () => {
    const offenders = ratchetOffenders(
      { 'src/a.ts': 100, 'src/b.ts': 200, 'src/steady.ts': 50, 'src/shrank.ts': 80 },
      { 'src/a.ts': 130, 'src/b.ts': 500, 'src/steady.ts': 50, 'src/shrank.ts': 10 },
    );
    expect(offenders).toEqual([
      { file: 'src/b.ts', from: 200, to: 500, delta: 300 },
      { file: 'src/a.ts', from: 100, to: 130, delta: 30 },
    ]);
  });

  it('counts a file that carried no duplication before as a rise from zero', () => {
    expect(ratchetOffenders({ 'src/old.ts': 60 }, { 'src/old.ts': 60, 'src/new.ts': 90 })).toEqual([
      { file: 'src/new.ts', from: 0, to: 90, delta: 90 },
    ]);
  });

  it('orders equal rises by path so the list is stable across runs', () => {
    expect(ratchetOffenders({}, { 'src/z.ts': 40, 'src/a.ts': 40 }).map((o) => o.file)).toEqual([
      'src/a.ts',
      'src/z.ts',
    ]);
  });

  it('answers nothing when the prior run recorded no attribution', () => {
    expect(ratchetOffenders(undefined, { 'src/a.ts': 900 })).toEqual([]);
  });
});

describe('compareToBaseline attribution', () => {
  it('names the files that moved the total, not just how far it moved', () => {
    const before = baselineAt(300, OPTS, false, { 'src/a.ts': 100, 'src/b.ts': 200 });
    const verdict = compareToBaseline(
      reportWith(460, { 'src/a.ts': 100, 'src/b.ts': 260, 'src/fresh.ts': 100 }),
      before,
      OPTS,
      false,
    );
    expect(verdict.kind).toBe('red');
    expect(verdict.message).toContain('files that moved the total');
    expect(verdict.message).toContain('src/fresh.ts 0 -> 100 (+100)');
    expect(verdict.message).toContain('src/b.ts 200 -> 260 (+60)');
    // A file that held steady is not an offender and must not be listed.
    expect(verdict.message).not.toContain('src/a.ts');
  });

  it('caps a long offender list and says how many it withheld', () => {
    const after: Record<string, number> = {};
    for (let i = 0; i < 14; i++) after[`src/f${String(i).padStart(2, '0')}.ts`] = 100 + i;
    const verdict = compareToBaseline(
      reportWith(1491, after),
      baselineAt(10, OPTS, false, {}),
      OPTS,
      false,
    );
    expect(verdict.kind).toBe('red');
    expect(verdict.message).toContain('src/f13.ts 0 -> 113 (+113)');
    // Rank 11 and beyond are withheld, and their count is stated.
    expect(verdict.message).not.toContain('src/f03.ts');
    expect(verdict.message).toContain('and 4 more file(s)');
  });

  it('asks for a re-record when the baseline predates per-file attribution', () => {
    const legacy = { ...baselineAt(300, OPTS, false, { 'src/a.ts': 300 }) };
    delete (legacy as { perFile?: unknown }).perFile;
    const verdict = compareToBaseline(reportWith(400, { 'src/a.ts': 400 }), legacy, OPTS, false);
    expect(verdict.kind).toBe('red');
    expect(verdict.message).toContain('predates per-file attribution');
    expect(verdict.message).not.toContain('files that moved the total');
  });

  it('leaves a green verdict free of attribution noise', () => {
    const verdict = compareToBaseline(
      reportWith(200, { 'src/a.ts': 200 }),
      baselineAt(300, OPTS, false, { 'src/a.ts': 300 }),
      OPTS,
      false,
    );
    expect(verdict.kind).toBe('green');
    expect(verdict.message).not.toContain('files that moved the total');
  });
});

describe('per-file attribution round-trip', () => {
  it('records the report attribution and reads it back off disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-clones-perfile-'));
    const path = join(dir, BASELINE_FILE);
    writeBaseline(path, baselineAt(300, OPTS, false, { 'src/a.ts': 120, 'src/b.ts': 180 }));
    const read = readBaseline(path);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') throw new Error('unreachable');
    expect(read.baseline.perFile).toEqual({ 'src/a.ts': 120, 'src/b.ts': 180 });
  });

  it('still accepts a baseline written before attribution existed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-clones-legacy-'));
    const path = join(dir, BASELINE_FILE);
    const legacy = { ...baselineAt(300, OPTS, false, { 'src/a.ts': 300 }) };
    delete (legacy as { perFile?: unknown }).perFile;
    writeBaseline(path, legacy);
    const read = readBaseline(path);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') throw new Error('unreachable');
    expect(read.baseline.duplicatedTokens).toBe(300);
    expect(read.baseline.perFile).toBeUndefined();
  });
});

describe('noise-policy generation', () => {
  /** A baseline as written before `noisePolicy` existed: the key is absent. */
  const legacyBaseline = (duplicatedTokens: number) => {
    const { noisePolicy: _dropped, ...options } = baselineAt(duplicatedTokens).options;
    return { ...baselineAt(duplicatedTokens), options };
  };

  it('records the current generation when building a baseline', () => {
    expect(baselineAt(120).options.noisePolicy).toBe(1);
  });

  it('keeps a legacy baseline readable rather than unreadable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-clones-baseline-'));
    const path = join(dir, 'legacy.json');
    writeFileSync(path, JSON.stringify(legacyBaseline(400)), 'utf8');
    const read = readBaseline(path);
    expect(read.kind).toBe('ok');
    // An unreadable baseline turns the ratchet OFF; a comparable-looking one
    // would let the new lower number pass as an improvement. Neither.
    expect(read.kind === 'ok' && read.baseline.options.noisePolicy).toBeUndefined();
  });

  it('calls a legacy baseline stale even when the number FELL', () => {
    // The trap this pins: `noisePolicy` is optional, so a `now` built without
    // it reads `undefined`, matches a legacy baseline's absent value, and the
    // run reports green-with-a-hint on a number the policy change lowered.
    const verdict = compareToBaseline(reportWith(90), legacyBaseline(400), OPTS, false);
    expect(verdict.kind).toBe('stale');
    expect(verdict.message).toContain('noise-policy 0');
    expect(verdict.message).toContain('noise-policy 1');
  });

  it('still compares two baselines recorded under the same generation', () => {
    expect(compareToBaseline(reportWith(90), baselineAt(120), OPTS, false).kind).toBe('green');
    expect(compareToBaseline(reportWith(150), baselineAt(120), OPTS, false).kind).toBe('red');
  });

  it('treats an explicit generation 0 as the legacy policy', () => {
    const explicitZero = {
      ...baselineAt(400),
      options: { ...baselineAt(400).options, noisePolicy: 0 },
    };
    expect(compareToBaseline(reportWith(90), explicitZero, OPTS, false).kind).toBe('stale');
  });
});
