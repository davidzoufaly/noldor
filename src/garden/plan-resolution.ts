import { readdir as fsReaddir, readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';

import { FeatureFrontmatterSchema } from '../features/feature-schema.js';
import type { FeatureFrontmatter } from '../features/feature-schema.js';

export interface ResolvedOwner {
  slug: string;
  fd: FeatureFrontmatter;
}

interface ResolveByLinksPlanOptions {
  planPath: string;
  repo: string;
  /** Test seam — defaults to fs/promises readdir. */
  readdir?: (path: string) => Promise<string[]>;
  /** Test seam — defaults to fs/promises readFile. */
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
}

/**
 * Fallback resolver in the detector's plan-staleness chain. Scans every
 * `docs/features/*.md` FD; if any has `links.plan` containing the plan
 * path (verbatim string match, single string or array), returns that FD
 * as the owner. Used when the filename-slug heuristic
 * (`detectStalePlans` primary signal) doesn't match any FD — e.g.
 * multi-feature plans, infra plans.
 *
 * Today's hit rate is zero: no existing FD uses `links.plan` (audited
 * 2026-05-17 during release-sweep-process-hardening part 3 planning).
 * Future-facing for parent FDs that adopt the field.
 */
export async function resolveByLinksPlan(
  opts: ResolveByLinksPlanOptions,
): Promise<ResolvedOwner | null> {
  const readdir = opts.readdir ?? ((p) => fsReaddir(p));
  const readFile = opts.readFile ?? ((p, e) => fsReadFile(p, e));
  const featuresDir = join(opts.repo, 'docs/features');
  let entries: string[];
  try {
    entries = await readdir(featuresDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const fdPath = join(featuresDir, entry);
    let raw: string;
    try {
      raw = await readFile(fdPath, 'utf8');
    } catch {
      continue;
    }
    let parsed: ReturnType<typeof matter>;
    try {
      parsed = matter(raw);
    } catch {
      continue;
    }
    let fd: FeatureFrontmatter;
    try {
      fd = FeatureFrontmatterSchema.parse(parsed.data);
    } catch {
      continue;
    }
    const planList = (fd.links as { plan?: string | string[] }).plan;
    const plans = Array.isArray(planList) ? planList : planList ? [planList] : [];
    if (plans.includes(opts.planPath)) {
      return { slug: entry.replace(/\.md$/, ''), fd };
    }
  }
  return null;
}
