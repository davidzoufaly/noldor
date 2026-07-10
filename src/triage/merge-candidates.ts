import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadDocRoots } from '../core/doc-roots.js';
import { extractSummary, loadSddFeatures } from '../core/fd-load.js';
import { parseBacklog, parseRoadmap } from '../utils/parse-blocks.js';

/**
 * One merge target for `/noldor-triage` to rank an untriaged idea against.
 * `disposition` is derived from `kind`: roadmap/backlog blocks accept a
 * sub-bullet merge (`merge`); FDs are already promoted, so an overlap becomes
 * a new entry carrying `parent: <slug>` (`parent`).
 */
export interface MergeCandidate {
  kind: 'feature' | 'roadmap' | 'backlog';
  slug: string;
  id?: string;
  name: string;
  summary: string;
  phase?: string;
  disposition: 'merge' | 'parent';
}

/** Read a doc file, treating a missing file (ENOENT) as empty; rethrow every other error. */
async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

/**
 * Enumerate every merge target — roadmap blocks, backlog blocks, and FDs — as a
 * flat corpus. Deterministic for a fixed doc tree. `docRoot` is injected
 * end-to-end via {@link loadDocRoots} (no module-global state) so tests point
 * it at a fixture dir. Entries whose slug is empty (all-punctuation headings,
 * see `parse-blocks.ts`) are dropped — they can't form a `merge:<slug>`.
 *
 * @param docRoot - Repo root; resolved to features/roadmap/backlog paths.
 * @returns The merge-candidate corpus, FD bodies re-read for their Summary.
 */
export async function buildMergeCandidates(docRoot: string): Promise<MergeCandidate[]> {
  const roots = loadDocRoots(docRoot);

  const roadmap = parseRoadmap(await readOrEmpty(roots.roadmap)).map(
    (e): MergeCandidate => ({
      kind: 'roadmap',
      slug: e.slug,
      id: e.id,
      name: e.name,
      summary: e.description,
      phase: e.phase,
      disposition: 'merge',
    }),
  );

  const backlog = parseBacklog(await readOrEmpty(roots.backlog)).map(
    (e): MergeCandidate => ({
      kind: 'backlog',
      slug: e.slug,
      id: e.id,
      name: e.name,
      summary: e.description,
      phase: e.phase,
      disposition: 'merge',
    }),
  );

  const records = await loadSddFeatures(roots.features);
  const features = await Promise.all(
    records.map(async (r): Promise<MergeCandidate> => {
      const raw = await readFile(join(roots.features, `${r.slug}.md`), 'utf8');
      return {
        kind: 'feature',
        slug: r.slug,
        id: r.frontmatter['entry-id'],
        name: r.frontmatter.name,
        summary: extractSummary(raw),
        phase: r.frontmatter.phase,
        disposition: 'parent',
      };
    }),
  );

  return [...roadmap, ...backlog, ...features].filter((c) => c.slug.length > 0);
}
