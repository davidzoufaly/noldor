import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import matter from 'gray-matter';

import { loadDocRoots } from '../core/doc-roots.js';
import { FeatureFrontmatterSchema } from '../features/feature-schema.js';
import { planSlugFromFilename, specSlugFromFilename } from '../garden/garden-detect.js';

/**
 * Post-build enrichment of `graphify-out/graph.json`: represent feature MDs,
 * plans, and specs as `file_type: 'doc'` nodes and emit `plan-of` / `spec-of`
 * edges from each plan/spec to its owning FD. Unblocks the graph-adjacency
 * fallback in `detectStalePlans` / `detectStaleSpecs`. Idempotent — a re-run
 * strips the prior doc nodes + doc edges and rebuilds them, so output is stable
 * and it survives a fresh (non-`--update`) graphify overwrite of the same file.
 * Sits in the same architectural slot as `graph-to-toon.ts` (a pass over the
 * external graphify output, never a patch to graphify itself).
 */

export interface GraphNode {
  id: string;
  label: string;
  community?: number;
  source_file?: string;
  file_type?: string;
}

export interface GraphLink {
  source: string;
  target: string;
  relation?: string;
  confidence?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  directed?: boolean;
  community_labels?: Record<string, string>;
  [k: string]: unknown;
}

/** Stable, collision-free node id for a doc file (the relative path is unique). */
function docNodeId(relPath: string): string {
  return `doc:${relPath}`;
}

/** Source-file path tokens referenced in a plan/spec body (markdown links + inline mentions). */
const PATH_RE = /(?:src|scripts|packages|apps|tests?)\/[A-Za-z0-9_./-]+\.[A-Za-z]{1,5}/g;

function referencedPaths(body: string): string[] {
  return [...new Set(body.match(PATH_RE) ?? [])];
}

/** True when a referenced source path is owned by one of an FD's `links.code` entries
 *  (exact, or a `…/**` glob prefix — the only glob shape FDs use). */
function codeOwns(codeEntries: readonly string[], path: string): boolean {
  return codeEntries.some((entry) => {
    if (entry === path) return true;
    if (entry.endsWith('/**')) return path.startsWith(entry.slice(0, -2));
    if (entry.endsWith('**')) return path.startsWith(entry.slice(0, -2));
    return false;
  });
}

interface FdInfo {
  slug: string;
  nodeId: string;
  relPath: string;
  code: string[];
  plan: string[];
  spec: string[];
}

function asArray(v: string | string[] | undefined): string[] {
  return Array.isArray(v) ? v : v ? [v] : [];
}

function loadFds(repo: string): FdInfo[] {
  const dir = loadDocRoots(repo).features;
  if (!existsSync(dir)) return [];
  const out: FdInfo[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.md')) continue;
    const relPath = join('docs/features', entry);
    let fm: ReturnType<typeof FeatureFrontmatterSchema.parse>;
    try {
      fm = FeatureFrontmatterSchema.parse(matter(readFileSync(join(dir, entry), 'utf8')).data);
    } catch {
      continue;
    }
    const links = fm.links as {
      code?: string[];
      plan?: string | string[];
      spec?: string | string[];
    };
    out.push({
      slug: entry.replace(/\.md$/, ''),
      nodeId: docNodeId(relPath),
      relPath,
      code: links.code ?? [],
      plan: asArray(links.plan),
      spec: asArray(links.spec),
    });
  }
  return out;
}

interface DocFile {
  relPath: string;
  slug: string | null;
  label: string;
  body: string;
}

function loadDocDir(repo: string, kind: 'plans' | 'specs'): DocFile[] {
  const roots = loadDocRoots(repo);
  const dir = kind === 'plans' ? roots.plans : roots.specs;
  const relBase = kind === 'plans' ? 'docs/superpowers/plans' : 'docs/superpowers/specs';
  const slugFn = kind === 'plans' ? planSlugFromFilename : specSlugFromFilename;
  if (!existsSync(dir)) return [];
  const out: DocFile[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.md')) continue;
    const slug = slugFn(entry);
    out.push({
      relPath: join(relBase, entry),
      slug,
      label: slug ?? entry.replace(/\.md$/, ''),
      body: readFileSync(join(dir, entry), 'utf8'),
    });
  }
  return out;
}

/**
 * Resolve the owning FD for a plan/spec via the priority chain:
 * (a) FD `links.plan`/`links.spec` contains the path → EXTRACTED;
 * (b) filename slug equals an FD slug → EXTRACTED;
 * (c) transitive code-neighbor: the body references source paths an FD owns via
 *     `links.code`; pick the FD sharing the most → INFERRED.
 * Returns null when nothing matches (no edge emitted).
 */
export function resolveOwner(
  doc: DocFile,
  kind: 'plans' | 'specs',
  fds: readonly FdInfo[],
): { fd: FdInfo; confidence: 'EXTRACTED' | 'INFERRED' } | null {
  // (a) verbatim links.* match
  const byLink = fds.find((f) => (kind === 'plans' ? f.plan : f.spec).includes(doc.relPath));
  if (byLink) return { fd: byLink, confidence: 'EXTRACTED' };
  // (b) filename slug
  if (doc.slug) {
    const bySlug = fds.find((f) => f.slug === doc.slug);
    if (bySlug) return { fd: bySlug, confidence: 'EXTRACTED' };
  }
  // (c) transitive code-neighbor — max shared referenced path
  const paths = referencedPaths(doc.body);
  let best: { fd: FdInfo; score: number } | null = null;
  for (const fd of fds) {
    const score = paths.filter((p) => codeOwns(fd.code, p)).length;
    if (score > 0 && (best === null || score > best.score)) best = { fd, score };
  }
  return best ? { fd: best.fd, confidence: 'INFERRED' } : null;
}

/**
 * Pure enrichment: given parsed graph data + the repo's FDs/plans/specs, return a
 * NEW GraphData with doc nodes + plan-of/spec-of edges. Strips any prior doc
 * nodes (`file_type: 'doc'`) and `plan-of`/`spec-of` edges first, so it is fully
 * idempotent and overwrite-safe.
 */
export function enrichGraph(
  data: GraphData,
  fds: readonly FdInfo[],
  plans: readonly DocFile[],
  specs: readonly DocFile[],
): GraphData {
  // Strip prior enrichment so re-runs are a no-op delta.
  const codeNodes = data.nodes.filter((n) => n.file_type !== 'doc');
  const codeLinks = data.links.filter((l) => l.relation !== 'plan-of' && l.relation !== 'spec-of');

  const docCommunity = codeNodes.reduce((max, n) => Math.max(max, n.community ?? -1), -1) + 1;

  const docNodes: GraphNode[] = [];
  const pushNode = (relPath: string, label: string): void => {
    docNodes.push({
      id: docNodeId(relPath),
      label,
      file_type: 'doc',
      source_file: relPath,
      community: docCommunity,
    });
  };
  for (const fd of fds) pushNode(fd.relPath, fd.slug);
  for (const p of plans) pushNode(p.relPath, p.label);
  for (const s of specs) pushNode(s.relPath, s.label);

  const docLinks: GraphLink[] = [];
  const emit = (docs: readonly DocFile[], kind: 'plans' | 'specs', relation: string): void => {
    for (const doc of docs) {
      const owner = resolveOwner(doc, kind, fds);
      if (!owner) continue;
      docLinks.push({
        source: docNodeId(doc.relPath),
        target: owner.fd.nodeId,
        relation,
        confidence: owner.confidence,
      });
    }
  };
  emit(plans, 'plans', 'plan-of');
  emit(specs, 'specs', 'spec-of');

  const community_labels = { ...data.community_labels, [String(docCommunity)]: 'docs' };

  return {
    ...data,
    nodes: [...codeNodes, ...docNodes],
    links: [...codeLinks, ...docLinks],
    community_labels,
  };
}

/** IO wrapper: read graph.json, enrich against the repo's docs, write back in place. */
export function enrichDocNodes(repo: string, graphPath: string): GraphData {
  const data = JSON.parse(readFileSync(graphPath, 'utf8')) as GraphData;
  const enriched = enrichGraph(
    data,
    loadFds(repo),
    loadDocDir(repo, 'plans'),
    loadDocDir(repo, 'specs'),
  );
  writeFileSync(graphPath, `${JSON.stringify(enriched, null, 2)}\n`, 'utf8');
  return enriched;
}

function main(): void {
  const repo = process.cwd();
  const graphPath = process.argv[2] ?? join(repo, 'graphify-out/graph.json');
  if (!existsSync(graphPath)) {
    process.stderr.write(`enrich-doc-nodes: ${graphPath} not found — run /graphify first.\n`);
    process.exit(0); // absence is not an error (matches the detector's "no graph → no finding")
  }
  const out = enrichDocNodes(repo, graphPath);
  const docNodes = out.nodes.filter((n) => n.file_type === 'doc').length;
  const docEdges = out.links.filter(
    (l) => l.relation === 'plan-of' || l.relation === 'spec-of',
  ).length;
  process.stdout.write(
    `enrich-doc-nodes: ${docNodes} doc nodes, ${docEdges} plan-of/spec-of edges → ${graphPath}\n`,
  );
}

const invokedDirect = /[\\/]enrich-doc-nodes\.(ts|js|mjs)$/.test(process.argv[1] ?? '');
if (invokedDirect) main();
