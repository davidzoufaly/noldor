import { execFileSync } from 'node:child_process';

/**
 * Consumer-facing schema surfaces. Edits here must ship a migration, or declare
 * `Noldor-Migration: none` on every commit that makes them.
 */
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

/**
 * Pure core: decide coverage from a list of changed paths. A schema file in
 * `declaredNoMigration` was changed only by commits that declared the change
 * needs no migration (an additive optional key no existing config can fail on),
 * so it drops out of the finding.
 */
export function evaluateCoverage(
  changed: readonly string[],
  declaredNoMigration: ReadonlySet<string> = new Set(),
): MigrationCoverageFinding | null {
  const schemaFiles = changed.filter(
    (f) => SCHEMA_SURFACE.includes(f) && !declaredNoMigration.has(f),
  );
  if (schemaFiles.length === 0) return null;
  const hasMigration = changed.some((f) => MIGRATION_RE.test(f));
  if (hasMigration) return null;
  return { reason: 'schema-changed-without-migration', schemaFiles, action: 'add-migration' };
}

const RECORD = '\x1e';
const FIELD = '\x1f';
// Read as a body line, not through `git interpret-trailers`: a squash merge keeps
// each branch commit's trailers only as body lines (see undeclared-doc-impact.ts).
const NO_MIGRATION_LINE = /^Noldor-Migration:[ \t]*none[ \t]*$/m;

/**
 * Schema files whose every first-parent commit in `range` carries a
 * `Noldor-Migration: none` line. One undeclared commit keeps the file in the
 * finding, so a later breaking change still needs its migration.
 */
function filesDeclaredNoMigration(range: string, cwd: string): Set<string> {
  const out = execFileSync(
    'git',
    [
      'log',
      '--first-parent',
      '--no-renames',
      '--name-only',
      `--format=${RECORD}%B${FIELD}`,
      range,
      '--',
      ...SCHEMA_SURFACE,
    ],
    { cwd, encoding: 'utf8' },
  );
  const declared = new Set<string>();
  const undeclared = new Set<string>();
  for (const chunk of out.split(RECORD)) {
    const [body = '', files = ''] = chunk.split(FIELD);
    const into = NO_MIGRATION_LINE.test(body) ? declared : undeclared;
    for (const file of files.split('\n').map((f) => f.trim())) {
      if (SCHEMA_SURFACE.includes(file)) into.add(file);
    }
  }
  for (const file of undeclared) declared.delete(file);
  return declared;
}

/** Range-based wrapper: diff `range` and evaluate coverage. */
export function detectMigrationCoverage(
  range: string,
  cwd: string = process.cwd(),
): MigrationCoverageFinding | null {
  let changed: string[] = [];
  let declared: Set<string>;
  try {
    changed = execFileSync('git', ['diff', '--name-only', range], { cwd, encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    declared = filesDeclaredNoMigration(range, cwd);
  } catch {
    return null;
  }
  return evaluateCoverage(changed, declared);
}
