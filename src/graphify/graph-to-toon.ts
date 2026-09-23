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

import { isEntrypoint } from '../core/cli-entry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly community?: number;
  readonly source_file?: string;
  readonly file_type?: string;
}

export interface GraphLink {
  readonly source: string;
  readonly target: string;
  readonly relation?: string;
  readonly confidence?: string;
}

export interface Hyperedge {
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

export interface GraphData {
  readonly nodes: GraphNode[];
  readonly links: GraphLink[];
  readonly directed?: boolean;
  readonly community_labels?: Record<string, string>;
  readonly hyperedges?: Hyperedge[];
  readonly graph?: { readonly hyperedges?: Hyperedge[] };
}

export interface GraphContext {
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

/**
 * Ordering pinned to raw code units. `localeCompare` resolves against the
 * machine locale — under `cs_CZ` Czech collates `ch` after `h`, so the same
 * graph would emit a different node order on an operator's laptop than on an
 * `en_US` CI runner, and the two producers would churn against each other.
 * Every ordering in both emitted files goes through this.
 */
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Single-letter relation codes. `p`/`s` cover `graphify enrich-docs` output. */
const REL_CODE: Record<string, string> = {
  calls: 'f',
  imports: 'i',
  method: 'm',
  'plan-of': 'p',
  re_exports: 'e',
  references: 'r',
  'spec-of': 's',
};

/** Edges recoverable from node placement or from other edges — dropped to save tokens. */
const REL_OMIT: ReadonlySet<string> = new Set(['contains', 'imports_from']);

const HUB_MIN_DEGREE = 2;
const HUB_TOP_N = 5;
const SIG_MIN_NODES = 3;
const PREFIX_MIN_LEN = 4;

/** Collapse newlines and tabs: the format is line-oriented, so a multi-line label corrupts it. */
function sanitizeLine(s: string): string {
  return s
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** A trailing `()` becomes `!` — two characters saved on every function node. */
function formatNodeLabel(label: string): string {
  const clean = sanitizeLine(label);
  return clean.endsWith('()') ? `${clean.slice(0, -2)}!` : clean;
}

/** Longest common prefix truncated at the last slash, or none when it buys under 4 characters. */
function factorCommonPrefix(paths: readonly string[]): {
  prefix: string;
  stripped: string[];
} {
  if (paths.length < 2) {
    return { prefix: '', stripped: [...paths] };
  }
  let cp = paths[0];
  for (let i = 1; i < paths.length; i++) {
    const p = paths[i];
    const lim = Math.min(cp.length, p.length);
    let j = 0;
    while (j < lim && cp[j] === p[j]) j++;
    cp = cp.slice(0, j);
    if (!cp) break;
  }
  const lastSlash = cp.lastIndexOf('/');
  cp = lastSlash >= 0 ? cp.slice(0, lastSlash + 1) : '';
  if (cp.length < PREFIX_MIN_LEN) {
    return { prefix: '', stripped: [...paths] };
  }
  return { prefix: cp, stripped: paths.map((p) => p.slice(cp.length)) };
}

interface HubStats {
  readonly idx: number;
  readonly fanIn: number;
  readonly fanOut: number;
}

/** Top hubs by total degree, ties broken by label so the line is reproducible. */
function computeHubs(
  commEdges: readonly GraphLink[],
  localIdx: Map<string, number>,
  sortedNodes: readonly GraphNode[],
): HubStats[] {
  const fanOut = new Map<number, number>();
  const fanIn = new Map<number, number>();
  for (const l of commEdges) {
    const s = localIdx.get(l.source);
    const t = localIdx.get(l.target);
    if (s !== undefined) fanOut.set(s, (fanOut.get(s) ?? 0) + 1);
    if (t !== undefined) fanIn.set(t, (fanIn.get(t) ?? 0) + 1);
  }
  const stats: HubStats[] = [];
  for (const idx of new Set<number>([...fanOut.keys(), ...fanIn.keys()])) {
    const fi = fanIn.get(idx) ?? 0;
    const fo = fanOut.get(idx) ?? 0;
    if (fi + fo < HUB_MIN_DEGREE) continue;
    stats.push({ fanIn: fi, fanOut: fo, idx });
  }
  return stats
    .toSorted(
      (a, b) =>
        b.fanIn + b.fanOut - (a.fanIn + a.fanOut) ||
        byCodeUnit(sortedNodes[a.idx].label, sortedNodes[b.idx].label),
    )
    .slice(0, HUB_TOP_N);
}

/**
 * Push one community's v3 block onto `lines` and return the number of edge rows
 * it emitted. Indices are community-local and 0-based. The return value is what
 * the header's edge count is built from: adjacency collapses parallel links
 * between the same pair under one relation into a single entry, so counting the
 * input links instead would print a total the file does not encode.
 */
function emitCommunity(
  lines: string[],
  commId: number,
  commNodes: readonly GraphNode[],
  commEdges: readonly GraphLink[],
  communityLabels: Record<string, string>,
): number {
  const label = communityLabels[String(commId)] ?? `Community ${commId}`;
  // Label, then id. Labels are not unique inside a community, and a tie left
  // to the input order makes every index in the block a function of how
  // graphify happened to emit its nodes.
  const sortedNodes = [...commNodes].toSorted(
    (a, b) => byCodeUnit(a.label, b.label) || byCodeUnit(a.id, b.id),
  );
  const localIdx = new Map<string, number>(sortedNodes.map((n, i) => [n.id, i]));

  const uniquePaths = [
    ...new Set(sortedNodes.map((n) => shortenPath(n.source_file ?? ''))),
  ].toSorted(byCodeUnit);
  const { prefix, stripped } = factorCommonPrefix(uniquePaths);
  const pathLocal = new Map<string, number>(uniquePaths.map((p, i) => [p, i]));

  lines.push(`## c${commId} (${commNodes.length}) ${sanitizeLine(label)}`);

  if (commNodes.length >= SIG_MIN_NODES && commEdges.length > 0) {
    const hubs = computeHubs(commEdges, localIdx, sortedNodes);
    if (hubs.length > 0) {
      const parts = hubs.map(
        (h) => `${formatNodeLabel(sortedNodes[h.idx].label)}(${h.fanIn}/${h.fanOut})`,
      );
      lines.push(`sig hubs=${parts.join(' ')}`);
    }
  }

  lines.push(prefix ? `p[${uniquePaths.length}] prefix=${prefix}` : `p[${uniquePaths.length}]`);
  for (let i = 0; i < stripped.length; i++) {
    lines.push(`  ${i}=${stripped[i]}`);
  }

  lines.push('n');
  for (let i = 0; i < sortedNodes.length; i++) {
    const n = sortedNodes[i];
    const pi = pathLocal.get(shortenPath(n.source_file ?? '')) ?? 0;
    lines.push(`  ${i} ${formatNodeLabel(n.label)} @${pi}`);
  }

  if (commEdges.length === 0) {
    return 0;
  }

  const byRel = new Map<string, Map<number, Set<number>>>();
  for (const l of commEdges) {
    const r = REL_CODE[l.relation ?? ''] ?? '?';
    const s = localIdx.get(l.source);
    const t = localIdx.get(l.target);
    if (s === undefined || t === undefined) continue;
    if (!byRel.has(r)) byRel.set(r, new Map());
    const bySrc = byRel.get(r)!;
    if (!bySrc.has(s)) bySrc.set(s, new Set());
    bySrc.get(s)!.add(t);
  }

  lines.push('e');
  let emitted = 0;
  for (const r of [...byRel.keys()].toSorted(byCodeUnit)) {
    const bySrc = byRel.get(r)!;
    for (const s of [...bySrc.keys()].toSorted((a, b) => a - b)) {
      const targets = [...bySrc.get(s)!].toSorted((a, b) => a - b);
      lines.push(`  ${r} ${s}>${targets.join(',')}`);
      emitted += targets.length;
    }
  }
  return emitted;
}

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

// ---------------------------------------------------------------------------
// Brainstorm TOON (full)
// ---------------------------------------------------------------------------

/** `<relCode> <srcLabel>@c<id>><tgtLabel>@c<id>`, shared by the brainstorm block
 *  and the summary's top-25 list so the two never drift apart. */
function crossRows(
  cross: readonly GraphLink[],
  idToLabel: Map<string, string>,
  nodeCommunityMap: Map<string, number>,
): string[] {
  return cross
    .filter((l) => !REL_OMIT.has(l.relation ?? ''))
    .map((l) => ({
      rel: REL_CODE[l.relation ?? ''] ?? '?',
      src: formatNodeLabel(idToLabel.get(l.source) ?? l.source),
      srcComm: nodeCommunityMap.get(l.source) ?? -1,
      tgt: formatNodeLabel(idToLabel.get(l.target) ?? l.target),
      tgtComm: nodeCommunityMap.get(l.target) ?? -1,
    }))
    .toSorted(
      (a, b) =>
        byCodeUnit(a.rel, b.rel) ||
        byCodeUnit(a.src, b.src) ||
        byCodeUnit(a.tgt, b.tgt) ||
        // Labels are not unique across communities either — `main!` in c3 and
        // `main!` in c9 tie on all three keys above, and the leftover order is
        // graphify's.
        a.srcComm - b.srcComm ||
        a.tgtComm - b.tgtComm,
    )
    .map((r) => `  ${r.rel} ${r.src}@c${r.srcComm}>${r.tgt}@c${r.tgtComm}`);
}

/** Members are named rather than indexed: a hyperedge spans communities, so the
 *  local indices do not apply. Graph order is kept — it is already deterministic. */
function hyperedgeRows(hyperedges: readonly Hyperedge[], idToLabel: Map<string, string>): string[] {
  return hyperedges.map((he) => {
    const members = hyperedgeMembers(he)
      .map((nid) => sanitizeLine(idToLabel.get(nid) ?? nid))
      .join(', ');
    return `  ${sanitizeLine(he.label)} [${he.relation ?? 'related'}]: ${members}`;
  });
}

interface TocEntry {
  readonly key: string;
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Re-reads the assembled lines and throws when a TOC entry does not land on its
 * `## ` header. Hand-computed line arithmetic is exactly the kind of thing that
 * drifts silently when the body emission changes, so the emitter checks itself.
 */
function validateToc(lines: readonly string[], entries: readonly TocEntry[]): void {
  for (const e of entries) {
    const actual = lines[e.startLine - 1] ?? '';
    const isCommunity = /^c\d+$/.test(e.key);
    const expected = isCommunity ? `## ${e.key} ` : `## ${e.key}`;
    const ok = isCommunity ? actual.startsWith(expected) : actual === expected;
    if (!ok) {
      throw new Error(
        `TOC drift: ${e.key} expected at line ${e.startLine} ("${expected}"), got "${actual}"`,
      );
    }
  }
}

export function renderBrainstormToon(ctx: GraphContext): string {
  const { nodes, links, communityLabels, directed } = ctx;
  const communityGroups = groupByCommunity(nodes);
  const nodeCommunityMap = buildNodeCommunityMap(nodes);
  const { intra, cross } = classifyEdges(links, nodeCommunityMap);

  // Pass 1 — body, with line ranges relative to the body's own first line.
  const body: string[] = [];
  const entries: TocEntry[] = [];
  let totalEdges = 0;

  for (const commId of [...communityGroups.keys()].toSorted((a, b) => a - b)) {
    const startLine = body.length + 1;
    const commNodes = communityGroups.get(commId)!;
    const commEdges = (intra.get(commId) ?? []).filter((l) => !REL_OMIT.has(l.relation ?? ''));
    totalEdges += emitCommunity(body, commId, commNodes, commEdges, communityLabels);
    entries.push({ endLine: body.length, key: `c${commId}`, startLine });
    body.push('');
  }

  const crossLines = crossRows(cross, ctx.idToLabel, nodeCommunityMap);
  if (crossLines.length > 0) {
    const startLine = body.length + 1;
    body.push('## cross', ...crossLines);
    entries.push({ endLine: body.length, key: 'cross', startLine });
    totalEdges += crossLines.length;
  }

  const hyperLines = hyperedgeRows(ctx.hyperedges, ctx.idToLabel);
  if (hyperLines.length > 0) {
    if (crossLines.length > 0) {
      body.push('');
    }
    const startLine = body.length + 1;
    body.push('## hyperedges', ...hyperLines);
    entries.push({ endLine: body.length, key: 'hyperedges', startLine });
  }

  // Pass 2 — a header whose length is known, then shift every range by it.
  const header: string[] = [
    '# Domain Knowledge Graph (v3 — compact)',
    '# version: 3',
    `# ${nodes.length} nodes, ${totalEdges} edges (contains/imports_from omitted), ${communityGroups.size} communities, directed=${directed}`,
    '# Per community: sig (top hubs by fan-in/out) | p (local paths, prefix-factored) | n (nodes) | e (edges)',
    '# Rels: i=imports f=calls e=re_exports r=references m=method p=plan-of s=spec-of',
    '# Node row: <local_id> <label>[!=function] @<path_id>',
    '# Edge row: <rel> <src>><t1,t2,...>',
    '# TOC: <key>: <startLine>-<endLine>  (use Read offset/limit to load a single section)',
    '',
    'toc',
  ];
  const totalHeaderLines = header.length + entries.length + 1;
  const shifted = entries.map(
    (e): TocEntry => ({
      endLine: e.endLine + totalHeaderLines,
      key: e.key,
      startLine: e.startLine + totalHeaderLines,
    }),
  );
  for (const e of shifted) {
    header.push(`  ${e.key}: ${e.startLine}-${e.endLine}`);
  }
  header.push('');

  const lines = [...header, ...body, ''];
  validateToc(lines, shifted);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Summary TOON
// ---------------------------------------------------------------------------

interface FeatureInfo {
  readonly name: string;
  readonly nodeCount: number;
  readonly subfolders: string;
}

function extractPackages(nodes: readonly GraphNode[]): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const parts = (n.source_file ?? '').split('/');
    if (parts.length >= 2 && (parts[0] === 'packages' || parts[0] === 'apps')) {
      counts.set(parts[1], (counts.get(parts[1]) ?? 0) + 1);
    }
  }
  return [...counts.entries()].toSorted((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]));
}

/**
 * Feature folders, read from any `…/features/<name>/…` path segment.
 *
 * `__tests__` is excluded because it is a test location, not a feature. In
 * noldor's own graph it is the *only* match — `src/features/__tests__/*` — so
 * without the exclusion the block would read `__tests__: N nodes` and nothing
 * else, which is worse than no block at all. With it, noldor emits no
 * `## features` section and a consumer that really has feature folders still
 * gets one.
 */
const NOT_A_FEATURE: ReadonlySet<string> = new Set(['__tests__', '__mocks__', '__fixtures__']);

function extractFeatures(nodes: readonly GraphNode[]): FeatureInfo[] {
  const counts = new Map<string, number>();
  const subfolders = new Map<string, Map<string, number>>();

  for (const n of nodes) {
    const sf = n.source_file ?? '';
    if (!sf.includes('/features/')) continue;
    const parts = sf.split('/features/')[1].split('/');
    const name = parts[0];
    if (name.includes('.') || NOT_A_FEATURE.has(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (parts.length > 1 && !parts[1].includes('.')) {
      const subs = subfolders.get(name) ?? new Map<string, number>();
      subs.set(parts[1], (subs.get(parts[1]) ?? 0) + 1);
      subfolders.set(name, subs);
    }
  }

  return [...counts.entries()]
    .toSorted((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]))
    .map(([name, nodeCount]): FeatureInfo => {
      const subs = subfolders.get(name);
      return {
        name,
        nodeCount,
        subfolders: subs
          ? [...subs.entries()]
              .toSorted((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]))
              .slice(0, 4)
              .map(([sub]) => sub)
              .join(', ')
          : '',
      };
    });
}

function extractConceptsAndRationales(nodes: readonly GraphNode[]): {
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
      rationales.push(
        n.label.startsWith('Rationale: ') ? n.label.slice('Rationale: '.length) : n.label,
      );
    } else if (CONCEPT_PREFIXES.some((prefix) => nid.startsWith(prefix))) {
      concepts.push(n.label);
    }
  }

  return {
    concepts: concepts.toSorted(byCodeUnit),
    rationales: rationales.toSorted(byCodeUnit),
  };
}

export function renderBrainstormSummary(ctx: GraphContext): string {
  const { nodes, links, communityLabels, directed, hyperedges } = ctx;
  const communityGroups = groupByCommunity(nodes);
  const nodeCommunityMap = buildNodeCommunityMap(nodes);
  const { cross } = classifyEdges(links, nodeCommunityMap);

  const lines: string[] = [
    '# Domain Knowledge Graph — Summary (v3)',
    '# version: 3',
    `# ${nodes.length} nodes, ${links.length} edges, ${communityGroups.size} communities, directed=${directed}`,
    '# Deep dive: graph.brainstorm.toon (TOC at top — use Read offset/limit per community)',
    '# Compact format used in brainstorm.toon:',
    '#   Rels: i=imports f=calls e=re_exports r=references m=method p=plan-of s=spec-of  (contains/imports_from omitted — derivable)',
    '#   Node row: <local_id> <label>[!=function] @<path_id>',
    '#   Edge row: <rel> <src>><t1,t2,...>',
    '#   Cross-edge row (this file + brainstorm.toon ## cross): <rel> <label>@c<src_comm>><label>@c<tgt_comm>',
  ];

  const packages = extractPackages(nodes);
  if (packages.length > 0) {
    lines.push('', '## packages');
    for (const [pkg, count] of packages) {
      lines.push(`  ${pkg} (${count} nodes)`);
    }
  }

  const features = extractFeatures(nodes);
  if (features.length > 0) {
    lines.push('', '## features');
    for (const { name, nodeCount, subfolders } of features) {
      lines.push(
        subfolders
          ? `  ${name}: ${nodeCount} nodes — ${subfolders}`
          : `  ${name}: ${nodeCount} nodes`,
      );
    }
  }

  const { concepts, rationales } = extractConceptsAndRationales(nodes);
  if (concepts.length > 0) {
    lines.push('', '## concepts');
    for (const c of concepts) lines.push(`  ${sanitizeLine(c)}`);
  }
  if (rationales.length > 0) {
    lines.push('', '## rationales');
    for (const r of rationales) lines.push(`  ${sanitizeLine(r)}`);
  }

  const hyperLines = hyperedges.map(
    (he) =>
      `  ${sanitizeLine(he.label)} (${hyperedgeMembers(he).length} nodes, ${he.relation ?? 'related'})`,
  );
  if (hyperLines.length > 0) {
    lines.push('', '## hyperedges', ...hyperLines);
  }

  lines.push('', '## community index (top 20 by size)');
  const ranked = [...communityGroups.entries()]
    .toSorted((a, b) => b[1].length - a[1].length || a[0] - b[0])
    .slice(0, 20);
  for (const [commId, commNodes] of ranked) {
    const label = communityLabels[String(commId)] ?? `Community ${commId}`;
    lines.push(`  c${commId} (${commNodes.length}): ${sanitizeLine(label)}`);
  }

  const top25 = crossRows(cross, ctx.idToLabel, nodeCommunityMap).slice(0, 25);
  if (top25.length > 0) {
    lines.push('', '## cross-community edges (top 25)', ...top25);
  }

  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Build the shared render context from a parsed graph.json — the only place
 *  the `community_labels` fallback and the two hyperedge locations are resolved. */
export function buildContext(data: GraphData): GraphContext {
  const { nodes, links, directed = false } = data;
  return {
    communityLabels: data.community_labels ?? deriveCommunityLabels(groupByCommunity(nodes)),
    directed,
    hyperedges: data.hyperedges ?? data.graph?.hyperedges ?? [],
    idToLabel: buildIdToLabel(nodes),
    links,
    nodes,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(`Usage: noldor graphify graph-to-toon <graph.json> [graph.json ...]`);
    process.exit(1);
  }

  for (const inputPath of args) {
    const data: GraphData = JSON.parse(readFileSync(inputPath, 'utf8'));
    const nCommunities = new Set(data.nodes.map((n) => n.community)).size;
    console.log(
      `Loaded ${inputPath}: ${data.nodes.length} nodes, ${data.links.length} links, ${nCommunities} communities`,
    );

    const ctx = buildContext(data);
    const dir = dirname(inputPath);
    writeAndLog(join(dir, 'graph.brainstorm.toon'), renderBrainstormToon(ctx));
    writeAndLog(join(dir, 'graph.brainstorm-summary.toon'), renderBrainstormSummary(ctx));
  }
}

if (isEntrypoint(import.meta.url)) main();
