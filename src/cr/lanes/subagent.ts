import { join } from 'node:path';
import { discoverChangedFiles } from '../../core/branch-added.js';
import { renderBrief, unionResults } from '../../rules/brief.js';
import { runResolve } from '../../rules/cli-cores.js';
import { writeJsonAtomic } from '../atomic-write.js';
import type { Finding, LaneFindings } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { readFdSummary } from '../read-fd-summary.js';
import { splitClassTag } from '../finding-class.js';
import { extractLocations } from '../locations.js';
import { isNeverBlockingMessage } from '../blocking-definition.js';
import type { LaneAnswer } from '../lane-answer.js';
import {
  dispatchSubagent,
  type ReviewerAnswer,
  type ReviewerFinding,
} from './subagent-dispatch.js';

/**
 * The files the round's range changed — the confinement boundary and basename
 * resolver for {@link extractLocations}.
 *
 * Deliberately NOT reused from {@link resolveBindingRules} below, which returns
 * at its first line for every `kind !== 'code'`: rules are code-only, locations
 * are not, and folding the two would leave spec and plan reviews with no set to
 * match against at all.
 *
 * Best-effort — a git failure yields `[]`, which costs locations for the round
 * and nothing else. Turning a review into a lane error over a git hiccup is the
 * one outcome worth avoiding here.
 */
export function resolveChangedFiles(opts: {
  repoRoot: string;
  base: string;
  head: string;
}): string[] {
  try {
    return discoverChangedFiles({ cwd: opts.repoRoot, base: opts.base, head: opts.head });
  } catch {
    return [];
  }
}

/**
 * Pre-render the cascade rules that BIND the changed files, for the reviewer
 * prompt. `undefined` (field omitted) whenever there is nothing binding to say.
 *
 * `--kind code` only: a spec or plan artifact has no source files to resolve
 * rules against. Best-effort — a git failure here must not turn a review into a
 * lane error, so it degrades to no rules section rather than throwing.
 *
 * The empty check is on the resolved bucket, never on `renderBrief`'s output:
 * that function returns an explanatory "no rules match" line by contract, so an
 * emptiness test on the string would ship that line into every prompt.
 */
function resolveBindingRules(input: LaneInput, baseSha: string): string | undefined {
  if (input.kind !== 'code') return undefined;
  let files: string[];
  try {
    files = discoverChangedFiles({
      cwd: input.repoRoot,
      base: baseSha,
      head: input.artifactSha,
    });
  } catch {
    return undefined;
  }
  if (files.length === 0) return undefined;
  // Keep only the files that actually carry a binding rule. A feature diff is
  // mostly docs, fixtures and state files that no `**/*.ts` rule can match, and
  // naming all of them in the header would spend prompt tokens implying the
  // rules govern paths they do not.
  const binding = files
    .map((file) => ({ file, resolved: runResolve(input.repoRoot, { file, stage: 'code' }) }))
    .filter(({ resolved }) => resolved.enforce.length > 0);
  if (binding.length === 0) return undefined;
  const { enforce } = unionResults(binding.map(({ resolved }) => resolved));
  return renderBrief(
    { enforce, injected: [] },
    { files: binding.map(({ file }) => file), stage: 'code', enforceOnly: true },
  );
}

/**
 * The finding with a leftover `[mechanical]` / `[design]` message prefix lifted into `class`.
 * A model trained on the old bucket format may still tag the message; the tag is moved into
 * the field instead of staying in the text, and an explicit `class` field wins.
 */
export function normalizeFinding(f: ReviewerFinding): ReviewerFinding {
  const tagged = splitClassTag(f.message);
  const cls = f.class ?? tagged.class;
  return { ...f, message: tagged.message, ...(cls ? { class: cls } : {}) };
}

/**
 * Whether a reviewer finding actually blocks: the reviewer said so, it is not `minor`, and it
 * is not marked `maybe:` or `unverified:`. The never-blocks classes are enforced here, not only
 * requested in the prompt, so a model that flags an unverified claim blocking cannot red the
 * round on it (Q-0250).
 */
export function isEffectivelyBlocking(f: ReviewerFinding): boolean {
  return f.blocking && f.severity !== 'minor' && !isNeverBlockingMessage(f.message);
}

/**
 * Reviewer finding → sink {@link Finding}, curried on the artifact label and the round's
 * changed files. A blocker maps critical→high and important→med; a suggestion maps
 * critical or important→med and minor→low. `file` keeps its meaning — the artifact LABEL,
 * not a location — because `fingerprintBlockers` hashes it.
 */
export const toSinkFinding =
  (artifact: string, changedFiles: readonly string[]) =>
  (f: ReviewerFinding): Finding => {
    const severity: Finding['severity'] = isEffectivelyBlocking(f)
      ? f.severity === 'critical'
        ? 'high'
        : 'med'
      : f.severity === 'minor'
        ? 'low'
        : 'med';
    const locations = extractLocations(f.message, changedFiles);
    return {
      file: artifact,
      severity,
      message: f.message,
      ...(f.class ? { class: f.class } : {}),
      ...(locations.length > 0 ? { locations } : {}),
    };
  };

export async function runSubagent(input: LaneInput): Promise<LaneResult> {
  const sinkPath = join(
    input.repoRoot,
    '.noldor',
    'cr',
    `${input.slug}-${input.kind}-reviewer.json`,
  );
  const startedAt = new Date().toISOString();
  // Two shas, two jobs. The PROMPT range honors `fullReview` — equal shas select
  // buildPrompt's "review the whole artifact" branch (before this, the
  // fullReviewOverride path deleted baseSha, the flag was ignored, and the
  // whole-artifact intent never reached the reviewer). RULES resolution keeps
  // the real change base: `git diff <head> <head>` names no files, which would
  // silently drop the binding-rules section from every code-kind full review.
  const rulesBaseSha = input.baseSha ?? `${input.artifactSha}~1`;
  const promptBaseSha = input.fullReview ? input.artifactSha : rulesBaseSha;
  // Resolved here, beside `rulesBaseSha`, so the two error paths below (dispatch
  // failure, parse failure) are unaffected — those write findings with no
  // location, which is correct.
  const changedFiles = resolveChangedFiles({
    repoRoot: input.repoRoot,
    base: rulesBaseSha,
    head: input.artifactSha,
  });

  let answer: LaneAnswer<ReviewerAnswer>;
  try {
    // Fast-track ships no FD, so a missing FD file is a legitimate state
    // (drain-mode code review), not an error — review the diff without the
    // summary context. A present-but-malformed FD still errors below.
    const fdSummary = await readFdSummary(input.fdPath).catch((err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT')
        return '(no FD — fast-track change; review the diff on its own merits)';
      throw err;
    });
    const rulesBrief = resolveBindingRules(input, rulesBaseSha);
    answer = await dispatchSubagent(
      {
        artifact: input.artifact,
        fdSummary,
        baseSha: promptBaseSha,
        headSha: input.artifactSha,
        description: `${input.kind} for FD ${input.slug}`,
        ...(input.reviewProfile ? { reviewProfile: input.reviewProfile } : {}),
        ...(rulesBrief !== undefined ? { rulesBrief } : {}),
        ...(input.priorReview !== undefined ? { priorReview: input.priorReview } : {}),
        ...(input.dispatchTimeoutMs !== undefined ? { timeoutMs: input.dispatchTimeoutMs } : {}),
      },
      input,
    );
  } catch (err) {
    const errMsg = (err as NodeJS.ErrnoException).message ?? String(err);
    const payload: LaneFindings = {
      lane: 'reviewer',
      artifact: input.artifact,
      kind: input.kind,
      slug: input.slug,
      blockers: [
        {
          severity: 'high',
          file: input.artifact,
          message: `subagent lane errored: ${errMsg}`,
        },
      ],
      suggestions: [],
      summary: 'subagent error',
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(sinkPath, payload);
    return { lane: 'reviewer', sinkPath, ok: false };
  }

  if (!answer.ok) {
    const payload: LaneFindings = {
      lane: 'reviewer',
      artifact: input.artifact,
      kind: input.kind,
      slug: input.slug,
      blockers: [
        {
          severity: 'high',
          file: input.artifact,
          message: `reviewer returned no trustworthy answer: ${answer.detail}`,
        },
      ],
      suggestions: [],
      summary: 'subagent parse error',
      notes: answer.notes,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(sinkPath, payload);
    return { lane: 'reviewer', sinkPath, ok: false };
  }

  // Blocking is the reviewer's per-finding call, with the never-blocks classes enforced by
  // `isEffectivelyBlocking`. The summary is derived from the same value `ok` reads, so the
  // sink can no longer say "approve" over a red round (Q-0250).
  const findings = answer.answer.findings.map(normalizeFinding);
  const toSink = toSinkFinding(input.artifact, changedFiles);
  const blockers = findings.filter(isEffectivelyBlocking).map(toSink);
  const suggestions = findings.filter((f) => !isEffectivelyBlocking(f)).map(toSink);
  const payload: LaneFindings = {
    lane: 'reviewer',
    artifact: input.artifact,
    kind: input.kind,
    slug: input.slug,
    blockers,
    suggestions,
    summary: blockers.length === 0 ? 'approve' : `blockers found (${blockers.length})`,
    notes: [
      `Assessment: ${answer.answer.assessment}`,
      `Strengths: ${answer.answer.strengths}`,
      ...answer.notes,
    ],
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(input.baseSha ? { baseSha: input.baseSha } : {}),
    ...(input.fullReview ? { fullReview: true } : {}),
  };

  await writeJsonAtomic(sinkPath, payload);
  return { lane: 'reviewer', sinkPath, ok: blockers.length === 0 };
}
