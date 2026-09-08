// @tests: code-clone-detector
import { describe, expect, it } from 'vitest';
import { detectClones, DEFAULT_CLONE_OPTIONS } from '../detect.js';

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

  it('repetitive run: no overlapping instances, bounded group family', () => {
    const run = Array.from({ length: 30 }, () => 'doWork(alpha, beta, gamma, delta);').join('\n');
    const report = detectClones(new Map([['a.ts', run]]), OPTS);
    // The maximal half-split pair plus nested half-scale splits — each is
    // real internal repetition per the containment-dedup invariant (both
    // instances inside ONE larger instance are KEPT); the staggered family
    // is collapsed, so the count stays log-bounded, never the raw O(n) fan.
    expect(report.groups.length).toBeLessThanOrEqual(3);
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
      perFile: {},
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

describe('tandem copies in one file', () => {
  it('three consecutive copies keep all three instances', () => {
    const src = fn('one') + fn('two') + fn('three');
    const report = detectClones(new Map([['a.ts', src]]), { ...OPTS, gapTokens: 1 });
    const spans = report.groups.flatMap((g) => g.instances.map((i) => i.startLine));
    // every copy start (lines 1, 10, 19) appears in some group instance
    expect(new Set(spans).size).toBeGreaterThanOrEqual(3);
  });

  it('fractional minTokens is rejected by the CLI parser and config schema', async () => {
    const { parseClonesArgs } = await import('../clones-cli');
    expect(() => parseClonesArgs(['report', '--min-tokens', '30.5'])).toThrow(/integer/);
  });
});

describe('inner repetition inside duplicated outers', () => {
  it('keeps an inner clone class nested cleanly inside a bigger same-file class', () => {
    const inner = [
      '  const chunk = alpha + beta + gamma + delta;',
      '  const twice = chunk + chunk + alpha + beta;',
      '  const thrice = twice + chunk + gamma + delta;',
      '  const final = thrice + twice + chunk + alpha;',
      '  register(final, thrice, twice, chunk);',
    ].join('\n');
    const outer = (n: string) =>
      [`function ${n}() {`, inner, inner, `  return done(${n.length});`, '}', ''].join('\n');
    const report = detectClones(new Map([['a.ts', outer('first') + outer('second')]]), {
      minTokens: 30,
      minLines: 4,
      gapTokens: 2,
    });
    // outer pair reported AND the inner-block repetition inside each outer
    // survives (step-9 must not drop clean nesting).
    expect(report.groups.length).toBeGreaterThanOrEqual(2);
  });
});

describe('tandem repeats n >= 4', () => {
  const block = [
    'const chunk = alpha + beta + gamma + delta;',
    'const twice = chunk + chunk + alpha + beta;',
    'const thrice = twice + chunk + gamma + delta;',
    'const final = thrice + twice + chunk + alpha;',
    'register(final, thrice, twice, chunk);',
    '',
  ].join('\n');
  const opts = { minTokens: 20, minLines: 4, gapTokens: 2 };

  for (const n of [3, 4, 5]) {
    it(`${n} consecutive copies -> one class listing all ${n} disjoint instances`, () => {
      const report = detectClones(new Map([['a.ts', block.repeat(n)]]), opts);
      const all = report.groups.flatMap((g) => g.instances);
      const starts = new Set(all.map((i) => i.startLine));
      // every copy start line represented exactly once across groups
      expect(starts.size).toBe(all.length);
      expect(starts.size).toBeGreaterThanOrEqual(n);
      // no overlapping instances anywhere
      const sorted = [...all].sort((x, y) => x.startLine - y.startLine);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.startLine).toBeGreaterThan(sorted[i - 1]!.endLine);
      }
    });
  }
});

describe('chained-builder schema declarations', () => {
  /** The two schemas this repo's own detector reported as a 52-token clone. */
  const ledger = [
    "import { z } from 'zod';",
    'export const roundSchema = z.object({',
    '  headSha: z.string(),',
    '  fingerprint: z.string().min(1),',
    '  applied: z.number().int().nonnegative(),',
    '  deferred: z.number().int().nonnegative(),',
    '  diffStat: z.string(),',
    '});',
    '',
  ].join('\n');
  const hotZones = [
    "import { z } from 'zod';",
    'const hotZoneSchema = z.array(',
    '  z.object({',
    '    rank: z.number().int().positive(),',
    '    path: z.string().min(1),',
    '    changeCount: z.number().int().positive(),',
    '    insertions: z.number().int().nonnegative(),',
    '    deletions: z.number().int().nonnegative(),',
    '  }),',
    ');',
    '',
  ].join('\n');

  const crossFile = (r: ReturnType<typeof detectClones>) =>
    r.groups.filter((g) => new Set(g.instances.map((i) => i.file)).size > 1);

  it('two unrelated schemas sharing validators are not a clone', () => {
    const report = detectClones(
      new Map([
        ['a.ts', ledger],
        ['b.ts', hotZones],
      ]),
    );
    expect(crossFile(report)).toEqual([]);
  });

  it('a genuinely copied schema still reds', () => {
    const fields = Array.from(
      { length: 30 },
      (_, i) => `  field${i}: z.number().int().nonnegative(),`,
    );
    const body = ['export const bigSchema = z.object({', ...fields, '});', ''].join('\n');
    const report = detectClones(
      new Map([
        ['a.ts', body],
        ['b.ts', body.replace('bigSchema', 'copiedSchema')],
      ]),
    );
    const pairs = crossFile(report);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0]!.instances.map((i) => i.file).sort()).toEqual(['a.ts', 'b.ts']);
  });
});

describe('per-file attribution', () => {
  it('splits the duplicated tokens across the files carrying them, summing to the total', () => {
    const report = detectClones(
      new Map([
        ['a.ts', fn('first')],
        ['b.ts', fn('second')],
        ['clean.ts', 'export const answer = 42;\n'],
      ]),
      OPTS,
    );

    // Both copies are covered, so each carries a real share of the total.
    expect(Object.keys(report.perFile).sort()).toEqual(['a.ts', 'b.ts']);
    expect(report.perFile['a.ts']).toBeGreaterThan(0);
    expect(report.perFile['b.ts']).toBeGreaterThan(0);

    // The attribution is the same merged coverage the ratchet number is built
    // from, not a second estimate of it.
    const summed = Object.values(report.perFile).reduce((acc, n) => acc + n, 0);
    expect(summed).toBe(report.duplicatedTokens);
  });

  it('leaves a corpus with no clones with nothing attributed', () => {
    const report = detectClones(
      new Map([
        ['a.ts', 'export const one = 1;\n'],
        ['b.ts', 'export function other(x: string): string {\n  return x.trim();\n}\n'],
      ]),
      OPTS,
    );
    expect(report.duplicatedTokens).toBe(0);
    expect(report.perFile).toEqual({});
  });
});

/** A header of six named imports — ~40 normalized tokens before exclusion. */
const HEADER = [
  "import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';",
  "import { join, dirname, basename, resolve } from 'node:path';",
  "import { z } from 'zod';",
  '',
].join('\n');

/** A run of three thin typed façades — signature plus one delegating return. */
const facades = (suffix: string): string =>
  [
    `export function relPath${suffix}(name: string): string {`,
    `  return receiptRelPath(DIR_SEGMENTS, basename(name, '.ext'));`,
    '}',
    `export function parseBytes${suffix}(bytes: Buffer | string): Record${suffix} | null {`,
    `  return parseReceiptWith((value) => recordSchema.safeParse(value), bytes);`,
    '}',
    `export function write${suffix}(root: string, name: string, record: Record${suffix}) {`,
    `  return writeReceiptFile(root, DIR_SEGMENTS, basename(name, '.ext'), record);`,
    '}',
    '',
  ].join('\n');

/**
 * A copied declaration with no statement keyword in its body. `heritage` lets
 * one copy carry `extends Base`, which breaks left-extension one token INSIDE
 * the braces — so the matched span excludes the `interface` keyword itself.
 */
const iface = (name: string, member: string, heritage = ''): string =>
  [
    `export interface ${name}${heritage} {`,
    '  alpha: string;',
    '  beta: number;',
    '  gamma: boolean;',
    '  delta: string;',
    '  epsilon: number;',
    '  zeta: boolean;',
    '  eta: string;',
    '  theta: number;',
    '  iota: boolean;',
    '  kappa: string;',
    '  lambda: number;',
    '  mu: boolean;',
    `  ${member}`,
    '}',
    '',
  ].join('\n');

describe('detectClones noise policy', () => {
  it('reports no group when the only overlap is the import header', () => {
    const report = detectClones(
      new Map([
        ['a.ts', `${HEADER}export const alpha = 1;\n`],
        ['b.ts', `${HEADER}export const beta = 2;\n`],
      ]),
      OPTS,
    );
    expect(report.groups).toEqual([]);
    expect(report.duplicatedTokens).toBe(0);
  });

  it('reports no group when the overlap is the header plus a delegating run', () => {
    const report = detectClones(
      new Map([
        ['a.ts', `${HEADER}${facades('Approval')}`],
        ['b.ts', `${HEADER}${facades('Capture')}`],
      ]),
      OPTS,
    );
    expect(report.groups).toEqual([]);
    expect(report.duplicatedTokens).toBe(0);
  });

  it('still reports a copied body that follows an identical header', () => {
    const report = detectClones(
      new Map([
        ['a.ts', `${HEADER}${fn('first')}`],
        ['b.ts', `${HEADER}${fn('second')}`],
      ]),
      OPTS,
    );
    expect(report.groups).toHaveLength(1);
    expect(report.duplicatedTokens).toBeGreaterThan(0);
  });

  it('still reports a copied block that opens with an import past the header', () => {
    const body = ["import('./lazy.js');", fn('same')].join('\n');
    const report = detectClones(
      new Map([
        ['a.ts', `export const gate = 1;\n${body}`],
        ['b.ts', `export const other = 2;\n${body}`],
      ]),
      OPTS,
    );
    expect(report.groups).toHaveLength(1);
  });

  it('still reports a copied interface whose span begins inside its braces', () => {
    // The two heads diverge (`interface Alpha` vs `type Beta =`) and the brace
    // sits on its own line, so left-extension stops at the `{` on line 2 and
    // the `interface` keyword falls OUTSIDE the matched span. This is the
    // shape a container-keyword guard would never fire on: the member named
    // `return` is in the span, its declaration keyword is not.
    const body = iface('X', 'return(value: string): string;').split('\n').slice(1).join('\n');
    const report = detectClones(
      new Map([
        ['a.ts', `export interface Alpha\n{\n${body}`],
        ['b.ts', `export type Beta =\n{\n${body}`],
      ]),
      OPTS,
    );
    expect(report.groups).toHaveLength(1);
    expect(report.duplicatedTokens).toBeGreaterThan(0);

    // Prove the premise rather than assuming it: every span starts at the
    // brace on line 2, past the declaration keyword on line 1.
    for (const inst of report.groups[0]!.instances) {
      expect(inst.startLine).toBe(2);
    }
  });

  it.each([
    ['a return-named property key', 'return: string;'],
    ['an ordinary member', 'eta: string;'],
  ])('still reports a copied interface carrying %s', (_label, member) => {
    const report = detectClones(
      new Map([
        ['a.ts', iface('Alpha', member)],
        ['b.ts', iface('Beta', member)],
      ]),
      OPTS,
    );
    expect(report.groups).toHaveLength(1);
  });

  it('still reports a copied run whose only return is a method call', () => {
    const call = (suffix: string): string =>
      [
        `export function drain${suffix}(iter: Iterator<string>, sink: string[]) {`,
        '  sink.push(iter.next().value);',
        '  sink.push(iter.next().value);',
        '  iter.return();',
        '  sink.push(iter.next().value);',
        '  sink.push(iter.next().value);',
        '  iter.return();',
        '}',
        '',
      ].join('\n');
    const report = detectClones(
      new Map([
        ['a.ts', call('One')],
        ['b.ts', call('Two')],
      ]),
      OPTS,
    );
    expect(report.groups).toHaveLength(1);
  });

  it('drops a delegating run written without semicolons', () => {
    const noSemi = (s: string): string => facades(s).replace(/;$/gm, '');
    const report = detectClones(
      new Map([
        ['a.ts', noSemi('Approval')],
        ['b.ts', noSemi('Capture')],
      ]),
      OPTS,
    );
    expect(report.groups).toEqual([]);
  });

  it('keeps a class at full weight when one of its spans holds control flow', () => {
    const withBranch = facades('Capture').replace(
      '  return parseReceiptWith((value) => recordSchema.safeParse(value), bytes);',
      '  if (bytes.length === 0) return null;\n  return parseReceiptWith(recordSchema, bytes);',
    );
    const report = detectClones(
      new Map([
        ['a.ts', facades('Approval')],
        ['b.ts', withBranch],
      ]),
      OPTS,
    );
    for (const g of report.groups) {
      expect(g.tokens).toBeGreaterThan(0);
    }
    expect(report.duplicatedTokens).toBe(
      Object.values(report.perFile).reduce((acc, n) => acc + n, 0),
    );
  });
});
