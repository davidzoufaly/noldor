// @fd: graphify-plan-of-edges-nodes-for-plans-specs
// Structural evidence for a design artifact: is the knowledge graph fresh
// enough to read, and where in the structure do these paths sit?
//
// The freshness verdict is deliberately a UNION of two legs. Each alone is a
// dead end: the committed leg cannot see an uncommitted regeneration, so a
// `stale` -> regen -> retry loop could never clear it; the working-tree leg
// cannot report fresh right after `git worktree add`, which stamps every file
// at one instant. Their blind spots do not overlap.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { defaultRunGit, type RunGit } from '../core/branch-added.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { loadSddFeatures } from '../core/fd-load.js';
import { newestMtimeInRoots, scanRoots } from '../core/repo-paths.js';
import {
  buildFileToFdsMap,
  getCommunityOwners,
  type CommunityOwnerSuggestion,
  type GraphifyGraph,
  type GraphifyNode,
} from '../garden/graph-fd-lookup.js';
import { evaluateGraphFreshness } from '../release/graph-freshness.js';

/** Repo-relative location of the graph every leg and the digest read. */
export const GRAPH_JSON = 'graphify-out/graph.json';
/** The orientation read `docs/noldor/graph-integration.md` prescribes. */
export const SUMMARY_TOON = 'graphify-out/graph.brainstorm-summary.toon';

/** How many of each digest list survive the cap. */
const CO_MEMBER_CAP = 5;
const OWNER_CAP = 3;
const CROSS_EDGE_CAP = 10;
/**
 * Degree-rank cutoff. Exactly the length of `GRAPH_REPORT.md`'s
 * "God Nodes (most connected)" list, so the cap is graphify's own rather than
 * one invented here. (The 20 in the summary toon is `community index (top 20 by
 * size)` — a different list of a different thing.)
 */
const GOD_NODE_CAP = 10;

/** One symbol that ranks among the graph's most-connected nodes. */
export interface DegreeRankedSymbol {
  label: string;
  degree: number;
  /** 1-based position in the symbol-only degree ranking. */
  rank: number;
}

/** One edge leaving this path's community. */
export interface CrossCommunityEdge {
  /** This path's own node, first for readability — not an assertion of direction. */
  from: string;
  to: string;
  relation: string;
  toCommunity: number;
}

/** Where one path sits in the structure. */
export interface PathDigest {
  path: string;
  /** Absent from the graph entirely — itself structural information. */
  inGraph: boolean;
  community: number | null;
  coMembers: string[];
  owners: CommunityOwnerSuggestion[];
  topDegreeSymbols: DegreeRankedSymbol[];
  crossCommunityEdges: CrossCommunityEdge[];
}

export type GraphContextStatus = 'skipped' | 'stale' | 'fresh';

export interface GraphContextResult {
  status: GraphContextStatus;
  detail: string;
  /** Null on `skipped` and `stale`. */
  summaryToon: { path: string; usable: boolean } | null;
  digests: PathDigest[];
}

export interface GraphContextOptions {
  cwd: string;
  /**
   * Already-validated repo-relative POSIX paths. May be empty — that is a
   * verdict-only call, not an error, so a caller always gets a verdict to
   * write an honest artifact from.
   */
  paths: readonly string[];
  /** Test seam. */
  runGit?: RunGit;
}

/**
 * Resolve the graph's freshness and, when fresh, where `paths` sit in it.
 *
 * Resolution is ordered, never simultaneous: presence, then parse, then the
 * freshness legs. A graph that cannot be read cannot be fresh, so a parse
 * failure outranks either leg.
 *
 * Expected failures are statuses, not throws: a missing graph is `skipped`, an
 * unreadable or structurally invalid one is `stale`.
 */
export async function graphContext(opts: GraphContextOptions): Promise<GraphContextResult> {
  const { cwd, paths } = opts;
  const run = opts.runGit ?? defaultRunGit(cwd);
  const graphAbs = join(cwd, GRAPH_JSON);

  // Presence. Tracked-ness is its own probe: `evaluateGraphFreshness`'s
  // `skipped` detail cannot answer it, because precedence puts presence first.
  if (!existsSync(graphAbs) && !isTracked(run, GRAPH_JSON)) {
    return {
      status: 'skipped',
      detail: `${GRAPH_JSON} is neither on disk nor tracked - graphify is not in use here`,
      summaryToon: null,
      digests: [],
    };
  }

  const parsed = parseGraph(graphAbs);
  if (!parsed.ok) {
    return { status: 'stale', detail: parsed.error, summaryToon: null, digests: [] };
  }

  const roots = scanRoots(cwd);
  const committed = await committedLegPasses(roots, cwd, run);
  const worktree = worktreeLegPasses(graphAbs, cwd, roots);
  if (!committed.passes && !worktree) {
    return {
      status: 'stale',
      detail:
        `${GRAPH_JSON} is stale: ${committed.detail}, and its mtime is not newer ` +
        `than every file under ${roots.join(', ')}. ` +
        'Run /graphify --ast-only then pnpm toon, and retry.',
      summaryToon: null,
      digests: [],
    };
  }

  // `loadSddFeatures` takes the FEATURES DIRECTORY, not a repo root, and a
  // missing directory yields `[]` silently — passing `cwd` produced zero
  // features in a repo holding 83 of them, and an always-empty `owners` list
  // with no error. `loadDocRoots` is what resolves the directory.
  const features = await loadSddFeatures(loadDocRoots(cwd).features);
  const index = buildIndex(parsed.graph);
  const fileToFds = buildFileToFdsMap(features);

  return {
    status: 'fresh',
    detail:
      (committed.passes
        ? 'committed graph postdates the latest graph-relevant commit'
        : `${GRAPH_JSON} was regenerated in the working tree`) +
      (parsed.dropped > 0
        ? ` (${String(parsed.dropped)} malformed rows dropped from the digest)`
        : ''),
    summaryToon: summaryToonState(cwd, graphAbs),
    digests: paths.map((path) => digestFor(path, index, fileToFds)),
  };
}

/** Is `rel` known to git at all? A regenerated-but-uncommitted graph is not. */
function isTracked(run: RunGit, rel: string): boolean {
  return run(['ls-files', '--error-unmatch', '--', rel]).status === 0;
}

type ParseResult =
  | { ok: true; graph: GraphifyGraph; dropped: number }
  | { ok: false; error: string };

/**
 * Read and shape-check the graph. Whole-file problems become the caller's
 * `stale`; individual malformed rows are dropped and counted, because one bad
 * edge is not a reason to refuse every path a digest.
 */
function parseGraph(graphAbs: string): ParseResult {
  let raw: string;
  try {
    raw = readFileSync(graphAbs, 'utf8');
  } catch (err) {
    return { ok: false, error: `${GRAPH_JSON} cannot be read: ${(err as Error).message}` };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `${GRAPH_JSON} does not parse: ${(err as Error).message}` };
  }
  const candidate = value as Partial<GraphifyGraph>;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.links)) {
    return { ok: false, error: `${GRAPH_JSON} has no nodes/links arrays - not a graphify graph` };
  }
  const nodes = candidate.nodes.filter((n) => typeof n?.id === 'string');
  const links = candidate.links.filter(
    (l) => typeof l?.source === 'string' && typeof l?.target === 'string',
  );
  const dropped = candidate.nodes.length - nodes.length + (candidate.links.length - links.length);
  return { ok: true, graph: { nodes, links }, dropped };
}

/**
 * Committed leg: the release gate's own verdict, plus a guard that the on-disk
 * file still IS its committed content.
 *
 * The guard uses `git status --porcelain`, not `git diff --quiet HEAD`, which
 * ignores untracked files outright (measured: exit 0 for a file git has never
 * seen) and would bless an untracked graph as matching content that does not
 * exist.
 */
async function committedLegPasses(
  roots: string[],
  cwd: string,
  run: RunGit,
): Promise<{ passes: boolean; detail: string }> {
  // `evaluateGraphFreshness` shells `git log` and REJECTS outside a git repo
  // rather than reporting a verdict, so it is an external throw source and gets
  // converted here — a missing repository is an expected condition for a
  // consumer running this before `git init`, not a programmer error.
  let verdict;
  try {
    verdict = await evaluateGraphFreshness(roots, cwd);
  } catch (err) {
    return { passes: false, detail: `commit history unavailable: ${(err as Error).message}` };
  }
  if (verdict.status !== 'fresh') return { passes: false, detail: verdict.detail };
  const dirty = run(['status', '--porcelain', '--', GRAPH_JSON]);
  if (dirty.status !== 0) {
    return { passes: false, detail: `cannot inspect ${GRAPH_JSON}: ${dirty.stderr.trim()}` };
  }
  if (dirty.stdout.trim().length > 0) {
    return {
      passes: false,
      detail: `${GRAPH_JSON} differs from its committed content, so the committed verdict does not describe it`,
    };
  }
  return { passes: true, detail: verdict.detail };
}

/** Working-tree leg: the graph outranks every source file on disk. */
function worktreeLegPasses(graphAbs: string, cwd: string, roots: string[]): boolean {
  if (!existsSync(graphAbs)) return false;
  const newestSrc = newestMtimeInRoots(cwd, roots);
  if (newestSrc === null) return false;
  return statSync(graphAbs).mtimeMs > newestSrc;
}

/**
 * The toon is advisory WITHIN `fresh`: the digest is what an artifact needs and
 * only `pnpm toon` regenerates the toon, so gating the load-bearing path on it
 * would add a failure state carrying no independent signal.
 */
function summaryToonState(cwd: string, graphAbs: string): { path: string; usable: boolean } {
  const toonAbs = join(cwd, SUMMARY_TOON);
  if (!existsSync(toonAbs)) return { path: SUMMARY_TOON, usable: false };
  return { path: SUMMARY_TOON, usable: statSync(toonAbs).mtimeMs >= statSync(graphAbs).mtimeMs };
}

/** Everything the digest needs, resolved once rather than per path. */
interface GraphIndex {
  graph: GraphifyGraph;
  byId: Map<string, GraphifyNode>;
  /** File-level node per `source_file`; first in graph order wins. */
  l1ByFile: Map<string, GraphifyNode>;
  degree: Map<string, number>;
  /** Symbol-only degree ranking, 1-based, reproducing GRAPH_REPORT's list. */
  symbolRank: Map<string, number>;
}

/**
 * Index the graph once.
 *
 * Degree is undirected — the graph declares `directed: false` — and each row
 * contributes once per endpoint so duplicate rows cannot inflate a rank. The
 * ranking excludes `L1` file nodes: `GRAPH_REPORT.md`'s god-node list is
 * symbols only, and including files would put `data.ts` (152 edges) above
 * `loadDocRoots()` (76) and quietly stop reproducing graphify's ranking.
 */
function buildIndex(graph: GraphifyGraph): GraphIndex {
  const byId = new Map<string, GraphifyNode>();
  for (const n of graph.nodes) byId.set(n.id, n);

  const l1ByFile = new Map<string, GraphifyNode>();
  for (const n of graph.nodes) {
    if (n.source_location !== 'L1' || n.source_file === undefined) continue;
    if (!l1ByFile.has(n.source_file)) l1ByFile.set(n.source_file, n);
  }

  const degree = new Map<string, number>();
  for (const edge of graph.links) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const symbolRank = new Map<string, number>();
  [...degree.entries()]
    .filter(([id]) => byId.get(id)?.source_location !== 'L1')
    .toSorted((a, b) => b[1] - a[1] || labelOf(byId, a[0]).localeCompare(labelOf(byId, b[0])))
    .forEach(([id], i) => symbolRank.set(id, i + 1));

  return { graph, byId, l1ByFile, degree, symbolRank };
}

function labelOf(byId: Map<string, GraphifyNode>, id: string): string {
  return byId.get(id)?.label ?? id;
}

/**
 * Where one path sits. Every list is ordered before it is capped, so two
 * implementations reading the same graph agree on the same digest.
 */
function digestFor(
  path: string,
  index: GraphIndex,
  fileToFds: Map<string, Set<string>>,
): PathDigest {
  const l1 = index.l1ByFile.get(path);
  if (l1 === undefined) {
    return {
      path,
      inGraph: false,
      community: null,
      coMembers: [],
      owners: [],
      topDegreeSymbols: [],
      crossCommunityEdges: [],
    };
  }
  const community = l1.community ?? null;
  return {
    path,
    inGraph: true,
    community,
    coMembers: coMembersOf(path, community, index),
    owners: getCommunityOwners(path, index.graph, fileToFds).slice(0, OWNER_CAP),
    topDegreeSymbols: godNodesOf(l1.id, index),
    crossCommunityEdges: crossEdgesOf(l1.id, community, index),
  };
}

/** Co-members of this file's community, degree desc then label asc. */
function coMembersOf(path: string, community: number | null, index: GraphIndex): string[] {
  if (community === null) return [];
  return index.graph.nodes
    .filter(
      (n) =>
        n.source_location === 'L1' &&
        n.community === community &&
        n.source_file !== undefined &&
        n.source_file !== path,
    )
    .toSorted(
      (a, b) =>
        (index.degree.get(b.id) ?? 0) - (index.degree.get(a.id) ?? 0) ||
        labelOf(index.byId, a.id).localeCompare(labelOf(index.byId, b.id)),
    )
    .slice(0, CO_MEMBER_CAP)
    .map((n) => n.source_file ?? n.id);
}

/**
 * Symbols this file defines that rank among the most-connected nodes. A file
 * owns its symbols through `contains` edges.
 */
function godNodesOf(fileId: string, index: GraphIndex): DegreeRankedSymbol[] {
  const out: DegreeRankedSymbol[] = [];
  for (const edge of index.graph.links) {
    if (edge.relation !== 'contains' || edge.source !== fileId) continue;
    const rank = index.symbolRank.get(edge.target);
    if (rank === undefined || rank > GOD_NODE_CAP) continue;
    out.push({
      label: labelOf(index.byId, edge.target),
      degree: index.degree.get(edge.target) ?? 0,
      rank,
    });
  }
  return out.toSorted((a, b) => a.rank - b.rank);
}

/**
 * Edges incident to this file's node whose other endpoint sits in a different
 * community. Traversal is undirected, so an edge counts whichever end this file
 * is on. An endpoint with no numeric community is excluded rather than coerced
 * — that is what keeps `toCommunity: number` truthful.
 *
 * Ordering carries the other endpoint's id so the comparator reads a degree by
 * key instead of resolving a label back to a node, which would make sorting
 * quadratic in the graph's node count.
 */
function crossEdgesOf(
  fileId: string,
  community: number | null,
  index: GraphIndex,
): CrossCommunityEdge[] {
  if (community === null) return [];
  const seen = new Set<string>();
  const rows: { edge: CrossCommunityEdge; otherId: string }[] = [];
  for (const edge of index.graph.links) {
    // `contains` is a file->symbol containment edge, so a file's OWN symbol
    // clustered into another community would read as a bridge out of the file.
    // Containment is structure, not a bridge.
    if (edge.relation === 'contains') continue;
    const otherId =
      edge.source === fileId ? edge.target : edge.target === fileId ? edge.source : null;
    if (otherId === null) continue;
    const other = index.byId.get(otherId);
    if (other === undefined || typeof other.community !== 'number') continue;
    if (other.community === community) continue;
    const key = `${otherId} ${edge.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      edge: {
        from: labelOf(index.byId, fileId),
        to: labelOf(index.byId, otherId),
        relation: edge.relation,
        toCommunity: other.community,
      },
      otherId,
    });
  }
  return rows
    .toSorted(
      (a, b) =>
        (index.degree.get(b.otherId) ?? 0) - (index.degree.get(a.otherId) ?? 0) ||
        a.edge.to.localeCompare(b.edge.to) ||
        a.edge.relation.localeCompare(b.edge.relation),
    )
    .slice(0, CROSS_EDGE_CAP)
    .map((r) => r.edge);
}
