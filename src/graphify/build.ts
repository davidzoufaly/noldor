/**
 * `noldor graphify build`: the one builder of the committed knowledge graph.
 *
 * The release sweep and the `update-knowledge-graph` workflow both call it, so a
 * release and CI commit graphs from one recipe (`build-graph.py`) under one set
 * of Python packages (`graphify-requirements.txt`). Those packages decide the
 * clustering: the same recipe under different networkx or tree-sitter versions
 * splits the same nodes into different communities.
 *
 * The build reads a copy of HEAD's tree, never the working tree, so the
 * `built_at_commit` stamp always names the tree the graph came from. Uncommitted
 * edits and untracked files never reach the graph.
 *
 * Exit 0 = built, or already built from this tree; 1 = the build failed, an
 * unknown argument, or not a git work tree; 2 = no usable Python environment.
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { atomicWriteFileSync } from '../core/atomic-write.js';
import { isEntrypoint } from '../core/cli-entry.js';
import {
  buildContext,
  type GraphData,
  renderBrainstormSummary,
  renderBrainstormToon,
} from './graph-to-toon.js';

/** One finished subprocess. `error` is set when it could not start or hit its timeout. */
export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

export interface RunOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

/** Runs one subprocess to completion — the seam tests use to stand in for Python. */
export type Runner = (cmd: string, args: readonly string[], opts: RunOptions) => RunResult;

export interface BuildDeps {
  readonly run: Runner;
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly log: (line: string) => void;
  readonly warn: (line: string) => void;
}

/**
 * The files the build writes into `graphify-out/`, in write order. `graph.json`
 * goes last because it carries the stamp the up-to-date check trusts: a write
 * that fails partway never leaves a new stamp beside old companions.
 */
export const OUTPUTS = [
  'GRAPH_REPORT.md',
  'graph.brainstorm.toon',
  'graph.brainstorm-summary.toon',
  'graph.json',
] as const;

/** The pinned packages, shipped beside this module. */
export const LOCK_PATH = fileURLToPath(new URL('./graphify-requirements.txt', import.meta.url));
const SCRIPT_PATH = fileURLToPath(new URL('./build-graph.py', import.meta.url));
const READY_MARKER = '.ready';
const LABEL = 'graphify build';

const SHORT_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 15 * 60_000;
const BUILD_TIMEOUT_MS = 15 * 60_000;

type Step<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Step<T> => ({ ok: true, value });
const fail = <T>(error: string): Step<T> => ({ ok: false, error });

export const spawnRunner: Runner = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    encoding: 'utf8',
    timeout: opts.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
};

function failed(r: RunResult): boolean {
  return r.error !== undefined || r.status !== 0;
}

/** The last lines a failed subprocess printed, for the error message. */
function tail(r: RunResult): string {
  const text = `${r.stderr}\n${r.stdout}`.trim();
  return r.error?.message ?? (text.split('\n').slice(-8).join('\n') || `exit ${r.status}`);
}

function git(deps: BuildDeps, cwd: string, args: readonly string[], env = deps.env): RunResult {
  return deps.run('git', args, { cwd, env, timeoutMs: SHORT_TIMEOUT_MS });
}

/** The Python minor the lock was frozen under, from its `# python: <major>.<minor>` line. */
export function lockMinor(lock: string): string | null {
  return /^# python: (\d+\.\d+)$/m.exec(lock)?.[1] ?? null;
}

function readStamp(graphPath: string): Step<string> {
  let text: string;
  try {
    text = readFileSync(graphPath, 'utf8');
  } catch (err) {
    return fail(`no readable graphify-out/graph.json (${(err as NodeJS.ErrnoException).code})`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return fail(`graphify-out/graph.json is not JSON (${(err as Error).message})`);
  }
  const stamp =
    typeof data === 'object' && data !== null
      ? (data as { built_at_commit?: unknown }).built_at_commit
      : undefined;
  return typeof stamp === 'string' && stamp !== ''
    ? ok(stamp)
    : fail('graphify-out/graph.json carries no built_at_commit');
}

/**
 * Why `graphify-out/` needs a rebuild, or `null` when it already holds the graph
 * of HEAD's tree: its files match HEAD's, and no file outside it changed between
 * the commit the graph names and HEAD. A graph PR changes only `graphify-out/`,
 * so the build that follows one is a no-op.
 */
function staleReason(deps: BuildDeps, root: string, head: string): string | null {
  const outputs = OUTPUTS.map((name) => `graphify-out/${name}`);
  if (failed(git(deps, root, ['diff', '--quiet', 'HEAD', '--', ...outputs]))) {
    return 'graphify-out/ differs from what HEAD holds';
  }
  const stamp = readStamp(join(root, 'graphify-out', 'graph.json'));
  if (!stamp.ok) return stamp.error;
  const since = git(deps, root, [
    'diff',
    '--quiet',
    stamp.value,
    head,
    '--',
    '.',
    ':(exclude)graphify-out',
  ]);
  if (!failed(since)) return null;
  return since.status === 1
    ? `the tree changed since ${stamp.value.slice(0, 7)}, the commit the graph was built from`
    : `the graph names ${stamp.value.slice(0, 7)}, which does not resolve here`;
}

/**
 * The graph checks that read file mtimes call uncommitted source edits stale,
 * and no rebuild can clear that: the build reads HEAD. Saying so is what keeps
 * an operator from rebuilding in a loop.
 */
function uncommittedNote(deps: BuildDeps, root: string): string {
  const status = git(deps, root, ['status', '--porcelain', '--', '.', ':(exclude)graphify-out']);
  return !failed(status) && status.stdout.trim() !== ''
    ? '. Uncommitted changes are not in the graph, which describes HEAD — commit them, then build again'
    : '';
}

function environmentRoot(env: NodeJS.ProcessEnv): string {
  return join(env.XDG_CACHE_HOME || join(env.HOME || homedir(), '.cache'), 'noldor', 'graphify');
}

/**
 * A venv holding exactly the lock's packages, under the user cache and keyed by
 * the lock's bytes and the interpreter's version. It is built beside its final
 * path and renamed into place, so a directory at that path is always complete
 * and two first builds racing each other both end up using one of them.
 */
function ensureEnvironment(deps: BuildDeps): Step<string> {
  const interpreter = deps.env.NOLDOR_GRAPHIFY_PYTHON || 'python3';
  const lock = readFileSync(LOCK_PATH, 'utf8');
  const minor = lockMinor(lock);
  if (minor === null) throw new Error(`${LOCK_PATH} names no Python minor (# python: <x.y>)`);

  const probe = deps.run(
    interpreter,
    ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'],
    {
      cwd: deps.cwd,
      env: deps.env,
      timeoutMs: SHORT_TIMEOUT_MS,
    },
  );
  if (failed(probe)) {
    return fail(
      `no Python interpreter runs as '${interpreter}' (${tail(probe)}) — install Python ${minor} or point NOLDOR_GRAPHIFY_PYTHON at one`,
    );
  }
  const version = probe.stdout.trim();
  if (!version.startsWith(`${minor}.`)) {
    return fail(
      `'${interpreter}' is Python ${version}, but the graph's packages are pinned under Python ${minor} — point NOLDOR_GRAPHIFY_PYTHON at a Python ${minor} interpreter`,
    );
  }

  const key = createHash('sha256').update(lock).update('\0').update(version).digest('hex');
  const dir = join(environmentRoot(deps.env), key.slice(0, 16));
  const python = join(dir, 'bin', 'python');
  if (existsSync(join(dir, READY_MARKER))) return ok(python);

  const staging = `${dir}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    const built = createEnvironment(deps, interpreter, staging, version);
    if (!built.ok) return built;
    const published = publishEnvironment(staging, dir);
    return published.ok ? ok(python) : published;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function createEnvironment(
  deps: BuildDeps,
  interpreter: string,
  staging: string,
  version: string,
): Step<void> {
  mkdirSync(dirname(staging), { recursive: true });
  const python = join(staging, 'bin', 'python');
  const steps: [string, string[]][] = [
    [interpreter, ['-m', 'venv', staging]],
    // --no-deps: only packages the lock names can enter, so a lock missing a
    // dependency fails `pip check` below instead of silently floating it.
    [
      python,
      [
        '-m',
        'pip',
        'install',
        '--no-deps',
        '--disable-pip-version-check',
        '--quiet',
        '--requirement',
        LOCK_PATH,
      ],
    ],
    [python, ['-m', 'pip', 'check', '--disable-pip-version-check']],
  ];
  for (const [cmd, args] of steps) {
    const r = deps.run(cmd, args, { cwd: deps.cwd, env: deps.env, timeoutMs: INSTALL_TIMEOUT_MS });
    if (failed(r)) return fail(`${[cmd, ...args.slice(0, 3)].join(' ')} failed: ${tail(r)}`);
  }
  writeFileSync(join(staging, READY_MARKER), `${version}\n`);
  return ok(undefined);
}

function tryRename(from: string, to: string): Error | null {
  try {
    renameSync(from, to);
    return null;
  } catch (err) {
    return err as Error;
  }
}

/**
 * Move a finished venv to `dir`. A rename cannot land on a non-empty directory,
 * so a refusal means something is already there: a complete venv is another
 * build that published first, and anything without the marker was not left by
 * this builder, blocks every publish, and goes.
 */
function publishEnvironment(staging: string, dir: string): Step<void> {
  if (tryRename(staging, dir) === null || existsSync(join(dir, READY_MARKER))) return ok(undefined);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    return fail(`cannot clear ${dir} for the Python environment: ${(err as Error).message}`);
  }
  const retry = tryRename(staging, dir);
  return retry === null
    ? ok(undefined)
    : fail(`cannot move the Python environment into ${dir}: ${retry.message}`);
}

/** The environment Python runs in: none of the variables that would let it read another package or cache. */
function pythonEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dropped = new Set(['PYTHONPATH', 'PYTHONHOME', 'GRAPHIFY_OUT']);
  return {
    ...Object.fromEntries(Object.entries(env).filter(([name]) => !dropped.has(name))),
    PYTHONHASHSEED: '0',
  };
}

function scratchDir(): { path: string } & Disposable {
  const path = mkdtempSync(join(tmpdir(), 'noldor-graphify-'));
  return { path, [Symbol.dispose]: () => rmSync(path, { recursive: true, force: true }) };
}

/** Copy `sha`'s tree into `into/tree/` through a throwaway index, leaving the repo's own untouched. */
function exportTree(deps: BuildDeps, root: string, sha: string, into: string): Step<string> {
  const tree = join(into, 'tree');
  const env = { ...deps.env, GIT_INDEX_FILE: join(into, 'index') };
  for (const args of [
    ['read-tree', sha],
    ['checkout-index', '--all', `--prefix=${tree}/`],
  ]) {
    const r = git(deps, root, args, env);
    if (failed(r)) return fail(`git ${args[0]} failed: ${tail(r)}`);
  }
  return ok(tree);
}

type Outputs = Record<(typeof OUTPUTS)[number], string>;

function runRecipe(
  deps: BuildDeps,
  python: string,
  root: string,
  sha: string,
  work: string,
): Step<Outputs> {
  const tree = exportTree(deps, root, sha, work);
  if (!tree.ok) return tree;
  const date = git(deps, root, ['show', '-s', '--format=%cs', sha]);
  if (failed(date)) return fail(`cannot read the date of ${sha}: ${tail(date)}`);
  const out = join(work, 'out');
  const r = deps.run(
    python,
    [SCRIPT_PATH, '--out', out, '--commit', sha, '--date', date.stdout.trim()],
    { cwd: tree.value, env: pythonEnv(deps.env), timeoutMs: BUILD_TIMEOUT_MS },
  );
  if (failed(r)) return fail(`the graph recipe failed: ${tail(r)}`);
  const graph = readFileSync(join(out, 'graph.json'), 'utf8');
  const ctx = buildContext(JSON.parse(graph) as GraphData);
  return ok({
    'GRAPH_REPORT.md': readFileSync(join(out, 'GRAPH_REPORT.md'), 'utf8'),
    'graph.brainstorm.toon': renderBrainstormToon(ctx),
    'graph.brainstorm-summary.toon': renderBrainstormSummary(ctx),
    'graph.json': graph,
  });
}

function writeOutputs(root: string, outputs: Outputs): Step<void> {
  const dest = join(root, 'graphify-out');
  mkdirSync(dest, { recursive: true });
  for (const name of OUTPUTS) {
    try {
      atomicWriteFileSync(join(dest, name), outputs[name]);
    } catch (err) {
      return fail(
        `writing graphify-out/${name} failed (${(err as Error).message}); graphify-out/ may now mix old and new files — git checkout -- graphify-out/ restores the committed ones`,
      );
    }
  }
  return ok(undefined);
}

/** Build `graphify-out/` from HEAD, or report that it already is. Returns the exit code. */
export function buildGraph(force: boolean, deps: BuildDeps): number {
  const top = git(deps, deps.cwd, ['rev-parse', '--show-toplevel']);
  if (failed(top)) {
    deps.warn(`${LABEL}: not inside a git work tree (${tail(top)})`);
    return 1;
  }
  const root = top.stdout.trim();
  const headSha = git(deps, root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (failed(headSha)) {
    deps.warn(`${LABEL}: HEAD names no commit, so there is no tree to build (${tail(headSha)})`);
    return 1;
  }
  const sha = headSha.stdout.trim();

  if (!force) {
    const reason = staleReason(deps, root, sha);
    if (reason === null) {
      deps.log(
        `${LABEL}: graphify-out/ is already built from this tree — nothing to do (--force rebuilds)${uncommittedNote(deps, root)}`,
      );
      return 0;
    }
    deps.log(`${LABEL}: building, because ${reason}`);
  }

  const python = ensureEnvironment(deps);
  if (!python.ok) {
    deps.warn(`${LABEL}: ${python.error}`);
    return 2;
  }

  using work = scratchDir();
  const outputs = runRecipe(deps, python.value, root, sha, work.path);
  if (!outputs.ok) {
    deps.warn(`${LABEL}: ${outputs.error}`);
    return 1;
  }
  const written = writeOutputs(root, outputs.value);
  if (!written.ok) {
    deps.warn(`${LABEL}: ${written.error}`);
    return 1;
  }
  const graph = JSON.parse(outputs.value['graph.json']) as GraphData;
  const communities = new Set(graph.nodes.map((n) => n.community)).size;
  deps.log(
    `${LABEL}: built graphify-out/ from ${sha.slice(0, 7)} — ${graph.nodes.length} nodes, ${graph.links.length} links, ${communities} communities`,
  );
  return 0;
}

export function main(argv: readonly string[], deps: BuildDeps): number {
  const unknown = argv.find((arg) => arg !== '--force');
  if (unknown !== undefined) {
    deps.warn(`${LABEL}: unknown argument '${unknown}' (usage: noldor graphify build [--force])`);
    return 1;
  }
  return buildGraph(argv.includes('--force'), deps);
}

if (isEntrypoint(import.meta.url)) {
  process.exit(
    main(process.argv.slice(2), {
      run: spawnRunner,
      env: process.env,
      cwd: process.cwd(),
      log: (line) => process.stdout.write(`${line}\n`),
      warn: (line) => process.stderr.write(`${line}\n`),
    }),
  );
}
