// @tests: dead-code-detection-with-knip
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEAD_CODE_ALGORITHM_VERSION,
  DEAD_CODE_BASELINE,
  defaultRunKnip,
  knipKeys,
  main,
} from '../dead-code.js';
import type { RunKnip } from '../dead-code.js';

function tempRepo(): { dir: string; [Symbol.dispose](): void } {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-dead-code-'));
  return { dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
}

const row = (file: string, fields: Record<string, unknown[]>): Record<string, unknown> => ({
  file,
  files: [],
  exports: [],
  types: [],
  enumMembers: [],
  duplicates: [],
  ...fields,
});

const knipJson = (...rows: Record<string, unknown>[]): string => JSON.stringify({ issues: rows });

const fakeKnip =
  (stdout: string, version = '6.40.0'): RunKnip =>
  () => ({ ok: true, stdout, version });

const TODAY = knipJson(
  row('src/a.ts', { exports: [{ name: 'unusedA', line: 3 }] }),
  row('src/dead.ts', { files: [{ name: 'src/dead.ts' }] }),
);

async function run(
  argv: string[],
  dir: string,
  runKnip: RunKnip,
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true));
  const code = await main(argv, dir, runKnip, new Date('2026-10-07T00:00:00Z'));
  vi.restoreAllMocks();
  return { code, out: out.join(''), err: err.join('') };
}

afterEach(() => vi.restoreAllMocks());

describe('knipKeys', () => {
  it('keys every finding by type, file and name, sorted', () => {
    const result = knipKeys(
      knipJson(
        row('src/b.ts', {
          types: [{ name: 'Shape' }],
          exports: [{ name: 'zeta' }, { name: 'alpha' }],
        }),
        row('src/dead.ts', { files: [{ name: 'src/dead.ts' }] }),
        row('package.json', { dependencies: [{ name: 'left-pad', line: 9 }] }),
      ),
    );
    expect(result).toEqual({
      ok: true,
      keys: [
        'dependencies:package.json:left-pad',
        'exports:src/b.ts:alpha',
        'exports:src/b.ts:zeta',
        'files:src/dead.ts',
        'types:src/b.ts:Shape',
      ],
    });
  });

  it('puts the parent in a member key, so equal member names in two enums stay distinct', () => {
    const result = knipKeys(
      knipJson(
        row('src/e.ts', {
          enumMembers: [
            { name: 'Off', namespace: 'Light' },
            { name: 'Off', namespace: 'Fan' },
          ],
        }),
      ),
    );
    expect(result).toEqual({
      ok: true,
      keys: ['enumMembers:src/e.ts:Fan.Off', 'enumMembers:src/e.ts:Light.Off'],
    });
  });

  it('joins a duplicates group into one order-independent key', () => {
    const result = knipKeys(
      knipJson(row('src/d.ts', { duplicates: [[{ name: 'b' }, { name: 'a' }]] })),
    );
    expect(result).toEqual({ ok: true, keys: ['duplicates:src/d.ts:a|b'] });
  });

  it.each([
    ['not JSON', 'Error: knip crashed'],
    ['no issues array', JSON.stringify({ files: [] })],
    ['an entry with no name', knipJson(row('src/a.ts', { exports: [{ line: 3 }] }))],
  ])('refuses %s', (_label, stdout) => {
    expect(knipKeys(stdout).ok).toBe(false);
  });
});

describe('dead-code CLI', () => {
  it('baseline records the sorted keys and knip version, and check is then green', async () => {
    using repo = tempRepo();
    expect((await run(['baseline'], repo.dir, fakeKnip(TODAY))).code).toBe(0);
    expect(JSON.parse(readFileSync(join(repo.dir, DEAD_CODE_BASELINE), 'utf8'))).toEqual({
      algorithmVersion: DEAD_CODE_ALGORITHM_VERSION,
      knipVersion: '6.40.0',
      recordedAt: '2026-10-07T00:00:00.000Z',
      issues: ['exports:src/a.ts:unusedA', 'files:src/dead.ts'],
    });
    expect((await run(['check'], repo.dir, fakeKnip(TODAY))).code).toBe(0);
  });

  it('check reds and names a finding the baseline lacks, even when another one was removed', async () => {
    using repo = tempRepo();
    await run(['baseline'], repo.dir, fakeKnip(TODAY));
    const swapped = knipJson(
      row('src/a.ts', { exports: [{ name: 'unusedA' }, { name: 'newlyDead' }] }),
    );
    const result = await run(['check'], repo.dir, fakeKnip(swapped));
    expect(result.code).toBe(1);
    expect(result.err).toContain('exports:src/a.ts:newlyDead');
    expect(result.err).not.toContain('unusedA');
  });

  it('check stays green and hints a re-record when a recorded finding is gone', async () => {
    using repo = tempRepo();
    await run(['baseline'], repo.dir, fakeKnip(TODAY));
    const fewer = knipJson(row('src/a.ts', { exports: [{ name: 'unusedA' }] }));
    const result = await run(['check'], repo.dir, fakeKnip(fewer));
    expect(result.code).toBe(0);
    expect(result.out).toContain('pnpm noldor dead-code baseline');
  });

  it('check exits 3 with no baseline', async () => {
    using repo = tempRepo();
    expect((await run(['check'], repo.dir, fakeKnip(TODAY))).code).toBe(3);
  });

  it.each([
    ['knipVersion', { knipVersion: '5.0.0' }],
    ['algorithmVersion', { algorithmVersion: DEAD_CODE_ALGORITHM_VERSION + 1 }],
  ])('check exits 3 when the baseline was recorded under another %s', async (_label, drift) => {
    using repo = tempRepo();
    await run(['baseline'], repo.dir, fakeKnip(TODAY));
    const path = join(repo.dir, DEAD_CODE_BASELINE);
    const recorded = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...recorded, ...drift }));
    expect((await run(['check'], repo.dir, fakeKnip(TODAY))).code).toBe(3);
  });

  it.each(['report', 'check', 'baseline'])(
    '%s exits 3 when knip fails, and writes nothing',
    async (sub) => {
      using repo = tempRepo();
      const failing: RunKnip = () => ({ ok: false, reason: 'knip exited 2' });
      const result = await run([sub], repo.dir, failing);
      expect(result.code).toBe(3);
      expect(result.err).toContain('knip exited 2');
      expect(() => readFileSync(join(repo.dir, DEAD_CODE_BASELINE))).toThrow();
    },
  );

  it('check exits 3 on knip output it cannot parse', async () => {
    using repo = tempRepo();
    await run(['baseline'], repo.dir, fakeKnip(TODAY));
    expect((await run(['check'], repo.dir, fakeKnip('not json'))).code).toBe(3);
  });

  it('report lists every finding grouped by type', async () => {
    using repo = tempRepo();
    const result = await run(['report'], repo.dir, fakeKnip(TODAY));
    expect(result.code).toBe(0);
    expect(result.out).toContain('exports (1)');
    expect(result.out).toContain('src/a.ts:unusedA');
    expect(result.out).toContain('files (1)');
  });

  it.each([[[]], [['nope']], [['check', 'extra']]])('exits 2 on usage %j', async (argv) => {
    using repo = tempRepo();
    expect((await run(argv, repo.dir, fakeKnip(TODAY))).code).toBe(2);
  });
});

describe('defaultRunKnip', () => {
  it('reports knip as not installed in a repo without it', () => {
    using repo = tempRepo();
    mkdirSync(join(repo.dir, 'node_modules'));
    const result = defaultRunKnip(repo.dir);
    expect(result.ok).toBe(false);
  });
});
