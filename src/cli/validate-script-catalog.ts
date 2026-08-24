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

/**
 * A `pnpm noldor …` invocation cited anywhere in the catalog, capturing the
 * group token and an optional second token. Both the Trigger bullets under
 * `### `-entries and the Command column of the compact tables spell commands
 * this way, so one pattern harvests every citation form. Manifest groups and
 * subcommands are lowercase-kebab, so the token class deliberately excludes
 * flags (`--json`) and placeholders (`<slug>`, `[files…]`) — they can never be
 * mistaken for a subcommand.
 */
const COMMAND_RE = /pnpm\s+noldor\s+([a-z0-9][a-z0-9:-]*)(?:\s+([a-z0-9][a-z0-9:-]*))?/g;

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
 * that source once satisfies the *source* half of the gate. It does not satisfy
 * the alias itself — that is what {@link manifestCommandSet} covers.
 */
export function manifestSrcSet(): Set<string> {
  return new Set(flattenManifest().map((l) => l.src));
}

/**
 * The set of leaf `<group> <sub>` command names owned by the CLI manifest (a
 * `''`-subcommand group contributes its bare group name). Unlike
 * {@link manifestSrcSet} nothing collapses here, so an alias added to an
 * already-documented entrypoint stays visible to the gate.
 */
export function manifestCommandSet(): Set<string> {
  return new Set(flattenManifest().map((l) => l.command));
}

/**
 * Sweep `contents` with `re` and collect what `toValues` reads out of each
 * match. Both catalog harvests are this shape — the only thing that differs is
 * how many strings one match is worth.
 */
function harvest(
  contents: string,
  re: RegExp,
  toValues: (m: RegExpMatchArray) => readonly string[],
): Set<string> {
  const out = new Set<string>();
  for (const m of contents.matchAll(re)) {
    for (const v of toValues(m)) out.add(v);
  }
  return out;
}

/**
 * Parse every `src/…` source link out of the catalog body. Harvests all
 * markdown-link targets (Source bullets under `### `-entries and the Source
 * column of the compact tables both use ordinary links), tolerant of the doc's
 * heterogeneous per-concern formatting.
 */
export function parseCatalogSrcs(contents: string): Set<string> {
  return harvest(contents, SRC_LINK_RE, (m) => [m[1]!]);
}

/**
 * Every `pnpm noldor …` command cited in the catalog body, as both its bare
 * group form and its `<group> <sub>` form. A trailing token that is really an
 * argument (`unpark <slug>` yields nothing, `roadmap remove-block` yields the
 * real subcommand) can only ever add a citation nobody claims, and citations
 * are checked one-way — manifest → catalog — so a spurious member is inert.
 */
export function parseCatalogCommands(contents: string): Set<string> {
  return harvest(contents, COMMAND_RE, (m) => (m[2] ? [m[1]!, `${m[1]!} ${m[2]}`] : [m[1]!]));
}

/**
 * Manifest leaf commands that the catalog never spells out (blocking).
 *
 * This is the alias half of the gate. {@link diffCatalogSrcs} joins on the
 * entrypoint path, which a second alias on an already-documented source
 * satisfies for free; this join is on the command name, so every
 * `<group> <sub>` must appear somewhere in the catalog — either in its own
 * entry or named by the shared entry that covers it.
 *
 * One-way by design: the catalog is prose and cites forms that are not manifest
 * leaves (pnpm composites, argument tokens harvested by
 * {@link parseCatalogCommands}), so there is no useful "extra" side here.
 *
 * @param manifestCommands - Every manifest leaf's `<group> <sub>` name.
 * @param catalogCommands - Every `pnpm noldor …` form cited in the catalog.
 */
export function diffCatalogCommands(
  manifestCommands: ReadonlySet<string>,
  catalogCommands: ReadonlySet<string>,
): readonly string[] {
  const missing: string[] = [];
  for (const c of manifestCommands) {
    if (!catalogCommands.has(c)) missing.push(c);
  }
  return missing.toSorted();
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
  const manifestCommands = manifestCommandSet();
  const catalogContents = await readFile(join(repo, CATALOG_PATH), 'utf8');
  const catalogSrcs = parseCatalogSrcs(catalogContents);
  const catalogCommands = parseCatalogCommands(catalogContents);
  const diff = diffCatalogSrcs(manifestSrcs, catalogSrcs);
  const missingCommands = diffCatalogCommands(manifestCommands, catalogCommands);

  if (diff.missingFromCatalog.length === 0 && missingCommands.length === 0) {
    console.log(
      `Validated script-catalog: ${manifestCommands.size} manifest command(s) over ${manifestSrcs.size} source(s), all cited in ${CATALOG_PATH} (${catalogSrcs.size} source(s) documented).`,
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

  if (diff.missingFromCatalog.length > 0) {
    console.error(`✗ Manifest commands whose source is undocumented in ${CATALOG_PATH}:`);
    for (const s of diff.missingFromCatalog) console.error(`    ${s}`);
    console.error(
      `  Add a Source-linked entry for each to ${CATALOG_PATH} (and its templates/ twin).`,
    );
  }

  if (missingCommands.length > 0) {
    console.error(`✗ Manifest commands never named in ${CATALOG_PATH}:`);
    for (const c of missingCommands) console.error(`    pnpm noldor ${c}`);
    console.error(
      `  An alias on an already-documented entrypoint still needs naming: spell it in the`,
    );
    console.error(
      `  entry that covers its source, or give it its own entry (and mirror the templates/ twin).`,
    );
  }

  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
