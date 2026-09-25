// @tests: outcome-telemetry-and-effectiveness-metrics
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, it, expect } from 'vitest';
import { detectMigrationCoverage, evaluateCoverage } from '../migration-coverage.js';

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

describe('evaluateCoverage with a no-migration declaration', () => {
  it('drops a declared schema file from the finding', () => {
    const declared = new Set(['src/core/consumer-config.ts']);
    expect(evaluateCoverage(['src/core/consumer-config.ts'], declared)).toBeNull();
  });
  it('still flags an undeclared schema file next to a declared one', () => {
    const declared = new Set(['src/core/consumer-config.ts']);
    const f = evaluateCoverage(
      ['src/core/consumer-config.ts', 'docs/noldor/feature-md-schema.md'],
      declared,
    );
    expect(f?.schemaFiles).toEqual(['docs/noldor/feature-md-schema.md']);
  });
});

describe('detectMigrationCoverage', () => {
  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'migration-coverage-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
    commit(dir, 'chore: base', ['src/core/consumer-config.ts', 'README.md']);
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: dir });
    return dir;
  }

  function commit(dir: string, message: string, files: string[]): void {
    for (const file of files) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      appendFileSync(join(dir, file), `${message}\n`);
    }
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
  }

  it('flags a schema change with no migration and no declaration', () => {
    const dir = repo();
    commit(dir, 'feat: add a key', ['src/core/consumer-config.ts']);
    expect(detectMigrationCoverage('v1.0.0..HEAD', dir)?.schemaFiles).toEqual([
      'src/core/consumer-config.ts',
    ]);
  });

  it('is silent when every commit touching the schema declares no migration', () => {
    const dir = repo();
    commit(dir, 'feat: add an optional key\n\nNoldor-Migration: none', [
      'src/core/consumer-config.ts',
    ]);
    commit(dir, 'fix: unrelated', ['README.md']);
    expect(detectMigrationCoverage('v1.0.0..HEAD', dir)).toBeNull();
  });

  it('reads the declaration from a squash body, where it is not a trailer', () => {
    const dir = repo();
    commit(
      dir,
      'feat: add an optional key (#9)\n\n* feat: add it\n\nNoldor-Migration: none\n\n---------\n\nCo-authored-by: T <t@example.com>',
      ['src/core/consumer-config.ts'],
    );
    expect(detectMigrationCoverage('v1.0.0..HEAD', dir)).toBeNull();
  });

  it('flags the file again once a later undeclared commit changes it', () => {
    const dir = repo();
    commit(dir, 'feat: add an optional key\n\nNoldor-Migration: none', [
      'src/core/consumer-config.ts',
    ]);
    commit(dir, 'feat: rename a key', ['src/core/consumer-config.ts']);
    expect(detectMigrationCoverage('v1.0.0..HEAD', dir)?.schemaFiles).toEqual([
      'src/core/consumer-config.ts',
    ]);
  });

  it('does not accept a declaration value other than none', () => {
    const dir = repo();
    commit(dir, 'feat: add a key\n\nNoldor-Migration: later', ['src/core/consumer-config.ts']);
    expect(detectMigrationCoverage('v1.0.0..HEAD', dir)).not.toBeNull();
  });
});
