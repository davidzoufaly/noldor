import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import matter from 'gray-matter';

import { FeatureFrontmatterSchema } from '../features/feature-schema.js';
import { extractTags } from '../sync/sync-test-links.js';
import { parseBacklog } from '../utils/parse-blocks.js';
import { extractUntriagedBullets } from '../triage/triage-list-untriaged.js';

import { loadConsumerConfig } from '../core/consumer-config.js';

import type { ConsumerConfig } from '../core/consumer-config.js';
import { loadDocRoots } from '../core/doc-roots.js';

import { commitOnlyTouchesReport } from './detectors/override-audit.js';
import {
  buildFileToFdsMap,
  getCommunityOwners,
  getImportOwnersForTest,
  loadFreshGraphOrWarn,
} from './graph-fd-lookup.js';

import type { Dirent } from 'node:fs';

import type { GraphifyGraph } from './graph-fd-lookup.js';

import type { FeatureFrontmatter } from '../features/feature-schema.js';
import type { BacklogEntry } from '../utils/parse-blocks.js';

/**
 * One detected gap from any of the 14 SDD detectors. Categories are stable
 * strings used for grouping in the rendered report.
 */
export interface Gap {
  category: string;
  itemId: string;
  message: string;
}

/**
 * A feature MD plus its derived slug (filename without `.md`).
 */
export interface FeatureRecord {
  slug: string;
  frontmatter: FeatureFrontmatter;
}

/**
 * Pre-MVP features (v0.1.0 bootstrap release) shipped before the SDD
 * link-tracking framework existed. Blanket-flagging them as missing
 * `links.spec` / `links.code` is noise. Detectors below
 * exempt features whose `introduced` is below this threshold.
 *
 * Bump when bootstrap backfill is desired or a release fully under
 * SDD enforcement is the new baseline.
 */
export const MIN_ENFORCED_VERSION = '0.2.0';

/**
 * Compare two semver strings by major/minor/patch.
 *
 * @returns Negative if `a < b`, positive if `a > b`, 0 if equal
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n));
  const pb = b.split('.').map((n) => Number(n));
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Returns true when a feature is subject to link-enforcement. Pre-MVP
 * (`introduced < MIN_ENFORCED_VERSION`) done features are grandfathered.
 * In-progress features and features missing `introduced` are always
 * enforced (the latter is caught by its own detector).
 */
export function isLinkEnforced(f: FeatureRecord): boolean {
  if (f.frontmatter.phase !== 'done') {
    return true;
  }
  const v = f.frontmatter.introduced;
  if (!v) {
    return true;
  }
  return compareSemver(v, MIN_ENFORCED_VERSION) >= 0;
}

/**
 * Sentinel value in `links.tests` declaring the feature has no testable
 * surface by design (one-off events like a rebrand, pure infra-relabel).
 * Detector treats its presence as exempt. Mirrors {@link DOCS_EXEMPT_SENTINEL}.
 */
export const TESTS_EXEMPT_SENTINEL = 'n/a';

/**
 * Flag every `phase: done` feature whose `links.tests` array is empty.
 *
 * Exemption: `links.tests` containing the {@link TESTS_EXEMPT_SENTINEL}
 * string opts the feature out (rebrand events, etc.).
 *
 * @param features - Loaded feature records
 * @returns One gap per uncovered done feature
 */
export async function detectDoneFeaturesWithoutTests(features: FeatureRecord[]): Promise<Gap[]> {
  return features
    .filter((f) => f.frontmatter.phase === 'done')
    .filter((f) => !f.frontmatter.links.tests.includes(TESTS_EXEMPT_SENTINEL))
    .filter((f) => f.frontmatter.links.tests.length === 0)
    .map((f) => ({
      category: 'Done features without tests',
      itemId: f.slug,
      message: `${f.frontmatter.name} (${f.frontmatter.area}) has no tests in links.tests`,
    }));
}

/**
 * Sentinel value in `links.docs` declaring the feature has no user-facing
 * docs by design (one-off events like a rebrand, internal-only changes that
 * still warrant an FD). Detector treats its presence as exempt.
 */
export const DOCS_EXEMPT_SENTINEL = 'n/a';

/**
 * Flag every `phase: done` feature whose `links.docs` array is empty.
 *
 * Exemptions:
 * - `category: Tooling` — internal devloop features never get user docs
 *   (dashboards, gardening scripts, worktree workflow, etc.).
 * - `links.docs` containing the {@link DOCS_EXEMPT_SENTINEL} string —
 *   per-feature opt-out for the rare case a non-Tooling feature genuinely
 *   has no user-facing prose (one-off rebrand, etc.).
 */
export async function detectDoneFeaturesWithoutDocs(features: FeatureRecord[]): Promise<Gap[]> {
  return features
    .filter((f) => f.frontmatter.phase === 'done')
    .filter((f) => f.frontmatter.category !== 'Tooling')
    .filter((f) => !f.frontmatter.links.docs.includes(DOCS_EXEMPT_SENTINEL))
    .filter((f) => f.frontmatter.links.docs.length === 0)
    .map((f) => ({
      category: 'Done features without docs',
      itemId: f.slug,
      message: `${f.frontmatter.name} (${f.frontmatter.area}) has no entries in links.docs`,
    }));
}

/**
 * Sentinel value in `links.code` declaring the feature has no implementation
 * code by design (rare — pure-content / branding features that still warrant
 * an FD). Detector treats its presence as exempt. Mirrors
 * {@link TESTS_EXEMPT_SENTINEL} / {@link DOCS_EXEMPT_SENTINEL}.
 */
export const CODE_EXEMPT_SENTINEL = 'n/a';

/**
 * Flag every `phase: done` feature whose `links.code` array is empty.
 *
 * Pre-MVP grandfathered features ({@link isLinkEnforced} = false) are skipped.
 * No category exemption — Tooling FDs ship scripts and should populate
 * `links.code`. The {@link CODE_EXEMPT_SENTINEL} string opts a feature out for
 * the rare pure-content case.
 */
export async function detectDoneFeaturesMissingCode(features: FeatureRecord[]): Promise<Gap[]> {
  return features
    .filter((f) => f.frontmatter.phase === 'done')
    .filter((f) => isLinkEnforced(f))
    .filter((f) => !f.frontmatter.links.code.includes(CODE_EXEMPT_SENTINEL))
    .filter((f) => f.frontmatter.links.code.length === 0)
    .map((f) => ({
      category: 'Done features without code',
      itemId: f.slug,
      message: `${f.frontmatter.name} (${f.frontmatter.area}) has no entries in links.code`,
    }));
}

/**
 * Flag every feature without a `links.spec` value.
 */
export async function detectFeaturesWithoutSpec(features: FeatureRecord[]): Promise<Gap[]> {
  return features
    .filter((f) => f.frontmatter.links.spec === undefined || f.frontmatter.links.spec === '')
    .filter((f) => f.frontmatter['noldor-tier'] === 'full')
    .filter((f) => isLinkEnforced(f))
    .map((f) => ({
      category: 'Features without spec',
      itemId: f.slug,
      message: `${f.frontmatter.name} (${f.frontmatter.area}) is missing links.spec`,
    }));
}

/**
 * Flag `phase: done` features whose `introduced` is unset (release script
 * normally fills it on the next `pnpm release`).
 */
export async function detectDoneFeaturesMissingIntroduced(
  features: FeatureRecord[],
): Promise<Gap[]> {
  return features
    .filter((f) => f.frontmatter.phase === 'done' && f.frontmatter.introduced === undefined)
    .map((f) => ({
      category: 'Done features missing introduced',
      itemId: f.slug,
      message: `${f.frontmatter.name} is phase=done but introduced is unset (release script should fill on next pnpm release)`,
    }));
}

/**
 * Surface every top-level `ideas.md` bullet without a `[triaged …]` marker.
 */
export function detectUntriagedIdeas(ideasMd: string): Gap[] {
  return extractUntriagedBullets(ideasMd).map((b) => ({
    category: 'Untriaged ideas in ideas.md',
    itemId: `ideas.md:${b.line}`,
    message: b.text,
  }));
}

/**
 * Flag backlog entries whose `since` predates `now` by more than
 * `thresholdDays`. Entries without `since` are skipped.
 *
 * @param entries - Parsed backlog entries
 * @param thresholdDays - Age in days beyond which an entry is "stale"
 * @param now - Reference date (defaults to current time)
 */
export function detectStaleBacklog(
  entries: BacklogEntry[],
  thresholdDays: number,
  now: Date = new Date(),
): Gap[] {
  const gaps: Gap[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (const e of entries) {
    if (!e.since) {
      continue;
    }
    const sinceDate = new Date(`${e.since}T00:00:00Z`);
    const ageDays = Math.floor((now.getTime() - sinceDate.getTime()) / dayMs);
    if (ageDays > thresholdDays) {
      gaps.push({
        category: `Stale backlog entries (>${thresholdDays} days)`,
        itemId: e.name,
        message: `${e.name} (${e.area}) has been in backlog for ${ageDays} days since ${e.since}`,
      });
    }
  }
  return gaps;
}

const META_SPEC_PATTERNS = [/\/2026-04-21-product-dev-framework-brainstorm\.md$/, /-design\.md$/];

/**
 * Flag spec files in `docs/superpowers/specs/` that no feature MD references
 * via `links.spec`. Excludes meta-specs (sub-project design docs).
 */
export function detectSpecsWithoutFeatures(
  allSpecPaths: string[],
  features: FeatureRecord[],
): Gap[] {
  const referenced = new Set<string>();
  for (const f of features) {
    if (f.frontmatter.links.spec) {
      referenced.add(f.frontmatter.links.spec);
    }
  }

  return allSpecPaths
    .filter((p) => !META_SPEC_PATTERNS.some((re) => re.test(p)))
    .filter((p) => !referenced.has(p))
    .map((p) => ({
      category: 'Specs without feature reference',
      itemId: p,
      message: `${p} is not referenced by any feature MD links.spec`,
    }));
}

const CODE_IGNORE_PATTERNS = [
  /^node_modules\//,
  /^dist\//,
  /\/__tests__\//,
  /^scripts\/fixtures\//,
  /^packages\/test-fixtures\/src\/scenes\//,
  /^docs\/user\/reference\/api\//,
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
];

const INFRA_FILE_PATTERNS = [
  /\.config\.(ts|js|mjs|cjs)$/,
  /-env\.d\.ts$/,
  /^tsconfig.*\.json$/,
  /^lefthook\.(yml|yaml)$/,
] as const;

/**
 * Check whether a file path is tooling glue (configs, ambient types, etc.)
 * that should never have a feature MD owner. Matched by basename — same
 * filename in any directory counts as infra.
 *
 * @param filePath - File path to check
 * @returns true if the file is infra and should be skipped by FD-ownership detectors
 */
export function isInfraFile(filePath: string): boolean {
  const name = basename(filePath);
  return INFRA_FILE_PATTERNS.some((re) => re.test(name));
}

/**
 * Returns true when any ancestor directory of `filePath` is in `referenced`.
 * Walks every ancestor (not just the immediate parent) so a top-level
 * directory entry like `packages/sample-scenes` covers files several
 * levels deep (`packages/sample-scenes/src/empty-room.ts`).
 *
 * @param filePath - Candidate file path
 * @param referenced - Set of normalized links.code entries (no trailing slash)
 * @returns true when an ancestor directory is in `referenced`
 */
function isCoveredByAncestorDir(filePath: string, referenced: Set<string>): boolean {
  let cursor = filePath;
  while (true) {
    const lastSlash = cursor.lastIndexOf('/');
    if (lastSlash <= 0) return false;
    cursor = cursor.slice(0, lastSlash);
    if (referenced.has(cursor)) return true;
  }
}

/**
 * Inputs that enable the optional probable-owner path on
 * {@link detectCodeOrphans}. When omitted, the detector emits the bare
 * "not referenced by any feature MD links.code" message.
 */
export interface CodeOrphanSuggestionInputs {
  graphPath: string;
  srcRoots: string[];
}

/**
 * Flag `.ts` / `.tsx` files not referenced by any feature MD `links.code`.
 * Tests, fixtures, generated outputs, scene-JSON, and infra/tooling files
 * (configs, ambient types) are excluded. Directory entries in `links.code`
 * cover every nested file regardless of depth; trailing slashes are
 * normalized away on insert.
 *
 * When `suggestion` is supplied and the graph is fresh, append a
 * `— probable owner: <slug>` hint sourced from the orphan file's
 * graphify community membership (top FD by frequency among files in the
 * same community). Falls back to the bare message when the graph is
 * stale, missing, or yields no candidate.
 */
export function detectCodeOrphans(
  allPaths: string[],
  features: FeatureRecord[],
  suggestion?: CodeOrphanSuggestionInputs,
): Gap[] {
  const anyEnforced = features.some((f) => isLinkEnforced(f));
  if (!anyEnforced) {
    return [];
  }

  const referenced = new Set<string>();
  for (const f of features) {
    for (const c of f.frontmatter.links.code) {
      referenced.add(c.endsWith('/') ? c.slice(0, -1) : c);
    }
  }

  const tsFiles = allPaths.filter(
    (p) =>
      (p.endsWith('.ts') || p.endsWith('.tsx')) &&
      !CODE_IGNORE_PATTERNS.some((re) => re.test(p)) &&
      !isInfraFile(p),
  );

  let graph: GraphifyGraph | null = null;
  let fileToFds: Map<string, Set<string>> | null = null;
  if (suggestion) {
    const loadResult = loadFreshGraphOrWarn(suggestion.graphPath, suggestion.srcRoots);
    if (loadResult.ok) {
      graph = loadResult.graph;
      fileToFds = buildFileToFdsMap(features);
    }
  }

  return tsFiles
    .filter((p) => !referenced.has(p))
    .filter((p) => !isCoveredByAncestorDir(p, referenced))
    .map((p) => {
      const base = `${p} is not referenced by any feature MD links.code`;
      let message = base;
      if (graph && fileToFds) {
        const ranked = getCommunityOwners(p, graph, fileToFds);
        if (ranked.length > 0) {
          const top = ranked
            .slice(0, 3)
            .map((r) => r.slug)
            .join(', ');
          message = `${base} — probable owner: ${top}`;
        }
      }
      return {
        category: 'Code files not referenced by any feature',
        itemId: p,
        message,
      };
    });
}

const TESTS_TAG_RE = /^\/\/\s*@tests:/m;

/**
 * Inputs that enable the optional slug-suggestion path on
 * {@link detectUntaggedTests}. When omitted, the detector behaves as before
 * (emits a generic "missing required tag" message).
 */
export interface UntaggedTestSuggestionInputs {
  features: FeatureRecord[];
  graphPath: string;
  srcRoots: string[];
}

/**
 * Flag test files whose body lacks a `// @tests: <slug>` line.
 *
 * When `suggestion` is supplied and the graph is fresh, append a
 * `— suggested: <slug-list>` hint sourced from the test's `imports_from`
 * graph edges resolved against FD `links.code` ownership. When the graph
 * is stale or missing, fall back to the bare message (degraded mode).
 */
export function detectUntaggedTests(
  inputs: { path: string; content: string }[],
  suggestion?: UntaggedTestSuggestionInputs,
): Gap[] {
  let nodeByPath: Map<string, string> | null = null;
  let graph: GraphifyGraph | null = null;
  let fileToFds: Map<string, Set<string>> | null = null;
  if (suggestion) {
    const loadResult = loadFreshGraphOrWarn(suggestion.graphPath, suggestion.srcRoots);
    if (loadResult.ok) {
      graph = loadResult.graph;
      fileToFds = buildFileToFdsMap(suggestion.features);
      nodeByPath = new Map<string, string>();
      for (const n of graph.nodes) {
        if (n.source_location !== 'L1' || !n.source_file) continue;
        nodeByPath.set(n.source_file, n.id);
      }
    }
  }

  const base = 'missing required `// @tests: <slug>` tag (validator hard-fails on this)';

  return inputs
    .filter((i) => !i.path.startsWith('scripts/') && !TESTS_TAG_RE.test(i.content))
    .map((i) => {
      let message = base;
      if (graph && fileToFds && nodeByPath) {
        const nodeId = nodeByPath.get(i.path);
        if (nodeId) {
          const owners = [...getImportOwnersForTest(nodeId, graph, fileToFds)].toSorted();
          if (owners.length > 0) {
            message = `${base} — suggested: ${owners.join(', ')}`;
          }
        }
      }
      return {
        category: 'Test files without @tests: tag',
        itemId: i.path,
        message,
      };
    });
}

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx)$/;

/**
 * Flag test files whose `// @tests:` tag list is incomplete given the FDs
 * that own the source files the test imports.
 *
 * @param features - Loaded feature records (used to build path → FD map)
 * @param testInputs - Test file `{ path, content }` pairs (declared `@tests:`
 *   tags parsed from the body)
 * @param graphPath - Path to `graphify-out/graph.json`
 * @param srcRoots - Source roots whose mtime gates graph staleness
 * @returns Per-test gaps listing missing co-tag slugs, or a single staleness
 *   meta-gap when the graph is out of date.
 *
 * @remarks
 * Forward-only: a tag is suggested when an imported source file is owned by
 * an FD via `links.code`, and that FD isn't in the test's declared tag list.
 * E2e tests under `apps/web/e2e/` are skipped — they typically don't import
 * source. FDs with empty `links.code` are silently invisible (no candidate
 * to suggest); the 14th detector covers that orthogonal concern.
 */
export function detectMissingCoTags(
  features: FeatureRecord[],
  testInputs: { content: string; path: string }[],
  graphPath: string,
  srcRoots: string[],
): Gap[] {
  const loadResult = loadFreshGraphOrWarn(graphPath, srcRoots);
  if (!loadResult.ok) return [loadResult.gap];

  const { graph } = loadResult;
  const { e2ePrefix } = loadConsumerConfig();
  const fileToFds = buildFileToFdsMap(features);
  const declaredByPath = new Map<string, string[]>();
  for (const { content, path } of testInputs) declaredByPath.set(path, extractTags(content));

  const gaps: Gap[] = [];
  for (const node of graph.nodes) {
    const sf = node.source_file;
    if (!sf || !TEST_FILE_RE.test(sf) || sf.startsWith(e2ePrefix)) continue;
    if (node.source_location !== 'L1') continue; // only file-level node, not inner symbols

    const expectedFds = getImportOwnersForTest(node.id, graph, fileToFds);
    const declared = new Set(declaredByPath.get(sf) ?? []);
    const missing = [...expectedFds].filter((slug) => !declared.has(slug)).toSorted();
    if (missing.length === 0) continue;

    gaps.push({
      category: 'Tests with incomplete co-tag',
      itemId: sf,
      message: `imports files owned by FDs missing from @tests: tag — add: ${missing.join(', ')}`,
    });
  }

  return gaps;
}

const FEATURE_TAG_RE = /<!--\s*@feature:\s*[^>]+-->/;

/**
 * Flag tutorial / explanation MDs whose body lacks `<!-- @feature: <slug> -->`.
 */
export function detectUntaggedDocs(inputs: { path: string; content: string }[]): Gap[] {
  return inputs
    .filter((i) => !FEATURE_TAG_RE.test(i.content))
    .map((i) => ({
      category: 'Tutorials/explanations without @feature: tag',
      itemId: i.path,
      message: `${i.path} has no <!-- @feature: <slug> --> tag (validator hard-fails on this)`,
    }));
}

/**
 * Flag drift between actual `packages/<name>` directories and the README's
 * `### Packages` table.
 *
 * Catches: a new package added to `packages/` without a corresponding row in
 * the README table, OR a row in the README table whose package directory no
 * longer exists.
 *
 * @param actualPackages - List of consumer-prefixed package names found on disk
 * @param readmeContent - Raw `README.md` body to scan
 * @returns One gap per missing row + one per stale row
 */
export function detectReadmePackageDrift(
  actualPackages: string[],
  readmeContent: string,
  config: Pick<ConsumerConfig, 'packagePrefix' | 'deprecatedPackages'> = loadConsumerConfig(),
): Gap[] {
  const { packagePrefix, deprecatedPackages } = config;
  const escapedPrefix = packagePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tableRe = new RegExp(`\\|\\s*\`(${escapedPrefix}[a-z0-9-]+)\`\\s*\\|`, 'gi');
  const listed = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(readmeContent)) !== null) {
    listed.add(m[1]);
  }

  const actual = new Set(actualPackages);
  const deprecated = new Set(deprecatedPackages);
  const missingFromReadme = [...actual].filter((p) => !listed.has(p)).toSorted();
  const staleInReadme = [...listed].filter((p) => !actual.has(p) && !deprecated.has(p)).toSorted();

  const gaps: Gap[] = [];
  for (const p of missingFromReadme) {
    gaps.push({
      category: 'README Architecture/Packages drift',
      itemId: p,
      message: `${p} exists on disk but has no row in README \`### Packages\` table`,
    });
  }
  for (const p of staleInReadme) {
    gaps.push({
      category: 'README Architecture/Packages drift',
      itemId: p,
      message: `README \`### Packages\` table lists ${p} but the package directory does not exist`,
    });
  }
  return gaps;
}

const EXCLUDED_WALK_DIRS = new Set([
  'node_modules',
  'dist',
  '.turbo',
  'coverage',
  '.git',
  '.github',
]);

/**
 * Recursively walk a directory and collect every file path under it,
 * skipping hidden entries (except `.github`) and excluded build artefacts.
 *
 * @param dir - Absolute or workspace-relative directory to walk.
 * @param out - Mutable array that receives discovered file paths.
 * @returns Resolves once the walk completes; results are appended to `out`.
 */
export async function walkRepo(dir: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    // A missing top-level scan dir (e.g. no `packages/`/`apps/` in a
    // single-package consumer) contributes no paths rather than throwing.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const { name } = entry;
    if (name.startsWith('.') && name !== '.github') {
      continue;
    }
    if (EXCLUDED_WALK_DIRS.has(name)) {
      continue;
    }
    const full = join(dir, name);
    if (entry.isDirectory()) {
      await walkRepo(full, out);
    } else {
      out.push(full);
    }
  }
}

/**
 * Load every feature MD in a directory and parse its frontmatter.
 *
 * @param dir - Directory containing `<slug>.md` feature files (typically
 *   `docs/features`). A missing directory yields an empty array.
 * @returns Array of `{ frontmatter, slug }` records, one per feature MD.
 *
 * @remarks
 * Renamed from `loadFeatures` to avoid colliding with the dashboard's
 * forthcoming richer loader (see `scripts/dashboard/data.ts`).
 */
export async function loadSddFeatures(dir: string): Promise<FeatureRecord[]> {
  const result: FeatureRecord[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    const slug = entry.name.replace(/\.md$/, '');
    const raw = await readFile(join(dir, entry.name), 'utf8');
    const fm = FeatureFrontmatterSchema.parse(matter(raw).data);
    result.push({ frontmatter: fm, slug });
  }
  return result;
}

/**
 * List spec markdown files in a directory as cwd-relative paths.
 *
 * @param dir - Directory containing spec MDs (typically
 *   `docs/superpowers/specs`). A missing directory yields an empty array.
 * @returns Array of paths relative to `process.cwd()`.
 */
export async function listSpecs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => relative(process.cwd(), join(dir, e.name)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * List plan markdown files in a directory as cwd-relative paths.
 *
 * @param dir - Directory containing plan MDs (typically
 *   `docs/superpowers/plans`). A missing directory yields an empty array.
 * @returns Array of paths relative to `process.cwd()`.
 */
export async function listPlans(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => relative(process.cwd(), join(dir, e.name)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Strip leading `YYYY-MM-DD-` and trailing `-design` from a spec
 * filename to recover the underlying slug used to match against plans.
 *
 * @param filename - Spec basename (e.g. `2026-04-15-editor-shell-design.md`)
 * @returns Slug stem (e.g. `editor-shell`) or empty string if no match.
 */
export function extractSpecSlug(filename: string): string {
  const stem = filename.replace(/\.md$/, '');
  const noDate = stem.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  return noDate.replace(/-design$/, '');
}

/**
 * Strip leading `YYYY-MM-DD-` and any `plan\d+-` prefix and trailing
 * `-part\d+` suffix from a plan filename to recover the underlying
 * slug used to match against specs. The `-part\d+` strip lets a single
 * spec match every part of a multi-file plan that was split for
 * context-window reasons.
 *
 * @param filename - Plan basename (e.g. `2026-04-14-plan2-engine.md`,
 *   `2026-04-23-feature-md-framework-part1.md`).
 * @returns Slug stem (e.g. `engine`, `feature-md-framework`) or empty
 *   string if no match.
 */
export function extractPlanSlug(filename: string): string {
  const stem = filename.replace(/\.md$/, '');
  const noDate = stem.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  const noPlanPrefix = noDate.replace(/^plan\d+-/, '');
  return noPlanPrefix.replace(/-part\d+$/, '');
}

/**
 * Flag plan files in `docs/superpowers/plans/` whose slug doesn't match
 * any spec under `docs/superpowers/specs/` (after stripping date prefix
 * and `-design` / `plan\d+-` markers).
 *
 * @param planPaths - Plan file paths from {@link listPlans}.
 * @param specPaths - Spec file paths from {@link listSpecs}.
 * @returns Gaps for unmatched plans, one per plan.
 */
export function detectPlansWithoutSpec(planPaths: string[], specPaths: string[]): Gap[] {
  const specSlugs = new Set(
    specPaths.map((p) => extractSpecSlug(p.split('/').pop() ?? '')).filter((s) => s.length > 0),
  );
  const gaps: Gap[] = [];
  for (const p of planPaths) {
    const slug = extractPlanSlug(p.split('/').pop() ?? '');
    if (slug.length === 0 || specSlugs.has(slug)) continue;
    gaps.push({
      category: 'Plans without matching spec',
      itemId: p,
      message: `${p} has slug "${slug}" with no matching spec under docs/superpowers/specs/`,
    });
  }
  return gaps;
}

/**
 * Read multiple UTF-8 text files into `{ path, content }` records.
 *
 * @param paths - File paths to read sequentially.
 * @returns Array of `{ path, content }` in input order.
 */
export async function readTextFiles(paths: string[]): Promise<{ path: string; content: string }[]> {
  const out: { path: string; content: string }[] = [];
  for (const path of paths) {
    out.push({ content: await readFile(path, 'utf8'), path });
  }
  return out;
}

/**
 * Aggregated inputs required to run all 14 gap detectors.
 *
 * @remarks
 * Exposed so the project-tracking dashboard can build the same input
 * shape from its own loaders and reuse {@link collectGaps}.
 */
export interface ReportInput {
  features: FeatureRecord[];
  ideasMd: string;
  backlog: BacklogEntry[];
  specPaths: string[];
  planPaths: string[];
  allRepoPaths: string[];
  testInputs: { path: string; content: string }[];
  docInputs: { path: string; content: string }[];
  actualPackages: string[];
  readmeContent: string;
  staleDays: number;
  /** Path to graphify-out/graph.json (drives the co-tag detector). */
  graphPath: string;
  /** Source roots whose mtime gates graph staleness. */
  graphSrcRoots: string[];
}

/**
 * Run all 14 SDD detectors against the supplied inputs and return the
 * concatenated list of gaps.
 *
 * @param input - All inputs the detectors need; see {@link ReportInput}.
 * @returns Flat array of gaps across every detector category, preserving
 *   detector order. Categories are not deduplicated.
 *
 * @remarks
 * Pure with respect to the filesystem: callers load inputs once and may
 * reuse them across renderings (CLI text, markdown report, dashboard).
 */
export async function collectGaps(input: ReportInput): Promise<Gap[]> {
  const gaps: Gap[] = [];
  gaps.push(...(await detectDoneFeaturesWithoutTests(input.features)));
  gaps.push(...(await detectDoneFeaturesWithoutDocs(input.features)));
  gaps.push(...(await detectFeaturesWithoutSpec(input.features)));
  gaps.push(...(await detectDoneFeaturesMissingIntroduced(input.features)));
  gaps.push(...detectUntriagedIdeas(input.ideasMd));
  gaps.push(...detectStaleBacklog(input.backlog, input.staleDays));
  gaps.push(...detectSpecsWithoutFeatures(input.specPaths, input.features));
  gaps.push(...detectPlansWithoutSpec(input.planPaths, input.specPaths));
  gaps.push(
    ...detectCodeOrphans(input.allRepoPaths, input.features, {
      graphPath: input.graphPath,
      srcRoots: input.graphSrcRoots,
    }),
  );
  gaps.push(
    ...detectUntaggedTests(input.testInputs, {
      features: input.features,
      graphPath: input.graphPath,
      srcRoots: input.graphSrcRoots,
    }),
  );
  gaps.push(...detectUntaggedDocs(input.docInputs));
  gaps.push(...detectReadmePackageDrift(input.actualPackages, input.readmeContent));
  gaps.push(
    ...detectMissingCoTags(input.features, input.testInputs, input.graphPath, input.graphSrcRoots),
  );
  gaps.push(...(await detectDoneFeaturesMissingCode(input.features)));
  return gaps;
}

// ─── Gate compliance section ──────────────────────────────────────────────────

/**
 * One override entry for the Gate compliance section.
 */
export interface GateOverrideEntry {
  readonly sha: string;
  readonly reason: string;
}

/**
 * Tier distribution counts for the Gate compliance section.
 */
export interface GateTierDistribution {
  readonly full: number;
  readonly specsOnly: number;
}

/**
 * Aggregated Gate compliance data for the SDD report.
 */
export interface GateComplianceSection {
  /** Override commits (Noldor-Path-Override) in the last 30 days. */
  readonly overrides: readonly GateOverrideEntry[];
  /** Count of FDs by noldor-tier. */
  readonly tierDistribution: GateTierDistribution;
  /**
   * Count of commits in the last 30 days that used a gated path but skipped
   * the pre-push reviewer check (no Noldor-Reviewed trailer). In a healthy
   * repo this should be 0; pre-push bypass is only allowed via the override
   * trailer which is tracked separately.
   */
  readonly reviewSkipCount: number;
}

/**
 * Build the Gate compliance section data.
 *
 * @param features - Loaded feature records (for tier distribution).
 * @param cwd - Repository root (defaults to `process.cwd()`).
 * @param daysBack - How many days of history to inspect (default 30).
 * @returns Gate compliance data.
 */
export function buildGateComplianceSection(
  features: FeatureRecord[],
  cwd = process.cwd(),
  daysBack = 30,
): GateComplianceSection {
  // --- Tier distribution ---
  let full = 0;
  let specsOnly = 0;
  for (const f of features) {
    if (f.frontmatter['noldor-tier'] === 'full') {
      full++;
    } else {
      specsOnly++;
    }
  }

  // --- Override usage + review-skip count from git log ---
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  let raw: string;
  try {
    raw = execFileSync('git', ['log', `--since=${since}`, '--pretty=%H%x00%B%x1e'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    raw = '';
  }

  const overrides: GateOverrideEntry[] = [];
  let reviewSkipCount = 0;

  // Paths that require a Noldor-Reviewed trailer at pre-push.
  // fast-track, specs-only-*, and full-* paths are "gated" paths that the
  // pre-push hook would normally require a Noldor-Reviewed on.
  const GATED_PATH_RE = /^(fast-track|specs-only(?:-new|-attach)?|full(?:-new|-attach)?)$/;

  // Regex-based trailer parser — avoids spawning one `git interpret-trailers`
  // process per commit (which would be O(N) process forks on N commits).
  // Trailers are `Key: value` lines at the end of a commit body.
  const TRAILER_LINE_RE = /^([A-Z][A-Za-z-]*):\s*(.+)$/gm;

  for (const block of raw.split('\x1e')) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const nullIdx = trimmed.indexOf('\x00');
    if (nullIdx === -1) continue;

    const sha = trimmed.slice(0, nullIdx).trim();
    const msg = trimmed.slice(nullIdx + 1);

    // Parse trailers inline — no process fork needed.
    const trailers: Record<string, string> = {};
    TRAILER_LINE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TRAILER_LINE_RE.exec(msg)) !== null) {
      trailers[m[1]] = m[2].trim();
    }

    // Skip release-automation commits — they never carry review trailers.
    if (trailers['Noldor-Path'] === 'release-automation') continue;
    // Skip micro-chore commits — they don't require a reviewer.
    if (trailers['Noldor-Path'] === 'micro-chore') continue;

    // Count override usage.
    const overrideReason = trailers['Noldor-Path-Override'];
    if (overrideReason && !commitOnlyTouchesReport(sha, cwd)) {
      overrides.push({ sha, reason: overrideReason });
    }

    // Count review-skips: gated path with no Noldor-Reviewed trailer.
    const path = trailers['Noldor-Path'];
    if (path && GATED_PATH_RE.test(path) && !trailers['Noldor-Reviewed']) {
      reviewSkipCount++;
    }
  }

  return {
    overrides,
    tierDistribution: { full, specsOnly },
    reviewSkipCount,
  };
}

function groupByCategory(gaps: Gap[]): Map<string, Gap[]> {
  const map = new Map<string, Gap[]>();
  for (const gap of gaps) {
    const list = map.get(gap.category) ?? [];
    list.push(gap);
    map.set(gap.category, list);
  }
  return map;
}

function renderStdout(grouped: Map<string, Gap[]>, totalFeatures: number): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`SDD Report — ${date}`, ''];
  if (grouped.size === 0) {
    lines.push('✓ No gaps detected across 14 categories.');
    return lines.join('\n');
  }
  for (const [category, gaps] of grouped) {
    lines.push(`⚠ ${category} (${gaps.length}):`);
    for (const g of gaps) {
      lines.push(`  - ${g.itemId}: ${g.message}`);
    }
    lines.push('');
  }
  lines.push(`${grouped.size} categories with issues across ${totalFeatures} features.`);
  lines.push('Full report: docs/sdd-report.md');
  return lines.join('\n');
}

function renderReportMd(
  grouped: Map<string, Gap[]>,
  totalFeatures: number,
  totalIdeasUntriaged: number,
  totalBacklog: number,
  gateCompliance: GateComplianceSection | null,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    '<!-- generated: do-not-edit -->',
    '',
    '# SDD Report',
    '',
    `Generated: ${date} by \`pnpm sdd:report\`.`,
    '',
    `Pre-MVP done features (\`introduced\` < \`${MIN_ENFORCED_VERSION}\`) are`,
    'grandfathered from `links.spec` / `links.code` checks.',
    'Bump `MIN_ENFORCED_VERSION` in `scripts/garden/sdd-report.ts` once backfill is done.',
    '',
    '## Summary',
    '',
  ];
  lines.push(`- Total features: ${totalFeatures}`);
  lines.push(`- Untriaged ideas: ${totalIdeasUntriaged}`);
  lines.push(`- Backlog entries: ${totalBacklog}`);
  lines.push(`- Gap categories with issues: ${grouped.size} / 14`);
  lines.push('');

  // Gate compliance section — only at release time. Without --release, the
  // counter ticks per-commit and pollutes diffs without conveying signal.
  if (gateCompliance) {
    lines.push('## Gate compliance');
    lines.push('');
    lines.push('### Tier distribution');
    lines.push('');
    lines.push(`- \`full\` (brainstorm + spec + plan): ${gateCompliance.tierDistribution.full}`);
    lines.push(`- \`specs-only\` (no brainstorm): ${gateCompliance.tierDistribution.specsOnly}`);
    lines.push('');
    lines.push('### Override usage (last 30 days)');
    lines.push('');
    if (gateCompliance.overrides.length === 0) {
      lines.push('No overrides in the last 30 days.');
    } else {
      for (const o of gateCompliance.overrides) {
        lines.push(`- \`${o.sha.slice(0, 7)}\` — ${o.reason}`);
      }
    }
    lines.push('');
    lines.push('### Review-skip count (last 30 days)');
    lines.push('');
    lines.push(
      `Gated commits missing \`Noldor-Reviewed\` trailer: ${gateCompliance.reviewSkipCount}`,
    );
    lines.push('');
  }

  lines.push('## Gap details');
  lines.push('');
  if (grouped.size === 0) {
    lines.push('No gaps detected.');
    return lines.join('\n');
  }
  for (const [category, gaps] of grouped) {
    lines.push(`### ${category}`, '');
    for (const g of gaps) {
      lines.push(`- \`${g.itemId}\` — ${g.message}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Resolve the report output path. Priority: `--out <path>` CLI flag, then
 * `CHARUY_SDD_REPORT_OUT` env var, then the canonical `docs/sdd-report.md`.
 * The env-var escape is what lets the test suite run the CLI against a
 * temp file without mutating the live working tree.
 */
export function resolveReportOutPath(argv: string[], env: NodeJS.ProcessEnv): string {
  const flagIdx = argv.indexOf('--out');
  if (flagIdx !== -1) {
    const next = argv[flagIdx + 1];
    // Reject `--out --release` (and similar) so an operator typo surfaces as
    // a clean fall-through to env/default instead of writing the report to a
    // file literally named `--release`.
    if (next && !next.startsWith('--')) return next;
  }
  const fromEnv = env.CHARUY_SDD_REPORT_OUT;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return 'docs/sdd-report.md';
}

async function main(): Promise<void> {
  const features = await loadSddFeatures(loadDocRoots().features);
  const ideasMd = await readFile('ideas.md', 'utf8').catch(() => '');
  const backlogRaw = await readFile(loadDocRoots().backlog, 'utf8').catch(() => '');
  const backlog = parseBacklog(backlogRaw);
  const specPaths = await listSpecs(loadDocRoots().specs);
  const planPaths = await listPlans(loadDocRoots().plans);

  const allRepoPaths: string[] = [];
  await walkRepo('packages', allRepoPaths);
  await walkRepo('apps', allRepoPaths);
  await walkRepo('scripts', allRepoPaths);

  const testFiles = allRepoPaths.filter(
    (p) => /\.test\.(ts|tsx)$/.test(p) || /\.spec\.(ts|tsx)$/.test(p),
  );
  const testInputs = await readTextFiles(testFiles);

  const docFiles: string[] = [];
  for (const sub of ['docs/user/tutorials', 'docs/user/explanation']) {
    try {
      const entries = await readdir(sub, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.md')) {
          docFiles.push(join(sub, e.name));
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const docInputs = await readTextFiles(docFiles);

  const actualPackages: string[] = [];
  try {
    const pkgEntries = await readdir('packages', { withFileTypes: true });
    for (const e of pkgEntries) {
      if (!e.isDirectory()) {
        continue;
      }
      try {
        const pkgJson = JSON.parse(
          await readFile(join('packages', e.name, 'package.json'), 'utf8'),
        ) as {
          name?: string;
        };
        if (pkgJson.name) {
          actualPackages.push(pkgJson.name);
        }
      } catch {
        // Skip dirs without package.json
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const readmeContent = await readFile('README.md', 'utf8').catch(() => '');

  const staleDays = Number(process.env.SDD_STALE_DAYS ?? '90');

  const gaps = await collectGaps({
    actualPackages,
    allRepoPaths,
    backlog,
    docInputs,
    features,
    graphPath: 'graphify-out/graph.json',
    graphSrcRoots: ['packages', 'apps', 'scripts'],
    ideasMd,
    planPaths,
    readmeContent,
    specPaths,
    staleDays,
    testInputs,
  });

  const grouped = groupByCategory(gaps);
  const totalIdeasUntriaged = extractUntriagedBullets(ideasMd).length;

  const jsonMode = process.argv.includes('--json');
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(gaps)}\n`);
    return;
  }

  const stdoutText = renderStdout(grouped, features.length);
  process.stdout.write(`${stdoutText}\n`);

  const releaseMode = process.argv.includes('--release');
  const gateCompliance = releaseMode ? buildGateComplianceSection(features) : null;
  const reportMd = renderReportMd(
    grouped,
    features.length,
    totalIdeasUntriaged,
    backlog.length,
    gateCompliance,
  );
  const outPath = resolveReportOutPath(process.argv.slice(2), process.env);
  await writeFile(outPath, `${reportMd.replace(/\n*$/, '')}\n`, 'utf8');
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('sdd-report');
if (invokedDirect) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
