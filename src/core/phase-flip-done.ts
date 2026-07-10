import matter from 'gray-matter';

/**
 * Flip an FD's `phase` from `in-progress` to `done` for the final commit
 * before merge in the feature PR. Pure function — takes the raw MD string,
 * returns the (possibly updated) MD string. Returns the input unchanged when
 * phase is not `in-progress`.
 *
 * Called from the `/noldor-gate` skill's Step 4 end-of-flow on FD-carrying paths
 * (`specs-only-new`, `specs-only-attach`, `full-new`, `full-attach`) right
 * before requesting code review. The flip lands `phase: done` on `main` as
 * part of the feature's PR rather than waiting for `pnpm release` to flip
 * it via `fillMarkers` in `release-markers.ts`.
 *
 * `fillMarkers` still owns `introduced` / `updated` markers at release time
 * — its branches accept `phase: done` as input and only set the version
 * fields, leaving the phase alone.
 *
 * @param md - Raw feature MD file contents
 * @returns The (possibly updated) MD contents
 */
export function flipPhaseToDone(md: string): string {
  const parsed = matter(md);
  const data = parsed.data as Record<string, unknown>;
  if (data.phase !== 'in-progress') return md;
  data.phase = 'done';
  return matter.stringify(parsed.content.replace(/^\n/, ''), data);
}
