// @tests: scan-roots-repo-paths-provider, dynamic-fd-file-pointers-via-frontmatter

import { describe, expect, it } from 'vitest';

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  DEFAULT_SCAN_ROOTS,
  actualPackageNames,
  newestMtimeInRoots,
  repoRelativePath,
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

describe(repoRelativePath, () => {
  it.each([
    ['a relative path', 'src/a.ts', 'src/a.ts'],
    ['a dotted relative path with a trailing slash', './src/design/', 'src/design'],
    ['an absolute path inside the repository', '/repo/src/a.ts', 'src/a.ts'],
    ['the repository root', '.', ''],
  ])('keeps %s', (_label, value, expected) => {
    expect(repoRelativePath('/repo', value)).toBe(expected);
  });

  it.each([
    ['the parent directory itself', '..'],
    ['a path climbing out', '../../etc/passwd'],
    ['an absolute path elsewhere', '/elsewhere/a.ts'],
  ])('refuses %s', (_label, value) => {
    expect(repoRelativePath('/repo', value)).toBeNull();
  });
});

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

  it('excludes a link INTO a descendant of an excluded dir, segment-wise', () => {
    const dir = mkdtempSync(join(tmpdir(), 'walkdir-into-excluded-'));
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
      writeFileSync(join(dir, 'node_modules', 'dep', 'd.ts'), 'x', 'utf8');
      utimesSync(join(dir, 'node_modules', 'dep', 'd.ts'), future, future);
      // Resolves to basename `dep`, so a basename-only check re-admitted the
      // excluded subtree; the `node_modules` SEGMENT is what must fail it.
      symlinkSync(join(dir, 'node_modules', 'dep'), join(dir, 'src', 'lib'));
      expect(newestMtimeInRoots(dir, ['src'])).toBeLessThan(future.getTime());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not name-check the walk root itself', () => {
    const dir = mkdtempSync(join(tmpdir(), 'walkdir-dotroot-'));
    try {
      mkdirSync(join(dir, '.noldor'), { recursive: true });
      mkdirSync(join(dir, '.real-src'), { recursive: true });
      writeFileSync(
        join(dir, '.noldor', 'config.json'),
        JSON.stringify({ consumer: { ...MINIMAL_CONSUMER, scanPaths: ['src'] } }),
        'utf8',
      );
      writeFileSync(join(dir, '.real-src', 'a.ts'), 'export const a = 1;\n', 'utf8');
      symlinkSync(join(dir, '.real-src'), join(dir, 'src'));
      // A root resolving to a dot-prefixed location vanishing entirely means a
      // null mtime, and a null mtime makes the freshness gate pass — a stale
      // graph reading fresh, the inverse this walker exists to prevent.
      expect(newestMtimeInRoots(dir, ['src'])).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('bounds a followed FILE link, not only directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'walkdir-filelink-'));
    const outside = mkdtempSync(join(tmpdir(), 'walkdir-fileout-'));
    try {
      mkdirSync(join(dir, '.noldor'), { recursive: true });
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, '.noldor', 'config.json'),
        JSON.stringify({ consumer: { ...MINIMAL_CONSUMER, scanPaths: ['src'] } }),
        'utf8',
      );
      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
      const future = new Date(Date.now() + 600_000);
      writeFileSync(join(outside, 'host.ts'), 'x', 'utf8');
      utimesSync(join(outside, 'host.ts'), future, future);
      symlinkSync(join(outside, 'host.ts'), join(dir, 'src', 'host.ts'));
      expect(newestMtimeInRoots(dir, ['src'])).toBeLessThan(future.getTime());
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
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

// Q-0240: build and test tools write under scan roots too, and a Playwright run
// staled the graph with nothing but gitignored output. Dropping ignored files is
// the data-losing direction — over-dropping lets a stale graph read fresh — so
// the cases that must still count sit in their own table.
describe('newestMtimeInRoots over gitignored files', () => {
  /** Ten minutes ahead, so a file carrying it is unmistakably the newest. */
  const FUTURE = Date.now() + 600_000;

  function git(cwd: string, ...args: string[]): void {
    execFileSync('git', args, { cwd, encoding: 'utf8' });
  }

  /** A real git repo scanning `src`, `src/a.ts` committed under `gitignore`. */
  function gitRepo(gitignore: string): { dir: string; [Symbol.dispose](): void } {
    const dir = makeTmpRepo(['src']);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(dir, '.gitignore'), gitignore);
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 't@example.com');
    git(dir, 'config', 'user.name', 'T');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    return { dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
  }

  function writeFuture(dir: string, rel: string): void {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, 'x');
    utimesSync(full, new Date(FUTURE), new Date(FUTURE));
  }

  /** Tracked whatever the ignore rules say — `-f` is how a repo commits past a pattern. */
  function commit(dir: string, rel: string): void {
    git(dir, 'add', '-f', '--', rel);
    git(dir, 'commit', '-qm', `add ${rel}`);
  }

  it.each([
    {
      shape: 'a committed source file',
      gitignore: 'test-results/\n',
      setup: (dir: string) => {
        writeFuture(dir, 'src/b.ts');
        commit(dir, 'src/b.ts');
      },
    },
    {
      shape: 'a tracked file an ignore pattern matches',
      gitignore: '*.log\n',
      setup: (dir: string) => {
        writeFuture(dir, 'src/keep.log');
        commit(dir, 'src/keep.log');
      },
    },
    {
      // An ignored sibling makes git list `out/`'s entries one by one; listing
      // `out/` whole would prune the tracked file with it.
      shape: 'a tracked file inside a directory an ignore pattern matches',
      gitignore: 'out/\n',
      setup: (dir: string) => {
        writeFuture(dir, 'src/out/kept.ts');
        commit(dir, 'src/out/kept.ts');
        writeFileSync(join(dir, 'src', 'out', 'junk.bin'), 'x');
      },
    },
    {
      shape: 'a new file not yet added',
      gitignore: 'test-results/\n',
      setup: (dir: string) => writeFuture(dir, 'src/new.ts'),
    },
    {
      // `feature/` is untracked and holds an ignored `out/`, but it is not
      // ignored itself: git lists `feature/out/`, never `feature/`.
      shape: 'a new file beside an ignored directory',
      gitignore: 'out/\n',
      setup: (dir: string) => {
        writeFuture(dir, 'src/feature/new.ts');
        mkdirSync(join(dir, 'src', 'feature', 'out'));
        writeFileSync(join(dir, 'src', 'feature', 'out', 'junk.bin'), 'x');
      },
    },
  ])('still reports $shape', ({ gitignore, setup }) => {
    using repo = gitRepo(gitignore);
    setup(repo.dir);
    expect(newestMtimeInRoots(repo.dir, ['src'])).toBe(FUTURE);
  });

  it('still reports an ignored-looking file outside any git repository', () => {
    const dir = makeTmpRepo(['src']);
    try {
      // Only meaningful where git cannot answer: nothing may be filtered then.
      expect(spawnSync('git', ['rev-parse'], { cwd: dir }).status).not.toBe(0);
      writeFileSync(join(dir, '.gitignore'), 'test-results/\n');
      writeFuture(dir, 'src/test-results/trace.zip');
      expect(newestMtimeInRoots(dir, ['src'])).toBe(FUTURE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      // The Playwright layout the regression came from: pruned at the directory.
      shape: 'a test artifact nested under an ignored directory',
      gitignore: 'test-results/\n',
      rel: 'src/web/test-results/a11y-bar-retry1/trace.zip',
    },
    {
      shape: 'a file an ignore pattern matches beside the sources',
      gitignore: '*.log\n',
      rel: 'src/debug.log',
    },
  ])('drops $shape', ({ gitignore, rel }) => {
    using repo = gitRepo(gitignore);
    writeFuture(repo.dir, rel);
    expect(newestMtimeInRoots(repo.dir, ['src'])).toBeLessThan(FUTURE);
  });
});
