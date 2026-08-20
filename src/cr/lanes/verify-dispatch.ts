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
}

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

${fencedJsonInstruction(
  `{"verdict": "pass" | "fail" | "cannot-verify", "evidence": [{"command": "...", "observed": "..."}], "mismatches": ["..."], "reason": "only for cannot-verify"}`,
)}`;
}

/** Last fenced ```json block wins; null on absence or schema mismatch. */
export const parseVerifyVerdict = (md: string): VerifyVerdict | null =>
  parseFencedJson(md, verifyVerdictSchema);

const seam = createDispatcherSeam<VerifyDispatchInput>(buildVerifyPrompt, {
  role: 'verifier',
  site: 'cr.verify-dispatch',
  onFailure: (f) => {
    throw new Error(`verify dispatch failed: exit ${f.exitCode}${f.timedOut ? ' (timeout)' : ''}`);
  },
});

/** Test seam, mirroring subagent-dispatch's setDispatcher. */
export const setVerifyDispatcher = seam.setDispatcher;
export const dispatchVerify = seam.dispatch;
