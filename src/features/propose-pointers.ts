// @fd: dynamic-fd-file-pointers-via-frontmatter

import { basename } from 'node:path';

import { loadConsumerConfig } from '../core/consumer-config.js';
import { loadDocRoots } from '../core/doc-roots.js';
import {
  getFdOwnersForFile,
  requireFreshGraph,
  type GraphifyGraph,
} from '../garden/graph-fd-lookup.js';
import { loadSddFeatures } from '../garden/sdd-report.js';

/** A proposed code-file pointer with a confidence score + human reason. */
export interface RankedCandidate {
  file: string;
  score: number;
  reason: string;
}

/**
 * Combine import-edge and graph-community signal into a ranked candidate list.
 * A file appearing in both signals scores 2 ("import + community"); a single
 * signal scores 1. Sorted by descending score, then path.
 *
 * @param signal - Files surfaced by import edges and by community membership
 * @returns Ranked candidates (empty when no signal)
 */
export function rankCandidates(signal: {
  importHits: string[];
  communityHits: string[];
}): RankedCandidate[] {
  const imp = new Set(signal.importHits);
  const com = new Set(signal.communityHits);
  const out: RankedCandidate[] = [];
  for (const file of new Set([...imp, ...com])) {
    const inImp = imp.has(file);
    const inCom = com.has(file);
    out.push({
      file,
      score: (inImp ? 1 : 0) + (inCom ? 1 : 0),
      reason: inImp && inCom ? 'import + community' : inImp ? 'import' : 'community',
    });
  }
  return out.toSorted((a, b) => b.score - a.score || a.file.localeCompare(b.file));
}

/**
 * Propose candidate code files for an FD by inverting the graph-owner lookups
 * in {@link getCommunityOwners}/{@link getImportOwnersForTest}: gather the files
 * the FD already owns (via `// @fd:`-derived `links.code`), then surface their
 * graph-community siblings and `imports_from` neighbors that the FD does NOT yet
 * own. The result feeds {@link rankCandidates}. Pure — the caller injects the
 * graph + ownership map. Empty when the FD owns nothing represented in the graph
 * or no fresh neighbor surfaces.
 *
 * @param slug - FD slug to propose pointers for
 * @param graph - Parsed graphify graph
 * @param fileToFds - Output of `buildFileToFdsMap`
 * @returns Ranked candidate files the FD does not already own
 */
export function proposeCandidates(
  slug: string,
  graph: GraphifyGraph,
  fileToFds: Map<string, Set<string>>,
): RankedCandidate[] {
  const ownedBySlug = (file: string): boolean => getFdOwnersForFile(file, fileToFds).has(slug);

  // Index L1 (file-level) nodes: id → file, plus the FD's owned nodes + their communities.
  const fileByNodeId = new Map<string, string>();
  const ownedNodeIds = new Set<string>();
  const ownedCommunities = new Set<number>();
  for (const n of graph.nodes) {
    if (n.source_location !== 'L1' || !n.source_file) continue;
    fileByNodeId.set(n.id, n.source_file);
    if (ownedBySlug(n.source_file)) {
      ownedNodeIds.add(n.id);
      if (n.community !== undefined) ownedCommunities.add(n.community);
    }
  }

  // Community siblings: other L1 files sharing a community with an owned file.
  const communityHits = new Set<string>();
  if (ownedCommunities.size > 0) {
    for (const n of graph.nodes) {
      if (n.source_location !== 'L1' || !n.source_file) continue;
      if (n.community === undefined || !ownedCommunities.has(n.community)) continue;
      if (ownedBySlug(n.source_file)) continue;
      communityHits.add(n.source_file);
    }
  }

  // Import neighbors: the file on the far end of any `imports_from` edge that
  // touches exactly one owned node (imports the FD makes, and imports into it).
  const importHits = new Set<string>();
  for (const edge of graph.links) {
    if (edge.relation !== 'imports_from') continue;
    const srcOwned = ownedNodeIds.has(edge.source);
    const tgtOwned = ownedNodeIds.has(edge.target);
    if (srcOwned === tgtOwned) continue; // both- or neither-owned → no new neighbor
    const neighborFile = fileByNodeId.get(srcOwned ? edge.target : edge.source);
    if (!neighborFile || ownedBySlug(neighborFile)) continue;
    importHits.add(neighborFile);
  }

  return rankCandidates({ importHits: [...importHits], communityHits: [...communityHits] });
}

async function main(): Promise<void> {
  const slugIdx = process.argv.indexOf('--slug');
  const slug = slugIdx >= 0 ? process.argv[slugIdx + 1] : undefined;
  if (!slug) {
    console.error('Usage: noldor features propose-pointers --slug <slug>');
    process.exitCode = 1;
    return;
  }

  const { scanPaths } = loadConsumerConfig();
  const srcRoots = scanPaths.length > 0 ? scanPaths : ['src'];
  const features = await loadSddFeatures(loadDocRoots().features);
  const ctx = requireFreshGraph('graphify-out/graph.json', srcRoots, features);
  if (!ctx) {
    console.error(
      'propose-pointers: graphify-out/graph.json is missing or stale. Run /graphify + pnpm toon, then retry.',
    );
    process.exitCode = 1;
    return;
  }

  const ranked = proposeCandidates(slug, ctx.graph, ctx.fileToFds);
  if (ranked.length === 0) {
    console.log(
      `propose-pointers for ${slug}: no candidate files surfaced from import/community signal.`,
    );
    return;
  }
  console.log(
    `propose-pointers for ${slug} — candidate files (add \`// @fd: ${slug}\` to the ones you accept, then run \`pnpm noldor sync code-links\`):`,
  );
  for (const c of ranked) console.log(`  [${c.score}] ${c.file}  (${c.reason})`);
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('propose-pointers');
if (invokedDirect) {
  void main();
}
