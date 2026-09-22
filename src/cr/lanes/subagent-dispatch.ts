import { z } from 'zod';
import { BLOCKING_DEFINITION } from '../blocking-definition.js';
import { FINDING_CLASSES } from '../finding-class.js';
import type { LaneAnswerContract, RepairContext } from '../lane-answer.js';
import { createAnswerSeam } from '../lane-spawn.js';
import { DEFAULT_REVIEW_PROFILES } from '../../core/review-profile.js';
import type { ReviewDimension, ReviewEffort, ReviewProfile } from '../../core/review-profile.js';
import type { PriorReview } from '../lane-types.js';

export interface DispatchInput {
  artifact: string;
  fdSummary: string;
  baseSha: string;
  headSha: string;
  description: string;
  reviewProfile?: ReviewProfile;
  /**
   * The prior round's blockers plus the framing mode, resolved by orchestrate
   * from the lane's previous sink. Omitted on first rounds and green priors —
   * and the omission must leave the prompt byte-identical to the pre-context
   * output (same contract as {@link rulesBrief}).
   */
  priorReview?: PriorReview;
  /**
   * Pre-rendered text of the cascade rules that BIND the files under review —
   * `renderBrief(..., { enforceOnly: true })`, resolved by the caller because
   * that is where git access lives (same arrangement as {@link fdSummary}).
   *
   * Omitted when the resolved enforce bucket is empty. The caller decides that
   * from the buckets, never by testing this string: `renderBrief` returns an
   * explanatory "no rules match" line rather than empty output, so an
   * emptiness test here would ship exactly the paragraph the omission avoids.
   */
  rulesBrief?: string;
  /** Wall-clock cap; {@link DEFAULT_DISPATCH_TIMEOUT_MS} when the caller omits it. */
  timeoutMs?: number;
}

const DIMENSION_GUIDE: Record<ReviewDimension, string> = {
  // Keeps its race clause on purpose: `concurrency` below goes deeper, but is
  // absent from scoped profiles like `fast-track`, so dropping the clause here
  // would leave those lanes with no race coverage at all.
  correctness:
    'logic errors, off-by-one, null/undefined, race conditions, wrong API usage, unhandled error paths',
  security: 'injection, path traversal, unsafe shell/exec, secret leakage, unvalidated input',
  reuse: 'duplicated logic an existing helper already covers; missed single-source-of-truth',
  // Concrete tells, and a trailing override of the `low` nit suppression below.
  // The override rides the dimension, not EFFORT_GUIDE, so profiles that omit
  // this dimension are never invited to report against it. See the
  // `fast-track` docblock in `review-profile.ts` for why the lane needs it.
  simplification:
    'a materially shorter equivalent exists; a fn doing several things that should be one; an abstraction with a single call site; a wrapper adding no behavior; a flag or option nobody sets; dead branches; needless indirection. A simpler equivalent you can name concretely is actionable at any effort, not a speculative nit',
  efficiency: 'avoidable O(n^2), redundant IO/subprocess, repeated reads, sync work in a loop',
  altitude: 'wrong layer/abstraction, leaky boundaries, responsibility in the wrong module',
  concurrency:
    'races and interleavings, non-atomic read-modify-write, unheld/leaked locks, stale PID or liveness checks, contention over a shared dir or port',
  effects:
    'hidden side effects in an ostensibly pure fn, unflushed or non-atomic writes, mutation of a caller-owned arg, effects fired on a path that should be read-only or dry-run',
};

const EFFORT_GUIDE: Record<ReviewEffort, string> = {
  low: 'Report only high-confidence, clearly-actionable findings. Skip speculative nits.',
  med: 'Report confident findings across the dimensions; a few well-justified maybes allowed.',
  high: 'Broaden coverage; include lower-confidence findings, each prefixed `maybe:`.',
  max: 'Be exhaustive; surface every plausible concern, prefixing uncertain ones `maybe:`.',
};

// Dimensions whose findings a `noldor:cut` marker can wave off. A marked cut is
// deliberate minimalism, so it silences minimalism-class complaints only —
// correctness/security/concurrency/effects findings are never marker-exempt (a
// cut hiding a bug is not a respected cut). The clause is prompt-level rather
// than riding one dimension because a cut lands against any ladder rung: the
// canonical example ("linear scan, fine ≤1k rules") is an efficiency cut that a
// simplification-only clause would leave flaggable.
// noldor:cut hand-listed subset, fails safe (an unlisted new dimension is
// never-exempt, the stricter side) — derive from schema metadata if the
// dimension set grows a second minimalism-class member worth classifying.
const CUT_MARKER_DIMENSIONS: ReadonlySet<ReviewDimension> = new Set([
  'reuse',
  'simplification',
  'efficiency',
  'altitude',
]);

// The grammar and the guide live in `src/core/structural-context-contract.ts`
// beside the bare `CUT_MARKER` token, so the contract has one definition rather
// than one per consumer. Re-exported because this module's test and the
// fast-track profile test both pin the reviewer half against the rule store.
import { CUT_MARKER_GUIDE } from '../../core/structural-context-contract.js';
export { CUT_MARKER_TOKEN } from '../../core/structural-context-contract.js';

/** Most prior blockers a prompt renders; the rest collapse to a count line. */
const PRIOR_BLOCKER_CAP = 20;
/** Per-message bound in `fixes-in-diff` mode, where nothing asks for verbatim re-raise. */
const PRIOR_MESSAGE_MAX_CHARS = 300;

// `reexamine` must NOT truncate: its clause asks for identical re-raise, so the
// renderer cannot mangle what it asks to be preserved. Bounded in practice by
// the single-line reviewer-sink messages (line-based parser) and the cap above.
const PRIOR_MODE_CLAUSE: Record<PriorReview['mode'], string> = {
  'fixes-in-diff':
    'The diff under review contains the fixes. Do not re-raise a blocker the diff resolves. ' +
    'Before flagging anything that overlaps these, verify against the current content — never ' +
    'propose a change the content already implements or falsifies. Adjudicated decisions are ' +
    'settled unless the diff regresses them; regressions and genuinely new issues remain fully in scope.',
  reexamine:
    'Do not assume any of these blockers were addressed. Re-examine each against the current ' +
    'content: re-raise every one that still stands, keeping its message text identical to the ' +
    "listing above so the finding's identity stays stable across rounds; drop only those the " +
    'content genuinely resolves; new findings remain fully in scope.',
};

function renderPriorReview(prior: PriorReview): string {
  const capped = prior.blockers.slice(0, PRIOR_BLOCKER_CAP);
  const bullets = capped
    .map((b) => {
      const oneLine = b.message.replace(/\s*\n\s*/g, ' ');
      const msg =
        prior.mode === 'fixes-in-diff' ? oneLine.slice(0, PRIOR_MESSAGE_MAX_CHARS) : oneLine;
      return `- [${b.severity}]${b.class ? `[${b.class}]` : ''} ${msg}`;
    })
    .join('\n');
  const overflow = prior.blockers.length - capped.length;
  const overflowLine = overflow > 0 ? `\n…and ${overflow} more prior blockers` : '';
  return (
    `\nPrior review round — the previous reviewer pass over this artifact raised the blockers below.\n` +
    `${bullets}${overflowLine}\n\n${PRIOR_MODE_CLAUSE[prior.mode]}\n`
  );
}

/**
 * The reviewer child is spawned by the answer seam below through the agent-runner registry
 * (claude unless the consumer's agents config remaps the role), so it works from any agent
 * harness (gate skill, bare CLI, CI runner).
 *
 * The prompt instructs the agent to act as a senior code reviewer against the artifact path.
 * Its answer is one JSON object in the lane's answer file ({@link REVIEWER_ANSWER}), with a
 * per-finding `blocking` flag under {@link BLOCKING_DEFINITION}. Every runner qualifies:
 * agent-writes runners write the file, codex's CLI writes its final message there.
 */
export function buildPrompt(input: DispatchInput): string {
  const profile = input.reviewProfile ?? DEFAULT_REVIEW_PROFILES.default;
  const dimensionLines = profile.dimensions.map((d) => `- ${d}: ${DIMENSION_GUIDE[d]}`).join('\n');
  const cutMarkerGuide = profile.dimensions.some((d) => CUT_MARKER_DIMENSIONS.has(d))
    ? CUT_MARKER_GUIDE
    : '';
  // The author is told to read these before writing (`rules brief`); handing the
  // reviewer the same text is what makes the enforce bucket more than a
  // suggestion — a violation is caught here even when the brief was skipped.
  const rulesSection =
    input.rulesBrief === undefined
      ? ''
      : `\nBinding rules for the files under review — a violation of any of these is a finding, ` +
        `reported under the dimension it belongs to (they are repo policy, not preference):\n\n${input.rulesBrief}\n`;
  const priorSection = input.priorReview === undefined ? '' : renderPriorReview(input.priorReview);
  return `You are a Senior Code Reviewer. Review the markdown artifact at \`${input.artifact}\` (description: ${input.description}).

FD summary context:
${input.fdSummary}
${rulesSection}${priorSection}
Range under review: ${input.baseSha}..${input.headSha}. If they differ, review only the diff; if equal, review the whole artifact.

Review along these dimensions only — do not flag concerns outside them:
${dimensionLines}
${cutMarkerGuide}
Effort: ${profile.effort}. ${EFFORT_GUIDE[profile.effort]}

Verify-before-flag protocol: before flagging a critical finding that claims a command, validator, or test will fail (e.g. \`pnpm validate:features\`, \`pnpm typecheck\`, \`pnpm test\`), run that exact command first and quote its actual error output in the message. If the command passes, or you cannot run it, prefix the message \`unverified:\` — an unverified finding never blocks.

${BLOCKING_DEFINITION}

Classify every blocking finding with "class":
- "mechanical" — the fix is determined by the finding itself: a missing required section, an unanswered open question, a lint-class defect, a stated contract not met. Someone applying your finding needs no judgment call beyond what you wrote.
- "design" — the fix requires a judgment call you are NOT making for them: disagreement about an approach, a default, a trade-off, or anything where two reasonable fixes exist and picking between them is the author's call.

Classify by what the FIX needs, not by how severe the finding is. When in doubt, use "design" — a design-classed blocker is routed to a human, which is always safe.

In every critical and important finding, name the file and line the finding is about, as \`path/to/file.ts:123\` (or \`path/to/file.ts:123-130\` for a range), inline in the message. Repo-relative paths are preferred; a bare filename is accepted when it is unambiguous. Omit it only when the finding genuinely has no single location.

Your answer has one field per part of the review:
- "assessment": your one-line verdict. Approve only when no finding blocks.
- "strengths": one line on what is well done.
- "findings": one entry per issue, each with "severity" ("critical" | "important" | "minor"), "blocking" (true | false, per the definition above — a "minor" finding never blocks), "class" (on blocking findings) and "message". With nothing to report, "findings" is [] — never write a placeholder finding such as "(none)".`;
}

/** One reviewer finding. `blocking` is the reviewer's own call under BLOCKING_DEFINITION. */
export const reviewerFindingSchema = z.object({
  severity: z.enum(['critical', 'important', 'minor']),
  blocking: z.boolean(),
  class: z.enum(FINDING_CLASSES).nullish(),
  message: z.string().min(1),
});
export type ReviewerFinding = z.infer<typeof reviewerFindingSchema>;

export const reviewerAnswerSchema = z.object({
  assessment: z.string().min(1),
  strengths: z.string().default(''),
  findings: z.array(reviewerFindingSchema).default([]),
});
export type ReviewerAnswer = z.infer<typeof reviewerAnswerSchema>;

const REVIEWER_SHAPE =
  '{"assessment": "...", "strengths": "...", "findings": [{"severity": "critical" | "important" | "minor", "blocking": true | false, "class": "mechanical" | "design", "message": "... path/to/file.ts:123 ..."}]}';

/**
 * The repair round's prompt: restate the review as a valid answer. It reviews nothing,
 * reads no file, drops no finding, and never softens a blocking one.
 */
export function buildReviewerRepairPrompt(ctx: RepairContext): string {
  return `A previous Senior Code Reviewer finished its review, but its answer was rejected: ${ctx.error}. Your ONLY job is to restate that review as a valid answer — do not review anything yourself, do not read any file.

Its rejected answer:
${ctx.rejected ?? '(it wrote no answer file)'}

Its output:
${ctx.stdout.trim() === '' ? '(none captured)' : ctx.stdout}

Transcription rules:
1. Carry over every finding the review states, with its severity, whether it blocks, its class and its message. Invent no finding and drop none.
2. Never turn a finding the review marked blocking into a non-blocking one, and never write an approving assessment the review did not give.
3. If nothing above states a review at all, write no answer.`;
}

/** What the reviewer child hands back, and how the seam reads it. */
export const REVIEWER_ANSWER: LaneAnswerContract<ReviewerAnswer> = {
  lane: 'reviewer',
  shape: REVIEWER_SHAPE,
  schema: reviewerAnswerSchema,
  placeholderFields: [{ list: 'findings', text: 'message' }],
  repairPrompt: buildReviewerRepairPrompt,
};

const seam = createAnswerSeam<DispatchInput, ReviewerAnswer>(buildPrompt, {
  role: 'reviewer',
  site: 'cr.subagent-dispatch',
  contract: REVIEWER_ANSWER,
  onFailure: (f) => {
    throw new Error(
      `subagent dispatch failed: ${f.detail ?? `exit ${f.exitCode}`}${f.timedOut ? ' (timeout)' : ''}`,
    );
  },
});

/** Test injection point: swaps the reviewer child (see `createAnswerSeam`). */
export const setDispatcher = seam.setDispatcher;
export const dispatchSubagent = seam.dispatch;
