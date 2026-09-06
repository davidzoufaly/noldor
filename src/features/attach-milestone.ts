/**
 * What an attach should do with the source entry's milestone.
 *
 * - `noop` — nothing to change: the entry declares none, or both sides already
 *   agree.
 * - `adopt` — the entry declares a milestone and the parent FD declares none, so
 *   the parent takes it. Nothing is overwritten.
 * - `conflict` — both declare, and they differ. The tooling must not pick: the
 *   alternatives are dropping a stated assignment or rewriting an unrelated
 *   feature's milestone, and both are worse than stopping.
 */
export type AttachMilestoneVerdict = 'noop' | 'adopt' | 'conflict';

/**
 * Decide what happens to a milestone when a queue entry attaches to a parent FD.
 *
 * Pure, so the branching is testable on its own; the write it implies is applied
 * by `/noldor-promote`'s attach branch, which has no FD-frontmatter writer of
 * its own. `pnpm noldor features attach-milestone` exposes this verdict as an
 * exit code so the skill runs the decision rather than remembering the rule.
 *
 * @param entryMilestone - The source entry's `- milestone:`, if any.
 * @param parentMilestone - The parent FD's `milestone:` frontmatter, if any.
 * @returns Which of the three outcomes applies.
 */
export function resolveAttachMilestone(
  entryMilestone: string | undefined,
  parentMilestone: string | undefined,
): AttachMilestoneVerdict {
  // An entry with nothing to say can never conflict, whatever the parent holds.
  if (entryMilestone === undefined) return 'noop';
  if (parentMilestone === undefined) return 'adopt';
  return entryMilestone === parentMilestone ? 'noop' : 'conflict';
}
