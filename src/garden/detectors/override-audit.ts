import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseTrailers } from '../../core/trailers.js';

/** Repo-relative path of the SDD report — used by the drift filter below. */
const SDD_REPORT_PATH = 'docs/sdd-report.md';

/**
 * Returns true when the commit's changeset is exactly `{docs/sdd-report.md}`.
 * Used to filter "report-update-only" commits out of the override-audit ledger,
 * breaking the self-referential drift loop where each regen lists the previous
 * regen's commit as an override.
 *
 * @param sha - Full commit SHA.
 * @param cwd - Repository root.
 * @returns true iff `git show --name-only <sha>` lists exactly `docs/sdd-report.md`.
 */
export function commitOnlyTouchesReport(sha: string, cwd: string): boolean {
  let raw: string;
  try {
    raw = execFileSync('git', ['show', '--name-only', '--pretty=format:', sha], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return false;
  }
  const files = raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return files.length === 1 && files[0] === SDD_REPORT_PATH;
}

export interface OverrideEntry {
  readonly sha: string;
  readonly reason: string;
  /** True when a configured `garden.overrideAudit.expected` rule matched. */
  readonly expected: boolean;
}

export interface OverrideAuditResult {
  readonly severity: 'OK' | 'INFO' | 'WARN';
  /** Count of UNEXPECTED overrides — the only input to severity. */
  readonly count: number;
  /** Count of overrides absorbed by an `expected` rule (still listed below). */
  readonly expectedCount: number;
  readonly overrides: readonly OverrideEntry[];
}

/**
 * One `garden.overrideAudit.expected` rule (schema-validated by
 * `gardenConfigSchema` in `src/cr/config.ts`; kept structural here so the
 * detector layer has no cr-module import). A rule matches when EVERY field it
 * defines matches: `shaPrefix` as a prefix of the full commit SHA,
 * `reasonIncludes` as a substring of the override reason. `note` is
 * documentation-only.
 */
export interface ExpectedOverrideRule {
  readonly shaPrefix?: string;
  readonly reasonIncludes?: string;
  readonly note: string;
}

/**
 * True when any rule matches `entry`. A rule defining no matching field
 * matches nothing (the config schema forbids that shape; this guard keeps the
 * function safe for hand-built inputs).
 */
export function matchesExpectedOverride(
  entry: { readonly sha: string; readonly reason: string },
  rules: readonly ExpectedOverrideRule[],
): boolean {
  return rules.some((rule) => {
    if (rule.shaPrefix === undefined && rule.reasonIncludes === undefined) return false;
    if (rule.shaPrefix !== undefined && !entry.sha.startsWith(rule.shaPrefix)) return false;
    if (rule.reasonIncludes !== undefined && !entry.reason.includes(rule.reasonIncludes)) {
      return false;
    }
    return true;
  });
}

/**
 * Walk the last N days of git log and count commits that carry the
 * `Noldor-Path-Override:` trailer. Commits with
 * `Noldor-Path: release-automation` are excluded because those are
 * automated commits that never carry an override.
 *
 * @param opts.cwd - Repository root.
 * @param opts.threshold - Override count that triggers WARN (default 3).
 * @param opts.daysBack - How many days of history to walk (default 30).
 * @param opts.expected - Expected-noise rules; matched entries are listed but excluded from severity.
 * @returns Severity, total count, and per-commit details.
 */
export function auditOverrides(opts: {
  cwd: string;
  threshold?: number;
  daysBack?: number;
  /** Declared expected-noise rules (`garden.overrideAudit.expected`). */
  expected?: readonly ExpectedOverrideRule[];
}): OverrideAuditResult {
  const threshold = opts.threshold ?? 3;
  const daysBack = opts.daysBack ?? 30;
  const expectedRules = opts.expected ?? [];
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();

  // Use record separator (\x1e) between commits, NUL between SHA and body
  let raw: string;
  try {
    raw = execFileSync('git', ['log', `--since=${since}`, '--pretty=%H%x00%B%x1e'], {
      cwd: opts.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // No commits or empty repo
    raw = '';
  }

  const overrides: OverrideEntry[] = [];

  for (const block of raw.split('\x1e')) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const nullIdx = trimmed.indexOf('\x00');
    if (nullIdx === -1) continue;

    const sha = trimmed.slice(0, nullIdx).trim();
    const msg = trimmed.slice(nullIdx + 1);

    let trailers: Record<string, string>;
    try {
      trailers = parseTrailers(msg);
    } catch {
      continue;
    }

    // Skip release-automation commits
    if (trailers['Noldor-Path'] === 'release-automation') continue;

    const overrideReason = trailers['Noldor-Path-Override'];
    if (overrideReason && !commitOnlyTouchesReport(sha, opts.cwd)) {
      overrides.push({
        sha,
        reason: overrideReason,
        expected: matchesExpectedOverride({ sha, reason: overrideReason }, expectedRules),
      });
    }
  }

  // Severity from UNEXPECTED entries only — declared noise never pushes the
  // audit to WARN, but any override keeps it INFO-visible (never disappears).
  const unexpectedCount = overrides.filter((o) => !o.expected).length;
  const severity: 'OK' | 'INFO' | 'WARN' =
    unexpectedCount > threshold ? 'WARN' : overrides.length > 0 ? 'INFO' : 'OK';

  return {
    severity,
    count: unexpectedCount,
    expectedCount: overrides.length - unexpectedCount,
    overrides,
  };
}

/**
 * Phase bucket for {@link OverrideTrailerAuditResult}.
 *
 * - `artifact` — Step 2.5 spec/plan-artifact overrides (trailer suffix `-Artifact`).
 * - `code` — Step 4 release-stage code-review overrides (plain `Noldor-CR-Override-<Lane>`).
 * - `autonomous` — Autonomous test-red overrides (`Noldor-Autonomous-Override`).
 */
export type OverridePhase = 'artifact' | 'code' | 'autonomous';

/**
 * Per-phase, per-lane counts plus a flat total.
 *
 * Lane keys are the lowercase suffix of the trailer (e.g. `codex`, `subagent`,
 * `standalone`, `manual`) for `artifact`/`code` phases, and the fixed string
 * `autonomous` for the `autonomous` phase.
 */
export interface OverrideTrailerAuditResult {
  readonly total: number;
  readonly byPhase: Partial<Record<OverridePhase, Partial<Record<string, number>>>>;
}

/**
 * Classify a trailer key into (phase, lane).
 *
 * - `Noldor-CR-Override-<Lane>-Artifact` → `artifact` / `<lane>`
 * - `Noldor-CR-Override-<Lane>`          → `code` / `<lane>`
 * - `Noldor-Autonomous-Override`         → `autonomous` / `autonomous`
 *
 * Returns `null` for any other trailer.
 *
 * @param trailer - Raw trailer key (e.g. `Noldor-CR-Override-Codex-Artifact`).
 * @returns Phase + lane, or `null` when the trailer is not an override marker.
 */
function classifyOverrideTrailer(trailer: string): { phase: OverridePhase; lane: string } | null {
  const artifactMatch = trailer.match(/^Noldor-CR-Override-(\w+)-Artifact$/);
  if (artifactMatch) return { phase: 'artifact', lane: artifactMatch[1]!.toLowerCase() };
  const codeMatch = trailer.match(/^Noldor-CR-Override-(\w+)$/);
  if (codeMatch) return { phase: 'code', lane: codeMatch[1]!.toLowerCase() };
  if (trailer === 'Noldor-Autonomous-Override') {
    return { phase: 'autonomous', lane: 'autonomous' };
  }
  return null;
}

/**
 * Audit a list of commits for CR-override trailers, grouped by phase.
 *
 * This is the trailer-array counterpart to {@link auditOverrides} (which walks
 * `git log` for `Noldor-Path-Override`). It powers the multi-reviewer CR-gate
 * stats: each commit may carry zero or more `Noldor-CR-Override-<Lane>` /
 * `-Artifact` / `Noldor-Autonomous-Override` trailers; this function returns
 * total count plus per-phase / per-lane breakdown.
 *
 * @param commits - Commits with parsed trailer maps.
 * @returns Total count and `byPhase[phase][lane]` counts.
 */
export function auditOverrideTrailers(
  commits: ReadonlyArray<{ trailers?: Record<string, string> }>,
): OverrideTrailerAuditResult {
  const byPhase: { [P in OverridePhase]?: { [lane: string]: number } } = {};
  let total = 0;

  for (const c of commits) {
    const trailers = c.trailers;
    if (!trailers) continue;
    for (const trailer of Object.keys(trailers)) {
      const cls = classifyOverrideTrailer(trailer);
      if (!cls) continue;
      total++;
      const bucket = (byPhase[cls.phase] = byPhase[cls.phase] ?? {});
      bucket[cls.lane] = (bucket[cls.lane] ?? 0) + 1;
    }
  }

  return { total, byPhase };
}

export interface ReleasePushEntry {
  readonly iso: string;
  readonly sha: string;
  readonly version: string;
  /**
   * True when the receipt's SHA does NOT resolve to a canonical release-shaped
   * commit (see {@link commitIsReleaseShaped}) — an env-var-bypass receipt was
   * written but the commit's tree shape doesn't match a real release. A single
   * suspicious entry downgrades the whole audit to WARN.
   */
  readonly suspicious: boolean;
}

export interface ReleasePushAuditResult {
  readonly severity: 'OK' | 'INFO' | 'WARN';
  readonly count: number;
  readonly entries: readonly ReleasePushEntry[];
}

const RECEIPT_LINE_RE = /^(\S+)\s+([0-9a-f]+)\s+(\S+)$/i;

/** The two files every canonical release commit must touch. */
const RELEASE_SHAPE_FILES = ['package.json', 'docs/release-notes.md'] as const;

/**
 * Cross-check a receipt SHA against the canonical release-commit signature: the
 * commit's changeset must include BOTH `package.json` (version bump) and
 * `docs/release-notes.md` (release entry). A SHA that doesn't resolve — bad ref,
 * not a git repo — is treated as NOT release-shaped (can't be confirmed, so
 * suspicious).
 *
 * @param sha - Receipt SHA (full or abbreviated).
 * @param cwd - Repository root.
 * @returns true iff `git show --name-only <sha>` lists both release-shape files.
 */
export function commitIsReleaseShaped(sha: string, cwd: string): boolean {
  let raw: string;
  try {
    raw = execFileSync('git', ['show', '--name-only', '--pretty=format:', sha], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return false;
  }
  const files = new Set(
    raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  return RELEASE_SHAPE_FILES.every((f) => files.has(f));
}

/**
 * Parse `.noldor/release-pushes.log` and surface release-push overrides, cross-
 * checking each receipt SHA against the canonical release-commit signature.
 *
 * @param opts.cwd - Repository root.
 * @returns Severity (OK absent, INFO when every entry matches a release-shaped
 *   commit, WARN when the log is malformed OR any receipt is suspicious), count,
 *   and per-entry `suspicious` flags.
 */
export function auditReleasePushes(opts: { cwd: string }): ReleasePushAuditResult {
  const path = join(opts.cwd, '.noldor', 'release-pushes.log');
  if (!existsSync(path)) {
    return { severity: 'OK', count: 0, entries: [] };
  }
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const entries: ReleasePushEntry[] = [];
  let malformed = false;
  for (const line of lines) {
    const m = line.match(RECEIPT_LINE_RE);
    if (!m) {
      malformed = true;
      continue;
    }
    const sha = m[2];
    entries.push({
      iso: m[1],
      sha,
      version: m[3],
      suspicious: !commitIsReleaseShaped(sha, opts.cwd),
    });
  }

  const anySuspicious = entries.some((e) => e.suspicious);
  const severity: 'OK' | 'INFO' | 'WARN' =
    malformed || anySuspicious ? 'WARN' : entries.length > 0 ? 'INFO' : 'OK';
  return { severity, count: entries.length, entries };
}
