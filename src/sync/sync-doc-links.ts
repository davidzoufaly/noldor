// @fd: feature-md-links-overhaul

import { basename } from 'node:path';

import { docsAdapter } from './adapters/docs.js';
import {
  buildSlugMap,
  collectTagged,
  extractTagsWith,
  parseRunOptions,
  runProjection,
} from './projection.js';
import type { TaggedFile } from './projection.js';

/** A doc file path paired with the feature slugs it tagged via `<!-- @feature: -->`. */
export type TaggedDoc = TaggedFile;

/**
 * Extract the slug list from a doc file's first line-anchored
 * `<!-- @feature: -->` comment. A doc that merely quotes the convention inside a
 * table cell or after a bullet marker is not a tag.
 *
 * @param content - Raw doc contents
 * @returns The list of tagged feature slugs
 */
export function extractFeatureTags(content: string): string[] {
  return extractTagsWith(content, docsAdapter.tagRe);
}

/**
 * Group doc paths by tagged slug for writing back into `links.docs`.
 *
 * @param tagged - Doc files paired with their extracted tags
 * @returns A map from feature slug to the (sorted, deduped) list of doc paths
 */
export function buildSlugToDocsMap(tagged: TaggedDoc[]): Map<string, string[]> {
  return buildSlugMap(tagged);
}

/**
 * Walk the doc projection roots and pair each MD with its `<!-- @feature: -->` tags.
 *
 * @param repoRoot - Absolute consumer root
 * @returns Tagged doc files, relative to `repoRoot`
 */
export async function collectTaggedDocs(repoRoot: string): Promise<TaggedDoc[]> {
  return (await collectTagged(docsAdapter, repoRoot)).tagged;
}

async function main(): Promise<void> {
  process.exitCode = await runProjection(docsAdapter, parseRunOptions(process.argv));
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('sync-doc-links');
if (invokedDirect) {
  void main();
}
