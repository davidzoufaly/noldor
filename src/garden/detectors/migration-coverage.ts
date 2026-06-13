import { execFileSync } from 'node:child_process';

/** Consumer-facing schema surfaces. Edits here must ship a migration. */
export const SCHEMA_SURFACE: readonly string[] = [
  'src/core/consumer-config.ts',
  'docs/noldor/feature-md-schema.md',
  'templates/.noldor/config.json',
];

export interface MigrationCoverageFinding {
  readonly reason: 'schema-changed-without-migration';
  readonly schemaFiles: string[];
  readonly action: 'add-migration';
}

const MIGRATION_RE = /^src\/migrations\/[^/]+\.ts$/;

/** Pure core: decide coverage from a list of changed paths. */
export function evaluateCoverage(changed: readonly string[]): MigrationCoverageFinding | null {
  const schemaFiles = changed.filter((f) => SCHEMA_SURFACE.includes(f));
  if (schemaFiles.length === 0) return null;
  const hasMigration = changed.some(
    (f) => MIGRATION_RE.test(f) && !f.includes('__tests__') && f !== 'src/migrations/registry.ts',
  );
  if (hasMigration) return null;
  return { reason: 'schema-changed-without-migration', schemaFiles, action: 'add-migration' };
}

/** Range-based wrapper: diff `range` and evaluate coverage. */
export function detectMigrationCoverage(
  range: string,
  cwd: string = process.cwd(),
): MigrationCoverageFinding | null {
  let changed: string[] = [];
  try {
    changed = execFileSync('git', ['diff', '--name-only', range], { cwd, encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
  return evaluateCoverage(changed);
}
