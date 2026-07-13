import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  MIN_ENFORCED_VERSION,
  extractPlanSlug,
  extractSpecSlug,
  isInfraFile,
  isLinkEnforced,
  listPlans,
  listSpecs,
  loadSddFeatures,
  readTextFiles,
  walkRepo,
} from '../core/fd-load.js';
import type { FeatureRecord, Gap } from '../core/fd-load.js';
import { extractTags } from '../sync/sync-test-links.js';
import { parseBacklog } from '../utils/parse-blocks.js';
import { extractUntriagedBullets } from '../triage/triage-list-untriaged.js';

import { loadConsumerConfig } from '../core/consumer-config.js';

import type { ConsumerConfig } from '../core/consumer-config.js';
import { loadDocRoots } from '../core/doc-roots.js';

import { commitOnlyTouchesReport, matchesExpectedOverride } from './detectors/override-audit.js';
import type { ExpectedOverrideRule } from './detectors/override-audit.js';
import { loadConfigSync } from '../core/config.js';
import {
  actualPackageNames,
  scanRoots as resolveScanRoots,
  walkCodeFiles,
} from '../core/repo-paths.js';
import { renderMetricsSection, reviewSkipCountLine } from './sdd-report-format.js';
import { DEFAULT_CLONE_OPTIONS, detectClones } from '../clones/detect.js';
import type { CloneReport } from '../clones/detect.js';
import { readFileSync } from 'node:fs';
import type { MetricsReport } from '../metrics/types.js';
import {
  buildFileToFdsMap,
  getCommunityOwners,
  getImportOwnersForTest,
  loadFreshGraphOrWarn,
  requireFreshGraph,
} from './graph-fd-lookup.js';

import type { BacklogEntry } from '../utils/parse-blocks.js';

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

  const ctx = suggestion
    ? requireFreshGraph(suggestion.graphPath, suggestion.srcRoots, features)
    : null;

  return tsFiles
    .filter((p) => !referenced.has(p))
    .filter((p) => !isCoveredByAncestorDir(p, referenced))
    .map((p) => {
      const base = `${p} is not referenced by any feature MD links.code`;
      let message = base;
      if (ctx) {
        const ranked = getCommunityOwners(p, ctx.graph, ctx.fileToFds);
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
  const ctx = suggestion
    ? requireFreshGraph(suggestion.graphPath, suggestion.srcRoots, suggestion.features)
    : null;
  let nodeByPath: Map<string, string> | null = null;
  if (ctx) {
    nodeByPath = new Map<string, string>();
    for (const n of ctx.graph.nodes) {
      if (n.source_location !== 'L1' || !n.source_file) continue;
      nodeByPath.set(n.source_file, n.id);
    }
  }

  const base = 'missing required `// @tests: <slug>` tag (validator hard-fails on this)';

  return inputs
    .filter((i) => !i.path.startsWith('scripts/') && !TESTS_TAG_RE.test(i.content))
    .map((i) => {
      let message = base;
      if (ctx && nodeByPath) {
        const nodeId = nodeByPath.get(i.path);
        if (nodeId) {
          const owners = [...getImportOwnersForTest(nodeId, ctx.graph, ctx.fileToFds)].toSorted();
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
  /** True when a `garden.overrideAudit.expected` rule matched this entry. */
  readonly expected: boolean;
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

  // Expected-noise rules from `garden.overrideAudit.expected` — render-side
  // marking only; severity stays auditOverrides' concern. Fail-open on a
  // missing/malformed config: worst case entries render without the marker.
  let expectedRules: readonly ExpectedOverrideRule[] = [];
  try {
    expectedRules =
      loadConfigSync(join(cwd, '.noldor', 'config.json'))?.garden?.overrideAudit?.expected ?? [];
  } catch {
    expectedRules = [];
  }

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
      overrides.push({
        sha,
        reason: overrideReason,
        expected: matchesExpectedOverride({ sha, reason: overrideReason }, expectedRules),
      });
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
  metricsReport: MetricsReport | null,
  cloneReport: CloneReport | null,
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

  // Code clones — deterministic token-based duplication signal. Strings avoid
  // underscore/asterisk characters (oxfmt mangles them in generated md).
  if (cloneReport) {
    lines.push('## Code clones');
    lines.push('');
    lines.push(
      `- ${cloneReport.groups.length} clone group(s), ${cloneReport.duplicationPct.toFixed(2)}% duplicated tokens across ${cloneReport.filesScanned} file(s)`,
    );
    for (const g of cloneReport.groups.slice(0, 5)) {
      const [a, b] = g.instances;
      lines.push(
        `- ${a?.file}:${a?.startLine}-${a?.endLine} and ${b?.file}:${b?.startLine}-${b?.endLine} (${g.tokens} tokens)`,
      );
    }
    lines.push('');
  }

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
        lines.push(`- \`${o.sha.slice(0, 7)}\` — ${o.reason}${o.expected ? ' (expected)' : ''}`);
      }
    }
    lines.push('');
    lines.push('### Review-skip count (last 30 days)');
    lines.push('');
    lines.push(reviewSkipCountLine(gateCompliance.reviewSkipCount));
    lines.push('');
  }

  lines.push(...renderMetricsSection(metricsReport));
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
 * `NOLDOR_SDD_REPORT_OUT` env var, then the canonical `docs/sdd-report.md`.
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
  const fromEnv = env.NOLDOR_SDD_REPORT_OUT;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return 'docs/sdd-report.md';
}

async function main(): Promise<void> {
  const features = await loadSddFeatures(loadDocRoots().features);
  const ideasMd = await readFile(loadDocRoots().ideas, 'utf8').catch(() => '');
  const backlogRaw = await readFile(loadDocRoots().backlog, 'utf8').catch(() => '');
  const backlog = parseBacklog(backlogRaw);
  const specPaths = await listSpecs(loadDocRoots().specs);
  const planPaths = await listPlans(loadDocRoots().plans);

  // Consumer `scanPaths` scope the walk (union-of-layouts fallback when
  // unset) — the hardcoded packages/apps/scripts trio left standalone `src/`
  // repos with an empty testInputs map, so every graph-known test read as
  // untagged and detector 13 flagged all of them.
  const scanRoots = resolveScanRoots();
  const allRepoPaths: string[] = [];
  for (const root of scanRoots) {
    await walkRepo(root, allRepoPaths);
  }

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

  const actualPackages = await actualPackageNames();
  const readmeContent = await readFile('README.md', 'utf8').catch(() => '');

  const staleDays = Number(process.env.SDD_STALE_DAYS ?? '90');

  const gaps = await collectGaps({
    actualPackages,
    allRepoPaths,
    backlog,
    docInputs,
    features,
    graphPath: 'graphify-out/graph.json',
    graphSrcRoots: scanRoots,
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
  let metricsReport: MetricsReport | null = null;
  try {
    const { compute } = await import('../metrics/compute.js');
    metricsReport = await compute(process.cwd());
  } catch {
    metricsReport = null;
  }
  // Clone corpus deliberately uses walkCodeFiles over the scan roots rather
  // than filtering allRepoPaths (walkRepo has a different directory-exclusion
  // policy) — one extra sub-second walk buys a single policy source.
  let cloneReport: CloneReport | null;
  try {
    const corpus = new Map<string, string>();
    for (const root of scanRoots) {
      for (const abs of walkCodeFiles(root, { includeTests: false })) {
        try {
          corpus.set(abs, readFileSync(abs, 'utf8'));
        } catch {
          // unreadable file — skip
        }
      }
    }
    const clonesConfig = loadConfigSync(join(process.cwd(), '.noldor', 'config.json'))?.clones;
    cloneReport = detectClones(corpus, {
      minTokens: clonesConfig?.minTokens ?? DEFAULT_CLONE_OPTIONS.minTokens,
      minLines: clonesConfig?.minLines ?? DEFAULT_CLONE_OPTIONS.minLines,
      gapTokens: clonesConfig?.gapTokens ?? DEFAULT_CLONE_OPTIONS.gapTokens,
    });
  } catch {
    cloneReport = null;
  }
  const reportMd = renderReportMd(
    grouped,
    features.length,
    totalIdeasUntriaged,
    backlog.length,
    gateCompliance,
    metricsReport,
    cloneReport,
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
