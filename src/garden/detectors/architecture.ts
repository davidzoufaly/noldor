// @fd: consumer-architecture-doc-surface
import { checkArchitecture, type ArchitectureReport } from '../../docs/docs-architecture.js';

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
 * `itemId` is `<page>#<rule>` here and `<modules page>#<module>` for an
 * advisory, so every row has a stable identity, the two classes cannot collide
 * on the modules page, and a repeated run produces no duplicates.
 *
 * Empty when the surface is `absent`, which covers both a repo with no
 * `docs/architecture/` and one whose scaffold is still untouched: a consumer who
 * has not opted in is not drifting.
 */
export function toFindingGaps(report: ArchitectureReport): Gap[] {
  return gapsFrom(report, report.findings, (f) => f.rule);
}

/** Module advisories as gaps. Never routed into `sddGaps` — see {@link toFindingGaps}. */
export function toAdvisoryGaps(report: ArchitectureReport): Gap[] {
  return gapsFrom(report, report.advisories, (a) => a.module);
}

/**
 * Shared projection for both classes: `<page>#<discriminator>` as the stable id,
 * and nothing at all for a surface nobody opted into.
 *
 * The two classes differ only in what discriminates a row — a rule for a page
 * finding, a module path for an advisory — so they share one mapper rather than
 * two identical ones.
 */
function gapsFrom<T extends { page: string; message: string }>(
  report: ArchitectureReport,
  items: readonly T[],
  discriminator: (item: T) => string,
): Gap[] {
  if (report.status === 'absent') return [];
  return items.map((item) => ({
    category: 'architecture',
    itemId: `${item.page}#${discriminator(item)}`,
    message: item.message,
  }));
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
