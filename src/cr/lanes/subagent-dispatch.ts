import { spawnAgent } from '../../core/agent-runner/registry.js';

export interface DispatchInput {
  artifact: string;
  fdSummary: string;
  baseSha: string;
  headSha: string;
  description: string;
}

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
function buildPrompt(input: DispatchInput): string {
  return `You are a Senior Code Reviewer. Review the markdown artifact at \`${input.artifact}\` (description: ${input.description}).

FD summary context:
${input.fdSummary}

Range under review: ${input.baseSha}..${input.headSha}. If they differ, review only the diff; if equal, review the whole artifact.

Verify-before-flag protocol: before flagging a Critical issue that claims a command, validator, or test will fail (e.g. \`pnpm validate:features\`, \`pnpm typecheck\`, \`pnpm test\`), run that exact command first and quote its actual error output in the bullet. If the command passes, or you cannot run it, do not flag the claim as Critical — file it under Important prefixed with \`unverified:\` instead.

Emit your review in this exact format, no preamble:

Strengths: <one-line summary of what is well-done>

Issues:
  Critical:
    - <bullet>
  Important:
    - <bullet>
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
