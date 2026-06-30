import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import matter from 'gray-matter';

import { loadDocRoots } from '../core/doc-roots.js';
import { FeatureFrontmatterSchema } from '../features/feature-schema.js';
import { INVARIANTS } from './garden-invariants.js';
import { makeInvariants, runInvariants } from '../invariants/index.js';
import { parseBacklog } from '../utils/parse-blocks.js';
import { slugify } from '../utils/slugify.js';
import { STALE_BACKLOG_DAYS_DEFAULT } from './backlog-demote.js';
import { auditOverrides } from './detectors/override-audit.js';
import { auditCodexCrOverrides } from './detectors/codex-cr-override-audit.js';
import { detectBootstrapOverrideAudit } from './detectors/bootstrap-override-audit.js';
import { detectTierMismatch } from './detectors/tier-mismatch.js';
import { detectAllowlistDrift } from './detectors/allowlist-drift.js';
import { detectTrailerScopeMismatch } from './detectors/trailer-scope-mismatch.js';
import { detectPlanWithoutFd } from './detectors/plan-without-fd.js';
import { detectFdWithoutPlan } from './detectors/fd-without-plan.js';
import { detectCodeLinksDrift } from './detectors/code-links-drift.js';
import { detectMigrationCoverage } from './detectors/migration-coverage.js';
import { detectMilestoneShippedIncomplete } from './detectors/milestone-shipped-incomplete.js';
import { buildSlugToCodeMap, collectTaggedCode, loadCachedCode } from '../sync/sync-code-links.js';
import {
  resolveByLinksPlan,
  resolveByLinksSpec,
  resolveByGraphAdjacency,
} from './plan-resolution.js';
import { noldorCliCommand } from '../core/noldor-cli.js';

import type { FeatureFrontmatter } from '../features/feature-schema.js';
import type { Invariant } from './garden-invariants.js';
import type { Invariant as ArchitectureInvariant, InvariantResult } from '../invariants/types.js';
import type { OverrideAuditResult } from './detectors/override-audit.js';
import type { Finding as CodexCrOverrideFinding } from './detectors/codex-cr-override-audit.js';
import type { BootstrapOverrideFinding } from './detectors/bootstrap-override-audit.js';
import type { TierMismatchFinding } from './detectors/tier-mismatch.js';
import type { AllowlistDriftFinding } from './detectors/allowlist-drift.js';
import type { TrailerScopeMismatchFinding } from './detectors/trailer-scope-mismatch.js';
import type { PlanWithoutFdFinding } from './detectors/plan-without-fd.js';
import type { FdWithoutPlanFinding } from './detectors/fd-without-plan.js';
import type { MigrationCoverageFinding } from './detectors/migration-coverage.js';
import type { MilestoneShippedIncompleteFinding } from './detectors/milestone-shipped-incomplete.js';

// --- Defaults ---
/** Age threshold (in days) for plans with no matching feature MD. */
const STALE_DAYS_DEFAULT = 60;
/** Shared with `backlog-demote.ts` so detector + auto-demotion agree on "stale". */
const UNUSED_BACKLOG_DAYS_DEFAULT = STALE_BACKLOG_DAYS_DEFAULT;

/**
 * One stale plan finding. The detector emits these for plans whose matching
 * feature is done + shipped, or (secondary signal) plans untouched for
 * longer than the staleness threshold with no matching feature MD.
 */
export interface StalePlan {
  readonly path: string;
  readonly slug: string;
  readonly reason: 'feature-done' | 'age-no-feature';
  readonly action: 'archive';
}

const PLAN_FILE_RE = /^\d{4}-\d{2}-\d{2}-(.+?)(?:-part\d+)?\.md$/;

/**
 * Derive the feature slug from a plan filename.
 *
 * @param filename - The basename, e.g. `2026-04-19-tooltips.md` or
 *   `2026-04-23-feature-md-framework-part1.md`.
 * @returns The slug (`tooltips`, `feature-md-framework`) or `null` if
 *   the filename does not match the plan naming convention.
 */
export function planSlugFromFilename(filename: string): string | null {
  const match = PLAN_FILE_RE.exec(filename);
  return match?.[1] ?? null;
}

async function loadFeatureBySlug(repo: string, slug: string): Promise<FeatureFrontmatter | null> {
  const path = join(loadDocRoots(repo).features, `${slug}.md`);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = matter(raw);
    return FeatureFrontmatterSchema.parse(parsed.data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Detect stale plans.
 *
 * Primary signal: matching feature MD has `phase: done` and merged PRs.
 * Secondary signal: file mtime older than `staleDays` AND no matching
 * feature MD exists.
 *
 * @param repo - Repository root.
 * @param staleDays - Age threshold in days for the secondary signal.
 *   Defaults to 180.
 * @returns One StalePlan per flagged plan file.
 */
export async function detectStalePlans(
  repo: string,
  staleDays = STALE_DAYS_DEFAULT,
): Promise<StalePlan[]> {
  const plansDir = loadDocRoots(repo).plans;
  let entries: string[];
  try {
    entries = await readdir(plansDir);
  } catch {
    return [];
  }

  const ageCutoffMs = Date.now() - staleDays * 24 * 60 * 60 * 1000;
  const findings: StalePlan[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) {
      continue;
    }
    const slug = planSlugFromFilename(entry);
    if (!slug) {
      continue;
    }

    const fullPath = join(plansDir, entry);
    // Presentation string — relative path shown in garden output, not used for IO.
    const relPath = join('docs/superpowers/plans', entry);
    const feature = await loadFeatureBySlug(repo, slug);

    if (feature) {
      if (feature.phase === 'done') {
        findings.push({
          action: 'archive',
          path: relPath,
          reason: 'feature-done',
          slug,
        });
      }
      continue;
    }

    // Fallback — scan FDs' links.plan for this plan path.
    const byLinks = await resolveByLinksPlan({ planPath: relPath, repo });
    if (byLinks) {
      if (byLinks.fd.phase === 'done') {
        findings.push({
          action: 'archive',
          path: relPath,
          reason: 'feature-done',
          slug: byLinks.slug,
        });
      }
      continue;
    }

    // Last-resort fallback — graph adjacency (plan-of edge in the enriched graph.json).
    // Catches plans no slug/links.* signal owns; a live owner suppresses age-out, a
    // done owner archives as feature-done. Missing/stale graph degrades to age-out.
    const byGraph = await resolveByGraphAdjacency({ repo, docPath: relPath, relation: 'plan-of' });
    if (byGraph) {
      if (byGraph.fd.phase === 'done') {
        findings.push({
          action: 'archive',
          path: relPath,
          reason: 'feature-done',
          slug: byGraph.slug,
        });
      }
      continue;
    }

    const st = await stat(fullPath);
    if (st.mtimeMs < ageCutoffMs) {
      findings.push({
        action: 'archive',
        path: relPath,
        reason: 'age-no-feature',
        slug,
      });
    }
  }
  return findings;
}

/**
 * One stale spec finding. Mirror of {@link StalePlan} for design specs in
 * `docs/superpowers/specs/`. Emitted when the matching feature has shipped
 * (`phase: done`) or (secondary signal) the file is older than the staleness
 * threshold and no matching feature MD exists.
 */
export interface StaleSpec {
  readonly path: string;
  readonly slug: string;
  readonly reason: 'feature-done' | 'age-no-feature';
  readonly action: 'archive';
}

const SPEC_FILE_RE = /^\d{4}-\d{2}-\d{2}-(.+?)-design\.md$/;

/**
 * Derive the feature slug from a spec filename.
 *
 * @param filename - The basename, e.g. `2026-04-23-feature-md-framework-design.md`.
 * @returns The slug (`feature-md-framework`) or `null` if the filename does
 *   not match the spec naming convention.
 */
export function specSlugFromFilename(filename: string): string | null {
  const match = SPEC_FILE_RE.exec(filename);
  return match?.[1] ?? null;
}

/**
 * Detect stale specs. Mirrors {@link detectStalePlans}: shipped features
 * imply the spec is archive-ready; old specs without a feature owner age
 * out the same way.
 *
 * @param repo - Repository root.
 * @param staleDays - Age threshold in days for the secondary signal.
 *   Defaults to {@link STALE_DAYS_DEFAULT}.
 * @returns One StaleSpec per flagged spec file.
 */
export async function detectStaleSpecs(
  repo: string,
  staleDays = STALE_DAYS_DEFAULT,
): Promise<StaleSpec[]> {
  const specsDir = loadDocRoots(repo).specs;
  let entries: string[];
  try {
    entries = await readdir(specsDir);
  } catch {
    return [];
  }

  const ageCutoffMs = Date.now() - staleDays * 24 * 60 * 60 * 1000;
  const findings: StaleSpec[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) {
      continue;
    }
    const slug = specSlugFromFilename(entry);
    if (!slug) {
      continue;
    }

    const fullPath = join(specsDir, entry);
    // Not used for IO. Shown in garden output AND matched verbatim against FDs'
    // links.spec by the fallback below — keep the exact
    // 'docs/superpowers/specs/<entry>' forward-slash form.
    const relPath = join('docs/superpowers/specs', entry);
    const feature = await loadFeatureBySlug(repo, slug);

    if (feature) {
      if (feature.phase === 'done') {
        findings.push({
          action: 'archive',
          path: relPath,
          reason: 'feature-done',
          slug,
        });
      }
      continue;
    }

    // Fallback — scan FDs' links.spec for this spec path. Catches attach-path
    // specs (`<date>-<parent>-<enhancement>-design.md`) whose filename slug
    // matches no FD but whose parent FD still owns them: live owner suppresses
    // the age-out signal, done owner archives as feature-done.
    const byLinks = await resolveByLinksSpec({ repo, specPath: relPath });
    if (byLinks) {
      if (byLinks.fd.phase === 'done') {
        findings.push({
          action: 'archive',
          path: relPath,
          reason: 'feature-done',
          slug: byLinks.slug,
        });
      }
      continue;
    }

    // Last-resort fallback — graph adjacency (spec-of edge in the enriched graph.json).
    const byGraph = await resolveByGraphAdjacency({ repo, docPath: relPath, relation: 'spec-of' });
    if (byGraph) {
      if (byGraph.fd.phase === 'done') {
        findings.push({
          action: 'archive',
          path: relPath,
          reason: 'feature-done',
          slug: byGraph.slug,
        });
      }
      continue;
    }

    const st = await stat(fullPath);
    if (st.mtimeMs < ageCutoffMs) {
      findings.push({
        action: 'archive',
        path: relPath,
        reason: 'age-no-feature',
        slug,
      });
    }
  }
  return findings;
}

/**
 * One unused-backlog finding. Either too old without ever being promoted
 * to a feature MD, or redundant because a feature MD already exists for
 * the same slug.
 */
export interface UnusedBacklog {
  readonly slug: string;
  readonly since: string | null;
  readonly reason: 'age-no-promotion' | 'redundant-with-feature';
  readonly action: 'drop';
}

/**
 * Collect the set of feature slugs that already have a feature MD.
 *
 * @param repo - Repository root.
 * @returns Set of slugs derived from filenames in `docs/features/`.
 */
async function listFeatureSlugs(repo: string): Promise<Set<string>> {
  try {
    const entries = await readdir(loadDocRoots(repo).features);
    return new Set(entries.filter((e) => e.endsWith('.md')).map((e) => e.replace(/\.md$/, '')));
  } catch {
    return new Set();
  }
}

/**
 * Detect unused backlog entries.
 *
 * Age signal: `since` older than `staleDays` AND no feature MD with the
 * derived slug exists. `phase: later` entries are NOT exempt — demotion
 * (`backlog-demote.ts`) parks an entry, but a parked entry that keeps
 * aging still surfaces here for the operator's eventual drop decision.
 *
 * Redundancy signal: a feature MD with the derived slug already exists
 * (regardless of age).
 *
 * @param repo - Repository root.
 * @param staleDays - Age threshold in days. Defaults to 180.
 * @returns One UnusedBacklog per flagged entry.
 */
export async function detectUnusedBacklog(
  repo: string,
  staleDays = UNUSED_BACKLOG_DAYS_DEFAULT,
): Promise<UnusedBacklog[]> {
  const backlogPath = loadDocRoots(repo).backlog;
  let raw: string;
  try {
    raw = await readFile(backlogPath, 'utf8');
  } catch {
    return [];
  }

  const entries = parseBacklog(raw);
  const featureSlugs = await listFeatureSlugs(repo);
  const ageCutoffMs = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  const findings: UnusedBacklog[] = [];
  for (const entry of entries) {
    const slug = slugify(entry.name);
    if (featureSlugs.has(slug)) {
      findings.push({
        action: 'drop',
        reason: 'redundant-with-feature',
        since: entry.since ?? null,
        slug,
      });
      continue;
    }
    if (entry.since) {
      const sinceMs = Date.parse(`${entry.since}T00:00:00Z`);
      if (!Number.isFinite(sinceMs)) {
        console.warn(
          `garden-detect: skipped malformed since='${entry.since}' on backlog entry '${entry.name}'`,
        );
        continue;
      }
      if (sinceMs < ageCutoffMs) {
        findings.push({
          action: 'drop',
          reason: 'age-no-promotion',
          since: entry.since,
          slug,
        });
      }
    }
  }
  return findings;
}

/**
 * One rule-contradiction finding. The detector emits these where exactly
 * one side of an invariant pair matches the canonical phrasing — implying
 * the rule documented in one place is missing or divergent in the other.
 */
export interface Contradiction {
  readonly pair: readonly [string, string];
  readonly rule: string;
  readonly message: string;
  readonly action: 'manual-edit';
}

async function readDocOrNull(repo: string, rel: string): Promise<string | null> {
  try {
    return await readFile(join(repo, rel), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Detect rule contradictions across the supplied invariant list.
 *
 * @param repo - Repository root.
 * @param invariants - List of invariants to evaluate. Defaults to the seed
 *   list in `garden-invariants.ts`.
 * @returns One Contradiction per flagged invariant pair.
 */
export async function detectContradictions(
  repo: string,
  invariants: readonly Invariant[] = INVARIANTS,
): Promise<Contradiction[]> {
  const findings: Contradiction[] = [];
  for (const inv of invariants) {
    const [a, b] = await Promise.all([
      readDocOrNull(repo, inv.docA),
      readDocOrNull(repo, inv.docB),
    ]);
    if (a === null || b === null) {
      continue;
    }
    const matchA = inv.patternA.test(a);
    const matchB = inv.patternB.test(b);
    if (matchA !== matchB) {
      findings.push({
        action: 'manual-edit',
        message: inv.message,
        pair: [inv.docA, inv.docB],
        rule: inv.name,
      });
    }
  }
  return findings;
}

/**
 * Pair of source-of-truth path(s) and the Noldor page that documents them.
 * Used by Detector 15 (source-drift) to flag drift when sources are touched
 * after the matching page.
 */
export interface SourceDriftPair {
  readonly sources: readonly string[];
  readonly page: string;
}

/** Default source-of-truth ↔ Noldor page pairs. */
export const SOURCE_DRIFT_PAIRS: readonly SourceDriftPair[] = [
  {
    sources: ['src/features/feature-schema.ts'],
    page: 'docs/noldor/feature-md-schema.md',
  },
  { sources: ['.claude/skills'], page: 'docs/noldor/skill-catalog.md' },
  { sources: ['lefthook.yml', 'package.json'], page: 'docs/noldor/script-catalog.md' },
  { sources: ['src/release'], page: 'docs/noldor/versioning.md' },
  { sources: ['src/garden'], page: 'docs/noldor/garden-and-drift.md' },
];

/**
 * One source-drift finding. Emitted when the latest commit touching any
 * `sources` path is more than `toleranceDays` newer than the latest commit
 * touching the matching Noldor page.
 */
export interface SourceDriftFinding {
  readonly detector: 'source-drift';
  readonly page: string;
  readonly sources: readonly string[];
  readonly latestSourceDate: string;
  readonly pageDate: string;
  readonly daysBehind: number;
  readonly message: string;
  readonly action: 'manual-edit';
}

/**
 * Pure compare: should this pair be flagged? Returns true when source is newer
 * than page by more than `toleranceDays`. Null inputs (path never committed)
 * return false — nothing to compare against.
 *
 * @param latestSourceISO - ISO date of latest commit touching any source path, or null.
 * @param pageISO - ISO date of latest commit touching the page, or null.
 * @param toleranceDays - Tolerance window in days.
 */
export function shouldFlagSourceDrift(
  latestSourceISO: string | null,
  pageISO: string | null,
  toleranceDays: number,
): boolean {
  if (latestSourceISO === null || pageISO === null) return false;
  const source = new Date(latestSourceISO).getTime();
  const page = new Date(pageISO).getTime();
  if (Number.isNaN(source) || Number.isNaN(page)) return false;
  const tolMs = toleranceDays * 24 * 60 * 60 * 1000;
  return source > page + tolMs;
}

function lastCommitISO(repo: string, pathspec: string): string | null {
  try {
    const out = execFileSync('git', ['log', '-n', '1', '--format=%cI', '--', pathspec], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Run Detector 15 (source drift) against the configured pairs. For each pair,
 * compares the latest commit date across all `sources` against the page's
 * latest commit; flags when source is newer by more than `toleranceDays`.
 */
export async function detectSourceDrift(
  repo: string,
  pairs: readonly SourceDriftPair[] = SOURCE_DRIFT_PAIRS,
  toleranceDays = 30,
): Promise<SourceDriftFinding[]> {
  const findings: SourceDriftFinding[] = [];
  for (const pair of pairs) {
    const sourceDates = pair.sources
      .map((src) => lastCommitISO(repo, src))
      .filter((d): d is string => d !== null);
    if (sourceDates.length === 0) continue;
    const latestSourceISO = sourceDates.reduce((acc, cur) => (cur > acc ? cur : acc));
    const pageISO = lastCommitISO(repo, pair.page);
    if (!shouldFlagSourceDrift(latestSourceISO, pageISO, toleranceDays)) continue;
    const sourceMs = new Date(latestSourceISO).getTime();
    const pageMs = new Date(pageISO!).getTime();
    const daysBehind = Math.floor((sourceMs - pageMs) / (24 * 60 * 60 * 1000));
    findings.push({
      detector: 'source-drift',
      page: pair.page,
      sources: pair.sources,
      latestSourceDate: latestSourceISO,
      pageDate: pageISO!,
      daysBehind,
      message: `${pair.page}: source(s) ${pair.sources.join(', ')} touched ${daysBehind}d after the page (tolerance ${toleranceDays}d). Refresh the page or extend the tolerance.`,
      action: 'manual-edit',
    });
  }
  return findings;
}

/**
 * One pass-through SDD gap finding (mirror of `Gap` from sdd-report.ts).
 */
export interface SddGap {
  readonly category: string;
  readonly itemId: string;
  readonly message: string;
}

/**
 * Unified output of `pnpm garden:detect` — consumed by the /garden skill.
 */
export interface GardenFindings {
  readonly stalePlans: readonly StalePlan[];
  readonly staleSpecs: readonly StaleSpec[];
  readonly unusedBacklog: readonly UnusedBacklog[];
  readonly contradictions: readonly Contradiction[];
  readonly sourceDrift: readonly SourceDriftFinding[];
  readonly sddGaps: readonly SddGap[];
  readonly invariantViolations: readonly InvariantResult[];
  // Gate-compliance detectors (Phase 6)
  readonly overrideAudit: OverrideAuditResult;
  readonly codexCrOverrideAudit: readonly CodexCrOverrideFinding[];
  readonly tierMismatch: readonly TierMismatchFinding[];
  readonly allowlistDrift: readonly AllowlistDriftFinding[];
  readonly trailerScopeMismatch: readonly TrailerScopeMismatchFinding[];
  readonly planWithoutFd: readonly PlanWithoutFdFinding[];
  readonly fdWithoutPlan: readonly FdWithoutPlanFinding[];
  readonly migrationCoverage: readonly MigrationCoverageFinding[];
  readonly milestoneShippedIncomplete: readonly MilestoneShippedIncompleteFinding[];
  readonly bootstrapOverrideAudit: readonly BootstrapOverrideFinding[];
}

/**
 * Output of `pnpm garden:detect --gate-compliance` — runs only the
 * Phase 6 gate-compliance detectors.
 */
export interface GateComplianceFindings {
  readonly overrideAudit: OverrideAuditResult;
  readonly codexCrOverrideAudit: readonly CodexCrOverrideFinding[];
  readonly tierMismatch: readonly TierMismatchFinding[];
  readonly allowlistDrift: readonly AllowlistDriftFinding[];
  readonly trailerScopeMismatch: readonly TrailerScopeMismatchFinding[];
  readonly planWithoutFd: readonly PlanWithoutFdFinding[];
  readonly fdWithoutPlan: readonly FdWithoutPlanFinding[];
  readonly bootstrapOverrideAudit: readonly BootstrapOverrideFinding[];
}

/**
 * Run only the gate-compliance detectors (Phase 6 set).
 *
 * @param repo - Repository root.
 */
export async function detectGateCompliance(repo: string): Promise<GateComplianceFindings> {
  const [tierMismatch, allowlistDrift, trailerScopeMismatch, planWithoutFd, fdWithoutPlan] =
    await Promise.all([
      detectTierMismatch(repo),
      detectAllowlistDrift({ cwd: repo }),
      detectTrailerScopeMismatch({ cwd: repo }),
      detectPlanWithoutFd(repo),
      detectFdWithoutPlan(repo),
    ]);
  const overrideAudit = auditOverrides({ cwd: repo });
  const codexCrOverrideAudit = auditCodexCrOverrides({ cwd: repo });
  const bootstrapOverrideAudit = detectBootstrapOverrideAudit({ cwd: repo });
  return {
    overrideAudit,
    codexCrOverrideAudit,
    tierMismatch,
    allowlistDrift,
    trailerScopeMismatch,
    planWithoutFd,
    fdWithoutPlan,
    bootstrapOverrideAudit,
  };
}

function isSddGap(value: unknown): value is SddGap {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.category === 'string' && typeof v.itemId === 'string' && typeof v.message === 'string'
  );
}

function loadSddGaps(repo: string): SddGap[] {
  const [cmd, args] = noldorCliCommand(['garden', 'sdd-report', '--json']);
  const stdout = execFileSync(cmd, args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // Isolate the JSON line: the CLI may emit log lines before the report.
  // Today sdd-report emits exactly one `[…]` line; if it ever pretty-prints or
  // Adds debug stdout, this scan still picks the LAST `[`-line.
  const jsonLine = stdout
    .split('\n')
    .toReversed()
    .find((line) => line.trim().startsWith('['));
  if (!jsonLine) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonLine);
  } catch (error) {
    console.warn(
      `garden-detect: sdd:report --json output unparseable; ignoring (${(error as Error).message})`,
    );
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isSddGap);
}

/**
 * Run all architecture invariants and return their results. Garden surfaces
 * these as advisory findings; the blocking gate is the pre-commit hook.
 *
 * @returns One `InvariantResult` per failing invariant (violations.length > 0).
 */
export async function detectInvariants(
  repo = process.cwd(),
  invs: readonly ArchitectureInvariant[] = makeInvariants(repo),
): Promise<readonly InvariantResult[]> {
  const results = await runInvariants(invs);
  return results.filter((r) => r.violations.length > 0);
}

/**
 * The release range the range-based detectors scan: `<prev-tag>..HEAD`, or
 * `HEAD` when no version tag exists yet (degrades to a working-tree diff).
 */
function releaseRange(repo: string): string {
  try {
    const tag = execFileSync(
      'git',
      ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*'],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return tag ? `${tag}..HEAD` : 'HEAD';
  } catch {
    return 'HEAD';
  }
}

/**
 * Run all detectors and return the unified findings object.
 *
 * @param repo - Repository root.
 * @returns Unified findings including stale plans, unused backlog, rule
 *   contradictions, SDD gaps, architecture invariant violations, and
 *   gate-compliance detector results.
 */
export async function detectAll(repo: string): Promise<GardenFindings> {
  const [
    stalePlans,
    staleSpecs,
    unusedBacklog,
    contradictions,
    sourceDrift,
    invariantViolations,
    tierMismatch,
    allowlistDrift,
    trailerScopeMismatch,
    planWithoutFd,
    fdWithoutPlan,
  ] = await Promise.all([
    detectStalePlans(repo),
    detectStaleSpecs(repo),
    detectUnusedBacklog(repo),
    detectContradictions(repo),
    detectSourceDrift(repo),
    detectInvariants(repo),
    detectTierMismatch(repo),
    detectAllowlistDrift({ cwd: repo }),
    detectTrailerScopeMismatch({ cwd: repo }),
    detectPlanWithoutFd(repo),
    detectFdWithoutPlan(repo),
  ]);
  const milestoneShippedIncomplete = await detectMilestoneShippedIncomplete(repo);
  const sddGaps = loadSddGaps(repo);
  // Append the file-side `// @fd:` tag drift: an FD whose cached links.code
  // diverges from what the tag scan would write. Reuses diffProjection so this
  // can never disagree with `sync code-links --check`.
  const scannedCode = buildSlugToCodeMap(await collectTaggedCode(repo));
  const cachedCode = await loadCachedCode(join(repo, 'docs/features'));
  sddGaps.push(...detectCodeLinksDrift(scannedCode, cachedCode));
  const overrideAudit = auditOverrides({ cwd: repo });
  const codexCrOverrideAudit = auditCodexCrOverrides({ cwd: repo });
  const bootstrapOverrideAudit = detectBootstrapOverrideAudit({ cwd: repo });
  // A schema-surface change in the release range with no accompanying migration
  // is a drift finding (advisory, like the SDD gaps above).
  const migration = detectMigrationCoverage(releaseRange(repo), repo);
  return {
    contradictions,
    invariantViolations,
    sddGaps,
    sourceDrift,
    stalePlans,
    staleSpecs,
    unusedBacklog,
    overrideAudit,
    codexCrOverrideAudit,
    tierMismatch,
    allowlistDrift,
    trailerScopeMismatch,
    planWithoutFd,
    fdWithoutPlan,
    migrationCoverage: migration ? [migration] : [],
    milestoneShippedIncomplete,
    bootstrapOverrideAudit,
  };
}

/**
 * Classify gate-compliance findings into blocking vs informational.
 *
 * Blocking (exit 1): tier-mismatch, allowlist-drift, trailer-scope-mismatch
 * (non-empty), and override-audit with severity WARN.
 *
 * Informational only: plan-without-fd, fd-without-plan. These surface
 * process hygiene issues but do not block releases.
 *
 * @param findings - Gate-compliance findings from {@link detectGateCompliance}.
 * @returns `true` when at least one blocking finding is present.
 */
export function hasBlockingFindings(findings: GateComplianceFindings): boolean {
  if (findings.tierMismatch.length > 0) return true;
  if (findings.allowlistDrift.length > 0) return true;
  if (findings.trailerScopeMismatch.length > 0) return true;
  if (findings.overrideAudit.severity === 'WARN') return true;
  return false;
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('garden-detect');
if (invokedDirect) {
  const gateComplianceMode = process.argv.includes('--gate-compliance');
  const run = gateComplianceMode ? detectGateCompliance(process.cwd()) : detectAll(process.cwd());
  void run
    .then((findings) => {
      process.stdout.write(`${JSON.stringify(findings)}\n`);
      if (gateComplianceMode && hasBlockingFindings(findings as GateComplianceFindings)) {
        process.exitCode = 1;
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
