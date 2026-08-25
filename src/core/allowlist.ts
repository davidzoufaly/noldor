import { minimatch } from 'minimatch';

export const MICRO_CHORE_GLOBS = [
  'docs/**/*.md',
  '.claude/**',
  '*.md', // root-level markdown only
  'lefthook.yml', // framework hook config — single-line hook edits land via micro-chore
  '.gitignore', // ignore-policy edits (e.g. operator-local marker files) land via micro-chore
  'templates/.claude/**', // template twins of `.claude/**` skills — template-sync forces editing both, so the twin must share the micro-chore lane
  'templates/docs/**/*.md', // template twins of `docs/**` pages — check-template-sync forces mirroring both, so the twin must share the micro-chore lane
  '.noldor/rollout-marker', // arming commit: the marker must be committable through the wall it arms
  // Triage bookkeeping the gate itself writes: `triage mint-id` bumps the counter into the
  // same commit as the roadmap block, and `roadmap remove-block` records the retired ID.
  // Both are listed in BOOKKEEPING_GLOBS; without them here a triage commit — the framework's
  // own paperwork — can only land through a `Noldor-Path-Override`.
  '.noldor/id-counter.json',
  '.noldor/retired-entry-ids.json',
] as const;

/**
 * Globs admitted under the `release-sweep` path. The sweep multi-commits
 * across graphify output, sdd-report regen, release-notes prep, and skill
 * self-edits; everything below must be a sweep-step output, never source code.
 */
export const RELEASE_SWEEP_GLOBS = [
  'graphify-out/**',
  'docs/sdd-report.md',
  'docs/release-notes.md',
  'CHANGELOG.md',
  'docs/user/reference/api/**/*.md',
  'docs/noldor/**/*.md',
  'templates/docs/**/*.md', // template twins of `docs/noldor/**` pages — release-markers stamps `introduced:` on both sides of the twin
  'docs/features/**/*.md',
  'docs/design/plans/**/*.md',
  'docs/design/specs/**/*.md',
  '.claude/skills/noldor-release-sweep/**',
] as const;

/**
 * Paths that carry no code: framework bookkeeping the gate writes on its own.
 *
 * Deliberately NOT a reuse of {@link MICRO_CHORE_GLOBS}: that list governs which
 * *lane* may land a change, this one governs whether a commit has any behaviour
 * to explain. Coupling them would let a widening of one silently widen the other.
 *
 * `ideas.md` and `.noldor/id-counter.json` are here because the framework's own
 * bookkeeping commits stage them — `/noldor-triage` writes `ideas.md` beside
 * `docs/roadmap.md`, and `triage mint-id` bumps the counter into the same commit
 * as a freshly scaffolded FD.
 */
export const BOOKKEEPING_GLOBS = [
  'docs/roadmap.md',
  'docs/backlog.md',
  'docs/features/**/*.md',
  'docs/design/**/*.md',
  'docs/milestones/**/*.md',
  'ideas.md',
  '.noldor/retired-entry-ids.json',
  '.noldor/id-counter.json',
  '.noldor/design/**',
] as const;

/**
 * Paths whose retirement bookkeeping a `roadmap remove-block` commit stages.
 *
 * Both, not just the roadmap: since Q-0107 `remove-block` records the removed
 * entry's ID in `.noldor/retired-entry-ids.json` so `blocked-by:` references keep
 * resolving, so a real retirement commit touches the pair (verified against
 * `ef974e2`, PR #318). A predicate naming only the roadmap never matches one.
 */
export const RETIREMENT_GLOBS = ['docs/roadmap.md', '.noldor/retired-entry-ids.json'] as const;

/**
 * Paths whose change alters executable behaviour.
 *
 * The criterion is "does a reviewer need typecheck/test evidence?" — NOT
 * micro-chore membership, which merely correlates. `lefthook.yml` is on both
 * this list and {@link MICRO_CHORE_GLOBS}: it wires the hook chain, so editing
 * it changes what runs on every commit, whatever lane lands it.
 *
 * This is also not the negation of {@link BOOKKEEPING_GLOBS}: `docs/noldor/**`,
 * root `*.md` and the `templates/` prose twins are neither bookkeeping nor code,
 * and treating them as code hands a prose PR a checklist with nothing to run.
 */
export const CODE_GLOBS = [
  'src/**',
  'bin/**',
  'scripts/**',
  'lefthook/**',
  'lefthook.yml',
  '.github/workflows/**',
  '.noldor/rules/**',
  '*.json', // root-level manifests only (package.json, tsconfig.json, …)
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.cjs',
  'templates/**',
] as const;

/**
 * Prose twins that {@link CODE_GLOBS}' `templates/**` would otherwise swallow.
 *
 * `checks template-sync` forces these to be edited alongside their `.claude/**`
 * and `.opencode/**` originals, so a pure skill- or command-prose PR would
 * otherwise render a typecheck/test/dogfood checklist it cannot satisfy.
 */
export const CODE_EXCLUDE_GLOBS = [
  'templates/docs/**',
  'templates/.claude/**',
  'templates/.opencode/**',
  'templates/AGENTS.md',
] as const;

/**
 * True when every path matches at least one of `globs`.
 *
 * An empty set returns `false`, for every caller: each asks "is this set
 * entirely X?", and an empty set proves nothing either way. Callers decide what
 * emptiness means for them (`composeBody` never sees one, since `pr-flow` exits
 * when no commits are ahead of base).
 *
 * Shared because the four allowlist predicates below differed only in which glob
 * list they consulted, which the clone detector eventually noticed.
 */
function everyPathMatches(paths: string[], globs: readonly string[]): boolean {
  if (paths.length === 0) return false;
  return paths.every((p) => globs.some((g) => minimatch(p, g, { dot: true })));
}

/**
 * The subset of `paths` matching none of `globs` — order-preserving.
 *
 * The complement of {@link everyPathMatches}, minus its empty-set convention: an
 * empty set has no offenders, so this returns `[]` where the predicate returns
 * `false`. Callers use it to name the files that actually failed, rather than
 * reprinting the whole staged set and leaving the operator to diff it by eye.
 */
function pathsOutside(paths: string[], globs: readonly string[]): string[] {
  return paths.filter((p) => !globs.some((g) => minimatch(p, g, { dot: true })));
}

/**
 * Returns true when EVERY path is framework bookkeeping — a change with no
 * behaviour to explain, exempt from the Why/How/What contract.
 *
 * An empty set returns `false`: the question is "is this set entirely
 * bookkeeping?", and an empty set proves nothing. Callers decide what emptiness
 * means for them (`composeBody` never sees one, since `pr-flow` exits when no
 * commits are ahead of base).
 */
export function isBookkeepingOnly(paths: string[]): boolean {
  return everyPathMatches(paths, BOOKKEEPING_GLOBS);
}

/**
 * Returns true when EVERY path belongs to roadmap-entry retirement — the branch
 * shape that gets `composeBody`'s deterministic Summary template.
 */
export function isRetirementOnly(paths: string[]): boolean {
  return everyPathMatches(paths, RETIREMENT_GLOBS);
}

/**
 * Returns true when ANY path alters executable behaviour — one code file is
 * enough to earn the code Test Plan, however much prose rides alongside.
 */
export function touchesCode(paths: string[]): boolean {
  return paths.some(
    (p) =>
      CODE_GLOBS.some((g) => minimatch(p, g, { dot: true })) &&
      !CODE_EXCLUDE_GLOBS.some((g) => minimatch(p, g, { dot: true })),
  );
}

/**
 * Returns true if ALL paths are covered by the micro-chore allowlist.
 * A single file outside the allowlist taints the entire set.
 */
export function isMicroChoreAllowed(paths: string[]): boolean {
  return everyPathMatches(paths, MICRO_CHORE_GLOBS);
}

/**
 * The paths that put {@link isMicroChoreAllowed} at `false` — the rejection's
 * actual offenders, for the operator-facing message.
 */
export function microChoreOffenders(paths: string[]): string[] {
  return pathsOutside(paths, MICRO_CHORE_GLOBS);
}

/**
 * Union of the two lanes that land a change with no review receipt.
 *
 * Not a widening of either lane: `isMicroChoreAllowed` and
 * `isReleaseSweepAllowed` still gate their own commits at pre-commit, and
 * neither list grows. This list exists for the release-time audit, which asks a
 * different question — "did this diff need a review at all?" — of a squash
 * commit that can carry BOTH lanes at once.
 */
export const NO_REVIEW_LANE_GLOBS = [...MICRO_CHORE_GLOBS, ...RELEASE_SWEEP_GLOBS] as const;

/**
 * Returns true when EVERY path belongs to some no-review lane — micro-chore or
 * release-sweep, in any mixture.
 *
 * Deliberately a union of the glob sets, not an `isMicroChoreAllowed(paths) ||
 * isReleaseSweepAllowed(paths)`: GitHub squashes a sweep PR's commits into one
 * commit, so its diff carries `ideas.md` (micro-chore-only) beside
 * `graphify-out/**` (sweep-only), and each half fails the other predicate — the
 * `||` reds a diff containing zero code. That was the v1.4.0 release (sweep PR
 * #354), whose only way through was a per-SHA `release.crGateExemptCommits`
 * waiver.
 *
 * Still per-file, so a source edit riding along taints the whole set exactly as
 * it does in each lane on its own.
 */
export function isNoReviewLaneAllowed(paths: string[]): boolean {
  return everyPathMatches(paths, NO_REVIEW_LANE_GLOBS);
}

/**
 * Returns true if ALL paths are covered by the release-sweep allowlist.
 * A single file outside the allowlist taints the entire set — the sweep
 * cannot launder a source-code edit by piggy-backing on a graphify regen.
 */
export function isReleaseSweepAllowed(paths: string[]): boolean {
  return everyPathMatches(paths, RELEASE_SWEEP_GLOBS);
}

/**
 * The paths that put {@link isReleaseSweepAllowed} at `false` — the rejection's
 * actual offenders, for the operator-facing message.
 */
export function releaseSweepOffenders(paths: string[]): string[] {
  return pathsOutside(paths, RELEASE_SWEEP_GLOBS);
}
