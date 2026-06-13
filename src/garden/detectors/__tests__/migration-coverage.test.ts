import { describe, it, expect } from 'vitest';
import { evaluateCoverage } from '../migration-coverage.js';

describe('evaluateCoverage', () => {
  it('flags a schema change with no migration', () => {
    const f = evaluateCoverage(['src/core/consumer-config.ts', 'README.md']);
    expect(f).not.toBeNull();
    expect(f?.reason).toBe('schema-changed-without-migration');
    expect(f?.schemaFiles).toContain('src/core/consumer-config.ts');
  });
  it('is silent when a migration accompanies the schema change', () => {
    expect(evaluateCoverage(['src/core/consumer-config.ts', 'src/migrations/0.5.0.ts'])).toBeNull();
  });
  it('ignores migration test files (not a real migration)', () => {
    const f = evaluateCoverage([
      'docs/noldor/feature-md-schema.md',
      'src/migrations/__tests__/chain.test.ts',
    ]);
    expect(f).not.toBeNull();
  });
  it('is silent when no schema surface changed', () => {
    expect(evaluateCoverage(['src/dashboard/server.ts'])).toBeNull();
  });
  it('does NOT treat engine modules as a migration', () => {
    // chain.ts/semver.ts/registry.ts live under src/migrations/ but are not
    // version-named — touching them must not satisfy the discipline gate.
    for (const engine of [
      'src/migrations/chain.ts',
      'src/migrations/semver.ts',
      'src/migrations/registry.ts',
    ]) {
      const f = evaluateCoverage(['src/core/consumer-config.ts', engine]);
      expect(f, engine).not.toBeNull();
    }
  });
  it('accepts a version-named migration module', () => {
    expect(
      evaluateCoverage(['src/core/consumer-config.ts', 'src/migrations/0.10.0.ts']),
    ).toBeNull();
  });
});
