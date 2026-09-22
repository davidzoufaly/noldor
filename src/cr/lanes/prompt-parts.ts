// @tests: ui-design-review-lane
// Prompt fragments shared by the lanes whose child returns a structured verdict.
// The fenced-json instruction is the counterpart of `parseLastJsonFence`: the
// text telling the agent what to emit and the parser reading it must agree, so
// they are worth keeping within one edit of each other.

import type { RunnerCapabilities } from '../../core/agent-runner/types.js';

/**
 * The closing instruction for a lane whose child must return exactly one JSON
 * object. `shape` is the schema sketch shown to the agent, rendered inside the
 * fence.
 */
export function fencedJsonInstruction(shape: string): string {
  return `When done, emit EXACTLY ONE fenced json block as the last thing in your output:

\`\`\`json
${shape}
\`\`\``;
}

/**
 * The closing instruction for a lane whose child hands back one JSON object (Q-0250).
 * `agent-writes` children write the file themselves; for a `cli-writes` runner (codex) the CLI
 * writes the child's final message to the file, so the child only makes that message the
 * object. Either way nothing the child prints is read.
 */
export function answerInstruction(
  channel: RunnerCapabilities['answerFile'],
  path: string,
  shape: string,
): string {
  if (channel === 'cli-writes') {
    return `When done, make your FINAL message exactly ONE JSON object with this shape, and nothing else — no code fence, no prose before or after it:\n\n${shape}`;
  }
  return `When done, write your answer to the file \`${path}\` as exactly ONE JSON object with this shape, and nothing else in that file — no code fence, no prose:\n\n${shape}\n\nUse your file-writing tool. Only that file is read: an answer you print instead is ignored.`;
}
