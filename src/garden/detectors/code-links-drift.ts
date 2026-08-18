// @fd: dynamic-fd-file-pointers-via-frontmatter, feature-md-links-overhaul

import { diffProjection } from '../../sync/projection.js';
import type { LinkAdapter } from '../../sync/projection.js';
import type { Gap } from '../../core/fd-load.js';

/** The `sync` subcommand that repairs each kind's drift. */
const REPAIR_COMMAND: Record<LinkAdapter['key'], string> = {
  code: 'sync code-links',
  tests: 'sync test-links',
  docs: 'sync doc-links',
};

/**
 * Emit a Gap per FD whose cached `links.<kind>` diverges from its tag scan. The
 * cache is a projection, and this detector is what keeps a stale one from
 * passing silently. Reuses `diffProjection` so a gap can never disagree with
 * what `sync <kind>-links --check` reports.
 *
 * @param scanned - slug → paths from the tag scan
 * @param cached - slug → current `links.<kind>` arrays
 * @param adapter - The kind being checked
 * @returns One Gap per stale FD
 */
export function detectLinksDrift(
  scanned: Map<string, string[]>,
  cached: Map<string, string[]>,
  adapter: LinkAdapter,
): Gap[] {
  return diffProjection(scanned, cached, adapter).map((d) => ({
    category: `links.${adapter.key} drift`,
    itemId: d.slug,
    message: `${d.slug}: links.${adapter.key} is stale vs ${adapter.tagLabel} tags (run \`pnpm noldor ${REPAIR_COMMAND[adapter.key]}\`)`,
  }));
}
