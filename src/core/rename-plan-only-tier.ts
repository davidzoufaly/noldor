import { readFileSync, writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { argv, exit } from 'node:process';
import { minimatch } from 'minimatch';

/**
 * Pure text-substitution helper for the one-time `plan-only` → `specs-only`
 * tier rename. Two passes:
 *
 *   1. Hyphenated identifier `plan-only` → `specs-only` — used in Zod
 *      enums, frontmatter values, YAML keys, prose, and path identifiers
 *      (`plan-only-new` / `plan-only-attach` flip to `specs-only-new` /
 *      `specs-only-attach` for free by substring overlap).
 *
 *   2. CamelCase identifier `planOnly` → `specsOnly` — used as a TS
 *      property name inside `scripts/garden/sdd-report.ts` (4 sites).
 *      Substring-disjoint from the hyphenated form, so the order of the
 *      two substitutions does not matter.
 *
 * Slug protection: the FD slug `rename-plan-only-tier-to-specs-only` contains
 * `plan-only` as a substring but is an identifier of THIS feature (not a tier
 * value). It is round-tripped through a placeholder so the rename leaves it
 * intact. Same for the plan filename `2026-05-23-rename-plan-only-tier-to-specs-only.md`.
 *
 * The space-separated English phrase `plan only` (used in human-readable
 * labels) is left alone — `sdd-report.ts`'s `(plan only)` legend is a
 * separate hand-edit and updates to `(no brainstorm)` to match the new
 * mental model.
 *
 * Idempotent by construction: subsequent runs over already-renamed input
 * find neither substring and return the input unchanged.
 */
const PROTECTED_SLUG = 'rename-plan-only-tier-to-specs-only';
const PROTECTED_PLACEHOLDER = '__SPECS_ONLY_RENAME_SLUG__';

export function renamePlanOnlyTier(input: string): string {
  return input
    .replaceAll(PROTECTED_SLUG, PROTECTED_PLACEHOLDER)
    .replaceAll('plan-only', 'specs-only')
    .replaceAll('planOnly', 'specsOnly')
    .replaceAll(PROTECTED_PLACEHOLDER, PROTECTED_SLUG);
}

const FILE_GLOBS = [
  'scripts/**/*.ts',
  '.claude/skills/*/SKILL.md',
  'docs/noldor/*.md',
  'docs/features/*.md',
  'docs/roadmap.md',
  'docs/backlog.md',
  'docs/design/plans/*.md',
  'docs/design/specs/*.md',
  'scripts/fixtures/*.md',
  '.noldor/*.json',
  'package.json',
];

const EXCLUDE_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  'docs/design/plans/archive/**',
  'docs/design/specs/archive/**',
  'CHANGELOG.md',
  'graphify-out/**',
  '.worktrees/**',
  '.claude/worktrees/**',
  // Migration helper + its tests are excluded — they contain `'plan-only'`
  // string literals AS test/code data (not as tier identifiers) and the
  // substitution would mangle them. The PROTECTED_SLUG mechanism above only
  // protects the FD slug, not raw literals in the helper's own source.
  'scripts/noldor/rename-plan-only-tier.ts',
  'scripts/noldor/__tests__/rename-plan-only-tier.test.ts',
];

async function collectFiles(): Promise<string[]> {
  const seen = new Set<string>();
  for (const pattern of FILE_GLOBS) {
    for await (const path of glob(pattern)) {
      const normalized = path.replace(/\\/g, '/');
      if (EXCLUDE_GLOBS.some((g) => minimatch(normalized, g, { dot: true }))) {
        continue;
      }
      seen.add(normalized);
    }
  }
  return [...seen].toSorted();
}

async function main(): Promise<void> {
  const dryRun = argv.includes('--dry-run');
  const files = await collectFiles();
  let touched = 0;
  for (const path of files) {
    const before = readFileSync(path, 'utf8');
    const after = renamePlanOnlyTier(before);
    if (after !== before) {
      touched++;
      if (dryRun) {
        console.log(`would-touch ${path}`);
      } else {
        writeFileSync(path, after, 'utf8');
        console.log(`touched ${path}`);
      }
    }
  }
  console.log(`\n${dryRun ? 'dry-run' : 'applied'}: ${touched} file(s) touched`);
}

if (import.meta.url === `file://${argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    exit(1);
  });
}
