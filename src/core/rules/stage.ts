import type { Path } from '../session.js';

/**
 * Lifecycle stage — cascade key 2 for rule resolution.
 * `triage` is pre-gate (no session path); `review` is a transient sub-state of
 * code paths. Both are only ever passed explicitly by callers (triage skill, CR
 * flow). `pathToStage` only projects the persisted session path, so it returns
 * the two stages a session marker can be in.
 */
export type Stage = 'triage' | 'code' | 'review' | 'release';

/**
 * Runtime twin of {@link Stage}, kept beside the union so the two cannot drift.
 * Used by `RuleFrontmatterSchema` to validate authored frontmatter and by
 * `rules brief` to validate a `--stage` argument at the CLI trust boundary.
 */
export const STAGES = ['triage', 'code', 'review', 'release'] as const satisfies readonly Stage[];

const RELEASE_PATHS = new Set<Path>(['release-sweep', 'release-automation']);

export function pathToStage(path: Path): Extract<Stage, 'code' | 'release'> {
  return RELEASE_PATHS.has(path) ? 'release' : 'code';
}
