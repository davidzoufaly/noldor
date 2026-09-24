import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { planRegionSync, readRegion, replaceRegion, requireRegion } from './managed-region.js';
import { REGION_MANAGED_TEMPLATES } from './manifest.js';

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

interface Plan {
  rel: string;
  dest: string;
  content: Buffer | string;
  action: 'add' | 'update' | 'unchanged' | 'conflict' | 'malformed';
  reason?: string;
}

function planRegionManaged(rel: string, dest: string, tpl: Buffer, opts: CopyOptions): Plan {
  const sync = planRegionSync(readFileSync(dest, 'utf8'), tpl.toString('utf8'), rel);
  switch (sync.kind) {
    case 'unchanged':
      return { rel, dest, content: tpl, action: 'unchanged' };
    case 'append':
      return { rel, dest, content: sync.content, action: 'update' };
    case 'replace':
      return { rel, dest, content: sync.content, action: opts.update ? 'update' : 'conflict' };
    case 'malformed':
      return { rel, dest, content: tpl, action: 'malformed', reason: sync.reason };
  }
}

/**
 * Copy each `relativePaths[i]` from `templateRoot` to `consumerRoot`. When the
 * consumer copy already exists and content matches, the entry is reported as
 * `unchanged`. When content differs, the function throws unless `update: true`
 * (then reports `updated`). New files report `added`.
 *
 * A path in {@link REGION_MANAGED_TEMPLATES} is compared and written by its
 * `noldor:rules` region only: a consumer file without one gets the region
 * appended (no `--update` needed — nothing is overwritten), a drifted region is
 * a conflict unless `update: true`, and a file whose markers do not pair is
 * refused even under `update: true`.
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
  const plans: Plan[] = relativePaths.map((rel) => {
    const dest = join(consumerRoot, rel);
    const tpl = readFileSync(join(templateRoot, rel));
    if (!existsSync(dest)) return { rel, dest, content: tpl, action: 'add' };
    if (REGION_MANAGED_TEMPLATES.has(rel)) return planRegionManaged(rel, dest, tpl, opts);
    if (sha256(tpl) === sha256(readFileSync(dest))) {
      return { rel, dest, content: tpl, action: 'unchanged' };
    }
    return { rel, dest, content: tpl, action: opts.update ? 'update' : 'conflict' };
  });

  const refused = plans.filter((p) => p.action === 'conflict' || p.action === 'malformed');
  if (refused.length > 0) {
    const list = refused
      .map((p) =>
        p.reason === undefined
          ? `  ${p.rel}`
          : `  ${p.rel} — noldor:rules markers: ${p.reason}; repair them by hand (--update cannot)`,
      )
      .join('\n');
    throw new Error(
      `Refusing to overwrite ${refused.length} existing file(s) (use --update to replace):\n${list}`,
    );
  }

  return plans.map((p) => {
    if (p.action === 'unchanged') return { path: p.rel, status: 'unchanged' as const };
    mkdirSync(dirname(p.dest), { recursive: true });
    writeFileSync(p.dest, p.content);
    return { path: p.rel, status: p.action === 'add' ? ('added' as const) : ('updated' as const) };
  });
}

/**
 * The template with its region replaced by the consumer's, or `null` when the
 * consumer has no well-formed region to give. Only the region is adopted: the
 * rest of a first-party repo's file is its own, not every consumer's starter.
 */
function adoptRegion(consumerDoc: string, templateDoc: string, rel: string): string | null {
  const read = readRegion(consumerDoc);
  if (read.kind !== 'present') return null;
  return replaceRegion(templateDoc, requireRegion(templateDoc, rel), read.region);
}

/**
 * Reverse direction: copy each `relativePaths[i]` from `consumerRoot` INTO
 * `templateRoot`. Used by `noldor init --adopt` to bootstrap templates from
 * the first-party-dev repo's real consumer state. Skips any path absent from
 * the consumer (templates may have entries the consumer never wrote — e.g.
 * skill files added later), and a region-managed path whose consumer copy has
 * no well-formed region.
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
    const content =
      REGION_MANAGED_TEMPLATES.has(rel) && existsSync(dest)
        ? adoptRegion(readFileSync(src, 'utf8'), readFileSync(dest, 'utf8'), rel)
        : readFileSync(src);
    if (content === null) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
}
