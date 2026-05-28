#!/usr/bin/env npx tsx

/**
 * Converts graphify graph.json into two LLM-optimized .toon text files:
 *
 *   graph.brainstorm.toon         — full topology grouped by community
 *   graph.brainstorm-summary.toon — compact overview (~4K tokens)
 *
 * Community labels are derived from node source_file paths since graphify's
 * OOTB output doesn't embed them in graph.json.
 *
 * Usage:  npx tsx scripts/graph-to-toon.ts graphify-out/graph.json
 */

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly community?: number;
  readonly source_file?: string;
  readonly file_type?: string;
}

interface GraphLink {
  readonly source: string;
  readonly target: string;
  readonly relation?: string;
  readonly confidence?: string;
}

interface Hyperedge {
  readonly id?: string;
  readonly label: string;
  readonly nodes?: readonly string[];
  readonly members?: readonly string[];
  readonly relation?: string;
  readonly confidence?: string;
}

function hyperedgeMembers(he: Hyperedge): readonly string[] {
  return he.nodes ?? he.members ?? [];
}

interface GraphData {
  readonly nodes: GraphNode[];
  readonly links: GraphLink[];
  readonly directed?: boolean;
  readonly community_labels?: Record<string, string>;
  readonly hyperedges?: Hyperedge[];
  readonly graph?: { readonly hyperedges?: Hyperedge[] };
}

interface GraphContext {
  readonly nodes: GraphNode[];
  readonly links: GraphLink[];
  readonly communityLabels: Record<string, string>;
  readonly idToLabel: Map<string, string>;
  readonly directed: boolean;
  readonly hyperedges: Hyperedge[];
}

interface ClassifiedEdges {
  readonly intra: Map<number, GraphLink[]>;
  readonly cross: GraphLink[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PATH_STRIP_PREFIXES = ['packages/', 'apps/', 'docs/'];

function shortenPath(sourceFile: string): string {
  for (const prefix of PATH_STRIP_PREFIXES) {
    if (sourceFile.startsWith(prefix)) {
      return sourceFile.slice(prefix.length);
    }
  }
  return sourceFile;
}

function writeAndLog(path: string, content: string): void {
  writeFileSync(path, content, 'utf8');
  const { size } = statSync(path);
  console.log(`  Wrote ${path} (${size.toLocaleString()} bytes)`);
}

function groupByCommunity(nodes: GraphNode[]): Map<number, GraphNode[]> {
  const groups = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const comm = n.community ?? -1;
    if (!groups.has(comm)) {
      groups.set(comm, []);
    }
    groups.get(comm)!.push(n);
  }
  return groups;
}

function buildIdToLabel(nodes: GraphNode[]): Map<string, string> {
  return new Map(nodes.map((n) => [n.id, n.label]));
}

function buildNodeCommunityMap(nodes: GraphNode[]): Map<string, number> {
  return new Map(nodes.map((n) => [n.id, n.community ?? -1]));
}

// ---------------------------------------------------------------------------
// Community label derivation (since graphify OOTB doesn't embed them)
// ---------------------------------------------------------------------------

function deriveCommunityLabel(nodes: GraphNode[]): string {
  // Collect package names
  const pkgCounts = new Map<string, number>();
  // Collect meaningful path segments (src subdirs, feature folders)
  const segCounts = new Map<string, number>();
  // Collect top node labels as fallback
  const labelSamples: string[] = [];

  for (const n of nodes) {
    const sf = n.source_file ?? '';
    if (sf) {
      const parts = sf.split('/');
      // Package name: packages/<name> or apps/<name>
      if (parts.length >= 2 && (parts[0] === 'packages' || parts[0] === 'apps')) {
        pkgCounts.set(parts[1], (pkgCounts.get(parts[1]) ?? 0) + 1);
      }
      // Meaningful subdirectory segments (skip src, __tests__, index files)
      const skip = new Set(['src', '__tests__', 'dev', 'lib', 'dist', 'node_modules']);
      for (const seg of parts.slice(2)) {
        if (!seg.includes('.') && !skip.has(seg) && seg.length > 1) {
          segCounts.set(seg, (segCounts.get(seg) ?? 0) + 1);
        }
      }
    }
    if (labelSamples.length < 3) {
      labelSamples.push(n.label);
    }
  }

  const topPkg = [...pkgCounts.entries()].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const topSegs = [...segCounts.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([s]) => s);

  const parts = [topPkg, ...topSegs].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(' / ');
  }

  // Fallback: top node labels
  return labelSamples.slice(0, 3).join(' · ') || `unlabeled`;
}

function deriveCommunityLabels(communityGroups: Map<number, GraphNode[]>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [commId, nodes] of communityGroups) {
    labels[String(commId)] = deriveCommunityLabel(nodes);
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Edge classification
// ---------------------------------------------------------------------------

function classifyEdges(links: GraphLink[], nodeCommunityMap: Map<string, number>): ClassifiedEdges {
  const intra = new Map<number, GraphLink[]>();
  const cross: GraphLink[] = [];

  for (const link of links) {
    const srcComm = nodeCommunityMap.get(link.source) ?? -1;
    const tgtComm = nodeCommunityMap.get(link.target) ?? -1;

    if (srcComm === tgtComm && srcComm !== -1) {
      if (!intra.has(srcComm)) {
        intra.set(srcComm, []);
      }
      intra.get(srcComm)!.push(link);
    } else {
      cross.push(link);
    }
  }

  return { cross, intra };
}

function formatEdgeLine(
  link: GraphLink,
  idToLabel: Map<string, string>,
  directed: boolean,
): string {
  const src = idToLabel.get(link.source) ?? link.source;
  const tgt = idToLabel.get(link.target) ?? link.target;
  const rel = link.relation ?? 'related';
  const arrow = directed ? `--${rel}-->` : `--${rel}--`;
  return `  ${src} ${arrow} ${tgt}`;
}

function formatCrossEdgeLine(
  link: GraphLink,
  idToLabel: Map<string, string>,
  nodeCommunityMap: Map<string, number>,
  directed: boolean,
): string {
  const src = idToLabel.get(link.source) ?? link.source;
  const tgt = idToLabel.get(link.target) ?? link.target;
  const srcComm = nodeCommunityMap.get(link.source) ?? -1;
  const tgtComm = nodeCommunityMap.get(link.target) ?? -1;
  const rel = link.relation ?? 'related';
  const arrow = directed ? `--${rel}-->` : `--${rel}--`;
  return `  ${src} [c${srcComm}] ${arrow} ${tgt} [c${tgtComm}]`;
}

// ---------------------------------------------------------------------------
// Brainstorm TOON (full)
// ---------------------------------------------------------------------------

function writeBrainstormToon(path: string, ctx: GraphContext): void {
  const { nodes, links, communityLabels, idToLabel, directed, hyperedges } = ctx;
  const communityGroups = groupByCommunity(nodes);
  const nodeCommunityMap = buildNodeCommunityMap(nodes);
  const { intra, cross } = classifyEdges(links, nodeCommunityMap);

  const lines: string[] = [];

  lines.push('# Domain Knowledge Graph — Brainstorm Context');
  lines.push(`# Generated from graph.json (${nodes.length} nodes, ${links.length} edges)`);
  lines.push('');
  lines.push(`directed: ${directed}`);

  // Communities sorted by ID
  const sortedComms = [...communityGroups.keys()].toSorted((a, b) => a - b);
  for (const commId of sortedComms) {
    const commNodes = communityGroups.get(commId)!;
    const label = communityLabels[String(commId)] ?? `Community ${commId}`;
    lines.push('');
    lines.push(`## community ${commId} (${commNodes.length} nodes) — ${label}`);

    lines.push('nodes:');
    const sorted = [...commNodes].toSorted((a, b) => a.label.localeCompare(b.label));
    for (const n of sorted) {
      const sf = shortenPath(n.source_file ?? '');
      lines.push(`  ${n.label},${sf},${n.community ?? -1}`);
    }

    const commEdges = intra.get(commId);
    if (commEdges?.length) {
      lines.push('edges:');
      for (const link of commEdges) {
        lines.push(formatEdgeLine(link, idToLabel, directed));
      }
    }
  }

  // Cross-community edges
  if (cross.length) {
    lines.push('');
    lines.push('## cross-community edges');
    for (const link of cross) {
      lines.push(formatCrossEdgeLine(link, idToLabel, nodeCommunityMap, directed));
    }
  }

  // Hyperedges
  if (hyperedges.length) {
    lines.push('');
    lines.push('## hyperedges');
    for (const he of hyperedges) {
      const nodeLabels = hyperedgeMembers(he)
        .map((nid) => idToLabel.get(nid) ?? nid)
        .join(', ');
      lines.push(`  ${he.label} [${he.relation ?? 'related'}]: ${nodeLabels}`);
    }
  }

  lines.push('');
  writeAndLog(path, lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Summary TOON
// ---------------------------------------------------------------------------

function extractPackages(nodes: GraphNode[]): readonly [string, number][] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const sf = n.source_file ?? '';
    if (!sf) {
      continue;
    }
    const parts = sf.split('/');
    if (parts.length >= 2 && (parts[0] === 'packages' || parts[0] === 'apps')) {
      counts.set(parts[1], (counts.get(parts[1]) ?? 0) + 1);
    }
  }
  return [...counts.entries()].toSorted((a, b) => b[1] - a[1]);
}

function extractConceptsAndRationales(nodes: GraphNode[]): {
  concepts: string[];
  rationales: string[];
} {
  const CONCEPT_PREFIXES = ['concept:', 'feature:', 'sdk:', 'component:', 'tool:'];
  const RATIONALE_PREFIX = 'rationale:';

  const concepts: string[] = [];
  const rationales: string[] = [];

  for (const n of nodes) {
    const nid = n.id ?? '';
    if (nid.startsWith(RATIONALE_PREFIX)) {
      const clean = n.label.startsWith('Rationale: ')
        ? n.label.slice('Rationale: '.length)
        : n.label;
      rationales.push(clean);
    } else if (CONCEPT_PREFIXES.some((p) => nid.startsWith(p))) {
      concepts.push(n.label);
    }
  }

  concepts.sort();
  rationales.sort();
  return { concepts, rationales };
}

function writeBrainstormSummary(path: string, ctx: GraphContext): void {
  const { nodes, links, communityLabels, idToLabel, directed, hyperedges } = ctx;
  const nCommunities = new Set(nodes.map((n) => n.community)).size;
  const communityGroups = groupByCommunity(nodes);
  const nodeCommunityMap = buildNodeCommunityMap(nodes);
  const { cross } = classifyEdges(links, nodeCommunityMap);

  const lines: string[] = [];

  lines.push('# Domain Knowledge Graph — Summary');
  lines.push(`# ${nodes.length} nodes, ${links.length} edges, ${nCommunities} communities`);
  lines.push('');
  lines.push(`directed: ${directed}`);

  // Packages
  const packages = extractPackages(nodes);
  if (packages.length) {
    lines.push('');
    lines.push('## packages');
    for (const [pkg, count] of packages) {
      lines.push(`  ${pkg} (${count} nodes)`);
    }
  }

  // Concepts & rationales
  const { concepts, rationales } = extractConceptsAndRationales(nodes);
  if (concepts.length) {
    lines.push('');
    lines.push('## concepts');
    for (const c of concepts) {
      lines.push(`  ${c}`);
    }
  }
  if (rationales.length) {
    lines.push('');
    lines.push('## rationales');
    for (const r of rationales) {
      lines.push(`  ${r}`);
    }
  }

  // Hyperedges
  if (hyperedges.length) {
    lines.push('');
    lines.push('## hyperedges');
    for (const he of hyperedges) {
      lines.push(
        `  ${he.label} (${hyperedgeMembers(he).length} nodes, ${he.relation ?? 'related'})`,
      );
    }
  }

  // Community index (top 20 by size)
  lines.push('');
  lines.push('## community index (top 20 by size)');
  const sortedComms = [...communityGroups.entries()]
    .toSorted((a, b) => b[1].length - a[1].length)
    .slice(0, 20);
  for (const [commId, commNodes] of sortedComms) {
    const label = communityLabels[String(commId)] ?? `Community ${commId}`;
    lines.push(`  c${commId} (${commNodes.length}): ${label}`);
  }

  // Cross-community edges (top 25)
  if (cross.length) {
    lines.push('');
    lines.push('## cross-community edges (top 25)');
    for (const link of cross.slice(0, 25)) {
      lines.push(formatCrossEdgeLine(link, idToLabel, nodeCommunityMap, directed));
    }
  }

  lines.push('');
  writeAndLog(path, lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(`Usage: npx tsx ${process.argv[1]} <graph.json> [graph.json ...]`);
    process.exit(1);
  }

  for (const inputPath of args) {
    const data: GraphData = JSON.parse(readFileSync(inputPath, 'utf8'));
    const { nodes, links, directed = false } = data;
    const nCommunities = new Set(nodes.map((n) => n.community)).size;

    console.log(
      `Loaded ${inputPath}: ${nodes.length} nodes, ${links.length} links, ${nCommunities} communities`,
    );

    // Derive community labels from node paths (graphify OOTB doesn't embed them)
    const communityGroups = groupByCommunity(nodes);
    const communityLabels = data.community_labels ?? deriveCommunityLabels(communityGroups);

    // Collect hyperedges — prefer root, fall back to graph.hyperedges
    const hyperedges: Hyperedge[] = data.hyperedges ?? data.graph?.hyperedges ?? [];

    const ctx: GraphContext = {
      communityLabels,
      directed,
      hyperedges,
      idToLabel: buildIdToLabel(nodes),
      links,
      nodes,
    };

    const dir = dirname(inputPath);
    writeBrainstormToon(join(dir, 'graph.brainstorm.toon'), ctx);
    writeBrainstormSummary(join(dir, 'graph.brainstorm-summary.toon'), ctx);
  }
}

main();
