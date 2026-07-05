// Single source of truth for the area → user-facing release-notes Category
// mapping. The /promote skill (`.claude/skills/promote/SKILL.md` step 4)
// uses this as the default category suggestion when scaffolding an FD; the
// dashboard `/backlog` view uses it to derive a category column for entries
// that ship only the `- area:` bullet (no explicit `- category:`).
//
// The map is CONSUMER-OWNED — it lives in `.noldor/config.json`
// (`consumer.areaCategories`), not hardcoded here, so the taxonomy is generic
// across projects and grows as the project does.

import { loadAreaCategories } from '../core/consumer-config.js';

import type { Category } from '../core/feature-schema.js';

/**
 * Map an `area` slug to its user-facing release-notes {@link Category} using
 * the consumer's configured `areaCategories` map. Unknown areas (and the
 * no-config bootstrap case) fall back to `'Other'`. Pass an explicit map to
 * avoid the config read.
 *
 * @param area - Source-block `- area:` value (e.g. `tooling`, `core`).
 * @param map - Optional area→category map; defaults to the consumer config's.
 * @returns The mapped `Category`, or `'Other'` when unmapped.
 *
 * @example
 * ```ts
 * areaToCategory('tooling', { tooling: 'Tooling' }); // 'Tooling'
 * areaToCategory('mystery', {});                     // 'Other'
 * ```
 */
export function areaToCategory(
  area: string,
  map: Record<string, string> = loadAreaCategories(),
): Category {
  return map[area] ?? 'Other';
}

export type { Category };
