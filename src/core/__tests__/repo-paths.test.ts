// @tests: scan-roots-repo-paths-provider

import { describe, expect, it } from 'vitest';

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_SCAN_ROOTS,
  actualPackageNames,
  newestMtimeInRoots,
  scanRoots,
  walkCodeFiles,
  walkDir,
} from '../repo-paths.js';
import { realpathSync } from 'node:fs';
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

describe('walkDir symlink policy', () => {
  /** A tree with a file symlink and a directory cycle (`src/deep/loop -> src`). */
  function treeWithLinks(): string {
    const dir = mkdtempSync(join(tmpdir(), 'walkdir-links-'));
    mkdirSync(join(dir, '.noldor'), { recursive: true });
    mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
    mkdirSync(join(dir, 'outside'), { recursive: true });
    writeFileSync(
      join(dir, '.noldor', 'config.json'),
      JSON.stringify({ consumer: { ...MINIMAL_CONSUMER, scanPaths: ['src'] } }),
      'utf8',
    );
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    writeFileSync(join(dir, 'outside', 'newest.ts'), 'export const n = 1;\n', 'utf8');
    symlinkSync(join(dir, 'outside', 'newest.ts'), join(dir, 'src', 'linked.ts'));
    symlinkSync(join(dir, 'src'), join(dir, 'src', 'deep', 'loop'));
    return dir;
  }

  it('makes a symlinked file visible to the mtime walker but not to the corpus', () => {
    const dir = treeWithLinks();
    try {
      const future = new Date(Date.now() + 600_000);
      utimesSync(join(dir, 'outside', 'newest.ts'), future, future);
      // Only reachable through `src/linked.ts`. The mtime walker follows file
      // links, so a stale graph cannot pass freshness by hiding the newest file
      // behind one...
      expect(newestMtimeInRoots(dir, ['src'])).toBeGreaterThan(Date.now());
      // ...while the corpus does not, keeping it to git-tracked paths.
      expect(walkCodeFiles(join(dir, 'src'), { includeTests: true })).not.toContain(
        join(dir, 'src', 'linked.ts'),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sees through a symlinked directory on the mtime path but not the corpus', () => {
    const dir = mkdtempSync(join(tmpdir(), 'walkdir-dirlink-'));
    try {
      mkdirSync(join(dir, '.noldor'), { recursive: true });
      mkdirSync(join(dir, 'src'), { recursive: true });
      mkdirSync(join(dir, 'generated'), { recursive: true });
      writeFileSync(
        join(dir, '.noldor', 'config.json'),
        JSON.stringify({ consumer: { ...MINIMAL_CONSUMER, scanPaths: ['src'] } }),
        'utf8',
      );
      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
      writeFileSync(join(dir, 'generated', 'gen.ts'), 'export const g = 1;\n', 'utf8');
      symlinkSync(join(dir, 'generated'), join(dir, 'src', 'generated'));
      const future = new Date(Date.now() + 600_000);
      utimesSync(join(dir, 'generated', 'gen.ts'), future, future);
      // The mtime leg follows directory links (pre-lift parity): a changed file
      // behind `src/generated -> ../generated` must stale the graph, or a stale
      // graph reads fresh — the dangerous inverse of the leg's false-stale mode.
      // `gen.ts` is stamped 10 minutes ahead, so seeing it is unmistakable.
      expect(newestMtimeInRoots(dir, ['src'])).toBe(future.getTime());
      // The corpus still skips links of every kind — git-tracked paths only.
      expect(walkCodeFiles(join(dir, 'src'), { includeTests: true })).toEqual([
        join(dir, 'src', 'a.ts'),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('bounds a directory-link cycle on both paths', () => {
    const dir = treeWithLinks();
    try {
      // `src/deep/loop -> src` re-walked the tree until ENAMETOOLONG when
      // directory links were followed, inflating the corpus that feeds the
      // clone detector with paths like `src/deep/loop/deep/loop/...`.
      // Corpus: links skipped outright, so `src/deep/loop -> src` cannot recurse
      // and `linked.ts` (a file link) is not emitted — pre-lift behaviour.
      const found = walkCodeFiles(join(dir, 'src'), { includeTests: true });
      expect(found).toEqual([join(dir, 'src', 'a.ts')]);
      expect(found.some((p) => p.includes('loop'))).toBe(false);
      // Mtime: follows links, so the cycle relies on the realpath visited set to
      // terminate. Asserted on walkDir directly, because through
      // newestMtimeInRoots an ENAMETOOLONG-exhausted walk (the pre-lift failure)
      // returns the same non-null max and is indistinguishable from bounding —
      // observing onFile is what discriminates: exhaustion re-visits `a.ts` at
      // every nesting depth, bounding visits it exactly once.
      const seen: string[] = [];
      walkDir(
        join(dir, 'src'),
        (full) => seen.push(full),
        () => false,
        true,
        realpathSync(dir),
      );
      expect(seen.filter((p) => p.endsWith('a.ts'))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits the real path, never an alias, whatever readdir returns first', () => {
    // Probed shape: `src/alink -> src/real` returned the alias path, and
    // renaming the link to `zlink` changed the output for the same tree.
    for (const linkName of ['alink', 'zlink']) {
      const dir = mkdtempSync(join(tmpdir(), 'walkdir-alias-'));
      try {
        mkdirSync(join(dir, '.noldor'), { recursive: true });
        mkdirSync(join(dir, 'src', 'real'), { recursive: true });
        writeFileSync(
          join(dir, '.noldor', 'config.json'),
          JSON.stringify({ consumer: { ...MINIMAL_CONSUMER, scanPaths: ['src'] } }),
          'utf8',
        );
        writeFileSync(join(dir, 'src', 'real', 'a.ts'), 'export const a = 1;\n', 'utf8');
        symlinkSync(join(dir, 'src', 'real'), join(dir, 'src', linkName));
        expect(walkCodeFiles(join(dir, 'src'), { includeTests: true })).toEqual([
          join(dir, 'src', 'real', 'a.ts'),
        ]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('never escapes the repo or re-admits an excluded dir through a link', () => {
    const dir = mkdtempSync(join(tmpdir(), 'walkdir-escape-'));
    const outside = mkdtempSync(join(tmpdir(), 'walkdir-outside-'));
    try {
      mkdirSync(join(dir, '.noldor'), { recursive: true });
      mkdirSync(join(dir, 'src'), { recursive: true });
      mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
      writeFileSync(
        join(dir, '.noldor', 'config.json'),
        JSON.stringify({ consumer: { ...MINIMAL_CONSUMER, scanPaths: ['src'] } }),
        'utf8',
      );
      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
      const future = new Date(Date.now() + 600_000);
      // Outside the repo: must stay invisible however new.
      writeFileSync(join(outside, 'host.ts'), 'x', 'utf8');
      utimesSync(join(outside, 'host.ts'), future, future);
      symlinkSync(outside, join(dir, 'src', 'root'));
      // Excluded tree re-admitted under another name: must stay excluded, or the
      // mtime aggregate turns into a perpetual false-stale.
      writeFileSync(join(dir, 'node_modules', 'dep', 'dep.ts'), 'x', 'utf8');
      utimesSync(join(dir, 'node_modules', 'dep', 'dep.ts'), future, future);
      symlinkSync(join(dir, 'node_modules'), join(dir, 'src', 'vendor'));
      expect(newestMtimeInRoots(dir, ['src'])).toBeLessThan(future.getTime());
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
