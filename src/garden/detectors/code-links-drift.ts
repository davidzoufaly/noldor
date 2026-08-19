// @fd: dynamic-fd-file-pointers-via-frontmatter, feature-md-links-overhaul

import { basename } from 'node:path';

import { buildSlugMap, diffProjection, missingFdSlugs } from '../../sync/projection.js';
import type { CachedLoad, LinkAdapter, ScanResult } from '../../sync/projection.js';
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

/**
 * Every links-drift gap for one detection pass, across all three kinds.
 *
 * Failure scope is the whole point here. An unreadable *features directory*
 * leaves the cache unknown rather than empty, so diffing against it would
 * report every FD as drifted — that withdraws all cache-dependent claims. A
 * single unparseable FD only withdraws claims about itself. An unreadable scan
 * root withdraws its own kind, independent of the cache. Each is reported, none
 * is swallowed: these gaps gate releases, so a silent skip reads as green
 * exactly when the inputs are broken.
 *
 * @param scans - Per-kind scan results, keyed as {@link LinkAdapter.key}
 * @param cached - One pass over the feature MDs, failures included
 * @param adapters - The kinds to report on
 * @returns Gaps for unreadable inputs plus the drift they did not prevent
 */
export function linksDriftGaps(
  scans: Map<LinkAdapter['key'], ScanResult>,
  cached: CachedLoad,
  adapters: readonly LinkAdapter[],
): Gap[] {
  const gaps: Gap[] = [];
  const cacheUnavailable = cached.failures.filter((f) => f.kind === 'features-dir');
  const perFd = cached.failures.filter((f) => f.kind === 'feature-md');
  const unreadable = new Set(perFd.map((f) => basename(f.root, '.md')));

  for (const failure of cacheUnavailable) {
    gaps.push({
      category: 'links drift',
      itemId: 'docs/features',
      message: `${failure.root}: ${failure.what} (${failure.code}) — links drift not checked`,
    });
  }
  // Iterate the failures rather than a set of slugs: each one already says what
  // went wrong in the operator's terms, and an FD with sound frontmatter but
  // wrong permissions must not be reported as unparseable.
  for (const failure of perFd) {
    gaps.push({
      category: 'links drift',
      itemId: basename(failure.root, '.md'),
      message: `${failure.root}: ${failure.what} (${failure.code}) — links drift not checked for it`,
    });
  }

  for (const adapter of adapters) {
    const scan = scans.get(adapter.key);
    if (!scan) continue;
    if (scan.failures.length > 0) {
      for (const failure of scan.failures) {
        gaps.push({
          category: `links.${adapter.key} drift`,
          itemId: adapter.key,
          message: `${failure.root}: unreadable (${failure.code}) — links.${adapter.key} drift not checked`,
        });
      }
      continue;
    }
    if (cacheUnavailable.length > 0) continue;
    const scanned = buildSlugMap(scan.tagged);
    const cachedForKind = cached.byKey.get(adapter.key) ?? new Map<string, string[]>();
    // A tag naming no feature MD is not drift — no sync run can reconcile it —
    // but it still has to be gated, or a typo'd tag silently detaches a file
    // from its feature. It gets its own category so the remedy is honest.
    for (const slug of missingFdSlugs(scanned, cachedForKind)) {
      gaps.push({
        category: `links.${adapter.key} missing FD`,
        itemId: slug,
        message: `${adapter.tagLabel} "${slug}" is tagged in ${scanned.get(slug)?.length ?? 0} file(s) but docs/features/${slug}.md does not exist — fix the tag or create the FD`,
      });
    }
    gaps.push(
      ...detectLinksDrift(scanned, cachedForKind, adapter).filter(
        (gap) => !unreadable.has(gap.itemId),
      ),
    );
  }
  return gaps;
}
