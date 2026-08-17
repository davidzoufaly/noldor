// @fd: consumer-architecture-doc-surface
import { checkArchitecture } from '../../docs/docs-architecture.js';

import type { Gap } from '../../core/fd-load.js';

/**
 * Architecture-surface drift, as garden gaps.
 *
 * Deliberately ONE detector rather than a garden-specific finding type plus a
 * separate SDD-report gap builder: garden already surfaces `sddGaps`, so a
 * single `Gap[]` producer reaches both the `/noldor-garden` report and
 * `docs/sdd-report.md` — the same shape `detectFdLinkRot` and
 * `detectCodeLinksDrift` use.
 *
 * Returns nothing when the surface is `absent`, which covers both a repo with no
 * `docs/architecture/` and one whose scaffold is still untouched — a consumer
 * who has not opted in is not drifting.
 *
 * Blocking findings and advisory module gaps both appear here because garden is
 * advisory throughout; only the release probe distinguishes them.
 *
 * `itemId` is `<page>#<rule>` for a finding and `<modules page>#<module>` for an
 * advisory, so every row has a stable identity, the two classes cannot collide
 * on the modules page, and a repeated run produces no duplicates.
 *
 * @param repo - Repository root
 * @returns One gap per finding and per module advisory
 */
export async function detectArchitectureGaps(repo: string): Promise<Gap[]> {
  const report = await checkArchitecture(repo);
  if (report.status === 'absent') return [];
  return [
    ...report.findings.map((f) => ({
      category: 'architecture',
      itemId: `${f.page}#${f.rule}`,
      message: f.message,
    })),
    ...report.advisories.map((a) => ({
      category: 'architecture',
      itemId: `${a.page}#${a.module}`,
      message: a.message,
    })),
  ];
}
