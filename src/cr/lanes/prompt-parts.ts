// @tests: ui-design-review-lane
// Prompt fragments shared by the lanes whose child returns a structured verdict.
// The fenced-json instruction is the counterpart of `parseLastJsonFence`: the
// text telling the agent what to emit and the parser reading it must agree, so
// they are worth keeping within one edit of each other.

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
