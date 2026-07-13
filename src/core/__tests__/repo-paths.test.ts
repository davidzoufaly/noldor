// @tests: scan-roots-repo-paths-provider

import { describe, expect, it } from 'vitest';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_SCAN_ROOTS, actualPackageNames, scanRoots, walkCodeFiles } from '../repo-paths.js';
import { scanRoots as legacyScanRoots } from '../../sync/sync-code-links.js';

const MINIMAL_CONSUMER = {
  name: 'acme',
  repoUrl: 'https://github.com/x/y',
  lockstepPackages: ['package.json'],
  scanPaths: [],
  boundaries: [],
  deprecatedPackages: [],
  e2ePrefix: '',
  samplesPath: '',
  packagePrefix: '',
  appPathPrefix: '',
};

function makeTmpRepo(scanPaths: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'noldor-repo-paths-'));
  mkdirSync(join(dir, '.noldor'), { recursive: true });
  writeFileSync(
    join(dir, '.noldor', 'config.json'),
    JSON.stringify({ consumer: { ...MINIMAL_CONSUMER, scanPaths } }),
  );
  return dir;
}

describe('scanRoots', () => {
  it('returns configured consumer scanPaths when non-empty', () => {
    const dir = makeTmpRepo(['src', 'tools']);
    try {
      expect(scanRoots(dir)).toEqual(['src', 'tools']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the 4-dir union when scanPaths is empty', () => {
    const dir = makeTmpRepo([]);
    try {
      expect(scanRoots(dir)).toEqual(['packages', 'apps', 'scripts', 'src']);
      expect(scanRoots(dir)).toEqual(DEFAULT_SCAN_ROOTS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fallback-union regression: unconfigured monorepo roots include packages', () => {
    // PR #122 CR lesson: a src-only fallback regresses unconfigured monorepo
    // consumers. The union must win (propose-pointers had a private one).
    const dir = makeTmpRepo([]);
    try {
      mkdirSync(join(dir, 'packages', 'a'), { recursive: true });
      const roots = scanRoots(dir);
      expect(roots).toContain('packages');
      expect(roots).not.toEqual(['src']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is re-exported unchanged from sync-code-links (single definition)', () => {
    expect(legacyScanRoots).toBe(scanRoots);
  });
});

describe('actualPackageNames', () => {
  it('reads names from packages/*/package.json, skipping dirs without one', async () => {
    const dir = makeTmpRepo([]);
    try {
      mkdirSync(join(dir, 'packages', 'a'), { recursive: true });
      writeFileSync(
        join(dir, 'packages', 'a', 'package.json'),
        JSON.stringify({ name: '@acme/a' }),
      );
      mkdirSync(join(dir, 'packages', 'b'), { recursive: true }); // no package.json
      await expect(actualPackageNames(dir)).resolves.toEqual(['@acme/a']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns [] when packages/ does not exist (standalone layout)', async () => {
    const dir = makeTmpRepo(['src']);
    try {
      await expect(actualPackageNames(dir)).resolves.toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('walkCodeFiles', () => {
  it('collects code files, skipping tests/dist by default, including with flag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'noldor-walk-'));
    mkdirSync(join(dir, 'a', '__tests__'), { recursive: true });
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'a', 'x.ts'), 'export {};\n');
    writeFileSync(join(dir, 'a', 'y.test.ts'), 'export {};\n');
    writeFileSync(join(dir, 'a', '__tests__', 'z.ts'), 'export {};\n');
    writeFileSync(join(dir, 'dist', 'd.ts'), 'export {};\n');
    writeFileSync(join(dir, 'a', 'n.md'), '# no\n');
    const rel = (xs: string[]) => xs.map((p) => p.slice(dir.length + 1)).sort();
    expect(rel(walkCodeFiles(dir, { includeTests: false }))).toEqual(['a/x.ts']);
    expect(rel(walkCodeFiles(dir, { includeTests: true }))).toEqual([
      'a/__tests__/z.ts',
      'a/x.ts',
      'a/y.test.ts',
    ]);
    expect(walkCodeFiles(join(dir, 'missing'), { includeTests: false })).toEqual([]);
  });
});
