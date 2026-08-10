import { spawnAgent } from '../../core/agent-runner/registry.js';
import { DEFAULT_REVIEW_PROFILES } from '../../core/review-profile.js';
import type { ReviewDimension, ReviewEffort, ReviewProfile } from '../../core/review-profile.js';

export interface DispatchInput {
  artifact: string;
  fdSummary: string;
  baseSha: string;
  headSha: string;
  description: string;
  reviewProfile?: ReviewProfile;
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

/**
 * Default impl: spawns a headless reviewer-role agent via the agent-runner
 * registry (claude unless the consumer's agents config remaps the role).
 * Works from any agent harness (gate skill, bare CLI, CI runner). The skill
 * layer may inject a Task-tool-based dispatcher via `setDispatcher()` for
 * finer control, but the default is self-sufficient.
 *
 * The prompt instructs the agent to act as a senior code reviewer against
 * the artifact path; output must match the Strengths/Issues/Assessment
 * markdown contract parsed by `parseSubagentMarkdown` in `subagent.ts` —
 * prose-grade output, so every runner qualifies.
 */
// Dimensions whose findings a `noldor:cut` marker can wave off. A marked cut is
// deliberate minimalism, so it silences minimalism-class complaints only —
// correctness/security/concurrency/effects findings are never marker-exempt (a
// cut hiding a bug is not a respected cut). The clause is prompt-level rather
// than riding one dimension because a cut lands against any ladder rung: the
// canonical example ("linear scan, fine ≤1k rules") is an efficiency cut that a
// simplification-only clause would leave flaggable.
const CUT_MARKER_DIMENSIONS: ReadonlySet<ReviewDimension> = new Set([
  'reuse',
  'simplification',
  'efficiency',
  'altitude',
]);

// The waivable side is phrased without naming dimensions: the prompt promises
// "these dimensions only", so naming an out-of-scope dimension here would
// invite findings against it (the fast-track test pins this by asserting
// `altitude` absent). The never-exempt side names concern categories
// (correctness/security/concurrency/side effects) — that is a refusal to waive,
// not an invitation to report.
const CUT_MARKER_GUIDE =
  '\nRespect `noldor:cut <ceiling> — <upgrade path>` markers: a marked cut is a deliberate decision. When a finding argues the code should be simpler, leaner, faster, or reuse something existing, do not flag the marked cut itself — flag only a wrong ceiling or a real cut left unmarked. Findings about correctness, security, concurrency, or side effects are never waved off by a marker.\n';

export function buildPrompt(input: DispatchInput): string {
  const profile = input.reviewProfile ?? DEFAULT_REVIEW_PROFILES.default;
  const dimensionLines = profile.dimensions.map((d) => `- ${d}: ${DIMENSION_GUIDE[d]}`).join('\n');
  const cutMarkerGuide = profile.dimensions.some((d) => CUT_MARKER_DIMENSIONS.has(d))
    ? CUT_MARKER_GUIDE
    : '';
  return `You are a Senior Code Reviewer. Review the markdown artifact at \`${input.artifact}\` (description: ${input.description}).

FD summary context:
${input.fdSummary}

Range under review: ${input.baseSha}..${input.headSha}. If they differ, review only the diff; if equal, review the whole artifact.

Review along these dimensions only — do not flag concerns outside them:
${dimensionLines}
${cutMarkerGuide}
Effort: ${profile.effort}. ${EFFORT_GUIDE[profile.effort]}

Verify-before-flag protocol: before flagging a Critical issue that claims a command, validator, or test will fail (e.g. \`pnpm validate:features\`, \`pnpm typecheck\`, \`pnpm test\`), run that exact command first and quote its actual error output in the bullet. If the command passes, or you cannot run it, do not flag the claim as Critical — file it under Important prefixed with \`unverified:\` instead.

Classify every Critical and Important bullet by prefixing it with exactly one tag:
- \`[mechanical]\` — the fix is determined by the finding itself: a missing required section, an unanswered open question, a lint-class defect, a stated contract not met. Someone applying your bullet needs no judgment call beyond what you wrote.
- \`[design]\` — the fix requires a judgment call you are NOT making for them: disagreement about an approach, a default, a trade-off, or anything where two reasonable fixes exist and picking between them is the author's call.

Tag by what the FIX needs, not by how severe the finding is. When in doubt, tag \`[design]\` — an untagged or design-tagged blocker is routed to a human, which is always safe. Minor bullets need no tag.

Emit your review in this exact format, no preamble:

Strengths: <one-line summary of what is well-done>

Issues:
  Critical:
    - [mechanical|design] <bullet>
  Important:
    - [mechanical|design] <bullet>
  Minor:
    - <bullet>

Assessment: <one-line verdict: approve | blockers found | needs changes>

Leave a bucket's bullet list empty (no bullets) when there are no items at that severity.`;
}

type Dispatcher = (input: DispatchInput) => Promise<string>;

let dispatcher: Dispatcher = async (input) => {
  const r = await spawnAgent(buildPrompt(input), {
    role: 'reviewer',
    timeoutMs: 600_000,
    site: 'cr.subagent-dispatch',
  });
  if (r.timedOut || r.exitCode !== 0) {
    throw new Error(
      `subagent dispatch failed: exit ${r.exitCode}${r.timedOut ? ' (timeout)' : ''}`,
    );
  }
  return r.stdout;
};

/**
 * Skill-layer injection point. Gate skill calls this once at Step 2.5 entry
 * to swap in a Task-tool-based dispatcher. Tests use this to inject mocks.
 */
export function setDispatcher(impl: Dispatcher): void {
  dispatcher = impl;
}

export function dispatchSubagent(input: DispatchInput): Promise<string> {
  return dispatcher(input);
}
