import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Migration, MigrationStep } from './types.js';

const SUBDIRS = ['specs', 'plans'] as const;
const LEGACY = 'docs/superpowers/';
const NEXT = 'docs/design/';

/** Recursively list every file (absolute path) under `dir`. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

/** Move every file from `oldDir` into `newDir`, preserving relative structure. */
function moveTree(oldDir: string, newDir: string): void {
  for (const src of walkFiles(oldDir)) {
    const dest = join(newDir, relative(oldDir, src));
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(src, dest);
  }
}

/** rmdir `dir` when it exists and is empty; swallow the non-empty/gone case. */
function removeIfEmpty(dir: string): void {
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    /* raced or non-empty — leave it */
  }
}

/**
 * Q-0006: rename `docs/superpowers/{specs,plans}` → `docs/design/{specs,plans}`.
 * Two transforms, both idempotent and existence-guarded:
 *  1. Move the spec/plan trees (incl. `archive/`) to the new location, then
 *     rmdir the emptied `docs/superpowers/`.
 *  2. Rewrite the literal `docs/superpowers/` → `docs/design/` in every
 *     `docs/**\/*.md` — FD frontmatter `links.spec`/`links.plan`, framework
 *     twins under `docs/noldor/`, roadmap/backlog prose, and the moved files'
 *     own internal links (walked at their new path, post-move).
 * The legacy subtree is skipped in the content walk (on apply it is already
 * moved; on dry-run its files surface as move steps, not content steps).
 */
function computeSteps(cwd: string, apply: boolean): MigrationStep[] {
  const steps: MigrationStep[] = [];

  for (const sub of SUBDIRS) {
    const oldDir = join(cwd, 'docs', 'superpowers', sub);
    if (!existsSync(oldDir)) continue;
    const newDir = join(cwd, 'docs', 'design', sub);
    for (const src of walkFiles(oldDir)) {
      steps.push({ path: relative(cwd, src), before: '(file)', after: '' });
      steps.push({
        path: join('docs', 'design', sub, relative(oldDir, src)),
        before: '',
        after: '(moved)',
      });
    }
    if (apply) {
      moveTree(oldDir, newDir);
      rmSync(oldDir, { recursive: true, force: true }); // drop the emptied subdir skeleton
    }
  }
  if (apply) removeIfEmpty(join(cwd, 'docs', 'superpowers'));

  const docsRoot = join(cwd, 'docs');
  const legacyRoot = join(cwd, 'docs', 'superpowers');
  if (existsSync(docsRoot)) {
    for (const file of walkFiles(docsRoot)) {
      if (!file.endsWith('.md')) continue;
      if (file.startsWith(legacyRoot)) continue; // handled by the move above
      const before = readFileSync(file, 'utf8');
      const after = before.split(LEGACY).join(NEXT);
      if (after === before) continue;
      steps.push({ path: relative(cwd, file), before, after });
      if (apply) writeFileSync(file, after);
    }
  }

  return steps;
}

/** Rename docs/superpowers/{specs,plans} → docs/design/{specs,plans}. */
export const migration_1_0_0: Migration = {
  from: '0.7.0',
  to: '1.0.0',
  description:
    'rename docs/superpowers/{specs,plans} → docs/design/{specs,plans} (move trees + rewrite docs/**/*.md links)',
  dryRun: (cwd) => computeSteps(cwd, false),
  migrate: (cwd) => computeSteps(cwd, true),
};
