import matter from 'gray-matter';

/**
 * Revert an FD's `phase` from `done` to `in-progress` for an attach session.
 * Pure function — takes the raw MD string, returns the (possibly updated) MD
 * string. Returns the input unchanged when phase is not `done`.
 *
 * Called from the `/noldor-gate` skill's `full-attach` / `specs-only-attach`
 * scaffolding step on the worktree branch. The reverse transition
 * (`in-progress → done`) is NOT this module's responsibility — it's handled
 * by `fillMarkers` in `release-markers.ts` at release time, per the
 * asymmetric phase-revert model described in the spec's §3.
 *
 * @param md - Raw feature MD file contents
 * @returns The (possibly updated) MD contents
 */
export function revertPhaseForAttach(md: string): string {
  const parsed = matter(md);
  const data = parsed.data as Record<string, unknown>;
  if (data.phase !== 'done') return md;
  data.phase = 'in-progress';
  return matter.stringify(parsed.content.replace(/^\n/, ''), data);
}
