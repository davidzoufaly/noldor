import { join } from 'node:path';

import { listDirIfExists, parseFdFrontmatter, readFileIfExists } from '../../core/fd-load.js';

export interface TierMismatchFinding {
  readonly slug: string;
  readonly path: string;
  readonly reason: 'full-tier-missing-spec';
  readonly action: 'add-spec-link';
}

/**
 * Walk `docs/features/*.md` and flag FDs where `noldor-tier === 'full'`
 * but `links.spec` is not set. A full-tier feature must have a design spec.
 *
 * @param repo - Repository root.
 * @returns One TierMismatchFinding per flagged FD.
 */
export async function detectTierMismatch(repo: string): Promise<TierMismatchFinding[]> {
  const featuresDir = join(repo, 'docs/features');
  const entries = await listDirIfExists(featuresDir);

  const findings: TierMismatchFinding[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;

    const fullPath = join(featuresDir, entry);
    const slug = entry.replace(/\.md$/, '');
    const relPath = join('docs/features', entry);

    const raw = await readFileIfExists(fullPath);
    if (raw === null) continue; // vanished between readdir and read

    // Guarded parse: broken YAML must not abort the detector run — a malformed
    // FD is the `malformed-fd` gap's finding, not this detector's.
    const fm = parseFdFrontmatter(raw);
    if (!fm) continue;

    if (fm['noldor-tier'] === 'full' && !fm.links.spec) {
      findings.push({
        action: 'add-spec-link',
        path: relPath,
        reason: 'full-tier-missing-spec',
        slug,
      });
    }
  }

  return findings;
}
