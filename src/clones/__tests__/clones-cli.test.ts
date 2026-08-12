// @tests: code-clone-detector
import { describe, expect, it, vi, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCorpus, parseClonesArgs, runClones, validateAgainstRef } from '../clones-cli';

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

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * A `fixtureRepo` with real git history: `src/a.ts` holds the duplicated body
 * and `src/b.ts` a placeholder, both committed. Callers dirty `src/b.ts` to
 * produce a tracked change the diff can see — an untracked file has no
 * post-image in `git diff`, so a brand-new file would be invisible here.
 */
function gitFixtureRepo(config?: object): string {
  const dir = fixtureRepo(config);
  writeFileSync(join(dir, 'src', 'b.ts'), 'export const placeholder = 1;\n', 'utf8');
  git(dir, 'init', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'fixture@example.com');
  git(dir, 'config', 'user.name', 'fixture');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'baseline');
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
    expect(parseClonesArgs(['check', '--against', 'origin/main'])).toMatchObject({
      against: 'origin/main',
    });
    expect(() => parseClonesArgs(['check', '--against'])).toThrow(/needs a ref/);
    expect(parseClonesArgs(['baseline', '--min-tokens', '30'])).toMatchObject({
      sub: 'baseline',
      minTokens: 30,
    });
    // `--against` only means something to `check`; elsewhere it is a usage error
    // rather than a silently ignored flag.
    expect(() => parseClonesArgs(['baseline', '--against', 'origin/main'])).toThrow(/check.* only/);
    expect(() => parseClonesArgs(['report', '--against', 'origin/main'])).toThrow(/check.* only/);
  });
});

describe('validateAgainstRef', () => {
  it('passes a ref git resolves and rejects one it does not', () => {
    const run = (args: readonly string[]) => ({
      status: args.join(' ').includes('good^{commit}') ? 0 : 1,
      stdout: '',
      stderr: '',
    });
    expect(validateAgainstRef('good', run)).toBe(true);
    expect(validateAgainstRef('bad', run)).toBe(false);
  });

  it('passes --end-of-options so a leading-dash value stays a ref', () => {
    const calls: Array<readonly string[]> = [];
    validateAgainstRef('--weird', (args) => {
      calls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    });
    expect(calls[0]).toContain('--end-of-options');
    expect(calls[0]?.indexOf('--end-of-options')).toBeLessThan(
      calls[0]?.indexOf('--weird^{commit}') ?? -1,
    );
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

  it('diff-scoped check reds on a clone the working tree just introduced', async () => {
    let err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    const dir = gitFixtureRepo();
    // Paste a.ts's body into the tracked placeholder — a change the diff sees.
    writeFileSync(join(dir, 'src', 'b.ts'), fn('second'), 'utf8');
    expect(await runClones(['check', '--against', 'HEAD', '--min-tokens', '30'], dir)).toBe(1);
    expect(err).toContain('duplicated in this change');
    expect(err).toContain('src/a.ts:1-');
    expect(err).toContain('src/b.ts:1-');
  });

  it('diff-scoped check stays green when the change touches no clone', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const dir = gitFixtureRepo();
    writeFileSync(join(dir, 'src', 'b.ts'), 'export const placeholder = 2;\n', 'utf8');
    expect(await runClones(['check', '--against', 'HEAD', '--min-tokens', '30'], dir)).toBe(0);
  });

  it('clones.diffScope false disables the diff-scoped verdict only', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const off = gitFixtureRepo({ clones: { diffScope: false } });
    writeFileSync(join(off, 'src', 'b.ts'), fn('second'), 'utf8');
    expect(await runClones(['check', '--against', 'HEAD', '--min-tokens', '30'], off)).toBe(0);

    // …while the corpus threshold still speaks for itself.
    const tight = gitFixtureRepo({ clones: { diffScope: false, thresholdPct: 1 } });
    writeFileSync(join(tight, 'src', 'b.ts'), fn('second'), 'utf8');
    expect(await runClones(['check', '--against', 'HEAD', '--min-tokens', '30'], tight)).toBe(1);
  });

  it('an unresolvable --against exits 3 whether or not diff-scoping is on', async () => {
    let err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    const on = gitFixtureRepo();
    expect(await runClones(['check', '--against', 'no/such/ref'], on)).toBe(3);
    expect(err).toContain('does not resolve');

    const off = gitFixtureRepo({ clones: { diffScope: false } });
    expect(await runClones(['check', '--against', 'no/such/ref'], off)).toBe(3);
  });

  it('fails open with a note — never 3 — when the base cannot be related to HEAD', async () => {
    let out = '';
    let err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });

    // A resolvable ref with unrelated history: `merge-base` finds nothing.
    const unrelated = gitFixtureRepo();
    git(unrelated, 'checkout', '--orphan', 'other');
    writeFileSync(join(unrelated, 'src', 'c.ts'), 'export const c = 1;\n', 'utf8');
    git(unrelated, 'add', '-A');
    git(unrelated, 'commit', '-m', 'orphan');
    git(unrelated, 'checkout', 'main');
    expect(await runClones(['check', '--against', 'other', '--min-tokens', '30'], unrelated)).toBe(
      0,
    );
    expect(err).toContain('no base to diff against');

    // No flag and no resolvable base (no upstream, no remote): same green skip.
    err = '';
    const bare = gitFixtureRepo();
    expect(await runClones(['check', '--min-tokens', '30'], bare)).toBe(0);
    expect(err).toContain('no base to diff against');
    expect(out).toContain('no clones.thresholdPct configured');
  });

  it('outside a git repo the diff-scoped verdict is skipped, not failed', async () => {
    let err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    expect(await runClones(['check', '--min-tokens', '30'], fixtureRepo())).toBe(0);
    expect(err).toContain('no base to diff against');
  });

  it('baseline records the corpus, then check reds only once duplication grows', async () => {
    let out = '';
    let err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    const dir = fixtureRepo();

    expect(await runClones(['baseline', '--min-tokens', '30'], dir)).toBe(0);
    expect(out).toContain('clones baseline: recorded');
    const recorded = JSON.parse(
      readFileSync(join(dir, '.noldor', 'clones-baseline.json'), 'utf8'),
    ) as { duplicatedTokens: number };
    expect(recorded.duplicatedTokens).toBeGreaterThan(0);

    // Same corpus → at baseline, green.
    out = '';
    expect(await runClones(['check', '--min-tokens', '30'], dir)).toBe(0);
    expect(out).toContain('duplicated tokens at baseline');

    // A third copy of the same body raises whole-corpus duplication.
    writeFileSync(join(dir, 'src', 'c.ts'), fn('third'), 'utf8');
    expect(await runClones(['check', '--min-tokens', '30'], dir)).toBe(1);
    expect(err).toContain('duplicated tokens rose');
  });

  it('the ratchet is skipped without a baseline, and by clones.ratchet false', async () => {
    let out = '';
    let err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });

    // A missing baseline is a could-not-compare state, so it lands on stderr:
    // a quiet stdout line is how deleting the file would silence the ratchet.
    const noBaseline = fixtureRepo();
    expect(await runClones(['check', '--min-tokens', '30'], noBaseline)).toBe(0);
    expect(err).toContain('no .noldor/clones-baseline.json - ratchet skipped');

    // A deliberate opt-out is not a surprise, so it stays on stdout — even
    // though the corpus has grown well past what was recorded.
    const off = fixtureRepo({ clones: { ratchet: false } });
    expect(await runClones(['baseline', '--min-tokens', '30'], off)).toBe(0);
    writeFileSync(join(off, 'src', 'c.ts'), fn('third'), 'utf8');
    out = '';
    expect(await runClones(['check', '--min-tokens', '30'], off)).toBe(0);
    expect(out).toContain('ratchet disabled');
  });

  it('re-recording a baseline names the direction it moved', async () => {
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const dir = fixtureRepo();

    // First record has nothing to compare against.
    expect(await runClones(['baseline', '--min-tokens', '30'], dir)).toBe(0);
    expect(out).not.toContain('RAISED');

    // A third copy raises duplication; re-recording loosens the ratchet, and
    // says so.
    out = '';
    writeFileSync(join(dir, 'src', 'c.ts'), fn('third'), 'utf8');
    expect(await runClones(['baseline', '--min-tokens', '30'], dir)).toBe(0);
    expect(out).toContain('RAISED from');

    // Removing it again lowers the number back.
    out = '';
    writeFileSync(join(dir, 'src', 'c.ts'), 'export const c = 1;\n', 'utf8');
    expect(await runClones(['baseline', '--min-tokens', '30'], dir)).toBe(0);
    expect(out).toContain('lowered from');
  });

  it('a baseline recorded under other options is reported on stderr, not red', async () => {
    let err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    const dir = fixtureRepo();
    expect(await runClones(['baseline', '--min-tokens', '30'], dir)).toBe(0);
    writeFileSync(join(dir, 'src', 'c.ts'), fn('third'), 'utf8');
    err = '';
    // Default min-tokens (50) ≠ the recorded 30 → not comparable. Exit 0, but
    // on stderr: a can't-compare notice on stdout is invisible in CI.
    expect(await runClones(['check'], dir)).toBe(0);
    expect(err).toContain('not comparable');
  });

  it('an unreadable baseline exits 3 — "could not look", not "clean"', async () => {
    let err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    const dir = fixtureRepo();
    writeFileSync(join(dir, '.noldor', 'clones-baseline.json'), '{ truncated', 'utf8');
    expect(await runClones(['check', '--min-tokens', '30'], dir)).toBe(3);
    expect(err).toContain('unreadable');

    // …but a real blocker still outranks it: exit 1 names the duplication.
    const tight = fixtureRepo({ clones: { thresholdPct: 1 } });
    writeFileSync(join(tight, '.noldor', 'clones-baseline.json'), '{ truncated', 'utf8');
    expect(await runClones(['check', '--min-tokens', '30'], tight)).toBe(1);
  });

  it('loadCorpus skips test files by default and returns repo-relative keys', () => {
    const dir = fixtureRepo();
    writeFileSync(join(dir, 'src', 'a.test.ts'), fn('t'), 'utf8');
    expect([...loadCorpus(dir, false).keys()].sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect([...loadCorpus(dir, true).keys()]).toContain('src/a.test.ts');
  });
});
