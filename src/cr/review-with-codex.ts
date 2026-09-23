import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REV_RE, type ArtifactReview } from './cli-args.js';
import type { Spawn } from './codex-adapter.js';
import { buildContext } from './context.js';
import { runCodex, type ReviewCtx } from './run-codex.js';
import type { CrRecord } from './sidecar.js';
import { isNeverBlockingMessage, isSpecBlockingBasis } from './blocking-definition.js';
import type { SpecBlockingBasis } from './finding-class.js';
import type { ArtifactKind } from './findings-schema.js';
import type { PriorReview } from './lane-types.js';
import { readFdSummary } from './read-fd-summary.js';
import { isLaneFailureBlocker, laneFailureFile } from './re-round.js';

export interface OutFinding {
  file: string;
  message: string;
  severity: 'high' | 'med' | 'low';
  line?: number;
  suggestion?: string;
  /** A spec finding's basis (Q-0263), carried into the lane's sink at kind `spec` only. */
  basis?: SpecBlockingBasis;
}

export interface ReviewOutput {
  summary: string;
  findings: OutFinding[];
  /** Codex's answers about the prior blockers it was shown (Q-0260); [] on a first round. */
  prior: CrRecord['prior'];
}

/**
 * Run one codex review and return `{ summary, findings }`.
 *
 * Shared by the `cr codex` CLI (which prints this as JSON) and the orchestrate codex lane
 * (which maps it straight into `LaneFindings`). The lane used to reach this code by shelling
 * out to the CLI through `pnpm`, which is what put three processes between the timeout and
 * the process it was meant to cap.
 *
 * Plan/spec read the artifact (or its diff since `--base-sha`) and get the plan-review
 * heuristics; code builds a git-diff context the same way the gate lane does and gets the
 * code-review prompt — `--kind code` used to fall through to `--plan`, so codex judged
 * TypeScript against plan heuristics (Q-0099).
 *
 * Never throws: a bad `--base-sha` or an unreadable artifact becomes a synthetic blocker.
 * Both callers depend on that — the CLI promises findings travel via stdout rather than the
 * exit code, and the lane treats a thrown error as infrastructure failure rather than review
 * output.
 */
export async function reviewWithCodex(
  review: ArtifactReview,
  cwd: string,
  spawn: Spawn,
  opts: { timeoutMs?: number; prior?: PriorReview } = {},
): Promise<ReviewOutput> {
  try {
    // Validate BEFORE any value reaches a git argv. This is the shared chokepoint: the CLI
    // parses `--base-sha` and the orchestrate lane builds its descriptor directly, so guarding
    // only the parser would leave the lane path — the one that actually carries a caller-supplied
    // sha now that the always-false capability probe is gone — unguarded.
    if (review.baseSha !== undefined && !REV_RE.test(review.baseSha)) {
      throw new Error(`invalid baseSha: ${review.baseSha}`);
    }
    const rules = readRules(cwd);
    const fdRel = review.slug ? `docs/features/${review.slug}.md` : featureMdPath(cwd);
    // At kind spec the FD past its Summary is scaffold stubs written after the spec on purpose,
    // so codex gets the Summary alone — the FD context the reviewer lane already gets (Q-0263).
    const featureMd =
      fdRel === undefined
        ? ''
        : review.kind === 'spec'
          ? await readSpecFdSummary(cwd, fdRel)
          : readIfExists(cwd, fdRel);

    let ctx: ReviewCtx;
    if (review.kind === 'code') {
      ctx = buildContext({
        lane:
          review.baseSha && !review.fullReview
            ? { kind: 'range', from: review.baseSha, to: 'HEAD' }
            : { kind: 'gate' },
        runGit: (args) => sh(cwd, args),
        featureMd,
        rules,
      });
      if (opts.prior !== undefined) ctx = { ...ctx, prior: opts.prior };
    } else {
      const artifact =
        review.baseSha && !review.fullReview
          ? sh(cwd, ['diff', `${review.baseSha}..HEAD`, '--', review.artifact])
          : readIfExists(cwd, review.artifact);
      ctx = {
        kind: review.kind,
        artifact,
        featureMd,
        rules,
        ...(opts.prior !== undefined ? { prior: opts.prior } : {}),
      };
    }

    const record = await runCodex({
      ctx,
      spawn,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    return {
      summary: record.summary || '(no summary provided)',
      findings: toFindings(record, review.artifact, review.kind),
      prior: record.prior,
    };
  } catch (e) {
    const message = `${review.kind} review failed: ${(e as Error).message}`;
    return {
      summary: message,
      findings: [{ file: laneFailureFile('codex'), message, severity: 'high' }],
      prior: [],
    };
  }
}

/**
 * Map a codex {@link CrRecord} to the orchestrate lane's `Finding[]` shape.
 * Blockers always become `severity: 'high'` (the lane reclassifies high-severity
 * findings as blockers); suggestions are pinned non-high so they stay
 * suggestions. The codex schema uses `medium`; the lane schema uses `med`.
 */
export function toFindings(
  record: CrRecord,
  fallbackFile: string,
  kind: ArtifactKind,
): OutFinding[] {
  const spec = kind === 'spec';
  const map = (f: CrRecord['blockers'][number], severity: OutFinding['severity']): OutFinding => {
    // Document-level findings may carry an empty `file`; the consumer's
    // findings-schema requires a non-empty string, so fall back to the artifact.
    const o: OutFinding = {
      file: f.file || fallbackFile,
      message: f.message || '(no message provided)',
      severity,
    };
    if (f.line != null) o.line = f.line;
    if (f.suggestion != null) o.suggestion = f.suggestion;
    if (spec && isSpecBlockingBasis(f.basis)) o.basis = f.basis;
    return o;
  };
  // A codex blocker marked `maybe:` or `unverified:` never blocks (Q-0250), and at kind spec
  // one with no basis never blocks either (Q-0263): demote both rather than trusting the prompt
  // alone. A blocker about codex's own failure is not a finding about the spec, so no missing
  // basis demotes it — a review that failed must still red its round.
  const blocks = (b: CrRecord['blockers'][number]): boolean =>
    !isNeverBlockingMessage(b.message) &&
    (!spec ||
      isSpecBlockingBasis(b.basis) ||
      isLaneFailureBlocker({ file: b.file || fallbackFile }));
  return [
    ...record.blockers.map((b) => map(b, blocks(b) ? 'high' : 'med')),
    ...record.suggestions.map((s) => map(s, s.severity == null ? 'low' : 'med')),
  ];
}

/** The session FD's repo-relative path (the parent's on an attach session), if any. */
function featureMdPath(cwd: string): string | undefined {
  const session = readSession(cwd);
  const slug = session?.parent ?? session?.slug;
  return slug ? `docs/features/${slug}.md` : undefined;
}

export function readFeatureMd(cwd: string): string {
  const rel = featureMdPath(cwd);
  return rel === undefined ? '' : readIfExists(cwd, rel);
}

/** A spec review's FD context: the Summary. A missing FD is empty; one with no Summary throws. */
async function readSpecFdSummary(cwd: string, rel: string): Promise<string> {
  const p = join(cwd, rel);
  return existsSync(p) ? readFdSummary(p) : '';
}

function readSession(cwd: string): { parent?: string; slug?: string } | null {
  try {
    return JSON.parse(readFileSync(join(cwd, '.noldor', 'session.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function readIfExists(cwd: string, rel: string): string {
  const p = join(cwd, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

/**
 * Read the engineering-rules context for a codex review, falling back to
 * `AGENTS.md` when `.claude/engineering-rules.md` is absent. A codex-only
 * consumer tree carries `AGENTS.md` (the native rules file for the codex /
 * opencode runners) but no `.claude/` subtree, so without this fallback the
 * codex CR lane silently reviews with empty rules context. An empty
 * engineering-rules file also falls through (empty rules == no rules).
 */
export function readRules(cwd: string): string {
  return readIfExists(cwd, '.claude/engineering-rules.md') || readIfExists(cwd, 'AGENTS.md');
}

/**
 * Git seam for the codex lane.
 *
 * `maxBuffer` is explicit because Node's default is 1MB and this helper reads
 * whole diffs: a branch carrying a regenerated graph, a lockfile, or any large
 * generated artifact overruns it, and `execFileSync` then fails with ENOBUFS.
 * The lane converts that into a blocking `code review failed: spawnSync git
 * ENOBUFS` finding — so a diff being big reads as the code being bad, on a lane
 * that is mandatory for M/L/XL sessions. 64MB matches every other git read in
 * the repo (`metrics/facts.ts`, `dashboard/data.ts`, `ui-design-freshness.ts`).
 */
export function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
