// @tests: architecture-design-phase
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { moduleImportPairs, moduleOf, pairsFromFiles } from '../module-pairs.js';

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
});
