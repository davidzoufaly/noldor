// @fd: feature-md-links-overhaul

import { docProjectionRoots } from '../../core/doc-roots.js';
import type { LinkAdapter } from '../projection.js';

/** Repo-relative prefix of the framework-owned templated doc tree. */
const TEMPLATED_PREFIX = 'docs/noldor/';

/**
 * `links.docs`, projected from `<!-- @feature: -->` tags on user docs.
 *
 * The tag pattern is anchored to line start, matching the `^`-anchored code and
 * test patterns. Unanchored it also matches the literal example string
 * `<!-- @feature: <slug> -->` wherever a doc quotes the convention inside a table
 * cell or after a bullet marker.
 */
export const docsAdapter: LinkAdapter = {
  key: 'docs',
  tagRe: /^<!--\s*@feature:\s*(.+?)\s*-->/m,
  roots: (cwd) => docProjectionRoots(cwd).map((path) => ({ path, origin: 'default' as const })),
  eligible: (name) => name.endsWith('.md'),
  preserve: () => false,
  // `docs/noldor/` is a byte-identical twin of `templates/docs/noldor/`, synced
  // verbatim on upgrade. A consumer cannot add a tag there without redding
  // `checks template-sync`, and their edit is overwritten on the next upgrade —
  // so a cached entry pointing there is not something anyone can act on.
  unownable: (p) => p.startsWith(TEMPLATED_PREFIX),
  tagLabel: '<!-- @feature: -->',
};
