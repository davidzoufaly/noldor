import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import matter from 'gray-matter';

import { FeatureFrontmatterSchema, type FeatureFrontmatter } from './feature-schema.js';
import { extractFeatureTags } from '../sync/sync-doc-links.js';
import { extractTags } from '../sync/sync-test-links.js';
import { loadConsumerConfig } from '../core/consumer-config.js';

/** Per-file validation result: file path plus list of human-readable issues. */
export interface FileError {
  file: string;
  issues: string[];
}

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
// `noldor` excluded so the framework package's own tests don't trip the
// tag-presence validator — those tests cover the framework itself, not
// individual feature slugs the way product tests do (matches pre-migration
// behavior when these tests lived under scripts/ and were outside TEST_WALK_ROOTS).
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git', 'noldor']);

async function walkDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(full)));
    } else if (entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

async function collectTestFiles(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const { name } = entry;
    if (name.startsWith('.') && name !== '.github') {
      continue;
    }
    if (EXCLUDED_DIRS.has(name)) {
      continue;
    }
    const full = join(dir, name);
    if (entry.isDirectory()) {
      await collectTestFiles(full, out);
    } else if (TEST_FILE_RE.test(name)) {
      out.push(full);
    }
  }
}

const TEST_WALK_ROOTS = ['apps', 'packages'];

/** Validate feature MD frontmatter for the given files; returns one FileError per failing file. */
export async function validateFiles(paths: string[]): Promise<FileError[]> {
  const errors: FileError[] = [];

  for (const path of paths) {
    const raw = await readFile(path, 'utf8');
    const parsed = matter(raw);
    const result = FeatureFrontmatterSchema.safeParse(parsed.data);

    const fileErrors: string[] = [];
    if (!result.success) {
      for (const issue of result.error.issues) {
        fileErrors.push(`${issue.path.join('.')}: ${issue.message}`);
      }
    } else {
      // If frontmatter is valid, run additional checks
      const slug = basename(path, '.md');
      const tierErrors = validateTierVsSpec(result.data, slug);
      fileErrors.push(...tierErrors);
    }
    if (fileErrors.length > 0) {
      errors.push({ file: path, issues: fileErrors });
    }
  }

  return errors;
}

/**
 * Extract the set of `packages/<name>` packages referenced by an FD's
 * `links.code` entries. Other path roots (`apps/`, `scripts/`, `docs/`)
 * are ignored — they don't carry an implicit `packages.*` mapping.
 *
 * @param codePaths - Raw `links.code` array
 * @returns Set of package names
 */
export function extractCodePackages(codePaths: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const p of codePaths) {
    const segments = p.split('/');
    if (segments[0] === 'packages' && segments[1]) {
      out.add(segments[1]);
    }
  }
  return out;
}

/**
 * Normalize a `packages` frontmatter entry to its short package name so
 * `format`, `<packagePrefix>format`, and `packages/format` all compare equal.
 * `apps/<name>` collapses to `<name>`. Reads `packagePrefix` and `appPathPrefix`
 * from the consumer config at `process.cwd()`.
 *
 * @param decl - Raw declared package value
 * @returns Short-name form
 */
export function normalizeDeclaredPackage(decl: string): string {
  const { packagePrefix, appPathPrefix } = loadConsumerConfig();
  const appsRootPrefix = appPathPrefix.split('/')[0] + '/';
  if (decl.startsWith(packagePrefix)) return decl.slice(packagePrefix.length);
  if (decl.startsWith('packages/')) return decl.slice('packages/'.length);
  if (decl.startsWith(appsRootPrefix)) return decl.slice(appsRootPrefix.length);
  return decl;
}

/**
 * Cross-check: every `packages/<name>` reference in `links.code` must
 * appear in the FD's `packages` frontmatter field. Catches gallery-style
 * drift upstream of the SDD orphan-code detector — an FD that owns
 * `packages/sample-scenes/src/*` must declare `sample-scenes` in its
 * `packages` field so the autofill resolver can find it.
 *
 * @param paths - Feature MD paths
 * @returns One FileError per FD whose `links.code` references packages
 *   missing from `packages` frontmatter
 */
export async function validatePackagesField(paths: string[]): Promise<FileError[]> {
  const errors: FileError[] = [];
  for (const path of paths) {
    const raw = await readFile(path, 'utf8');
    const parsed = matter(raw);
    const result = FeatureFrontmatterSchema.safeParse(parsed.data);
    if (!result.success) continue;
    const declared = new Set(result.data.packages.map(normalizeDeclaredPackage));
    const referenced = extractCodePackages(result.data.links.code);
    const missing = [...referenced].filter((p) => !declared.has(p));
    if (missing.length > 0) {
      errors.push({
        file: path,
        issues: missing.map(
          (p) => `links.code references package "${p}" not declared in packages frontmatter`,
        ),
      });
    }
  }
  return errors;
}

/**
 * Cross-check: every slug appearing in a `<!-- @feature: -->` comment must
 * correspond to an existing `docs/features/<slug>.md` file.
 *
 * @param paths - Doc file paths to scan (tutorials + explanations)
 * @returns One FileError per file whose tag references unknown slugs
 */
export async function validateDocFeatureSlugs(paths: string[]): Promise<FileError[]> {
  const errors: FileError[] = [];
  for (const path of paths) {
    const raw = await readFile(path, 'utf8');
    const tags = extractFeatureTags(raw);
    const issues: string[] = [];
    for (const slug of tags) {
      const featureMd = join('docs', 'features', `${slug}.md`);
      try {
        await readFile(featureMd, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          issues.push(`@feature: references unknown slug "${slug}" (expected ${featureMd})`);
        } else {
          throw error;
        }
      }
    }
    if (issues.length > 0) {
      errors.push({ file: path, issues });
    }
  }
  return errors;
}

const TESTS_TAG_RE = /^\/\/\s*@tests:/m;
const FEATURE_TAG_RE = /<!--\s*@feature:\s*[^>]+-->/;

/**
 * Hard-fail when a test file's body lacks any `// @tests: <slug>` line.
 *
 * @param paths - Test file paths to scan
 * @returns One FileError per file missing the tag
 */
export async function validateTestTagPresence(paths: string[]): Promise<FileError[]> {
  const errors: FileError[] = [];
  for (const path of paths) {
    const raw = await readFile(path, 'utf8');
    if (!TESTS_TAG_RE.test(raw)) {
      errors.push({
        file: path,
        issues: ['missing required `// @tests: <feature-slug>` tag (first non-import line)'],
      });
    }
  }
  return errors;
}

/**
 * Hard-fail when a tutorial/explanation MD body lacks any `<!-- @feature: <slug> -->` tag.
 *
 * @param paths - Doc file paths to scan
 * @returns One FileError per file missing the tag
 */
export async function validateDocTagPresence(paths: string[]): Promise<FileError[]> {
  const errors: FileError[] = [];
  for (const path of paths) {
    const raw = await readFile(path, 'utf8');
    if (!FEATURE_TAG_RE.test(raw)) {
      errors.push({
        file: path,
        issues: ['missing required `<!-- @feature: <slug> -->` tag'],
      });
    }
  }
  return errors;
}

/**
 * Drift check: FDs with noldor-tier=full must have links.spec set.
 * Plan-only FDs should not have a spec.
 *
 * @param fm - Feature frontmatter
 * @param slug - Feature slug (for error messages)
 * @returns Array of error messages (empty if valid)
 */
export function validateTierVsSpec(fm: FeatureFrontmatter, slug: string): string[] {
  if (fm['noldor-tier'] === 'full' && !fm.links?.spec) {
    return [`${slug}: noldor-tier=full but links.spec is unset`];
  }
  return [];
}

/**
 * Cross-check: every slug appearing in a `// @tests:` comment must
 * correspond to an existing `docs/features/<slug>.md` file.
 *
 * @param paths - Test (or test-shaped) file paths to scan
 * @returns One FileError per file whose tag references unknown feature slugs
 */
export async function validateTaggedSlugs(paths: string[]): Promise<FileError[]> {
  const errors: FileError[] = [];
  for (const path of paths) {
    const raw = await readFile(path, 'utf8');
    const tags = extractTags(raw);
    const issues: string[] = [];
    for (const slug of tags) {
      const featureMd = join('docs', 'features', `${slug}.md`);
      try {
        await readFile(featureMd, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          issues.push(`@tests: references unknown feature slug "${slug}" (expected ${featureMd})`);
        } else {
          throw error;
        }
      }
    }
    if (issues.length > 0) {
      errors.push({ file: path, issues });
    }
  }
  return errors;
}

async function main(): Promise<void> {
  const dir = 'docs/features';
  let files: string[] = [];
  try {
    files = await walkDir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(`${dir}/ does not exist yet — nothing to validate.`);
      return;
    }
    throw error;
  }

  if (files.length === 0) {
    console.log('No feature MDs found.');
    return;
  }

  const errors = await validateFiles(files);
  const packagesFieldErrors = await validatePackagesField(files);

  const presenceTestFiles: string[] = [];
  for (const root of TEST_WALK_ROOTS) {
    await collectTestFiles(root, presenceTestFiles);
  }
  const testTagPresenceErrors = await validateTestTagPresence(presenceTestFiles);

  const allTestFiles: string[] = [];
  await collectTestFiles(process.cwd(), allTestFiles);
  const tagErrors = await validateTaggedSlugs(allTestFiles);

  const docFiles: string[] = [];
  for (const sub of ['docs/user/tutorials', 'docs/user/explanation']) {
    try {
      const entries = await readdir(sub, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          docFiles.push(join(sub, entry.name));
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const docTagPresenceErrors = await validateDocTagPresence(docFiles);
  const docTagErrors = await validateDocFeatureSlugs(docFiles);

  const allErrors = [
    ...errors,
    ...packagesFieldErrors,
    ...testTagPresenceErrors,
    ...tagErrors,
    ...docTagPresenceErrors,
    ...docTagErrors,
  ];

  if (allErrors.length === 0) {
    console.log(`Validated ${files.length} feature MD(s) — all OK.`);
    return;
  }

  for (const err of allErrors) {
    console.error(`\n${err.file}`);
    for (const issue of err.issues) {
      console.error(`  - ${issue}`);
    }
  }
  if (errors.length > 0) {
    console.error(`\n${errors.length} file(s) failed validation out of ${files.length}.`);
  }
  if (packagesFieldErrors.length > 0) {
    console.error(
      `\n${packagesFieldErrors.length} feature MD(s) have packages frontmatter mismatched against links.code.`,
    );
  }
  if (testTagPresenceErrors.length > 0) {
    console.error(`\n${testTagPresenceErrors.length} test file(s) missing // @tests: tag.`);
  }
  if (tagErrors.length > 0) {
    console.error(`\n${tagErrors.length} test file(s) reference unknown feature slugs.`);
  }
  if (docTagPresenceErrors.length > 0) {
    console.error(`\n${docTagPresenceErrors.length} doc file(s) missing <!-- @feature: --> tag.`);
  }
  if (docTagErrors.length > 0) {
    console.error(`\n${docTagErrors.length} doc file(s) reference unknown feature slugs.`);
  }
  process.exitCode = 1;
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('validate-features');
if (invokedDirect) {
  void main();
}
