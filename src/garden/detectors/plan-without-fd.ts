import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const PLAN_FILE_RE = /^\d{4}-\d{2}-\d{2}-(.+?)(?:-part\d+)?\.md$/;

export interface PlanWithoutFdFinding {
  readonly slug: string;
  readonly planPath: string;
  readonly reason: 'no-matching-fd';
  readonly action: 'create-fd-or-archive-plan';
}

/**
 * Derive the feature slug from a plan filename.
 *
 * @param filename - e.g. `2026-04-19-my-feature.md` or
 *   `2026-04-23-my-feature-part1.md`.
 * @returns The slug or null if the filename does not match the convention.
 */
function planSlug(filename: string): string | null {
  const match = PLAN_FILE_RE.exec(filename);
  return match?.[1] ?? null;
}

/**
 * Walk `docs/superpowers/plans/*.md`, derive the slug from each filename,
 * and flag plans where no corresponding `docs/features/<slug>.md` exists.
 *
 * @param repo - Repository root.
 * @returns One PlanWithoutFdFinding per orphan plan file.
 */
export async function detectPlanWithoutFd(repo: string): Promise<PlanWithoutFdFinding[]> {
  const plansDir = join(repo, 'docs/superpowers/plans');
  let entries: string[];
  try {
    entries = await readdir(plansDir);
  } catch {
    return [];
  }

  const findings: PlanWithoutFdFinding[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;

    const slug = planSlug(entry);
    if (!slug) continue;

    const fdPath = join(repo, 'docs/features', `${slug}.md`);
    if (!existsSync(fdPath)) {
      findings.push({
        slug,
        planPath: join('docs/superpowers/plans', entry),
        reason: 'no-matching-fd',
        action: 'create-fd-or-archive-plan',
      });
    }
  }

  return findings;
}
