// @tests: graph-and-main-freshness-before-coding, self-refreshing-compact-knowledge-graph
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { scratchDir } from '../../core/scratch-dir.js';
import { codeFreshness, type BuildOutcome } from '../code-freshness.js';
import { parseArgs, renderReport } from '../code-freshness-cli.js';

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function write(root: string, rel: string, body: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body, 'utf8');
}

function commitAll(cwd: string, msg: string): void {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', msg);
}

const CONFIG = JSON.stringify({
  consumer: {
    name: 'fixture',
    repoUrl: 'https://example.com/x/y',
    lockstepPackages: ['package.json'],
    scanPaths: [],
    boundaries: [],
    deprecatedPackages: [],
    e2ePrefix: '',
    samplesPath: '',
    packagePrefix: '',
    pnpmStderrPrefix: '',
    appPathPrefix: '',
  },
});

const VALID_GRAPH = JSON.stringify({
  nodes: [
    { id: 'src_a_ts', label: 'a.ts', source_file: 'src/a.ts', source_location: 'L1', community: 1 },
  ],
  links: [],
});

/**
 * An `origin` bare repo plus two clones: `work` (the session's branch) and
 * `other` (another session pushing to main). Both start from one commit.
 */
function fixture(root: string, opts: { graph?: string } = {}): { work: string; other: string } {
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'init', '-q', '-b', 'main', seed);
  write(seed, '.noldor/config.json', CONFIG);
  write(seed, 'src/a.ts', 'export const a = 1;\n');
  write(seed, 'src/b.ts', 'export const b = 1;\n');
  if (opts.graph !== undefined) write(seed, 'graphify-out/graph.json', opts.graph);
  commitAll(seed, 'seed');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', '-q', 'origin', 'main');
  const work = join(root, 'work');
  const other = join(root, 'other');
  git(root, 'clone', '-q', origin, work);
  git(root, 'clone', '-q', origin, other);
  return { work, other };
}

function pushToMain(other: string, rel: string, body: string, msg: string): void {
  write(other, rel, body);
  commitAll(other, msg);
  git(other, 'push', '-q', 'origin', 'main');
}

const noBuild = (): BuildOutcome => {
  throw new Error('build must not run');
};

describe('codeFreshness — main leg', () => {
  it('reports current when origin/main has nothing new', async () => {
    using tmp = scratchDir('freshness-');
    const { work } = fixture(tmp.path);
    const r = await codeFreshness({ cwd: work, files: ['src/a.ts'], rebuild: false });
    expect(r.main).toMatchObject({ verdict: 'current', behind: 0, overlap: 'none' });
    expect(r.main.rebaseAdvised).toBe(false);
  });

  it('counts new commits, lists the ones touching the files and advises a rebase', async () => {
    using tmp = scratchDir('freshness-');
    const { work, other } = fixture(tmp.path);
    pushToMain(other, 'src/a.ts', 'export const a = 2;\n', 'change a');
    pushToMain(other, 'src/c.ts', 'export const c = 1;\n', 'add c');

    const r = await codeFreshness({ cwd: work, files: ['src/a.ts', 'src/b.ts'], rebuild: false });
    expect(r.main).toMatchObject({
      verdict: 'behind',
      behind: 2,
      graphOnly: 0,
      overlap: 'touching',
    });
    expect(r.main.touching).toHaveLength(1);
    expect(r.main.touching[0]).toMatchObject({ subject: 'change a', files: ['src/a.ts'] });
    expect(r.main.rebaseAdvised).toBe(true);
  });

  it('counts graph-refresh commits apart and does not advise a rebase for them', async () => {
    using tmp = scratchDir('freshness-');
    const { work, other } = fixture(tmp.path);
    pushToMain(other, 'graphify-out/graph.json', VALID_GRAPH, 'chore(graph): refresh');

    const r = await codeFreshness({ cwd: work, files: [], rebuild: false });
    expect(r.main).toMatchObject({
      verdict: 'behind',
      behind: 1,
      graphOnly: 1,
      overlap: 'unknown',
    });
    expect(r.main.rebaseAdvised).toBe(false);
  });

  it('with no files, advises a rebase once any non-graph commit landed', async () => {
    using tmp = scratchDir('freshness-');
    const { work, other } = fixture(tmp.path);
    pushToMain(other, 'src/c.ts', 'export const c = 1;\n', 'add c');

    const r = await codeFreshness({ cwd: work, files: [], rebuild: false });
    expect(r.main).toMatchObject({ overlap: 'unknown', rebaseAdvised: true, touching: [] });
  });

  it('sees a file a merge commit on main brought in', async () => {
    using tmp = scratchDir('freshness-');
    const { work, other } = fixture(tmp.path);
    git(other, 'checkout', '-qb', 'side');
    write(other, 'src/a.ts', 'export const a = 3;\n');
    commitAll(other, 'side change a');
    git(other, 'checkout', '-q', 'main');
    pushToMain(other, 'src/c.ts', 'export const c = 1;\n', 'add c');
    git(other, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    git(other, 'push', '-q', 'origin', 'main');

    const r = await codeFreshness({ cwd: work, files: ['src/a.ts'], rebuild: false });
    expect(r.main.overlap).toBe('touching');
    expect(r.main.touching.map((c) => c.subject)).toContain('merge side');
  });

  it('matches a non-ASCII path git would otherwise C-quote', async () => {
    using tmp = scratchDir('freshness-');
    const { work, other } = fixture(tmp.path);
    pushToMain(other, 'src/café.ts', 'export const c = 1;\n', 'add café');

    const r = await codeFreshness({ cwd: work, files: ['src/café.ts'], rebuild: false });
    expect(r.main.touching[0]).toMatchObject({ subject: 'add café', files: ['src/café.ts'] });
  });

  it('reports unknown when the fetch fails, and the graph leg still answers', async () => {
    using tmp = scratchDir('freshness-');
    const { work } = fixture(tmp.path);
    git(work, 'remote', 'set-url', 'origin', join(tmp.path, 'missing.git'));

    const r = await codeFreshness({ cwd: work, files: ['src/a.ts'], rebuild: false });
    expect(r.main).toMatchObject({ verdict: 'unknown', behind: 0, rebaseAdvised: false });
    expect(r.main.reason).toMatch(/could not fetch/);
    expect(r.graph.verdict).toBe('skipped');
  });
});

describe('codeFreshness — graph leg', () => {
  const BROKEN = '{ not json';

  function graphStatus(work: string): string {
    return git(work, 'status', '--porcelain', '--', 'graphify-out/');
  }

  it('skips when no graph is tracked, without building', async () => {
    using tmp = scratchDir('freshness-');
    const { work } = fixture(tmp.path);
    const r = await codeFreshness({ cwd: work, files: [], rebuild: true, runBuild: noBuild });
    expect(r.graph.verdict).toBe('skipped');
  });

  it('reports stale without --rebuild and never builds', async () => {
    using tmp = scratchDir('freshness-');
    const { work } = fixture(tmp.path, { graph: BROKEN });
    const r = await codeFreshness({ cwd: work, files: [], rebuild: false, runBuild: noBuild });
    expect(r.graph.verdict).toBe('stale');
  });

  it('rebuilds a stale graph, reads the rebuilt one, then restores graphify-out/', async () => {
    using tmp = scratchDir('freshness-');
    const { work } = fixture(tmp.path, { graph: BROKEN });
    // The working-tree freshness leg needs the graph newer than every scanned file.
    const past = new Date(Date.now() - 60_000);
    for (const f of ['src/a.ts', 'src/b.ts']) utimesSync(join(work, f), past, past);

    const r = await codeFreshness({
      cwd: work,
      files: ['src/a.ts'],
      rebuild: true,
      runBuild: (cwd) => {
        write(cwd, 'graphify-out/graph.json', VALID_GRAPH);
        write(cwd, 'graphify-out/GRAPH_REPORT.md', 'new\n');
        return { ok: true };
      },
    });

    expect(r.graph.verdict).toBe('rebuilt-fresh');
    expect(r.graph.digests[0]).toMatchObject({ path: 'src/a.ts', inGraph: true, community: 1 });
    expect(r.graph.warnings).toEqual([]);
    expect(graphStatus(work)).toBe('');
    expect(readFileSync(join(work, 'graphify-out/graph.json'), 'utf8')).toBe(BROKEN);
  });

  it('restores graphify-out/ when the build fails partway', async () => {
    using tmp = scratchDir('freshness-');
    const { work } = fixture(tmp.path, { graph: BROKEN });

    const r = await codeFreshness({
      cwd: work,
      files: [],
      rebuild: true,
      runBuild: (cwd) => {
        write(cwd, 'graphify-out/graph.json', '{ half');
        write(cwd, 'graphify-out/partial.json', '{}');
        return { ok: false, reason: 'python not found' };
      },
    });

    expect(r.graph).toMatchObject({ verdict: 'rebuild-failed', reason: 'python not found' });
    expect(graphStatus(work)).toBe('');
  });

  it('leaves an already-dirty graphify-out/ alone', async () => {
    using tmp = scratchDir('freshness-');
    const { work } = fixture(tmp.path, { graph: BROKEN });
    write(work, 'graphify-out/graph.json', '{ someone else');

    const r = await codeFreshness({ cwd: work, files: [], rebuild: true, runBuild: noBuild });

    expect(r.graph.verdict).toBe('rebuild-skipped-dirty');
    expect(readFileSync(join(work, 'graphify-out/graph.json'), 'utf8')).toBe('{ someone else');
  });
});

describe('worktrees freshness CLI', () => {
  it('normalizes and de-duplicates --file, accepts none', () => {
    expect(parseArgs([], '/repo')).toEqual({ ok: true, files: [], rebuild: false, json: false });
    expect(
      parseArgs(['--file', '/repo/src/a.ts', '--file', 'src/a.ts', '--rebuild', '--json'], '/repo'),
    ).toEqual({ ok: true, files: ['src/a.ts'], rebuild: true, json: true });
  });

  it('refuses unknown flags, a missing value and paths outside the repo', () => {
    expect(parseArgs(['--nope'], '/repo').ok).toBe(false);
    expect(parseArgs(['--file'], '/repo').ok).toBe(false);
    expect(parseArgs(['--file', '/elsewhere/x.ts'], '/repo').ok).toBe(false);
  });

  it('prints the rebase step only when the main leg advises it', async () => {
    using tmp = scratchDir('freshness-');
    const { work, other } = fixture(tmp.path);
    const quiet = renderReport(
      await codeFreshness({ cwd: work, files: ['src/a.ts'], rebuild: false }),
    );
    expect(quiet).not.toMatch(/git rebase origin\/main/);

    pushToMain(other, 'src/a.ts', 'export const a = 2;\n', 'change a');
    const loud = renderReport(
      await codeFreshness({ cwd: work, files: ['src/a.ts'], rebuild: false }),
    );
    expect(loud).toMatch(/git rebase origin\/main/);
    expect(loud).toMatch(/change a — touches src\/a\.ts/);
  });
});
