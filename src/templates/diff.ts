import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { planRegionSync } from './managed-region.js';
import { REGION_MANAGED_TEMPLATES } from './manifest.js';

export type DriftStatus = 'unchanged' | 'drifted' | 'missing';

export interface DriftEntry {
  readonly path: string;
  readonly status: DriftStatus;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Compare each `relativePaths[i]` under `templateRoot` against the same path
 * under `consumerRoot`. Returns one DriftEntry per path: `unchanged` (sha
 * match), `drifted` (both exist, content differs), or `missing` (consumer copy
 * absent). A path in {@link REGION_MANAGED_TEMPLATES} is compared by its
 * `noldor:rules` region alone, so consumer text outside it never drifts; a
 * missing or malformed region does. Templates are package assets resolved by
 * the caller; the consumer root is typically `process.cwd()`.
 */
export function computeDrift(
  templateRoot: string,
  consumerRoot: string,
  relativePaths: readonly string[],
): DriftEntry[] {
  return relativePaths.map((rel) => {
    const tplPath = join(templateRoot, rel);
    const consumerPath = join(consumerRoot, rel);
    if (!existsSync(consumerPath)) return { path: rel, status: 'missing' };
    if (REGION_MANAGED_TEMPLATES.has(rel)) {
      const sync = planRegionSync(
        readFileSync(consumerPath, 'utf8'),
        readFileSync(tplPath, 'utf8'),
        rel,
      );
      return { path: rel, status: sync.kind === 'unchanged' ? 'unchanged' : 'drifted' };
    }
    const tplHash = sha256(readFileSync(tplPath));
    const consumerHash = sha256(readFileSync(consumerPath));
    return { path: rel, status: tplHash === consumerHash ? 'unchanged' : 'drifted' };
  });
}
