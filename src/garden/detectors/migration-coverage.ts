import { execFileSync } from 'node:child_process';

/** Consumer-facing schema surfaces. Edits here must ship a migration. */
export const SCHEMA_SURFACE: readonly string[] = [
  'src/core/consumer-config.ts',
  'docs/noldor/feature-md-schema.md',
];

export interface MigrationCoverageFinding {
  readonly reason: 'schema-changed-without-migration';
  readonly schemaFiles: string[];
  readonly action: 'add-migration';
}

// A *real* migration module is version-named: `src/migrations/<x.y.z>.ts`. This
// deliberately excludes the engine modules that also live under `src/migrations/`
// (`chain.ts`, `semver.ts`, `pkg-version.ts`, `types.ts`, `registry.ts`) and any
// test file — touching those must NOT satisfy the authoring-discipline gate.
const MIGRATION_RE = /^src\/migrations\/\d+\.\d+\.\d+\.ts$/;

/** Pure core: decide coverage from a list of changed paths. */
export function evaluateCoverage(changed: readonly string[]): MigrationCoverageFinding | null {
  const schemaFiles = changed.filter((f) => SCHEMA_SURFACE.includes(f));
  if (schemaFiles.length === 0) return null;
  const hasMigration = changed.some((f) => MIGRATION_RE.test(f));
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
