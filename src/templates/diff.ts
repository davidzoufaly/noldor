import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

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
 * absent). Templates are package assets resolved by the caller; the consumer
 * root is typically `process.cwd()`.
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
    const tplHash = sha256(readFileSync(tplPath));
    const consumerHash = sha256(readFileSync(consumerPath));
    return { path: rel, status: tplHash === consumerHash ? 'unchanged' : 'drifted' };
  });
}
