// @tests: self-refreshing-compact-knowledge-graph
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  type BuildDeps,
  LOCK_PATH,
  lockMinor,
  main,
  type RunOptions,
  type RunResult,
  type Runner,
  spawnRunner,
} from '../build.js';

const OK: RunResult = { status: 0, stdout: '', stderr: '' };
const OUTPUT_NAMES = [
  'GRAPH_REPORT.md',
  'graph.brainstorm-summary.toon',
  'graph.brainstorm.toon',
  'graph.json',
];

let buildNumber = 0;
const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function commitAll(repo: string, message: string): string {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', message);
  return git(repo, 'rev-parse', 'HEAD');
}

function makeRepo(): string {
  const repo = tempDir('graphify-build-repo-');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 'T');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1;\n');
  commitAll(repo, 'base');
  return repo;
}

function filesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .toSorted();
}

function readOrNull(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

interface RecipeCall {
  readonly files: string[];
  readonly a: string | null;
  readonly env: NodeJS.ProcessEnv;
}

interface FakePython {
  /** What the interpreter reports; `null` = no interpreter on PATH. */
  readonly version?: string | null;
  readonly venvFails?: boolean;
  readonly installFails?: boolean;
  readonly recipeFails?: boolean;
}

/**
 * Real git, scripted Python. The recipe stand-in records what it was shown and
 * writes a report numbered across every build in this file, so a case can tell
 * a rebuild from a no-op.
 */
function fakePython(python: FakePython, calls: RecipeCall[]): Runner {
  return (cmd: string, args: readonly string[], opts: RunOptions): RunResult => {
    if (cmd === 'git') return spawnRunner(cmd, args, opts);
    if (args[0] === '-c') {
      const version = python.version === undefined ? '3.13.4' : python.version;
      return version === null
        ? { status: null, stdout: '', stderr: '', error: new Error('spawn python3 ENOENT') }
        : { ...OK, stdout: `${version}\n` };
    }
    if (args[1] === 'venv') {
      if (python.venvFails) return { status: 1, stdout: '', stderr: 'venv: cannot create' };
      mkdirSync(join(args[2]!, 'bin'), { recursive: true });
      return OK;
    }
    if (args.includes('install')) {
      return python.installFails
        ? {
            status: 1,
            stdout: '',
            stderr: 'ERROR: No matching distribution found for networkx==3.7',
          }
        : OK;
    }
    if (args.includes('check')) return OK;

    calls.push({
      files: filesUnder(opts.cwd),
      a: readOrNull(join(opts.cwd, 'src/a.ts')),
      env: opts.env,
    });
    if (python.recipeFails) return { status: 1, stdout: '', stderr: 'Traceback: recipe crashed' };
    buildNumber += 1;
    const flag = (name: string) => args[args.indexOf(name) + 1]!;
    const out = flag('--out');
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, 'GRAPH_REPORT.md'),
      `# Graph Report - .  (${flag('--date')})\nbuild ${buildNumber}\n`,
    );
    writeFileSync(
      join(out, 'graph.json'),
      JSON.stringify({
        nodes: [
          { id: 'alpha', label: 'alphaNode', community: 0, source_file: 'src/a.ts' },
          { id: 'beta', label: 'betaNode', community: 1, source_file: 'src/b.ts' },
        ],
        links: [{ source: 'alpha', target: 'beta', relation: 'calls' }],
        built_at_commit: flag('--commit'),
      }),
    );
    return OK;
  };
}

interface Harness {
  readonly deps: BuildDeps;
  readonly calls: RecipeCall[];
  readonly lines: string[];
  readonly errors: string[];
}

function harness(
  cwd: string,
  cache: string,
  python: FakePython = {},
  env: NodeJS.ProcessEnv = {},
): Harness {
  const calls: RecipeCall[] = [];
  const lines: string[] = [];
  const errors: string[] = [];
  const deps: BuildDeps = {
    run: fakePython(python, calls),
    env: { ...process.env, XDG_CACHE_HOME: cache, ...env },
    cwd,
    log: (line) => lines.push(line),
    warn: (line) => errors.push(line),
  };
  return { deps, calls, lines, errors };
}

function graphOut(repo: string): Record<string, string | null> {
  return Object.fromEntries(
    OUTPUT_NAMES.map((name) => [name, readOrNull(join(repo, 'graphify-out', name))]),
  );
}

function stampOf(repo: string): unknown {
  return JSON.parse(readFileSync(join(repo, 'graphify-out/graph.json'), 'utf8')).built_at_commit;
}

/** A repo whose HEAD commits the graph of the commit before it, as a merged graph PR leaves it. */
function repoWithCommittedGraph(cache: string): { repo: string; built: string } {
  const repo = makeRepo();
  const built = git(repo, 'rev-parse', 'HEAD');
  expect(main(['--force'], harness(repo, cache).deps)).toBe(0);
  commitAll(repo, 'chore(graph): refresh the committed knowledge graph');
  return { repo, built };
}

describe('graphify build — what it builds', () => {
  it('writes the four outputs from HEAD, stamped with HEAD and dated by its commit', () => {
    const repo = makeRepo();
    const head = git(repo, 'rev-parse', 'HEAD');
    const h = harness(repo, tempDir('graphify-cache-'));

    expect(main([], h.deps)).toBe(0);

    expect(filesUnder(join(repo, 'graphify-out'))).toEqual(OUTPUT_NAMES);
    expect(stampOf(repo)).toBe(head);
    const report = readFileSync(join(repo, 'graphify-out/GRAPH_REPORT.md'), 'utf8');
    expect(report.split('\n')[0]).toBe(
      `# Graph Report - .  (${git(repo, 'show', '-s', '--format=%cs', 'HEAD')})`,
    );
    const toon = readFileSync(join(repo, 'graphify-out/graph.brainstorm.toon'), 'utf8');
    expect(toon).toContain('alphaNode');
    expect(toon).toContain('betaNode');
    expect(h.lines.at(-1)).toContain('2 nodes, 1 links, 2 communities');
  });

  it('shows the recipe only what HEAD holds: no uncommitted edit, untracked file or .git', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'src/a.ts'), 'export const a = 2; // not committed\n');
    writeFileSync(join(repo, 'src/scratch.ts'), 'export const scratch = true;\n');
    const h = harness(repo, tempDir('graphify-cache-'));

    expect(main(['--force'], h.deps)).toBe(0);

    expect(h.calls[0]!.files).toEqual(['src/a.ts']);
    expect(h.calls[0]!.a).toBe('export const a = 1;\n');
  });

  it('runs the recipe seeded, without the variables that would reach another package or cache', () => {
    const repo = makeRepo();
    const h = harness(
      repo,
      tempDir('graphify-cache-'),
      {},
      {
        PYTHONPATH: '/elsewhere/site-packages',
        PYTHONHOME: '/elsewhere',
        GRAPHIFY_OUT: '/elsewhere/graphify-out',
      },
    );

    expect(main(['--force'], h.deps)).toBe(0);

    const env = h.calls[0]!.env;
    expect(env.PYTHONHASHSEED).toBe('0');
    expect(env.PYTHONPATH).toBeUndefined();
    expect(env.PYTHONHOME).toBeUndefined();
    expect(env.GRAPHIFY_OUT).toBeUndefined();
  });
});

describe('graphify build — when it is already up to date', () => {
  it('does nothing right after a graph PR: only graphify-out/ changed since the build', () => {
    const cache = tempDir('graphify-cache-');
    const { repo, built } = repoWithCommittedGraph(cache);
    const h = harness(repo, cache);

    expect(main([], h.deps)).toBe(0);

    expect(h.calls).toHaveLength(0);
    expect(stampOf(repo)).toBe(built);
    expect(h.lines[0]).toContain('already built from this tree');
    expect(h.lines[0]).not.toContain('Uncommitted changes');
  });

  it('does nothing for an uncommitted edit or an untracked file, which the build never reads', () => {
    const cache = tempDir('graphify-cache-');
    const { repo } = repoWithCommittedGraph(cache);
    writeFileSync(join(repo, 'src/a.ts'), 'export const a = 3;\n');
    writeFileSync(join(repo, 'src/scratch.ts'), 'export const scratch = true;\n');
    const h = harness(repo, cache);

    expect(main([], h.deps)).toBe(0);

    expect(h.calls).toHaveLength(0);
    expect(h.lines[0]).toContain('Uncommitted changes are not in the graph');
  });

  const rebuilds: [string, (repo: string) => void, string][] = [
    [
      'a commit changed code since the build',
      (repo) => {
        writeFileSync(join(repo, 'src/b.ts'), 'export const b = 1;\n');
        commitAll(repo, 'feat: b');
      },
      'the tree changed since',
    ],
    [
      'graph.json names a commit this repo does not have',
      (repo) => {
        const path = join(repo, 'graphify-out/graph.json');
        const graph = JSON.parse(readFileSync(path, 'utf8'));
        writeFileSync(path, JSON.stringify({ ...graph, built_at_commit: 'f'.repeat(40) }));
        commitAll(repo, 'chore(graph): foreign stamp');
      },
      'does not resolve here',
    ],
    [
      'graph.json carries no stamp',
      (repo) => {
        const path = join(repo, 'graphify-out/graph.json');
        const graph = JSON.parse(readFileSync(path, 'utf8'));
        delete graph.built_at_commit;
        writeFileSync(path, JSON.stringify(graph));
        commitAll(repo, 'chore(graph): no stamp');
      },
      'carries no built_at_commit',
    ],
    [
      'graphify-out/ was edited after HEAD committed it',
      (repo) =>
        writeFileSync(join(repo, 'graphify-out/GRAPH_REPORT.md'), '# a report from elsewhere\n'),
      'differs from what HEAD holds',
    ],
  ];

  it.each(rebuilds)('rebuilds when %s', (_case, change, reason) => {
    const cache = tempDir('graphify-cache-');
    const { repo } = repoWithCommittedGraph(cache);
    change(repo);
    const h = harness(repo, cache);

    expect(main([], h.deps)).toBe(0);

    expect(h.calls).toHaveLength(1);
    expect(h.lines[0]).toContain(reason);
    expect(stampOf(repo)).toBe(git(repo, 'rev-parse', 'HEAD'));
  });

  it('rebuilds an up-to-date graph under --force', () => {
    const cache = tempDir('graphify-cache-');
    const { repo } = repoWithCommittedGraph(cache);
    const h = harness(repo, cache);

    expect(main(['--force'], h.deps)).toBe(0);

    expect(h.calls).toHaveLength(1);
    expect(stampOf(repo)).toBe(git(repo, 'rev-parse', 'HEAD'));
  });
});

describe('graphify build — the Python environment', () => {
  it('reuses the environment it set up instead of creating another', () => {
    const repo = makeRepo();
    const cache = tempDir('graphify-cache-');
    expect(main(['--force'], harness(repo, cache).deps)).toBe(0);

    const h = harness(repo, cache, { venvFails: true });
    expect(main(['--force'], h.deps)).toBe(0);
    expect(h.errors).toEqual([]);
  });

  it('sets the environment up again when its ready marker is missing', () => {
    const repo = makeRepo();
    const cache = tempDir('graphify-cache-');
    expect(main(['--force'], harness(repo, cache).deps)).toBe(0);
    const envRoot = join(cache, 'noldor', 'graphify');
    const [envDir] = readdirSync(envRoot);
    rmSync(join(envRoot, envDir!, '.ready'));

    expect(main(['--force'], harness(repo, cache, { venvFails: true }).deps)).toBe(2);
    expect(main(['--force'], harness(repo, cache).deps)).toBe(0);
    expect(existsSync(join(envRoot, envDir!, '.ready'))).toBe(true);
  });

  const refusals: [string, FakePython, string][] = [
    ['no interpreter runs', { version: null }, 'no Python interpreter runs'],
    ['the interpreter is another Python minor', { version: '3.12.9' }, 'NOLDOR_GRAPHIFY_PYTHON'],
    ['the lock does not install', { installFails: true }, 'No matching distribution found'],
  ];

  it.each(refusals)(
    'exits 2 and leaves graphify-out/ unchanged when %s',
    (_case, python, message) => {
      const cache = tempDir('graphify-cache-');
      const { repo } = repoWithCommittedGraph(cache);
      writeFileSync(join(repo, 'src/b.ts'), 'export const b = 1;\n');
      commitAll(repo, 'feat: b');
      const before = graphOut(repo);
      const h = harness(repo, tempDir('graphify-cache-'), python);

      expect(main([], h.deps)).toBe(2);

      expect(h.errors.join('\n')).toContain(message);
      expect(graphOut(repo)).toEqual(before);
      expect(h.calls).toHaveLength(0);
    },
  );

  it('leaves no half-built environment behind when the install fails', () => {
    const repo = makeRepo();
    const cache = tempDir('graphify-cache-');

    expect(main(['--force'], harness(repo, cache, { installFails: true }).deps)).toBe(2);

    expect(readdirSync(join(cache, 'noldor', 'graphify'))).toEqual([]);
  });
});

describe('graphify build — failures', () => {
  it('exits 1 on a recipe failure and leaves graphify-out/ unchanged', () => {
    const cache = tempDir('graphify-cache-');
    const { repo } = repoWithCommittedGraph(cache);
    const before = graphOut(repo);
    const h = harness(repo, cache, { recipeFails: true });

    expect(main(['--force'], h.deps)).toBe(1);

    expect(h.errors.join('\n')).toContain('recipe crashed');
    expect(graphOut(repo)).toEqual(before);
  });

  it('exits 1 naming the restore command when a write fails partway, before graph.json', () => {
    const cache = tempDir('graphify-cache-');
    const { repo, built } = repoWithCommittedGraph(cache);
    const before = graphOut(repo);
    const toon = join(repo, 'graphify-out/graph.brainstorm.toon');
    rmSync(toon);
    mkdirSync(join(toon, 'in-the-way'), { recursive: true });
    const h = harness(repo, cache);

    expect(main(['--force'], h.deps)).toBe(1);

    expect(h.errors.join('\n')).toContain('git checkout -- graphify-out/');
    expect(readOrNull(join(repo, 'graphify-out/GRAPH_REPORT.md'))).not.toBe(
      before['GRAPH_REPORT.md'],
    );
    expect(stampOf(repo)).toBe(built);
  });

  it('exits 1 outside a git work tree', () => {
    const h = harness(tempDir('graphify-not-a-repo-'), tempDir('graphify-cache-'));

    expect(main([], h.deps)).toBe(1);
    expect(h.errors.join('\n')).toContain('not inside a git work tree');
  });

  it('exits 1 on an unknown argument', () => {
    const h = harness(makeRepo(), tempDir('graphify-cache-'));

    expect(main(['--frce'], h.deps)).toBe(1);
    expect(h.errors.join('\n')).toContain("unknown argument '--frce'");
  });
});

describe('graphify build — the recipe', () => {
  const recipe = readFileSync(join(process.cwd(), 'src/graphify/build-graph.py'), 'utf8');

  it('sorts its input and extracts in one process, as every committed graph was built', () => {
    // Unsorted, node order follows the filesystem's listing order.
    expect(recipe).toMatch(/code = sorted\(/);
    expect(recipe).toContain('parallel=False');
  });

  it('keeps the parse cache inside the copy it builds, never the repo', () => {
    expect(recipe).toContain("cache_root=Path('.')");
  });
});

describe('graphify build — the lock', () => {
  const lock = readFileSync(LOCK_PATH, 'utf8');
  const pins = lock.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));

  it('pins every package to one exact version', () => {
    expect(pins.length).toBeGreaterThan(0);
    for (const pin of pins) expect(pin).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*==[0-9][^\s=<>!~;,]*$/);
    expect(pins.some((pin) => pin.startsWith('graphifyy=='))).toBe(true);
  });

  it('names the Python minor it was frozen under', () => {
    expect(lockMinor(lock)).toMatch(/^3\.\d+$/);
    expect(lockMinor('networkx==3.7\n')).toBeNull();
    expect(lockMinor('# python: 3.14\nnetworkx==3.7\n')).toBe('3.14');
  });

  it.each([
    '.github/workflows/update-knowledge-graph.yml',
    'templates/.github/workflows/update-knowledge-graph.yml',
  ])('%s sets up the Python minor the lock was frozen under', (workflow) => {
    const yaml = readFileSync(join(process.cwd(), workflow), 'utf8');
    expect(yaml).toContain(`python-version: '${lockMinor(lock)}'`);
  });
});
