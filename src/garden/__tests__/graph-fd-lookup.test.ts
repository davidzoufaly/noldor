// @tests: bootstrap-immunity-for-self-gating-features, feature-md-links-overhaul, framework-milestones-support-poc-mvp-100, noldor, outcome-telemetry-and-effectiveness-metrics, release-script-sddreport-skip-if-only-count-line-changed, sdd-co-tag-detector, sdd-detector-5-idea-merge-semantic-similarity

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildFileToFdsMap,
  collectTestInputs,
  computeMissingCoTags,
  getCommunityOwners,
  getFdOwnersForFile,
  getImportOwnersForTest,
  isStaleGraphGap,
  loadFreshGraphOrWarn,
  requireFreshGraph,
} from '../graph-fd-lookup.js';

import type { GraphifyGraph } from '../graph-fd-lookup.js';

import type { FeatureRecord } from '../../core/fd-load.js';
import type { FeatureFrontmatter } from '../../core/feature-schema.js';

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
        expect(result.gap.message).toMatch(/Run pnpm noldor graphify build/);
      }
    });
  });

  // Pins the machine discriminator to the real constructor: if the stale-gap
  // wording is reworded without the shared prefix, this fails rather than
  // silently making `garden detect --ci` blind to graph staleness.
  it('isStaleGraphGap recognizes the gap a stale graph actually produces', () => {
    withTmp((dir) => {
      const graphPath = join(dir, 'graph.json');
      writeFileSync(graphPath, JSON.stringify({ nodes: [], links: [] }));
      const past = new Date(Date.now() - 60_000);
      utimesSync(graphPath, past, past);
      writeFileSync(join(dir, 'src.ts'), 'x');
      const result = loadFreshGraphOrWarn(graphPath, [dir]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isStaleGraphGap(result.gap)).toBe(true);
      }
    });
  });

  // Graphify is optional — a consumer that never generates a graph must not
  // fail a CI-mode garden run, so the missing-graph meta-gap stays non-fatal.
  it('isStaleGraphGap rejects the missing-graph meta-gap', () => {
    withTmp((dir) => {
      const result = loadFreshGraphOrWarn(join(dir, 'absent.json'), [dir]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.gap.message).toMatch(/does not exist/);
        expect(isStaleGraphGap(result.gap)).toBe(false);
      }
    });
  });

  it('isStaleGraphGap rejects a real co-tag gap sharing the meta-gap category', () => {
    expect(
      isStaleGraphGap({
        category: 'Tests with incomplete co-tag',
        itemId: 'src/garden/__tests__/graph-fd-lookup.test.ts',
        message: 'imports files owned by FDs missing from @tests: tag — add: doc-gardening-skill',
      }),
    ).toBe(false);
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

  // Q-0240: an e2e run writes its artifacts under a scan root. The gitignored
  // output alone demoted the graph, every probable-owner hint in the SDD report
  // vanished, and the regenerated report stopped matching its committed copy
  // with no diff anywhere to explain why.
  function e2eRepo(dir: string): { appsRoot: string; graphPath: string; source: string } {
    const appsRoot = join(dir, 'apps');
    const source = join(appsRoot, 'web', 'src', 'app.ts');
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, 'x');
    writeFileSync(join(dir, '.gitignore'), 'test-results/\n');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    git('add', '-A');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-qm', 'base');
    const past = new Date(Date.now() - 60_000);
    utimesSync(source, past, past);
    const graphPath = join(dir, 'graph.json');
    writeFileSync(graphPath, JSON.stringify({ nodes: [], links: [] }));
    return { appsRoot, graphPath, source };
  }

  it('stays fresh when only a gitignored test artifact is newer than the graph', () => {
    withTmp((dir) => {
      const { appsRoot, graphPath } = e2eRepo(dir);
      const artifact = join(appsRoot, 'web', 'test-results', 'a11y-bar-retry1', 'trace.zip');
      mkdirSync(dirname(artifact), { recursive: true });
      writeFileSync(artifact, 'x');
      const future = new Date(Date.now() + 60_000);
      utimesSync(artifact, future, future);
      expect(loadFreshGraphOrWarn(graphPath, [appsRoot]).ok).toBe(true);
    });
  });

  it('still goes stale when a tracked source is newer than the graph', () => {
    withTmp((dir) => {
      const { appsRoot, graphPath, source } = e2eRepo(dir);
      const future = new Date(Date.now() + 60_000);
      utimesSync(source, future, future);
      const result = loadFreshGraphOrWarn(graphPath, [appsRoot]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isStaleGraphGap(result.gap)).toBe(true);
      }
    });
  });

  // Q-0290: a pull that brings a code merge together with its graph refresh
  // writes `graphify-out/` before `src/`, so the current graph is milliseconds
  // older than the code it describes. The committed history is the measure.
  function pulledRepo(dir: string) {
    const src = join(dir, 'src');
    const source = join(src, 'app.ts');
    const graphPath = join(dir, 'graphify-out', 'graph.json');
    mkdirSync(src, { recursive: true });
    mkdirSync(dirname(graphPath), { recursive: true });
    writeFileSync(source, 'x');
    writeFileSync(graphPath, JSON.stringify({ nodes: [], links: [] }));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    const commit = (msg: string) => {
      git('add', '-A');
      git('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-qm', msg);
    };
    commit('code + graph refresh');
    const past = new Date(Date.now() - 60_000);
    utimesSync(graphPath, past, past);
    return { commit, graphPath, source, src };
  }

  it('stays fresh when the committed graph is older on disk than the code it covers', () => {
    withTmp((dir) => {
      const { graphPath, src } = pulledRepo(dir);
      expect(loadFreshGraphOrWarn(graphPath, [src]).ok).toBe(true);
    });
  });

  it('goes stale when a source commit lands after the graph commit', () => {
    withTmp((dir) => {
      const { commit, graphPath, source, src } = pulledRepo(dir);
      writeFileSync(source, 'y');
      commit('code without a graph refresh');
      const result = loadFreshGraphOrWarn(graphPath, [src]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isStaleGraphGap(result.gap)).toBe(true);
        expect(result.gap.message).toContain('Run pnpm noldor graphify build');
        expect(result.gap.message).not.toMatch(/commit them first/);
      }
    });
  });

  // The build reads HEAD, so "run graphify build" cannot clear this one: the
  // remedy has to say commit first, or an operator rebuilds in a loop (Q-0315).
  it('goes stale when a source file has uncommitted changes, and says to commit first', () => {
    withTmp((dir) => {
      const { graphPath, source, src } = pulledRepo(dir);
      writeFileSync(source, 'y');
      const result = loadFreshGraphOrWarn(graphPath, [src]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isStaleGraphGap(result.gap)).toBe(true);
        expect(result.gap.message).toMatch(
          /commit them first, then run pnpm noldor graphify build/,
        );
      }
    });
  });

  it('stays fresh when only a test file changed after the graph commit', () => {
    withTmp((dir) => {
      const { commit, graphPath, src } = pulledRepo(dir);
      writeFileSync(join(src, 'app.test.ts'), 'x');
      commit('test only');
      expect(loadFreshGraphOrWarn(graphPath, [src]).ok).toBe(true);
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
        expect(result.gap.message).toMatch(/Run pnpm noldor graphify build/);
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

// The filter decides which graph nodes are tests at all, and dropping one loses
// its row from both the report and the seeder — so the shapes it must keep sit
// in their own table beside the shapes it must drop.
describe(computeMissingCoTags, () => {
  const owners = [feature('zeta', ['src/x.ts']), feature('alpha', ['src/y.ts'])];

  function importing(node: { file: string; location?: string }): GraphifyGraph {
    return {
      links: [
        { relation: 'imports_from', source: 't', target: 'x' },
        { relation: 'imports_from', source: 't', target: 'y' },
      ],
      nodes: [
        { id: 't', source_file: node.file, source_location: node.location ?? 'L1' },
        { id: 'x', source_file: 'src/x.ts', source_location: 'L1' },
        { id: 'y', source_file: 'src/y.ts', source_location: 'L1' },
      ],
    };
  }

  it.each([
    ['a .test.ts file', 'src/a.test.ts'],
    ['a .spec.tsx file', 'src/b.spec.tsx'],
    ['a .test.js file', 'src/c.test.js'],
    ['a .spec.jsx file', 'src/d.spec.jsx'],
  ])('still reports %s', (_label, file) => {
    expect(computeMissingCoTags(owners, [], importing({ file }), 'e2e/')).toEqual([
      { missing: ['alpha', 'zeta'], path: file },
    ]);
  });

  it.each([
    ['a non-test source file', { file: 'src/lib.ts' }],
    ['a .test.mjs file', { file: 'src/e.test.mjs' }],
    ['a test under the e2e prefix', { file: 'e2e/flow.test.ts' }],
    ['an inner symbol of a test file', { file: 'src/a.test.ts', location: 'L7' }],
  ])('drops %s', (_label, node) => {
    expect(computeMissingCoTags(owners, [], importing(node), 'e2e/')).toEqual([]);
  });

  it('leaves out the slugs the test already declares', () => {
    const inputs = [{ content: '// @tests: zeta\n', path: 'src/a.test.ts' }];
    expect(
      computeMissingCoTags(owners, inputs, importing({ file: 'src/a.test.ts' }), 'e2e/'),
    ).toEqual([{ missing: ['alpha'], path: 'src/a.test.ts' }]);
  });

  it('omits a test that declares every owner', () => {
    const inputs = [{ content: '// @tests: alpha, zeta\n', path: 'src/a.test.ts' }];
    expect(
      computeMissingCoTags(owners, inputs, importing({ file: 'src/a.test.ts' }), 'e2e/'),
    ).toEqual([]);
  });
});

describe(collectTestInputs, () => {
  it('reads every test file under the configured scan roots, and nothing else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'collect-tests-'));
    const previous = process.cwd();
    try {
      const write = (rel: string, text: string): void => {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), text);
      };
      write(
        '.noldor/config.json',
        JSON.stringify({
          consumer: {
            appPathPrefix: '',
            boundaries: [],
            deprecatedPackages: [],
            e2ePrefix: '',
            lockstepPackages: ['package.json'],
            name: 'acme',
            packagePrefix: '',
            repoUrl: 'https://github.com/x/y',
            samplesPath: '',
            scanPaths: ['lib'],
          },
        }),
      );
      write('lib/a.test.ts', '// @tests: a\n');
      write('lib/deep/b.spec.js', '// @tests: b\n');
      write('lib/c.ts', 'export {};\n');
      write('other/d.test.ts', '// @tests: d\n');
      process.chdir(dir);
      const inputs = await collectTestInputs();
      expect(inputs.toSorted((l, r) => l.path.localeCompare(r.path, 'en'))).toEqual([
        { content: '// @tests: a\n', path: 'lib/a.test.ts' },
        { content: '// @tests: b\n', path: 'lib/deep/b.spec.js' },
      ]);
    } finally {
      process.chdir(previous);
      rmSync(dir, { force: true, recursive: true });
    }
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
