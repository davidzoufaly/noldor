// @tests: architecture-invariants

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makePublicApiTsdocInvariant } from '../../invariants/public-api-tsdoc.js';

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), 'inv-tsdoc-'));
  await mkdir(join(root, 'packages/foo/src'), { recursive: true });
  return root;
}

describe('public-api-tsdoc plugin', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await rm(repo, { force: true, recursive: true });
  });

  it('passes when re-exported symbol has TSDoc', async () => {
    await writeFile(
      join(repo, 'packages/foo/src/foo.ts'),
      `/**\n * Adds two numbers.\n */\nexport function add(a: number, b: number): number { return a + b; }\n`,
    );
    await writeFile(join(repo, 'packages/foo/src/index.ts'), `export { add } from './foo.js';\n`);
    const inv = makePublicApiTsdocInvariant(repo);
    const result = await inv.run();
    expect(result.violations).toHaveLength(0);
  });

  it('flags re-exported symbol without TSDoc', async () => {
    await writeFile(
      join(repo, 'packages/foo/src/foo.ts'),
      `export function add(a: number, b: number): number { return a + b; }\n`,
    );
    await writeFile(join(repo, 'packages/foo/src/index.ts'), `export { add } from './foo.js';\n`);
    const inv = makePublicApiTsdocInvariant(repo);
    const result = await inv.run();
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.message).toContain('add');
  });

  it('checks public symbols re-exported from .tsx sources', async () => {
    await writeFile(
      join(repo, 'packages/foo/src/Widget.tsx'),
      `export function Widget() { return null; }\n`,
    );
    await writeFile(
      join(repo, 'packages/foo/src/index.ts'),
      `export { Widget } from './Widget.js';\n`,
    );
    const inv = makePublicApiTsdocInvariant(repo);
    const result = await inv.run();
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.message).toContain('Widget');
  });

  it('skips @internal-tagged exports', async () => {
    await writeFile(
      join(repo, 'packages/foo/src/foo.ts'),
      `/**\n * @internal\n */\nexport function add(a: number, b: number): number { return a + b; }\n`,
    );
    await writeFile(join(repo, 'packages/foo/src/index.ts'), `export { add } from './foo.js';\n`);
    const inv = makePublicApiTsdocInvariant(repo);
    const result = await inv.run();
    expect(result.violations).toHaveLength(0);
  });

  it('resolves renamed re-exports back to the source declaration', async () => {
    await writeFile(
      join(repo, 'packages/foo/src/foo.ts'),
      `export function add(a: number, b: number): number { return a + b; }\n`,
    );
    await writeFile(
      join(repo, 'packages/foo/src/index.ts'),
      `export { add as plus } from './foo.js';\n`,
    );
    const inv = makePublicApiTsdocInvariant(repo);
    const result = await inv.run();
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.message).toContain('add');
  });

  it('skips @internal declared in a line comment', async () => {
    await writeFile(
      join(repo, 'packages/foo/src/foo.ts'),
      `// @internal\nexport function add(a: number, b: number): number { return a + b; }\n`,
    );
    await writeFile(join(repo, 'packages/foo/src/index.ts'), `export { add } from './foo.js';\n`);
    const inv = makePublicApiTsdocInvariant(repo);
    const result = await inv.run();
    expect(result.violations).toHaveLength(0);
  });

  it('reports the declaration line, not the comment line', async () => {
    await writeFile(
      join(repo, 'packages/foo/src/foo.ts'),
      `const internalHelper = 1;\n\nexport function add(a: number, b: number): number { return a + b + internalHelper; }\n`,
    );
    await writeFile(join(repo, 'packages/foo/src/index.ts'), `export { add } from './foo.js';\n`);
    const inv = makePublicApiTsdocInvariant(repo);
    const result = await inv.run();
    expect(result.violations[0]?.line).toBe(3);
  });

  it('ignores a nested declaration that shadows the exported name', async () => {
    await writeFile(
      join(repo, 'packages/foo/src/foo.ts'),
      `function wrapper() {\n  /** local doc */\n  const add = 1;\n  return add;\n}\n\nexport function add(a: number, b: number): number { return a + b + wrapper(); }\n`,
    );
    await writeFile(join(repo, 'packages/foo/src/index.ts'), `export { add } from './foo.js';\n`);
    const inv = makePublicApiTsdocInvariant(repo);
    const result = await inv.run();
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.line).toBe(7);
  });

  it('passes when no package indices exist (JS consumer shape)', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'inv-tsdoc-bare-'));
    try {
      const inv = makePublicApiTsdocInvariant(bare);
      const result = await inv.run();
      expect(result.violations).toHaveLength(0);
    } finally {
      await rm(bare, { force: true, recursive: true });
    }
  });
});
