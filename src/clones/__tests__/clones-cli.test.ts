// @tests: code-clone-detector
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCorpus, parseClonesArgs, runClones } from '../clones-cli';

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

function fixtureRepo(config?: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-clones-cli-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor', 'config.json'),
    JSON.stringify({
      consumer: {
        name: 'fixture',
        repoUrl: 'https://example.com',
        lockstepPackages: ['package.json'],
        scanPaths: ['src'],
        e2ePrefix: 'e2e/',
        samplesPath: 'samples',
        packagePrefix: '@fixture/',
        appPathPrefix: 'src',
      },
      ...config,
    }),
    'utf8',
  );
  writeFileSync(join(dir, 'src', 'a.ts'), fn('first'), 'utf8');
  writeFileSync(join(dir, 'src', 'b.ts'), fn('second'), 'utf8');
  return dir;
}

afterEach(() => vi.restoreAllMocks());

describe('parseClonesArgs', () => {
  it('parses sub + flags and rejects junk', () => {
    expect(parseClonesArgs(['report', '--json', '--min-tokens', '30'])).toMatchObject({
      sub: 'report',
      json: true,
      minTokens: 30,
    });
    expect(() => parseClonesArgs(['bogus'])).toThrow(/usage/);
    expect(() => parseClonesArgs(['check', '--min-tokens', 'NaN'])).toThrow(/positive/);
  });
});

describe('runClones', () => {
  it('report --json emits the CloneReport shape with the seeded clone', async () => {
    const dir = fixtureRepo();
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    const code = await runClones(['report', '--json', '--min-tokens', '30'], dir);
    expect(code).toBe(0);
    const report = JSON.parse(out) as { groups: unknown[]; duplicationPct: number };
    expect(report.groups).toHaveLength(1);
    expect(report.duplicationPct).toBeGreaterThan(0);
  });

  it('check is green without a threshold, red above one, green below one', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const noThreshold = fixtureRepo();
    expect(await runClones(['check', '--min-tokens', '30'], noThreshold)).toBe(0);

    const tight = fixtureRepo({ clones: { thresholdPct: 1 } });
    expect(await runClones(['check', '--min-tokens', '30'], tight)).toBe(1);

    const loose = fixtureRepo({ clones: { thresholdPct: 100 } });
    expect(await runClones(['check', '--min-tokens', '30'], loose)).toBe(0);
  });

  it('config supplies options that flags override', async () => {
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    // config minTokens 30 finds the clone without flags
    const dir = fixtureRepo({ clones: { minTokens: 30 } });
    expect(await runClones(['report', '--json'], dir)).toBe(0);
    expect((JSON.parse(out) as { groups: unknown[] }).groups).toHaveLength(1);
    out = '';
    // flag raises the floor above the clone size → no group
    expect(await runClones(['report', '--json', '--min-tokens', '500'], dir)).toBe(0);
    expect((JSON.parse(out) as { groups: unknown[] }).groups).toHaveLength(0);
  });

  it('loadCorpus skips test files by default and returns repo-relative keys', () => {
    const dir = fixtureRepo();
    writeFileSync(join(dir, 'src', 'a.test.ts'), fn('t'), 'utf8');
    expect([...loadCorpus(dir, false).keys()].sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect([...loadCorpus(dir, true).keys()]).toContain('src/a.test.ts');
  });
});
