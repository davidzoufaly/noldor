// @fd: architecture-decision-record-surface
import { checkAdr, type AdrReport } from '../../docs/docs-adr.js';

import type { Gap } from '../../core/fd-load.js';

/**
 * Decision-record gaps for the SDD report.
 *
 * Every `checkAdr` finding joins the blocking class deliberately: an invalid
 * record already blocks the release row (`preflight-probes.ts` `adr`), so
 * garden reporting it through `sddGaps` — which gates the auto-restamp — is
 * consistent rather than a new cliff. There is no advisory class here; the
 * architecture surface's advisory split existed for module-staleness nags,
 * which have no ADR equivalent.
 *
 * `itemId` is `<file>#<rule>`, so every row has a stable identity and a
 * repeated run produces no duplicates. Empty on `absent` — a repo with no
 * records is not drifting.
 *
 * Called by the `garden sdd-report` loader so the gaps land in
 * `docs/sdd-report.md`; `garden detect` picks them up for free because its
 * `loadSddGaps` shells that same report — one wiring, both surfaces.
 *
 * @param repo - Repository root
 */
export async function detectAdrFindings(repo: string): Promise<Gap[]> {
  return toGaps(await checkAdr(repo));
}

/** Pure projection, split out so tests need no filesystem. */
export function toGaps(report: AdrReport): Gap[] {
  if (report.status === 'absent') return [];
  return report.findings.map((finding) => ({
    category: 'adr',
    itemId: `${finding.file}#${finding.rule}`,
    message: finding.message,
  }));
}
