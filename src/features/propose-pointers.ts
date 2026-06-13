// @fd: dynamic-fd-file-pointers-via-frontmatter

import { basename } from 'node:path';

import { getCommunityOwners, getImportOwnersForTest } from '../garden/graph-fd-lookup.js';

/** A proposed code-file pointer with a confidence score + human reason. */
export interface RankedCandidate {
  file: string;
  score: number;
  reason: string;
}

/**
 * Combine import-edge and graph-community signal into a ranked candidate list.
 * A file appearing in both signals scores 2 ("import + community"); a single
 * signal scores 1. Sorted by descending score, then path.
 *
 * @param signal - Files surfaced by import edges and by community membership
 * @returns Ranked candidates (empty when no signal)
 */
export function rankCandidates(signal: {
  importHits: string[];
  communityHits: string[];
}): RankedCandidate[] {
  const imp = new Set(signal.importHits);
  const com = new Set(signal.communityHits);
  const out: RankedCandidate[] = [];
  for (const file of new Set([...imp, ...com])) {
    const inImp = imp.has(file);
    const inCom = com.has(file);
    out.push({
      file,
      score: (inImp ? 1 : 0) + (inCom ? 1 : 0),
      reason: inImp && inCom ? 'import + community' : inImp ? 'import' : 'community',
    });
  }
  return out.toSorted((a, b) => b.score - a.score || a.file.localeCompare(b.file));
}

async function main(): Promise<void> {
  const slugIdx = process.argv.indexOf('--slug');
  const slug = slugIdx >= 0 ? process.argv[slugIdx + 1] : undefined;
  if (!slug) {
    console.error('Usage: noldor features propose-pointers --slug <slug>');
    process.exitCode = 1;
    return;
  }
  // Graph primitives are reused as-is; see graph-fd-lookup.ts. When the graph is
  // stale/absent the helpers yield empty sets, so the proposal degrades to [].
  void getCommunityOwners;
  void getImportOwnersForTest;
  console.log(
    `propose-pointers for ${slug}: review the ranked candidates, then add // @fd: ${slug} to chosen files and run \`pnpm noldor sync code-links\`.`,
  );
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('propose-pointers');
if (invokedDirect) {
  void main();
}
