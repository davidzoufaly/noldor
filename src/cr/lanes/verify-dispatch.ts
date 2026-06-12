import { z } from 'zod';
import { spawnAgent } from '../../core/agent-runner/registry.js';
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

When done, emit EXACTLY ONE fenced json block as the last thing in your output:

\`\`\`json
{"verdict": "pass" | "fail" | "cannot-verify", "evidence": [{"command": "...", "observed": "..."}], "mismatches": ["..."], "reason": "only for cannot-verify"}
\`\`\``;
}

/** Last fenced ```json block wins; null on absence or schema mismatch. */
export function parseVerifyVerdict(md: string): VerifyVerdict | null {
  const fences = [...md.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  const last = fences.at(-1)?.[1];
  if (!last) return null;
  try {
    return verifyVerdictSchema.parse(JSON.parse(last));
  } catch {
    return null;
  }
}

type VerifyDispatcher = (input: VerifyDispatchInput) => Promise<string>;

let dispatcher: VerifyDispatcher = async (input) => {
  const r = await spawnAgent(buildVerifyPrompt(input), {
    role: 'verifier',
    timeoutMs: 600_000,
    site: 'cr.verify-dispatch',
  });
  if (r.timedOut || r.exitCode !== 0) {
    throw new Error(`verify dispatch failed: exit ${r.exitCode}${r.timedOut ? ' (timeout)' : ''}`);
  }
  return r.stdout;
};

/** Test seam, mirroring subagent-dispatch's setDispatcher. */
export function setVerifyDispatcher(impl: VerifyDispatcher): void {
  dispatcher = impl;
}

export function dispatchVerify(input: VerifyDispatchInput): Promise<string> {
  return dispatcher(input);
}
