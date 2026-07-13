// @tests: code-clone-detector
import { describe, expect, it } from 'vitest';
import { detectClones, DEFAULT_CLONE_OPTIONS } from '../detect';

/** A ~60-token, 8-line function body (unique identifiers injectable). */
const fn = (name: string, a = 'alpha', b = 'beta'): string =>
  [
    `export function ${name}(${a}: number, ${b}: number): number {`,
    `  const sum = ${a} + ${b};`,
    `  const diff = ${a} - ${b};`,
    `  const prod = ${a} * ${b};`,
    `  const quot = ${b} === 0 ? 0 : ${a} / ${b};`,
    '  const mix = sum + diff + prod + quot;',
    '  return mix > 0 ? mix : -mix;',
    '}',
    '',
  ].join('\n');

const OPTS = { ...DEFAULT_CLONE_OPTIONS, minTokens: 40 };

describe('detectClones', () => {
  it('finds a Type-1 clone across two files with correct line ranges', () => {
    const files = new Map([
      ['a.ts', `// header\n${fn('first')}`],
      ['b.ts', fn('second')],
    ]);
    const report = detectClones(files, OPTS);
    expect(report.groups).toHaveLength(1);
    const g = report.groups[0]!;
    expect(g.instances.map((i) => i.file).sort()).toEqual(['a.ts', 'b.ts']);
    const inA = g.instances.find((i) => i.file === 'a.ts')!;
    expect(inA.startLine).toBe(2);
    expect(inA.endLine).toBe(9);
    expect(report.duplicationPct).toBeGreaterThan(0);
  });

  it('finds a Type-2 clone (renamed identifiers, changed literals)', () => {
    const files = new Map([
      ['a.ts', fn('first', 'left', 'right')],
      ['b.ts', fn('second', 'top', 'bottom').replace(' 0 ', ' 42 ')],
    ]);
    const report = detectClones(files, OPTS);
    expect(report.groups).toHaveLength(1);
  });

  it('gap-merge joins near fragments; a large gap keeps groups separate', () => {
    const gapSmall = 'const g1 = 1;\n';
    const gapLarge = Array.from({ length: 20 }, (_, i) => `const filler${i} = ${i};`).join('\n');
    const files = new Map([
      ['a.ts', fn('one') + fn('two')],
      ['b.ts', fn('three') + gapSmall + fn('four')],
      ['c.ts', fn('five') + gapLarge + fn('six')],
    ]);
    const crossFile = (r: ReturnType<typeof detectClones>) =>
      r.groups.filter((g) => new Set(g.instances.map((i) => i.file)).size > 1);
    const smallPair = detectClones(
      new Map([
        ['a.ts', files.get('a.ts')!],
        ['b.ts', files.get('b.ts')!],
      ]),
      OPTS,
    );
    // a↔b: the two-function block merges across the ≤gap insertion → ONE
    // cross-file group spanning both functions (within-file adjacent-fn
    // clones are separate, legitimate groups).
    expect(crossFile(smallPair)).toHaveLength(1);
    expect(crossFile(smallPair)[0]!.tokens).toBeGreaterThan(80);
    const largePair = detectClones(
      new Map([
        ['a.ts', files.get('a.ts')!],
        ['c.ts', files.get('c.ts')!],
      ]),
      OPTS,
    );
    // a↔c: the 20-line filler exceeds gapTokens → merge cannot span it
    expect(crossFile(largePair).every((g) => g.tokens < 150)).toBe(true);
    expect(crossFile(largePair).length).toBeGreaterThanOrEqual(1);
  });

  it('applies minTokens and minLines floors', () => {
    const tiny = 'export const x = 1;\n';
    const report = detectClones(
      new Map([
        ['a.ts', tiny],
        ['b.ts', tiny],
      ]),
      OPTS,
    );
    expect(report.groups).toEqual([]);

    // One-line long token run in both files fails minLines despite minTokens
    const oneLine = `export const arr = [${Array.from({ length: 60 }, (_, i) => i).join(', ')}];\n`;
    const flat = detectClones(
      new Map([
        ['a.ts', oneLine],
        ['b.ts', oneLine],
      ]),
      OPTS,
    );
    expect(flat.groups).toEqual([]);
  });

  it('repetitive run: no overlapping instances, at most one group after dedup', () => {
    const run = Array.from({ length: 30 }, () => 'doWork(alpha, beta, gamma, delta);').join('\n');
    const report = detectClones(new Map([['a.ts', run]]), OPTS);
    expect(report.groups.length).toBeLessThanOrEqual(1);
    for (const g of report.groups) {
      const [x, y] = g.instances;
      const disjoint = x!.endLine < y!.startLine || y!.endLine < x!.startLine;
      expect(disjoint).toBe(true);
    }
  });

  it('duplicationPct dedups overlapping coverage and is deterministic', () => {
    const files = new Map([
      ['a.ts', fn('first')],
      ['b.ts', fn('second')],
      ['c.ts', fn('third')],
    ]);
    const r1 = detectClones(files, OPTS);
    const r2 = detectClones(files, OPTS);
    expect(r1).toEqual(r2);
    // 3 mutually-cloned files: coverage per file counted once → ≤ 100%
    expect(r1.duplicationPct).toBeLessThanOrEqual(100);
    expect(r1.duplicatedTokens).toBeGreaterThan(0);
  });

  it('empty corpus → zero report', () => {
    const r = detectClones(new Map(), OPTS);
    expect(r).toEqual({
      groups: [],
      filesScanned: 0,
      totalTokens: 0,
      duplicatedTokens: 0,
      duplicationPct: 0,
    });
  });
});

describe('clone classes', () => {
  it('a block duplicated in 3 files yields ONE group with 3 instances', () => {
    const files = new Map([
      ['a.ts', fn('first')],
      ['b.ts', fn('second')],
      ['c.ts', fn('third')],
    ]);
    const report = detectClones(files, OPTS);
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]!.instances.map((i) => i.file)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});

describe('class bridging', () => {
  it('a pair bridging two classes folds them into one group without duplicate instances', () => {
    // 4 copies force many pairwise edges; whatever subset survives dedup,
    // every instance must appear in exactly one group.
    const files = new Map([
      ['f1.ts', fn('one')],
      ['f2.ts', fn('two')],
      ['f3.ts', fn('three')],
      ['f4.ts', fn('four')],
    ]);
    const report = detectClones(files, OPTS);
    const spans = report.groups.flatMap((g) =>
      g.instances.map((i) => `${i.file}:${i.startLine}-${i.endLine}`),
    );
    expect(new Set(spans).size).toBe(spans.length);
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]!.instances).toHaveLength(4);
  });
});
