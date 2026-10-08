// @fd: graph-and-main-freshness-before-coding
// Is the tree I am about to code against still current? Two independent legs,
// run once at gate Step 3.5 before the first edit:
//
// - graph: the knowledge graph's freshness for the files about to be touched,
//   rebuilt locally on `stale` and always restored afterwards — the rebuild
//   exists only to feed this read, never to land in the branch.
// - main: how far `origin/main` moved since this branch was cut, and which of
//   those commits touch the files about to be touched.
//
// Advisory only: every outcome is a verdict, nothing here merges, rebases or
// exits non-zero. Acting on it is the gate prose's job.

import { spawnSync } from 'node:child_process';

import { defaultRunGit, type RunGit } from '../core/branch-added.js';
import { graphContext, type PathDigest } from '../design/graph-context.js';

const GRAPH_DIR = 'graphify-out/';

type GraphVerdict =
  | 'skipped'
  | 'fresh'
  | 'stale'
  | 'rebuilt-fresh'
  | 'rebuilt-stale'
  | 'rebuild-failed'
  | 'rebuild-skipped-dirty';

interface GraphLeg {
  verdict: GraphVerdict;
  reason: string;
  /** Empty unless the final read was fresh. */
  digests: PathDigest[];
  /** A restore that failed after a rebuild — the tree may need a hand. */
  warnings: string[];
}

interface TouchingCommit {
  sha: string;
  subject: string;
  /** The subset of the requested files this commit changed. */
  files: string[];
}

interface MainLeg {
  verdict: 'current' | 'behind' | 'unknown';
  reason: string;
  /** Commits on `origin/main` not in `HEAD`; 0 when unknown. */
  behind: number;
  /** Of `behind`, the commits that changed nothing outside `graphify-out/`. */
  graphOnly: number;
  touching: TouchingCommit[];
  /** `unknown` when no files were given, so overlap could not be computed. */
  overlap: 'none' | 'touching' | 'unknown';
  /** Bring `origin/main` in before the first edit. */
  rebaseAdvised: boolean;
}

export interface CodeFreshness {
  graph: GraphLeg;
  main: MainLeg;
}

export type BuildOutcome = { ok: true } | { ok: false; reason: string };

export interface CodeFreshnessOptions {
  cwd: string;
  /** Repo-relative POSIX paths about to be edited. May be empty. */
  files: readonly string[];
  /** Rebuild a stale graph locally (restored afterwards). */
  rebuild: boolean;
  /** Test seam — git. */
  runGit?: RunGit;
  /** Test seam — the graph build subprocess. */
  runBuild?: (cwd: string) => BuildOutcome;
}

export async function codeFreshness(opts: CodeFreshnessOptions): Promise<CodeFreshness> {
  const run = opts.runGit ?? defaultRunGit(opts.cwd);
  const build = opts.runBuild ?? spawnGraphBuild;
  return {
    graph: await graphLeg(opts.cwd, opts.files, opts.rebuild, run, build),
    main: mainLeg(opts.files, run),
  };
}

async function graphLeg(
  cwd: string,
  files: readonly string[],
  rebuild: boolean,
  run: RunGit,
  build: (cwd: string) => BuildOutcome,
): Promise<GraphLeg> {
  const first = await graphContext({ cwd, paths: files, runGit: run });
  if (first.status !== 'stale' || !rebuild) {
    return { verdict: first.status, reason: first.detail, digests: first.digests, warnings: [] };
  }

  const dirty = run(['status', '--porcelain', '--', GRAPH_DIR]);
  if (dirty.status !== 0 || dirty.stdout.trim() !== '') {
    return {
      verdict: 'rebuild-skipped-dirty',
      reason:
        dirty.status === 0
          ? `${GRAPH_DIR} already has uncommitted changes — not rebuilding over edits that are not this check's to discard`
          : `could not read ${GRAPH_DIR} status: ${dirty.stderr.trim()}`,
      digests: [],
      warnings: [],
    };
  }

  const warnings: string[] = [];
  using _restore = restoreGraphOnExit(run, warnings);
  const built = build(cwd);
  if (!built.ok) {
    return { verdict: 'rebuild-failed', reason: built.reason, digests: [], warnings };
  }
  const second = await graphContext({ cwd, paths: files, runGit: run });
  return second.status === 'fresh'
    ? { verdict: 'rebuilt-fresh', reason: second.detail, digests: second.digests, warnings }
    : { verdict: 'rebuilt-stale', reason: second.detail, digests: [], warnings };
}

/**
 * Put `graphify-out/` back to `HEAD` on every path out of the rebuild, the
 * crashing one included. `clean` leaves gitignored caches alone (no `-x`).
 * Failures land in `warnings` — the disposer must not throw over the verdict.
 */
function restoreGraphOnExit(run: RunGit, warnings: string[]): Disposable {
  return {
    [Symbol.dispose]: () => {
      const restore = run(['restore', '--source=HEAD', '--staged', '--worktree', '--', GRAPH_DIR]);
      const clean = run(['clean', '-fdq', '--', GRAPH_DIR]);
      for (const [label, r] of [
        ['restore', restore],
        ['clean', clean],
      ] as const) {
        if (r.status !== 0) {
          warnings.push(
            `git ${label} of ${GRAPH_DIR} failed: ${r.stderr.trim()} — check it by hand`,
          );
        }
      }
    },
  };
}

/** A full AST build takes ~15 s here; ten minutes means it hung. */
const BUILD_TIMEOUT_MS = 10 * 60_000;
/** A fetch that has not answered in a minute is offline or prompting. */
const FETCH_TIMEOUT_MS = 60_000;

function spawnGraphBuild(cwd: string): BuildOutcome {
  const r = spawnSync('pnpm', ['noldor', 'graphify', 'build'], {
    cwd,
    encoding: 'utf8',
    timeout: BUILD_TIMEOUT_MS,
  });
  if (r.error !== undefined) return { ok: false, reason: `graphify build: ${r.error.message}` };
  if (r.status !== 0) {
    const tail = (r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ');
    return { ok: false, reason: `graphify build exited ${String(r.status)}: ${tail}` };
  }
  return { ok: true };
}

/** Record separator between commits in the `git log` walk below. */
const SEP = '\u001e';

function mainLeg(files: readonly string[], run: RunGit): MainLeg {
  const unknown = (reason: string): MainLeg => ({
    verdict: 'unknown',
    reason,
    behind: 0,
    graphOnly: 0,
    touching: [],
    overlap: 'unknown',
    rebaseAdvised: false,
  });

  // A named-branch fetch also updates `refs/remotes/origin/main` (git >= 1.8.4,
  // default refspec) — the same call `resolveBase` in create-worktree.ts makes.
  // The timeout is the real guard: a dead remote or a prompt (ssh passphrase,
  // or a credential helper on a git too old for `credential.interactive`) is
  // killed after a minute and reads as `unknown`, never a hung gate.
  const fetch = run(['-c', 'credential.interactive=never', 'fetch', '-q', 'origin', 'main'], {
    timeout: FETCH_TIMEOUT_MS,
  });
  if (fetch.status !== 0) {
    return unknown(`could not fetch origin main: ${fetch.stderr.trim() || 'no reason given'}`);
  }

  // One unfiltered walk classifies every commit by its file list, so the
  // count, the graph-only subset and the touching subset agree by construction.
  // `--diff-merges=first-parent`: a merge commit lists no files by default, so
  // it would never count as touching. `core.quotepath=false`: a C-quoted
  // non-ASCII path never matches the requested set (see `namesFrom`).
  const log = run(
    [
      '-c',
      'core.quotepath=false',
      'log',
      '--name-only',
      '--diff-merges=first-parent',
      `--format=${SEP}%h%x09%s`,
      'HEAD..origin/main',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (log.status !== 0) return unknown(`git log HEAD..origin/main failed: ${log.stderr.trim()}`);

  const commits = log.stdout
    .split(SEP)
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const [head = '', ...rest] = block.split('\n');
      const [sha = '', ...subject] = head.split('\t');
      return { sha, subject: subject.join('\t'), changed: rest.filter((l) => l.trim() !== '') };
    });

  const wanted = new Set(files);
  const graphOnly = commits.filter(
    (c) => c.changed.length > 0 && c.changed.every((f) => f.startsWith(GRAPH_DIR)),
  ).length;
  const touching = commits
    .map((c) => ({ sha: c.sha, subject: c.subject, files: c.changed.filter((f) => wanted.has(f)) }))
    .filter((c) => c.files.length > 0);

  const overlap = files.length === 0 ? 'unknown' : touching.length > 0 ? 'touching' : 'none';
  const nonGraph = commits.length - graphOnly;
  return {
    verdict: commits.length === 0 ? 'current' : 'behind',
    reason:
      commits.length === 0
        ? 'origin/main has no commits this branch lacks'
        : `origin/main is ${String(commits.length)} commit(s) ahead (${String(graphOnly)} graph-refresh only)`,
    behind: commits.length,
    graphOnly,
    touching,
    overlap,
    rebaseAdvised: overlap === 'touching' || (overlap === 'unknown' && nonGraph > 0),
  };
}
