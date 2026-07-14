import { readdir as fsReaddir, readFile as fsReadFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import matter from 'gray-matter';

import { loadDocRoots } from '../core/doc-roots.js';
import { FeatureFrontmatterSchema } from '../core/feature-schema.js';
import type { FeatureFrontmatter } from '../core/feature-schema.js';

export interface ResolvedOwner {
  slug: string;
  fd: FeatureFrontmatter;
}

interface FsSeams {
  /** Test seam — defaults to fs/promises readdir. */
  readdir?: (path: string) => Promise<string[]>;
  /** Test seam — defaults to fs/promises readFile. */
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
}

interface ResolveByLinksPlanOptions extends FsSeams {
  planPath: string;
  repo: string;
}

interface ResolveByLinksSpecOptions extends FsSeams {
  specPath: string;
  repo: string;
}

/** Shared FD scan: returns the first FD (filename order) for which `matches` is true. */
async function scanFdsForOwner(
  repo: string,
  seams: FsSeams,
  matches: (fd: FeatureFrontmatter) => boolean,
): Promise<ResolvedOwner | null> {
  const readdir = seams.readdir ?? ((p) => fsReaddir(p));
  const readFile = seams.readFile ?? ((p, e) => fsReadFile(p, e));
  const featuresDir = loadDocRoots(repo).features;
  let entries: string[];
  try {
    entries = await readdir(featuresDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const fdPath = join(featuresDir, entry);
    let raw: string;
    try {
      raw = await readFile(fdPath, 'utf8');
    } catch {
      continue;
    }
    let parsed: ReturnType<typeof matter>;
    try {
      parsed = matter(raw);
    } catch {
      continue;
    }
    let fd: FeatureFrontmatter;
    try {
      fd = FeatureFrontmatterSchema.parse(parsed.data);
    } catch {
      continue;
    }
    if (matches(fd)) {
      return { slug: entry.replace(/\.md$/, ''), fd };
    }
  }
  return null;
}

/**
 * Fallback resolver in the detector's plan-staleness chain. Scans every
 * `docs/features/*.md` FD; if any has `links.plan` containing the plan
 * path (verbatim string match, single string or array), returns that FD
 * as the owner. Used when the filename-slug heuristic
 * (`detectStalePlans` primary signal) doesn't match any FD — e.g.
 * multi-feature plans, infra plans.
 *
 * Today's hit rate is zero: no existing FD uses `links.plan` (audited
 * 2026-05-17 during release-sweep-process-hardening part 3 planning).
 * Future-facing for parent FDs that adopt the field.
 */
export async function resolveByLinksPlan(
  opts: ResolveByLinksPlanOptions,
): Promise<ResolvedOwner | null> {
  return scanFdsForOwner(opts.repo, opts, (fd) => {
    const planList = (fd.links as { plan?: string | string[] }).plan;
    const plans = Array.isArray(planList) ? planList : planList ? [planList] : [];
    return plans.includes(opts.planPath);
  });
}

/**
 * Spec analog of {@link resolveByLinksPlan}: returns the FD whose
 * `links.spec` matches the spec path verbatim. Covers attach-path specs
 * (`<date>-<parent>-<enhancement>-design.md`) whose filename slug never
 * matches an FD but which a parent FD still owns via its `spec:` link —
 * without this, `detectStaleSpecs`' age-out signal flags them as archive
 * candidates while the owning work is live.
 */
export async function resolveByLinksSpec(
  opts: ResolveByLinksSpecOptions,
): Promise<ResolvedOwner | null> {
  return scanFdsForOwner(opts.repo, opts, (fd) => fd.links.spec === opts.specPath);
}

interface GraphAdjNode {
  id: string;
  source_file?: string;
}
interface GraphAdjLink {
  source: string;
  target: string;
  relation?: string;
}
interface GraphAdjData {
  nodes?: GraphAdjNode[];
  links?: GraphAdjLink[];
}

interface ResolveByGraphAdjacencyOptions extends FsSeams {
  repo: string;
  /** Plan/spec relative path, e.g. `docs/design/plans/<f>.md`. */
  docPath: string;
  relation: 'plan-of' | 'spec-of';
  /** Override the graph path (defaults to `<repo>/graphify-out/graph.json`). */
  graphPath?: string;
}

/**
 * Last-resort fallback in the detector chain: resolve a plan/spec to its owning
 * FD by following the `plan-of` / `spec-of` edge in the enriched
 * `graphify-out/graph.json` (see `src/graphify/enrich-doc-nodes.ts`). Wired in
 * AFTER {@link resolveByLinksPlan}/{@link resolveByLinksSpec} and BEFORE age-out,
 * so it only ever resolves artifacts the authoritative slug/`links.*` signals
 * miss. A missing graph file, missing node, missing edge, or unreadable owner FD
 * all degrade to `null` (→ today's age-out), never a wrong-direction block.
 */
export async function resolveByGraphAdjacency(
  opts: ResolveByGraphAdjacencyOptions,
): Promise<ResolvedOwner | null> {
  const readFile = opts.readFile ?? ((p, e) => fsReadFile(p, e));
  const graphPath = opts.graphPath ?? join(opts.repo, 'graphify-out', 'graph.json');
  let data: GraphAdjData;
  try {
    data = JSON.parse(await readFile(graphPath, 'utf8')) as GraphAdjData;
  } catch {
    return null; // no graph (or unparseable) → no finding
  }
  const node = (data.nodes ?? []).find((n) => n.source_file === opts.docPath);
  if (!node) return null;
  const edge = (data.links ?? []).find((l) => l.source === node.id && l.relation === opts.relation);
  if (!edge) return null;
  const fdNode = (data.nodes ?? []).find((n) => n.id === edge.target);
  if (!fdNode?.source_file) return null;
  // FD node source_file is `docs/features/<slug>.md`.
  const slug = basename(fdNode.source_file, '.md');
  const fdPath = join(loadDocRoots(opts.repo).features, `${slug}.md`);
  try {
    const fd = FeatureFrontmatterSchema.parse(matter(await readFile(fdPath, 'utf8')).data);
    return { slug, fd };
  } catch {
    return null;
  }
}
