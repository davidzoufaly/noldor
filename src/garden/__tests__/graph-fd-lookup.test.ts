// @tests: bootstrap-immunity-for-self-gating-features, feature-md-links-overhaul, framework-milestones-support-poc-mvp-100, noldor, outcome-telemetry-and-effectiveness-metrics, release-script-sddreport-skip-if-only-count-line-changed, sdd-co-tag-detector

import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildFileToFdsMap,
  getCommunityOwners,
  getFdOwnersForFile,
  getImportOwnersForTest,
  loadFreshGraphOrWarn,
  requireFreshGraph,
} from '../graph-fd-lookup.js';

import type { GraphifyGraph } from '../graph-fd-lookup.js';

import type { FeatureRecord } from '../sdd-report.js';
import type { FeatureFrontmatter } from '../../features/feature-schema.js';

const baseFm: FeatureFrontmatter = {
  area: 'engine',
  category: 'Core',
  deps: [],
  links: { code: [], docs: [], spec: 'x', tests: [] },
  name: 'Stub',
  packages: ['engine'],
  phase: 'done',
  'noldor-tier': 'specs-only',
};

function feature(slug: string, code: string[]): FeatureRecord {
  return { frontmatter: { ...baseFm, links: { ...baseFm.links, code } }, slug };
}

describe(buildFileToFdsMap, () => {
  it('maps a file path to its single owner FD', () => {
    const map = buildFileToFdsMap([feature('foo', ['packages/engine/src/foo.ts'])]);
    expect(map.get('packages/engine/src/foo.ts')).toEqual(new Set(['foo']));
  });

  it('co-owners (two FDs reference same file) yield a set with both slugs', () => {
    const map = buildFileToFdsMap([
      feature('a', ['packages/engine/src/shared.ts']),
      feature('b', ['packages/engine/src/shared.ts']),
    ]);
    expect(map.get('packages/engine/src/shared.ts')).toEqual(new Set(['a', 'b']));
  });

  it('directory entries (with trailing slash) are stored without the slash', () => {
    const map = buildFileToFdsMap([feature('pkg', ['packages/sample-scenes/'])]);
    expect(map.has('packages/sample-scenes')).toBe(true);
    expect(map.has('packages/sample-scenes/')).toBe(false);
  });
});

describe(getFdOwnersForFile, () => {
  it('returns the direct file owner', () => {
    const map = buildFileToFdsMap([feature('foo', ['packages/engine/src/foo.ts'])]);
    expect(getFdOwnersForFile('packages/engine/src/foo.ts', map)).toEqual(new Set(['foo']));
  });

  it('walks ancestor directories — directory entry covers nested files', () => {
    const map = buildFileToFdsMap([feature('samples', ['packages/sample-scenes/'])]);
    expect(getFdOwnersForFile('packages/sample-scenes/src/empty-room.ts', map)).toEqual(
      new Set(['samples']),
    );
  });

  it('unowned file returns empty set', () => {
    const map = buildFileToFdsMap([feature('foo', ['packages/engine/src/foo.ts'])]);
    expect(getFdOwnersForFile('packages/format/src/types.ts', map)).toEqual(new Set());
  });

  it('unions owners from direct file + ancestor directory', () => {
    const map = buildFileToFdsMap([
      feature('dir', ['packages/engine/']),
      feature('file', ['packages/engine/src/foo.ts']),
    ]);
    expect(getFdOwnersForFile('packages/engine/src/foo.ts', map)).toEqual(new Set(['dir', 'file']));
  });
});

describe(loadFreshGraphOrWarn, () => {
  function withTmp<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'graph-fd-lookup-'));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  }

  it('returns ok on a fresh graph (mtime newer than all source files)', () => {
    withTmp((dir) => {
      writeFileSync(join(dir, 'src.ts'), 'x');
      const srcMtime = statSync(join(dir, 'src.ts')).mtime;
      const graphPath = join(dir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify({ nodes: [], links: [] }));
      const future = new Date(srcMtime.getTime() + 1000);
      utimesSync(graphPath, future, future);
      const result = loadFreshGraphOrWarn(graphPath, [dir]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.graph.nodes).toEqual([]);
      }
    });
  });

  it('returns a stale gap when graph mtime predates a source file', () => {
    withTmp((dir) => {
      const graphPath = join(dir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify({ nodes: [], links: [] }));
      // touch graph to a known past time, then write a newer source file
      const past = new Date(Date.now() - 60_000);
      utimesSync(graphPath, past, past);
      writeFileSync(join(dir, 'src.ts'), 'x');
      const result = loadFreshGraphOrWarn(graphPath, [dir]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.gap.category).toBe('Tests with incomplete co-tag');
        expect(result.gap.message).toMatch(/degraded mode/);
        expect(result.gap.message).toMatch(/Run \/graphify/);
      }
    });
  });

  it('ignores generated sample-scene artifacts when checking graph freshness', () => {
    withTmp((dir) => {
      const appsRoot = join(dir, 'apps');
      const generatedDir = join(appsRoot, 'web', 'public', 'samples', 'empty-room');
      mkdirSync(generatedDir, { recursive: true });

      const graphPath = join(dir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify({ nodes: [], links: [] }));
      const graphTime = new Date(Date.now() - 60_000);
      utimesSync(graphPath, graphTime, graphTime);

      const generatedFile = join(generatedDir, 'scene.acme');
      writeFileSync(generatedFile, '{}');
      const newer = new Date(Date.now() + 60_000);
      utimesSync(generatedFile, newer, newer);

      const result = loadFreshGraphOrWarn(graphPath, [appsRoot]);
      expect(result.ok).toBe(true);
    });
  });

  it('ignores generated sample-scene artifacts when roots are repo-relative', () => {
    withTmp((dir) => {
      const appsRoot = join(dir, 'apps');
      const generatedDir = join(appsRoot, 'web', 'public', 'samples', 'empty-room');
      mkdirSync(generatedDir, { recursive: true });

      const graphPath = join(dir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify({ nodes: [], links: [] }));
      const graphTime = new Date(Date.now() - 60_000);
      utimesSync(graphPath, graphTime, graphTime);

      const generatedFile = join(generatedDir, 'scene.acme');
      writeFileSync(generatedFile, '{}');
      const newer = new Date(Date.now() + 60_000);
      utimesSync(generatedFile, newer, newer);

      // Scaffold minimal consumer config so loadConsumerConfig() resolves
      // when cwd is switched to the temp dir.
      mkdirSync(join(dir, '.noldor'), { recursive: true });
      writeFileSync(
        join(dir, '.noldor', 'config.json'),
        JSON.stringify({
          consumer: {
            name: 'test',
            repoUrl: 'https://example.com',
            lockstepPackages: ['package.json'],
            scanPaths: [],
            boundaries: [],
            deprecatedPackages: [],
            e2ePrefix: 'apps/web/e2e/',
            samplesPath: 'apps/web/public/samples',
            packagePrefix: '@test/',
            pnpmStderrPrefix: 'test@',
            appPathPrefix: 'apps/web/',
          },
        }),
      );
      const previousCwd = process.cwd();
      process.chdir(dir);
      try {
        const result = loadFreshGraphOrWarn(graphPath, ['apps']);
        expect(result.ok).toBe(true);
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  it('returns a missing-graph gap when graph.json does not exist', () => {
    withTmp((dir) => {
      const missingPath = join(dir, 'nope.json');
      const result = loadFreshGraphOrWarn(missingPath, [dir]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.gap.itemId).toBe(missingPath);
        expect(result.gap.message).toMatch(/does not exist/);
        expect(result.gap.message).toMatch(/Run \/graphify/);
      }
    });
  });
});

describe(requireFreshGraph, () => {
  function withTmp<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'graph-fd-lookup-'));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  }

  it('returns the graph plus an ownership map built from features when fresh', () => {
    withTmp((dir) => {
      writeFileSync(join(dir, 'src.ts'), 'x');
      const srcMtime = statSync(join(dir, 'src.ts')).mtime;
      const graphPath = join(dir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify({ nodes: [], links: [] }));
      const future = new Date(srcMtime.getTime() + 1000);
      utimesSync(graphPath, future, future);
      const ctx = requireFreshGraph(
        graphPath,
        [dir],
        [feature('foo', ['packages/engine/src/foo.ts'])],
      );
      expect(ctx).not.toBeNull();
      expect(ctx?.graph.nodes).toEqual([]);
      expect(ctx?.fileToFds.get('packages/engine/src/foo.ts')).toEqual(new Set(['foo']));
    });
  });

  it('returns null when the graph is stale (degraded mode, no gap)', () => {
    withTmp((dir) => {
      const graphPath = join(dir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify({ nodes: [], links: [] }));
      const past = new Date(Date.now() - 60_000);
      utimesSync(graphPath, past, past);
      writeFileSync(join(dir, 'src.ts'), 'x');
      expect(requireFreshGraph(graphPath, [dir], [])).toBeNull();
    });
  });

  it('returns null when the graph file is missing', () => {
    withTmp((dir) => {
      expect(requireFreshGraph(join(dir, 'nope.json'), [dir], [])).toBeNull();
    });
  });
});

describe(getImportOwnersForTest, () => {
  it('returns FD slugs owning every file the test imports', () => {
    const graph: GraphifyGraph = {
      nodes: [
        { id: 'test_a', source_file: 'packages/a/__tests__/x.test.ts', source_location: 'L1' },
        { id: 'src_a', source_file: 'packages/a/src/x.ts', source_location: 'L1' },
        { id: 'src_b', source_file: 'packages/b/src/y.ts', source_location: 'L1' },
      ],
      links: [
        { source: 'test_a', target: 'src_a', relation: 'imports_from' },
        { source: 'test_a', target: 'src_b', relation: 'imports_from' },
      ],
    };
    const fileToFds = new Map<string, Set<string>>([
      ['packages/a/src/x.ts', new Set(['fd-a'])],
      ['packages/b/src/y.ts', new Set(['fd-b'])],
    ]);
    const owners = getImportOwnersForTest('test_a', graph, fileToFds);
    expect([...owners].toSorted()).toStrictEqual(['fd-a', 'fd-b']);
  });

  it('returns an empty set when the test imports nothing tracked', () => {
    const graph: GraphifyGraph = {
      nodes: [
        { id: 'test_a', source_file: 'packages/a/__tests__/x.test.ts', source_location: 'L1' },
      ],
      links: [],
    };
    const fileToFds = new Map<string, Set<string>>();
    const owners = getImportOwnersForTest('test_a', graph, fileToFds);
    expect(owners.size).toBe(0);
  });

  it('ignores edges with relation other than imports_from', () => {
    const graph: GraphifyGraph = {
      nodes: [
        { id: 'test_a', source_file: 'packages/a/__tests__/x.test.ts', source_location: 'L1' },
        { id: 'src_a', source_file: 'packages/a/src/x.ts', source_location: 'L1' },
      ],
      links: [{ source: 'test_a', target: 'src_a', relation: 'calls' }],
    };
    const fileToFds = new Map<string, Set<string>>([['packages/a/src/x.ts', new Set(['fd-a'])]]);
    const owners = getImportOwnersForTest('test_a', graph, fileToFds);
    expect(owners.size).toBe(0);
  });
});

describe(getCommunityOwners, () => {
  it('ranks FD slugs by frequency among community co-members', () => {
    const graph: GraphifyGraph = {
      nodes: [
        {
          id: 'orphan',
          source_file: 'packages/a/src/orphan.ts',
          source_location: 'L1',
          community: 7,
        },
        {
          id: 'sib1',
          source_file: 'packages/a/src/foo.ts',
          source_location: 'L1',
          community: 7,
        },
        {
          id: 'sib2',
          source_file: 'packages/a/src/bar.ts',
          source_location: 'L1',
          community: 7,
        },
        {
          id: 'sib3',
          source_file: 'packages/b/src/baz.ts',
          source_location: 'L1',
          community: 7,
        },
        {
          id: 'unrelated',
          source_file: 'packages/c/src/qux.ts',
          source_location: 'L1',
          community: 9,
        },
      ],
      links: [],
    };
    const fileToFds = new Map<string, Set<string>>([
      ['packages/a/src/foo.ts', new Set(['fd-a'])],
      ['packages/a/src/bar.ts', new Set(['fd-a'])],
      ['packages/b/src/baz.ts', new Set(['fd-b'])],
      ['packages/c/src/qux.ts', new Set(['fd-c'])],
    ]);
    const ranked = getCommunityOwners('packages/a/src/orphan.ts', graph, fileToFds);
    expect(ranked).toStrictEqual([
      { slug: 'fd-a', count: 2 },
      { slug: 'fd-b', count: 1 },
    ]);
  });

  it('returns an empty array when the file is not in the graph', () => {
    const graph: GraphifyGraph = { nodes: [], links: [] };
    const fileToFds = new Map<string, Set<string>>();
    const ranked = getCommunityOwners('packages/a/src/missing.ts', graph, fileToFds);
    expect(ranked).toStrictEqual([]);
  });

  it('returns an empty array when the file has no community number', () => {
    const graph: GraphifyGraph = {
      nodes: [
        { id: 'orphan', source_file: 'packages/a/src/orphan.ts', source_location: 'L1' },
        {
          id: 'sib1',
          source_file: 'packages/a/src/foo.ts',
          source_location: 'L1',
          community: 7,
        },
      ],
      links: [],
    };
    const fileToFds = new Map<string, Set<string>>([['packages/a/src/foo.ts', new Set(['fd-a'])]]);
    const ranked = getCommunityOwners('packages/a/src/orphan.ts', graph, fileToFds);
    expect(ranked).toStrictEqual([]);
  });

  it('excludes the file itself from suggestions', () => {
    const graph: GraphifyGraph = {
      nodes: [
        {
          id: 'orphan',
          source_file: 'packages/a/src/orphan.ts',
          source_location: 'L1',
          community: 7,
        },
        {
          id: 'sib1',
          source_file: 'packages/a/src/foo.ts',
          source_location: 'L1',
          community: 7,
        },
      ],
      links: [],
    };
    const fileToFds = new Map<string, Set<string>>([
      ['packages/a/src/orphan.ts', new Set(['self-owner'])],
      ['packages/a/src/foo.ts', new Set(['fd-a'])],
    ]);
    const ranked = getCommunityOwners('packages/a/src/orphan.ts', graph, fileToFds);
    expect(ranked.find((r) => r.slug === 'self-owner')).toBeUndefined();
  });

  it('sorts ties by slug alphabetically (stable, deterministic)', () => {
    const graph: GraphifyGraph = {
      nodes: [
        {
          id: 'orphan',
          source_file: 'packages/a/src/orphan.ts',
          source_location: 'L1',
          community: 1,
        },
        {
          id: 'sib1',
          source_file: 'packages/a/src/foo.ts',
          source_location: 'L1',
          community: 1,
        },
        {
          id: 'sib2',
          source_file: 'packages/b/src/bar.ts',
          source_location: 'L1',
          community: 1,
        },
      ],
      links: [],
    };
    const fileToFds = new Map<string, Set<string>>([
      ['packages/a/src/foo.ts', new Set(['z-fd'])],
      ['packages/b/src/bar.ts', new Set(['a-fd'])],
    ]);
    const ranked = getCommunityOwners('packages/a/src/orphan.ts', graph, fileToFds);
    expect(ranked.map((r) => r.slug)).toStrictEqual(['a-fd', 'z-fd']);
  });
});
