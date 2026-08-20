// The ownership chain in `garden-detect.ts` degrades to "no finding" on an FD it
// cannot parse (see OwnerResolution) — the conservative choice, since an
// unparseable FD may own live design work. That silence needs a counterweight,
// or one malformed FD would quietly stop staleness reporting for every artifact
// whose owner it might be. This detector is that counterweight: it names the
// malformed FDs themselves, once, as gaps.
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import matter from 'gray-matter';

import { loadDocRoots } from '../../core/doc-roots.js';
import { FeatureFrontmatterSchema } from '../../core/feature-schema.js';

import type { Gap } from '../../core/fd-load.js';

/**
 * Emit a Gap per `docs/features/*.md` whose frontmatter does not parse against
 * {@link FeatureFrontmatterSchema}. Advisory in the same sense as its sibling
 * gap detectors: `noldor features validate` is the blocking authority on FD
 * validity, this makes the same fact visible in a garden pass so an operator
 * reading a suspiciously empty staleness list can see why it is empty.
 *
 * @param repo - Repository root.
 * @returns One gap per unparseable FD; empty when the features dir is absent.
 */
export async function detectMalformedFds(repo: string): Promise<Gap[]> {
  const featuresDir = loadDocRoots(repo).features;
  let entries: string[];
  try {
    entries = await readdir(featuresDir);
  } catch {
    return [];
  }

  const gaps: Gap[] = [];
  for (const entry of entries.filter((e) => e.endsWith('.md')).sort()) {
    const fullPath = join(featuresDir, entry);
    // Repo-relative, like every sibling detector's gap text — an absolute path
    // would leak this machine's checkout prefix into the report.
    const relPath = relative(repo, fullPath);
    let raw: string;
    try {
      raw = await readFile(fullPath, 'utf8');
    } catch {
      continue; // vanished between listing and read — nothing to report
    }
    const parsed = FeatureFrontmatterSchema.safeParse(matter(raw).data);
    if (parsed.success) continue;
    gaps.push({
      category: 'malformed-fd',
      itemId: relPath,
      message: `${relPath} frontmatter does not parse (${parsed.error.issues[0]?.message ?? 'invalid'}). Staleness detection treats it as an owner of unknown phase, so plans/specs it may own are neither archived nor aged out. Fix with 'pnpm noldor features validate'.`,
    });
  }
  return gaps;
}
