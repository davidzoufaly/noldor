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
  '.noldor/summary-body-rollout.json', // same reason: the summary-body activation snapshot must be committable through the gate it arms
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
 * emptiness means for them (the summary-body check passes on it; `composeBody`
 * never sees it, since `pr-flow` exits when no commits are ahead of base).
 *
 * Shared because the four allowlist predicates below differed only in which glob
 * list they consulted, which the clone detector eventually noticed.
 */
function everyPathMatches(paths: string[], globs: readonly string[]): boolean {
  if (paths.length === 0) return false;
  return paths.every((p) => globs.some((g) => minimatch(p, g, { dot: true })));
}

/**
 * Returns true when EVERY path is framework bookkeeping — a commit with no
 * behaviour to explain, exempt from the summary-body contract.
 *
 * An empty set returns `false`: the question is "is this set entirely
 * bookkeeping?", and an empty set proves nothing. Callers decide what emptiness
 * means for them (the commit-msg validator passes on it; `composeBody` never
 * sees it, since `pr-flow` exits when no commits are ahead of base).
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
 * Returns true if ALL paths are covered by the release-sweep allowlist.
 * A single file outside the allowlist taints the entire set — the sweep
 * cannot launder a source-code edit by piggy-backing on a graphify regen.
 */
export function isReleaseSweepAllowed(paths: string[]): boolean {
  return everyPathMatches(paths, RELEASE_SWEEP_GLOBS);
}
