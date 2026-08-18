// @fd: feature-md-links-overhaul

import { basename } from 'node:path';

import { testsAdapter } from './adapters/tests.js';
import {
  buildSlugMap,
  collectTagged,
  extractTagsWith,
  parseRunOptions,
  runProjection,
} from './projection.js';
import type { TaggedFile } from './projection.js';

/** A test file path paired with the feature slugs it tagged via `// @tests:`. */
export type TaggedTest = TaggedFile;

/**
 * Extract the slug list from a test file's first `// @tests:` comment.
 *
 * @param content - Raw text content of the test file
 * @returns The list of tagged feature slugs
 */
export function extractTags(content: string): string[] {
  return extractTagsWith(content, testsAdapter.tagRe);
}

/**
 * Group test-file paths by the slug(s) they tag.
 *
 * @param tagged - Test files paired with their extracted tags
 * @returns A map from feature slug to the (sorted, deduped) list of test paths
 */
export function buildSlugToTestsMap(tagged: TaggedTest[]): Map<string, string[]> {
  return buildSlugMap(tagged);
}

/**
 * Walk the scan roots and pair each test file with its `// @tests:` tags.
 *
 * @param repoRoot - Absolute consumer root
 * @returns Tagged test files, relative to `repoRoot`
 */
export async function collectTaggedTests(repoRoot: string): Promise<TaggedTest[]> {
  return (await collectTagged(testsAdapter, repoRoot)).tagged;
}

async function main(): Promise<void> {
  process.exitCode = await runProjection(testsAdapter, parseRunOptions(process.argv));
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('sync-test-links');
if (invokedDirect) {
  void main();
}
