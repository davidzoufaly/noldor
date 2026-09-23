import { DEFAULT_DISPATCH_TIMEOUT_MS } from '../../core/config.js';
import { writeJsonAtomic } from '../atomic-write.js';
import { makeCodexSpawn } from '../codex-adapter.js';
import { openLane } from '../filename.js';
import type { LaneFindings } from '../findings-schema.js';
import type { LaneInput, LaneResult } from '../lane-types.js';
import { applyPriorAnswers, isLaneFailureBlocker, splitCarriedByBasis } from '../re-round.js';
import { reviewWithCodex } from '../review-with-codex.js';

/**
 * Orchestrate's codex lane, run IN-PROCESS.
 *
 * This used to `execFile('pnpm', ['--silent', 'noldor', 'cr', 'codex', ...])`, putting three
 * processes between the cap and the thing it capped: `execFile`'s timeout signals only its
 * direct child, so when it fired it killed `pnpm` and left the node CLI and codex itself
 * running to completion — burning quota unattended, on a review nobody would read. Calling
 * {@link reviewWithCodex} directly collapses that to one child, whose lifecycle the agent
 * registry owns (detached spawn + group-kill on timeout).
 *
 * Deleted with the shell-out: the `--silent` pnpm-banner workaround, the JSON round-trip
 * through stdout, and `codexSupportsBaseSha` — a probe that grepped intercepted `--help`
 * output and could therefore never return true, silently making every codex artifact review
 * full-scope. `--base-sha` was supported the whole time; the lane and the CLI ship in one
 * package at one version, so there was never a capability question to ask.
 */
export async function runCodex(input: LaneInput): Promise<LaneResult> {
  const { sinkPath, startedAt } = openLane(input, 'codex');
  const timeoutMs = input.dispatchTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS;
  const scoped = Boolean(input.baseSha) && !input.fullReview;

  // Unattended: no `foreground`, so the registry detaches and the cap is enforced by a
  // group-kill that actually reaches codex.
  const out = await reviewWithCodex(
    {
      kind: input.kind,
      artifact: input.artifact,
      slug: input.slug,
      fullReview: Boolean(input.fullReview),
      ...(input.baseSha !== undefined ? { baseSha: input.baseSha } : {}),
    },
    input.repoRoot,
    makeCodexSpawn({ timeoutMs, cwd: input.repoRoot }),
    { timeoutMs, ...(input.priorReview !== undefined ? { prior: input.priorReview } : {}) },
  );

  // On a re-round, a review that failed keeps the priors it was handed behind its `<codex>`
  // failure; one that ran answers for them, and every prior not answered resolved is re-filed
  // unchanged ahead of the new blockers (Q-0260, docs/adr/0002).
  const found = out.findings.filter((f) => f.severity === 'high');
  const failed = out.findings.some(isLaneFailureBlocker);
  const prior =
    input.priorReview === undefined
      ? { carried: [], notes: [] }
      : failed
        ? { carried: input.priorReview.blockers, notes: [] }
        : applyPriorAnswers(input.priorReview.blockers, out.prior);
  // A failed review keeps every prior a blocker, for the next round to judge; one that ran applies
  // the spec-stage rule to the priors it carries (Q-0263).
  const carried = failed
    ? { blocking: prior.carried, demoted: [], notes: [] }
    : splitCarriedByBasis(input.priorReview?.blockers ?? [], prior.carried, input.kind);
  const blockers = failed ? [...found, ...carried.blocking] : [...carried.blocking, ...found];
  const notes = [...prior.notes, ...carried.notes];

  const payload: LaneFindings = {
    lane: 'codex',
    artifact: input.artifact,
    kind: input.kind,
    slug: input.slug,
    blockers,
    suggestions: [...carried.demoted, ...out.findings.filter((f) => f.severity !== 'high')],
    summary: out.summary,
    ...(notes.length > 0 ? { notes } : {}),
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(scoped && input.baseSha !== undefined ? { baseSha: input.baseSha } : {}),
    ...(input.fullReview ? { fullReview: true } : {}),
  };

  await writeJsonAtomic(sinkPath, payload);
  return { lane: 'codex', sinkPath, ok: payload.blockers.length === 0 };
}
