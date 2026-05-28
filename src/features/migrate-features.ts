/**
 * Legacy `docs/features.yaml` row shape consumed by the one-shot migration.
 * Mirrors the historical schema before the feature MD framework took over.
 */
export interface YamlEntry {
  name: string;
  status: 'done' | 'planned' | 'in-progress';
  version?: string;
  package: string;
  description: string;
}

/**
 * Lowercase, replace spaces + slashes with hyphens, strip other punctuation.
 * Keeps alphanumerics and hyphens only.
 *
 * @param name - Human-readable feature name
 * @returns URL-safe slug suitable for a filename
 *
 * @example
 * ```typescript
 * slugify('Undo/Redo'); // 'undo-redo'
 * ```
 */
export { slugify } from '../utils/slugify.js';

/**
 * Map legacy `package` YAML field to an `area` value.
 * Multi-package entries (comma-separated) return 'cross-cutting'.
 * Single-package entries echo the package name as a starting point;
 * author can refine post-migration.
 *
 * @param pkg - Raw `package` field from features.yaml
 * @returns Area string for the new frontmatter
 */
export function areaFromPackage(pkg: string): string {
  if (pkg.includes(',')) {
    return 'cross-cutting';
  }
  return pkg.trim();
}

/**
 * Convert YAML entry with status=done into a feature MD with full frontmatter
 * and stub body sections. Body User Story + Usage are TODO placeholders — the
 * migration is deliberately incomplete there; operator polishes in follow-up
 * PRs per the spec's Part-1 migration strategy.
 *
 * @param entry - Parsed YAML entry
 * @returns Markdown string ready to write to `docs/features/<slug>.md`
 */
export function yamlToFeatureMd(entry: YamlEntry): string {
  const packages = entry.package.split(',').map((p) => p.trim());
  const packagesYaml = packages.map((p) => `  - ${p}`).join('\n');

  const introduced = entry.version ? `introduced: "${entry.version}"\n` : '';

  return `---
name: ${entry.name}
phase: done
${introduced}area: ${areaFromPackage(entry.package)}
packages:
${packagesYaml}
links:
  prs: []
  code: []
  tests: []
---

## Summary

${entry.description}

## User Story

<!-- TODO: polish during batched User Story pass.
Format: As a user (human or agent), I want to <action>, so that <outcome>. -->

## Usage

<!-- TODO: polish during batched Usage pass.
Include UI steps, keyboard shortcut, and agent API call where applicable. -->
`;
}

/**
 * Convert YAML entry with status=planned into a backlog.md schema-C block.
 *
 * @param entry - Parsed YAML entry
 * @returns Markdown block for `docs/backlog.md`
 */
export function yamlToBacklogBlock(entry: YamlEntry): string {
  const today = new Date().toISOString().slice(0, 10);
  return `### ${entry.name}
- area: ${areaFromPackage(entry.package)}
- phase: later
- since: ${today}

${entry.description}
`;
}

/**
 * Infer `noldor-tier` from FD frontmatter:
 * - If `noldor-tier` is already set, return unchanged (idempotent).
 * - If `links.spec` is present, assign `'full'`.
 * - Otherwise assign `'specs-only'`.
 *
 * @param fm - Frontmatter object
 * @returns Frontmatter with inferred or unchanged `noldor-tier`
 */
export function inferTier(fm: Record<string, unknown>): Record<string, unknown> {
  // Idempotent: if already set, don't change it
  if (fm['noldor-tier']) return fm;

  const links = (fm.links as { spec?: string }) ?? {};
  const tier = links.spec ? 'full' : 'specs-only';
  return { ...fm, 'noldor-tier': tier };
}

// CLI execution
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import matter from 'gray-matter';

async function walkFeaturesDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const inferTierFlag = args.has('--infer-tier');
  const dryRun = args.has('--dry-run');

  if (!inferTierFlag) {
    console.log('No migration mode specified. Use --infer-tier.');
    return;
  }

  const featuresDir = 'docs/features';
  let files: string[] = [];
  try {
    files = await walkFeaturesDir(featuresDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(`${featuresDir}/ does not exist yet — nothing to migrate.`);
      return;
    }
    throw error;
  }

  if (files.length === 0) {
    console.log('No feature MDs found.');
    return;
  }

  const results: Array<{ file: string; changed: boolean; inferred: string }> = [];

  for (const file of files) {
    const raw = await readFile(file, 'utf8');
    const parsed = matter(raw);
    const before = JSON.stringify(parsed.data);
    const transformed = inferTier(parsed.data);
    const after = JSON.stringify(transformed);
    const changed = before !== after;

    if (changed) {
      const tier = transformed['noldor-tier'] as string;
      results.push({ file, changed: true, inferred: tier });

      if (!dryRun) {
        const output = matter.stringify(parsed.content, transformed);
        await writeFile(file, output, 'utf8');
      }
    }
  }

  // Report
  if (results.length === 0) {
    console.log(
      `No changes needed (${files.length} feature MD(s) already have noldor-tier or inferred tier is unchanged).`,
    );
    return;
  }

  console.log(
    `\n${dryRun ? '[DRY RUN] ' : ''}Inferred noldor-tier for ${results.length} feature MD(s):\n`,
  );
  for (const r of results) {
    const slug = basename(r.file, '.md');
    console.log(`  ${slug}: ${r.inferred}`);
  }

  if (dryRun) {
    console.log(`\nNo files modified (dry run). Re-run without --dry-run to apply.`);
  } else {
    console.log(`\nModified ${results.length} file(s).`);
  }
}

const invokedDirect = process.argv[1] && basename(process.argv[1]).startsWith('migrate-features');
if (invokedDirect) {
  void main();
}
