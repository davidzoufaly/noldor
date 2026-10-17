import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isEntrypoint } from './cli-entry.js';

const SKILLS_DIR = '.claude/skills';
const CATALOG_PATH = 'docs/noldor/skill-catalog.md';
/**
 * A consumer's own skills: an optional page it owns, beside the templated
 * catalog. The templated page must match Noldor's copy byte for byte
 * (`checks template-sync`), so a skill the consumer adds is listed here.
 */
const CONSUMER_CATALOG_PATH = 'docs/skill-catalog.md';

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

/** The consumer page's contents, or `''` when the repo has none. */
async function readConsumerCatalog(repo: string): Promise<string> {
  try {
    return await readFile(join(repo, CONSUMER_CATALOG_PATH), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw new Error(`could not read ${CONSUMER_CATALOG_PATH}`, { cause: err });
  }
}

/**
 * Diff the skills under `.claude/skills/` against the headings of both
 * catalog pages: the templated `docs/noldor/skill-catalog.md` and, when the
 * repo has one, its own `docs/skill-catalog.md`.
 *
 * @param repo - The repo root
 * @returns Which skills no page lists, and which headings name no skill
 */
export async function validateSkillCatalog(repo: string): Promise<SkillCatalogDiff> {
  const skillSlugs = await loadSkillSlugs(repo);
  const catalogSlugs = new Set([
    ...parseCatalogSlugs(await readFile(join(repo, CATALOG_PATH), 'utf8')),
    ...parseCatalogSlugs(await readConsumerCatalog(repo)),
  ]);
  return diffSkillSets(skillSlugs, catalogSlugs);
}

async function main(): Promise<void> {
  const diff = await validateSkillCatalog(process.cwd());
  if (diff.missingFromCatalog.length === 0 && diff.missingFromSkills.length === 0) {
    console.log(
      'Validated skill-catalog: every skill has a catalog heading, and every heading a skill.',
    );
    return;
  }

  if (diff.missingFromCatalog.length > 0) {
    console.error(
      `✗ Skills present but missing from ${CATALOG_PATH} (Noldor's own) or ${CONSUMER_CATALOG_PATH} (this repo's):`,
    );
    for (const s of diff.missingFromCatalog) console.error(`    /${s}`);
  }
  if (diff.missingFromSkills.length > 0) {
    console.error(`✗ Catalog headings without a matching skill in ${SKILLS_DIR}/:`);
    for (const s of diff.missingFromSkills) console.error(`    /${s}`);
  }
  process.exitCode = 1;
}

if (isEntrypoint(import.meta.url)) {
  void main();
}
