import { readdir as fsReaddir, readFile as fsReadFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { loadDocRoots } from '../core/doc-roots.js';
import { parseFdFrontmatter } from '../core/fd-load.js';
import type { FeatureFrontmatter } from '../core/feature-schema.js';

export interface ResolvedOwner {
  slug: string;
  fd: FeatureFrontmatter;
}

/**
 * Outcome of one step in the design-artifact ownership chain.
 *
 * `unreadable` is the third state that keeps the chain honest: an FD that
 * exists but whose frontmatter will not parse claims ownership of unknown
 * phase, so it must neither be read as "no owner" (which would age the
 * artifact out and suggest archiving live design work) nor abort the run.
 * Every resolver returns it for the same input class, and
 * `detectStaleDesignArtifacts` emits no finding on it. FD validity itself is
 * owned by `noldor features validate` — a release-preflight probe — not by
 * the staleness detectors.
 */
export type OwnerResolution =
  | { readonly outcome: 'resolved'; readonly owner: ResolvedOwner }
  | { readonly outcome: 'none' }
  | { readonly outcome: 'unreadable'; readonly detail: string };

interface FsSeams {
  /** Test seam — defaults to fs/promises readdir. */
  readdir?: (path: string) => Promise<string[]>;
  /** Test seam — defaults to fs/promises readFile. */
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
}

interface ResolveByLinksFieldOptions extends FsSeams {
  /** Artifact path as written in the FD, e.g. `docs/design/specs/<f>.md`. */
  docPath: string;
  /** FD frontmatter field that names artifacts of this kind. */
  field: 'plan' | 'spec';
  /**
   * Slug parsed from the artifact's filename. Scopes the `unreadable` verdict:
   * only an unparseable FD that could plausibly own *this* artifact suppresses
   * its finding (see {@link couldOwn}). Omit to treat any unparseable FD as a
   * possible owner — the corpus-wide reading.
   */
  artifactSlug?: string;
  repo: string;
}

/**
 * Could the FD at `<fdSlug>.md` plausibly own an artifact whose filename slug is
 * `artifactSlug`, judged on the filename alone?
 *
 * True for an exact match and for the attach shape this step exists to cover —
 * `<date>-<parent>-<enhancement>-design.md`, owned by `<parent>.md` via
 * `links.spec`. It is a heuristic, and deliberately so: `links.*` may name any
 * path, so an FD we cannot parse might in principle own anything. Scoping the
 * `unreadable` verdict this way keeps one malformed FD from blanking the whole
 * staleness surface, and the FD itself is still named by the `malformed-fd` gap.
 */
function couldOwn(fdSlug: string, artifactSlug: string): boolean {
  return artifactSlug === fdSlug || artifactSlug.startsWith(`${fdSlug}-`);
}

/**
 * Shared FD scan: returns the first FD (filename order) for which `matches` is
 * true. An FD that cannot be read or parsed is a candidate whose links are
 * unknown — it may be the very owner being looked for — so the scan reports
 * `unreadable` rather than `none` once it finishes without a match.
 */
async function scanFdsForOwner(
  repo: string,
  seams: FsSeams,
  matches: (fd: FeatureFrontmatter) => boolean,
  plausibleOwner: (fdSlug: string) => boolean = () => true,
): Promise<OwnerResolution> {
  const readdir = seams.readdir ?? ((p) => fsReaddir(p));
  const readFile = seams.readFile ?? ((p, e) => fsReadFile(p, e));
  const featuresDir = loadDocRoots(repo).features;
  let entries: string[];
  try {
    entries = await readdir(featuresDir);
  } catch {
    return { outcome: 'none' };
  }
  const unreadable: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const fdPath = join(featuresDir, entry);
    let fd: FeatureFrontmatter | null;
    try {
      fd = parseFdFrontmatter(await readFile(fdPath, 'utf8'));
    } catch (error) {
      // Vanished between the listing and the read — not a candidate at all, so
      // it must not suppress a finding. Any other read failure leaves the
      // candidate's links unknown, exactly like a parse failure.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      fd = null;
    }
    if (!fd) {
      if (plausibleOwner(entry.replace(/\.md$/, ''))) unreadable.push(entry);
      continue;
    }
    if (matches(fd)) {
      return { outcome: 'resolved', owner: { fd, slug: entry.replace(/\.md$/, '') } };
    }
  }
  return unreadable.length > 0
    ? { detail: `unreadable FD(s): ${unreadable.join(', ')}`, outcome: 'unreadable' }
    : { outcome: 'none' };
}

/**
 * Fallback resolver in the detector's staleness chain: returns the first FD
 * (filename order) whose `links.plan` / `links.spec` names `docPath` verbatim.
 * Both a bare string and an array are accepted, since `links.plan` allows
 * either. When `artifactSlug` is given, an unparseable FD only yields
 * `unreadable` if it could plausibly own that artifact. Consumed by
 * `detectStaleDesignArtifacts` when the filename-slug signal matches no FD — multi-feature or infra plans, and attach-path specs
 * (`<date>-<parent>-<enhancement>-design.md`) that a parent FD still owns.
 */
export async function resolveByLinksField(
  opts: ResolveByLinksFieldOptions,
): Promise<OwnerResolution> {
  const { artifactSlug } = opts;
  return scanFdsForOwner(
    opts.repo,
    opts,
    (fd) => {
      const declared = fd.links[opts.field];
      const paths = Array.isArray(declared) ? declared : declared ? [declared] : [];
      return paths.includes(opts.docPath);
    },
    artifactSlug === undefined ? undefined : (fdSlug) => couldOwn(fdSlug, artifactSlug),
  );
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
 * AFTER {@link resolveByLinksField} and BEFORE age-out, so it only ever
 * resolves artifacts the authoritative slug/`links.*` signals miss. A missing
 * graph file, missing node or missing edge is `none` (→ age-out); an edge whose
 * owner FD exists but will not parse is `unreadable` (→ no finding), never a
 * wrong-direction block.
 */
export async function resolveByGraphAdjacency(
  opts: ResolveByGraphAdjacencyOptions,
): Promise<OwnerResolution> {
  const readFile = opts.readFile ?? ((p, e) => fsReadFile(p, e));
  const graphPath = opts.graphPath ?? join(opts.repo, 'graphify-out', 'graph.json');
  let data: GraphAdjData;
  try {
    data = JSON.parse(await readFile(graphPath, 'utf8')) as GraphAdjData;
  } catch {
    return { outcome: 'none' }; // no graph (or unparseable) → no owner signal
  }
  const node = (data.nodes ?? []).find((n) => n.source_file === opts.docPath);
  if (!node) return { outcome: 'none' };
  const edge = (data.links ?? []).find((l) => l.source === node.id && l.relation === opts.relation);
  if (!edge) return { outcome: 'none' };
  const fdNode = (data.nodes ?? []).find((n) => n.id === edge.target);
  if (!fdNode?.source_file) return { outcome: 'none' };
  // FD node source_file is `docs/features/<slug>.md`.
  const slug = basename(fdNode.source_file, '.md');
  const fdPath = join(loadDocRoots(opts.repo).features, `${slug}.md`);
  let fd: FeatureFrontmatter | null;
  try {
    fd = parseFdFrontmatter(await readFile(fdPath, 'utf8'));
  } catch (error) {
    // A graph edge pointing at an FD that no longer exists is a stale edge, not
    // a claim of ownership — answer `none` so the artifact can still age out.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { outcome: 'none' };
    fd = null;
  }
  // The edge names an owner that exists, so ownership is claimed and only its
  // phase is unknown.
  return fd
    ? { outcome: 'resolved', owner: { fd, slug } }
    : { detail: `unreadable owner FD: ${fdPath}`, outcome: 'unreadable' };
}
