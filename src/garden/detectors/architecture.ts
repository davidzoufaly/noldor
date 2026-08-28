// @fd: consumer-architecture-doc-surface
import {
  checkArchitecture,
  type ArchitectureAdvisory,
  type ArchitectureReport,
} from '../../docs/docs-architecture.js';

import type { Gap } from '../../core/fd-load.js';

/**
 * Blocking architecture gaps — the registry pages that are missing, unfilled or
 * undrawable.
 *
 * The split between this and {@link toAdvisoryGaps} is load-bearing, not
 * cosmetic. `sddGaps` is one of the `FINDING_CATEGORIES` the garden
 * auto-restamp keys on (`src/garden/garden-detect-runner.ts`), and an unstamped
 * receipt is a blocking release row — so **anything routed into `sddGaps`
 * blocks a release**. Page findings are meant to; module advisories are
 * explicitly not (see the FD: "Do U3's module findings block a release?" →
 * advisory only). Routing both through one channel is what would silently make
 * a renamed directory stop a release.
 *
 * `itemId` is `<page>#<rule>` here and `<page>#<kind>:<discriminator>` for an
 * advisory, so every row has a stable identity, the two classes cannot collide
 * on one page, and a repeated run produces no duplicates.
 *
 * Empty when the surface is `absent`, which covers both a repo with no
 * `docs/architecture/` and one whose scaffold is still untouched: a consumer who
 * has not opted in is not drifting.
 */
export function toFindingGaps(report: ArchitectureReport): Gap[] {
  if (report.status === 'absent') return [];
  return report.findings.map((finding) => ({
    category: 'architecture',
    itemId: `${finding.page}#${finding.rule}`,
    message: finding.message,
  }));
}

/** Advisory rows as gaps. Never routed into `sddGaps` — see {@link toFindingGaps}. */
export function toAdvisoryGaps(report: ArchitectureReport): Gap[] {
  if (report.status === 'absent') return [];
  return report.advisories.map((advisory) => ({
    category: 'architecture',
    itemId: `${advisory.page}#${advisoryDiscriminator(advisory)}`,
    message: advisory.message,
  }));
}

/**
 * Stable per-row identity, prefixed by `kind` so two variants cannot collide on
 * one page.
 *
 * Every variant contributes something that distinguishes it from its siblings,
 * so a repeated run produces no duplicates — the promise this file documents.
 * A single `(a) => a.module` discriminator cannot serve the widened union: every
 * non-module row would render `<page>#undefined`, and two of them on one page
 * would collapse into a single gap.
 */
function advisoryDiscriminator(advisory: ArchitectureAdvisory): string {
  switch (advisory.kind) {
    case 'module':
      return `module:${advisory.module}`;
    case 'section':
      return `section:${advisory.section}`;
    case 'unknown-cut':
      return `unknown-cut:${advisory.section}:${advisory.ordinal}`;
    case 'flow-headings':
      return 'flow-headings';
  }
}

/**
 * Blocking architecture gaps for the SDD report.
 *
 * Called by the `garden sdd-report` loader so the gaps land in
 * `docs/sdd-report.md`. `garden detect` then picks them up for free, because its
 * `loadSddGaps` shells that same report — one wiring, both surfaces.
 *
 * @param repo - Repository root
 */
export async function detectArchitectureFindings(repo: string): Promise<Gap[]> {
  return toFindingGaps(await checkArchitecture(repo));
}

/**
 * Advisory architecture gaps for `garden detect`.
 *
 * Surfaced on their own `GardenFindings` key, deliberately absent from
 * `FINDING_CATEGORIES`, so they are reported without gating the auto-restamp and
 * therefore without blocking a release.
 *
 * @param repo - Repository root
 */
export async function detectArchitectureAdvisories(repo: string): Promise<Gap[]> {
  return toAdvisoryGaps(await checkArchitecture(repo));
}
