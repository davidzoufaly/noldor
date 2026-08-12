import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Git pathspec exclusions appended to the knowledge-graph freshness scope so
 * that commits touching ONLY test or doc files don't stale the graph. Graphify
 * scans source *imports* — `*.test.ts`/`*.spec.ts`/`__tests__/` and `*.md`
 * files contribute no graph nodes or edges, so a test-only or doc-only commit
 * cannot have changed the graph and must not force a `/graphify` re-run before
 * release. Without this relaxation every `src`-touching fast-track (most of
 * which are tests/docs) re-stale'd the graph, forcing a graph-refresh sweep
 * ahead of each release for no semantic gain.
 *
 * A commit that touches a real source file AND a test/doc file still stales the
 * graph: the inclusive `scanPaths` pathspec matches the source file, so the
 * commit is counted — exclusions only drop commits whose ENTIRE delta is
 * test/doc.
 *
 * SCOPE — comment-only edits inside a real source file are NOT relaxed here. A
 * git pathspec sees file paths, not intra-file content; a `.ts` source file
 * always counts regardless of whether the diff was code or comments. Relaxing
 * comment-only diffs would need a content-level diff and is out of scope.
 *
 * `:(exclude,glob)` magic: `glob` makes the double-star cross directory
 * boundaries, so the leading globstar segment matches the file at any depth
 * (including repo root).
 */
export const GRAPH_IRRELEVANT_EXCLUDES: readonly string[] = [
  ':(exclude,glob)**/__tests__/**',
  ':(exclude,glob)**/*.test.ts',
  ':(exclude,glob)**/*.test.tsx',
  ':(exclude,glob)**/*.spec.ts',
  ':(exclude,glob)**/*.spec.tsx',
  ':(exclude,glob)**/*.md',
];

/** Committer timestamp (unix seconds) of the latest commit touching `paths`, or '' when none. */
async function latestCommitTs(paths: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%ct', '--', ...paths], {
    cwd,
  });
  return stdout.trim();
}

/** Verdict of {@link evaluateGraphFreshness} — reported, never thrown. */
export interface GraphFreshnessVerdict {
  /** `'fresh'` | `'stale'` | `'skipped'` (graphify not in use for this repo). */
  status: 'fresh' | 'stale' | 'skipped';
  /** Human-readable reason; on `'stale'` this is the canonical gate message. */
  detail: string;
}

/**
 * Knowledge-graph freshness check. Graphify is OPTIONAL — a consumer that does
 * not track `graphify-out/graph.json`, or declares no `scanPaths`, is
 * `'skipped'` entirely. When a graph IS tracked, it must postdate the latest
 * GRAPH-RELEVANT commit under the configured `scanPaths` (the SDD detectors
 * read the graph; a stale graph ships degraded meta-gaps in the report).
 * Test-only and doc-only commits are ignored — see
 * {@link GRAPH_IRRELEVANT_EXCLUDES}.
 *
 * Returns a verdict instead of throwing so the preflight aggregate can report
 * it alongside every other gate. `cwd` is injectable for testing; defaults to
 * the process cwd in the release flow.
 */
export async function evaluateGraphFreshness(
  scanPaths: string[],
  cwd: string = process.cwd(),
): Promise<GraphFreshnessVerdict> {
  const graphTs = await latestCommitTs(['graphify-out/graph.json'], cwd);
  if (graphTs.length === 0) {
    return { status: 'skipped', detail: 'no graphify-out/graph.json tracked' };
  }
  if (scanPaths.length === 0) {
    return { status: 'skipped', detail: 'consumer declares no scanPaths' };
  }
  const srcTs = await latestCommitTs([...scanPaths, ...GRAPH_IRRELEVANT_EXCLUDES], cwd);
  if (srcTs.length > 0 && Number(srcTs) > Number(graphTs)) {
    return {
      status: 'stale',
      detail:
        'graph-relevant source files were committed after graphify-out/graph.json ' +
        '(test-only and doc-only commits are ignored)',
    };
  }
  return { status: 'fresh', detail: 'graph postdates the latest graph-relevant commit' };
}
