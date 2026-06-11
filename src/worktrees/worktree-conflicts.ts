import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import type { GraphifyGraph } from '../garden/graph-fd-lookup.js';
import { parseWorktreeList } from './worktree-status.js';

/**
 * A feature worktree reduced to the file-touch set scored for conflicts.
 *
 * @remarks
 * `touchedFiles` is the `git diff main...<branch> --name-only` set — every
 * repo-relative path the branch changed relative to `main`. The main worktree
 * is never an input (it has no diff against itself).
 */
export interface FeatureTree {
  readonly branch: string;
  readonly touchedFiles: readonly string[];
}

/** Default graphify scan root — files are emitted relative to this prefix. */
const DEFAULT_SRC_PREFIX = 'src/';

/** Path to the graphify JSON the community cross-reference reads. */
export const GRAPH_PATH = 'graphify-out/graph.json';

/** Weight applied per direct (same-file) collision when scoring a pair. */
const DIRECT_WEIGHT = 10;

/**
 * Build a `source_file → community` lookup from a graphify graph.
 *
 * @param graph - Parsed `graphify-out/graph.json` payload.
 * @returns Map keyed by each node's `source_file` (relative to the graphify
 *   scan root, e.g. `core/foo.ts`). Nodes missing either `source_file` or
 *   `community` are skipped — they carry no membership signal.
 */
export function buildCommunityMap(graph: GraphifyGraph): Map<string, number> {
  const map = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.source_file !== undefined && node.community !== undefined) {
      map.set(node.source_file, node.community);
    }
  }
  return map;
}

/**
 * Resolve the graphify community of a repo-relative touched file.
 *
 * @param file - Repo-relative path from `git diff` (e.g. `src/core/foo.ts`).
 * @param map - Output of {@link buildCommunityMap}.
 * @param srcPrefix - Graphify scan-root prefix to strip before lookup
 *   (default `src/`). Files outside the prefix never match.
 * @returns The community id, or `null` when the file is not in the graph
 *   (outside the scan root, or a doc/config file graphify doesn't track).
 */
export function communityForFile(
  file: string,
  map: Map<string, number>,
  srcPrefix: string = DEFAULT_SRC_PREFIX,
): number | null {
  if (!file.startsWith(srcPrefix)) return null;
  const rel = file.slice(srcPrefix.length);
  return map.get(rel) ?? null;
}

/** A community both branches in a pair touch via distinct files. */
export interface SharedCommunity {
  readonly community: number;
  readonly filesA: readonly string[];
  readonly filesB: readonly string[];
}

/**
 * One scored conflict between a pair of feature worktrees.
 *
 * @remarks
 * `directFiles` are exact-path collisions — the hard conflict that will
 * produce a merge conflict. `sharedCommunities` are the softer signal:
 * the two branches touch *different* files that graphify clusters into the
 * same community, so a semantic interaction is plausible even without a
 * textual collision. `score` ranks pairs (`directFiles × 10 + community count`).
 */
export interface ConflictPair {
  readonly branchA: string;
  readonly branchB: string;
  readonly directFiles: readonly string[];
  readonly sharedCommunities: readonly SharedCommunity[];
  readonly score: number;
}

/**
 * Score pairwise conflicts across feature worktrees.
 *
 * @param trees - Feature worktrees (omit main).
 * @param communityMap - Output of {@link buildCommunityMap}; pass an empty map
 *   to score direct collisions only (graph unavailable).
 * @param srcPrefix - Graphify scan-root prefix (default `src/`).
 * @returns One {@link ConflictPair} per pair with a direct or community
 *   collision, sorted by `score` descending. Pairs with neither are omitted.
 */
export function scoreConflicts(
  trees: readonly FeatureTree[],
  communityMap: Map<string, number>,
  srcPrefix: string = DEFAULT_SRC_PREFIX,
): ConflictPair[] {
  const pairs: ConflictPair[] = [];

  for (let i = 0; i < trees.length; i++) {
    for (let j = i + 1; j < trees.length; j++) {
      const a = trees[i]!;
      const b = trees[j]!;

      const setB = new Set(b.touchedFiles);
      const directFiles = a.touchedFiles.filter((f) => setB.has(f));
      const directSet = new Set(directFiles);

      // Community overlap considers only files unique to each branch — a
      // direct collision is already the stronger signal and must not be
      // re-counted as a community conflict.
      const sharedCommunities = computeSharedCommunities(
        a.touchedFiles.filter((f) => !directSet.has(f)),
        b.touchedFiles.filter((f) => !directSet.has(f)),
        communityMap,
        srcPrefix,
      );

      if (directFiles.length === 0 && sharedCommunities.length === 0) continue;

      pairs.push({
        branchA: a.branch,
        branchB: b.branch,
        directFiles,
        sharedCommunities,
        score: directFiles.length * DIRECT_WEIGHT + sharedCommunities.length,
      });
    }
  }

  return pairs.sort((x, y) => y.score - x.score);
}

/** Group two file sets by community and keep communities present in both. */
function computeSharedCommunities(
  filesA: readonly string[],
  filesB: readonly string[],
  communityMap: Map<string, number>,
  srcPrefix: string,
): SharedCommunity[] {
  const byCommunity = (files: readonly string[]): Map<number, string[]> => {
    const grouped = new Map<number, string[]>();
    for (const f of files) {
      const c = communityForFile(f, communityMap, srcPrefix);
      if (c === null) continue;
      const bucket = grouped.get(c);
      if (bucket) bucket.push(f);
      else grouped.set(c, [f]);
    }
    return grouped;
  };

  const groupedA = byCommunity(filesA);
  const groupedB = byCommunity(filesB);

  const shared: SharedCommunity[] = [];
  for (const [community, aFiles] of groupedA) {
    const bFiles = groupedB.get(community);
    if (bFiles) shared.push({ community, filesA: aFiles, filesB: bFiles });
  }
  return shared.sort((x, y) => x.community - y.community);
}

/** True when any pair carries a direct file collision (a hard conflict). */
export function hasHardConflict(pairs: readonly ConflictPair[]): boolean {
  return pairs.some((p) => p.directFiles.length > 0);
}

/**
 * Render a conflict report as a single multi-line string.
 *
 * @param pairs - Output of {@link scoreConflicts}.
 * @param opts.graphAvailable - When false, append a note that community
 *   scoring was skipped (no graph on disk) so the report isn't read as a
 *   clean bill of health.
 */
export function formatConflicts(
  pairs: readonly ConflictPair[],
  opts: { graphAvailable: boolean },
): string {
  const lines: string[] = [];

  if (pairs.length === 0) {
    lines.push('No conflicts across active worktrees.');
  } else {
    for (const p of pairs) {
      const tag = p.directFiles.length > 0 ? 'HARD' : 'soft';
      lines.push(`[${tag}] ${p.branchA} ⇄ ${p.branchB} (score ${p.score})`);
      if (p.directFiles.length > 0) {
        lines.push(`  direct: ${p.directFiles.join(', ')}`);
      }
      for (const c of p.sharedCommunities) {
        lines.push(`  community ${c.community}: ${c.filesA.join(', ')} ⇄ ${c.filesB.join(', ')}`);
      }
    }
  }

  if (!opts.graphAvailable) {
    lines.push('', `Note: ${GRAPH_PATH} not found — community scoring skipped (direct only).`);
  }

  return lines.join('\n');
}

/**
 * Run a git subcommand inside `cwd`, returning stdout or empty string on
 * failure (logged to stderr) so one corrupt worktree never aborts the sweep.
 */
function gitOrEmpty(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`git ${args.join(' ')} failed in ${cwd}: ${message}\n`);
    return '';
  }
}

/** Load + parse the graphify graph, or null when it is absent or unreadable. */
export function loadGraph(path: string = GRAPH_PATH): GraphifyGraph | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as GraphifyGraph;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Could not parse ${path}: ${message}\n`);
    return null;
  }
}

/**
 * CLI entrypoint. Enumerates feature worktrees, computes their file-touch sets
 * against `main`, cross-references graphify community membership when the graph
 * is present, prints a scored conflict report, and returns a non-zero exit code
 * only when a hard (same-file) conflict exists.
 */
export async function main(): Promise<number> {
  const porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    encoding: 'utf-8',
  });
  const records = parseWorktreeList(porcelain);
  const mainRecord = records.find((r) => !r.path.includes('/.worktrees/'));
  if (mainRecord === undefined) {
    process.stderr.write('Could not identify main worktree.\n');
    return 1;
  }

  const featureRecords = records.filter((r) => r.path !== mainRecord.path && r.branch !== null);

  const trees: FeatureTree[] = featureRecords.map((r) => ({
    branch: r.branch as string,
    touchedFiles: gitOrEmpty(r.path, ['diff', `main...${r.branch}`, '--name-only'])
      .split('\n')
      .filter(Boolean),
  }));

  const graph = loadGraph();
  const communityMap = graph ? buildCommunityMap(graph) : new Map<string, number>();

  const pairs = scoreConflicts(trees, communityMap);
  process.stdout.write(`${formatConflicts(pairs, { graphAvailable: graph !== null })}\n`);

  return hasHardConflict(pairs) ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
