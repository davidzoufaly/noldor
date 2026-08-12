// @tests: code-clone-detector
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BASELINE_FILE,
  buildBaseline,
  compareToBaseline,
  readBaseline,
  writeBaseline,
} from '../baseline';
import { DEFAULT_CLONE_OPTIONS, detectClones } from '../detect';
import type { CloneOptions, CloneReport } from '../detect';

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
const reportWith = (duplicatedTokens: number): CloneReport => ({
  groups: [],
  filesScanned: 2,
  totalTokens: 1000,
  duplicatedTokens,
  duplicationPct: duplicatedTokens / 10,
});

const baselineAt = (duplicatedTokens: number, opts: CloneOptions = OPTS, includeTests = false) =>
  buildBaseline(reportWith(duplicatedTokens), opts, includeTests, '2026-08-12T00:00:00.000Z');

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
