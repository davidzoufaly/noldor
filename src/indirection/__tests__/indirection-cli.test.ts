// @tests: abstraction-cost-ratchet
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { measureIndirection } from '../detect.js';
import { parseIndirectionArgs, renderReport, runIndirection } from '../indirection-cli.js';

const treeDir = (name: string): string => join(import.meta.dirname, 'trees', name);

/** Capture stdout for one call. */
async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string) => {
    chunks.push(s);
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await fn(), out: chunks.join('') };
  } finally {
    process.stdout.write = write;
  }
}

describe('parseIndirectionArgs', () => {
  it('rejects an unknown subcommand', () => {
    expect(() => parseIndirectionArgs(['wat'])).toThrow(/usage: noldor indirection/);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseIndirectionArgs(['report', '--nope'])).toThrow(/unknown flag/);
  });

  it('accepts report with --json', () => {
    expect(parseIndirectionArgs(['report', '--json'])).toEqual({ sub: 'report', json: true });
  });
});

describe('renderReport', () => {
  it('names the excess sum, the percentiles and every flagged row', async () => {
    const r = await measureIndirection({ roots: ['.'], cwd: treeDir('chain'), threshold: 2 });
    if (r.kind !== 'measured') throw new Error(r.kind);
    const text = renderReport(r);
    expect(text).toContain('excess sum: 1');
    expect(text).toContain('p50=1');
    expect(text).toContain('max=3');
    expect(text).toContain('a.ts');
    expect(text).toContain('closure=3');
  });

  it('says so plainly when the corpus is empty', async () => {
    const r = await measureIndirection({ roots: ['.'], cwd: treeDir('empty') });
    expect(renderReport(r)).toContain('no source files');
  });

  it('lists unresolved in-scope imports and not bare ones', async () => {
    const r = await measureIndirection({ roots: ['.'], cwd: treeDir('unresolved') });
    if (r.kind !== 'measured') throw new Error(r.kind);
    expect(r.unresolvedInScope).toHaveLength(1);
    const text = renderReport(r);
    expect(text).toContain('./does-not-exist.js');
    expect(text).toContain('understated');
    expect(text).not.toContain('no-such-package-anywhere');
  });

  it('renders the failure kinds, so their branches are reachable from a caller', async () => {
    const r = await measureIndirection({
      roots: ['.'],
      cwd: treeDir('chain'),
      extensions: [{ extension: '.ts', available: false }],
    });
    expect(r.kind).toBe('no-parser');
    expect(renderReport(r)).toContain('@swc/core');
  });
});

describe('runIndirection report', () => {
  it('exits 0 on a measurable tree', async () => {
    expect(await runIndirection(['report'], treeDir('chain'))).toBe(0);
  });

  it('exits 0 on an empty tree', async () => {
    expect(await runIndirection(['report'], treeDir('empty'))).toBe(0);
  });

  it('exits 3 on a usage error', async () => {
    expect(await runIndirection(['nope'], treeDir('chain'))).toBe(3);
  });

  it('exits 0 on an unresolved in-scope import, reporting rather than refusing', async () => {
    expect(await runIndirection(['report'], treeDir('unresolved'))).toBe(0);
  });

  it('--json emits a parseable payload carrying the ratchet number', async () => {
    const { code, out } = await capture(() =>
      runIndirection(['report', '--json'], treeDir('chain')),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as { kind: string; excessSum: number };
    expect(parsed.kind).toBe('measured');
    expect(parsed.excessSum).toBe(0);
  });

  it('emits byte-identical output across two runs on an unchanged tree', async () => {
    const a = await capture(() => runIndirection(['report'], treeDir('chain')));
    const b = await capture(() => runIndirection(['report'], treeDir('chain')));
    expect(a.out).toBe(b.out);
  });
});

const CONSUMER = {
  consumer: {
    name: 'fixture',
    repoUrl: 'https://example.invalid/fixture',
    lockstepPackages: ['package.json'],
    scanPaths: ['.'],
    e2ePrefix: 'fixture',
    samplesPath: 'samples',
    packagePrefix: '@fixture/',
    appPathPrefix: 'apps/',
  },
};

/** scanRoots -> loadConsumerConfig THROWS without this file. */
const seedConfig = (dir: string): void => {
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(join(dir, '.noldor', 'config.json'), JSON.stringify(CONSUMER));
};

const withTree = async (fn: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'indirection-cli-'));
  try {
    writeFileSync(join(dir, 'a.ts'), "import { b } from './b.js';\nexport const a = b;\n");
    writeFileSync(join(dir, 'b.ts'), 'export const b = 1;\n');
    seedConfig(dir);
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** A tree deep enough to carry excess at threshold 30: 32 chained modules. */
const withDeepTree = async (fn: (dir: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'indirection-deep-'));
  try {
    for (let i = 0; i < 32; i++) {
      const body =
        i === 31
          ? `export const m${i} = ${i};\n`
          : `import { m${i + 1} } from './m${i + 1}.js';\nexport const m${i} = m${i + 1};\n`;
      writeFileSync(join(dir, `m${i}.ts`), body);
    }
    seedConfig(dir);
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const baselinePath = (dir: string): string => join(dir, '.noldor', 'indirection-baseline.json');

describe('runIndirection check and baseline', () => {
  it('accepts the three subcommands', () => {
    for (const sub of ['report', 'check', 'baseline'] as const) {
      expect(parseIndirectionArgs([sub]).sub).toBe(sub);
    }
  });

  it('check exits 0 and says so when no baseline is recorded', async () => {
    await withTree(async (dir) => {
      const { code, out } = await capture(() => runIndirection(['check'], dir));
      expect(code).toBe(0);
      expect(out).toContain('no baseline recorded');
    });
  });

  it('check exits 0 when unchanged', async () => {
    await withTree(async (dir) => {
      expect(await runIndirection(['baseline'], dir)).toBe(0);
      expect(await runIndirection(['check'], dir)).toBe(0);
    });
  });

  it('check exits 1 when the measured excess exceeds the recorded one', async () => {
    // Needs a corpus that actually carries excess at threshold 30, so the
    // fixture is a 32-deep chain rather than the 2-file tree above.
    await withDeepTree(async (dir) => {
      expect(await runIndirection(['baseline'], dir)).toBe(0);
      expect(await runIndirection(['check'], dir)).toBe(0);
      const rec = JSON.parse(readFileSync(baselinePath(dir), 'utf8')) as { excessSum: number };
      expect(rec.excessSum).toBeGreaterThan(0);
      writeFileSync(baselinePath(dir), JSON.stringify({ ...rec, excessSum: rec.excessSum - 1 }));
      const { code, out } = await capture(() => runIndirection(['check'], dir));
      expect(code).toBe(1);
      expect(out).toBe(''); // a red goes to stderr, not stdout
    });
  });

  it('check exits 3 on an unreadable baseline; baseline overwrites it and exits 0', async () => {
    await withTree(async (dir) => {
      expect(await runIndirection(['baseline'], dir)).toBe(0);
      writeFileSync(baselinePath(dir), '{ not json');
      expect(await runIndirection(['check'], dir)).toBe(3);
      expect(await runIndirection(['baseline'], dir)).toBe(0);
      expect(await runIndirection(['check'], dir)).toBe(0);
    });
  });

  it('check exits 0 and reports stale when the recorded knobs differ', async () => {
    await withTree(async (dir) => {
      expect(await runIndirection(['baseline'], dir)).toBe(0);
      const rec = JSON.parse(readFileSync(baselinePath(dir), 'utf8')) as {
        options: { threshold: number };
      };
      rec.options.threshold += 5;
      writeFileSync(baselinePath(dir), JSON.stringify(rec));
      const { code, out } = await capture(() => runIndirection(['check'], dir));
      expect(code).toBe(0);
      expect(out).toContain('not comparable');
    });
  });

  it('baseline names the direction on a re-record', async () => {
    await withTree(async (dir) => {
      expect(await runIndirection(['baseline'], dir)).toBe(0);
      const rec = JSON.parse(readFileSync(baselinePath(dir), 'utf8')) as { excessSum: number };
      writeFileSync(baselinePath(dir), JSON.stringify({ ...rec, excessSum: rec.excessSum + 50 }));
      const { out } = await capture(() => runIndirection(['baseline'], dir));
      expect(out).toContain('lowered from');
    });
  });

  it('check and baseline exit 3 on an unresolved in-scope import; report still exits 0', async () => {
    const dir = treeDir('unresolved');
    expect(await runIndirection(['check'], dir)).toBe(3);
    expect(await runIndirection(['baseline'], dir)).toBe(3);
    expect(await runIndirection(['report'], dir)).toBe(0);
  });
});
