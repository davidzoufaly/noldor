// Single source of truth for the area → user-facing release-notes Category
// mapping. The /promote skill (`.claude/skills/promote/SKILL.md` step 4)
// uses this as the default category suggestion when scaffolding an FD; the
// dashboard `/backlog` view uses it to derive a category column for entries
// that ship only the `- area:` bullet (no explicit `- category:`). Keep
// this module in sync with the FD frontmatter `CATEGORIES` enum at
// `scripts/features/feature-schema.ts`.

import type { Category } from '../features/feature-schema.js';

const AREA_TO_CATEGORY: Record<string, Category> = {
  engine: 'Modeling',
  format: 'Modeling',
  viewport: 'Editor',
  web: 'Editor',
  ui: 'Editor',
  'agent-api': 'Agents',
  branding: 'Distribution',
  business: 'Distribution',
  release: 'Distribution',
  docs: 'Docs',
  tooling: 'Tooling',
  testing: 'Tooling',
  'cross-cutting': 'Tooling',
};

/**
 * Map an `area` slug to its user-facing release-notes {@link Category}.
 * Unknown areas fall back to `'Other'`. Pure — no I/O.
 *
 * @param area - Source-block `- area:` value (e.g. `engine`, `web`).
 * @returns The matching `Category` literal, or `'Other'` for unknown areas.
 *
 * @example
 * ```ts
 * areaToCategory('engine');   // 'Modeling'
 * areaToCategory('web');      // 'Editor'
 * areaToCategory('quux');     // 'Other'
 * ```
 */
export function areaToCategory(area: string): Category {
  return AREA_TO_CATEGORY[area] ?? 'Other';
}

export type { Category };
