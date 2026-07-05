// @fd: dynamic-fd-file-pointers-via-frontmatter

import { diffProjection } from '../../sync/sync-code-links.js';
import type { Gap } from '../../core/fd-load.js';

/**
 * Emit a Gap per FD whose cached `links.code` diverges from the `// @fd:` tag
 * scan. The cache is a projection (see the feature design's D1); this detector
 * is what keeps a stale projection from passing silently.
 *
 * @param scanned - slug → code paths from the tag scan
 * @param cached - slug → current `links.code` arrays
 * @returns One Gap per stale FD
 */
export function detectCodeLinksDrift(
  scanned: Map<string, string[]>,
  cached: Map<string, string[]>,
): Gap[] {
  return diffProjection(scanned, cached).map((d) => ({
    category: 'links.code drift',
    itemId: d.slug,
    message: `${d.slug}: links.code is stale vs // @fd: tags (run \`pnpm noldor sync code-links\`)`,
  }));
}
