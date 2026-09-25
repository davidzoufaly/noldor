// @fd: sdd-co-tag-detector

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { defaultRunGit, type RunGit } from '../core/branch-added.js';
import {
  listDirIfExists,
  loadSddFeatures,
  readFileIfExists,
  readTextFiles,
  walkRepo,
} from '../core/fd-load.js';
import type { FeatureRecord, Gap } from '../core/fd-load.js';
import { TEST_FILE_RE, newestMtimeInRoots, scanRoots } from '../core/repo-paths.js';
import { GRAPH_IRRELEVANT_EXCLUDES } from '../release/graph-freshness.js';
import { extractTags } from '../sync/sync-test-links.js';
import { extractSection } from '../utils/markdown-sections.js';

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
 * Stable prefix of the *stale*-graph meta-gap message. The constructor in
 * {@link loadFreshGraphOrWarn} and the {@link isStaleGraphGap} matcher both read
 * it, so the machine discriminator can never drift from the operator wording.
 */
const STALE_GAP_MESSAGE_PREFIX = 'Co-tag detector ran in degraded mode:';

/**
 * Load the graphify graph at `graphPath` and verify it's fresher than
 * every file git does not ignore under `srcRoots`.
 *
 * @param graphPath - Path to `graphify-out/graph.json`
 * @param srcRoots - Source directories whose mtimes gate freshness
 *   (typically `['packages', 'apps', 'scripts']`)
 * @returns `{ ok: true, graph }` when fresh; `{ ok: false, gap }` with a
 *   self-contained meta-gap when stale or the graph file is missing.
 *
 * @remarks
 * Two legs, and either one passing is fresh. The git leg asks what the
 * committed history says (see {@link committedGraphIsFresh}); the mtime leg
 * asks whether the file on disk outranks every source file. Mtime alone read
 * a current graph as stale after an ordinary pull: a pull bringing a code merge
 * together with its graph refresh writes files in index order, and
 * `graphify-out/` sorts before `src/`, so `graph.json` lands milliseconds
 * before the code it describes (Q-0290). The mtime leg stays for what git
 * cannot vouch for — a local regen not yet committed, or a repo that does not
 * track the graph. Gitignored files are left out of it, so build and test
 * output under a scan root (Playwright's `test-results/`) cannot undo a regen
 * — see `newestMtimeInRoots`.
 */
export function loadFreshGraphOrWarn(graphPath: string, srcRoots: string[]): LoadGraphResult {
  if (!existsSync(graphPath)) {
    return {
      gap: {
        category: META_GAP_CATEGORY,
        itemId: graphPath,
        message: `${graphPath} does not exist. Run pnpm noldor graphify build to generate the graph, or ensure the path is correct.`,
      },
      ok: false,
    };
  }

  const graphMtime = statSync(graphPath).mtimeMs;
  const newestSrcMtime = committedGraphIsFresh(graphPath, srcRoots)
    ? null
    : newestMtimeInRoots(process.cwd(), srcRoots);

  if (newestSrcMtime !== null && newestSrcMtime > graphMtime) {
    const graphDate = new Date(graphMtime).toISOString().slice(0, 10);
    const srcDate = new Date(newestSrcMtime).toISOString().slice(0, 10);
    return {
      gap: {
        category: META_GAP_CATEGORY,
        itemId: graphPath,
        message: `${STALE_GAP_MESSAGE_PREFIX} ${graphPath} regen ${graphDate}, latest source mtime ${srcDate}. ${graphRebuildRemedy(
          defaultRunGit(dirname(resolve(graphPath))),
          srcRoots.map((root) => resolve(root)),
        )} (preferred) or perform a manual co-tag audit: for each .test.ts file under packages/ or apps/src/, grep imports → check which FDs own those files via links.code → propose missing co-tags.`,
      },
      ok: false,
    };
  }

  const raw = readFileSync(graphPath, 'utf8');
  const graph = JSON.parse(raw) as GraphifyGraph;
  return { graph, ok: true };
}

/**
 * What to tell an operator whose graph reads stale: `Run pnpm noldor graphify
 * build`, unless a scan root holds uncommitted changes. The build reads HEAD,
 * so it cannot clear those — both freshness legs keep counting them, and a
 * rebuild-and-retry loop never ends (Q-0315). The legs stay strict on purpose:
 * a graph of HEAD really does not describe the edit.
 *
 * @param run - git runner anchored inside the repository
 * @param roots - the scan roots the freshness verdict read, as pathspecs
 *   `run` resolves (absolute, or relative to the runner's cwd)
 * @returns the remedy sentence, without a trailing period
 *
 * @remarks
 * A git failure (not a repo, git missing) reads as clean: the plain remedy is
 * the right one where git cannot say what is committed.
 */
export function graphRebuildRemedy(run: RunGit, roots: readonly string[]): string {
  const status = run(['status', '--porcelain', '--', ...roots]);
  return status.status === 0 && status.stdout.trim().length > 0
    ? 'The scan roots hold uncommitted changes, and pnpm noldor graphify build reads HEAD — commit them first, then run pnpm noldor graphify build'
    : 'Run pnpm noldor graphify build';
}

/**
 * Git leg of {@link loadFreshGraphOrWarn}: the graph is tracked, its file is
 * its committed content, no commit after the graph's last one touches a scan
 * root, and nothing under a scan root has uncommitted changes.
 *
 * Commit order, not commit time — `rev-list <graph-commit>..HEAD` counts the
 * commits the graph has not seen, so clock skew and same-second merges cannot
 * swing it. Test-only and doc-only changes are ignored on both halves, the
 * same scope the release gate reads ({@link GRAPH_IRRELEVANT_EXCLUDES}).
 * Untracked files show in `git status --porcelain` and ignored ones do not, so
 * a new source file stales the graph and build output does not. Any git
 * failure (not a repo, no commits, git missing) reads as not-fresh, which
 * hands the verdict to the mtime leg rather than inventing one.
 */
function committedGraphIsFresh(graphPath: string, srcRoots: readonly string[]): boolean {
  const graphAbs = resolve(graphPath);
  const top = defaultRunGit(dirname(graphAbs))(['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return false;
  // Run from the top level: the exclude globs are pathspecs, resolved against
  // git's cwd, so from `graphify-out/` they would never match a source file.
  const run = defaultRunGit(top.stdout.trim());
  const quiet = (args: readonly string[]): boolean => {
    const r = run(args);
    return r.status === 0 && r.stdout.trim().length === 0;
  };
  const graphCommit = run(['log', '-1', '--format=%H', '--', graphAbs]);
  const sha = graphCommit.stdout.trim();
  if (graphCommit.status !== 0 || sha.length === 0) return false;
  const sources = [...srcRoots.map((root) => resolve(root)), ...GRAPH_IRRELEVANT_EXCLUDES];
  return (
    quiet(['status', '--porcelain', '--', graphAbs]) &&
    quiet(['rev-list', '-1', `${sha}..HEAD`, '--', ...sources]) &&
    quiet(['status', '--porcelain', '--', ...sources])
  );
}

/**
 * True when `gap` is the stale-graph meta-gap {@link loadFreshGraphOrWarn}
 * emits — the signal that every graph-consuming detector ran degraded because
 * `graphify-out/graph.json` predates the newest source file.
 *
 * Deliberately does NOT match the *missing*-graph meta-gap from the same
 * constructor: graphify is optional (mirroring `evaluateGraphFreshness`'s skip when no
 * graph is tracked), so a consumer that never generates one must not fail a
 * CI-mode garden run. A graph that exists but lags is the silent-degradation
 * case a non-interactive run has to shout about.
 *
 * Matches on the shared message prefix rather than a structural field because
 * gaps cross a JSON boundary (`garden sdd-report --json` → `loadSddGaps` in
 * `garden-detect.ts`) as bare `{ category, itemId, message }` triples.
 */
export function isStaleGraphGap(gap: Gap): boolean {
  return gap.category === META_GAP_CATEGORY && gap.message.startsWith(STALE_GAP_MESSAGE_PREFIX);
}

/**
 * The fresh graph plus the FD-ownership map detectors need alongside it.
 * Produced by {@link requireFreshGraph}.
 */
export interface FreshGraphContext {
  graph: GraphifyGraph;
  fileToFds: Map<string, Set<string>>;
}

/**
 * Optional-suggestion variant of {@link loadFreshGraphOrWarn}: load the
 * graph and bundle it with {@link buildFileToFdsMap} output, or return
 * `null` when the graph is stale or missing.
 *
 * @param graphPath - Path to `graphify-out/graph.json`
 * @param srcRoots - Source directories whose mtimes gate freshness
 * @param features - Loaded feature records for the ownership map
 * @returns `{ graph, fileToFds }` when fresh; `null` otherwise
 *
 * @remarks
 * For detectors where the graph only *enriches* the message (degraded
 * mode is silent). Detectors that must surface staleness as a gap —
 * the 13th detector, `detectMissingCoTags` — call
 * {@link loadFreshGraphOrWarn} directly and propagate the gap.
 */
export function requireFreshGraph(
  graphPath: string,
  srcRoots: string[],
  features: FeatureRecord[],
): FreshGraphContext | null {
  const loadResult = loadFreshGraphOrWarn(graphPath, srcRoots);
  if (!loadResult.ok) return null;
  return { fileToFds: buildFileToFdsMap(features), graph: loadResult.graph };
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

/** Why an owning FD is not asked whether a change altered its documented behaviour. */
export type OwnerSkip = 'not-done' | 'usage-unwritten';

/** An FD's standing for a doc-impact check. */
export interface FdStanding {
  readonly phase: string;
  /** `null` when the FD is a candidate: `phase: done` with a written `## Usage`. */
  readonly skip: OwnerSkip | null;
}

/** Every FD's `links.code` ownership and standing, loaded once and queried per path set. */
export interface FdOwnership {
  readonly fileToFds: Map<string, Set<string>>;
  readonly standing: ReadonlyMap<string, FdStanding>;
  /** Feature MD filenames left out because their frontmatter did not parse. */
  readonly unparseable: readonly string[];
}

/** An FD that owns at least one of the paths asked about. */
export interface PathOwner extends FdStanding {
  readonly slug: string;
  /** The asked-about paths this FD owns, sorted. */
  readonly files: readonly string[];
}

/**
 * True when an FD body's `## Usage` section holds visible text and no TODO
 * stub. HTML comments are not text: a `noldor:usage-checked` marker alone
 * documents nothing that could go stale.
 *
 * @param md - Full feature MD contents
 */
export function usageWritten(md: string): boolean {
  const usage = extractSection(md, 'Usage');
  if (usage === null || usage.includes('<!-- TODO')) return false;
  return usage.replaceAll(/<!--[\s\S]*?-->/g, '').trim() !== '';
}

/**
 * Load every FD's `links.code` ownership and standing from a features directory.
 *
 * `loadSddFeatures` skips an FD whose frontmatter does not parse, so the
 * skipped filenames are returned beside the map: a caller must not read an
 * owner list with skips as complete.
 *
 * @param featuresDir - Directory holding `<slug>.md` feature files
 */
export async function loadFdOwnership(featuresDir: string): Promise<FdOwnership> {
  const records = await loadSddFeatures(featuresDir);
  const parsed = new Set(records.map((r) => `${r.slug}.md`));
  const unparseable = (await listDirIfExists(featuresDir))
    .filter((name) => name.endsWith('.md') && !parsed.has(name))
    .toSorted();
  const standing = new Map<string, FdStanding>();
  for (const { slug, frontmatter } of records) {
    const body = (await readFileIfExists(join(featuresDir, `${slug}.md`))) ?? '';
    const skip =
      frontmatter.phase !== 'done' ? 'not-done' : usageWritten(body) ? null : 'usage-unwritten';
    standing.set(slug, { phase: frontmatter.phase, skip });
  }
  return { fileToFds: buildFileToFdsMap(records), standing, unparseable };
}

/**
 * The FDs owning any of `paths`, each with the paths it owns — most owned
 * paths first, so the FDs a change is most about lead.
 *
 * @param paths - Repo-relative paths, e.g. a branch's changed files
 * @param ownership - From {@link loadFdOwnership}
 */
export function ownersOf(paths: readonly string[], ownership: FdOwnership): PathOwner[] {
  const owned = new Map<string, string[]>();
  for (const path of paths) {
    for (const slug of getFdOwnersForFile(path, ownership.fileToFds)) {
      owned.set(slug, [...(owned.get(slug) ?? []), path]);
    }
  }
  return [...owned]
    .map(([slug, files]) => ({
      slug,
      files: files.toSorted(),
      ...(ownership.standing.get(slug) ?? { phase: 'unknown', skip: 'not-done' as const }),
    }))
    .toSorted((a, b) => b.files.length - a.files.length || (a.slug < b.slug ? -1 : 1));
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

/** A test file's content, keyed by its repo-relative path. */
export interface TestInput {
  content: string;
  path: string;
}

/** The FD slugs one test file's `// @tests:` tag omits. */
export interface MissingCoTags {
  path: string;
  /** Sorted, never empty. */
  missing: string[];
}

/**
 * Every test file under the consumer's scan roots, with its content — the one
 * file set the co-tag detector reports over and `features seed-test-tags`
 * writes to.
 *
 * @returns Test files as repo-relative paths, read relative to the cwd
 *
 * @remarks
 * Shared rather than walked by each caller: hardcoded roots in the detector
 * once left standalone `src/` repos with no test inputs at all, so every
 * graph-known test read as untagged. The filter is core's `TEST_FILE_RE`, the
 * predicate that also decides which files feed `links.tests`.
 */
export async function collectTestInputs(): Promise<TestInput[]> {
  const paths: string[] = [];
  for (const root of scanRoots()) await walkRepo(root, paths);
  return readTextFiles(paths.filter((path) => TEST_FILE_RE.test(path)));
}

/**
 * For each test file the graph knows, the FDs that own a file it imports but
 * are missing from its `// @tests:` tag. The 13th SDD detector renders these as
 * gaps and `features seed-test-tags` writes them, so the two cannot disagree.
 *
 * @param features - Loaded feature records (`links.code` decides ownership)
 * @param testInputs - Output of {@link collectTestInputs}; a graph test with no
 *   input reads as declaring no tags
 * @param graph - A graph the caller has already found fresh
 * @param e2ePrefix - Tests under this prefix are skipped: they drive the app
 *   rather than import source
 * @returns One entry per test with at least one missing slug, in graph order
 */
export function computeMissingCoTags(
  features: FeatureRecord[],
  testInputs: readonly TestInput[],
  graph: GraphifyGraph,
  e2ePrefix: string,
): MissingCoTags[] {
  const fileToFds = buildFileToFdsMap(features);
  const declaredByPath = new Map(
    testInputs.map(({ content, path }) => [path, extractTags(content)]),
  );
  const out: MissingCoTags[] = [];
  for (const node of graph.nodes) {
    const sf = node.source_file;
    if (!sf || !TEST_FILE_RE.test(sf) || sf.startsWith(e2ePrefix)) continue;
    if (node.source_location !== 'L1') continue; // only file-level node, not inner symbols

    const declared = new Set(declaredByPath.get(sf) ?? []);
    const missing = [...getImportOwnersForTest(node.id, graph, fileToFds)]
      .filter((slug) => !declared.has(slug))
      .toSorted();
    if (missing.length > 0) out.push({ missing, path: sf });
  }
  return out;
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
    .toSorted((a, b) => b.count - a.count || a.slug.localeCompare(b.slug, 'en'));
}
