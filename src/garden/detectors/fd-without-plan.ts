import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import matter from 'gray-matter';

import { FeatureFrontmatterSchema } from '../../features/feature-schema.js';
import { isPostRollout } from '../../noldor/rollout-marker.js';

export interface FdWithoutPlanFinding {
  readonly slug: string;
  readonly fdPath: string;
  readonly reason: 'in-progress-post-rollout-no-plan';
  readonly action: 'create-plan';
}

/**
 * Find the SHA of the oldest commit that introduced `fdPath` by examining
 * `git log --diff-filter=A --follow -- <path>` and taking the last result
 * (oldest commit that added the file).
 *
 * @param fdPath - Path to the FD file (absolute or relative to cwd).
 * @param cwd - Repository root.
 * @returns The creation SHA, or null if not found.
 */
export function findCreationSha(fdPath: string, cwd: string): string | null {
  try {
    const out = execFileSync(
      'git',
      ['log', '--diff-filter=A', '--follow', '--pretty=%H', '--', fdPath],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return out.at(-1) ?? null;
  } catch {
    return null;
  }
}

/**
 * Check whether a plan glob hit exists for `slug` in `docs/superpowers/plans/`.
 * Matches filenames matching `<date>-<slug>.md` or `<date>-<slug>-part<N>.md`.
 */
function hasPlan(repo: string, slug: string): boolean {
  const plansDir = join(repo, 'docs/superpowers/plans');
  if (!existsSync(plansDir)) return false;
  let entries: string[];
  try {
    entries = readdirSync(plansDir);
  } catch {
    return false;
  }
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${slug}(?:-part\\d+)?\\.md$`);
  return entries.some((e) => re.test(e));
}

/**
 * Walk `docs/features/*.md` and flag FDs where ALL of:
 * - `phase: in-progress`
 * - creation commit is post-rollout (not grandfathered)
 * - no plan glob hit at `docs/superpowers/plans/<date>-<slug>.md`
 *
 * @param repo - Repository root.
 * @returns One FdWithoutPlanFinding per flagged FD.
 */
export async function detectFdWithoutPlan(repo: string): Promise<FdWithoutPlanFinding[]> {
  const featuresDir = join(repo, 'docs/features');
  let entries: string[];
  try {
    entries = await readdir(featuresDir);
  } catch {
    return [];
  }

  const findings: FdWithoutPlanFinding[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;

    const slug = entry.replace(/\.md$/, '');
    const fullPath = join(featuresDir, entry);
    const relPath = join('docs/features', entry);

    let raw: string;
    try {
      raw = await readFile(fullPath, 'utf8');
    } catch {
      continue;
    }

    const parsed = matter(raw);
    let fm: ReturnType<typeof FeatureFrontmatterSchema.parse>;
    try {
      fm = FeatureFrontmatterSchema.parse(parsed.data);
    } catch {
      continue;
    }

    // Skip done FDs entirely
    if (fm.phase !== 'in-progress') continue;

    // Find creation SHA and check if post-rollout
    const creationSha = findCreationSha(relPath, repo);
    if (!creationSha) continue; // untracked / new file not yet committed

    if (!isPostRollout(creationSha, repo)) continue; // grandfathered pre-rollout

    // Check for a matching plan
    if (hasPlan(repo, slug)) continue;

    findings.push({
      slug,
      fdPath: relPath,
      reason: 'in-progress-post-rollout-no-plan',
      action: 'create-plan',
    });
  }

  return findings;
}
