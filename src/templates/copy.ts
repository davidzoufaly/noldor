import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export type CopyStatus = 'added' | 'updated' | 'unchanged';

export interface CopyEntry {
  readonly path: string;
  readonly status: CopyStatus;
}

export interface CopyOptions {
  readonly update: boolean;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Copy each `relativePaths[i]` from `templateRoot` to `consumerRoot`. When the
 * consumer copy already exists and content matches, the entry is reported as
 * `unchanged`. When content differs, the function throws unless `update: true`
 * (then reports `updated`). New files report `added`.
 */
export function copyTemplate(
  templateRoot: string,
  consumerRoot: string,
  relativePaths: readonly string[],
  opts: CopyOptions,
): CopyEntry[] {
  return relativePaths.map((rel) => {
    const src = join(templateRoot, rel);
    const dest = join(consumerRoot, rel);
    const tpl = readFileSync(src);

    if (!existsSync(dest)) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, tpl);
      return { path: rel, status: 'added' as const };
    }

    const cur = readFileSync(dest);
    if (sha256(tpl) === sha256(cur)) return { path: rel, status: 'unchanged' as const };

    if (!opts.update) {
      throw new Error(`Refusing to overwrite ${rel} (use --update to replace)`);
    }
    writeFileSync(dest, tpl);
    return { path: rel, status: 'updated' as const };
  });
}

/**
 * Reverse direction: copy each `relativePaths[i]` from `consumerRoot` INTO
 * `templateRoot`. Used by `noldor init --adopt` to bootstrap templates from
 * the first-party-dev repo's real consumer state. Skips any path absent from
 * the consumer (templates may have entries the consumer never wrote — e.g.
 * skill files added later).
 */
export function adoptTemplate(
  templateRoot: string,
  consumerRoot: string,
  relativePaths: readonly string[],
): void {
  for (const rel of relativePaths) {
    const src = join(consumerRoot, rel);
    const dest = join(templateRoot, rel);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(src));
  }
}
