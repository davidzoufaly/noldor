// @fd: gate-skill-loads-only-the-branch-a-session-takes
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { MD_LINK_RE, collectSkillMd } from '../garden/detectors/skill-code-drift.js';

/** The marker a router line carries when it hands the session to a branch file. */
export const READ_NOW_MARKER = '**Read now:**';

/** A read-now link that points nowhere, or a branch file no read-now chain reaches. */
export interface SkillRouterFinding {
  /** Repo-relative path of the skill markdown file the finding is about. */
  readonly skillPath: string;
  /** 1-based line of the read-now link, or 1 for an unreachable file. */
  readonly line: number;
  readonly kind: 'missing-branch-file' | 'unreachable-branch-file';
  readonly detail: string;
}

/**
 * Check every shipped skill folder — one whose `SKILL.md` has a `templates/` twin
 * — for a read-now link whose target does not exist, and for a markdown file that
 * no chain of read-now links from `SKILL.md` reaches. A placeholder target
 * (`<file>`) and a URL are not links to check.
 *
 * @param repo - Repository root.
 * @returns Findings sorted by `skillPath`, then `line`.
 */
export function checkSkillRouters(repo: string): SkillRouterFinding[] {
  const skillsRoot = join(repo, '.claude', 'skills');
  if (!existsSync(skillsRoot)) return [];
  const rel = (abs: string): string => relative(repo, abs).split(sep).join('/');
  const findings: SkillRouterFinding[] = [];
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    const folder = join(skillsRoot, entry.name);
    const router = join(folder, 'SKILL.md');
    const shipped = existsSync(
      join(repo, 'templates', '.claude', 'skills', entry.name, 'SKILL.md'),
    );
    if (!entry.isDirectory() || !existsSync(router) || !shipped) continue;
    const reached = new Set([router]);
    const queue = [router];
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (const [i, text] of lines.entries()) {
        if (!text.includes(READ_NOW_MARKER)) continue;
        for (const match of text.matchAll(MD_LINK_RE)) {
          const target = match[1]!.split('#')[0]!;
          if (target === '' || /^<.*>$/.test(target) || /^[a-z]+:/.test(target)) continue;
          const abs = resolve(dirname(file), target);
          if (!existsSync(abs)) {
            findings.push({
              skillPath: rel(file),
              line: i + 1,
              kind: 'missing-branch-file',
              detail: `read-now link \`${target}\` resolves to \`${rel(abs)}\`, which does not exist`,
            });
          } else if (abs.startsWith(folder + sep) && abs.endsWith('.md') && !reached.has(abs)) {
            reached.add(abs);
            queue.push(abs);
          }
        }
      }
    }
    for (const file of collectSkillMd(folder)) {
      if (reached.has(file)) continue;
      findings.push({
        skillPath: rel(file),
        line: 1,
        kind: 'unreachable-branch-file',
        detail: `no chain of ${READ_NOW_MARKER} links from ${rel(router)} reaches this file`,
      });
    }
  }
  return findings.sort((a, b) => a.skillPath.localeCompare(b.skillPath, 'en') || a.line - b.line);
}
