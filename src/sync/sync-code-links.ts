// @fd: dynamic-fd-file-pointers-via-frontmatter, feature-md-links-overhaul

import { basename } from 'node:path';

import { scanRoots } from '../core/repo-paths.js';
import { codeAdapter } from './adapters/code.js';
import { extractTagsWith, parseRunOptions, runProjection } from './projection.js';

// Compatibility re-export: the provider moved to src/core/repo-paths.ts
// (single definition). Existing importers keep this path; new code should
// import from '../core/repo-paths.js' directly.
export { scanRoots };

/**
 * Extract the slug list from a code file's first `// @fd:` comment.
 *
 * Kept as a named export because the tag syntax is a public convention several
 * validators check; everything else this module used to re-export lives on the
 * engine at `./projection.js`.
 *
 * @param content - Raw text content of the code file
 * @returns The list of tagged feature slugs
 */
export function extractFdTags(content: string): string[] {
  return extractTagsWith(content, codeAdapter.tagRe);
}

async function main(): Promise<void> {
  process.exitCode = await runProjection(codeAdapter, parseRunOptions(process.argv));
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('sync-code-links');
if (invokedDirect) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
