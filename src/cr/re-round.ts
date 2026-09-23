/**
 * The re-round contract every prior-aware lane renders (Q-0260).
 *
 * A re-round inherits the previous round's blockers. Before this module the reviewer got them
 * with a clause that kept "genuinely new issues fully in scope", so the fix was reviewed as a
 * fresh change, and codex got nothing at all. The lane now answers each prior by number and code
 * — never the model — re-files the ones still standing, so a blocker keeps its
 * `fingerprintBlocker` id for as long as it stands (docs/adr/0002). Kept in ONE place, like
 * `BLOCKING_DEFINITION` (`blocking-definition.ts`), so the reviewer and codex prompts cannot drift apart.
 */
import { z } from 'zod';
import { isSpecBlockingBasis } from './blocking-definition.js';
import type { ArtifactKind, Finding, Lane } from './findings-schema.js';
import type { PriorReview } from './lane-types.js';

/** Per-prior message bound. Code re-files the full finding, so the model never re-types it. */
const PRIOR_MESSAGE_MAX_CHARS = 300;

/** One lane's answer about one prior blocker, addressed by its `P<n>` number. */
export const priorAnswerSchema = z.object({
  n: z.number().int().positive(),
  resolved: z.boolean(),
  why: z.string(),
});
export type PriorAnswer = z.infer<typeof priorAnswerSchema>;

const MODE_LINE: Record<PriorReview['mode'], string> = {
  'fixes-in-diff': 'The range under review is the fix for these blockers.',
  reexamine:
    'Do not assume any of these blockers were addressed; judge each one against the current content.',
};

/**
 * The prior-round section of a re-round prompt: every prior blocker, numbered, then the contract.
 * Every prior is listed — a prior the lane never sees can only be carried unexamined.
 */
export function renderPriorSection(prior: PriorReview): string {
  const lines = prior.blockers.map((b, i) => {
    const msg = b.message.replace(/\s*\n\s*/g, ' ').slice(0, PRIOR_MESSAGE_MAX_CHARS);
    return `P${i + 1} [${b.severity}]${b.class ? `[${b.class}]` : ''}${b.basis ? `[${b.basis}]` : ''} ${msg}`;
  });
  return `
Prior review round — the previous pass over this artifact raised the blockers below.
${lines.join('\n')}

${MODE_LINE[prior.mode]} This is a re-round: check the fix, do not review it as new work.
1. Answer every prior blocker in a "prior" list in your answer, one entry each: {"n": <its P number>, "resolved": true | false, "why": "<one line>"}. Resolved means the current content no longer has the defect. Do not restate a prior blocker as a new finding.
2. Mark a new finding as blocking only when it is a regression the fix caused — something that was correct before the fix and is not after it, such as a behaviour, a contract, or a statement elsewhere in the artifact the fix now contradicts — or when it meets the blocking definition this prompt gives. Every other finding about the fix's own content is a suggestion.
`;
}

export interface PriorOutcome {
  /** Every prior not answered resolved, as the prior finding unchanged. */
  readonly carried: Finding[];
  readonly notes: string[];
}

/**
 * Apply a lane's answers to the priors it was shown. Every failure carries: an unanswered prior,
 * a malformed entry, an out-of-range `n`, or two answers that disagree. Carrying is always safe;
 * dropping a standing blocker is the one outcome this must never produce.
 */
export function applyPriorAnswers(
  priors: readonly Finding[],
  answers: readonly unknown[],
): PriorOutcome {
  const notes: string[] = [];
  const byN = new Map<number, PriorAnswer[]>();
  for (const raw of answers) {
    const a = priorAnswerSchema.safeParse(raw);
    if (!a.success) {
      notes.push(`prior answer ignored — malformed: ${JSON.stringify(raw)?.slice(0, 200)}`);
      continue;
    }
    if (a.data.n > priors.length) {
      notes.push(`prior answer ignored — no P${a.data.n}`);
      continue;
    }
    byN.set(a.data.n, [...(byN.get(a.data.n) ?? []), a.data]);
  }
  const carried: Finding[] = [];
  priors.forEach((p, i) => {
    const n = i + 1;
    const got = byN.get(n) ?? [];
    if (got.length === 0) {
      carried.push(p);
      notes.push(`prior P${n} unanswered — carried`);
    } else if (got.some((a) => a.resolved !== got[0].resolved)) {
      carried.push(p);
      notes.push(`prior P${n} answered both ways — carried`);
    } else if (got[0].resolved) {
      notes.push(`prior P${n} resolved: ${got[0].why}`);
    } else {
      carried.push(p);
      notes.push(`prior P${n} still stands: ${got[0].why}`);
    }
  });
  return { carried, notes };
}

/**
 * The spec-stage rule applied to the priors a round carries (Q-0263): at kind spec a prior blocks
 * only when it names a basis. One filed before the rule has none, so it is carried as a suggestion
 * — the same finding, never dropped — and noted. Every other kind carries every prior as a blocker.
 * `priors` is the list the round was handed, which numbers them.
 */
export function splitCarriedByBasis(
  priors: readonly Finding[],
  carried: readonly Finding[],
  kind: ArtifactKind,
): { blocking: Finding[]; demoted: Finding[]; notes: string[] } {
  if (kind !== 'spec') return { blocking: [...carried], demoted: [], notes: [] };
  // The same test a new finding's basis faces, so no shape of a missing one keeps a prior blocking.
  const { blocking = [], demoted = [] } = Object.groupBy(carried, (p) =>
    isSpecBlockingBasis(p.basis) ? 'blocking' : 'demoted',
  );
  const notes = demoted.map(
    (p) => `prior P${priors.indexOf(p) + 1} carried as a suggestion: it names no basis`,
  );
  return { blocking, demoted, notes };
}

/** The lanes that inherit their own prior blockers on a re-round. */
export const PRIOR_AWARE_LANES = ['reviewer', 'codex'] as const satisfies readonly Lane[];
type PriorAwareLane = (typeof PRIOR_AWARE_LANES)[number];

/**
 * The file a prior-aware lane files its OWN failure against. A lane failure is not a finding
 * about the artifact, so the next round never carries it — carrying one would keep the round red
 * on something no fix can resolve. Codex's synthetic blocker has always used `<codex>`.
 */
export function laneFailureFile(lane: PriorAwareLane): string {
  return `<${lane}>`;
}

const LANE_FAILURE_FILES: ReadonlySet<string> = new Set(PRIOR_AWARE_LANES.map(laneFailureFile));

/** True for a blocker a lane filed about its own failure rather than about the artifact. */
export function isLaneFailureBlocker(f: { readonly file: string }): boolean {
  return LANE_FAILURE_FILES.has(f.file);
}
