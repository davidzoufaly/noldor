// @fd: dynamic-fd-file-pointers-via-frontmatter, feature-md-links-overhaul

import { basename } from 'node:path';

import { scanRoots } from '../core/repo-paths.js';
import { codeAdapter } from './adapters/code.js';
import {
  buildSlugMap,
  collectTagged,
  extractTagsWith,
  loadCached,
  parseRunOptions,
  project,
  runProjection,
  diffProjection as diffProjectionWith,
  taglessKeptSlugs as taglessKeptSlugsWith,
} from './projection.js';
import type { LinkAdapter, Projection, ProjectionDrift, TaggedFile } from './projection.js';

// Compatibility re-export: the provider moved to src/core/repo-paths.ts
// (single definition). Existing importers keep this path; new code should
// import from '../core/repo-paths.js' directly.
export { scanRoots };
export type { ProjectionDrift };

/** A code file path paired with the FD slugs it tagged via `// @fd:`. */
export type TaggedCode = TaggedFile;

/** What the scan projects onto one FD's `links.code`. */
export type LinksCodeProjection = Projection;

/**
 * Extract the slug list from a code file's first `// @fd:` comment.
 *
 * @param content - Raw text content of the code file
 * @returns The list of tagged feature slugs
 */
export function extractFdTags(content: string): string[] {
  return extractTagsWith(content, codeAdapter.tagRe);
}

/**
 * Group code-file paths by the slug(s) they tag.
 *
 * @param tagged - Code files paired with their extracted tags
 * @returns A map from feature slug to the (sorted, deduped) list of code paths
 */
export function buildSlugToCodeMap(tagged: TaggedCode[]): Map<string, string[]> {
  return buildSlugMap(tagged);
}

/**
 * Walk the scan roots and pair each code file with its `// @fd:` tags.
 *
 * @param repoRoot - Absolute consumer root
 * @returns Tagged code files, relative to `repoRoot`
 */
export async function collectTaggedCode(repoRoot: string): Promise<TaggedCode[]> {
  return (await collectTagged(codeAdapter, repoRoot)).tagged;
}

/**
 * Project one FD's scanned tags onto its cached `links.code`, guarding the
 * total-wipe case and preserving directory entries.
 *
 * @param scanned - Code paths this FD's tags produced
 * @param current - The FD's existing `links.code`
 * @param force - Clear file entries even when the scan matched nothing
 * @returns The array to write, or `{ skipped: true }`
 */
export function projectLinksCode(
  scanned: string[],
  current: string[],
  force = false,
): LinksCodeProjection {
  return project(scanned, current, codeAdapter, force);
}

/**
 * Compare the scanned projection against each FD's cached `links.code`.
 *
 * @param scanned - slug → code paths derived from `// @fd:` tags
 * @param cached - slug → current `links.code` arrays
 * @param adapter - Kind override, defaulting to the code adapter
 * @returns One ProjectionDrift per stale FD
 */
export function diffProjection(
  scanned: Map<string, string[]>,
  cached: Map<string, string[]>,
  adapter: LinkAdapter = codeAdapter,
): ProjectionDrift[] {
  return diffProjectionWith(scanned, cached, adapter);
}

/**
 * The FDs a plain `sync code-links` run leaves alone.
 *
 * @param scanned - slug → code paths derived from `// @fd:` tags
 * @param cached - slug → current `links.code` arrays
 * @returns The affected slugs, sorted
 */
export function taglessKeptSlugs(
  scanned: Map<string, string[]>,
  cached: Map<string, string[]>,
): string[] {
  return taglessKeptSlugsWith(scanned, cached, codeAdapter);
}

/** Load each FD's current `links.code` array, keyed by slug, from `featuresDir`. */
export async function loadCachedCode(featuresDir: string): Promise<Map<string, string[]>> {
  return loadCached(featuresDir, 'code');
}

async function main(): Promise<void> {
  process.exitCode = await runProjection(codeAdapter, parseRunOptions(process.argv));
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('sync-code-links');
if (invokedDirect) {
  void main();
}
