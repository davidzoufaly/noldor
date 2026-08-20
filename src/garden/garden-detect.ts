import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import matter from 'gray-matter';

import { loadConfig } from '../core/config.js';
import { planSlugFromFilename, specSlugFromFilename } from '../core/design-artifact-names.js';
import { loadDocRoots } from '../core/doc-roots.js';
import { FeatureFrontmatterSchema } from '../core/feature-schema.js';
import { INVARIANTS } from '../invariants/rule-pairs.js';
import { makeInvariants, runInvariants } from '../invariants/index.js';
import { parseBacklog } from '../utils/parse-blocks.js';
import { slugify } from '../utils/slugify.js';
import { STALE_BACKLOG_DAYS_DEFAULT } from './backlog-demote.js';
import { auditOverrides } from './detectors/override-audit.js';
import type { ExpectedOverrideRule } from './detectors/override-audit.js';
import { auditCodexCrOverrides } from './detectors/codex-cr-override-audit.js';
import { detectBootstrapOverrideAudit } from './detectors/bootstrap-override-audit.js';
import { detectTierMismatch } from './detectors/tier-mismatch.js';
import { detectAllowlistDrift } from './detectors/allowlist-drift.js';
import { detectTrailerScopeMismatch } from './detectors/trailer-scope-mismatch.js';
import { detectPlanWithoutFd } from './detectors/plan-without-fd.js';
import { detectFdWithoutPlan } from './detectors/fd-without-plan.js';
import { linksDriftGaps } from './detectors/code-links-drift.js';
import { detectFdLinkRot } from './detectors/fd-link-rot.js';
import { detectFdCommandRot } from './detectors/fd-command-rot.js';
import { detectMigrationCoverage } from './detectors/migration-coverage.js';
import { detectMilestoneShippedIncomplete } from './detectors/milestone-shipped-incomplete.js';
import { detectCircularBlockedBy } from './detectors/circular-blocked-by.js';
import { detectSkillCodeDrift } from './detectors/skill-code-drift.js';
import { detectArchitectureAdvisories } from './detectors/architecture.js';
import { codeAdapter } from '../sync/adapters/code.js';
import { docsAdapter } from '../sync/adapters/docs.js';
import { testsAdapter } from '../sync/adapters/tests.js';
import { collectTaggedMany, loadCachedAll } from '../sync/projection.js';
import { resolveByGraphAdjacency, resolveByLinksField } from './plan-resolution.js';
import { isStaleGraphGap } from './graph-fd-lookup.js';
import { noldorCliCommand } from '../core/noldor-cli.js';

import type { FeatureFrontmatter } from '../core/feature-schema.js';
import type { ResolvedOwner } from './plan-resolution.js';
import type { RulePairInvariant as Invariant } from '../invariants/rule-pairs.js';
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
import type { CircularBlockedByFinding } from './detectors/circular-blocked-by.js';
import type { SkillDriftFinding } from './detectors/skill-code-drift.js';

// --- Defaults ---
/** Age threshold (in days) for a design artifact with no resolvable owner FD. */
const STALE_DAYS_DEFAULT = 60;
/** Shared with `backlog-demote.ts` so detector + auto-demotion agree on "stale". */
const UNUSED_BACKLOG_DAYS_DEFAULT = STALE_BACKLOG_DAYS_DEFAULT;

/**
 * One stale design-artifact finding — a plan in `docs/design/plans/` or a spec
 * in `docs/design/specs/`. Emitted when the owning feature has shipped
 * (`phase: done`) or (secondary signal) the file is older than the staleness
 * threshold and no owner resolves at all.
 *
 * Plans and specs share this shape: `garden detect` reports them under
 * separate `stalePlans` / `staleSpecs` keys, but a finding carries no kind
 * discriminator — the key it arrives under is the kind.
 */
export interface StaleDesignArtifact {
  readonly path: string;
  readonly slug: string;
  readonly reason: 'feature-done' | 'age-no-feature';
  readonly action: 'archive';
}

/** Result type of {@link detectStalePlans}. Alias of {@link StaleDesignArtifact}. */
export type StalePlan = StaleDesignArtifact;
/** Result type of {@link detectStaleSpecs}. Alias of {@link StaleDesignArtifact}. */
export type StaleSpec = StaleDesignArtifact;

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
 * Everything that differs between plan staleness and spec staleness. The
 * detection policy itself — enumerate, derive a slug, resolve an owner by
 * filename then `links.*` then graph adjacency, then apply phase-and-age
 * policy — lives once in {@link detectStaleDesignArtifacts}.
 */
interface DesignArtifactKind {
  /** `loadDocRoots` key naming the directory the artifacts live in. */
  readonly docRoot: 'plans' | 'specs';
  /** Presentation prefix; ALSO matched verbatim against FDs' `links.*` (see below). */
  readonly relDir: string;
  /** Filename→slug parser; `null` for filenames outside the naming convention. */
  readonly slugFromFilename: (filename: string) => string | null;
  /** FD frontmatter field naming artifacts of this kind (ownership fallback). */
  readonly linkField: 'plan' | 'spec';
  /** Enriched-graph edge for the last-resort adjacency fallback. */
  readonly relation: 'plan-of' | 'spec-of';
}

const PLAN_KIND: DesignArtifactKind = {
  docRoot: 'plans',
  linkField: 'plan',
  relDir: 'docs/design/plans',
  relation: 'plan-of',
  slugFromFilename: planSlugFromFilename,
};

const SPEC_KIND: DesignArtifactKind = {
  docRoot: 'specs',
  linkField: 'spec',
  relDir: 'docs/design/specs',
  relation: 'spec-of',
  slugFromFilename: specSlugFromFilename,
};

/**
 * Shared staleness detection for dated design artifacts.
 *
 * Primary signal: the owning feature MD has `phase: done`. Ownership resolves
 * in three steps, first hit wins — filename slug → `docs/features/<slug>.md`,
 * then the FD whose `links.plan` / `links.spec` names the artifact verbatim
 * (this is what covers attach-path artifacts, whose filename slug matches no
 * FD but whose parent FD still owns them), then the `plan-of` / `spec-of` edge
 * in the enriched `graphify-out/graph.json`. A live owner at any step
 * suppresses the age-out signal; a done owner archives as `feature-done`.
 *
 * Secondary signal: no owner resolves at all AND the file mtime is older than
 * `staleDays`. A missing or stale graph therefore degrades to age-out, never
 * to a wrong-direction block.
 *
 * @param repo - Repository root.
 * @param staleDays - Age threshold in days for the secondary signal.
 * @param kind - Plan/spec differences; see {@link DesignArtifactKind}.
 * @returns One finding per flagged artifact file.
 */
async function detectStaleDesignArtifacts(
  repo: string,
  staleDays: number,
  kind: DesignArtifactKind,
): Promise<StaleDesignArtifact[]> {
  const dir = loadDocRoots(repo)[kind.docRoot];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const ageCutoffMs = Date.now() - staleDays * 24 * 60 * 60 * 1000;
  const findings: StaleDesignArtifact[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) {
      continue;
    }
    const slug = kind.slugFromFilename(entry);
    if (!slug) {
      continue;
    }

    const fullPath = join(dir, entry);
    // Not used for IO. Shown in garden output AND matched verbatim against FDs'
    // links.plan / links.spec by the fallback below — keep the exact
    // '<relDir>/<entry>' forward-slash form.
    const relPath = join(kind.relDir, entry);

    const byFilename = await loadFeatureBySlug(repo, slug);
    const owner: ResolvedOwner | null = byFilename
      ? { slug, fd: byFilename }
      : ((await resolveByLinksField({ docPath: relPath, field: kind.linkField, repo })) ??
        (await resolveByGraphAdjacency({ docPath: relPath, relation: kind.relation, repo })));

    if (owner) {
      if (owner.fd.phase === 'done') {
        findings.push({
          action: 'archive',
          path: relPath,
          reason: 'feature-done',
          slug: owner.slug,
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
 * Detect stale plans in `docs/design/plans/`. Thin caller over
 * {@link detectStaleDesignArtifacts} — see it for the policy.
 *
 * @param repo - Repository root.
 * @param staleDays - Age threshold in days for the secondary signal.
 *   Defaults to {@link STALE_DAYS_DEFAULT}.
 * @returns One StalePlan per flagged plan file.
 */
export async function detectStalePlans(
  repo: string,
  staleDays = STALE_DAYS_DEFAULT,
): Promise<StalePlan[]> {
  return detectStaleDesignArtifacts(repo, staleDays, PLAN_KIND);
}

/**
 * Detect stale specs in `docs/design/specs/`. Thin caller over
 * {@link detectStaleDesignArtifacts} — see it for the policy.
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
  return detectStaleDesignArtifacts(repo, staleDays, SPEC_KIND);
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
 *   list in `src/invariants/rule-pairs.ts`.
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
    sources: ['src/core/feature-schema.ts'],
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
 * Unified output of `pnpm garden:detect` — consumed by the /noldor-garden skill.
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
  readonly circularBlockedBy: readonly CircularBlockedByFinding[];
  readonly skillDrift: readonly SkillDriftFinding[];
  /**
   * Modules the code has that `docs/architecture/modules.md` never names.
   *
   * Its own key rather than an `sddGaps` entry, and deliberately absent from
   * `FINDING_CATEGORIES` in `garden-detect-runner.ts`: that list gates the
   * auto-restamp, and an unstamped garden receipt is a blocking release row, so
   * folding these in would make a renamed directory stop a release. The
   * blocking half of the architecture check reaches `sddGaps` through the SDD
   * report instead.
   */
  readonly architectureAdvisories: readonly SddGap[];
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
 * Resolve `garden.overrideAudit` tuning from `<repo>/.noldor/config.json`.
 * Fail-open: a missing or malformed config yields no expected rules and the
 * detector's built-in threshold (mirrors `resolveGardenScanPaths`) — a config
 * typo must not crash `/noldor-garden` or the release gate-compliance check.
 */
export async function loadOverrideAuditOptions(
  repo: string,
): Promise<{ threshold?: number; expected: readonly ExpectedOverrideRule[] }> {
  try {
    const config = await loadConfig(join(repo, '.noldor', 'config.json'));
    return {
      threshold: config?.garden?.overrideAudit?.threshold,
      expected: config?.garden?.overrideAudit?.expected ?? [],
    };
  } catch {
    return { expected: [] };
  }
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
  const overrideAudit = auditOverrides({ cwd: repo, ...(await loadOverrideAuditOptions(repo)) });
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
    skillDrift,
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
    detectSkillCodeDrift(repo),
  ]);
  const milestoneShippedIncomplete = await detectMilestoneShippedIncomplete(repo);
  const circularBlockedBy = await detectCircularBlockedBy(repo);
  const sddGaps = loadSddGaps(repo);
  // Append tag drift for all three traceability kinds: an FD whose cached
  // links array diverges from what its tag scan would write. Reuses
  // diffProjection so this can never disagree with `sync <kind>-links --check`.
  // One traversal and one FD-parse pass feed all three — the code and tests
  // adapters walk the same tree and differ only in which files they read, and
  // re-parsing every FD once per kind would dominate this pass.
  const adapters = [codeAdapter, testsAdapter, docsAdapter];
  const scans = await collectTaggedMany(adapters, repo);
  const cachedAll = await loadCachedAll(
    loadDocRoots(repo).features,
    adapters.map((a) => a.key),
  );
  // Repo-relative, like every sibling detector's gap text — an absolute path
  // here would leak this machine's checkout prefix into the report.
  sddGaps.push(
    ...linksDriftGaps(scans, cachedAll, adapters, relative(repo, loadDocRoots(repo).features)),
  );

  // FD link targets: stat what every FD's frontmatter points at (code/tests/
  // docs/spec/plan). The 2026-07 audit found 36/50 FDs link-rotted while every
  // validator reported green — shape checks and working-dir scans never stat
  // the link targets themselves.
  sddGaps.push(...(await detectFdLinkRot(repo)));
  // Sibling of the above in the FD-link-rot family: stat the CLI *commands* a
  // done FD documents in its body against the live CLI surface (manifest ∪
  // package.json scripts ∪ script-catalog), catching renamed/removed/regrouped
  // commands a shipped FD still cites.
  sddGaps.push(...(await detectFdCommandRot(repo)));
  // Architecture module advisories are deliberately NOT pushed into sddGaps:
  // that category gates the auto-restamp, so it would make a renamed directory
  // block a release. They ride their own key below. The blocking half arrives
  // through loadSddGaps, since the sdd-report loader runs the same check.
  const architectureAdvisories = await detectArchitectureAdvisories(repo);
  const overrideAudit = auditOverrides({ cwd: repo, ...(await loadOverrideAuditOptions(repo)) });
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
    circularBlockedBy,
    skillDrift,
    architectureAdvisories,
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

/**
 * The stale-graph meta-gaps in a detector run (see `isStaleGraphGap`). Non-empty
 * means `graphify-out/graph.json` lags the newest source file, so every
 * graph-consuming detector contributed nothing to this run.
 *
 * Interactively that degradation is fine — the operator reads the meta-gap and
 * decides. In CI or an autonomous drain nobody reads it, so `--ci` turns it into
 * a non-zero exit rather than a green run with silently-absent detectors.
 */
export function staleGraphGaps(gaps: readonly SddGap[]): readonly SddGap[] {
  return gaps.filter((gap) => isStaleGraphGap(gap));
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('garden-detect');
if (invokedDirect) {
  const gateComplianceMode = process.argv.includes('--gate-compliance');
  // CI mode: findings a human would read and act on interactively become exit-code
  // failures. Today that is exactly the stale-graph meta-gap. Orthogonal to
  // --gate-compliance, whose narrower finding set carries no sddGaps to inspect.
  const ciMode = process.argv.includes('--ci');
  const run = gateComplianceMode ? detectGateCompliance(process.cwd()) : detectAll(process.cwd());
  void run
    .then((findings) => {
      process.stdout.write(`${JSON.stringify(findings)}\n`);
      if (gateComplianceMode && hasBlockingFindings(findings as GateComplianceFindings)) {
        process.exitCode = 1;
      }
      if (ciMode && !gateComplianceMode) {
        // stderr, so --ci never contaminates the JSON report on stdout.
        const stale = staleGraphGaps((findings as GardenFindings).sddGaps);
        for (const gap of stale) {
          console.error(
            `garden detect --ci: graph-consuming detectors ran degraded — ${gap.message}`,
          );
        }
        if (stale.length > 0) {
          console.error(
            'garden detect --ci: regenerate the graph (/graphify + pnpm toon), commit graphify-out/graph.json, then re-run.',
          );
          process.exitCode = 1;
        }
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
