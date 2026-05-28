import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SKILLS_DIR = '.claude/skills';
const CATALOG_PATH = 'docs/noldor/skill-catalog.md';

/** Slug-comparison result: which side has entries the other lacks. */
export interface SkillCatalogDiff {
  readonly missingFromCatalog: readonly string[];
  readonly missingFromSkills: readonly string[];
}

/**
 * Pure set diff between skill filenames and catalog headings. Both inputs are
 * sets of slugs (without leading slash). The function returns slugs each side
 * is missing.
 *
 * @param skillSlugs - Slugs derived from `.claude/skills/` filenames (or `<dir>/SKILL.md` for sub-skill folders).
 * @param catalogSlugs - Slugs parsed from `## /<slug>` headings in `skill-catalog.md`.
 */
export function diffSkillSets(
  skillSlugs: ReadonlySet<string>,
  catalogSlugs: ReadonlySet<string>,
): SkillCatalogDiff {
  const missingFromCatalog: string[] = [];
  const missingFromSkills: string[] = [];
  for (const s of skillSlugs) {
    if (!catalogSlugs.has(s)) missingFromCatalog.push(s);
  }
  for (const s of catalogSlugs) {
    if (!skillSlugs.has(s)) missingFromSkills.push(s);
  }
  return {
    missingFromCatalog: missingFromCatalog.toSorted(),
    missingFromSkills: missingFromSkills.toSorted(),
  };
}

/** Parse `## /<slug>` headings from catalog body. */
export function parseCatalogSlugs(contents: string): Set<string> {
  const slugs = new Set<string>();
  const re = /^## \/([\w-]+)\s*$/gm;
  for (const m of contents.matchAll(re)) {
    slugs.add(m[1]);
  }
  return slugs;
}

/**
 * Walk `.claude/skills/`, return slugs. Top-level `<slug>.md` → slug. A subdir
 * containing `SKILL.md` (e.g. `refactor/SKILL.md`) → directory name as slug.
 */
async function loadSkillSlugs(repo: string): Promise<Set<string>> {
  const dir = join(repo, SKILLS_DIR);
  const entries = await readdir(dir, { withFileTypes: true });
  const slugs = new Set<string>();
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.md')) {
      slugs.add(e.name.replace(/\.md$/, ''));
      continue;
    }
    if (e.isDirectory()) {
      try {
        await stat(join(dir, e.name, 'SKILL.md'));
        slugs.add(e.name);
      } catch {
        // No SKILL.md → not a skill directory; skip.
      }
    }
  }
  return slugs;
}

async function main(): Promise<void> {
  const repo = process.cwd();
  const skillSlugs = await loadSkillSlugs(repo);
  const catalogContents = await readFile(join(repo, CATALOG_PATH), 'utf8');
  const catalogSlugs = parseCatalogSlugs(catalogContents);
  const diff = diffSkillSets(skillSlugs, catalogSlugs);

  if (diff.missingFromCatalog.length === 0 && diff.missingFromSkills.length === 0) {
    console.log(
      `Validated skill-catalog: ${skillSlugs.size} skill(s) match ${catalogSlugs.size} catalog heading(s).`,
    );
    return;
  }

  if (diff.missingFromCatalog.length > 0) {
    console.error(`✗ Skills present but missing from ${CATALOG_PATH}:`);
    for (const s of diff.missingFromCatalog) console.error(`    /${s}`);
  }
  if (diff.missingFromSkills.length > 0) {
    console.error(`✗ Catalog headings without a matching skill in ${SKILLS_DIR}/:`);
    for (const s of diff.missingFromSkills) console.error(`    /${s}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
