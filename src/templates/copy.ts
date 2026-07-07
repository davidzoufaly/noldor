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
 *
 * Plan-then-apply: the full set is classified first, so without `--update` the
 * error enumerates EVERY conflicting path at once (a partial-residual repo shows
 * its whole blast radius instead of one file per failed run) and nothing is
 * written when the copy would abort.
 */
export function copyTemplate(
  templateRoot: string,
  consumerRoot: string,
  relativePaths: readonly string[],
  opts: CopyOptions,
): CopyEntry[] {
  interface Plan {
    rel: string;
    dest: string;
    tpl: Buffer;
    action: 'add' | 'update' | 'unchanged' | 'conflict';
  }
  const plans: Plan[] = relativePaths.map((rel) => {
    const dest = join(consumerRoot, rel);
    const tpl = readFileSync(join(templateRoot, rel));
    if (!existsSync(dest)) return { rel, dest, tpl, action: 'add' };
    if (sha256(tpl) === sha256(readFileSync(dest))) return { rel, dest, tpl, action: 'unchanged' };
    return { rel, dest, tpl, action: opts.update ? 'update' : 'conflict' };
  });

  const conflicts = plans.filter((p) => p.action === 'conflict');
  if (conflicts.length > 0) {
    const list = conflicts.map((c) => `  ${c.rel}`).join('\n');
    throw new Error(
      `Refusing to overwrite ${conflicts.length} existing file(s) (use --update to replace):\n${list}`,
    );
  }

  return plans.map((p) => {
    if (p.action === 'unchanged') return { path: p.rel, status: 'unchanged' as const };
    mkdirSync(dirname(p.dest), { recursive: true });
    writeFileSync(p.dest, p.tpl);
    return { path: p.rel, status: p.action === 'add' ? ('added' as const) : ('updated' as const) };
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
