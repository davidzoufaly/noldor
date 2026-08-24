import { z } from 'zod';
import { createDispatcherSeam } from '../lane-spawn.js';
import { fencedJsonInstruction } from './prompt-parts.js';
import { parseFencedJson } from '../extract-json.js';
import { verifyEvidenceSchema, verifyVerdictValueSchema } from '../findings-schema.js';
import type { VerifySurface } from '../../core/consumer-config.js';

export const verifyVerdictSchema = z.object({
  verdict: verifyVerdictValueSchema,
  evidence: z.array(verifyEvidenceSchema).default([]),
  mismatches: z.array(z.string()).default([]),
  reason: z.string().optional(),
});
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
  /**
   * The child's previous, unparseable prose. Present only on the ONE repair
   * re-request `runVerify` makes: the verification already ran, so that round
   * transcribes its conclusion instead of re-running anything. Its presence is
   * what routes the dispatch to {@link buildVerifyRepairPrompt}.
   */
  repairOf?: string;
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
3. Kill every process you start.
4. \`cannot-verify\` is an honest outcome when no boot path reaches the behavior — use it with a reason instead of guessing.

${fencedJsonInstruction(VERDICT_SHAPE)}`;
}

/**
 * The repair round's prompt: a transcription task, not a verification one.
 *
 * A child that ran the whole verification and then failed to fence its JSON has
 * produced a real verdict — discarding it costs a full re-verification (or, in
 * blocking mode, blocks the ship on a formatting failure). So this round is
 * given the prose and asked only to restate it in the schema. It must never
 * boot anything, judge the change, or upgrade a hedged report into `pass`; the
 * honest outcome when the prose states no verdict is `cannot-verify`.
 */
export function buildVerifyRepairPrompt(prose: string): string {
  return `A previous Acceptance Verifier finished its work but did not emit a parseable verdict. Its full output follows. Your ONLY job is to transcribe that output into the verdict schema — do not re-verify, do not boot anything, do not judge the change yourself.

Previous verifier output:
${prose}

Transcription rules:
1. Report the verdict that output actually states. Never upgrade a partial, hedged, or ambiguous report into \`pass\`.
2. Carry over only evidence that appears above — each entry is a command it says it ran plus what it says that printed. Invent nothing.
3. If the output does not clearly state one of the three verdicts, emit \`cannot-verify\` with a reason saying exactly that.

${fencedJsonInstruction(VERDICT_SHAPE)}`;
}

/** Last fenced ```json block wins; null on absence or schema mismatch. */
export const parseVerifyVerdict = (md: string): VerifyVerdict | null =>
  parseFencedJson(md, verifyVerdictSchema);

/** Primary verification, or the repair transcription when `repairOf` is set. */
const buildPrompt = (input: VerifyDispatchInput): string =>
  input.repairOf === undefined ? buildVerifyPrompt(input) : buildVerifyRepairPrompt(input.repairOf);

const seam = createDispatcherSeam<VerifyDispatchInput>(buildPrompt, {
  role: 'verifier',
  site: 'cr.verify-dispatch',
  onFailure: (f) => {
    throw new Error(`verify dispatch failed: exit ${f.exitCode}${f.timedOut ? ' (timeout)' : ''}`);
  },
});

/** Test seam, mirroring subagent-dispatch's setDispatcher. */
export const setVerifyDispatcher = seam.setDispatcher;
export const dispatchVerify = seam.dispatch;
