import { rename, writeFile } from 'node:fs/promises';

let counter = 0;

/**
 * Atomic JSON write via temp-then-rename. The tmp path includes pid + a
 * per-process counter so concurrent writers to the same final sink each get
 * a distinct tmp file. The aggregator's `.json` extension filter excludes
 * tmp variants because the suffix comes BEFORE `.tmp`.
 */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.${process.pid}.${++counter}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, path);
}
