import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import matter from 'gray-matter';

import { FeatureFrontmatterSchema } from './feature-schema.js';

import type { Dirent } from 'node:fs';
import type { FeatureFrontmatter } from './feature-schema.js';

/**
 * One detected gap from any of the 14 SDD detectors. Categories are stable
 * strings used for grouping in the rendered report.
 */
export interface Gap {
  category: string;
  itemId: string;
  message: string;
}

/**
 * A feature MD plus its derived slug (filename without `.md`).
 */
export interface FeatureRecord {
  slug: string;
  frontmatter: FeatureFrontmatter;
}

/**
 * Pre-MVP features (v0.1.0 bootstrap release) shipped before the SDD
 * link-tracking framework existed. Blanket-flagging them as missing
 * `links.spec` / `links.code` is noise. Detectors below
 * exempt features whose `introduced` is below this threshold.
 *
 * Bump when bootstrap backfill is desired or a release fully under
 * SDD enforcement is the new baseline.
 */
export const MIN_ENFORCED_VERSION = '0.2.0';

/**
 * Compare two semver strings by major/minor/patch.
 *
 * @returns Negative if `a < b`, positive if `a > b`, 0 if equal
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n));
  const pb = b.split('.').map((n) => Number(n));
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Returns true when a feature is subject to link-enforcement. Pre-MVP
 * (`introduced < MIN_ENFORCED_VERSION`) done features are grandfathered.
 * In-progress features and features missing `introduced` are always
 * enforced (the latter is caught by its own detector).
 */
export function isLinkEnforced(f: FeatureRecord): boolean {
  if (f.frontmatter.phase !== 'done') {
    return true;
  }
  const v = f.frontmatter.introduced;
  if (!v) {
    return true;
  }
  return compareSemver(v, MIN_ENFORCED_VERSION) >= 0;
}

const INFRA_FILE_PATTERNS = [
  /\.config\.(ts|js|mjs|cjs)$/,
  /-env\.d\.ts$/,
  /^tsconfig.*\.json$/,
  /^lefthook\.(yml|yaml)$/,
] as const;

/**
 * Check whether a file path is tooling glue (configs, ambient types, etc.)
 * that should never have a feature MD owner. Matched by basename — same
 * filename in any directory counts as infra.
 *
 * @param filePath - File path to check
 * @returns true if the file is infra and should be skipped by FD-ownership detectors
 */
export function isInfraFile(filePath: string): boolean {
  const name = basename(filePath);
  return INFRA_FILE_PATTERNS.some((re) => re.test(name));
}

const EXCLUDED_WALK_DIRS = new Set([
  'node_modules',
  'dist',
  '.turbo',
  'coverage',
  '.git',
  '.github',
]);

/**
 * Recursively walk a directory and collect every file path under it,
 * skipping hidden entries (except `.github`) and excluded build artefacts.
 *
 * @param dir - Absolute or workspace-relative directory to walk.
 * @param out - Mutable array that receives discovered file paths.
 * @returns Resolves once the walk completes; results are appended to `out`.
 */
export async function walkRepo(dir: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    // A missing top-level scan dir (e.g. no `packages/`/`apps/` in a
    // single-package consumer) contributes no paths rather than throwing.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const { name } = entry;
    if (name.startsWith('.') && name !== '.github') {
      continue;
    }
    if (EXCLUDED_WALK_DIRS.has(name)) {
      continue;
    }
    const full = join(dir, name);
    if (entry.isDirectory()) {
      await walkRepo(full, out);
    } else {
      out.push(full);
    }
  }
}

/**
 * Load every feature MD in a directory and parse its frontmatter.
 *
 * @param dir - Directory containing `<slug>.md` feature files (typically
 *   `docs/features`). A missing directory yields an empty array.
 * @returns Array of `{ frontmatter, slug }` records, one per feature MD.
 *
 * @remarks
 * Renamed from `loadFeatures` to avoid colliding with the dashboard's
 * forthcoming richer loader (see `scripts/dashboard/data.ts`).
 */
export async function loadSddFeatures(dir: string): Promise<FeatureRecord[]> {
  const result: FeatureRecord[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    const slug = entry.name.replace(/\.md$/, '');
    const raw = await readFile(join(dir, entry.name), 'utf8');
    const fm = FeatureFrontmatterSchema.parse(matter(raw).data);
    result.push({ frontmatter: fm, slug });
  }
  return result;
}

/**
 * Extract the trimmed body of an FD's `## Summary` section, or `''` when the
 * section is absent. Pure — operates on the raw markdown (gray-matter
 * frontmatter has no `## ` heading so it never matches). Mirrors the Summary
 * regex in `src/cr/read-fd-summary.ts` (that copy throws on absence; this one
 * returns `''` so a stub FD contributes an empty summary rather than crashing
 * a corpus build). Consolidating the two copies onto this core helper is a
 * deferred follow-up — `cr → core` is an allowed edge.
 *
 * @param md - Raw feature-MD file contents (frontmatter included).
 * @returns Trimmed `## Summary` body, or `''` when there is no Summary section.
 */
export function extractSummary(md: string): string {
  // `(?=^## |$(?![\s\S]))` = next H2 OR end-of-input (JS has no `\Z`).
  const m = md.match(/^## Summary\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  return m ? m[1]!.trim() : '';
}

/**
 * List spec markdown files in a directory as cwd-relative paths.
 *
 * @param dir - Directory containing spec MDs (typically
 *   `docs/design/specs`). A missing directory yields an empty array.
 * @returns Array of paths relative to `process.cwd()`.
 */
export async function listSpecs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => relative(process.cwd(), join(dir, e.name)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * List plan markdown files in a directory as cwd-relative paths.
 *
 * @param dir - Directory containing plan MDs (typically
 *   `docs/design/plans`). A missing directory yields an empty array.
 * @returns Array of paths relative to `process.cwd()`.
 */
export async function listPlans(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => relative(process.cwd(), join(dir, e.name)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Strip leading `YYYY-MM-DD-` and trailing `-design` from a spec
 * filename to recover the underlying slug used to match against plans.
 *
 * @param filename - Spec basename (e.g. `2026-04-15-editor-shell-design.md`)
 * @returns Slug stem (e.g. `editor-shell`) or empty string if no match.
 */
export function extractSpecSlug(filename: string): string {
  const stem = filename.replace(/\.md$/, '');
  const noDate = stem.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  return noDate.replace(/-design$/, '');
}

/**
 * Strip leading `YYYY-MM-DD-` and any `plan\d+-` prefix and trailing
 * `-part\d+` suffix from a plan filename to recover the underlying
 * slug used to match against specs. The `-part\d+` strip lets a single
 * spec match every part of a multi-file plan that was split for
 * context-window reasons.
 *
 * @param filename - Plan basename (e.g. `2026-04-14-plan2-engine.md`,
 *   `2026-04-23-feature-md-framework-part1.md`).
 * @returns Slug stem (e.g. `engine`, `feature-md-framework`) or empty
 *   string if no match.
 */
export function extractPlanSlug(filename: string): string {
  const stem = filename.replace(/\.md$/, '');
  const noDate = stem.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  const noPlanPrefix = noDate.replace(/^plan\d+-/, '');
  return noPlanPrefix.replace(/-part\d+$/, '');
}

/**
 * Read multiple UTF-8 text files into `{ path, content }` records.
 *
 * @param paths - File paths to read sequentially.
 * @returns Array of `{ path, content }` in input order.
 */
export async function readTextFiles(paths: string[]): Promise<{ path: string; content: string }[]> {
  const out: { path: string; content: string }[] = [];
  for (const path of paths) {
    out.push({ content: await readFile(path, 'utf8'), path });
  }
  return out;
}
