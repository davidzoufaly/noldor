/**
 * The re-round contract every prior-aware lane renders (Q-0260).
 *
 * A re-round inherits the previous round's blockers. Before this module the reviewer got them
 * with a clause that kept "genuinely new issues fully in scope", so the fix was reviewed as a
 * fresh change, and codex got nothing at all. The lane now answers each prior by number and code
 * — never the model — re-files the ones still standing, so a blocker keeps its
 * `fingerprintBlocker` id for as long as it stands (docs/adr/0002). Kept in ONE place, like
 * `BLOCKING_DEFINITION` (`blocking-definition.ts`), so the reviewer and codex prompts cannot drift apart.
 *
 * Q-0261 adds the series' decided findings: every prior-aware lane is shown what any lane fixed
 * and what the operator disposed, and code files an exact restatement of a ruling that still
 * holds as a suggestion (docs/adr/0004).
 */
import { z } from 'zod';
import { isSpecBlockingBasis } from './blocking-definition.js';
import { fingerprintBlocker } from './fingerprint.js';
import type { ArtifactKind, Finding, Lane } from './findings-schema.js';
import type { DecidedFinding, PriorReview } from './lane-types.js';

/** Per-prior message bound. Code re-files the full finding, so the model never re-types it. */
const PRIOR_MESSAGE_MAX_CHARS = 300;

/** `text` on one line, cut to the prior message bound — for messages and reasons alike. */
const oneLine = (text: string): string =>
  text.replace(/\s*\n\s*/g, ' ').slice(0, PRIOR_MESSAGE_MAX_CHARS);

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
 * The prior-round section of a re-round prompt: every prior blocker, numbered, then the contract,
 * then the series' decided findings. Every prior is listed — a prior the lane never sees can only
 * be carried unexamined. With nothing decided the section is the Q-0260 one, byte for byte; with no
 * priors it is the decided list alone, without the re-round framing.
 */
export function renderPriorSection(prior: PriorReview): string {
  const decided = prior.decided ?? [];
  const priors = prior.blockers.length === 0 ? '' : renderPriors(prior);
  return decided.length === 0 ? priors : `${priors}${renderDecided(decided)}`;
}

function renderPriors(prior: PriorReview): string {
  const lines = prior.blockers.map((b, i) => {
    const msg = oneLine(b.message);
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

/** Whether an operator ruling still stands — anything but an explicit `true` carries. */
const isHeldRuling = (d: DecidedFinding): boolean => d.disposition !== 'fixed' && d.holds === true;

function renderDecided(decided: readonly DecidedFinding[]): string {
  const lines = decided.map((d, i) => {
    const reason = d.reason.trim() === '' ? '' : ` — ${oneLine(d.reason)}`;
    const changed =
      d.disposition !== 'fixed' && d.holds === false
        ? ' (its cited content has changed since the ruling)'
        : '';
    return `S${i + 1} [${d.disposition} r${d.round}][${d.finding.severity}] ${oneLine(d.finding.message)}${reason}${changed}`;
  });
  return `
Findings this review series has already decided, from every lane. Do not file any of them again as a new finding.
${lines.join('\n')}

A fixed finding blocks again only as a regression: its defect is back. A rejected, accepted or deferred finding is settled: raise it again only when the content it cites has changed, and say what changed.
`;
}

/**
 * The code half of the decided contract (Q-0261): a new blocking finding with the same
 * `fingerprintBlocker` id as an operator ruling that still holds is filed as a suggestion, with a
 * note naming the ruling. Identity is exact — a reworded restatement still blocks — and a finding
 * that restates a fixed decision still blocks, because it claims the defect is back.
 */
export function splitSettled(
  findings: readonly Finding[],
  decided: readonly DecidedFinding[],
): { blocking: Finding[]; demoted: Finding[]; notes: string[] } {
  const held = new Map<string, { n: number; disposition: string }>();
  decided.forEach((d, i) => {
    if (isHeldRuling(d)) held.set(d.id, { n: i + 1, disposition: d.disposition });
  });
  const blocking: Finding[] = [];
  const demoted: Finding[] = [];
  const notes: string[] = [];
  for (const f of findings) {
    const ruling = held.size === 0 ? undefined : held.get(fingerprintBlocker(f));
    if (ruling === undefined) {
      blocking.push(f);
      continue;
    }
    demoted.push(f);
    notes.push(
      `finding filed as a suggestion: it restates settled S${ruling.n} (${ruling.disposition}), whose cited content is unchanged`,
    );
  }
  return { blocking, demoted, notes };
}

export interface PriorOutcome {
  /** Every prior not answered resolved, as the prior finding unchanged. */
  readonly carried: Finding[];
  /** Every prior answered resolved, with the lane's why — the sink's `resolved` list (Q-0261). */
  readonly resolved: { finding: Finding; why: string }[];
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
  const resolved: { finding: Finding; why: string }[] = [];
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
      resolved.push({ finding: p, why: got[0].why });
      notes.push(`prior P${n} resolved: ${got[0].why}`);
    } else {
      carried.push(p);
      notes.push(`prior P${n} still stands: ${got[0].why}`);
    }
  });
  return { carried, resolved, notes };
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
