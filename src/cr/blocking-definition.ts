/**
 * What blocks a merge: the one definition every review lane's prompt renders (Q-0250).
 *
 * Before it, no lane was told what blocks. Every reviewer Important item blocked while the
 * prompt never said so, and the codex prompt gave no definition at all. The round-cause
 * forensics behind Q-0250 found reviewers approving over Important items they had filed, and
 * nits keeping rounds red on their own. Kept in ONE place so the reviewer and codex prompts
 * cannot drift apart; {@link isNeverBlockingMessage} is its code half.
 */
export const BLOCKING_DEFINITION = `What blocks the merge: a finding blocks only when shipping the change as it is would
- produce wrong behaviour;
- break a stated contract or an existing caller;
- open a security hole;
- lose or corrupt data;
- leave a test that cannot fail; or
- put a false statement into docs that an agent or operator will act on.
Everything else never blocks: cleanup, naming, wording, formatting, cross-references, style, and any finding marked \`maybe:\` or \`unverified:\`. If you would approve this change, no finding blocks.`;

/** Never-blocks prefixes, matched on the trimmed message, case-insensitively. */
const NEVER_BLOCKS_PREFIX = /^(?:maybe|unverified):/i;

/**
 * The code half of the definition: true when a message marks its finding `maybe:` or
 * `unverified:`, which never blocks whatever a lane put it under. Prompt text is not
 * enforcement, so every lane that sorts blockers calls this.
 */
export function isNeverBlockingMessage(message: string): boolean {
  return NEVER_BLOCKS_PREFIX.test(message.trim());
}
