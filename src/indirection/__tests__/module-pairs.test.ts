// @tests: architecture-design-phase
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { edgesFromFiles, moduleImportPairs, moduleOf, pairsFromFiles } from '../module-pairs.js';

const MODULES = ['src/a', 'src/b', 'src/c'];
const FIXTURE = join(import.meta.dirname, 'trees', 'modules');

describe('module-pairs', () => {
  it('maps a file to the module path that prefixes it', () => {
    expect(moduleOf('src/a/x.ts', MODULES)).toBe('src/a');
    expect(moduleOf('src/index.ts', MODULES)).toBeNull();
    expect(moduleOf('src/ab/x.ts', MODULES)).toBeNull();
  });

  it('keeps cross-module imports and drops imports inside one module', () => {
    const files = [
      {
        source: 'src/a/x.ts',
        dependencies: [{ resolved: 'src/b/y.ts' }, { resolved: 'src/a/z.ts' }],
      },
      {
        source: 'src/c/w.ts',
        dependencies: [{ resolved: 'src/a/x.ts' }, { resolved: 'node_modules/zod/index.js' }],
      },
    ];
    expect([...pairsFromFiles(files, MODULES)].sort()).toEqual([
      'src/a -> src/b',
      'src/c -> src/a',
    ]);
  });

  it('reads the pairs off a real cruise, spec files excluded', async () => {
    const result = await moduleImportPairs(FIXTURE, ['src'], MODULES);
    expect(result.kind).toBe('pairs');
    if (result.kind === 'pairs')
      expect([...result.pairs].sort()).toEqual(['src/a -> src/b', 'src/c -> src/a']);
  });

  it('reports a graph it cannot build rather than an empty one', async () => {
    expect(await moduleImportPairs(FIXTURE, ['no-such-root'], MODULES)).toMatchObject({
      kind: 'unmeasurable',
    });
  });

  it('refuses a graph with an in-repo import it could not resolve', async () => {
    const unresolved = join(import.meta.dirname, 'trees', 'unresolved');
    expect(await moduleImportPairs(unresolved, ['.'], [])).toMatchObject({
      kind: 'unmeasurable',
      message: expect.stringContaining('does-not-exist'),
    });
  });

  it('keeps every in-repo import between two files as a file edge, inside one module too', () => {
    const files = [
      {
        source: 'src/a/x.ts',
        dependencies: [
          { resolved: 'src/b/y.ts' },
          { resolved: 'src/a/z.ts' },
          { resolved: 'src/a/x.ts' },
          { resolved: 'fs' },
          { resolved: 'node_modules/zod/index.js' },
        ],
      },
    ];
    expect(edgesFromFiles(files)).toEqual([
      { from: 'src/a/x.ts', to: 'src/b/y.ts' },
      { from: 'src/a/x.ts', to: 'src/a/z.ts' },
    ]);
  });

  it('reads the file edges off the same cruise as the pairs, spec files excluded', async () => {
    const result = await moduleImportPairs(FIXTURE, ['src'], MODULES);
    if (result.kind !== 'pairs') throw new Error(result.message);
    expect(result.edges.map((e) => `${e.from} -> ${e.to}`).sort()).toEqual([
      'src/a/x.ts -> src/a/z.ts',
      'src/a/x.ts -> src/b/y.ts',
      'src/c/w.ts -> src/a/x.ts',
      'src/index.ts -> src/a/x.ts',
    ]);
  });

  describe('workspace packages', () => {
    const made: string[] = [];
    afterEach(() => {
      for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    /** An app beside a workspace package `@ws/lib`, `main.ts` holding the given imports. */
    function workspaceTree(imports: readonly string[], extra: Record<string, string> = {}): string {
      const root = mkdtempSync(join(tmpdir(), 'module-pairs-ws-'));
      made.push(root);
      const files: Record<string, string> = {
        'apps/app/package.json': JSON.stringify({ name: '@ws/app' }),
        'apps/app/src/main.ts': imports
          .map((spec, i) => `import * as m${i} from '${spec}';\n`)
          .join(''),
        'packages/lib/package.json': JSON.stringify({
          name: '@ws/lib',
          exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
        }),
        'packages/lib/src/index.ts': 'export const lib = 1;\n',
        ...extra,
      };
      for (const [path, body] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), body);
      }
      return root;
    }

    const MODS = ['apps/app', 'packages/lib'];

    it('reads an import of an unbuilt workspace package by name as an import of its directory', async () => {
      const result = await moduleImportPairs(
        workspaceTree(['@ws/lib', '@ws/lib/sub', 'zod']),
        ['apps', 'packages'],
        MODS,
      );
      if (result.kind !== 'pairs') throw new Error(result.message);
      expect([...result.pairs]).toEqual(['apps/app -> packages/lib']);
      expect(result.edges).toEqual([
        { from: 'apps/app/src/main.ts', to: 'packages/lib' },
        { from: 'apps/app/src/main.ts', to: 'packages/lib' },
      ]);
    });

    it('keeps an import that resolves into build output', async () => {
      const tree = workspaceTree(['../../../packages/lib/dist/index.js'], {
        'packages/lib/dist/index.js': 'export const lib = 1;\n',
      });
      const result = await moduleImportPairs(tree, ['apps', 'packages'], MODS);
      if (result.kind !== 'pairs') throw new Error(result.message);
      expect([...result.pairs]).toEqual(['apps/app -> packages/lib']);
      expect(result.edges).toEqual([
        { from: 'apps/app/src/main.ts', to: 'packages/lib/dist/index.js' },
      ]);
    });
  });
});
