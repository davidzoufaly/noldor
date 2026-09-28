// @fd: feature-md-links-overhaul

import { docsAdapter } from './adapters/docs.js';
import { extractTagsWith, parseRunOptions, runProjection } from './projection.js';
import { isEntrypoint } from '../core/cli-entry.js';

/**
 * Extract the slug list from a doc file's first line-anchored
 * `<!-- @feature: -->` comment. A doc that merely quotes the convention inside a
 * table cell or after a bullet marker is not a tag.
 *
 * Kept as a named export because `validate features` checks the same convention;
 * the projection itself lives on the engine at `./projection.js`.
 *
 * @param content - Raw doc contents
 * @returns The list of tagged feature slugs
 */
export function extractFeatureTags(content: string): string[] {
  return extractTagsWith(content, docsAdapter.tagRe);
}

async function main(): Promise<void> {
  process.exitCode = await runProjection(docsAdapter, parseRunOptions(process.argv));
}

if (isEntrypoint(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
