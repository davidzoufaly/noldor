import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { FeatureRecord, Gap } from './sdd-report.js';

/**
 * Parsed graphify graph payload. Only the fields this module relies on
 * are typed; the upstream JSON is permissive.
 */
export interface GraphifyGraph {
  /** Every node graphify emitted (file-level + function-level + symbol). */
  nodes: GraphifyNode[];
  /** Every edge between nodes — relations include `imports_from`, `calls`, etc. */
  links: GraphifyEdge[];
}

/** Single node row from `graphify-out/graph.json`. */
export interface GraphifyNode {
  id: string;
  label?: string;
  source_file?: string;
  source_location?: string;
  community?: number;
}

/** Single edge row from `graphify-out/graph.json`. */
export interface GraphifyEdge {
  source: string;
  target: string;
  relation: string;
  source_file?: string;
}

/**
 * Result of {@link loadFreshGraphOrWarn}. Either the parsed graph (fresh)
 * or a single staleness/missing gap that the caller should propagate as
 * the only output of the consuming detector.
 */
export type LoadGraphResult = { gap: Gap; ok: false } | { graph: GraphifyGraph; ok: true };

/** Gap category for the staleness / missing-graph meta-gap. */
const META_GAP_CATEGORY = 'Tests with incomplete co-tag';

/**
 * Load the graphify graph at `graphPath` and verify it's fresher than
 * every file under `srcRoots`.
 *
 * @param graphPath - Path to `graphify-out/graph.json`
 * @param srcRoots - Source directories whose mtimes gate freshness
 *   (typically `['packages', 'apps', 'scripts']`)
 * @returns `{ ok: true, graph }` when fresh; `{ ok: false, gap }` with a
 *   self-contained meta-gap when stale or the graph file is missing.
 *
 * @remarks
 * Mtime-based staleness is intentionally cheap; CLAUDE.md's pre-release
 * sweep already forces a fresh `/graphify` regen, so any false-stale
 * (e.g. after `git checkout`) is harmless — it forces a regen, which is
 * the right outcome anyway.
 */
export function loadFreshGraphOrWarn(graphPath: string, srcRoots: string[]): LoadGraphResult {
  if (!existsSync(graphPath)) {
    return {
      gap: {
        category: META_GAP_CATEGORY,
        itemId: graphPath,
        message: `${graphPath} does not exist. Run /graphify + pnpm toon to generate the graph, or ensure the path is correct.`,
      },
      ok: false,
    };
  }

  const graphMtime = statSync(graphPath).mtimeMs;
  const newestSrcMtime = newestMtimeInRoots(srcRoots);

  if (newestSrcMtime !== null && newestSrcMtime > graphMtime) {
    const graphDate = new Date(graphMtime).toISOString().slice(0, 10);
    const srcDate = new Date(newestSrcMtime).toISOString().slice(0, 10);
    return {
      gap: {
        category: META_GAP_CATEGORY,
        itemId: graphPath,
        message: `Co-tag detector ran in degraded mode: ${graphPath} regen ${graphDate}, latest source mtime ${srcDate}. Run /graphify + pnpm toon (preferred) or perform a manual co-tag audit: for each .test.ts file under packages/ or apps/src/, grep imports → check which FDs own those files via links.code → propose missing co-tags.`,
      },
      ok: false,
    };
  }

  const raw = readFileSync(graphPath, 'utf8');
  const graph = JSON.parse(raw) as GraphifyGraph;
  return { graph, ok: true };
}

/**
 * Walk every file under each root and return the largest mtime seen, or
 * `null` if nothing exists. Skips hidden directories and common
 * build-output paths.
 */
function newestMtimeInRoots(roots: string[]): number | null {
  let newest: number | null = null;
  for (const root of roots) {
    if (!existsSync(root)) continue;
    walkSync(root, (path, mtime) => {
      if (newest === null || mtime > newest) newest = mtime;
    });
  }
  return newest;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git']);

function walkSync(dir: string, visit: (path: string, mtime: number) => void): void {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (isIgnoredFreshnessPath(full)) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkSync(full, visit);
    } else {
      visit(full, st.mtimeMs);
    }
  }
}

function isIgnoredFreshnessPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
  return (
    normalized === 'apps/web/public/samples' ||
    normalized.endsWith('/apps/web/public/samples') ||
    normalized.startsWith('apps/web/public/samples/') ||
    normalized.includes('/apps/web/public/samples/')
  );
}

/**
 * Build a map from every file path in any FD's `links.code` to the set
 * of owning FD slugs. Directory entries are normalized (trailing `/`
 * stripped) so callers compare against the canonical key.
 *
 * @param features - Loaded feature records (typically
 *   {@link FeatureRecord}[] from `loadSddFeatures`)
 * @returns A map from cwd-relative path to the set of slugs owning it
 *
 * @remarks
 * Co-ownership is a real shape (a meta-FD can name a file already owned
 * by a primary FD), so the value is `Set<string>` not a single slug.
 */
export function buildFileToFdsMap(features: FeatureRecord[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const f of features) {
    for (const raw of f.frontmatter.links.code) {
      const key = raw.endsWith('/') ? raw.slice(0, -1) : raw;
      const set = map.get(key) ?? new Set<string>();
      set.add(f.slug);
      map.set(key, set);
    }
  }
  return map;
}

/**
 * Look up the set of FD slugs that own `filePath`, walking ancestor
 * directories so a `links.code` entry like `packages/sample-scenes`
 * covers `packages/sample-scenes/src/empty-room.ts`. Owners from a
 * direct match and any ancestor directory match are unioned.
 */
export function getFdOwnersForFile(filePath: string, map: Map<string, Set<string>>): Set<string> {
  const owners = new Set<string>();
  for (const slug of map.get(filePath) ?? new Set<string>()) owners.add(slug);
  let cursor = filePath;
  while (true) {
    const lastSlash = cursor.lastIndexOf('/');
    if (lastSlash <= 0) break;
    cursor = cursor.slice(0, lastSlash);
    for (const slug of map.get(cursor) ?? new Set<string>()) owners.add(slug);
  }
  return owners;
}

/**
 * Return the set of FD slugs that own any file the given test node imports
 * (via `imports_from` edges). Walks ancestor directories for each imported
 * file's owner lookup so directory-level `links.code` entries cover nested
 * imports.
 *
 * @param testNodeId - Graphify node id of the test file (`L1` file-level
 *   node, not an inner symbol)
 * @param graph - Parsed graphify graph
 * @param fileToFds - Output of {@link buildFileToFdsMap}
 * @returns Set of unique FD slugs owning files imported by the test.
 *
 * @remarks
 * Shared between the 13th detector (`detectMissingCoTags`, which diffs
 * this against declared `@tests:` tags) and detector 10
 * (`detectUntaggedTests`, which suggests the full set when no tag exists).
 */
export function getImportOwnersForTest(
  testNodeId: string,
  graph: GraphifyGraph,
  fileToFds: Map<string, Set<string>>,
): Set<string> {
  const owners = new Set<string>();
  const nodeById = new Map<string, GraphifyNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);
  for (const edge of graph.links) {
    if (edge.relation !== 'imports_from') continue;
    if (edge.source !== testNodeId) continue;
    const target = nodeById.get(edge.target);
    if (!target?.source_file) continue;
    for (const slug of getFdOwnersForFile(target.source_file, fileToFds)) {
      owners.add(slug);
    }
  }
  return owners;
}

/**
 * A community-owner suggestion entry: the candidate FD slug and the count
 * of files in the same graphify community that resolve to it via
 * `links.code` ownership.
 */
export interface CommunityOwnerSuggestion {
  slug: string;
  count: number;
}

/**
 * Resolve the file's `community` number from its `L1` (file-level) node,
 * then walk every other node in that community and tally the FD slugs
 * that own those files via `links.code`. Used by detector 9 to suggest a
 * probable owner for code orphans.
 *
 * @param filePath - The orphan file path (no graphify community lookup if
 *   the file isn't represented in the graph or lacks a community number)
 * @param graph - Parsed graphify graph
 * @param fileToFds - Output of {@link buildFileToFdsMap}
 * @returns Array of `{ slug, count }` entries sorted by count descending,
 *   ties broken by slug ascending. The orphan file itself is excluded
 *   from the tally. Empty array when no community match.
 *
 * @remarks
 * Frequency-based ranking biases toward the dominant FD in a community.
 * Reads only the file-level `L1` node's community — symbol-level nodes
 * (which may belong to different sub-communities) are intentionally
 * ignored. Callers typically take the top 1-3 entries for the suggestion.
 */
export function getCommunityOwners(
  filePath: string,
  graph: GraphifyGraph,
  fileToFds: Map<string, Set<string>>,
): CommunityOwnerSuggestion[] {
  let community: number | undefined;
  for (const n of graph.nodes) {
    if (n.source_location !== 'L1' || n.source_file !== filePath) continue;
    community = n.community;
    break;
  }
  if (community === undefined) return [];

  const counts = new Map<string, number>();
  for (const n of graph.nodes) {
    if (n.source_location !== 'L1' || !n.source_file) continue;
    if (n.community !== community) continue;
    if (n.source_file === filePath) continue;
    for (const slug of getFdOwnersForFile(n.source_file, fileToFds)) {
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, count }))
    .toSorted((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}
