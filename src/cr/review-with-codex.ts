import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REV_RE, type ArtifactReview } from './cli-args.js';
import type { Spawn } from './codex-adapter.js';
import { buildContext } from './context.js';
import { runCodex, type ReviewCtx } from './run-codex.js';
import type { CrRecord } from './sidecar.js';

export interface OutFinding {
  file: string;
  message: string;
  severity: 'high' | 'med' | 'low';
  line?: number;
  suggestion?: string;
}

export interface ReviewOutput {
  summary: string;
  findings: OutFinding[];
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
  opts: { timeoutMs?: number } = {},
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
    const featureMd = review.slug
      ? readIfExists(cwd, `docs/features/${review.slug}.md`)
      : readFeatureMd(cwd);

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
    } else {
      const artifact =
        review.baseSha && !review.fullReview
          ? sh(cwd, ['diff', `${review.baseSha}..HEAD`, '--', review.artifact])
          : readIfExists(cwd, review.artifact);
      ctx = { kind: review.kind, artifact, featureMd, rules };
    }

    const record = await runCodex({
      ctx,
      spawn,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    return {
      summary: record.summary || '(no summary provided)',
      findings: toFindings(record, review.artifact),
    };
  } catch (e) {
    const message = `${review.kind} review failed: ${(e as Error).message}`;
    return { summary: message, findings: [{ file: review.artifact, message, severity: 'high' }] };
  }
}

/**
 * Map a codex {@link CrRecord} to the orchestrate lane's `Finding[]` shape.
 * Blockers always become `severity: 'high'` (the lane reclassifies high-severity
 * findings as blockers); suggestions are pinned non-high so they stay
 * suggestions. The codex schema uses `medium`; the lane schema uses `med`.
 */
export function toFindings(record: CrRecord, fallbackFile: string): OutFinding[] {
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
    return o;
  };
  return [
    ...record.blockers.map((b) => map(b, 'high')),
    ...record.suggestions.map((s) => map(s, s.severity == null ? 'low' : 'med')),
  ];
}

export function readFeatureMd(cwd: string): string {
  const session = readSession(cwd);
  const slug = session?.parent ?? session?.slug;
  if (!slug) return '';
  return readIfExists(cwd, `docs/features/${slug}.md`);
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

export function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}
