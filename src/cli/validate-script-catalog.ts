// @fd: validate-script-catalog-gate
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { flattenManifest } from './manifest.js';

const CATALOG_PATH = 'docs/noldor/script-catalog.md';

/**
 * Markdown-link targets that resolve under `src/`, harvested from the catalog.
 * Matches `](../../src/foo/bar.ts)` and `](src/foo/bar.ts)`, tolerating an
 * optional `#anchor`, and normalizes away any leading `../` so the result is a
 * repo-relative `src/…` path comparable to a {@link ManifestLeaf.src}.
 */
const SRC_LINK_RE = /\]\((?:\.\.\/)*(src\/[^)#\s]+?\.ts)(?:#[^)]*)?\)/g;

/** Source-path diff between the manifest's leaf commands and the catalog. */
export interface ScriptCatalogDiff {
  /** Manifest leaf `src` paths not cited by any catalog source link (blocking). */
  readonly missingFromCatalog: readonly string[];
  /** Catalog-cited `src` paths that are not a manifest leaf entrypoint (advisory). */
  readonly extraInCatalog: readonly string[];
}

/**
 * The set of repo-relative `src/…` entrypoint paths owned by the CLI manifest.
 * Aliases that share an entrypoint (e.g. `autonomous run` + `autonomous
 * queue-drain` → `queue-drain.ts`) collapse to one member here, so documenting
 * that source once satisfies every alias.
 */
export function manifestSrcSet(): Set<string> {
  return new Set(flattenManifest().map((l) => l.src));
}

/**
 * Parse every `src/…` source link out of the catalog body. Harvests all
 * markdown-link targets (Source bullets under `### `-entries and the Source
 * column of the compact tables both use ordinary links), tolerant of the doc's
 * heterogeneous per-concern formatting.
 */
export function parseCatalogSrcs(contents: string): Set<string> {
  const srcs = new Set<string>();
  for (const m of contents.matchAll(SRC_LINK_RE)) {
    srcs.add(m[1]!);
  }
  return srcs;
}

/**
 * Pure set diff joined on the `src/…` path (not the display name — the
 * catalog's colon-form concern names do not map 1:1 to manifest `group sub`).
 *
 * @param manifestSrcs - Every manifest leaf's entrypoint `src`.
 * @param catalogSrcs - Every `src/…` link cited in the catalog.
 */
export function diffCatalogSrcs(
  manifestSrcs: ReadonlySet<string>,
  catalogSrcs: ReadonlySet<string>,
): ScriptCatalogDiff {
  const missingFromCatalog: string[] = [];
  const extraInCatalog: string[] = [];
  for (const s of manifestSrcs) {
    if (!catalogSrcs.has(s)) missingFromCatalog.push(s);
  }
  for (const s of catalogSrcs) {
    if (!manifestSrcs.has(s)) extraInCatalog.push(s);
  }
  return {
    missingFromCatalog: missingFromCatalog.toSorted(),
    extraInCatalog: extraInCatalog.toSorted(),
  };
}

async function main(): Promise<void> {
  const repo = process.cwd();
  const manifestSrcs = manifestSrcSet();
  const catalogContents = await readFile(join(repo, CATALOG_PATH), 'utf8');
  const catalogSrcs = parseCatalogSrcs(catalogContents);
  const diff = diffCatalogSrcs(manifestSrcs, catalogSrcs);

  if (diff.missingFromCatalog.length === 0) {
    console.log(
      `Validated script-catalog: ${manifestSrcs.size} manifest source(s) all cited in ${CATALOG_PATH} (${catalogSrcs.size} documented).`,
    );
    // Advisory only — extras are pnpm composites (scripts/…), helper modules, or
    // removed commands; they never block a commit.
    if (diff.extraInCatalog.length > 0) {
      console.log(
        `  note: ${diff.extraInCatalog.length} catalog source(s) are not manifest leaves`,
      );
    }
    return;
  }

  console.error(`✗ Manifest commands whose source is undocumented in ${CATALOG_PATH}:`);
  for (const s of diff.missingFromCatalog) console.error(`    ${s}`);
  console.error(
    `  Add a Source-linked entry for each to ${CATALOG_PATH} (and its templates/ twin).`,
  );
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
