// @fd: feature-md-links-overhaul

import { testsAdapter } from './adapters/tests.js';
import { extractTagsWith, parseRunOptions, runProjection } from './projection.js';
import { isEntrypoint } from '../core/cli-entry.js';

/**
 * Extract the slug list from a test file's first `// @tests:` comment.
 *
 * Kept as a named export because the tag syntax is a public convention
 * `validate features` and the SDD report both check; the projection itself lives
 * on the engine at `./projection.js`.
 *
 * @param content - Raw text content of the test file
 * @returns The list of tagged feature slugs
 */
export function extractTags(content: string): string[] {
  return extractTagsWith(content, testsAdapter.tagRe);
}

async function main(): Promise<void> {
  process.exitCode = await runProjection(testsAdapter, parseRunOptions(process.argv));
}

if (isEntrypoint(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
