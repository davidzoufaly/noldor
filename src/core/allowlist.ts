import { minimatch } from 'minimatch';

export const MICRO_CHORE_GLOBS = [
  'docs/**/*.md',
  '.claude/**',
  '*.md', // root-level markdown only
  'lefthook.yml', // framework hook config — single-line hook edits land via micro-chore
  '.gitignore', // ignore-policy edits (e.g. operator-local marker files) land via micro-chore
  'templates/.claude/**', // template twins of `.claude/**` skills — template-sync forces editing both, so the twin must share the micro-chore lane
  '.noldor/rollout-marker', // arming commit: the marker must be committable through the wall it arms
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
  'docs/features/**/*.md',
  'docs/superpowers/plans/**/*.md',
  'docs/superpowers/specs/**/*.md',
  '.claude/skills/noldor-release-sweep/**',
] as const;

/**
 * Returns true if ALL paths are covered by the micro-chore allowlist.
 * A single file outside the allowlist taints the entire set.
 */
export function isMicroChoreAllowed(paths: string[]): boolean {
  if (paths.length === 0) return false;
  return paths.every((p) => MICRO_CHORE_GLOBS.some((g) => minimatch(p, g, { dot: true })));
}

/**
 * Returns true if ALL paths are covered by the release-sweep allowlist.
 * A single file outside the allowlist taints the entire set — the sweep
 * cannot launder a source-code edit by piggy-backing on a graphify regen.
 */
export function isReleaseSweepAllowed(paths: string[]): boolean {
  if (paths.length === 0) return false;
  return paths.every((p) => RELEASE_SWEEP_GLOBS.some((g) => minimatch(p, g, { dot: true })));
}
