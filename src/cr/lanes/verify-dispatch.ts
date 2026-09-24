import { z } from 'zod';
import type { VerifySurface } from '../../core/consumer-config.js';
import { verifyEvidenceSchema, verifyVerdictValueSchema } from '../findings-schema.js';
import type { LaneAnswerContract, RepairContext } from '../lane-answer.js';
import { createAnswerSeam } from '../lane-spawn.js';
import { repairEvidence } from './prompt-parts.js';

/**
 * The verifier's answer. The refinement ties the verdict to its mismatches: a `pass` that
 * names a mismatch, or a `fail` that names none, is an ambiguous answer the repair round
 * gets to restate — never half-honored.
 */
export const verifyVerdictSchema = z
  .object({
    verdict: verifyVerdictValueSchema,
    evidence: z.array(verifyEvidenceSchema).default([]),
    mismatches: z.array(z.string()).default([]),
    reason: z.string().optional(),
  })
  .refine(
    (v) =>
      v.verdict === 'pass'
        ? v.mismatches.length === 0
        : v.verdict === 'fail'
          ? v.mismatches.length > 0
          : true,
    { message: 'a pass carries no mismatches and a fail carries at least one' },
  );
export type VerifyVerdict = z.infer<typeof verifyVerdictSchema>;

export interface VerifyDispatchInput {
  acceptance: string;
  baseSha: string;
  headSha: string;
  /** Surfaces with `{port}` ALREADY substituted — the agent gets runnable commands. */
  surfaces: Array<VerifySurface & { name: string }>;
  port: number;
  /** Wall-clock cap; {@link DEFAULT_DISPATCH_TIMEOUT_MS} when the caller omits it. */
  timeoutMs?: number;
}

/**
 * The verdict shape both prompts show the child. One constant because the
 * repair round must ask for exactly the shape {@link verifyVerdictSchema}
 * accepts — a second, drifting copy is how a repair round starts failing to
 * parse for a new reason.
 */
const VERDICT_SHAPE =
  '{"verdict": "pass" | "fail" | "cannot-verify", "evidence": [{"command": "...", "observed": "..."}], "mismatches": ["..."], "reason": "only for cannot-verify"}';

export function buildVerifyPrompt(input: VerifyDispatchInput): string {
  const surfaceLines =
    input.surfaces.length > 0
      ? input.surfaces
          .map((s) => {
            const cmd = s.command.replaceAll('{port}', String(input.port));
            return s.kind === 'server'
              ? `- ${s.name} (server): \`${cmd}\` — health probe GET http://127.0.0.1:${input.port}${s.healthPath} (ready within ${s.readyTimeoutMs}ms)`
              : `- ${s.name} (cli): \`${cmd}\``;
          })
          .join('\n')
      : '- (none configured — if the change has no reachable interface, emit cannot-verify)';
  return `You are an independent Acceptance Verifier. Judge whether the change in range ${input.baseSha}..${input.headSha} actually delivers the promised behavior.

Promised behavior (acceptance text):
${input.acceptance}

Boot surfaces (commands are runnable as-is; servers listen on port ${input.port}):
${surfaceLines}

Hard rules:
1. Exercise the SPECIFIC new behavior through the real interface — CLI invocation, HTTP request, file output. Never conclude from reading source code; reading code to find the interface is fine, judging from it is not.
2. Quote real observed output in evidence. Every evidence entry is a command you actually ran plus what it printed.
3. Kill every process you start, and remove every git worktree and temp directory you create — \`git worktree remove --force <path>\` (if it refuses, unlink the \`node_modules\` symlink inside it and retry). When you finish, \`git worktree list\` must show exactly what it showed before you began.
4. \`cannot-verify\` is an honest outcome when no boot path reaches the behavior — use it with a reason instead of guessing.`;
}

/**
 * The repair round's prompt: a transcription task, not a verification one. It hands over the
 * answer the seam rejected, why, and the child's own output, and asks only for a valid answer.
 * It must never boot anything, judge the change, or upgrade a hedged report into `pass`; the
 * honest outcome when nothing states a verdict is `cannot-verify`.
 */
export function buildVerifyRepairPrompt(ctx: RepairContext): string {
  return `A previous Acceptance Verifier finished its work, but its answer was rejected: ${ctx.error}. Your ONLY job is to restate that verifier's conclusion as a valid answer — do not re-verify, do not boot anything, do not judge the change yourself.

${repairEvidence(ctx)}

Transcription rules:
1. Report the verdict that verifier actually reached. Never upgrade a partial, hedged, or ambiguous report into \`pass\`.
2. Carry over only evidence that appears above — each entry is a command it says it ran plus what it says that printed. Invent nothing.
3. A \`fail\` names at least one mismatch, and a \`pass\` names none.
4. If nothing above clearly states one of the three verdicts, answer \`cannot-verify\` with a reason saying exactly that.`;
}

/** What the verifier child hands back, and how the seam reads it. */
export const VERIFY_ANSWER: LaneAnswerContract<VerifyVerdict> = {
  lane: 'verifier',
  shape: VERDICT_SHAPE,
  schema: verifyVerdictSchema,
  placeholderFields: [{ list: 'mismatches' }],
  repairPrompt: buildVerifyRepairPrompt,
};

const seam = createAnswerSeam<VerifyDispatchInput, VerifyVerdict>(buildVerifyPrompt, {
  site: 'cr.verify-dispatch',
  contract: VERIFY_ANSWER,
});

/** Test seam, mirroring subagent-dispatch's setDispatcher. */
export const setVerifyDispatcher = seam.setDispatcher;
export const dispatchVerify = seam.dispatch;
