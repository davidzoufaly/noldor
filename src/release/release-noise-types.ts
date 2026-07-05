// src/release/release-noise-types.ts
// @tests: fd-prs-since-last-release-section

/**
 * Conventional Commit types whose subjects do not appear in user-visible
 * release surfaces (FD `## Changelog` blocks, `## PRs` section, etc.). Shared
 * across the release-time changelog renderer and the dashboard-time PR
 * listing.
 */
export const NOISE_TYPES = new Set(['chore', 'docs', 'test', 'style', 'ci', 'build']);

/**
 * Drop the trailing `!` breaking marker from a Conventional Commit type.
 * `feat!` -> `feat`, `feat` -> `feat`.
 */
export function stripBang(type: string): string {
  return type.endsWith('!') ? type.slice(0, -1) : type;
}
