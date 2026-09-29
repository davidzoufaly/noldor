// @tests: architecture-design-phase
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
});
