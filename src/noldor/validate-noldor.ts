import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import matter from 'gray-matter';
import { z } from 'zod';

const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

const frontmatterSchema = z
  .object({
    'noldor-page': z.string().min(1),
    introduced: z.string().regex(SEMVER_RE, 'introduced must be valid semver').optional(),
  })
  .strict();

/** Result of validating a single Noldor page. */
export interface ValidationResult {
  success: boolean;
  errors: string[];
}

/**
 * Validate a single Noldor page's frontmatter.
 *
 * Enforces:
 * - frontmatter block is present
 * - `noldor-page` field exists
 * - slug matches filename stem (`README.md` requires `index`)
 * - only known fields (`noldor-page`, optional `introduced`)
 * - `introduced` is valid semver when present
 *
 * @param filePath - Path to the markdown file (used for slug check)
 * @param contents - Raw file contents (frontmatter + body)
 * @returns Result with success flag and any human-readable errors
 */
export function validateNoldorPage(filePath: string, contents: string): ValidationResult {
  const errors: string[] = [];
  let parsed;
  try {
    parsed = matter(contents);
  } catch (err) {
    return { success: false, errors: [`failed to parse frontmatter: ${(err as Error).message}`] };
  }

  if (Object.keys(parsed.data).length === 0) {
    errors.push('missing frontmatter (expected ---/noldor-page/--- block)');
    return { success: false, errors };
  }

  const result = frontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      if (issue.code === 'unrecognized_keys' && 'keys' in issue) {
        for (const key of (issue as unknown as { keys: string[] }).keys) {
          errors.push(`unknown field "${key}"`);
        }
      } else {
        errors.push(`${path || 'frontmatter'}: ${issue.message}`);
      }
    }
    return { success: false, errors };
  }

  const expectedSlug = basename(filePath, '.md');
  const actualSlug = result.data['noldor-page'];
  const isReadme = basename(filePath) === 'README.md';
  const slugOk = isReadme ? actualSlug === 'index' : actualSlug === expectedSlug;

  if (!slugOk) {
    if (isReadme) {
      errors.push(`README.md must have noldor-page: index (got "${actualSlug}")`);
    } else {
      errors.push(`slug "${actualSlug}" does not match filename stem "${expectedSlug}"`);
    }
    return { success: false, errors };
  }

  return { success: true, errors: [] };
}

async function main(): Promise<void> {
  const dir = 'docs/noldor';
  const files = (await readdir(dir)).filter((n) => n.endsWith('.md'));

  let ok = true;
  for (const name of files) {
    const path = join(dir, name);
    const contents = await readFile(path, 'utf8');
    const result = validateNoldorPage(path, contents);
    if (!result.success) {
      ok = false;
      console.error(`✗ ${path}`);
      for (const err of result.errors) console.error(`    ${err}`);
    }
  }

  if (ok) {
    console.log(`Validated ${files.length} Noldor page(s) — all OK.`);
    return;
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
