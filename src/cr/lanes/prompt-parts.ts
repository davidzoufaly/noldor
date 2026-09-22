// @tests: ui-design-review-lane, cr-lane-verdicts-blocked-by-serialization-not-substance
// Prompt fragments shared by the lanes whose child returns a structured verdict.
// `answerInstruction` is the counterpart of `readLaneAnswer` (src/cr/lane-answer.ts):
// the text telling the child where its answer goes and the reader of that file must
// agree, so they are worth keeping within one edit of each other.

import type { RunnerCapabilities } from '../../core/agent-runner/types.js';

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
